/**
 * Immutable package-relative browser asset deployment contract.
 *
 * Consumers choose public URLs and copy these files from the installed package.
 * The runtime is compiled without pthread support and has no internal worker asset.
 */

export type LibreOfficeBrowserAssetKey =
  | 'browserWorkerJs'
  | 'sofficeJs'
  | 'sofficeWasm'
  | 'sofficeData';

export interface LibreOfficeBrowserAssetSpec {
  readonly key: LibreOfficeBrowserAssetKey;
  readonly packagePath: string;
  readonly outputName: string;
  readonly mimeType: string;
}

const browserWorkerJs = Object.freeze({
  key: 'browserWorkerJs',
  packagePath: 'dist/browser.worker.global.js',
  outputName: 'browser.worker.global.js',
  mimeType: 'text/javascript',
} as const satisfies LibreOfficeBrowserAssetSpec);

const sofficeJs = Object.freeze({
  key: 'sofficeJs',
  packagePath: 'wasm/soffice.js',
  outputName: 'soffice.js',
  mimeType: 'text/javascript',
} as const satisfies LibreOfficeBrowserAssetSpec);

const sofficeWasm = Object.freeze({
  key: 'sofficeWasm',
  packagePath: 'wasm/soffice.wasm',
  outputName: 'soffice.wasm',
  mimeType: 'application/wasm',
} as const satisfies LibreOfficeBrowserAssetSpec);

const sofficeData = Object.freeze({
  key: 'sofficeData',
  packagePath: 'wasm/soffice.data',
  outputName: 'soffice.data',
  mimeType: 'application/octet-stream',
} as const satisfies LibreOfficeBrowserAssetSpec);

export const LIBREOFFICE_BROWSER_ASSET_CONTRACT = Object.freeze({
  schemaVersion: 1,
  packageName: '@killbus/libreoffice-converter',
  threading: 'none',
  assets: Object.freeze({
    browserWorkerJs,
    sofficeJs,
    sofficeWasm,
    sofficeData,
  }),
} as const);

export type LibreOfficeBrowserAssetContract =
  typeof LIBREOFFICE_BROWSER_ASSET_CONTRACT;
