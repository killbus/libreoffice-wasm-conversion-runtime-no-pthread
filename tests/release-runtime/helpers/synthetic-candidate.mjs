// Test-only helpers: synthetic frozen candidate roots and a raw ZIP builder
// used to exercise the reader/verifier with hostile archives. Nothing here
// touches the real 248 MB runtime bytes.

import { createHash } from 'node:crypto'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deriveCandidateIdentity } from '../../../scripts/release-runtime/lib/canonical.mjs'
import { crc32 } from '../../../scripts/release-runtime/lib/crc32.mjs'

const ZERO_SHA = '0'.repeat(64)
export const FROZEN_PROVENANCE = {
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

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function encodeVarUint(value) {
  const bytes = []
  do {
    let byte = value & 0x7f
    value >>>= 7
    if (value !== 0) byte |= 0x80
    bytes.push(byte)
  } while (value !== 0)
  return Buffer.from(bytes)
}

function validWasmBytes(payloadBytes = 4096) {
  const payload = Buffer.alloc(payloadBytes)
  const customSection = Buffer.concat([Buffer.from([0]), payload])
  return Buffer.concat([
    Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0]),
    encodeVarUint(customSection.length),
    customSection,
  ])
}

// Original valid derivation contract.
function makeSyntheticAssets() {
  const content = (label) => Buffer.from(`synthetic:${label}`)
  const entries = [
    { path: 'dist/browser.d.ts', role: 'browserTypes', mimeType: 'text/plain', sourceRoot: 'wrapper', sourcePath: 'dist/browser.d.ts', bytes: content('browser.d.ts') },
    { path: 'dist/browser.js', role: 'browserModule', mimeType: 'text/javascript', sourceRoot: 'wrapper', sourcePath: 'dist/browser.js', bytes: content('browser.js') },
    { path: 'dist/browser.worker.global.js', role: 'browserWorker', mimeType: 'text/javascript', sourceRoot: 'wrapper', sourcePath: 'dist/browser.worker.global.js', bytes: content('browser.worker.global.js') },
    { path: 'wasm/loader.cjs', role: 'nodeLoader', mimeType: 'text/javascript', sourceRoot: 'wrapper', sourcePath: 'wasm/loader.cjs', bytes: content('loader.cjs') },
    { path: 'wasm/soffice.cjs', role: 'nodeGlue', mimeType: 'text/javascript', sourceRoot: 'native', sourcePath: 'soffice.cjs', bytes: content('soffice.cjs') },
    { path: 'wasm/soffice.data', role: 'filesystemData', mimeType: 'application/octet-stream', sourceRoot: 'native', sourcePath: 'soffice.data', bytes: Buffer.concat([content('soffice.prologue'), Buffer.alloc(1024, 0xab)]) },
    { path: 'wasm/soffice.js', role: 'browserGlue', mimeType: 'text/javascript', sourceRoot: 'native', sourcePath: 'soffice.js', bytes: content('soffice.js') },
    { path: 'wasm/soffice.wasm', role: 'wasmBinary', mimeType: 'application/wasm', sourceRoot: 'native', sourcePath: 'soffice.wasm', bytes: validWasmBytes() },
  ]
  return entries.map(({ path, role, mimeType, sourceRoot, sourcePath, bytes }) => ({
    path,
    role,
    mimeType,
    sourceRoot,
    sourcePath,
    bytes: bytes.length,
    sha256: sha256(bytes),
    actualBytes: bytes,
  }))
}

// Creates synthetic source roots plus a fully validated frozen spec whose
// hashes match those roots. Returns spec + roots; cleans up on dispose.
export async function makeSyntheticCandidate(options = {}) {
  const nativeRoot = await mkdtemp(join(tmpdir(), 'lo-native-synth-'))
  const wrapperRoot = await mkdtemp(join(tmpdir(), 'lo-wrapper-synth-'))
  const specAssets = makeSyntheticAssets()

  const bytesByPath = new Map(specAssets.map((asset) => [asset.path, asset.actualBytes]))
  const { mkdir } = await import('node:fs/promises')
  const { dirname } = await import('node:path')
  for (const asset of specAssets) {
    const writePath =
      asset.sourceRoot === 'native'
        ? join(nativeRoot, asset.sourcePath)
        : join(wrapperRoot, asset.sourcePath)
    await mkdir(dirname(writePath), { recursive: true })
    await writeFile(writePath, bytesByPath.get(asset.path))
  }

  const assets = specAssets.map(({ path, role, mimeType, bytes, sha256, sourceRoot, sourcePath }) => ({
    path,
    role,
    mimeType,
    bytes,
    sha256,
    sourceRoot,
    sourcePath,
  }))
  const runtime = options.runtime ?? { threading: 'none' }
  const provenance = options.provenance ?? FROZEN_PROVENANCE
  const candidateId = deriveCandidateIdentity({ provenance, runtime, assets })

  const spec = {
    schemaVersion: 1,
    kind: 'libreoffice-wasm-runtime-frozen-spec',
    candidateId,
    provenance,
    runtime,
    originalNativeArchive: {
      name: 'fake-native-archive.zip',
      bytes: 123,
      sha256: ZERO_SHA,
    },
    assets,
    controlFiles: ['CANDIDATE-MANIFEST.json', 'ASSET-SHA256SUMS'],
    expectedPayloadArchiveName: `libreoffice-wasm-runtime-${candidateId}.zip`,
  }

  return {
    spec,
    nativeRoot,
    wrapperRoot,
    assetBytes: bytesByPath,
    async dispose() {
      await rm(nativeRoot, { recursive: true, force: true }).catch(() => {})
      await rm(wrapperRoot, { recursive: true, force: true }).catch(() => {})
    },
  }
}

