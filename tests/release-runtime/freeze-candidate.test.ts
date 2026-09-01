import { mkdtemp, mkdir, writeFile, truncate } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  FreezeCandidateError,
  freezeCandidate,
} from '../../scripts/release-runtime/freeze-candidate.mjs'
import { deriveCandidateIdentity } from '../../scripts/release-runtime/lib/canonical.mjs'

const COMMIT_A = 'a'.repeat(40)
const COMMIT_B = 'b'.repeat(40)
const RUN_ID = '32146386224'

async function sparseFile(path: string, bytes: number) {
  await writeFile(path, Buffer.from([1]))
  await truncate(path, bytes)
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'freeze-candidate-'))
  const nativeRoot = join(root, 'native')
  const wrapperRoot = join(root, 'wrapper')
  await mkdir(nativeRoot)
  await mkdir(join(wrapperRoot, 'dist'), { recursive: true })
  await mkdir(join(wrapperRoot, 'wasm'), { recursive: true })
  await sparseFile(join(nativeRoot, 'soffice.cjs'), 10_001)
  await sparseFile(join(nativeRoot, 'soffice.data'), 1_000_001)
  await sparseFile(join(nativeRoot, 'soffice.js'), 10_001)
  await sparseFile(join(nativeRoot, 'soffice.wasm'), 1_000_001)
  await writeFile(join(nativeRoot, 'soffice.data.js.metadata'), '{}')
  await writeFile(join(wrapperRoot, 'dist/browser.d.ts'), 'export {}\n')
  await writeFile(join(wrapperRoot, 'dist/browser.js'), 'export {}\n')
  await writeFile(join(wrapperRoot, 'dist/browser.worker.global.js'), 'self.x=1\n')
  await writeFile(join(wrapperRoot, 'wasm/loader.cjs'), 'module.exports={}\n')
  const nativeArchive = join(
    root,
    `soffice-wasm-no-pthread-${RUN_ID}.zip`
  )
  await writeFile(nativeArchive, 'archive bytes')
  return { root, nativeRoot, wrapperRoot, nativeArchive }
}

describe('successor candidate freezing', () => {
  it('derives a valid eight-asset no-pthread candidate without loading WASM', async () => {
    const paths = await fixture()
    const spec = await freezeCandidate({
      ...paths,
      nativeCommit: COMMIT_A,
      wrapperCommit: COMMIT_B,
      runId: RUN_ID,
    })

    expect(spec.assets).toHaveLength(8)
    expect(spec.assets.map((asset) => asset.path)).not.toContain(
      'wasm/soffice.data.js.metadata'
    )
    expect(spec.runtime).toEqual({ threading: 'none' })
    expect(deriveCandidateIdentity(spec)).toBe(spec.candidateId)
    expect(spec.expectedPayloadArchiveName).toBe(
      `libreoffice-wasm-runtime-${spec.candidateId}.zip`
    )
  })

  it('rejects unknown native files before candidate derivation', async () => {
    const paths = await fixture()
    await writeFile(join(paths.nativeRoot, 'soffice.worker.js'), 'unexpected')

    await expect(
      freezeCandidate({
        ...paths,
        nativeCommit: COMMIT_A,
        wrapperCommit: COMMIT_B,
        runId: RUN_ID,
      })
    ).rejects.toThrow(FreezeCandidateError)
  })

  it('rejects pointer-sized native artifacts', async () => {
    const paths = await fixture()
    await writeFile(
      join(paths.nativeRoot, 'soffice.wasm'),
      'version https://git-lfs.github.com/spec/v1\n' +
        'oid sha256:' + '0'.repeat(64) + '\nsize 1000000\n'
    )

    await expect(
      freezeCandidate({
        ...paths,
        nativeCommit: COMMIT_A,
        wrapperCommit: COMMIT_B,
        runId: RUN_ID,
      })
    ).rejects.toThrow(/too small|Git LFS pointer/)
  })
})
