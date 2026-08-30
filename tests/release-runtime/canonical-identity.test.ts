import { describe, expect, it } from 'vitest'
import {
  deriveCandidateIdentity,
  serializePrettyJson,
} from '../../scripts/release-runtime/lib/canonical.mjs'
import { validateFrozenSpec } from '../../scripts/release-runtime/lib/schemata.mjs'

// Frozen identity from research/artifact-provenance.md.
const FROZEN_CANDIDATE_ID =
  '85b6fb0e3f50570d085547f997eaa7584e5e49d076cd584639f31f51cecc4ad6'

const FROZEN_ASSETS = [
  { path: 'dist/browser.d.ts', role: 'browserTypes', mimeType: 'text/plain', bytes: 71783, sha256: '73d0f6ab719d0f643d38fc1839be295f0aed4cb09a8c8cb8f054d65a224f63fb' },
  { path: 'dist/browser.js', role: 'browserModule', mimeType: 'text/javascript', bytes: 87881, sha256: '9fa0fef0b7554bef5c5a59c4fc85a325d77b0a218129be38febf4a6d02a4518c' },
  { path: 'dist/browser.worker.global.js', role: 'browserWorker', mimeType: 'text/javascript', bytes: 122735, sha256: '9cababb37ce81ca8d60158cd6ffe1b5e218cbcb33c5d87bc74f08ec8e3804741' },
  { path: 'wasm/loader.cjs', role: 'nodeLoader', mimeType: 'text/javascript', bytes: 10513, sha256: '7cebd863dcd071a5eb02bc26fa7701e7dc5c865d1e130e5595672e56a34934cf' },
  { path: 'wasm/soffice.cjs', role: 'nodeGlue', mimeType: 'text/javascript', bytes: 439517, sha256: '0c18483bdf23a83e9ab1d180fc8d3c850f6cd57a42e4e1cda545e25c512940a5' },
  { path: 'wasm/soffice.data', role: 'filesystemData', mimeType: 'application/octet-stream', bytes: 99735790, sha256: 'c4b8a92b566d4e0d4723d321ef926e1b9fbeb575d28cdd6466d27fd2c17c5514' },
  { path: 'wasm/soffice.js', role: 'browserGlue', mimeType: 'text/javascript', bytes: 439517, sha256: '0c18483bdf23a83e9ab1d180fc8d3c850f6cd57a42e4e1cda545e25c512940a5' },
  { path: 'wasm/soffice.wasm', role: 'wasmBinary', mimeType: 'application/wasm', bytes: 148022311, sha256: 'b24a888550d27d2942ff9c8c9a84e20cd0c852db154e8558647cb9c5294ff291' },
]

const FROZEN_PROVENANCE = {
  native: {
    commit: '71d33678ed74872ebbb1bc37f5778143f8f5e401',
    githubActionsRunId: '31211473147',
    abi: 'lok-convert-document-v1',
    schemaVersion: 1,
  },
  wrapper: {
    commit: 'df3f73c789e6d2abf71cbcd75186118d2bbc795a',
  },
}

const FROZEN_RUNTIME = { threading: 'none' }

function identity(assets = FROZEN_ASSETS, provenance = FROZEN_PROVENANCE, runtime = FROZEN_RUNTIME) {
  return deriveCandidateIdentity({ provenance, runtime, assets })
}

describe('frozen candidate-ID derivation', () => {
  it('reproduces the frozen candidate ID exactly', () => {
    expect(identity()).toBe(FROZEN_CANDIDATE_ID)
  })

  it('derives the same ID regardless of asset order (sorted before hashing)', () => {
    const reversed = [...FROZEN_ASSETS].reverse()
    expect(identity(reversed)).toBe(FROZEN_CANDIDATE_ID)
  })

  it('treats any asset byte/hash change as a new candidate', () => {
    const changed = FROZEN_ASSETS.map((asset) =>
      asset.path === 'wasm/soffice.wasm'
        ? { ...asset, bytes: 148022312, sha256: 'b24a888550d27d2942ff9c8c9a84e20cd0c852db154e8558647cb9c5294ff29f' }
        : asset
    )
    expect(identity(changed)).not.toBe(FROZEN_CANDIDATE_ID)
  })

  it('treats any native/wrapper commit or run-ID change as a new candidate', () => {
    expect(identity(undefined, { ...FROZEN_PROVENANCE, native: { ...FROZEN_PROVENANCE.native, commit: '0000000000000000000000000000000000000001' } })).not.toBe(FROZEN_CANDIDATE_ID)
    expect(identity(undefined, { ...FROZEN_PROVENANCE, native: { ...FROZEN_PROVENANCE.native, githubActionsRunId: '99999999999' } })).not.toBe(FROZEN_CANDIDATE_ID)
    expect(identity(undefined, { ...FROZEN_PROVENANCE, wrapper: { commit: '0000000000000000000000000000000000000002' } })).not.toBe(FROZEN_CANDIDATE_ID)
  })

  it('treats ABI/schema/runtime drift as a new candidate', () => {
    expect(identity(undefined, { ...FROZEN_PROVENANCE, native: { ...FROZEN_PROVENANCE.native, abi: 'lok-convert-document-v2' } })).not.toBe(FROZEN_CANDIDATE_ID)
    expect(identity(undefined, { ...FROZEN_PROVENANCE, native: { ...FROZEN_PROVENANCE.native, schemaVersion: 2 } })).not.toBe(FROZEN_CANDIDATE_ID)
    expect(identity(undefined, undefined, { threading: 'future-model' })).not.toBe(FROZEN_CANDIDATE_ID)
  })

  it('keeps runtime/path/role identity fields but never source roots or timestamps', () => {
    const manifest = {
      schemaVersion: 1,
      kind: 'pdfhow-libreoffice-runtime-candidate',
      candidateId: FROZEN_CANDIDATE_ID,
      releaseQualified: false,
      provenance: FROZEN_PROVENANCE,
      runtime: FROZEN_RUNTIME,
      assets: FROZEN_ASSETS,
    }
    const serialized = serializePrettyJson(manifest)
    expect(serialized).toContain(FROZEN_CANDIDATE_ID)
    expect(serialized).not.toMatch(/D:\\tmp|D:\\Repositories|sources/)
    expect(serialized).not.toMatch(/"timestamp"/)
    expect(serialized.endsWith('\n')).toBe(true)
    expect(serialized.includes('\r\n')).toBe(false)
    expect(serialized).not.toContain('\uFEFF')
  })
})

describe('frozen spec schema', () => {
  it('rejects the checked-in legacy threaded candidate spec', async () => {
    const { readFile } = await import('node:fs/promises')
    const { resolve } = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const specPath = resolve(fileURLToPath(import.meta.url), '../../../scripts/release-runtime/candidate-spec.json')
    const legacySpec = JSON.parse(await readFile(specPath, 'utf8'))
    expect(() => validateFrozenSpec(legacySpec)).toThrow(/runtime threading|legacy pthread/)
  })
})