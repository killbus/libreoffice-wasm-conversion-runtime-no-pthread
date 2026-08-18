import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const exampleUrls = [
  new URL('../examples/node-conversion.mjs', import.meta.url),
  new URL('../examples/test-csv-direct.mjs', import.meta.url),
];

describe('Node conversion examples', () => {
  it.each(exampleUrls)('uses the public converter facade and parses: %s', (url) => {
    const source = readFileSync(url, 'utf8');
    const syntaxCheck = spawnSync(
      process.execPath,
      ['--check', fileURLToPath(url)],
      { encoding: 'utf8' },
    );

    expect(source).toMatch(/import\s*{[^}]*createConverter[^}]*}\s*from\s*['"]\.\.\/dist\/index\.js['"]/s);
    expect(source).not.toContain('LibreOfficeConverter');
    expect(syntaxCheck.stderr).toBe('');
    expect(syntaxCheck.status).toBe(0);
  });
});
