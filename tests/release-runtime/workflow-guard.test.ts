import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  shouldRunSemanticPackageJobs,
  SEMANTIC_PACKAGE_RELEASE_GUARD_EXPRESSION,
} from '../../scripts/release-runtime/lib/workflow-decision.mjs'

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../../..')

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

  it('allows semantic package release tags (prd R4 decision matrix)', () => {
    expect(shouldRunSemanticPackageJobs({ eventName: 'release', tag: 'v2.7.3' })).toBe(true)
    expect(shouldRunSemanticPackageJobs({ eventName: 'release', tag: 'v2.7.3-alpha.1' })).toBe(true)
    expect(shouldRunSemanticPackageJobs({ eventName: 'release', tag: 'v10.20.30' })).toBe(true)
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

  it('denies empty and malformed release tags', () => {
    expect(shouldRunSemanticPackageJobs({ eventName: 'release', tag: '' })).toBe(false)
    expect(shouldRunSemanticPackageJobs({ eventName: 'release', tag: undefined })).toBe(false)
    expect(shouldRunSemanticPackageJobs({ eventName: 'release', tag: 'v' })).toBe(false)
    expect(shouldRunSemanticPackageJobs({ eventName: 'release', tag: 'v1' })).toBe(false)
    expect(shouldRunSemanticPackageJobs({ eventName: 'release', tag: '2.7.3' })).toBe(false)
    expect(shouldRunSemanticPackageJobs({ eventName: 'release', tag: 'branch-x' })).toBe(false)
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
      // The job-level `if:` immediately follows the job declaration.
      const guardLine = lines
        .slice(jobIndex + 1)
        .find((line) => line.includes(`if:`))
      expect(guardLine, `${file} must have a job-level if guard`).toBeTruthy()
      expect(guardLine).toContain('workflow_dispatch')
      expect(guardLine).toContain('release.tag_name, \'v\'')
      expect(guardLine).toContain('release.tag_name, \'.\'')
      expect(guardLine).toContain('release.tag_name, \'runtime\'')
      expect(guardLine).toContain(SEMANTIC_PACKAGE_RELEASE_GUARD_EXPRESSION)
    })
  }

  it('the checked-in guard expression equals the tested decision semantics', () => {
    // Both the workflow files and the executable oracle must describe the same
    // policy: dispatch allowed; release allowed only for v<semver>-like tags.
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
})