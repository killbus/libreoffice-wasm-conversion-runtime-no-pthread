// Fail-closed archive verifier. Inspects the complete central directory first,
// extracts only into a fresh safe root, then recomputes every runtime byte hash
// and the candidate identity against the frozen spec (the external trust
// anchor). It never trusts SHA256SUMS carried inside the archive.

import { createHash } from 'node:crypto'
import { inspectNoPthreadRuntime } from '../../inspect-no-pthread-runtime.mjs'
import { mkdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  CANDIDATE_MANIFEST_FILE,
  ASSET_SHA256SUMS_FILE,
  isForbiddenWorkerPath,
  RUNTIME_TAG_PREFIX,
} from './constants.mjs'
import {
  deriveCandidateIdentity,
  serializePrettyJson,
} from './canonical.mjs'
import { validateFrozenSpec, validateCandidateManifest } from './schemata.mjs'
import {
  extractZip,
  readCentralDirectory,
  readEndOfCentralDirectory,
} from './zip-reader.mjs'

export class VerifyError extends Error {}

async function parseJson(buffer, label) {
  try {
    return JSON.parse(buffer.toString('utf8'))
  } catch (error) {
    throw new VerifyError(`failed to parse ${label}: ${error.message}`)
  }
}

function normalizeEntrySet(files) {
  return files.map(({ name }) => name).sort()
}

