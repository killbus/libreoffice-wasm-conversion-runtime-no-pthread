import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  expectedLokExports,
  findMissingGlueBindings,
  findLokExportDrift,
  verifyNativePackageAssets,
} from '../scripts/verify-native-package-assets.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const candidateSpec = JSON.parse(
  readFileSync(
    resolve(root, 'scripts/release-runtime/qualified-candidate-spec.json'),
    'utf8',
  ),
);

describe('native package asset gate', () => {
  it('binds the package bytes and glue to the qualified no-pthread candidate', async () => {
    const report = await verifyNativePackageAssets({ root, spec: candidateSpec });

    expect(report.candidateId).toBe(
      'c1fe3173b26a9eab9ef169fe91961bd32fceadbc9b1423ac8b1c8178f577eeb9',
    );
    expect(report.assets.map((asset) => asset.path)).toEqual([
      'wasm/soffice.cjs',
      'wasm/soffice.data',
      'wasm/soffice.js',
      'wasm/soffice.wasm',
    ]);
    expect(report.expectedLokExports).toEqual(expectedLokExports);
  });

  it('fails closed before packaging when a native asset is stale', async () => {
    const staleSpec = structuredClone(candidateSpec);
    const glue = staleSpec.assets.find(
      (asset: { path: string }) => asset.path === 'wasm/soffice.cjs',
    );
    glue.sha256 = '0'.repeat(64);

    await expect(
      verifyNativePackageAssets({ root, spec: staleSpec }),
    ).rejects.toThrow(/wasm\/soffice\.cjs has SHA-256 .* candidate requires 0{64}/);
  });

  it('requires both Emscripten glue bindings', () => {
    expect(
      findMissingGlueBindings('Module["_lok_convertDocument"];'),
    ).toEqual(['_lok_convertFree']);
  });

  it('rejects missing and extra LibreOfficeKit exports', () => {
    expect(findLokExportDrift(expectedLokExports)).toEqual({
      actual: [...expectedLokExports].sort(),
      missing: [],
      extra: [],
    });
    expect(findLokExportDrift([
      ...expectedLokExports.filter((name) => name !== 'lok_documentSaveAs'),
      'lok_documentPaintTile',
    ])).toMatchObject({
      missing: ['lok_documentSaveAs'],
      extra: ['lok_documentPaintTile'],
    });
  });
});
