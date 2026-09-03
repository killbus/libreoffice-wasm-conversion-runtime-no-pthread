// ZIP central-directory inspection and fail-closed extraction (design.md §5).
//
// The verifier inspects the full central directory BEFORE extracting anything
// and rejects: absolute / drive-qualified paths, `..` traversal, backslash /
// null-byte separators, duplicate normalized names, case-fold collisions,
// non-regular-file entries, encrypted entries, and unsupported compression
// methods. Data-descriptor entries use sizes and CRCs from the validated central
// directory. Extraction then happens into a fresh
// boundary-checked root with CRC validation on every written file.

import { inflateRawSync } from 'node:zlib'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { crc32 } from './crc32.mjs'
import { assertStrictDescendant } from './sources.mjs'

export class ZipReadError extends Error {}

const LOCAL_HEADER_SIGNATURE = 0x04034b50
const CENTRAL_HEADER_SIGNATURE = 0x02014b50
const END_OF_CENTRAL_SIGNATURE = 0x06054b50
const MAX_COMMENT_LENGTH = 65535
const EOCD_FIXED_SIZE = 22
const CENTRAL_HEADER_SIZE = 46
const LOCAL_HEADER_SIZE = 30
const METHOD_STORE = 0
const METHOD_DEFLATE = 8
const UNSUPPORTED_METHODS = new Set([1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 93, 94, 95, 96, 97, 98, 99])

function putUInt32LE(view, offset, value) {
  view.setUint32(offset, value, true)
}

function checkBounds(args) {
  const { buffer, offset, length, label } = args
  if (offset < 0 || length < 0 || offset + length > buffer.length) {
    throw new ZipReadError(`${label} references bytes outside the archive`)
  }
}

export function readEndOfCentralDirectory(buffer) {
  const searchFrom = Math.max(0, buffer.length - MAX_COMMENT_LENGTH - EOCD_FIXED_SIZE)
  let eocdOffset = -1
  for (let index = buffer.length - EOCD_FIXED_SIZE; index >= searchFrom; index -= 1) {
    if (buffer[index] === 0x50 && buffer.readUInt32LE(index) === END_OF_CENTRAL_SIGNATURE) {
      const commentLength = buffer.readUInt16LE(index + 20)
      if (index + EOCD_FIXED_SIZE + commentLength === buffer.length) {
        eocdOffset = index
        break
      }
    }
  }
  if (eocdOffset === -1) {
    throw new ZipReadError('archive has no valid end-of-central-directory record')
  }
  const commentLength = buffer.readUInt16LE(eocdOffset + 20)
  if (commentLength !== 0) {
    throw new ZipReadError('archive comment is not allowed')
  }
  return {
    entryCount: buffer.readUInt16LE(eocdOffset + 10),
    centralDirectorySize: buffer.readUInt32LE(eocdOffset + 12),
    centralDirectoryOffset: buffer.readUInt32LE(eocdOffset + 16),
  }
}

// Returns the list of central-directory entries without extracting them.
export function readCentralDirectory(buffer, eocd) {
  const { entryCount, centralDirectorySize, centralDirectoryOffset } = eocd
  checkBounds({
    buffer,
    offset: centralDirectoryOffset,
    length: centralDirectorySize,
    label: 'central directory',
  })
  if (buffer.readUInt32LE(centralDirectoryOffset) !== CENTRAL_HEADER_SIGNATURE) {
    throw new ZipReadError('central directory does not start with a valid signature')
  }

  const entries = []
  let cursor = centralDirectoryOffset
  const cursorEnd = centralDirectoryOffset + centralDirectorySize
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + CENTRAL_HEADER_SIZE > cursorEnd) {
      throw new ZipReadError('central directory ends before all entries are read')
    }
    if (buffer.readUInt32LE(cursor) !== CENTRAL_HEADER_SIGNATURE) {
      throw new ZipReadError('missing central directory entry signature')
    }
    const versionMadeBy = buffer.readUInt16LE(cursor + 4)
    const flags = buffer.readUInt16LE(cursor + 8)
    const method = buffer.readUInt16LE(cursor + 10)
    const crc = buffer.readUInt32LE(cursor + 16)
    const compressedSize = buffer.readUInt32LE(cursor + 20)
    const uncompressedSize = buffer.readUInt32LE(cursor + 24)
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const externalFileAttributes = buffer.readUInt32LE(cursor + 38)
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42)
    const nameStart = cursor + CENTRAL_HEADER_SIZE
    checkBounds({
      buffer,
      offset: nameStart,
      length: nameLength,
      label: `entry name ${index}`,
    })
    const nameBytes = buffer.subarray(nameStart, nameStart + nameLength)
    const name = nameBytes.toString('utf8')

    validateEntryPolicy({
      name,
      flags,
      method,
      versionMadeBy,
      externalFileAttributes,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      extraLength,
      commentLength,
    })

    entries.push({
      name,
      method,
      crc,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      versionMadeBy,
      flags,
      externalFileAttributes,
    })
    cursor += CENTRAL_HEADER_SIZE + nameLength + extraLength + commentLength
  }
  return entries
}

