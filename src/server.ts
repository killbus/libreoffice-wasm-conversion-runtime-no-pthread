/**
 * LibreOffice WASM Document Converter - Server/Node.js Entry Point
 *
 * This entry point exports the conversion-only Node.js surface and utilities.
 * Use this for server-side code (API routes, server components, etc.)
 *
 * @example
 * ```typescript
 * // In Next.js API routes or server components
 * import { createConverter } from '@killbus/libreoffice-converter/server';
 *
 * const converter = await createConverter({ wasmPath: './wasm' });
 * const result = await converter.convert(docxBuffer, { outputFormat: 'pdf' });
 * ```
 *
 * @packageDocumentation
 */

// ============================================
// Conversion-only Node.js surface
// ============================================

// Font loading utilities (Node.js)
export { loadFontsFromZip, loadFontsFromDirectory, loadSystemFonts, loadFontsFromPackage, loadFontsFromPackages } from './font-loader.js';

// ============================================
// Image encoding utilities
// ============================================

export {
  encodeImage,
  rgbaToPng,
  rgbaToJpeg,
  rgbaToWebp,
  isSharpAvailable,
  getSharp,
} from './image-utils.js';
export type { ImageEncodeOptions } from './image-utils.js';

// ============================================
// Convenience functions
// ============================================

import { LibreOfficeConverter } from './converter-node.js';
import { createSubprocessConverter } from './subprocess.worker-converter.js';
import { exposeConversionOnly } from './conversion-only.js';
import { resolveSingleResultFilterOptions } from './types.js';
import type { ConversionOptions, ConversionResult, ILibreOfficeConverter, LibreOfficeWasmOptions } from './types.js';

/**
 * Create a configured LibreOffice converter instance
 */
export async function createConverter(
  options?: LibreOfficeWasmOptions
): Promise<ILibreOfficeConverter> {
  const converter = new LibreOfficeConverter(options);
  await converter.initialize();
  return exposeConversionOnly(converter);
}

/**
 * Quick conversion utility - creates converter, converts, then destroys
 * Uses SubprocessConverter to isolate native runtime state
 */
export async function convertDocument(
  input: Uint8Array | ArrayBuffer | Buffer,
  options: ConversionOptions,
  converterOptions?: LibreOfficeWasmOptions
): Promise<ConversionResult> {
  resolveSingleResultFilterOptions(options.outputFormat, options.filterOptions);
  const converter = await createSubprocessConverter(converterOptions);
  try {
    return await converter.convert(input, options);
  } finally {
    await converter.destroy();
  }
}

// ============================================
// Types (re-exported for convenience)
// ============================================

export type {
  ConversionOptions,
  ConversionResult,
  FontData,
  FilterOptions,
  ImageOptions,
  InputFormat,
  LibreOfficeWasmOptions,
  OutputFormat,
  PdfOptions,
  ProgressInfo,
  DocumentCategory,
  WasmLoadPhase,
  WasmLoadProgress,
  ILibreOfficeConverter,
} from './types.js';

export {
  ConversionError,
  ConversionErrorCode,
  FORMAT_FILTERS,
  FORMAT_MIME_TYPES,
  EXTENSION_TO_FORMAT,
  getValidOutputFormats,
  isConversionValid,
  getConversionErrorMessage,
  INPUT_FORMAT_CATEGORY,
  CATEGORY_OUTPUT_FORMATS,
  createWasmPaths,
  DEFAULT_WASM_BASE_URL,
} from './types.js';
