#!/usr/bin/env node
// verify.mjs — fail-closed archive verifier. Inspects the archive, extracts
// into a fresh root, and recomputes every hash/provenance/identity field
// against the frozen spec. This is exactly what the independent acceptance
// owner can run on a release downloaded through GitHub.
//
// Usage:
//   node scripts/release-runtime/verify.mjs \
//     --archive <payload.zip> \
//     --extract-root <fresh-dir> \
//     [--spec <file>] \
//     [--expected-candidate-id <hex>]

import { mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { parseOptions, CliUsageError } from './lib/cli.mjs'
import { verifyArchive } from './lib/verifier.mjs'
import { validateFrozenSpec } from './lib/schemata.mjs'
import { serializePrettyJson } from './lib/canonical.mjs'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const DEFAULT_SPEC = join(SCRIPT_DIR, 'candidate-spec.json')

const USAGE = `Usage:
  node scripts/release-runtime/verify.mjs \\
    --archive <payload.zip> \\
    --extract-root <fresh-dir> \\
    [--spec <file>] \\
    [--expected-candidate-id <hex>]`

const FLAGS = new Set([
  'archive',
  'extract-root',
  'spec',
  'expected-candidate-id',
  'report-out',
])

async function main(argv) {
  const args = parseOptions(argv, FLAGS, USAGE)
  const specRaw = JSON.parse(
    await readFile(resolve(args.spec ?? DEFAULT_SPEC), 'utf8')
  )
  const spec = validateFrozenSpec(specRaw)
  const extractRoot = resolve(args['extract-root'])
  await mkdir(extractRoot, { recursive: true })

  const report = await verifyArchive({
    archivePath: resolve(args.archive),
    spec,
    extractRoot,
    expectedCandidateId: args['expected-candidate-id'] ?? spec.candidateId,
  })

  if (args['report-out']) {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(resolve(args['report-out']), serializePrettyJson(report), 'utf8')
  }

  process.stdout.write(serializePrettyJson(report))
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
        `[verify] ${error instanceof Error ? error.message : String(error)}`
      )
    }
    process.exitCode = 1
  })
}