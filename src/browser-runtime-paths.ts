import { createWasmPaths } from './types.js';
import type {
  BrowserConverterOptions,
  BrowserWasmCorePaths,
  ResolvedBrowserWasmPaths,
} from './types.js';

type BrowserWasmPathInput = Pick<BrowserConverterOptions, keyof BrowserWasmCorePaths>;

const ARTIFACT_CONTRACT_PREFIX = 'LibreOffice browser runtime artifact contract violation';

function requireNonEmptyPath(name: string, value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${ARTIFACT_CONTRACT_PREFIX}: ${name} must be a non-empty URL`);
  }
  return value;
}

function resolveCorePaths(
  options: BrowserWasmPathInput,
  defaults?: BrowserWasmCorePaths
): ResolvedBrowserWasmPaths {
  return {
    sofficeJs: requireNonEmptyPath('sofficeJs', options.sofficeJs ?? defaults?.sofficeJs),
    sofficeWasm: requireNonEmptyPath('sofficeWasm', options.sofficeWasm ?? defaults?.sofficeWasm),
    sofficeData: requireNonEmptyPath('sofficeData', options.sofficeData ?? defaults?.sofficeData),
  };
}

/** Apply no-pthread browser defaults and validate the artifact paths. */
export function resolveBrowserWasmPaths(
  options: BrowserWasmPathInput = {}
): ResolvedBrowserWasmPaths {
  return resolveCorePaths(options, createWasmPaths());
}

/** Validate the fully explicit paths received by the conversion Worker. */
export function validateExplicitBrowserWasmPaths(
  options: BrowserWasmPathInput
): ResolvedBrowserWasmPaths {
  return resolveCorePaths(options);
}

/** Resolve one Emscripten runtime request without allowing pthread sidecars. */
export function locateBrowserRuntimeFile(
  path: string,
  paths: ResolvedBrowserWasmPaths
): string {
  if (/\.worker\./.test(path)) {
    throw new Error(
      `${ARTIFACT_CONTRACT_PREFIX}: no-pthread glue unexpectedly requested worker ${JSON.stringify(path)}`
    );
  }
  if (path.endsWith('.wasm')) return paths.sofficeWasm;
  if (path.endsWith('.data')) return paths.sofficeData;

  const baseUrl = paths.sofficeJs.substring(0, paths.sofficeJs.lastIndexOf('/') + 1);
  return `${baseUrl}${path}`;
}
