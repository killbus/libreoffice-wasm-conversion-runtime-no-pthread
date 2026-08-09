// Deterministic ZIP writer (design.md §5).
//
// Byte-level determinism guarantees:
//   - entries are sorted by normalized POSIX relative path (localeCompare);
//   - every entry uses the same fixed DOS timestamp (1980-01-01 00:00:00);
//   - every entry is STORED (method 0), so the output never depends on the
//     host zlib/deflate version;
//   - no extra fields, no comments, zero external attributes, fixed
//     versionMadeBy / versionNeededToExtract;
//   - only regular-file entries are emitted; paths are relative POSIX paths.

import {
  FIXED_DOS_TIME,
  FIXED_DOS_DATE,
  ZIP_METHOD_STORE,
} from './constants.mjs'
import { crc32 } from './crc32.mjs'

export class ZipWriteError extends Error {}

const LOCAL_HEADER_SIGNATURE = 0x04034b50
const CENTRAL_HEADER_SIGNATURE = 0x02014b50
const END_OF_CENTRAL_SIGNATURE = 0x06054b50
const VERSION_NEEDED = 20
const UTF8_FLAG = 0x0800

function assertSafeEntryPath(path) {
  if (typeof path !== 'string' || path.length === 0) {
    throw new ZipWriteError('entry path must be a non-empty string')
  }
  if (path.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(path)) {
    throw new ZipWriteError(`absolute entry path is not allowed: ${path}`)
  }
  if (path.includes('\\') || path.includes('\0')) {
    throw new ZipWriteError(`invalid entry path separator or byte: ${path}`)
  }
  const segments = path.split('/')
  if (
    segments.some((segment) => segment === '..' || segment === '.') ||
    segments.some((segment) => segment.length === 0)
  ) {
    throw new ZipWriteError(`unsafe entry path: ${path}`)
  }
}

function putUInt16(view, offset, value) {
  view.setUint16(offset, value, true)
}

function putUInt32(view, offset, value) {
  view.setUint32(offset, value, true)
}

function buildEntryBlob(path, bytes) {
  assertSafeEntryPath(path)
  if (!(bytes instanceof Uint8Array)) {
    throw new ZipWriteError(`entry ${path} must provide a byte buffer`)
  }
  const nameBytes = Buffer.from(path, 'utf8')
  const nameLength = nameBytes.length
  const crc = crc32(bytes)
  const headerLength = 30 + nameLength

  const local = Buffer.alloc(headerLength)
  const view = new DataView(local.buffer, local.byteOffset, local.byteLength)
  putUInt32(view, 0, LOCAL_HEADER_SIGNATURE)
  putUInt16(view, 4, VERSION_NEEDED)
  putUInt16(view, 6, UTF8_FLAG)
  putUInt16(view, 8, ZIP_METHOD_STORE)
  putUInt16(view, 10, FIXED_DOS_TIME)
  putUInt16(view, 12, FIXED_DOS_DATE)
  putUInt32(view, 14, crc)
  putUInt32(view, 18, bytes.length)
  putUInt32(view, 22, bytes.length)
  putUInt16(view, 26, nameLength)
  putUInt16(view, 28, 0)
  nameBytes.copy(local, 30)

  const central = Buffer.alloc(46 + nameLength)
  const centralView = new DataView(
    central.buffer,
    central.byteOffset,
    central.byteLength
  )
  putUInt32(centralView, 0, CENTRAL_HEADER_SIGNATURE)
  putUInt16(centralView, 4, VERSION_NEEDED)
  putUInt16(centralView, 6, VERSION_NEEDED)
  putUInt16(centralView, 8, UTF8_FLAG)
  putUInt16(centralView, 10, ZIP_METHOD_STORE)
  putUInt16(centralView, 12, FIXED_DOS_TIME)
  putUInt16(centralView, 14, FIXED_DOS_DATE)
  putUInt32(centralView, 16, crc)
  putUInt32(centralView, 20, bytes.length)
  putUInt32(centralView, 24, bytes.length)
  putUInt16(centralView, 28, nameLength)
  putUInt16(centralView, 30, 0)
  putUInt16(centralView, 32, 0)
  putUInt16(centralView, 34, 0)
  putUInt16(centralView, 36, 0)
  putUInt32(centralView, 38, 0)
  putUInt32(centralView, 42, 0) // relative offset filled in later
  nameBytes.copy(central, 46)

  return { name: path, nameBytes, crc, local, central, data: bytes }
}

// entries: [{ path, bytes }]. Returns the deterministic ZIP as a Buffer.
export function createDeterministicZip(entries) {
  const normalized = entries.map((entry) => entry)
  const seenPaths = new Set()
  for (const entry of normalized) {
    if (seenPaths.has(entry.path)) {
      throw new ZipWriteError(`duplicate entry path: ${entry.path}`)
    }
    seenPaths.add(entry.path)
  }
  normalized.sort((left, right) => left.path.localeCompare(right.path))

  let localOffset = 0
  const centralBlobs = []
  const localParts = []
  for (const entry of normalized) {
    const blob = buildEntryBlob(entry.path, entry.bytes)
    // Patch the central directory local-header offset.
    const offsetView = new DataView(
      blob.central.buffer,
      blob.central.byteOffset + 42,
      4
    )
    offsetView.setUint32(0, localOffset, true)
    localParts.push(blob.local, blob.data)
    centralBlobs.push(blob.central)
    localOffset += blob.local.length + blob.data.length
  }

  const centralSize = centralBlobs.reduce((sum, part) => sum + part.length, 0)
  const entryCount = normalized.length
  const endOfCentral = Buffer.alloc(22)
  const endView = new DataView(
    endOfCentral.buffer,
    endOfCentral.byteOffset,
    endOfCentral.byteLength
  )
  putUInt32(endView, 0, END_OF_CENTRAL_SIGNATURE)
  putUInt16(endView, 4, 0)
  putUInt16(endView, 6, 0)
  putUInt16(endView, 8, entryCount)
  putUInt16(endView, 10, entryCount)
  putUInt32(endView, 12, centralSize)
  putUInt32(endView, 16, localOffset)
  putUInt16(endView, 20, 0)

  return Buffer.concat([...localParts, ...centralBlobs, endOfCentral])
}