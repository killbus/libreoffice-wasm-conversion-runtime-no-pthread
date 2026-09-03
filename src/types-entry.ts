/**
 * LibreOffice WASM Document Converter - Types Only
 *
 * This entry point exports only types, no runtime code.
 * Safe to import from client components without pulling in Node.js dependencies.
 *
 * @example
 * ```typescript
 * // In client components (React, Vue, etc.)
 * import type { ConversionOptions, OutputFormat } from '@killbus/libreoffice-converter/types';
 * ```
 *
 * @packageDocumentation
 */

// ============================================
// Core conversion types
// ============================================

export type {
  InputFormat,
  OutputFormat,
  ConversionOptions,
  ConversionResult,
  FilterOptions,
  PdfOptions,
  ImageOptions,
  ProgressInfo,
  FontData,
  FontProfileDiagnostics,
  FontProfileFont,
  FontProfileMutationDisposition,
  FontProfileRequest,
  FontProfileResult,
  FontProfileResultCode,
  FontProfileRollbackDisposition,
  FontProfileRuntimeIdentity,
  FontProfileStage,
  IFontProfileConverter,
  NativeFontProfileDiagnostics,
  NativeFontProfileManifestEntry,
  NativeFontProfileRequest,
  NativeFontProfileResult,
  WasmLoadPhase,
  WasmLoadProgress,
  DocumentCategory,
} from './types.js';

// ============================================
// Configuration types
// ============================================

export type {
  LibreOfficeWasmOptions,
  BrowserWasmPaths,
  BrowserConverterOptions,
  WorkerBrowserConverterOptions,
} from './types.js';

// ============================================
// Converter interface types
// ============================================

export type {
  ILibreOfficeConverter,
} from './types.js';

// ============================================
// Error types and codes
// ============================================

export {
  ConversionError,
  ConversionErrorCode,
  EMPTY_FONT_PROFILE_FINGERPRINT,
  FONT_PROFILE_SCHEMA_VERSION,
} from './types.js';

// ============================================
// Format constants (runtime values, but small)
// ============================================

export {
  FORMAT_FILTERS,
  FORMAT_MIME_TYPES,
  EXTENSION_TO_FORMAT,
  INPUT_FORMAT_CATEGORY,
  CATEGORY_OUTPUT_FORMATS,
} from './types.js';

// ============================================
// Validation helpers (pure functions, no deps)
// ============================================

export {
  getValidOutputFormats,
  isConversionValid,
  getConversionErrorMessage,
  createWasmPaths,
  DEFAULT_WASM_BASE_URL,
} from './types.js';

// Image utility types
// ============================================

export type { ImageEncodeOptions } from './image-utils.js';

/**
 * Image format options for exportAsImage
 */
export type ImageFormat = 'png' | 'svg';
