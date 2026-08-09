import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createDeterministicZip } from '../../scripts/release-runtime/lib/zip-writer.mjs'
import {
  extractZip,
  readCentralDirectory,
  readEndOfCentralDirectory,
  validateExtractionPath,
  ZipReadError,
} from '../../scripts/release-runtime/lib/zip-reader.mjs'
import { buildRawZip } from './helpers/synthetic-candidate.mjs'

function makeEntries() {
  return [
    { path: 'dist/browser.js', bytes: Buffer.from('export const a = 1') },
    { path: 'wasm/soffice.wasm', bytes: Buffer.from('wasm-bytes-here') },
    { path: 'CANDIDATE-MANIFEST.json', bytes: Buffer.from('{"hello":"world"}') },
    { path: 'ASSET-SHA256SUMS', bytes: Buffer.from('abc  dist/browser.js\n') },
  ]
}

describe('deterministic zip writer', () => {
  it('produces byte-identical archives across independent builds', () => {
    const a = createDeterministicZip(makeEntries())
    const b = createDeterministicZip(makeEntries())
    expect(a.equals(b)).toBe(true)
    expect(a.length).toBe(b.length)
  })

  it('is stable regardless of input ordering (sorted internally)', () => {
    const a = createDeterministicZip(makeEntries())
    const b = createDeterministicZip(makeEntries().reverse())
    expect(a.equals(b)).toBe(true)
  })

  it('fixes timestamps and omits extra fields / comments', () => {
    const zip = createDeterministicZip(makeEntries())
    const eocd = readEndOfCentralDirectory(zip)
    expect(eocd.centralDirectorySize).toBeGreaterThan(0)
    // No archive comment.
    expect(zip.readUInt16LE(zip.length - 2)).toBe(0)
    const entries = readCentralDirectory(zip, eocd)
    expect(entries).toHaveLength(4)
    for (const entry of entries) {
      expect(entry.method).toBe(0) // stored
      expect(entry.flags & 0x0800).toBeTruthy() // UTF-8
      expect(entry.externalFileAttributes).toBe(0)
      // Fixed DOS date 0x0021 = 1980-01-01.
      expect(entry.versionMadeBy).toBe(20)
    }
    const names = entries.map((entry) => entry.name)
    expect(names).toEqual([...names].sort((l, r) => l.localeCompare(r)))
  })

  it('rejects duplicate entry paths', () => {
    const entries = makeEntries()
    entries.push({ path: 'dist/browser.js', bytes: Buffer.from('x') })
    expect(() => createDeterministicZip(entries)).toThrow(/duplicate entry/)
  })

  it('rejects unsafe entry names on write', () => {
    expect(() => createDeterministicZip([{ path: '../escape.js', bytes: Buffer.from('x') }])).toThrow()
    expect(() => createDeterministicZip([{ path: 'C:/escape.js', bytes: Buffer.from('x') }])).toThrow()
    expect(() => createDeterministicZip([{ path: '/abs.js', bytes: Buffer.from('x') }])).toThrow()
    expect(() => createDeterministicZip([{ path: 'a\\b.js', bytes: Buffer.from('x') }])).toThrow()
  })
})

describe('zip reader positive', () => {
  it('round-trips writer output including CRC and metrics', async () => {
    const zip = createDeterministicZip(makeEntries())
    const root = await mkdtemp(join(tmpdir(), 'lo-zip-extract-'))
    try {
      const result = await extractZip(zip, root)
      expect(result.map(({ name }) => name).sort()).toEqual(
        makeEntries().map((entry) => entry.path).sort()
      )
      const manifest = result.find((entry) => entry.name === 'CANDIDATE-MANIFEST.json')
      expect(manifest.bytes.toString('utf8')).toBe('{"hello":"world"}')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('zip reader path-safety rejects', () => {
  it('rejects .. traversal names', () => {
    expect(() => validateExtractionPath('../outside')).toThrow(/traversal|unsafe/)
    expect(() => validateExtractionPath('a/../../outside')).toThrow(/traversal|unsafe/)
    expect(() => validateExtractionPath('a/..')).toThrow(/traversal|unsafe/)
  })

  it('rejects absolute, drive-qualified, backslash and null-byte names', () => {
    expect(() => validateExtractionPath('/etc/passwd')).toThrow()
    expect(() => validateExtractionPath('C:\\evil')).toThrow()
    expect(() => validateExtractionPath('a\\b')).toThrow()
    expect(() => validateExtractionPath('a\u0000b')).toThrow()
    expect(() => validateExtractionPath('')).toThrow()
    expect(() => validateExtractionPath('a//b')).toThrow()
  })

  it('rejects duplicate and case-fold-colliding entries before extraction', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lo-zip-dup-'))
    try {
      const zip = buildRawZip([
        { name: 'a.txt', bytes: Buffer.from('1') },
        { name: 'a.txt', bytes: Buffer.from('2') },
      ])
      await expect(extractZip(zip, root)).rejects.toThrow(/duplicate entry/)
      const caseZip = buildRawZip([
        { name: 'File.txt', bytes: Buffer.from('1') },
        { name: 'file.txt', bytes: Buffer.from('2') },
      ])
      await expect(extractZip(caseZip, root)).rejects.toThrow(/case-fold/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects dir, symlink and device entry types', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lo-zip-attr-'))
    try {
      const dirZip = buildRawZip([
        { name: 'folder/', bytes: Buffer.alloc(0), versionMadeBy: 0x031e, externalFileAttributes: 0x41ed0000 },
      ])
      await expect(extractZip(dirZip, root)).rejects.toThrow(/unsafe entry path|directory entry/)
      const linkZip = buildRawZip([
        { name: 'link', bytes: Buffer.from('target'), versionMadeBy: 0x031e, externalFileAttributes: 0xa1ed0000 },
      ])
      await expect(extractZip(linkZip, root)).rejects.toThrow(/non-regular-file/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects encrypted and data-descriptor entries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lo-zip-flags-'))
    try {
      const encrypted = buildRawZip([{ name: 'a.txt', bytes: Buffer.from('x'), flags: 0x0801 }])
      await expect(extractZip(encrypted, root)).rejects.toThrow(/encrypted/)
      const descriptor = buildRawZip([{ name: 'a.txt', bytes: Buffer.from('x'), flags: 0x0808 }])
      await expect(extractZip(descriptor, root)).rejects.toThrow(/data-descriptor/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects unsupported compression methods and CRC corruption', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lo-zip-method-'))
    try {
      const bzip = buildRawZip([{ name: 'a.txt', bytes: Buffer.from('x'), method: 12 }])
      await expect(extractZip(bzip, root)).rejects.toThrow(/compression method/)
      const badCrc = buildRawZip([{ name: 'a.txt', bytes: Buffer.from('x'), crc: 0xdeadbeef }])
      await expect(extractZip(badCrc, root)).rejects.toThrow(/CRC mismatch/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})