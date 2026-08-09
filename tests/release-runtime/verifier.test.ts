import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assemble,
  runDeterministicDoubleAssembly,
} from '../../scripts/release-runtime/lib/packager.mjs'
import { verifyArchive } from '../../scripts/release-runtime/lib/verifier.mjs'
import { createDeterministicZip } from '../../scripts/release-runtime/lib/zip-writer.mjs'
import { validateFrozenSpec } from '../../scripts/release-runtime/lib/schemata.mjs'
import { makeSyntheticCandidate } from './helpers/synthetic-candidate.mjs'

async function freshWork() {
  const workRoot = await mkdtemp(join(tmpdir(), 'lo-verify-work-'))
  const dispose = async () => rm(workRoot, { recursive: true, force: true }).catch(() => {})
  return { workRoot, dispose }
}

async function assembleSynthetic() {
  const synth = await makeSyntheticCandidate()
  const { workRoot, dispose } = await freshWork()
  const spec = validateFrozenSpec(synth.spec)
  const result = await runDeterministicDoubleAssembly({
    nativeRoot: synth.nativeRoot,
    wrapperRoot: synth.wrapperRoot,
    workRoot,
    spec,
    expectedCandidateId: spec.candidateId,
  })
  return { synth, spec, result, workRoot, dispose }
}

describe('verifier positive verification', () => {
  it('round-trips a synthetically assembled archive', async () => {
    const { synth, spec, result, workRoot, dispose } = await assembleSynthetic()
    try {
      const verification = await verifyArchive({
        archivePath: result.first.archive.path,
        spec,
        extractRoot: join(workRoot, 'verify-root'),
        expectedCandidateId: spec.candidateId,
      })
      expect(verification.candidateId).toBe(spec.candidateId)
      expect(verification.runtimeAssets).toHaveLength(8)
      expect(verification.expectedTag).toBe(`runtime-artifact-${spec.candidateId}`)
      for (const asset of verification.runtimeAssets) {
        const expected = spec.assets.find((entry) => entry.path === asset.path)
        expect(asset.bytes).toBe(expected.bytes)
        expect(asset.sha256).toBe(expected.sha256)
      }
      expect(verification.archiveSha256).toBe(result.first.archive.sha256)
    } finally {
      await dispose()
      await synth.dispose()
    }
  })
})

