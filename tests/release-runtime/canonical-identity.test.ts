import { describe, expect, it } from 'vitest'
import {
  deriveCandidateIdentity,
  serializePrettyJson,
} from '../../scripts/release-runtime/lib/canonical.mjs'
import { validateFrozenSpec } from '../../scripts/release-runtime/lib/schemata.mjs'

// Frozen identity from the accepted no-pthread build.
const FROZEN_CANDIDATE_ID =
  'c1fe3173b26a9eab9ef169fe91961bd32fceadbc9b1423ac8b1c8178f577eeb9'

const FROZEN_ASSETS = [
  { path: 'dist/browser.d.ts', role: 'browserTypes', mimeType: 'text/plain', bytes: 15889, sha256: '31651bfee684a4a0e1a6c94b25adea20410e0d5a8f1504aede947bba576ce6b9' },
  { path: 'dist/browser.js', role: 'browserModule', mimeType: 'text/javascript', bytes: 90277, sha256: 'a2956d468193de941602c02d3d3b3f88f21e68d72b893e3a27c37f675c314d17' },
  { path: 'dist/browser.worker.global.js', role: 'browserWorker', mimeType: 'text/javascript', bytes: 121754, sha256: '8bb3e6b2321f832be5219de786b2511c07f5c83c37c3a4f323a126ebaae749df' },
  { path: 'wasm/loader.cjs', role: 'nodeLoader', mimeType: 'text/javascript', bytes: 10730, sha256: 'e1abffbccc38db8e19d4aa2176b65e16a6cad0311cb2aae6973efaa083532aad' },
  { path: 'wasm/soffice.cjs', role: 'nodeGlue', mimeType: 'text/javascript', bytes: 414054, sha256: 'feb653e20983238a2baa256c3823b3f73823531a36016c778bcc7d4afc34c457' },
  { path: 'wasm/soffice.data', role: 'filesystemData', mimeType: 'application/octet-stream', bytes: 99735790, sha256: '2f152a0691284deb9dfbee0a925fe4166587e063fa84eacdcb1413a272d035de' },
  { path: 'wasm/soffice.js', role: 'browserGlue', mimeType: 'text/javascript', bytes: 414054, sha256: 'feb653e20983238a2baa256c3823b3f73823531a36016c778bcc7d4afc34c457' },
  { path: 'wasm/soffice.wasm', role: 'wasmBinary', mimeType: 'application/wasm', bytes: 146171647, sha256: '0ca7ecf05c26e87c714e72a0cee705ac4254dfd81f504683a75e6abfb661a709' },
]

const FROZEN_PROVENANCE = {
  native: {
    commit: '2acc06e13040eee9e42e61005e73cdf952ae67fd',
    githubActionsRunId: '33412490741',
    abi: 'lok-convert-document-v1',
    schemaVersion: 1,
  },
  wrapper: {
    commit: '2acc06e13040eee9e42e61005e73cdf952ae67fd',
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
        ? { ...asset, bytes: 146171648, sha256: '0ca7ecf05c26e87c714e72a0cee705ac4254dfd81f504683a75e6abfb661a708' }
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
  it('accepts both checked-in no-pthread candidate specs', async () => {
    const { readFile } = await import('node:fs/promises')
    const { resolve } = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    for (const filename of ['candidate-spec.json', 'qualified-candidate-spec.json']) {
      const specPath = resolve(fileURLToPath(import.meta.url), `../../../scripts/release-runtime/${filename}`)
      const spec = JSON.parse(await readFile(specPath, 'utf8'))
      expect(validateFrozenSpec(spec)).toMatchObject({
        candidateId: FROZEN_CANDIDATE_ID,
        runtime: FROZEN_RUNTIME,
      })
    }
  })
})