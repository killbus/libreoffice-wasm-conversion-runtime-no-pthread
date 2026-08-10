import { cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import {
  shouldRunSemanticPackageJobs,
  SEMANTIC_PACKAGE_RELEASE_GUARD_EXPRESSION,
} from '../../scripts/release-runtime/lib/workflow-decision.mjs'

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../../..')
const execFileAsync = promisify(execFile)

describe('workflow release-trigger decision', () => {
  it('allows deliberate manual dispatch', () => {
    expect(
      shouldRunSemanticPackageJobs({ eventName: 'workflow_dispatch', tag: '' })
    ).toBe(true)
    expect(
      shouldRunSemanticPackageJobs({ eventName: 'workflow_dispatch', tag: 'v2.7.3' })
    ).toBe(true)
    expect(
      shouldRunSemanticPackageJobs({
        eventName: 'workflow_dispatch',
        tag: 'runtime-artifact-abc',
      })
    ).toBe(true)
  })

  it('allows strict semantic package release tags (prd R4 decision matrix)', () => {
    expect(shouldRunSemanticPackageJobs({ eventName: 'release', tag: 'v2.7.3' })).toBe(true)
    expect(shouldRunSemanticPackageJobs({ eventName: 'release', tag: 'v2.7.3-alpha.1' })).toBe(true)
    expect(shouldRunSemanticPackageJobs({ eventName: 'release', tag: 'v10.20.30' })).toBe(true)
    expect(shouldRunSemanticPackageJobs({ eventName: 'release', tag: 'v2.7.3+build.5' })).toBe(true)
  })

  it('denies runtime-artifact tags from semantic release jobs', () => {
    expect(
      shouldRunSemanticPackageJobs({
        eventName: 'release',
        tag: 'runtime-artifact-21fcdfd7e9f49efc08c6ba56c13337cc0be59a9b496f5424adbe57e0fb4a6e7b',
      })
    ).toBe(false)
    expect(
      shouldRunSemanticPackageJobs({ eventName: 'release', tag: 'runtime-latest' })
    ).toBe(false)
  })

  it('denies empty, undefined, and malformed release tags (acceptance probe matrix)', () => {
    expect(shouldRunSemanticPackageJobs({ eventName: 'release', tag: '' })).toBe(false)
    expect(shouldRunSemanticPackageJobs({ eventName: 'release', tag: undefined })).toBe(false)
    expect(shouldRunSemanticPackageJobs({ eventName: 'release', tag: 'v' })).toBe(false)
    expect(shouldRunSemanticPackageJobs({ eventName: 'release', tag: 'v1' })).toBe(false)
    expect(shouldRunSemanticPackageJobs({ eventName: 'release', tag: '2.7.3' })).toBe(false)
    expect(shouldRunSemanticPackageJobs({ eventName: 'release', tag: 'branch-x' })).toBe(false)
    // The exact malformed tags the acceptance probe flagged as allowed: they
    // must now all be denied under the strict v<semver> allow-list.
    expect(shouldRunSemanticPackageJobs({ eventName: 'release', tag: 'vfoo.bar' })).toBe(false)
    expect(shouldRunSemanticPackageJobs({ eventName: 'release', tag: 'v1.x' })).toBe(false)
    expect(shouldRunSemanticPackageJobs({ eventName: 'release', tag: 'v1..2' })).toBe(false)
    expect(shouldRunSemanticPackageJobs({ eventName: 'release', tag: 'v1.2' })).toBe(false)
  })

  it('denies a semver-looking tag that is still malformed', () => {
    expect(shouldRunSemanticPackageJobs({ eventName: 'release', tag: 'v2.7' })).toBe(false)
    expect(shouldRunSemanticPackageJobs({ eventName: 'release', tag: 'v02.7.3' })).toBe(false)
    expect(shouldRunSemanticPackageJobs({ eventName: 'release', tag: 'v2.7.03' })).toBe(false)
    expect(shouldRunSemanticPackageJobs({ eventName: 'release', tag: 'v2.7.3bad' })).toBe(false)
  })

  it('denies all non-release, non-dispatch events', () => {
    expect(shouldRunSemanticPackageJobs({ eventName: 'push', tag: 'v2.7.3' })).toBe(false)
    expect(shouldRunSemanticPackageJobs({ eventName: 'pull_request', tag: '' })).toBe(false)
    expect(shouldRunSemanticPackageJobs({ eventName: 'release', tag: null })).toBe(false)
  })
})

describe('workflow guards are present on the checked-in workflows', () => {
  const guarded = [
    { file: '.github/workflows/pages.yml', job: 'build:' },
    { file: '.github/workflows/font-bundles.yml', job: 'build-font-bundles:' },
  ]

  for (const { file, job } of guarded) {
    it(`${file} guards its release-triggered job`, async () => {
      const content = await readFile(resolve(REPO_ROOT, file), 'utf8')
      const lines = content.split('\n')
      const jobIndex = lines.findIndex(
        (line) => line.trim() === job && !line.trim().startsWith('#')
      )
      expect(jobIndex, `${file} must contain job ${job}`).toBeGreaterThan(-1)
      // The job-level `if:` immediately follows the job declaration (the
      // comment above it may also mention `if:`, so match the real expression).
      const guardLine = lines
        .slice(jobIndex + 1)
        .find((line) => line.includes('if: ${{'))
      expect(guardLine, `${file} must have a job-level if guard`).toBeTruthy()
      expect(guardLine).toContain('workflow_dispatch')
      expect(guardLine).toContain('release.tag_name, \'v\'')
      expect(guardLine).toContain('release.tag_name, \'.\'')
      expect(guardLine).toContain('release.tag_name, \'runtime\'')
      expect(guardLine).toContain(SEMANTIC_PACKAGE_RELEASE_GUARD_EXPRESSION)
      const checkoutIndex = content.indexOf('uses: actions/checkout@')
      const guardIndex = content.indexOf(
        'run: node scripts/release-runtime/guard-release-tag.mjs'
      )
      expect(checkoutIndex, `${file} must check out the repository`).toBeGreaterThan(-1)
      expect(guardIndex, `${file} must execute the strict guard`).toBeGreaterThan(
        checkoutIndex
      )
      expect(content).toContain('Enforce strict semantic-version release tag')
    })
  }

  it('the checked-in guard expression equals the tested decision semantics', () => {
    // Both the workflow files and the executable oracle must describe the same
    // policy: dispatch allowed; release allowed only for strict v<semver> tags
    // outside the runtime namespace (fail-closed via guard-release-tag.mjs).
    expect(SEMANTIC_PACKAGE_RELEASE_GUARD_EXPRESSION).toContain(
      "github.event_name == 'workflow_dispatch'"
    )
    expect(SEMANTIC_PACKAGE_RELEASE_GUARD_EXPRESSION).toContain(
      "github.event_name == 'release'"
    )
  })

  it('workflow_dispatch remains reachable intentionally (manual operator input)', async () => {
    for (const file of ['.github/workflows/pages.yml', '.github/workflows/font-bundles.yml']) {
      const content = await readFile(resolve(REPO_ROOT, file), 'utf8')
      expect(content.match(/^  workflow_dispatch:$/m)).toBeTruthy()
    }
  })

  it('the fail-closed guard step runs the manifest oracle executable', async () => {
    const executable = await readFile(
      resolve(REPO_ROOT, 'scripts/release-runtime/guard-release-tag.mjs'),
      'utf8'
    )
    expect(executable).toContain('shouldRunSemanticPackageJobs')
    expect(executable).toContain('process.exit(1)')
  })

  it('a clean runner can execute the guard after checkout materializes it', async () => {
    const runnerRoot = await mkdtemp(join(tmpdir(), 'lo-workflow-guard-'))
    try {
      await cp(
        resolve(REPO_ROOT, 'scripts/release-runtime'),
        resolve(runnerRoot, 'scripts/release-runtime'),
        { recursive: true }
      )
      const { stdout } = await execFileAsync(
        process.execPath,
        ['scripts/release-runtime/guard-release-tag.mjs', 'release', 'v2.7.3'],
        { cwd: runnerRoot }
      )
      expect(stdout).toContain('allowed')
    } finally {
      await rm(runnerRoot, { recursive: true, force: true }).catch(() => {})
    }
  })
})