describe('verifier negative verification', () => {
  it('detects a flipped byte in the payload archive', async () => {
    const { synth, spec, result, workRoot, dispose } = await assembleSynthetic()
    try {
      const buffer = await readFile(result.first.archive.path)
      buffer[Math.floor(buffer.length / 2)] ^= 0xff
      const tamperedPath = join(workRoot, 'tampered.zip')
      await writeFile(tamperedPath, buffer)
      await expect(
        verifyArchive({
          archivePath: tamperedPath,
          spec,
          extractRoot: join(workRoot, 'verify-tamper'),
          expectedCandidateId: spec.candidateId,
        })
      ).rejects.toThrow()
    } finally {
      await dispose()
      await synth.dispose()
    }
  })

  it('rejects an extra undeclared entry in the archive', async () => {
    const { synth, spec, result, workRoot, dispose } = await assembleSynthetic()
    try {
      const manifestBytes = await readFile(result.first.standalone.manifestPath)
      const sumsBytes = await readFile(result.first.standalone.assetSumsPath)
      const entries = [
        { path: 'CANDIDATE-MANIFEST.json', bytes: manifestBytes },
        { path: 'ASSET-SHA256SUMS', bytes: sumsBytes },
        ...spec.assets.map((asset) => ({
          path: asset.path,
          bytes: synth.assetBytes.get(asset.path),
        })),
        { path: 'README.txt', bytes: Buffer.from('unsigned extra file') },
      ]
      const zipBuffer = createDeterministicZip(entries)
      const archivePath = join(workRoot, 'extra-entry.zip')
      await writeFile(archivePath, zipBuffer)
      await expect(
        verifyArchive({
          archivePath,
          spec,
          extractRoot: join(workRoot, 'verify-extra'),
          expectedCandidateId: spec.candidateId,
        })
      ).rejects.toThrow(/inventory drift/)
    } finally {
      await dispose()
      await synth.dispose()
    }
  })

  it('rejects a forbidden standalone worker inside the archive', async () => {
    const { synth, spec, result, workRoot, dispose } = await assembleSynthetic()
    try {
      const manifestBytes = await readFile(result.first.standalone.manifestPath)
      const sumsBytes = await readFile(result.first.standalone.assetSumsPath)
      const entries = [
        { path: 'CANDIDATE-MANIFEST.json', bytes: manifestBytes },
        { path: 'ASSET-SHA256SUMS', bytes: sumsBytes },
        ...spec.assets.map((asset) => ({
          path: asset.path,
          bytes: synth.assetBytes.get(asset.path),
        })),
        { path: 'wasm/soffice.worker.js', bytes: Buffer.from('worker') },
      ]
      const zipBuffer = createDeterministicZip(entries)
      const archivePath = join(workRoot, 'worker-entry.zip')
      await writeFile(archivePath, zipBuffer)
      await expect(
        verifyArchive({
          archivePath,
          spec,
          extractRoot: join(workRoot, 'verify-worker'),
          expectedCandidateId: spec.candidateId,
        })
      ).rejects.toThrow(/forbidden standalone worker/)
    } finally {
      await dispose()
      await synth.dispose()
    }
  })

  it('rejects a candidate manifest whose identity was modified', async () => {
    const { synth, spec, result, workRoot, dispose } = await assembleSynthetic()
    try {
      const manifestBytes = await readFile(result.first.standalone.manifestPath)
      const manifest = JSON.parse(manifestBytes.toString('utf8'))
      manifest.candidateId = 'b'.repeat(64)
      const tamperedManifest = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8')
      const sumsBytes = await readFile(result.first.standalone.assetSumsPath)
      const entries = [
        { path: 'CANDIDATE-MANIFEST.json', bytes: tamperedManifest },
        { path: 'ASSET-SHA256SUMS', bytes: sumsBytes },
        ...spec.assets.map((asset) => ({
          path: asset.path,
          bytes: synth.assetBytes.get(asset.path),
        })),
      ]
      const zipBuffer = createDeterministicZip(entries)
      const archivePath = join(workRoot, 'tampered-manifest.zip')
      await writeFile(archivePath, zipBuffer)
      await expect(
        verifyArchive({
          archivePath,
          spec,
          extractRoot: join(workRoot, 'verify-manifest'),
          expectedCandidateId: spec.candidateId,
        })
      ).rejects.toThrow(/candidate-ID drift/)
    } finally {
      await dispose()
      await synth.dispose()
    }
  })

  it('rejects an expectedCandidateId that contradicts the frozen spec', async () => {
    const { synth, spec, result, workRoot, dispose } = await assembleSynthetic()
    try {
      await expect(
        verifyArchive({
          archivePath: result.first.archive.path,
          spec,
          extractRoot: join(workRoot, 'verify-mismatch'),
          expectedCandidateId: '4'.repeat(64),
        })
      ).rejects.toThrow(/candidate-ID drift/)
    } finally {
      await dispose()
      await synth.dispose()
    }
  })
})

describe('verifier rejects non-deterministic re-assembly (drift locked)', () => {
  it('double assembly on a drifted source flagged as a new candidate', async () => {
    const synth = await makeSyntheticCandidate()
    const { workRoot, dispose } = await freshWork()
    try {
      const spec = validateFrozenSpec(synth.spec)
      const { writeFile: wf } = await import('node:fs/promises')
      const { join: j } = await import('node:path')
      await wf(j(synth.nativeRoot, 'soffice.data'), Buffer.concat([Buffer.from('synthetic:soffice.prologueX'), Buffer.alloc(1024, 0xab)]))
      await expect(
        assemble({
          nativeRoot: synth.nativeRoot,
          wrapperRoot: synth.wrapperRoot,
          workRoot,
          spec,
          expectedCandidateId: spec.candidateId,
        })
      ).rejects.toThrow(/source drift/)
    } finally {
      await dispose()
      await synth.dispose()
    }
  })
})