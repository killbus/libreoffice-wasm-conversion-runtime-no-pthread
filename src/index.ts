/**
 * LibreOffice WASM Document Converter
 *
 * A headless document conversion toolkit that uses LibreOffice
 * compiled to WebAssembly. Supports conversion between various
 * document formats without any UI dependencies.
 *
 * @packageDocumentation
 */

// Font loading utilities (Node.js)
export { loadFontsFromZip, loadFontsFromDirectory, loadSystemFonts, loadFontsFromPackage, loadFontsFromPackages } from './font-loader.js';

// Image encoding utilities (uses sharp when available, falls back to pure JS)
export {
  encodeImage,
  rgbaToPng,
  rgbaToJpeg,
  rgbaToWebp,
  isSharpAvailable,
  getSharp,
} from './image-utils.js';
export type { ImageEncodeOptions } from './image-utils.js';

export type {
  ConversionOptions,
  ConversionResult,
  FontData,
  FilterOptions,
  ImageOptions,
  InputFormat,
  ILibreOfficeConverter,
  LibreOfficeWasmOptions,
  OutputFormat,
  PdfOptions,
  ProgressInfo,
} from './types.js';

export {
  ConversionError,
  ConversionErrorCode,
  FORMAT_FILTERS,
  FORMAT_MIME_TYPES,
  EXTENSION_TO_FORMAT,
  // Conversion validation helpers
  getValidOutputFormats,
  isConversionValid,
  getConversionErrorMessage,
  INPUT_FORMAT_CATEGORY,
  CATEGORY_OUTPUT_FORMATS,
  // Browser WASM path helpers (also useful for understanding paths)
  createWasmPaths,
  DEFAULT_WASM_BASE_URL,
} from './types.js';

export type { DocumentCategory, WasmLoadPhase, WasmLoadProgress } from './types.js';

import { LibreOfficeConverter } from './converter-node.js';
import { createSubprocessConverter } from './subprocess.worker-converter.js';
import { exposeConversionOnly } from './conversion-only.js';
import {
  ConversionError,
  ConversionErrorCode,
  FORMAT_FILTERS,
  getConversionErrorMessage,
  isConversionValid,
  resolveSingleResultFilterOptions,
} from './types.js';
import type {
  ConversionOptions,
  ConversionResult,
  ImageOptions,
  ILibreOfficeConverter,
  InputFormat,
  LibreOfficeWasmOptions,
  OutputFormat,
} from './types.js';

/**
 * Image format options for exportAsImage
 */
export type ImageFormat = 'png' | 'svg';

// Detect if running in Node.js
const isNode = typeof process !== 'undefined' &&
  process.versions != null &&
  process.versions.node != null;

function validateConversionOptions(options: ConversionOptions): void {
  const outputFormat = options.outputFormat;

  resolveSingleResultFilterOptions(outputFormat, options.filterOptions);

  if (!FORMAT_FILTERS[outputFormat]) {
    throw new ConversionError(
      ConversionErrorCode.UNSUPPORTED_FORMAT,
      `Unsupported output format: ${outputFormat}`
    );
  }

  if (
    options.inputFormat &&
    !isConversionValid(options.inputFormat, outputFormat)
  ) {
    throw new ConversionError(
      ConversionErrorCode.UNSUPPORTED_FORMAT,
      getConversionErrorMessage(options.inputFormat, outputFormat)
    );
  }
}

/**
 * Create a configured LibreOffice converter instance
 *
 * @example
 * ```typescript
 * import { createConverter } from '@killbus/libreoffice-converter';
 *
 * const converter = await createConverter({
 *   wasmPath: './wasm',
 *   verbose: true,
 * });
 *
 * const pdfData = await converter.convert(docxBuffer, {
 *   outputFormat: 'pdf',
 * });
 * ```
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
 *
 * In Node.js, uses SubprocessConverter for clean process exit.
 * In browsers, uses LibreOfficeConverter directly.
 *
 * @example
 * ```typescript
 * import { convertDocument } from '@killbus/libreoffice-converter';
 *
 * const pdfData = await convertDocument(docxBuffer, {
 *   outputFormat: 'pdf',
 *   pdf: { pdfaLevel: 'PDF/A-2b' }
 * });
 * ```
 */
