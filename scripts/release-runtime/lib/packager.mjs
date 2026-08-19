// Runtime payload packager. Consumes explicit source roots (frozen candidate
// spec is checked in; source roots are runtime parameters, never hard-coded),
// verifies every byte against the frozen spec before it enters staging, then
// emits canonical control records and the deterministic payload archive.

import { createHash, randomUUID } from 'node:crypto'
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import {
  CANDIDATE_MANIFEST_FILE,
  ASSET_SHA256SUMS_FILE,
  RELEASE_SHA256SUMS_FILE,
  FORBIDDEN_WORKER_FILE,
  isForbiddenWorkerPath,
} from './constants.mjs'
import { serializePrettyJson, deriveCandidateIdentity } from './canonical.mjs'
import { validateFrozenSpec, assertNotQualified } from './schemata.mjs'
import {
  assertStrictDescendant,
  hashFile,
  inspectSourceFile,
  resolveExistingDirectory,
} from './sources.mjs'
import { createDeterministicZip } from './zip-writer.mjs'

export class PackError extends Error {}

function buildCandidateManifest({ candidateId, provenance, runtime, assets }) {
  return {
    schemaVersion: 1,
    kind: 'pdfhow-libreoffice-runtime-candidate',
    candidateId,
    releaseQualified: false,
    provenance,
    runtime,
    assets,
  }
}

function renderAssetSums(assets) {
  return `${assets
    .map((asset) => `${asset.sha256}  ${asset.path}`)
    .join('\n')}\n`
}

async function listRegularFilesRecursively(rootPath, currentPath = rootPath) {
  const entries = await readdir(currentPath, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const entryPath = resolve(currentPath, entry.name)
    assertStrictDescendant(rootPath, entryPath, 'Candidate output entry')
    if (entry.isSymbolicLink()) {
      throw new PackError(`output must not contain symlinks: ${entryPath}`)
    }
    if (entry.isDirectory()) {
      files.push(...(await listRegularFilesRecursively(rootPath, entryPath)))
      continue
    }
    if (!entry.isFile()) {
      throw new PackError(`output contains a non-file entry: ${entryPath}`)
    }
    files.push(relative(rootPath, entryPath).split('\\').join('/'))
  }
  return files.sort()
}