const LOCAL_SIG = 0x04034b50
const CENTRAL_SIG = 0x02014b50
const EOCD_SIG = 0x06054b50
const VERSION_NEEDED = 20
const FIXED_TIME = 0x0000
const FIXED_DATE = 0x0021

function putUInt32(buf, offset, value) {
  buf[offset] = value & 0xff
  buf[offset + 1] = (value >>> 8) & 0xff
  buf[offset + 2] = (value >>> 16) & 0xff
  buf[offset + 3] = (value >>> 24) & 0xff
}

function putUInt16(buf, offset, value) {
  buf[offset] = value & 0xff
  buf[offset + 1] = (value >>> 8) & 0xff
}

// Raw ZIP builder that permits hostile names/methods/attributes to exercise
// the reader. method defaults to STORE; timestamp is fixed (not meaningful).
export function buildRawZip(entries) {
  const blobs = entries.map((entry) => {
    const nameBytes = Buffer.from(entry.name, 'utf8')
    const crc = entry.crc ?? crc32(entry.bytes)
    const method = entry.method ?? 0
    const flags = entry.flags ?? 0x0800
    const versionMadeBy = entry.versionMadeBy ?? 0x0014
    const externalFileAttributes = entry.externalFileAttributes ?? 0

    const local = Buffer.alloc(30 + nameBytes.length)
    putUInt32(local, 0, LOCAL_SIG)
    putUInt16(local, 4, VERSION_NEEDED)
    putUInt16(local, 6, flags)
    putUInt16(local, 8, method)
    putUInt16(local, 10, FIXED_TIME)
    putUInt16(local, 12, FIXED_DATE)
    putUInt32(local, 14, crc)
    putUInt32(local, 18, entry.bytes.length)
    putUInt32(local, 22, entry.bytes.length)
    putUInt16(local, 26, nameBytes.length)
    putUInt16(local, 28, 0)
    nameBytes.copy(local, 30)

    const central = Buffer.alloc(46 + nameBytes.length)
    putUInt32(central, 0, CENTRAL_SIG)
    putUInt16(central, 4, versionMadeBy)
    putUInt16(central, 6, VERSION_NEEDED)
    putUInt16(central, 8, flags)
    putUInt16(central, 10, method)
    putUInt16(central, 12, FIXED_TIME)
    putUInt16(central, 14, FIXED_DATE)
    putUInt32(central, 16, crc)
    putUInt32(central, 20, entry.bytes.length)
    putUInt32(central, 24, entry.bytes.length)
    putUInt16(central, 28, nameBytes.length)
    putUInt16(central, 30, 0)
    putUInt16(central, 32, 0)
    putUInt16(central, 34, 0)
    putUInt16(central, 36, 0)
    putUInt32(central, 38, externalFileAttributes)
    putUInt32(central, 42, 0)
    nameBytes.copy(central, 46)

    return { name: entry.name, local, data: entry.bytes, central }
  })

  let offset = 0
  const locals = []
  const centers = []
  for (const blob of blobs) {
    putUInt32(blob.central, 42, offset)
    locals.push(blob.local, blob.data)
    centers.push(blob.central)
    offset += blob.local.length + blob.data.length
  }
  const centralSize = centers.reduce((sum, part) => sum + part.length, 0)
  const eocd = Buffer.alloc(22)
  putUInt32(eocd, 0, EOCD_SIG)
  putUInt16(eocd, 8, blobs.length)
  putUInt16(eocd, 10, blobs.length)
  putUInt32(eocd, 12, centralSize)
  putUInt32(eocd, 16, offset)
  putUInt16(eocd, 20, 0)
  return Buffer.concat([...locals, ...centers, eocd])
}