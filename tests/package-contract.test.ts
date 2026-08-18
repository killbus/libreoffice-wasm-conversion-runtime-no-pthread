import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isForbiddenWorkerPath } from '../scripts/release-runtime/lib/constants.mjs';
import { LIBREOFFICE_BROWSER_ASSET_CONTRACT } from '../src/browser-assets.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(
  readFileSync(resolve(root, 'package.json'), 'utf8'),
) as Record<string, any>;
const buildPackageSource = readFileSync(
  resolve(root, 'scripts/build-package.mjs'),
  'utf8',
);

interface NpmPackDryRunResult {
  files: Array<{ path: string }>;
}

function readPublishedPackagePaths(packageRoot: string): string[] {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const output = execFileSync(
    npm,
    ['pack', '--dry-run', '--json', '--ignore-scripts'],
    { cwd: packageRoot, encoding: 'utf8' },
  );
  const [result] = JSON.parse(output) as NpmPackDryRunResult[];

  if (!result || !Array.isArray(result.files)) {
    throw new Error('npm pack --dry-run did not return a package inventory');
  }

  return result.files.map(({ path }) => path);
}

async function withMaterializedPublishTree(
  run: (packageRoot: string) => Promise<void>,
): Promise<void> {
  const packageRoot = await mkdtemp(join(tmpdir(), 'lo-npm-pack-contract-'));
  const materializedFiles = [
    'README.md',
    'dist/browser.js',
    'dist/browser.d.ts',
    'dist/browser.worker.global.js',
    'dist/browser-assets.js',
    'dist/browser-assets.d.ts',
    'wasm/loader.cjs',
    'wasm/soffice.cjs',
    'wasm/soffice.js',
    'wasm/soffice.data',
    'wasm/soffice.wasm',
  ];

  try {
    await writeFile(
      join(packageRoot, 'package.json'),
      `${JSON.stringify(packageJson, null, 2)}\n`,
    );
    for (const path of materializedFiles) {
      const target = join(packageRoot, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, `fixture:${path}\n`);
    }
    await run(packageRoot);
  } finally {
    await rm(packageRoot, { recursive: true, force: true });
  }
}

describe('published package contract', () => {
  it('uses a fork-specific immutable package identity', () => {
    expect(packageJson.name).toBe('@killbus/libreoffice-converter');
    expect(packageJson.version).toBe('2.7.2-pdfhow.1');
    expect(packageJson.repository.url).toBe(
      'git+https://github.com/killbus/libreoffice-wasm-conversion-runtime.git',
    );
    expect(packageJson.publishConfig).toEqual({ access: 'public' });
  });

  it('builds JS at pack time without native/WASM or install lifecycle work', () => {
    expect(packageJson.scripts.build).toBe('node scripts/build-package.mjs');
    expect(packageJson.scripts.prepack).toBe(
      'node scripts/build-package.mjs --silent',
    );
    expect(packageJson.scripts['verify:native-package']).toBe(
      'node scripts/verify-native-package-assets.mjs',
    );
    expect(buildPackageSource).toContain(
      'await verifyNativePackageAssets({ root: process.cwd() });',
    );
    expect(packageJson.scripts.build).not.toContain('build:wasm');
    expect(packageJson.scripts.prepack).not.toContain('build:wasm');
    expect(packageJson.scripts.prepare).toBeUndefined();
    expect(packageJson.scripts.preinstall).toBeUndefined();
    expect(packageJson.scripts.install).toBeUndefined();
    expect(packageJson.scripts.postinstall).toBeUndefined();
  });

  it('publishes only files compatible with the main-script pthread runtime', () => {
    expect(packageJson.files).toEqual([
      'dist',
      'wasm/loader.cjs',
      'wasm/soffice.cjs',
      'wasm/soffice.js',
      'wasm/soffice.data',
      'wasm/soffice.wasm',
      'README.md',
    ]);
    expect(packageJson.files).not.toContain('wasm/soffice.data.js.metadata');
    expect(packageJson.files).not.toContain('wasm/soffice.worker.js');
    expect(packageJson.files).not.toContain('wasm/soffice.worker.cjs');
  });

  it('audits a materialized npm inventory at every depth', async () => {
    await withMaterializedPublishTree(async (packageRoot) => {
      const publishedPaths = readPublishedPackagePaths(packageRoot);

      expect(publishedPaths).toContain('package.json');
      expect(publishedPaths).toContain('dist/browser.js');
      expect(publishedPaths).toContain('dist/browser.worker.global.js');
      expect(publishedPaths.filter(isForbiddenWorkerPath)).toEqual([]);

      const forbiddenPath = 'dist/nested/runtime/soffice.worker.js';
      const forbiddenTarget = join(packageRoot, forbiddenPath);
      await mkdir(dirname(forbiddenTarget), { recursive: true });
      await writeFile(forbiddenTarget, 'forbidden fixture\n');

      const contaminatedPaths = readPublishedPackagePaths(packageRoot);
      expect(contaminatedPaths.filter(isForbiddenWorkerPath)).toEqual([
        forbiddenPath,
      ]);
    });
  });

  it('exports the typed browser asset contract', () => {
    expect(packageJson.exports['./browser-assets']).toEqual({
      types: './dist/browser-assets.d.ts',
      import: './dist/browser-assets.js',
      default: './dist/browser-assets.js',
    });
    expect(packageJson.typesVersions['*']['browser-assets']).toEqual([
      './dist/browser-assets.d.ts',
    ]);
  });
});

describe('browser asset deployment contract', () => {
  it('is deeply immutable and declares the exact PDFHow deployment inputs', () => {
    expect(Object.isFrozen(LIBREOFFICE_BROWSER_ASSET_CONTRACT)).toBe(true);
    expect(Object.isFrozen(LIBREOFFICE_BROWSER_ASSET_CONTRACT.assets)).toBe(true);
    for (const asset of Object.values(
      LIBREOFFICE_BROWSER_ASSET_CONTRACT.assets,
    )) {
      expect(Object.isFrozen(asset)).toBe(true);
      if (asset.packagePath.startsWith('wasm/')) {
        expect(readFileSync(resolve(root, asset.packagePath)).byteLength).toBeGreaterThan(0);
      }
    }

    expect(LIBREOFFICE_BROWSER_ASSET_CONTRACT).toEqual({
      schemaVersion: 1,
      packageName: '@killbus/libreoffice-converter',
      pthreadWorkerMode: 'main-script',
      assets: {
        browserWorkerJs: {
          key: 'browserWorkerJs',
          packagePath: 'dist/browser.worker.global.js',
          outputName: 'browser.worker.global.js',
          mimeType: 'text/javascript',
        },
        sofficeJs: {
          key: 'sofficeJs',
          packagePath: 'wasm/soffice.js',
          outputName: 'soffice.js',
          mimeType: 'text/javascript',
        },
        sofficeWasm: {
          key: 'sofficeWasm',
          packagePath: 'wasm/soffice.wasm',
          outputName: 'soffice.wasm',
          mimeType: 'application/wasm',
        },
        sofficeData: {
          key: 'sofficeData',
          packagePath: 'wasm/soffice.data',
          outputName: 'soffice.data',
          mimeType: 'application/octet-stream',
        },
      },
    });
  });
});
