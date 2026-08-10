// Fail-closed GitHub CLI wrapper used by the staged draft-release automation.
// Every call is explicit; nothing here ever mutates an existing asset.

import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { readFile } from 'node:fs/promises'

export class GhError extends Error {}

// Runs gh and captures stdout as a string (JSON by default).
export function runGh(args, { json = true, cwd } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('gh', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd,
      env: process.env,
      shell: false,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', (error) => reject(error))
    child.on('close', (code) => {
      if (code !== 0) {
        reject(
          new GhError(
            `gh ${args.join(' ')} failed (${code}): ${stderr.trim() || stdout.trim()}`
          )
        )
        return
      }
      try {
        resolvePromise(json ? JSON.parse(stdout) : stdout)
      } catch (error) {
        reject(new GhError(`gh ${args.join(' ')} returned invalid JSON`))
      }
    })
  })
}

// Runs gh and pipes raw stdout bytes into a file (used to download binary
// release assets through the octet-stream API without text decoding).
export function runGhToFile(args, filePath) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('gh', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
      shell: false,
    })
    const out = createWriteStream(filePath)
    child.stdout.pipe(out)
    let stderr = ''
    let failed = false
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', (error) => {
      failed = true
      out.destroy(error)
      reject(error)
    })
    out.on('error', (error) => {
      failed = true
      child.kill()
      reject(error)
    })
    child.on('close', (code) => {
      if (code !== 0) {
        failed = true
        out.destroy()
        reject(
          new GhError(`gh ${args.join(' ')} failed (${code}): ${stderr.trim()}`)
        )
        return
      }
      out.end()
    })
    out.on('finish', () => {
      if (!failed) {
        resolvePromise()
      }
    })
  })
}

// Reads the operator's GitHub token without printing it.
export async function ghToken() {
  return (await runGh(['auth', 'token'], { json: false })).trim()
}

// Uploads one release asset directly to the uploads API. Draft releases
// (no tag ref) cannot be addressed by `gh release upload <tag>`, and the
// `api.github.com/releases/{id}/assets` POST is not followed correctly by gh.
// The uploads API returns the asset object with a server-side `digest`.
export async function uploadReleaseAsset({
  repo,
  releaseId,
  name,
  filePath,
  contentType = 'application/octet-stream',
}) {
  const token = await ghToken()
  const body = await readFile(filePath)
  const endpoint = `https://uploads.github.com/repos/${repo}/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': contentType,
    },
    body,
  })
  if (!response.ok) {
    throw new GhError(
      `release asset upload failed (${response.status}): ${(await response.text()).slice(0, 500)}`
    )
  }
  return response.json()
}