#!/usr/bin/env node
// stage-draft.mjs — controlled draft-release automation (implement.md §4).
//
// Flow:
//   1. deterministic double assembly + archive verification (no native build);
//   2. fail-closed existence check for the runtime tag;
//   3. gh release create (DRAFT) with each payload/control asset uploaded
//      exactly once inside the create call (never --clobber, never
//      delete-and-reupload);
//   4. record release id/url/asset ids in a machine-readable STAGING-REPORT;
//   5. upload STAGING-REPORT.json once (plain, fails if it already exists);
//   6. preflight: download the draft through GitHub into a fresh path and
//      re-verify the downloaded archive against the frozen spec.
//
// Usage:
//   node scripts/release-runtime/stage-draft.mjs \
//     --native-root <dir> \
//     --wrapper-root <dir> \
//     --work-root <dir> \
//     --repo <owner/repo> \
//     --target <commit> \
//     [--spec <file>] \
//     [--expected-candidate-id <hex>] \
//     [--dry-run]

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseOptions, CliUsageError } from './lib/cli.mjs'
import { runGh } from './lib/gh.mjs'
import { runDeterministicDoubleAssembly } from './lib/packager.mjs'
import { verifyArchive, verifyCandidateManifestFile } from './lib/verifier.mjs'
import { validateFrozenSpec, validateStagingReport } from './lib/schemata.mjs'
import { serializePrettyJson } from './lib/canonical.mjs'
import {
  CANDIDATE_MANIFEST_FILE,
  ASSET_SHA256SUMS_FILE,
  RELEASE_SHA256SUMS_FILE,
  STAGING_REPORT_FILE,
  RUNTIME_TAG_PREFIX,
} from './lib/constants.mjs'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const DEFAULT_SPEC = join(SCRIPT_DIR, 'candidate-spec.json')

const USAGE = `Usage:
  node scripts/release-runtime/stage-draft.mjs \\
    --native-root <dir> \\
    --wrapper-root <dir> \\
    --work-root <dir> \\
    --repo <owner/repo> \\
    --target <commit> \\
    [--spec <file>] \\
    [--expected-candidate-id <hex>] \\
    [--dry-run]`

const FLAGS = new Set([
  'native-root',
  'wrapper-root',
  'work-root',
  'repo',
  'target',
  'spec',
  'expected-candidate-id',
  'dry-run',
])

function buildReleaseNotes({ candidateId, provenance, runtime, assets, archiveSha256, archiveName, manifestSha256, assetSumsSha256, tagName, target }) {
  const assetLines = assets
    .map((asset) => `- \`${asset.path}\` — ${asset.bytes} bytes, \`${asset.sha256}\``)
    .join('\n')
  return [
    `# LibreOffice WASM runtime artifact (UNQUALIFIED DRAFT)`,
    ``,
    `This is a **draft** release of the frozen LibreOffice WASM runtime candidate.`,
    `It is awaiting the independent acceptance check and has not been marked`,
    `release-qualified. It must not be promoted until the acceptance receipt passes.`,
    ``,
    `## Candidate identity`,
    ``,
    `- Candidate ID: \`${candidateId}\``,
    `- Runtime tag: \`${tagName}\``,
    `- Target commit: \`${target}\``,
    ``,
    `| Field | Value |`,
    `|---|---|`,
    `| Native commit | \`${provenance.native.commit}\` |`,
    `| Native GHA run | \`${provenance.native.githubActionsRunId}\` |`,
    `| Native ABI | \`${provenance.native.abi}\` |`,
    `| Native schema | \`${provenance.native.schemaVersion}\` |`,
    `| Wrapper commit | \`${provenance.wrapper.commit}\` |`,
    `| Pthread mode | \`${runtime.pthreadWorkerMode}\` |`,
    `| External worker | \`${runtime.externalWorker}\` |`,
    ``,
    `## Payload archive`,
    ``,
    `- \`${archiveName}\` — ${archiveSha256}`,
    `- \`${CANDIDATE_MANIFEST_FILE}\` — \`${manifestSha256}\``,
    `- \`${ASSET_SHA256SUMS_FILE}\` — \`${assetSumsSha256}\``,
    ``,
    `## Runtime assets`,
    ``,
    assetLines,
    ``,
    `No \`soffice.worker.js\` is present; this candidate uses \`main-script\` pthread`,
    `mode with an \`null\` external worker.`,
    ``,
    `## Known disclosure`,
    ``,
    `One isolated 180-second native-ABI cold-start timeout was previously observed`,
    `during validation of this exact byte set. It did not reproduce on an immediate`,
    `clean rerun. Independent acceptance therefore requires at least five`,
    `consecutive retry-free fresh-browser cold-start conversions; any timeout must`,
    `fail acceptance and be surfaced, not hidden by retrying.`,
    ``,
    `## No-build guarantee`,
    ``,
    `Staging this draft triggers no LibreOffice/WASM build. The payload is the`,
    `frozen run \`31211473147\` native bytes plus wrapper \`${provenance.wrapper.commit}\` output.`,
  ].join('\n')
}