function validateEntryPolicy(entry) {
  const { name, flags, method, externalFileAttributes } = entry
  if (flags & 0x0001) {
    throw new ZipReadError(`encrypted entry is not allowed: ${name}`)
  }
  if (UNSUPPORTED_METHODS.has(method)) {
    throw new ZipReadError(`unsupported compression method ${method} for ${name}`)
  }
  if (method !== METHOD_STORE && method !== METHOD_DEFLATE) {
    throw new ZipReadError(`unsupported compression method ${method} for ${name}`)
  }
  validateExtractionPath(name)
  const hostOs = entry.versionMadeBy >> 8
  const unixType = (externalFileAttributes >>> 16) & 0xf000
  if (hostOs === 3) {
    if (unixType === 0x4000) {
      throw new ZipReadError(`directory entry is not allowed: ${name}`)
    }
    if (unixType !== 0x8000 && unixType !== 0) {
      throw new ZipReadError(`non-regular-file entry is not allowed: ${name}`)
    }
  }
  if ((externalFileAttributes & 0x10) !== 0) {
    throw new ZipReadError(`directory entry is not allowed: ${name}`)
  }
}

export function validateExtractionPath(name) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new ZipReadError('entry name must be non-empty')
  }
  if (name.includes('\0') || name.includes('\\')) {
    throw new ZipReadError(`entry name has an invalid byte/separator: ${JSON.stringify(name)}`)
  }
  if (name.startsWith('/') || /^[a-zA-Z]:/.test(name)) {
    throw new ZipReadError(`absolute entry path is not allowed: ${name}`)
  }
  const segments = name.split('/')
  if (
    segments.some((segment) => segment === '..' || segment === '.') ||
    segments.some((segment) => segment.length === 0)
  ) {
    throw new ZipReadError(`unsafe entry path: ${name}`)
  }
}

