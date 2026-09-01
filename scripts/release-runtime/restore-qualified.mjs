#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
} from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import https from 'node:https'
import { validateFrozenSpec } from './lib/schemata.mjs'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, '../..')
const DEFAULT_SOURCE = join(SCRIPT_DIR, 'qualified-runtime-source.json')
const DEFAULT_CACHE_ROOT =
  process.env.LIBREOFFICE_RUNTIME_CACHE_DIR ??
  join(process.env.RUNNER_TEMP ?? join(homedir(), '.cache'), 'libreoffice-wasm-runtime')
const DEFAULT_ATTEMPTS = 8
const DEFAULT_INITIAL_DELAY_MS = 2_000
const DEFAULT_MAX_DELAY_MS = 30_000

const USAGE = `Usage:
  node scripts/release-runtime/restore-qualified.mjs \\
    [--source <qualified-runtime-source.json>] \\
    [--root <repository-root>] \\
    [--cache-root <cache-directory>] \\
    [--archive <already-downloaded-archive>]`

function fail(message) {
  throw new Error(`Qualified runtime restore failed: ${message}`)
}

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (key === '--help' || key === '-h') {
      process.stdout.write(`${USAGE}\n`)
      process.exit(0)
    }
    if (!['--source', '--root', '--cache-root', '--archive'].includes(key)) {
      fail(`unknown option ${key}\n${USAGE}`)
    }
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) {
      fail(`${key} requires a value\n${USAGE}`)
    }
    args[key.slice(2)] = value
    index += 1
  }
  return args
}

export function validateQualifiedRuntimeSource(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('source metadata must be an object')
  }
  const requiredStrings = [
    'candidateId',
    'repository',
    'releaseAssetId',
    'releaseAssetName',
    'releaseAssetSha256',
    'specPath',
  ]
  for (const key of requiredStrings) {
    if (typeof value[key] !== 'string' || value[key].length === 0) {
      fail(`source metadata ${key} must be a non-empty string`)
    }
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(value.repository)) {
    fail(`source repository is invalid: ${value.repository}`)
  }
  if (!/^\d+$/.test(value.releaseAssetId)) {
    fail(`source releaseAssetId is invalid: ${value.releaseAssetId}`)
  }
  if (!/^[a-f0-9]{64}$/.test(value.candidateId)) {
    fail(`source candidateId is invalid: ${value.candidateId}`)
  }
  if (!/^[a-f0-9]{64}$/.test(value.releaseAssetSha256)) {
    fail(`source releaseAssetSha256 is invalid: ${value.releaseAssetSha256}`)
  }
  if (!Number.isSafeInteger(value.releaseAssetBytes) || value.releaseAssetBytes <= 0) {
    fail('source releaseAssetBytes must be a positive safe integer')
  }
  if (
    value.candidateQualified !== true ||
    value.releaseQualified !== true ||
    value.draft !== false
  ) {
    fail('source must identify a published, qualified candidate and release')
  }
  return value
}

async function hashFile(path) {
  const hash = createHash('sha256')
  const input = createReadStream(path)
  for await (const chunk of input) {
    hash.update(chunk)
  }
  return hash.digest('hex')
}

async function verifyFile(path, expectedBytes, expectedSha256, label) {
  let fileStat
  try {
    fileStat = await stat(path)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      fail(`${label} is missing at ${path}`)
    }
    throw error
  }
  if (!fileStat.isFile() || fileStat.size !== expectedBytes) {
    fail(`${label} has ${fileStat.size} bytes; expected ${expectedBytes}`)
  }
  const actualSha256 = await hashFile(path)
  if (actualSha256 !== expectedSha256) {
    fail(`${label} has SHA-256 ${actualSha256}; expected ${expectedSha256}`)
  }
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))
}

function requestHeaders(url) {
  const headers = {
    Accept: 'application/octet-stream',
    'User-Agent': 'libreoffice-wasm-runtime-restore',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN
  if (token && url.hostname === 'api.github.com') {
    headers.Authorization = `Bearer ${token}`
  }
  return headers
}

async function downloadOnce(url, destination, redirectsRemaining = 10) {
  await new Promise((resolvePromise, rejectPromise) => {
    const request = https.get(url, { headers: requestHeaders(url) }, (response) => {
      const status = response.statusCode ?? 0
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume()
        if (redirectsRemaining === 0) {
          rejectPromise(new Error('too many redirects'))
          return
        }
        const redirectUrl = new URL(response.headers.location, url)
        if (redirectUrl.protocol !== 'https:') {
          rejectPromise(new Error(`refusing non-HTTPS redirect to ${redirectUrl.origin}`))
          return
        }
        downloadOnce(redirectUrl, destination, redirectsRemaining - 1).then(
          resolvePromise,
          rejectPromise,
        )
        return
      }
      if (status !== 200) {
        response.resume()
        rejectPromise(new Error(`HTTP ${status}`))
        return
      }
      pipeline(response, createWriteStream(destination)).then(resolvePromise, rejectPromise)
    })
    request.setTimeout(120_000, () => request.destroy(new Error('request timed out')))
    request.once('error', rejectPromise)
  })
}