async function checkTagDoesNotExist(repo, tag, dryRun) {
  try {
    await runGh(['api', `repos/${repo}/releases/tags/${tag}`, '--jq', '.id'])
    throw new Error(
      `release/tag ${tag} already exists; refusing to clobber or recreate`
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('Not Found')) {
      return
    }
    if (message.includes('already exists')) {
      throw error
    }
    throw new Error(`could not confirm release tag absence: ${message}`)
  }
}

async function main(argv) {
  const args = parseOptions(argv, FLAGS, USAGE)
  const dryRun = args['dry-run'] === 'true' || args['dry-run'] === '1'
  const repo = args.repo
  const target = args.target
  const specRaw = JSON.parse(
    await readFile(resolve(args.spec ?? DEFAULT_SPEC), 'utf8')
  )
  const spec = validateFrozenSpec(specRaw)
  const expectedCandidateId = args['expected-candidate-id'] ?? spec.candidateId
  const workRoot = resolve(args['work-root'])
  await mkdir(workRoot, { recursive: true })

  const tagName = `${RUNTIME_TAG_PREFIX}${expectedCandidateId}`

  process.stdout.write(
    JSON.stringify({ stage: 'assembly', dryRun }, null, 2) + '\n'
  )
  const result = await runDeterministicDoubleAssembly({
    nativeRoot: args['native-root'],
    wrapperRoot: args['wrapper-root'],
    workRoot,
    spec,
    expectedCandidateId,
  })

  const verifyRoot = join(workRoot, `verify-${Date.now()}`)
  await mkdir(verifyRoot, { recursive: true })
  const verification = await verifyArchive({
    archivePath: result.first.archive.path,
    spec,
    extractRoot: verifyRoot,
    expectedCandidateId,
  })

  const notesText = buildReleaseNotes({
    candidateId: result.candidateId,
    provenance: spec.provenance,
    runtime: spec.runtime,
    assets: result.first.assets,
    archiveSha256: result.first.archive.sha256,
    archiveName: result.first.archive.fileName,
    manifestSha256: result.first.candidateManifestSha256,
    assetSumsSha256: result.first.assetSumsSha256,
    tagName,
    target,
  })
  const notesPath = join(workRoot, 'release-notes.md')
  await writeFile(notesPath, notesText, 'utf8')

  if (dryRun) {
    process.stdout.write(
      `[stage-draft] DRY RUN. Would create draft release:\n  ` +
        `gh release create ${tagName} --draft --repo ${repo} --target ${target} ` +
        `--title "LibreOffice runtime artifact ${result.candidateId}" --notes-file ${notesPath} ` +
        `${result.first.archive.path} ${result.first.standalone.manifestPath} ` +
        `${result.first.standalone.assetSumsPath} ${result.first.standalone.releaseSumsPath}\n`
    )
    return
  }

  // Fail closed if the tag or a prior release with these bytes exists.
  await checkTagDoesNotExist(repo, tagName, dryRun)

  // Create the DRAFT and upload every payload/control asset exactly once inside
  // the create call. No --clobber exists on this command.
  const assetsToUpload = [
    result.first.archive.path,
    result.first.standalone.manifestPath,
    result.first.standalone.assetSumsPath,
    result.first.standalone.releaseSumsPath,
  ]
  await runGh([
    'release',
    'create',
    tagName,
    '--draft',
    '--repo',
    repo,
    '--target',
    target,
    '--title',
    `LibreOffice runtime artifact ${result.candidateId}`,
    '--notes-file',
    notesPath,
    ...assetsToUpload,
  ])

  const release = await runGh([
    'api',
    `repos/${repo}/releases/tags/${tagName}`,
    '--jq',
    '{id, html_url, tag_name, target_commitish, created_at, draft, name, body, assets: [.assets[] | {id, name, contentType: .content_type, size, created_at}]}',
  ])

  if (release.draft !== true) {
    throw new Error('release did not stay a draft')
  }

  const uploadedAssets = release.assets.map((asset) => {
    const local = [
      result.first.archive.path,
      result.first.standalone.manifestPath,
      result.first.standalone.assetSumsPath,
      result.first.standalone.releaseSumsPath,
    ].find((path) => join(path).split(/[\\/]/).pop() === asset.name)
    if (!local) {
      throw new Error(`could not pair uploaded asset id=${asset.id} name=${asset.name}`)
    }
    return { ...asset, localPath: local }
  })

  // Machine-readable staging report (unqualified).
  const stagingReport = {
    schemaVersion: 1,
    kind: 'libreoffice-wasm-runtime-staging-report',
    candidateId: result.candidateId,
    releaseQualified: false,
    tagName,
    targetCommit: target,
    releaseId: String(release.id),
    releaseUrl: release.html_url,
    releaseCreatedAt: release.created_at,
    candidateManifestSha256: result.first.candidateManifestSha256,
    assetSumsSha256: result.first.assetSumsSha256,
    releaseSumsSha256: result.first.releaseSumsSha256,
    payloadArchive: {
      name: result.first.archive.fileName,
      bytes: result.first.archive.bytes,
      sha256: result.first.archive.sha256,
    },
    deterministicDoubleAssembly: {
      byteIdentical: true,
      archiveSha256Matches: true,
      archiveBytes: result.first.archive.bytes,
      run1: {
        candidateManifestSha256: result.first.candidateManifestSha256,
        assetSumsSha256: result.first.assetSumsSha256,
        archiveSha256: result.first.archive.sha256,
      },
      run2: {
        candidateManifestSha256: result.second.candidateManifestSha256,
        assetSumsSha256: result.second.assetSumsSha256,
        archiveSha256: result.second.archive.sha256,
      },
    },
    provenance: spec.provenance,
    runtime: spec.runtime,
    assets: uploadedAssets.map((asset) => ({
      name: asset.name,
      assetId: String(asset.id),
      contentType: asset.contentType,
      bytes: asset.size,
      sha256: asset.digest ?? '',
    })),
    stagingReportFile: STAGING_REPORT_FILE,
    noNativeBuild: {
      triggered: false,
      notes:
        'No LibreOffice/WASM build workflow was run or could be triggered by this staging path.',
      lastKnownNativeRunId: spec.provenance.native.githubActionsRunId,
    },
    knownColdStartTimeout: {
      disclosure:
        'One isolated 180-second native-ABI cold-start timeout was previously observed against this exact byte set; it did not reproduce on an immediate clean rerun.',
      acceptanceRequirement:
        'At least five consecutive retry-free fresh-browser cold-start conversions must pass; any timeout surfaces as a failure.',
    },
  }

  // Pair GitHub asset IDs with the local byte hashes (API content size only).
  const localHashes = {}
  for (const asset of uploadedAssets) {
    localHashes[asset.name] = await computeFileSha256(asset.localPath)
  }
  stagingReport.assets.forEach((assetRow) => {
    assetRow.sha256 = localHashes[assetRow.name] ?? ''
  })

  validateStagingReport(stagingReport)
  const stagingReportBytes = Buffer.from(serializePrettyJson(stagingReport), 'utf8')
  const stagingReportPath = join(workRoot, STAGING_REPORT_FILE)
  await writeFile(stagingReportPath, stagingReportBytes, 'utf8')

  // Upload the staging report exactly once (no --clobber; fails if it exists).
  await runGh(['release', 'upload', tagName, '--repo', repo, stagingReportPath])

  const releaseAfter = await runGh([
    'api',
    `repos/${repo}/releases/tags/${tagName}`,
    '--jq',
    '(.assets | map({id, name, contentType: .content_type, size}))',
  ])
  const reportAsset = releaseAfter.find((asset) => asset.name === STAGING_REPORT_FILE)
  if (!reportAsset) {
    throw new Error('staging report upload did not produce a release asset')
  }

  // Post-create / post-upload verification of reported sizes.
  for (const assetRow of stagingReport.assets) {
    const reported = releaseAfter.find((asset) => asset.name === assetRow.name)
    if (!reported || reported.size !== assetRow.bytes) {
      throw new Error(
        `size mismatch for uploaded asset ${assetRow.name}: ` +
          `reported ${assetRow.bytes}, GitHub ${reported?.size ?? 'missing'}`
      )
    }
  }

  // --- Record the report's own asset id only in the handoff, not inside the
  // report bytes, so the uploaded report never needs a mutable rewrite. ------

  const preflightRoot = join(workRoot, 'preflight-download')
  await mkdir(preflightRoot, { recursive: true })
  await runGh(['release', 'download', tagName, '--repo', repo, '--dir', preflightRoot])

  const downloadedArchivePath = join(preflightRoot, result.first.archive.fileName)
  const downloadVerifyRoot = join(preflightRoot, 'verify')
  await mkdir(downloadVerifyRoot, { recursive: true })
  const downloadedVerification = await verifyArchive({
    archivePath: downloadedArchivePath,
    spec,
    extractRoot: downloadVerifyRoot,
    expectedCandidateId,
  })
  const downloadedManifestCheck = await verifyCandidateManifestFile(
    join(preflightRoot, CANDIDATE_MANIFEST_FILE),
    spec
  )

  const handoff = {
    stage: 'draft-created',
    releaseId: String(release.id),
    releaseUrl: release.html_url,
    tag: tagName,
    targetCommit: target,
    candidateId: result.candidateId,
    archiveSha256: result.first.archive.sha256,
    archiveName: result.first.archive.fileName,
    draftStillDraft: release.draft === true,
    assets: stagingReport.assets.map(({ name, assetId, contentType, bytes, sha256 }) => ({
      name,
      assetId,
      contentType,
      bytes,
      sha256,
    })),
    stagingReportAssetId: String(reportAsset.id),
    deterministicDoubleAssembly: 'pass',
    verifier: 'verified downloaded bytes',
    downloadedArchiveSha256: downloadedVerification.archiveSha256,
    downloadedManifestSha256: downloadedManifestCheck.sha256,
    updatedAfter: stagingReport.releaseCreatedAt,
  }

  const handoffText = serializePrettyJson(handoff)
  await writeFile(join(workRoot, 'HANDOFF.json'), handoffText, 'utf8')
  process.stdout.write(handoffText)
}

async function computeFileSha256(filePath) {
  const { createHash } = await import('node:crypto')
  const { createReadStream } = await import('node:fs')
  const hash = createHash('sha256')
  await new Promise((resolvePromise, reject) => {
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', resolvePromise)
  })
  return hash.digest('hex')
}

const isCli =
  process.argv[1] &&
  resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])

if (isCli) {
  if (process.argv.slice(2).includes('--help')) {
    console.log(USAGE)
    process.exit(0)
  }
  main(process.argv.slice(2)).catch((error) => {
    if (error instanceof CliUsageError) {
      console.log(error.message)
    } else {
      console.error(
        `[stage-draft] ${error instanceof Error ? error.message : String(error)}`
      )
    }
    process.exitCode = 1
  })
}