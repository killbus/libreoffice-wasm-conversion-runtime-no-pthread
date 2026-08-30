import { describe, expect, it } from 'vitest'
import {
  validateFrozenSpec,
  validateCandidateManifest,
  validateStagingReport,
  validateAcceptanceReceipt,
  validateReleaseManifest,
  SchemaError,
} from '../../scripts/release-runtime/lib/schemata.mjs'
import { makeSyntheticCandidate } from './helpers/synthetic-candidate.mjs'

async function withSynthetic(run) {
  const synth = await makeSyntheticCandidate()
  try {
    return await run(synth)
  } finally {
    await synth.dispose()
  }
}

describe('frozen spec schema negatives', () => {
  it('rejects a forbidden standalone worker in the asset set', async () => {
    await withSynthetic(async ({ spec }) => {
      const bad = {
        ...spec,
        assets: spec.assets.map((asset, index) =>
          index === 0
            ? { ...asset, path: 'nested/runtime/soffice.worker.js' }
            : asset
        ),
      }
      expect(() => validateFrozenSpec(bad)).toThrow(SchemaError)
      expect(() => validateFrozenSpec(bad)).toThrow(
        /frozen spec must not contain soffice\.worker\.js/
      )
    })
  })

  it('rejects a wrong asset count', async () => {
    await withSynthetic(async ({ spec }) => {
      expect(() => validateFrozenSpec({ ...spec, assets: spec.assets.slice(0, 7) })).toThrow(SchemaError)
    })
  })

  it('rejects malformed commits, run IDs, ABI, and bytes', async () => {
    await withSynthetic(async ({ spec }) => {
      expect(() =>
        validateFrozenSpec({
          ...spec,
          provenance: { ...spec.provenance, native: { ...spec.provenance.native, commit: 'not-a-commit' } },
        })
      ).toThrow(SchemaError)
      expect(() =>
        validateFrozenSpec({
          ...spec,
          provenance: { ...spec.provenance, native: { ...spec.provenance.native, githubActionsRunId: 'abc' } },
        })
      ).toThrow(SchemaError)
      expect(() =>
        validateFrozenSpec({
          ...spec,
          provenance: { ...spec.provenance, native: { ...spec.provenance.native, schemaVersion: 0 } },
        })
      ).toThrow(SchemaError)
      expect(() =>
        validateFrozenSpec({ ...spec, assets: [{ ...spec.assets[0], bytes: -1 }] })
      ).toThrow(SchemaError)
    })
  })

  it('requires the sole no-pthread runtime marker', async () => {
    await withSynthetic(async ({ spec }) => {
      expect(() => validateFrozenSpec({ ...spec, runtime: { threading: 'pthread' } }))
        .toThrow(/runtime threading must be none/)
      expect(() => validateFrozenSpec({
        ...spec,
        runtime: { threading: 'none', pthreadWorkerMode: 'main-script' },
      })).toThrow(/legacy pthread runtime metadata is not accepted/)
    })
  })
})

