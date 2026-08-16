import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  findMissingGlueBindings,
  verifyNativePackageAssets,
} from '../scripts/verify-native-package-assets.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const candidateSpec = JSON.parse(
  readFileSync(
    resolve(root, 'scripts/release-runtime/candidate-spec.json'),
    'utf8',
  ),
);

describe('native package asset gate', () => {
  it('binds the package bytes and glue to the frozen native bridge candidate', async () => {
    const report = await verifyNativePackageAssets({ root, spec: candidateSpec });

    expect(report.candidateId).toBe(
      '21fcdfd7e9f49efc08c6ba56c13337cc0be59a9b496f5424adbe57e0fb4a6e7b',
    );
    expect(report.assets.map((asset) => asset.path)).toEqual([
      'wasm/soffice.cjs',
      'wasm/soffice.data',
      'wasm/soffice.js',
      'wasm/soffice.wasm',
    ]);
    expect(report.requiredNativeExports).toEqual([
      'lok_convertDocument',
      'lok_convertFree',
    ]);
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
});