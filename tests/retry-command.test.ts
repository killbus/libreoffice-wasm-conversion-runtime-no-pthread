import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const retryCommand = new URL('../scripts/retry-command.sh', import.meta.url).pathname;

function makeCounterCommand(exitAfter: number, finalStatus = 0) {
  const root = mkdtempSync(join(tmpdir(), 'retry-command-'));
  const counterPath = join(root, 'count');
  const commandPath = join(root, 'command.sh');
  writeFileSync(counterPath, '0\n');
  writeFileSync(commandPath, `#!/usr/bin/env bash
count=$(cat "$1")
count=$((count + 1))
echo "$count" > "$1"
if [ "$count" -lt ${exitAfter} ]; then
  exit 75
fi
exit ${finalStatus}
`, { mode: 0o755 });
  return { counterPath, commandPath };
}

describe('retry-command', () => {
  it('retries transient failures until the command succeeds', () => {
    const { counterPath, commandPath } = makeCounterCommand(3);
    const result = spawnSync('bash', [retryCommand, commandPath, counterPath], {
      encoding: 'utf8',
      env: {
        ...process.env,
        RETRY_ATTEMPTS: '4',
        RETRY_INITIAL_DELAY_SECONDS: '0',
        RETRY_MAX_DELAY_SECONDS: '0',
      },
    });

    expect(result.status).toBe(0);
    expect(readFileSync(counterPath, 'utf8').trim()).toBe('3');
    expect(result.stderr).toContain('transient failure 1/4 (exit 75)');
    expect(result.stderr).toContain('transient failure 2/4 (exit 75)');
  });

  it('preserves the final exit status after exhausting attempts', () => {
    const { counterPath, commandPath } = makeCounterCommand(9, 42);
    const result = spawnSync('bash', [retryCommand, commandPath, counterPath], {
      encoding: 'utf8',
      env: {
        ...process.env,
        RETRY_ATTEMPTS: '3',
        RETRY_INITIAL_DELAY_SECONDS: '0',
        RETRY_MAX_DELAY_SECONDS: '0',
      },
    });

    expect(result.status).toBe(75);
    expect(readFileSync(counterPath, 'utf8').trim()).toBe('3');
    expect(result.stderr).toContain('failed after 3 attempts (exit 75)');
  });
});