// Verifies one payload archive against the frozen spec. Extracts into a fresh
// directory under extractRoot (expected to be newly created) and returns a
// machine-readable verification report. Throws on any drift.
export async function verifyArchive(options) {
  const spec = validateFrozenSpec(options.spec)
  const archiveBuffer = await readFile(options.archivePath)

  // 1. Central-directory preflight (path safety, dup/case-fold, methods,
  //    regular files). This throws before anything is extracted.
  const eocd = readEndOfCentralDirectory(archiveBuffer)
  const centralEntries = readCentralDirectory(archiveBuffer, eocd)

  // 2. Extract into a fresh safe root (empty expected).
  const extractRoot = resolve(options.extractRoot)
  await mkdir(extractRoot, { recursive: true })
  const extracted = await extractZip(archiveBuffer, extractRoot)
  const extractedPaths = normalizeEntrySet(extracted)

  // 3. Control files must be present exactly once.
  const manifestFile = extracted.find(
    ({ name }) => name === CANDIDATE_MANIFEST_FILE
  )
  const assetSumsFile = extracted.find(
    ({ name }) => name === ASSET_SHA256SUMS_FILE
  )
  if (!manifestFile || !assetSumsFile) {
    throw new VerifyError('archive is missing required control files')
  }

  const manifest = validateCandidateManifest(
    await parseJson(manifestFile.bytes, CANDIDATE_MANIFEST_FILE)
  )

  // 4. No worker (bare or under any directory), and the exact inventory.
  if (extractedPaths.some(isForbiddenWorkerPath)) {
    throw new VerifyError('archive contains a forbidden standalone worker')
  }
  const expectedInventory = new Set([
    ...manifest.assets.map((asset) => asset.path),
    CANDIDATE_MANIFEST_FILE,
    ASSET_SHA256SUMS_FILE,
  ])
  const missing = [...expectedInventory].filter(
    (path) => !extractedPaths.includes(path)
  )
  const extra = extractedPaths.filter((path) => !expectedInventory.has(path))
  if (missing.length > 0 || extra.length > 0) {
    throw new VerifyError(
      `extracted inventory drift (missing ${missing.join(', ')}; extra ${extra.join(', ')})`
    )
  }

  // 5. Recompute every runtime byte hash and size; compare to the manifest and
  //    the frozen spec (external anchor).
  const assetByName = new Map(manifest.assets.map((asset) => [asset.path, asset]))
  const specByPath = new Map(spec.assets.map((asset) => [asset.path, asset]))
  const recomputed = []
  for (const entry of extracted) {
    if (entry.name === CANDIDATE_MANIFEST_FILE || entry.name === ASSET_SHA256SUMS_FILE) {
      continue
    }
    const manifestAsset = assetByName.get(entry.name)
    const specAsset = specByPath.get(entry.name)
    if (!manifestAsset || !specAsset) {
      throw new VerifyError(`runtime asset not declared in the frozen spec: ${entry.name}`)
    }
    const sha256 = createHash('sha256').update(entry.bytes).digest('hex')
    if (
      entry.bytes.length !== manifestAsset.bytes ||
      entry.bytes.length !== specAsset.bytes ||
      sha256 !== manifestAsset.sha256 ||
      sha256 !== specAsset.sha256
    ) {
      throw new VerifyError(
        `runtime asset drift for ${entry.name}: expected ` +
          `${specAsset.bytes}/${specAsset.sha256}, got ${entry.bytes.length}/${sha256}`
      )
    }
    recomputed.push({ path: entry.name, bytes: entry.bytes.length, sha256 })
  }

  // 6. Identity/provenance drift checks.
  const derivedId = deriveCandidateIdentity({
    provenance: manifest.provenance,
    runtime: manifest.runtime,
    assets: manifest.assets,
  })
  if (
    derivedId !== manifest.candidateId ||
    manifest.candidateId !== spec.candidateId ||
    manifest.candidateId !== options.expectedCandidateId
  ) {
    throw new VerifyError(
      `candidate-ID drift: manifest=${manifest.candidateId} derived=${derivedId} ` +
        `spec=${spec.candidateId} expected=${options.expectedCandidateId}`
    )
  }
  if (
    manifest.provenance.native.commit !== spec.provenance.native.commit ||
    manifest.provenance.native.githubActionsRunId !==
      spec.provenance.native.githubActionsRunId ||
    manifest.provenance.wrapper.commit !== spec.provenance.wrapper.commit ||
    manifest.provenance.native.abi !== spec.provenance.native.abi ||
    manifest.provenance.native.schemaVersion !== spec.provenance.native.schemaVersion
  ) {
    throw new VerifyError('provenance drift between manifest and frozen spec')
  }
  if (JSON.stringify(manifest.runtime) !== JSON.stringify(spec.runtime)) {
    throw new VerifyError('runtime metadata drift between manifest and spec')
  }

  await inspectNoPthreadRuntime(join(extractRoot, 'wasm'))

  // 7. Recompute ASSET-SHA256SUMS from the verified manifest table.
  const expectedSums = `${manifest.assets
    .map((asset) => `${asset.sha256}  ${asset.path}`)
    .join('\n')}\n`
  if (assetSumsFile.bytes.toString('utf8') !== expectedSums) {
    throw new VerifyError('ASSET-SHA256SUMS does not match the verified asset table')
  }

  const manifestSha256 = createHash('sha256')
    .update(manifestFile.bytes)
    .digest('hex')
  const archiveSha256 = createHash('sha256').update(archiveBuffer).digest('hex')
  const tagName = `${RUNTIME_TAG_PREFIX}${spec.candidateId}`

  return {
    schemaVersion: 1,
    kind: 'libreoffice-wasm-runtime-verification-report',
    candidateId: spec.candidateId,
    archiveSha256,
    archiveBytes: archiveBuffer.length,
    candidateManifestSha256: manifestSha256,
    extractionRoot: extractRoot,
    tagName,
    abi: spec.provenance.native.abi,
    schemaVersion: spec.provenance.native.schemaVersion,
    threading: spec.runtime.threading,
    runtimeAssets: recomputed,
    expectedTag: tagName,
    evidence: {
      provenance: spec.provenance,
      runtime: spec.runtime,
    },
  }
}

// Verifies a *candidate manifest* document (standalone) is internally
// consistent and unqualified, without touching an archive.
export async function verifyCandidateManifestFile(manifestPath, spec) {
  const frozenSpec = validateFrozenSpec(spec)
  const raw = await readFile(manifestPath)
  const manifest = validateCandidateManifest(await parseJson(raw, 'candidate manifest'))
  const derivedId = deriveCandidateIdentity({
    provenance: manifest.provenance,
    runtime: manifest.runtime,
    assets: manifest.assets,
  })
  if (
    derivedId !== manifest.candidateId ||
    manifest.candidateId !== frozenSpec.candidateId
  ) {
    throw new VerifyError('standalone candidate manifest identity drift')
  }
  return {
    candidateId: manifest.candidateId,
    sha256: createHash('sha256').update(raw).digest('hex'),
  }
}

export function serializeReport(report) {
  return serializePrettyJson(report)
}
