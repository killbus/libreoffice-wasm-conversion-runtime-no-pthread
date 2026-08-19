import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (path: string) =>
  JSON.parse(readFileSync(resolve(root, path), 'utf8'));

const workflow = readFileSync(
  resolve(root, '.github/workflows/ci.yml'),
  'utf8',
);
const legacySpec = readJson('scripts/release-runtime/candidate-spec.json');
const qualifiedSpec = readJson(
  'scripts/release-runtime/qualified-candidate-spec.json',
);
const runtimeSource = readJson(
  'scripts/release-runtime/qualified-runtime-source.json',
);

describe('LFS-free CI runtime source', () => {
  it('preserves the legacy candidate while selecting the qualified successor', () => {
    expect(legacySpec.candidateId).toBe(
      '21fcdfd7e9f49efc08c6ba56c13337cc0be59a9b496f5424adbe57e0fb4a6e7b',
    );
    expect(qualifiedSpec.candidateId).toBe(
      '70c87563cbcf8c9f032120d8f8847602a9560ddcd2d13c84831cfab4cd170c68',
    );
    expect(runtimeSource.candidateId).toBe(qualifiedSpec.candidateId);
    expect(runtimeSource.specPath).toBe(
      'scripts/release-runtime/qualified-candidate-spec.json',
    );
  });

  it('pins the publicly qualified asset by ID, size, and SHA-256', () => {
    expect(runtimeSource).toMatchObject({
      candidateQualified: true,
      releaseQualified: true,
      draft: false,
      releaseId: '372605136',
      releaseAssetId: '519905261',
      releaseAssetBytes: 248884128,
      releaseAssetSha256:
        '457c9e32cd2df330abcaf78f4698011087c2f167362e8541519bb84031fc9534',
    });
    expect(runtimeSource.releaseAssetName).toBe(
      qualifiedSpec.expectedPayloadArchiveName,
    );
  });

  it('downloads, verifies, and materializes the runtime without Git LFS', () => {
    expect(workflow).toContain('lfs: false');
    expect(workflow).not.toContain('lfs: true');
    expect(workflow).toContain('releases/assets/$runtime_asset_id');
    expect(workflow).toContain('sha256sum --check --strict');
    expect(workflow).toContain('scripts/release-runtime/verify.mjs');
    expect(workflow).toContain('cp "$runtime_extract/wasm/$runtime_asset"');
    expect(workflow).not.toContain('npm run build:wasm');
  });
});
