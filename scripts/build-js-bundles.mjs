import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const tsupPackageJsonPath = require.resolve('tsup/package.json');
const tsupPackageRoot = dirname(tsupPackageJsonPath);
const tsupPackage = JSON.parse(readFileSync(tsupPackageJsonPath, 'utf8'));
const tsupCliPath = resolve(tsupPackageRoot, tsupPackage.bin.tsup);
const configCount = 5;

/** Build every JS/declaration target sequentially to keep peak memory bounded. */
export function buildJsBundles({ cwd = process.cwd(), silent = false } = {}) {
  for (let index = 0; index < configCount; index += 1) {
    const result = spawnSync(
      process.execPath,
      [tsupCliPath, ...(silent ? ['--silent'] : [])],
      {
        cwd,
        env: {
          ...process.env,
          TSUP_CONFIG_INDEX: String(index),
        },
        stdio: 'inherit',
      },
    );

    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      throw new Error(`tsup config ${index} failed with status ${String(result.status)}`);
    }
  }
}

const isCli =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isCli) {
  try {
    buildJsBundles({ silent: process.argv.includes('--silent') });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
