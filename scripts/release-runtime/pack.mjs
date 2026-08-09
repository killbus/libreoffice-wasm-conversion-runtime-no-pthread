#!/usr/bin/env node
// pack.mjs — deterministic double assembly of the frozen LibreOffice runtime
// candidate. Never builds LibreOffice/WASM; consumes explicit source roots.
//
// Usage:
//   node scripts/release-runtime/pack.mjs \
//     --native-root <dir> \
//     --wrapper-root <dir> \
//     --work-root <dir> \
//     [--spec <file>] \
//     [--expected-candidate-id <hex>]

import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseOptions, CliUsageError } from './lib/cli.mjs'
import { runDeterministicDoubleAssembly } from './lib/packager.mjs'
import { verifyArchive } from './lib/verifier.mjs'
import { validateFrozenSpec } from './lib/schemata.mjs'
import { serializePrettyJson } from './lib/canonical.mjs'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const DEFAULT_SPEC = join(SCRIPT_DIR, 'candidate-spec.json')

const USAGE = `Usage:
  node scripts/release-runtime/pack.mjs \\
    --native-root <dir> \\
    --wrapper-root <dir> \\
    --work-root <dir> \\
    [--spec <file>] \\
    [--expected-candidate-id <hex>]`

const FLAGS = new Set([
  'native-root',
  'wrapper-root',
  'work-root',
  'spec',
  'expected-candidate-id',
])

async function main(argv) {
  const args = parseOptions(argv, FLAGS, USAGE)
  const specRaw = JSON.parse(
    await readFile(resolve(args.spec ?? DEFAULT_SPEC), 'utf8')
  )
  const spec = validateFrozenSpec(specRaw)
  const workRoot = resolve(args['work-root'])
  await mkdir(workRoot, { recursive: true })

  const result = await runDeterministicDoubleAssembly({
    nativeRoot: args['native-root'],
    wrapperRoot: args['wrapper-root'],
    workRoot,
    spec,
    expectedCandidateId: args['expected-candidate-id'] ?? spec.candidateId,
  })

  // Preflight verification against the first-output archive.
  const verifyRoot = join(workRoot, `verify-${Date.now()}`)
  await mkdir(verifyRoot, { recursive: true })
  const verification = await verifyArchive({
    archivePath: result.first.archive.path,
    spec,
    extractRoot: verifyRoot,
    expectedCandidateId: args['expected-candidate-id'] ?? spec.candidateId,
  })

  const report = {
    schemaVersion: 1,
    kind: 'libreoffice-wasm-runtime-assembly-report',
    candidateId: result.candidateId,
    comparisons: result.comparisons,
    run1: {
      archive: {
        fileName: result.first.archive.fileName,
        bytes: result.first.archive.bytes,
        sha256: result.first.archive.sha256,
      },
      candidateManifestSha256: result.first.candidateManifestSha256,
      assetSumsSha256: result.first.assetSumsSha256,
      releaseSumsSha256: result.first.releaseSumsSha256,
      stagingDir: result.first.stagingDir,
      outDir: result.first.outDir,
    },
    run2: {
      archive: {
        fileName: result.second.archive.fileName,
        bytes: result.second.archive.bytes,
        sha256: result.second.archive.sha256,
      },
      candidateManifestSha256: result.second.candidateManifestSha256,
      assetSumsSha256: result.second.assetSumsSha256,
      releaseSumsSha256: result.second.releaseSumsSha256,
      stagingDir: result.second.stagingDir,
      outDir: result.second.outDir,
    },
    byteIdentical: true,
    verification: {
      candidateId: verification.candidateId,
      archiveSha256: verification.archiveSha256,
      archiveBytes: verification.archiveBytes,
      extractedRuntimeAssets: verification.runtimeAssets,
    },
    expectedCandidateId: args['expected-candidate-id'] ?? spec.candidateId,
  }

  const reportPath = join(workRoot, 'ASSEMBLY-REPORT.json')
  await writeFile(reportPath, serializePrettyJson(report), 'utf8')

  process.stdout.write(
    JSON.stringify(
      {
        candidateId: report.candidateId,
        archiveSha256: report.run1.archive.sha256,
        archiveBytes: report.run1.archive.bytes,
        byteIdentical: true,
        verification: 'passed',
        reportPath,
        archivePath: result.first.archive.path,
        standaloneManifest: result.first.standalone.manifestPath,
      },
      null,
      2
    ) + '\n'
  )
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
        `[pack] ${error instanceof Error ? error.message : String(error)}`
      )
    }
    process.exitCode = 1
  })
}