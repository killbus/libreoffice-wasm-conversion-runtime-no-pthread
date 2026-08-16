import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { verifyNativePackageAssets } from './verify-native-package-assets.mjs';

const require = createRequire(import.meta.url);
const tsupPackageJsonPath = require.resolve('tsup/package.json');
const tsupPackageRoot = dirname(tsupPackageJsonPath);
const tsupPackage = JSON.parse(readFileSync(tsupPackageJsonPath, 'utf8'));
const tsupCliPath = resolve(tsupPackageRoot, tsupPackage.bin.tsup);
const silent = process.argv.includes('--silent');
const configCount = 5;

await verifyNativePackageAssets({ root: process.cwd() });

for (let index = 0; index < configCount; index += 1) {
  const result = spawnSync(
    process.execPath,
    [tsupCliPath, ...(silent ? ['--silent'] : [])],
    {
      cwd: process.cwd(),
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
    process.exit(result.status ?? 1);
  }
}
