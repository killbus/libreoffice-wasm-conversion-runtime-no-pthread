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
  '85a039aba424bedba15c75728d071aeaa678314ae4e161e88394674755009190';

describe('release-only qualified runtime source', () => {
  it('selects the same qualified no-pthread candidate used for staging', () => {
    expect(candidateSpec.candidateId).toBe(candidateId);
    expect(qualifiedSpec.candidateId).toBe(candidateId);
    expect(candidateSpec.runtime).toEqual({
      threading: 'none',
      capabilities: { dynamicFontProfiles: 1 },
    });
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
      releaseId: '382252828',
      releaseAssetId: '543184129',
      releaseAssetBytes: 247029040,
      releaseAssetSha256:
        '3f19475b0eeff1706f2b23b778b5e310bee9cf987e6a4ce75c5a2c295a3f3b94',
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

  it('keeps one real DOCX to PDF conversion in regular CI', () => {
    expect(packageJson.scripts['test:ci-conversion']).toContain(
      'tests/converter-gate.test.ts',
    );
    expect(packageJson.scripts['test:ci-conversion']).toContain(
      'converts test.docx to a valid PDF',
    );
    for (const path of ['.github/workflows/ci.yml', '.github/workflows/publish.yml']) {
      const source = readText(path);
      expect(source, path).toContain('npm run test:ci-conversion');
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