export async function convertDocument(
  input: Uint8Array | ArrayBuffer | Buffer,
  options: ConversionOptions,
  converterOptions?: LibreOfficeWasmOptions
): Promise<ConversionResult> {
  // Reject deterministic contract failures before initializing WASM or a subprocess.
  validateConversionOptions(options);

  // In Node.js, use subprocess for clean exit (no hanging pthread workers)
  // SubprocessConverter only supports basic conversions, not image/page options
  const isBasicConversion = !options.image;

  if (isNode && isBasicConversion) {
    const converter = await createSubprocessConverter(converterOptions);
    try {
      return await converter.convert(input, options);
    } finally {
      await converter.destroy();
    }
  }

  // Browser or advanced conversion: use LibreOfficeConverter
  const converter = await createConverter(converterOptions);
  try {
    return await converter.convert(input, options);
  } finally {
    await converter.destroy();
  }
}

/**
 * Export document pages as images - creates converter, exports specified pages, then destroys
 *
 * @param input - Document buffer
 * @param inputFormat - Explicit input format; image export never guesses DOCX
 * @param pages - Page index or array of page indices to export (0-indexed)
 * @param format - Output format: 'png' or 'svg'
 * @param imageOptions - Image options (width, height, dpi)
 * @param converterOptions - Converter options (wasmPath, etc.)
 * @returns Array of ConversionResult, one per page
 *
 * @example
 * ```typescript
 * import { exportAsImage } from '@killbus/libreoffice-converter';
 *
 * // Export single page (0-indexed)
 * const [cover] = await exportAsImage(docxBuffer, 'docx', 0, 'png');
 * fs.writeFileSync('cover.png', cover.data);
 *
 * // Export multiple pages
 * const slides = await exportAsImage(pptxBuffer, 'pptx', [0, 1, 2], 'png');
 * slides.forEach((img, i) => fs.writeFileSync(`slide-${i}.png`, img.data));
 *
 * // Export with options
 * const highRes = await exportAsImage(pptxBuffer, 'pptx', [0, 1, 2], 'png', {
 *   dpi: 300,
 *   width: 1920
 * });
 * ```
 */
export async function exportAsImage(
  input: Uint8Array | ArrayBuffer | Buffer,
  inputFormat: InputFormat,
  pages: number | number[],
  format: ImageFormat = 'png',
  imageOptions?: Omit<ImageOptions, 'pageIndex'>,
  converterOptions?: LibreOfficeWasmOptions
): Promise<ConversionResult[]> {
  const pageArray = Array.isArray(pages) ? pages : [pages];
  if (pageArray.length === 0) {
    throw new Error('pages is required and must not be empty');
  }
  const converter = await createConverter(converterOptions);
  try {
    const results: ConversionResult[] = [];
    for (const pageIndex of pageArray) {
      const result = await converter.convert(input, {
        inputFormat,
        outputFormat: format,
        image: { ...imageOptions, pageIndex },
      });
      results.push(result);
    }
    return results;
  } finally {
    await converter.destroy();
  }
}

/**
 * Check if a format is supported for input
 */
export function isInputFormatSupported(format: string): boolean {
  return LibreOfficeConverter.getSupportedInputFormats().includes(format.toLowerCase());
}

/**
 * Check if a format is supported for output
 */
export function isOutputFormatSupported(format: string): boolean {
  return LibreOfficeConverter.getSupportedOutputFormats().includes(format.toLowerCase() as OutputFormat);
}

/**
 * Check if a specific conversion path is supported
 * @param inputFormat The input document format (e.g., 'pdf', 'docx')
 * @param outputFormat The desired output format (e.g., 'pdf', 'docx')
 * @returns true if the conversion is supported
 * 
 * @example
 * ```typescript
 * import { isConversionSupported } from '@killbus/libreoffice-converter';
 * 
 * isConversionSupported('docx', 'pdf');  // true
 * isConversionSupported('pdf', 'docx');  // false - PDFs can't be converted to DOCX
 * isConversionSupported('xlsx', 'csv');  // true
 * ```
 */
export function isConversionSupported(inputFormat: string, outputFormat: string): boolean {
  return LibreOfficeConverter.isConversionSupported(inputFormat, outputFormat);
}

/**
 * Get valid output formats for a given input format
 * @param inputFormat The input document format
 * @returns Array of valid output formats
 * 
 * @example
 * ```typescript
 * import { getValidOutputFormatsFor } from '@killbus/libreoffice-converter';
 * 
 * getValidOutputFormatsFor('docx');  // ['pdf', 'docx', 'doc', 'odt', 'rtf', 'txt', 'png']
 * getValidOutputFormatsFor('pdf');   // ['pdf', 'png', 'svg', 'html']
 * getValidOutputFormatsFor('xlsx');  // ['pdf', 'xlsx', 'xls', 'ods', 'csv', 'html', 'png']
 * ```
 */
export function getValidOutputFormatsFor(inputFormat: string): OutputFormat[] {
  return LibreOfficeConverter.getValidOutputFormats(inputFormat);
}
