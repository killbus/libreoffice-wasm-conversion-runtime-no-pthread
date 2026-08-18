import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultRoot = resolve(scriptDirectory, '..');
const defaultSpecPath = resolve(
  defaultRoot,
  'scripts/release-runtime/candidate-spec.json',
);

const expectedNativePaths = Object.freeze([
  'wasm/soffice.cjs',
  'wasm/soffice.data',
  'wasm/soffice.js',
  'wasm/soffice.wasm',
]);
export const expectedLokExports = Object.freeze([
  'lok_abortOperation',
  'lok_convertDocument',
  'lok_convertFree',
  'lok_destroy',
  'lok_documentDestroy',
  'lok_documentLoad',
  'lok_documentLoadWithOptions',
  'lok_documentSaveAs',
  'lok_getError',
  'lok_getOperationState',
  'lok_preinit',
  'lok_preinit_2',
  'lok_resetAbort',
  'lok_setOperationTimeout',
]);
const requiredGlueBindings = Object.freeze([
  '_lok_convertDocument',
  '_lok_convertFree',
]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function fail(message) {
  throw new Error(`Native package asset verification failed: ${message}`);
}

export function findMissingGlueBindings(source) {
  return requiredGlueBindings.filter(
    (binding) => !source.includes(`Module["${binding}"]`),
  );
}

export function findLokExportDrift(exportNames) {
  const actual = [...new Set(exportNames)]
    .filter((name) => name.startsWith('lok_'))
    .sort();
  const expected = [...expectedLokExports].sort();
  return {
    actual,
    missing: expected.filter((name) => !actual.includes(name)),
    extra: actual.filter((name) => !expected.includes(name)),
  };
}

export async function verifyNativePackageAssets({
  root = defaultRoot,
  specPath = defaultSpecPath,
  spec,
} = {}) {
  const frozenSpec =
    spec ?? JSON.parse(await readFile(resolve(specPath), 'utf8'));
  const nativeAssets = frozenSpec.assets
    .filter((asset) => asset.sourceRoot === 'native')
    .sort((left, right) => left.path.localeCompare(right.path));
  const nativePaths = nativeAssets.map((asset) => asset.path);

  if (JSON.stringify(nativePaths) !== JSON.stringify(expectedNativePaths)) {
    fail(
      `candidate ${frozenSpec.candidateId ?? '<unknown>'} declares native paths ${JSON.stringify(nativePaths)}; expected ${JSON.stringify(expectedNativePaths)}`,
    );
  }

  const verifiedAssets = [];
  const assetBytes = new Map();
  for (const asset of nativeAssets) {
    const absolutePath = resolve(root, asset.path);
    const bytes = await readFile(absolutePath);
    const actualHash = sha256(bytes);

    if (bytes.byteLength !== asset.bytes) {
      fail(
        `${asset.path} has ${bytes.byteLength} bytes; candidate requires ${asset.bytes}`,
      );
    }
    if (actualHash !== asset.sha256) {
      fail(
        `${asset.path} has SHA-256 ${actualHash}; candidate requires ${asset.sha256}`,
      );
    }

    assetBytes.set(asset.path, bytes);
    verifiedAssets.push({
      path: asset.path,
      bytes: bytes.byteLength,
      sha256: actualHash,
    });
  }

  const wasmBytes = assetBytes.get('wasm/soffice.wasm');
  let wasmModule;
  try {
    wasmModule = new WebAssembly.Module(wasmBytes);
  } catch (error) {
    fail(
      `wasm/soffice.wasm could not be parsed by WebAssembly.Module: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const wasmExports = new Set(
    WebAssembly.Module.exports(wasmModule).map((entry) => entry.name),
  );
  const lokExportDrift = findLokExportDrift(wasmExports);
  if (lokExportDrift.missing.length > 0 || lokExportDrift.extra.length > 0) {
    fail(
      `wasm/soffice.wasm LOK export drift; missing=${JSON.stringify(lokExportDrift.missing)}, extra=${JSON.stringify(lokExportDrift.extra)}`,
    );
  }

  for (const gluePath of ['wasm/soffice.js', 'wasm/soffice.cjs']) {
    const source = assetBytes.get(gluePath).toString('utf8');
    const missingBindings = findMissingGlueBindings(source);
    if (missingBindings.length > 0) {
      fail(`${gluePath} is missing Module bindings: ${missingBindings.join(', ')}`);
    }
  }

  return {
    candidateId: frozenSpec.candidateId,
    assets: verifiedAssets,
    expectedLokExports: [...expectedLokExports],
    requiredGlueBindings: [...requiredGlueBindings],
  };
}

const isCli =
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isCli) {
  try {
    const report = await verifyNativePackageAssets();
    console.log(
      `[native-package-assets] verified candidate ${report.candidateId}: ${report.assets.length} native assets, exports ${report.expectedLokExports.join(', ')}`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
