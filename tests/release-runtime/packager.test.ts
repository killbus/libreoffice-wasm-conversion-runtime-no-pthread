import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assemble,
  runDeterministicDoubleAssembly,
  PackError,
} from '../../scripts/release-runtime/lib/packager.mjs'
import { verifyArchive } from '../../scripts/release-runtime/lib/verifier.mjs'
import { extractZip } from '../../scripts/release-runtime/lib/zip-reader.mjs'
import { validateFrozenSpec, SchemaError } from '../../scripts/release-runtime/lib/schemata.mjs'
import { makeSyntheticCandidate } from './helpers/synthetic-candidate.mjs'

async function freshWork() {
  const workRoot = await mkdtemp(join(tmpdir(), 'lo-pack-work-'))
  const dispose = async () => rm(workRoot, { recursive: true, force: true }).catch(() => {})
  return { workRoot, dispose }
}

describe('packager positive assembly', () => {
  it('assembles exactly the declared assets with the declared hashes', async () => {
    const synth = await makeSyntheticCandidate()
    const { workRoot, dispose } = await freshWork()
    try {
      const spec = validateFrozenSpec(synth.spec)
      const result = await assemble({
        nativeRoot: synth.nativeRoot,
        wrapperRoot: synth.wrapperRoot,
        workRoot,
        spec,
        expectedCandidateId: spec.candidateId,
      })
      expect(result.candidateId).toBe(spec.candidateId)
      expect(result.totalRuntimeBytes).toBe(
        spec.assets.reduce((sum, asset) => sum + asset.bytes, 0)
      )

      // Archive must contain exactly 8 runtime assets + the two control files.
      const archiveBuffer = await readFile(result.archive.path)
      const entries = (await extractZip(archiveBuffer, join(workRoot, 'probe')))
        .map(({ name }) => name)
        .sort()
      expect(entries).toHaveLength(10)
      for (const asset of spec.assets) {
        expect(entries).toContain(asset.path)
      }
      expect(entries).toContain('CANDIDATE-MANIFEST.json')
      expect(entries).toContain('ASSET-SHA256SUMS')

      // Standalone manifest is byte-identical to the in-archive manifest.
      const inArchive = (await extractZip(archiveBuffer, join(workRoot, 'probe2'))).find(
        (entry) => entry.name === 'CANDIDATE-MANIFEST.json'
      )
      const standalone = await readFile(result.standalone.manifestPath)
      expect(inArchive.bytes.equals(standalone)).toBe(true)
    } finally {
      await dispose()
      await synth.dispose()
    }
  })

  it('produces byte-identical runs and a matching verifier report', async () => {
    const synth = await makeSyntheticCandidate()
    const { workRoot, dispose } = await freshWork()
    try {
      const spec = validateFrozenSpec(synth.spec)
      const result = await runDeterministicDoubleAssembly({
        nativeRoot: synth.nativeRoot,
        wrapperRoot: synth.wrapperRoot,
        workRoot,
        spec,
        expectedCandidateId: spec.candidateId,
      })
      expect(result.comparisons.candidateId).toBe(spec.candidateId)

      const verifyRoot = join(workRoot, 'verify')
      const verification = await verifyArchive({
        archivePath: result.first.archive.path,
        spec,
        extractRoot: verifyRoot,
        expectedCandidateId: spec.candidateId,
      })
      expect(verification.candidateId).toBe(spec.candidateId)
      expect(verification.runtimeAssets).toHaveLength(8)
      for (const asset of verification.runtimeAssets) {
        const specAsset = spec.assets.find((entry) => entry.path === asset.path)
        expect(asset.bytes).toBe(specAsset.bytes)
        expect(asset.sha256).toBe(specAsset.sha256)
      }
    } finally {
      await dispose()
      await synth.dispose()
    }
  })

  it('keeps the public candidate manifest free of source paths and timestamps', async () => {
    const synth = await makeSyntheticCandidate()
    const { workRoot, dispose } = await freshWork()
    try {
      const spec = validateFrozenSpec(synth.spec)
      const result = await runDeterministicDoubleAssembly({
        nativeRoot: synth.nativeRoot,
        wrapperRoot: synth.wrapperRoot,
        workRoot,
        spec,
        expectedCandidateId: spec.candidateId,
      })
      const manifestText = await readFile(result.first.standalone.manifestPath, 'utf8')
      expect(manifestText).not.toMatch(/D:\\tmp|D:\\Repositories|sources/)
      expect(manifestText).not.toMatch(/"timestamp"/)
      const manifest = JSON.parse(manifestText)
      expect(manifest.releaseQualified).toBe(false)
      expect(manifest.kind).toBe('pdfhow-libreoffice-runtime-candidate')
      expect(manifest.candidateId).toBe(spec.candidateId)
      expect(manifest.assets).toHaveLength(8)
    } finally {
      await dispose()
      await synth.dispose()
    }
  })
})