// Builds the current frozen candidate into one fresh staging directory under
// workRoot and writes deterministic release assets into a fresh out directory.
export async function assemble(options) {
  if (
    Array.isArray(options.spec?.assets) &&
    options.spec.assets.some((asset) => isForbiddenWorkerPath(asset?.path))
  ) {
    throw new PackError(`forbidden worker asset present: ${FORBIDDEN_WORKER_FILE}`)
  }
  const spec = validateFrozenSpec(options.spec)
  assertNotQualified(options.spec, 'frozen spec')
  if (options.expectedCandidateId !== undefined) {
    if (options.expectedCandidateId !== spec.candidateId) {
      throw new PackError('expectedCandidateId must match the frozen spec candidateId')
    }
  }

  const roots = {
    native: await resolveExistingDirectory(options.nativeRoot, 'Native artifact root'),
    wrapper: await resolveExistingDirectory(options.wrapperRoot, 'Wrapper artifact root'),
  }

  // 1. Verify every declared source file before copying anything.
  const inspected = []
  for (const asset of spec.assets) {
    const source = await inspectSourceFile(
      roots[asset.sourceRoot],
      asset.sourcePath,
      `${asset.role} (${asset.path})`
    )
    if (source.bytes !== asset.bytes || source.sha256 !== asset.sha256) {
      throw new PackError(
        `source drift for ${asset.path}: expected ${asset.bytes}/${asset.sha256}, ` +
          `got ${source.bytes}/${source.sha256}. A changed byte is a NEW candidate.`
      )
    }
    inspected.push({ ...asset, ...source })
  }

  const expectedPaths = spec.assets.map((asset) => asset.path)
  const missingPaths = expectedPaths.filter(
    (path) => !inspected.some((asset) => asset.path === path)
  )
  const extraAssets = inspected.filter(
    (asset) => !expectedPaths.includes(asset.path)
  )
  if (missingPaths.length > 0 || extraAssets.length > 0) {
    throw new PackError(
      `runtime asset set mismatch (missing ${missingPaths.join(', ')}; extra ${extraAssets
        .map((asset) => asset.path)
        .join(', ')})`
    )
  }
  // 2. Derive the candidate identity from immutable provenance + asset table.
  const assets = inspected
    .map(({ path, role, mimeType, bytes, sha256 }) => ({
      path,
      role,
      mimeType,
      bytes,
      sha256,
    }))
    .sort((left, right) => left.path.localeCompare(right.path))
  const derivedId = deriveCandidateIdentity({
    provenance: spec.provenance,
    runtime: spec.runtime,
    assets,
  })
  if (derivedId !== spec.candidateId) {
    throw new PackError(
      `derived candidate ID ${derivedId} does not match frozen candidate ` +
        `${spec.candidateId}; cannot proceed without a new candidate gate`
    )
  }

  // 3. Build canonical control records (UTF-8, LF, stable keys, no paths, no
  //    timestamps; qualification stays false).
  const manifest = buildCandidateManifest({
    candidateId: derivedId,
    provenance: spec.provenance,
    runtime: spec.runtime,
    assets,
  })
  const manifestBytes = Buffer.from(serializePrettyJson(manifest), 'utf8')
  const assetSumsBytes = Buffer.from(renderAssetSums(assets), 'utf8')

  // 4. Stage into a fresh directory under the declared work root.
  const workRoot = resolve(options.workRoot)
  await mkdir(workRoot, { recursive: true })
  const stagingDir = join(workRoot, `staging-${randomUUID()}`)
  assertStrictDescendant(workRoot, stagingDir, 'Staging directory')
  await mkdir(stagingDir, { recursive: true })

  let outDir
  try {
    for (const asset of inspected) {
      const outputPath = resolve(stagingDir, asset.path)
      assertStrictDescendant(stagingDir, outputPath, `Output for ${asset.role}`)
      await mkdir(dirname(outputPath), { recursive: true })
      await copyFile(asset.filePath, outputPath)
      const copiedStat = await stat(outputPath)
      const copiedHash = await hashFile(outputPath)
      if (copiedStat.size !== asset.bytes || copiedHash !== asset.sha256) {
        throw new PackError(`copied asset failed verification: ${asset.path}`)
      }
    }

    await writeFile(join(stagingDir, CANDIDATE_MANIFEST_FILE), manifestBytes, 'utf8')
    await writeFile(join(stagingDir, ASSET_SHA256SUMS_FILE), assetSumsBytes, 'utf8')

    // 5. Inventory must be exactly the frozen set + the two control files.
    const expectedFiles = new Set([
      ...spec.assets.map((asset) => asset.path),
      CANDIDATE_MANIFEST_FILE,
      ASSET_SHA256SUMS_FILE,
    ])
    const actualFiles = await listRegularFilesRecursively(stagingDir)
    if (
      actualFiles.length !== expectedFiles.size ||
      actualFiles.some((path) => !expectedFiles.has(path))
    ) {
      throw new PackError('staging directory contains undeclared files')
    }

    // 6. Deterministic archive from in-memory blobs (all ten entries).
    const archiveBlobs = [
      { path: CANDIDATE_MANIFEST_FILE, bytes: Buffer.from(manifestBytes) },
      { path: ASSET_SHA256SUMS_FILE, bytes: Buffer.from(assetSumsBytes) },
      ...(await Promise.all(
        inspected.map(async (asset) => ({
          path: asset.path,
          bytes: await readFile(join(stagingDir, asset.path)),
        }))
      )),
    ]
    const archive = createDeterministicZip(archiveBlobs)
    const archiveSha256 = createHash('sha256').update(archive).digest('hex')

    outDir = join(workRoot, `out-${randomUUID()}`)
    assertStrictDescendant(workRoot, outDir, 'Output directory')
    await mkdir(outDir, { recursive: true })
    const archivePath = join(outDir, spec.expectedPayloadArchiveName)
    const standaloneManifestPath = join(outDir, CANDIDATE_MANIFEST_FILE)
    const standaloneAssetSumsPath = join(outDir, ASSET_SHA256SUMS_FILE)
    await writeFile(archivePath, archive)
    await writeFile(standaloneManifestPath, manifestBytes)
    await writeFile(standaloneAssetSumsPath, assetSumsBytes)

    const manifestSha256 = createHash('sha256').update(manifestBytes).digest('hex')
    const assetSumsSha256 = createHash('sha256').update(assetSumsBytes).digest('hex')

    const releaseSums =
      `${archiveSha256}  ${spec.expectedPayloadArchiveName}\n` +
      `${manifestSha256}  ${CANDIDATE_MANIFEST_FILE}\n` +
      `${assetSumsSha256}  ${ASSET_SHA256SUMS_FILE}\n`
    const releaseSumsPath = join(outDir, RELEASE_SHA256SUMS_FILE)
    await writeFile(releaseSumsPath, releaseSums, 'utf8')
    const releaseSumsSha256 = createHash('sha256').update(releaseSums).digest('hex')

    return {
      candidateId: derivedId,
      candidateManifestSha256: manifestSha256,
      assetSumsSha256,
      releaseSumsSha256,
      archive: {
        path: archivePath,
        bytes: archive.length,
        sha256: archiveSha256,
        fileName: spec.expectedPayloadArchiveName,
      },
      standalone: {
        manifestPath: standaloneManifestPath,
        assetSumsPath: standaloneAssetSumsPath,
        releaseSumsPath,
      },
      stagingDir,
      outDir,
      assets,
      totalRuntimeBytes: assets.reduce((sum, asset) => sum + asset.bytes, 0),
    }
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

// Builds twice into separate fresh directories with the same inputs and
// asserts byte-identical release assets and a matching archive hash.
export async function runDeterministicDoubleAssembly(options) {
  const first = await assemble(options)
  const second = await assemble(options)
  const comparisons = {}

  for (const key of ['candidateId', 'candidateManifestSha256', 'assetSumsSha256']) {
    if (first[key] !== second[key]) {
      throw new PackError(`determinism failure: ${key} differs between runs`)
    }
    comparisons[key] = first[key]
  }

  const firstArchive = await readFile(first.archive.path)
  const secondArchive = await readFile(second.archive.path)
  if (
    firstArchive.length !== secondArchive.length ||
    firstArchive.equals(secondArchive) === false
  ) {
    throw new PackError('determinism failure: archive bytes differ between runs')
  }
  comparisons.archiveBytes = firstArchive.length

  const standaloneFileKey = (name) =>
    name === CANDIDATE_MANIFEST_FILE
      ? 'manifestPath'
      : name === ASSET_SHA256SUMS_FILE
        ? 'assetSumsPath'
        : 'releaseSumsPath'
  for (const name of [
    CANDIDATE_MANIFEST_FILE,
    ASSET_SHA256SUMS_FILE,
    RELEASE_SHA256SUMS_FILE,
  ]) {
    const firstBytes = await readFile(first.standalone[standaloneFileKey(name)])
    const secondBytes = await readFile(second.standalone[standaloneFileKey(name)])
    if (
      firstBytes.length !== secondBytes.length ||
      firstBytes.equals(secondBytes) === false
    ) {
      throw new PackError(`determinism failure: ${name} differs between runs`)
    }
  }

  return { candidateId: first.candidateId, first, second, comparisons }
}
