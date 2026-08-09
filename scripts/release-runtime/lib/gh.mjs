// Fail-closed GitHub CLI wrapper used by the staged draft-release automation.
// Every call is explicit; nothing here ever mutates an existing asset.

import { spawn } from 'node:child_process'

export class GhError extends Error {}

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