describe('packager negative assembly', () => {
  it('aborts on a missing declared source file', async () => {
    const synth = await makeSyntheticCandidate()
    const { workRoot, dispose } = await freshWork()
    try {
      const spec = validateFrozenSpec(synth.spec)
      const { rm: rmFile } = await import('node:fs/promises')
      const { join: joinPath, dirname } = await import('node:path')
      const target = joinPath(synth.nativeRoot, 'soffice.wasm')
      await rmFile(target, { force: true })
      await expect(
        assemble({ nativeRoot: synth.nativeRoot, wrapperRoot: synth.wrapperRoot, workRoot, spec, expectedCandidateId: spec.candidateId })
      ).rejects.toThrow(/missing/)
      expect(() => joinPath(dirname(target), 'x')).not.toThrow()
    } finally {
      await dispose()
      await synth.dispose()
    }
  })

  it('aborts on a one-byte source drift (new candidate)', async () => {
    const synth = await makeSyntheticCandidate()
    const { workRoot, dispose } = await freshWork()
    try {
      const spec = validateFrozenSpec(synth.spec)
      const { writeFile: writeFile2 } = await import('node:fs/promises')
      const { join: joinPath } = await import('node:path')
      await writeFile2(joinPath(synth.wrapperRoot, 'dist', 'browser.js'), Buffer.from('synthetic:browser.jsX'))
      await expect(
        assemble({ nativeRoot: synth.nativeRoot, wrapperRoot: synth.wrapperRoot, workRoot, spec, expectedCandidateId: spec.candidateId })
      ).rejects.toThrow(/source drift/)
    } finally {
      await dispose()
      await synth.dispose()
    }
  })

  it('aborts when the frozen candidate ID does not match the derived identity', async () => {
    const synth = await makeSyntheticCandidate()
    const { workRoot, dispose } = await freshWork()
    try {
      const spec = validateFrozenSpec({ ...synth.spec, candidateId: '2'.repeat(64) })
      await expect(
        assemble({ nativeRoot: synth.nativeRoot, wrapperRoot: synth.wrapperRoot, workRoot, spec, expectedCandidateId: spec.candidateId })
      ).rejects.toThrow(/does not match frozen candidate/)
    } finally {
      await dispose()
      await synth.dispose()
    }
  })

  it('aborts when an explicit expectedCandidateId contradicts the spec', async () => {
    const synth = await makeSyntheticCandidate()
    const { workRoot, dispose } = await freshWork()
    try {
      const spec = validateFrozenSpec(synth.spec)
      await expect(
        assemble({ nativeRoot: synth.nativeRoot, wrapperRoot: synth.wrapperRoot, workRoot, spec, expectedCandidateId: '3'.repeat(64) })
      ).rejects.toThrow(/expectedCandidateId/)
    } finally {
      await dispose()
      await synth.dispose()
    }
  })

  it('aborts on a forbidden standalone worker in the declared set', async () => {
    const synth = await makeSyntheticCandidate()
    const { workRoot, dispose } = await freshWork()
    try {
      const bad = { ...synth.spec, assets: [...synth.spec.assets, { path: 'wasm/soffice.worker.js', role: 'pthreadWorker', mimeType: 'text/javascript', bytes: 1, sha256: 'a'.repeat(64), sourceRoot: 'native', sourcePath: 'soffice.worker.js' }] }
      expect(() => validateFrozenSpec(bad)).toThrow(SchemaError)
    } finally {
      await dispose()
      await synth.dispose()
    }
  })
})