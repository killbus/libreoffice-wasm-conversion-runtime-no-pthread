import { writeFile, mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { parseOptions, CliUsageError } from '../../scripts/release-runtime/lib/cli.mjs'
import { runDeterministicDoubleAssembly } from '../../scripts/release-runtime/lib/packager.mjs'
import { validateFrozenSpec } from '../../scripts/release-runtime/lib/schemata.mjs'
import { makeSyntheticCandidate } from './helpers/synthetic-candidate.mjs'

const execFileAsync = promisify(execFile)
const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../../..')
const CLI = fileURLToPath(new URL('../../scripts/release-runtime/verify.mjs', import.meta.url))
const GUARD_CLI = fileURLToPath(
  new URL('../../scripts/release-runtime/guard-release-tag.mjs', import.meta.url)
)
const STAGE_DRAFT_CLI = fileURLToPath(
  new URL('../../scripts/release-runtime/stage-draft.mjs', import.meta.url)
)

describe('parseOptions CLI contract', () => {
  const USAGE = 'Usage: --required-x <v> [--optional-y <v>] [--bool-z]'

  it('requires mandatory flags and rejects missing ones', () => {
    expect(() =>
      parseOptions([], new Set(['required-x', 'optional-y', 'bool-z']), USAGE, {
        optional: ['optional-y'],
        bool: ['bool-z'],
      })
    ).toThrow(CliUsageError)
    expect(() =>
      parseOptions(['--required-x', 'v'], new Set(['required-x']), USAGE)
    ).not.toThrow()
  })

  it('provides undefined for absent optional flags (documented defaults apply)', () => {
    const values = parseOptions(
      ['--required-x', 'v'],
      new Set(['required-x', 'optional-y']),
      USAGE,
      { optional: ['optional-y'] }
    )
    expect(values['required-x']).toBe('v')
    expect(values['optional-y']).toBeUndefined()
  })

  it('records boolean flags by presence without a value', () => {
    const values = parseOptions(
      ['--required-x', 'v', '--bool-z'],
      new Set(['required-x', 'bool-z']),
      USAGE,
      { bool: ['bool-z'] }
    )
    expect(values['bool-z']).toBe(true)
  })

  it('rejects unknown, duplicate, and valueless options', () => {
    expect(() => parseOptions(['--nope', 'x'], new Set(['required-x']), USAGE)).toThrow(
      /Unknown option/
    )
    expect(() =>
      parseOptions(['--required-x', 'a', '--required-x', 'b'], new Set(['required-x']), USAGE)
    ).toThrow(/Duplicate option/)
    expect(() => parseOptions(['--required-x'], new Set(['required-x']), USAGE)).toThrow(
      /requires a value/
    )
  })

  it('--help surfaces the usage text as a CliUsageError', () => {
    expect(() => parseOptions(['--help'], new Set(['required-x']), USAGE)).toThrow(/Usage:/)
  })
})

describe('verify.mjs CLI contract (acceptance verifierCliContract)', () => {
  it('--help documents --report-out and marks --spec/--expected-candidate-id optional', async () => {
    const { stdout } = await execFileAsync(process.execPath, [CLI, '--help'])
    expect(stdout).toContain('--report-out <report.json>')
    expect(stdout).toContain('[--spec <file>]')
    expect(stdout).toContain('[--expected-candidate-id <hex>]')
    expect(stdout).not.toMatch(/--report-out <report\.json>.*\[/) // report-out stays required
  })

  it('accepts required flags while optional verifier flags are absent', async () => {
    const synth = await makeSyntheticCandidate()
    const workRoot = await mkdtemp(join(tmpdir(), 'lo-cli-verify-'))
    try {
      const spec = validateFrozenSpec(synth.spec)
      const specPath = join(workRoot, 'spec.json')
      await writeFile(specPath, JSON.stringify(spec), 'utf8')
      const result = await runDeterministicDoubleAssembly({
        nativeRoot: synth.nativeRoot,
        wrapperRoot: synth.wrapperRoot,
        workRoot,
        spec,
        expectedCandidateId: spec.candidateId,
      })
      const verifyRoot = join(workRoot, 'verify-root')
      const reportPath = join(workRoot, 'report.json')
      const { stdout } = await execFileAsync(process.execPath, [
        CLI,
        '--archive',
        result.first.archive.path,
        '--extract-root',
        verifyRoot,
        '--spec',
        specPath,
        '--report-out',
        reportPath,
      ])
      const report = JSON.parse(stdout)
      expect(report.candidateId).toBe(spec.candidateId)
      expect(report.kind).toBe('libreoffice-wasm-runtime-verification-report')
      expect(existsSync(reportPath)).toBe(true)
    } finally {
      await rm(workRoot, { recursive: true, force: true }).catch(() => {})
      await synth.dispose()
    }
  })

  it('fails closed when the required --report-out is missing, naming it', async () => {
    const synth = await makeSyntheticCandidate()
    const workRoot = await mkdtemp(join(tmpdir(), 'lo-cli-verify-noout-'))
    try {
      const spec = validateFrozenSpec(synth.spec)
      const specPath = join(workRoot, 'spec.json')
      await writeFile(specPath, JSON.stringify(spec), 'utf8')
      const result = await runDeterministicDoubleAssembly({
        nativeRoot: synth.nativeRoot,
        wrapperRoot: synth.wrapperRoot,
        workRoot,
        spec,
        expectedCandidateId: spec.candidateId,
      })
      const error = await execFileAsync(process.execPath, [
        CLI,
        '--archive',
        result.first.archive.path,
        '--extract-root',
        join(workRoot, 'verify-root'),
        '--spec',
        specPath,
      ]).then(
        () => null,
        (reason) => reason
      )
      expect(error).not.toBeNull()
      expect(String(error.stdout)).toMatch(/^Missing required option: --report-out\n/)
    } finally {
      await rm(workRoot, { recursive: true, force: true }).catch(() => {})
      await synth.dispose()
    }
  })
})

describe('guard-release-tag.mjs CLI contract', () => {
  it('allows strict semver and manual dispatch tags', async () => {
    const allowed = [
      ['release', 'v2.7.3'],
      ['release', 'v2.7.3-alpha.1'],
      ['release', 'v10.20.30+build.5'],
      ['workflow_dispatch', 'runtime-artifact-abc'],
    ]
    for (const [eventName, tag] of allowed) {
      await expect(
        execFileAsync(process.execPath, [GUARD_CLI, eventName, tag])
      ).resolves.toMatchObject({ stdout: /allowed/ })
    }
  })

  it('denies the acceptance malformed-tag probe matrix', async () => {
    const denied = [
      ['release', 'vfoo.bar'],
      ['release', 'v1.x'],
      ['release', 'v1..2'],
      ['release', 'v1.2'],
      ['release', 'v2.7.3bad'],
      ['release', 'runtime-artifact-x'],
      ['release', ''],
    ]
    for (const [eventName, tag] of denied) {
      await expect(
        execFileAsync(process.execPath, [GUARD_CLI, eventName, tag])
      ).rejects.toThrow()
    }
  })
})

describe('stage-draft.mjs CLI contract', () => {
  it('accepts the documented mandatory invocation without --dry-run', async () => {
    const workRoot = await mkdtemp(join(tmpdir(), 'lo-stage-draft-cli-'))
    try {
      const error = await execFileAsync(process.execPath, [
        STAGE_DRAFT_CLI,
        '--native-root',
        join(workRoot, 'missing-native'),
        '--wrapper-root',
        join(workRoot, 'missing-wrapper'),
        '--work-root',
        join(workRoot, 'work'),
        '--repo',
        'example/acceptance-probe',
        '--target',
        '0000000000000000000000000000000000000000',
      ]).then(
        () => null,
        (reason) => reason
      )

      expect(error).not.toBeNull()
      expect(`${error.stdout}${error.stderr}`).not.toContain('Missing required option: --dry-run')
    } finally {
      await rm(workRoot, { recursive: true, force: true }).catch(() => {})
    }
  })
})
