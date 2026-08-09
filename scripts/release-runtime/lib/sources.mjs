// Source root inspection: verify files before they enter staging. Source roots
// are runtime parameters; nothing in this module hard-codes a developer path.

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, realpath, stat } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'

export class SourceError extends Error {}

// Throws unless childPath resolves to a strict descendant of parentPath.
export function assertStrictDescendant(parentPath, childPath, label) {
  const resolvedParent = resolve(parentPath)
  const resolvedChild = resolve(childPath)
  const relativePath = relative(resolvedParent, resolvedChild)
  if (
    relativePath === '' ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    relativePath.includes(`${sep}..${sep}`)
  ) {
    throw new SourceError(`${label} must stay inside ${resolvedParent}`)
  }
  return resolvedChild
}

export async function hashFile(filePath) {
  const hash = createHash('sha256')
  await new Promise((resolveStream, rejectStream) => {
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', rejectStream)
    stream.on('end', resolveStream)
  })
  return hash.digest('hex')
}

export async function resolveExistingDirectory(rootPath, label) {
  const resolvedRoot = resolve(rootPath)
  const rootStat = await stat(resolvedRoot).catch(() => undefined)
  if (!rootStat?.isDirectory()) {
    throw new SourceError(`${label} is not a directory: ${resolvedRoot}`)
  }
  return realpath(resolvedRoot)
}

// Inspects one regular source file, rejecting symlinks, non-files, and paths
// that escape the declared source root. Returns { filePath, bytes, sha256 }.
export async function inspectSourceFile(rootPath, relativePath, label) {
  const resolvedRoot = await resolveExistingDirectory(rootPath, `${label} root`)
  const filePath = assertStrictDescendant(
    resolvedRoot,
    resolve(resolvedRoot, relativePath),
    `Source for ${label}`
  )

  const fileLstat = await lstat(filePath).catch(() => undefined)
  if (!fileLstat?.isFile() || fileLstat.isSymbolicLink()) {
    throw new SourceError(`Required file is missing: ${filePath}`)
  }

  const realFilePath = await realpath(filePath)
  assertStrictDescendant(resolvedRoot, realFilePath, `Resolved source for ${label}`)
  if (resolve(realFilePath) !== filePath) {
    throw new SourceError(`${label} must not traverse a symbolic link: ${filePath}`)
  }

  const fileStat = await stat(filePath)
  return {
    filePath,
    bytes: fileStat.size,
    sha256: await hashFile(filePath),
    expectedBytes: fileLstat.size,
  }
}