describe('candidate manifest schema', () => {
  it('rejects a forbidden standalone worker at any asset depth', async () => {
    await withSynthetic(async ({ spec }) => {
      const assets = spec.assets.map(({ sourceRoot: _sourceRoot, sourcePath: _sourcePath, ...asset }, index) =>
        index === 0
          ? { ...asset, path: 'nested/runtime/soffice.worker.js' }
          : asset
      )
      const manifest = {
        schemaVersion: 1,
        kind: 'pdfhow-libreoffice-runtime-candidate',
        candidateId: spec.candidateId,
        releaseQualified: false,
        provenance: spec.provenance,
        runtime: spec.runtime,
        assets,
      }

      expect(() => validateCandidateManifest(manifest)).toThrow(
        /candidate manifest must not contain soffice\.worker\.js/
      )
    })
  })

  it('rejects a candidate manifest that claims qualification', () => {
    expect(() =>
      validateCandidateManifest({
        schemaVersion: 1,
        kind: 'pdfhow-libreoffice-runtime-candidate',
        candidateId: 'a'.repeat(64),
        releaseQualified: true,
        provenance: { native: { commit: 'a'.repeat(40), githubActionsRunId: '1', abi: 'x', schemaVersion: 1 }, wrapper: { commit: 'b'.repeat(40) } },
        runtime: { threading: 'none' },
        assets: [],
      })
    ).toThrow(SchemaError)
  })

  it('rejects a candidate manifest containing source paths or timestamps', () => {
    const base = {
      schemaVersion: 1,
      kind: 'pdfhow-libreoffice-runtime-candidate',
      candidateId: 'a'.repeat(64),
      releaseQualified: false,
      provenance: { native: { commit: 'a'.repeat(40), githubActionsRunId: '1', abi: 'x', schemaVersion: 1 }, wrapper: { commit: 'b'.repeat(40) } },
      runtime: { threading: 'none' },
      assets: [],
    }
    expect(() =>
      validateCandidateManifest({ ...base, sources: { nativeRoot: 'D:\\tmp\\x', wrapperRoot: 'D:\\tmp\\y' } })
    ).toThrow(/source paths/)
    expect(() => validateCandidateManifest({ ...base, timestamp: '2026-08-10T00:00:00Z' })).toThrow(/timestamps/)
  })

  it('rejects a wrong kind/schema manifest', () => {
    expect(() =>
      validateCandidateManifest({ schemaVersion: 9, kind: 'something-else', candidateId: 'a'.repeat(64) })
    ).toThrow(SchemaError)
  })
})

describe('control record kinds are distinct', () => {
  it('staging report must be its own kind and unqualified', () => {
    expect(() =>
      validateStagingReport({ schemaVersion: 1, kind: 'libreoffice-wasm-runtime-staging-report', candidateId: 'a'.repeat(64) })
    ).toThrow(/tagName/)
    const good = {
      schemaVersion: 1,
      kind: 'libreoffice-wasm-runtime-staging-report',
      candidateId: 'a'.repeat(64),
      tagName: 'runtime-artifact-abc',
      targetCommit: 'a'.repeat(40),
      releaseId: '123',
      releaseUrl: 'https://github.com/x/y/releases/tag/rt',
      payloadArchiveSha256: 'b'.repeat(64),
      assets: [{ name: 'x.zip', uploadUrl: 'https://example/x', sha256: 'c'.repeat(64) }],
    }
    expect(validateStagingReport(good).kind).toBe('libreoffice-wasm-runtime-staging-report')
    expect(() => validateStagingReport({ ...good, releaseQualified: true })).toThrow(/must not claim/)
  })

  it('acceptance receipt wants accepted/rejected and binding fields', () => {
    expect(() =>
      validateAcceptanceReceipt({ schemaVersion: 1, kind: 'libreoffice-wasm-runtime-acceptance-receipt', decision: 'maybe' })
    ).toThrow(/accepted\/rejected/)
  })

  it('releaseQualified:true is valid ONLY in a release manifest kind', () => {
    expect(() =>
      validateReleaseManifest({ schemaVersion: 1, kind: 'libreoffice-wasm-runtime-release-manifest' })
    ).toThrow(/releaseQualified: true/)
    const good = {
      schemaVersion: 1,
      kind: 'libreoffice-wasm-runtime-release-manifest',
      releaseQualified: true,
      candidateId: 'a'.repeat(64),
      payloadArchiveSha256: 'b'.repeat(64),
      candidateManifestSha256: 'c'.repeat(64),
      acceptanceReceiptSha256: 'd'.repeat(64),
      releaseId: '123',
      targetCommit: 'a'.repeat(40),
      assets: [{ name: 'x.zip', sha256: 'b'.repeat(64) }],
    }
    expect(validateReleaseManifest(good).releaseQualified).toBe(true)
  })
})
