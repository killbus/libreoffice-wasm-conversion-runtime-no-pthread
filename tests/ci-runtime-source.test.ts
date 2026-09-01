import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateQualifiedRuntimeSource } from '../scripts/release-runtime/restore-qualified.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readText = (path: string) => readFileSync(resolve(root, path), 'utf8');
const readJson = (path: string) => JSON.parse(readText(path));

const workflowPaths = [
  '.github/workflows/ci.yml',
  '.github/workflows/publish.yml',
  '.github/workflows/pages.yml',
  '.github/workflows/font-bundles.yml',
];
const workflows = workflowPaths.map((path) => ({ path, source: readText(path) }));
const candidateSpec = readJson('scripts/release-runtime/candidate-spec.json');
const qualifiedSpec = readJson(
  'scripts/release-runtime/qualified-candidate-spec.json',
);
const runtimeSource = readJson(
  'scripts/release-runtime/qualified-runtime-source.json',
);
const packageJson = readJson('package.json');
const attributes = readText('.gitattributes');
const ignore = readText('.gitignore');

const candidateId =
  'c1fe3173b26a9eab9ef169fe91961bd32fceadbc9b1423ac8b1c8178f577eeb9';

describe('release-only qualified runtime source', () => {
  it('selects the same qualified no-pthread candidate used for staging', () => {
    expect(candidateSpec.candidateId).toBe(candidateId);
    expect(qualifiedSpec.candidateId).toBe(candidateId);
    expect(candidateSpec.runtime).toEqual({ threading: 'none' });
    expect(qualifiedSpec).toEqual(candidateSpec);
    expect(runtimeSource.candidateId).toBe(qualifiedSpec.candidateId);
    expect(runtimeSource.specPath).toBe(
      'scripts/release-runtime/qualified-candidate-spec.json',
    );
  });

  it('pins the public qualified asset and its repository', () => {
    expect(validateQualifiedRuntimeSource(runtimeSource)).toBe(runtimeSource);
    expect(runtimeSource).toMatchObject({
      repository: 'killbus/libreoffice-wasm-conversion-runtime-no-pthread',
      candidateQualified: true,
      releaseQualified: true,
      draft: false,
      releaseId: '379978707',
      releaseAssetId: '538393011',
      releaseAssetBytes: 246978336,
      releaseAssetSha256:
        '6b8b31cf5bb8753e5937145c24006348ff81622a95faa7c580a82647c46fbf2c',
    });
    expect(runtimeSource.releaseAssetName).toBe(
      qualifiedSpec.expectedPayloadArchiveName,
    );
  });

  it('restores the runtime in every consumer without Git LFS', () => {
    expect(packageJson.scripts['runtime:restore']).toBe(
      'node scripts/release-runtime/restore-qualified.mjs',
    );
    expect(attributes).not.toContain('filter=lfs');
    expect(ignore).toContain('wasm/*.wasm');
    expect(ignore).toContain('wasm/*.data');

    for (const { path, source } of workflows) {
      expect(source, path).toContain('lfs: false');
      expect(source, path).not.toContain('lfs: true');
      expect(source, path).toContain('npm run runtime:restore');
      expect(source, path).not.toContain('npm run build:wasm');
    }
  });

  it('keeps npm publication explicitly disarmed until credentials are configured', () => {
    const publishWorkflow = readText('.github/workflows/publish.yml');
    expect(publishWorkflow).toContain(
      "vars.NPM_PUBLISH_ENABLED == 'true'",
    );
    expect(publishWorkflow).toContain(
      'NPM_TOKEN: ${{ secrets.NPM_TOKEN }}',
    );
  });

  it('retries every failed release download without exposing credentials', () => {
    const restoreSource = readText(
      'scripts/release-runtime/restore-qualified.mjs',
    );
    expect(restoreSource).toContain('DEFAULT_ATTEMPTS = 8');
    expect(restoreSource).toContain('status !== 200');
    expect(restoreSource).toContain('transient download failure');
    expect(restoreSource).not.toContain('console.log(token)');
  });
});