// Extracts an archive into an (empty or throw-on-existing) fresh root after a
// complete central-directory preflight. Returns [{ name, bytes }].
export async function extractZip(buffer, extractRoot) {
  const resolvedRoot = resolve(extractRoot)
  await mkdir(resolvedRoot, { recursive: true })
  const eocd = readEndOfCentralDirectory(buffer)
  const entries = readCentralDirectory(buffer, eocd)

  const normalized = new Set()
  const caseFolded = new Set()
  const results = []
  const writtenDirs = new Set([resolve(extractRoot)])

  for (const entry of entries) {
    if (normalized.has(entry.name)) {
      throw new ZipReadError(`duplicate entry: ${entry.name}`)
    }
    const folded = entry.name.toLowerCase()
    if (caseFolded.has(folded)) {
      throw new ZipReadError(`case-fold collision for ${entry.name}`)
    }
    normalized.add(entry.name)
    caseFolded.add(folded)

    const dataStart = resolveLocalDataStart(buffer, entry)
    checkBounds({
      buffer,
      offset: dataStart,
      length: entry.compressedSize,
      label: `data of ${entry.name}`,
    })
    if (dataStart + entry.compressedSize > eocd.centralDirectoryOffset) {
      throw new ZipReadError(`data of ${entry.name} overlaps the central directory`)
    }
    const compressed = buffer.subarray(dataStart, dataStart + entry.compressedSize)
    let bytes
    if (entry.method === METHOD_STORE) {
      bytes = Buffer.from(compressed)
    } else {
      bytes = inflateRawSync(compressed)
    }
    if (bytes.length !== entry.uncompressedSize) {
      throw new ZipReadError(
        `size mismatch for ${entry.name}: declared ${entry.uncompressedSize}, got ${bytes.length}`
      )
    }
    if (crc32(bytes) !== entry.crc) {
      throw new ZipReadError(`CRC mismatch for ${entry.name}`)
    }

    const target = resolve(extractRoot, entry.name)
    assertStrictDescendant(extractRoot, target, `extraction target for ${entry.name}`)
    const parent = resolve(dirname(target))
    const parentRelative = relative(resolve(extractRoot), parent)
    if (parentRelative !== '') {
      assertStrictDescendant(extractRoot, parent, `extraction directory for ${entry.name}`)
    }
    const dirsToCreate = []
    let cursor = parent
    while (!writtenDirs.has(cursor) && relative(resolve(extractRoot), cursor) !== '') {
      dirsToCreate.push(cursor)
      writtenDirs.add(cursor)
      cursor = dirname(cursor)
    }
    for (const dir of dirsToCreate.reverse()) {
      await mkdir(dir, { recursive: true })
    }
    await writeFile(target, bytes)

    results.push({ name: entry.name, bytes })
  }

  return results
}

function resolveLocalDataStart(buffer, entry) {
  checkBounds({
    buffer,
    offset: entry.localHeaderOffset,
    length: LOCAL_HEADER_SIZE,
    label: `local header of ${entry.name}`,
  })
  if (buffer.readUInt32LE(entry.localHeaderOffset) !== LOCAL_HEADER_SIGNATURE) {
    throw new ZipReadError(`invalid local header for ${entry.name}`)
  }
  const localFlags = buffer.readUInt16LE(entry.localHeaderOffset + 6)
  const localMethod = buffer.readUInt16LE(entry.localHeaderOffset + 8)
  if (localFlags !== entry.flags || localMethod !== entry.method) {
    throw new ZipReadError(`local/central metadata mismatch for ${entry.name}`)
  }
  const localNameLength = buffer.readUInt16LE(entry.localHeaderOffset + 26)
  const localExtraLength = buffer.readUInt16LE(entry.localHeaderOffset + 28)
  const localNameStart = entry.localHeaderOffset + LOCAL_HEADER_SIZE
  checkBounds({
    buffer,
    offset: localNameStart,
    length: Math.max(localNameLength, entry.name.length),
    label: `local entry name for ${entry.name}`,
  })
  const localName = buffer
    .subarray(localNameStart, localNameStart + localNameLength)
    .toString('utf8')
  if (localName !== entry.name) {
    throw new ZipReadError(
      `local/central name mismatch for ${JSON.stringify(entry.name)}`
    )
  }
  return localNameStart + localNameLength + localExtraLength
}

// Re-exported for the write path's determinism test.
export function buildEndOfCentralDirectory({ entryCount, centralDirectorySize, centralDirectoryOffset }) {
  const endOfCentral = Buffer.alloc(EOCD_FIXED_SIZE)
  const view = new DataView(
    endOfCentral.buffer,
    endOfCentral.byteOffset,
    endOfCentral.byteLength
  )
  putUInt32LE(view, 0, END_OF_CENTRAL_SIGNATURE)
  view.setUint16(4, 0, true)
  view.setUint16(6, 0, true)
  view.setUint16(8, entryCount, true)
  view.setUint16(10, entryCount, true)
  putUInt32LE(view, 12, centralDirectorySize)
  putUInt32LE(view, 16, centralDirectoryOffset)
  view.setUint16(20, 0, true)
  return endOfCentral
}