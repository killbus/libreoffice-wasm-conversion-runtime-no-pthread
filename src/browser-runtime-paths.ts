import { createWasmPaths } from './types.js';
import type {
  BrowserConverterOptions,
  BrowserWasmCorePaths,
  ResolvedBrowserWasmPaths,
} from './types.js';

type BrowserWasmPathInput = Pick<
  BrowserConverterOptions,
  keyof BrowserWasmCorePaths | 'pthreadWorkerMode' | 'sofficeWorkerJs'
>;

type ResolvedPthreadWorkerPaths =
  | { pthreadWorkerMode: 'external'; sofficeWorkerJs: string }
  | { pthreadWorkerMode: 'main-script'; sofficeWorkerJs?: never };

const ARTIFACT_CONTRACT_PREFIX = 'LibreOffice browser runtime artifact contract violation';

function requireNonEmptyPath(name: string, value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${ARTIFACT_CONTRACT_PREFIX}: ${name} must be a non-empty URL`);
  }
  return value;
}

function resolvePthreadWorkerPaths(
  options: BrowserWasmPathInput,
  defaultExternalWorkerJs?: string
): ResolvedPthreadWorkerPaths {
  const mode = options.pthreadWorkerMode ?? 'external';
  if (mode !== 'external' && mode !== 'main-script') {
    throw new Error(
      `${ARTIFACT_CONTRACT_PREFIX}: unsupported pthreadWorkerMode ${JSON.stringify(mode)}`
    );
  }

  if (mode === 'main-script') {
    if (options.sofficeWorkerJs !== undefined) {
      throw new Error(
        `${ARTIFACT_CONTRACT_PREFIX}: sofficeWorkerJs must be omitted when pthreadWorkerMode is "main-script"`
      );
    }
    return { pthreadWorkerMode: 'main-script' };
  }

  return {
    pthreadWorkerMode: 'external',
    sofficeWorkerJs: requireNonEmptyPath(
      'sofficeWorkerJs',
      options.sofficeWorkerJs ?? defaultExternalWorkerJs
    ),
  };
}

/** Apply legacy browser defaults, then validate the selected artifact contract. */
export function resolveBrowserWasmPaths(
  options: BrowserWasmPathInput = {}
): ResolvedBrowserWasmPaths {
  const defaults = createWasmPaths();
  const corePaths: BrowserWasmCorePaths = {
    sofficeJs: requireNonEmptyPath('sofficeJs', options.sofficeJs ?? defaults.sofficeJs),
    sofficeWasm: requireNonEmptyPath('sofficeWasm', options.sofficeWasm ?? defaults.sofficeWasm),
    sofficeData: requireNonEmptyPath('sofficeData', options.sofficeData ?? defaults.sofficeData),
  };
  const pthreadPaths = resolvePthreadWorkerPaths(options, defaults.sofficeWorkerJs);
  return pthreadPaths.pthreadWorkerMode === 'external'
    ? { ...corePaths, ...pthreadPaths }
    : { ...corePaths, ...pthreadPaths };
}

/** Validate the fully explicit paths received by the classic conversion Worker. */
export function validateExplicitBrowserWasmPaths(
  options: BrowserWasmPathInput
): ResolvedBrowserWasmPaths {
  const corePaths: BrowserWasmCorePaths = {
    sofficeJs: requireNonEmptyPath('sofficeJs', options.sofficeJs),
    sofficeWasm: requireNonEmptyPath('sofficeWasm', options.sofficeWasm),
    sofficeData: requireNonEmptyPath('sofficeData', options.sofficeData),
  };
  const pthreadPaths = resolvePthreadWorkerPaths(options);
  return pthreadPaths.pthreadWorkerMode === 'external'
    ? { ...corePaths, ...pthreadPaths }
    : { ...corePaths, ...pthreadPaths };
}

export function isExternalPthreadWorkerRequest(path: string): boolean {
  return path.includes('.worker.');
}

/** Resolve one Emscripten runtime request without guessing across artifact modes. */
export function locateBrowserRuntimeFile(
  path: string,
  paths: ResolvedBrowserWasmPaths
): string {
  if (path.endsWith('.wasm')) return paths.sofficeWasm;
  if (path.endsWith('.data')) return paths.sofficeData;

  if (isExternalPthreadWorkerRequest(path)) {
    if (paths.pthreadWorkerMode === 'main-script') {
      throw new Error(
        `${ARTIFACT_CONTRACT_PREFIX}: main-script pthread glue unexpectedly requested external worker ${JSON.stringify(path)}`
      );
    }
    return paths.sofficeWorkerJs;
  }

  const baseUrl = paths.sofficeJs.substring(0, paths.sofficeJs.lastIndexOf('/') + 1);
  return `${baseUrl}${path}`;
}