function positiveIntegerFromEnv(name, fallback) {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail(`${name} must be a positive integer`)
  }
  return value
}

async function downloadWithRetry(url, destination) {
  const attempts = positiveIntegerFromEnv('RETRY_ATTEMPTS', DEFAULT_ATTEMPTS)
  let delay = positiveIntegerFromEnv(
    'RETRY_INITIAL_DELAY_MS',
    DEFAULT_INITIAL_DELAY_MS,
  )
  const maxDelay = positiveIntegerFromEnv('RETRY_MAX_DELAY_MS', DEFAULT_MAX_DELAY_MS)
  let lastError

  try {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      await rm(destination, { force: true })
      try {
        await downloadOnce(url, destination)
        return
      } catch (error) {
        lastError = error
        if (attempt === attempts) {
          break
        }
        console.error(
          `[runtime:restore] transient download failure ${attempt}/${attempts}: ${error.message}; retrying in ${delay}ms`,
        )
        await sleep(delay)
        delay = Math.min(delay * 2, maxDelay)
      }
    }
    throw lastError
  } catch (error) {
    await rm(destination, { force: true })
    throw error
  }
}

async function runCommand(command, args) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { stdio: 'inherit' })
    child.once('error', rejectPromise)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise()
      } else {
        rejectPromise(
          new Error(`${command} exited with ${code ?? `signal ${signal}`}`),
        )
      }
    })
  })
}

async function loadMetadata(sourcePath) {
  const source = validateQualifiedRuntimeSource(
    JSON.parse(await readFile(sourcePath, 'utf8')),
  )
  const specPath = resolve(REPO_ROOT, source.specPath)
  const spec = validateFrozenSpec(JSON.parse(await readFile(specPath, 'utf8')))
  if (spec.candidateId !== source.candidateId) {
    fail(`source candidate ${source.candidateId} does not match spec ${spec.candidateId}`)
  }
  if (spec.expectedPayloadArchiveName !== source.releaseAssetName) {
    fail('source asset name does not match the qualified candidate spec')
  }
  return { source, spec }
}

export async function restoreQualifiedRuntime(options = {}) {
  const sourcePath = resolve(options.sourcePath ?? DEFAULT_SOURCE)
  const destinationRoot = resolve(options.root ?? REPO_ROOT)
  const cacheRoot = resolve(options.cacheRoot ?? DEFAULT_CACHE_ROOT)
  const { source, spec } = await loadMetadata(sourcePath)
  const cachedArchive = join(cacheRoot, source.candidateId, source.releaseAssetName)
  const archivePath = options.archivePath ? resolve(options.archivePath) : cachedArchive

  await mkdir(dirname(cachedArchive), { recursive: true })
  if (!options.archivePath) {
    let cacheValid = true
    try {
      await verifyFile(
        cachedArchive,
        source.releaseAssetBytes,
        source.releaseAssetSha256,
        'cached release archive',
      )
    } catch {
      cacheValid = false
    }
    if (!cacheValid) {
      const partial = `${cachedArchive}.partial-${process.pid}`
      const url = new URL(
        `https://api.github.com/repos/${source.repository}/releases/assets/${source.releaseAssetId}`,
      )
      console.log(`[runtime:restore] downloading ${source.releaseAssetName}`)
      await downloadWithRetry(url, partial)
      await verifyFile(
        partial,
        source.releaseAssetBytes,
        source.releaseAssetSha256,
        'downloaded release archive',
      )
      await rename(partial, cachedArchive)
    } else {
      console.log(`[runtime:restore] using verified cache ${cachedArchive}`)
    }
  }

  await verifyFile(
    archivePath,
    source.releaseAssetBytes,
    source.releaseAssetSha256,
    'qualified release archive',
  )

  const extractRoot = await mkdtemp(join(tmpdir(), 'lo-runtime-restore-'))
  try {
    await runCommand('unzip', ['-qq', archivePath, '-d', extractRoot])
    const runtimeAssets = spec.assets.filter((asset) => asset.path.startsWith('wasm/'))
    for (const asset of runtimeAssets) {
      await verifyFile(
        join(extractRoot, asset.path),
        asset.bytes,
        asset.sha256,
        `extracted ${asset.path}`,
      )
    }
    for (const asset of runtimeAssets) {
      const destination = join(destinationRoot, asset.path)
      await mkdir(dirname(destination), { recursive: true })
      await copyFile(join(extractRoot, asset.path), destination)
    }
    console.log(
      `[runtime:restore] restored ${runtimeAssets.length} assets for ${source.candidateId}`,
    )
    return {
      candidateId: source.candidateId,
      assets: runtimeAssets.map(({ path }) => path),
    }
  } finally {
    await rm(extractRoot, { recursive: true, force: true })
  }
}

const isCli =
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url

if (isCli) {
  const args = parseArgs(process.argv.slice(2))
  restoreQualifiedRuntime({
    sourcePath: args.source,
    root: args.root,
    cacheRoot: args['cache-root'],
    archivePath: args.archive,
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
