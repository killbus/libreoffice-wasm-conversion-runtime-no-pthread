/** Shared contract for the private native hidden-conversion bridge. */

import {
  CATEGORY_OUTPUT_FORMATS,
  CSV_IMPORT_FILTER_OPTIONS,
  DOC_TYPE_FILTERS,
  FORMAT_FILTER_OPTIONS,
  FORMAT_FILTERS,
  INPUT_FORMAT_CATEGORY,
  LOKDocumentType,
  buildPdfFilterOptions,
} from './types.js';
import type { DocumentCategory, InputFormat, OutputFormat, PdfOptions } from './types.js';

export const NATIVE_CONVERSION_SCHEMA_VERSION = 1 as const;
export const NATIVE_CONVERSION_STAGES = [
  'validate', 'load', 'export', 'cleanup', 'complete',
] as const;
export const NATIVE_CONVERSION_CLEANUP_STATES = [
  'not-needed', 'clean', 'uncertain',
] as const;
export const NATIVE_FILTER_DATA_TYPES = [
  'string', 'boolean', 'float', 'long', 'short', 'unsigned short',
  'int64', 'int32', 'int16', 'uint64', 'uint32', 'uint16',
] as const;

export type NativeConversionStage = typeof NATIVE_CONVERSION_STAGES[number];
export type NativeConversionCleanup = typeof NATIVE_CONVERSION_CLEANUP_STATES[number];
export type NativeFilterDataType = typeof NATIVE_FILTER_DATA_TYPES[number];

export interface NativeFilterDataEntry {
  type: NativeFilterDataType;
  value: string;
}

export type NativeFilterData = Record<string, NativeFilterDataEntry>;

export interface NativeConversionRequest {
  schemaVersion: typeof NATIVE_CONVERSION_SCHEMA_VERSION;
  inputUrl: string;
  outputUrl: string;
  inputFilter: string | null;
  inputFilterOptions: string | null;
  password: string | null;
  outputFilter: string;
  outputFilterOptions: string | null;
  filterData: NativeFilterData;
}

export interface NativeConversionResult {
  schemaVersion: typeof NATIVE_CONVERSION_SCHEMA_VERSION;
  ok: boolean;
  stage: NativeConversionStage;
  cleanup: NativeConversionCleanup;
  hiddenLoad: boolean;
  visibleFrameSetupEntered: boolean;
  message?: string;
}

export const NATIVE_CONVERSION_RUNTIME_NOT_READY_MESSAGE
  = 'LibreOffice runtime is not ready for conversion' as const;

const DEFAULT_NATIVE_CONVERSION_READY_TIMEOUT_MS = 5_000;
const DEFAULT_NATIVE_CONVERSION_READY_RETRY_DELAY_MS = 25;

interface NativeConversionReadyRetryOptions {
  timeoutMs?: number;
  retryDelayMs?: number;
  now?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
}

export type NativeConversionErrorKind = 'contract' | 'abi' | 'conversion';

export class NativeConversionError extends Error {
  public readonly kind: NativeConversionErrorKind;
  public readonly runtimeReusable: boolean;
  public readonly result?: NativeConversionResult;
  public readonly boundaryCause?: unknown;

  constructor(
    kind: NativeConversionErrorKind,
    message: string,
    runtimeReusable: boolean,
    result?: NativeConversionResult,
    boundaryCause?: unknown
  ) {
    super(message);
    this.name = 'NativeConversionError';
    this.kind = kind;
    this.runtimeReusable = runtimeReusable;
    this.result = result;
    this.boundaryCause = boundaryCause;
  }
}

export interface NativeConversionRequestParameters {
  inputPath: string;
  outputPath: string;
  inputFormat: InputFormat | string;
  outputFormat: OutputFormat | string;
  password?: string;
  filterOptions?: string;
  pdf?: PdfOptions;
}

const ABSOLUTE_URL_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const FILTER_DATA_TYPE_SET = new Set<string>(NATIVE_FILTER_DATA_TYPES);
const STAGE_SET = new Set<string>(NATIVE_CONVERSION_STAGES);
const CLEANUP_SET = new Set<string>(NATIVE_CONVERSION_CLEANUP_STATES);

const CATEGORY_DOCUMENT_TYPES: Record<DocumentCategory, LOKDocumentType> = {
  text: LOKDocumentType.TEXT,
  spreadsheet: LOKDocumentType.SPREADSHEET,
  presentation: LOKDocumentType.PRESENTATION,
  drawing: LOKDocumentType.DRAWING,
  other: LOKDocumentType.OTHER,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(object: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function contractFailure(message: string, runtimeReusable = true): never {
  throw new NativeConversionError('contract', message, runtimeReusable);
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    return contractFailure(`${field} must be a non-empty string`);
  }
  return value;
}

function requireNullableString(value: unknown, field: string): string | null {
  if (value !== null && typeof value !== 'string') {
    return contractFailure(`${field} must be a string or null`);
  }
  return value;
}

function requireAbsoluteUrl(value: unknown, field: string): string {
  const url = requireNonEmptyString(value, field);
  if (!ABSOLUTE_URL_PATTERN.test(url)) {
    return contractFailure(`${field} must be an absolute URL`);
  }
  return url;
}

function validateFilterData(value: unknown): asserts value is NativeFilterData {
  if (!isRecord(value)) {
    contractFailure('filterData must be an object');
  }

  for (const [name, entry] of Object.entries(value)) {
    if (name.length === 0 || !isRecord(entry)) {
      contractFailure('Each filterData entry must have a non-empty name and object value');
    }

    const keys = Object.keys(entry);
    if (keys.length !== 2 || !hasOwn(entry, 'type') || !hasOwn(entry, 'value')) {
      contractFailure(`filterData.${name} must contain only type and value`);
    }

    if (typeof entry.type !== 'string' || !FILTER_DATA_TYPE_SET.has(entry.type)) {
      contractFailure(`filterData.${name}.type is not supported`);
    }
    if (typeof entry.value !== 'string') {
      contractFailure(`filterData.${name}.value must be a string`);
    }
  }
}

/** Normalize an Emscripten VFS path or absolute URL for LibreOffice. */
export function normalizeLibreOfficeUrl(pathOrUrl: string): string {
  if (typeof pathOrUrl !== 'string' || pathOrUrl.length === 0) {
    return contractFailure('LibreOffice conversion path must be a non-empty string');
  }
  if (ABSOLUTE_URL_PATTERN.test(pathOrUrl)) {
    return pathOrUrl;
  }

  const absolutePath = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
  return `file://${absolutePath}`;
}

/** Resolve a public input/output pair to an explicit LibreOffice export filter. */
export function resolveLibreOfficeExportFilter(
  inputFormat: InputFormat | string,
  outputFormat: OutputFormat | string
): string {
  if (typeof inputFormat !== 'string' || inputFormat.length === 0) {
    return contractFailure('Input format must be a non-empty string');
  }
  if (typeof outputFormat !== 'string' || outputFormat.length === 0) {
    return contractFailure('Output format must be a non-empty string');
  }

  const normalizedInput = inputFormat.toLowerCase();
  const normalizedOutput = outputFormat.toLowerCase();

  if (!hasOwn(INPUT_FORMAT_CATEGORY, normalizedInput)) {
    return contractFailure(`Unsupported input format: ${inputFormat}`);
  }
  if (!hasOwn(FORMAT_FILTERS, normalizedOutput)) {
    return contractFailure(`Unsupported output format: ${outputFormat}`);
  }

  const typedInput = normalizedInput as InputFormat;
  const typedOutput = normalizedOutput as OutputFormat;
  const category = INPUT_FORMAT_CATEGORY[typedInput];

  if (!CATEGORY_OUTPUT_FORMATS[category].includes(typedOutput)) {
    return contractFailure(`Unsupported conversion: ${typedInput} -> ${typedOutput}`);
  }

  const documentType = CATEGORY_DOCUMENT_TYPES[category];
  const filter = DOC_TYPE_FILTERS[documentType][typedOutput] ?? FORMAT_FILTERS[typedOutput];
  if (!filter) {
    return contractFailure(`No LibreOffice export filter for ${typedInput} -> ${typedOutput}`);
  }
  return filter;
}

function parseFilterData(filterOptions: string): NativeFilterData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(filterOptions) as unknown;
  } catch (error) {
    throw new NativeConversionError(
      'contract',
      'FilterData JSON is malformed',
      true,
      undefined,
      error
    );
  }

  validateFilterData(parsed);
  return parsed;
}

function resolveOutputOptions(
  outputFormat: OutputFormat,
  filterOptions: string | undefined,
  pdf: PdfOptions | undefined
): Pick<NativeConversionRequest, 'outputFilterOptions' | 'filterData'> {
  let effectiveOptions: string;
  if (filterOptions !== undefined) {
    effectiveOptions = filterOptions;
  } else if (outputFormat === 'pdf' && pdf) {
    effectiveOptions = buildPdfFilterOptions(pdf) || FORMAT_FILTER_OPTIONS[outputFormat] || '';
  } else {
    effectiveOptions = FORMAT_FILTER_OPTIONS[outputFormat] || '';
  }

  if (effectiveOptions.trimStart().startsWith('{')) {
    return {
      outputFilterOptions: null,
      filterData: parseFilterData(effectiveOptions),
    };
  }

  return {
    outputFilterOptions: effectiveOptions.length > 0 ? effectiveOptions : null,
    filterData: {},
  };
}

function resolveCsvInputOptions(): Pick<
  NativeConversionRequest,
  'inputFilter' | 'inputFilterOptions'
> {
  const match = /^FilterName=([^,]+),FilterOptions=(.*)$/s.exec(CSV_IMPORT_FILTER_OPTIONS);
  if (!match?.[1] || match[2] === undefined) {
    return contractFailure('CSV_IMPORT_FILTER_OPTIONS has an invalid internal shape');
  }
  return {
    inputFilter: match[1],
    inputFilterOptions: match[2],
  };
}

/** Build a normalized schema-v1 request for one synchronous native transaction. */
export function createNativeConversionRequest(
  parameters: NativeConversionRequestParameters
): NativeConversionRequest {
  if (typeof parameters.inputFormat !== 'string' || typeof parameters.outputFormat !== 'string') {
    return contractFailure('Input and output formats must be strings');
  }

  const normalizedInput = parameters.inputFormat.toLowerCase();
  const normalizedOutput = parameters.outputFormat.toLowerCase();
  const outputFilter = resolveLibreOfficeExportFilter(normalizedInput, normalizedOutput);
  const typedOutput = normalizedOutput as OutputFormat;
  const inputOptions = normalizedInput === 'csv'
    ? resolveCsvInputOptions()
    : { inputFilter: null, inputFilterOptions: null };
  const outputOptions = resolveOutputOptions(
    typedOutput,
    parameters.filterOptions,
    parameters.pdf
  );

  return {
    schemaVersion: NATIVE_CONVERSION_SCHEMA_VERSION,
    inputUrl: normalizeLibreOfficeUrl(parameters.inputPath),
    outputUrl: normalizeLibreOfficeUrl(parameters.outputPath),
    ...inputOptions,
    password: parameters.password && parameters.password.length > 0
      ? parameters.password
      : null,
    outputFilter,
    ...outputOptions,
  };
}

/** Validate and serialize a request. This is the only request JSON encoder. */
export function encodeNativeConversionRequest(request: NativeConversionRequest): string {
  if (!isRecord(request)) {
    return contractFailure('Native conversion request must be an object');
  }
  if (request.schemaVersion !== NATIVE_CONVERSION_SCHEMA_VERSION) {
    return contractFailure('Unsupported native conversion request schemaVersion');
  }

  requireAbsoluteUrl(request.inputUrl, 'inputUrl');
  requireAbsoluteUrl(request.outputUrl, 'outputUrl');
  requireNullableString(request.inputFilter, 'inputFilter');
  requireNullableString(request.inputFilterOptions, 'inputFilterOptions');
  requireNullableString(request.password, 'password');
  requireNonEmptyString(request.outputFilter, 'outputFilter');
  requireNullableString(request.outputFilterOptions, 'outputFilterOptions');
  validateFilterData(request.filterData);

  try {
    return JSON.stringify(request);
  } catch (error) {
    throw new NativeConversionError(
      'contract',
      'Native conversion request could not be encoded',
      true,
      undefined,
      error
    );
  }
}

/** Decode and strictly validate one native schema-v1 result from unknown data. */
export function decodeNativeConversionResult(value: unknown): NativeConversionResult {
  if (!isRecord(value)) {
    return contractFailure('Native conversion result must be an object', false);
  }
  if (value.schemaVersion !== NATIVE_CONVERSION_SCHEMA_VERSION) {
    return contractFailure('Unsupported native conversion result schemaVersion', false);
  }
  if (typeof value.ok !== 'boolean') {
    return contractFailure('Native conversion result ok must be a boolean', false);
  }
  if (typeof value.stage !== 'string' || !STAGE_SET.has(value.stage)) {
    return contractFailure('Native conversion result stage is invalid', false);
  }
  if (typeof value.cleanup !== 'string' || !CLEANUP_SET.has(value.cleanup)) {
    return contractFailure('Native conversion result cleanup is invalid', false);
  }
  if (typeof value.hiddenLoad !== 'boolean') {
    return contractFailure('Native conversion result hiddenLoad must be a boolean', false);
  }
  if (typeof value.visibleFrameSetupEntered !== 'boolean') {
    return contractFailure(
      'Native conversion result visibleFrameSetupEntered must be a boolean',
      false
    );
  }
  if (value.message !== undefined && typeof value.message !== 'string') {
    return contractFailure('Native conversion result message must be a string', false);
  }

  const result: NativeConversionResult = {
    schemaVersion: NATIVE_CONVERSION_SCHEMA_VERSION,
    ok: value.ok,
    stage: value.stage as NativeConversionStage,
    cleanup: value.cleanup as NativeConversionCleanup,
    hiddenLoad: value.hiddenLoad,
    visibleFrameSetupEntered: value.visibleFrameSetupEntered,
    ...(value.message === undefined ? {} : { message: value.message }),
  };

  if (result.ok) {
    if (
      result.stage !== 'complete'
      || result.cleanup !== 'clean'
      || !result.hiddenLoad
      || result.visibleFrameSetupEntered
    ) {
      return contractFailure('Native conversion success invariants were not satisfied', false);
    }
  } else if (result.stage === 'complete') {
    return contractFailure('Native conversion failure cannot have stage=complete', false);
  }

  if (result.cleanup === 'uncertain' && result.stage !== 'cleanup') {
    return contractFailure('cleanup=uncertain requires stage=cleanup', false);
  }

  return result;
}

export function isNativeConversionRuntimeReusable(result: NativeConversionResult): boolean {
  return result.cleanup !== 'uncertain';
}

/**
 * The native bridge returns this exact pre-document result when LibreOffice's
 * SolarMutex is temporarily owned elsewhere. Retrying is safe because loading
 * has not started and cleanup is not required.
 */
export function isNativeConversionRuntimeNotReady(
  result: NativeConversionResult
): boolean {
  return !result.ok
    && result.stage === 'validate'
    && result.cleanup === 'not-needed'
    && !result.hiddenLoad
    && !result.visibleFrameSetupEntered
    && result.message === NATIVE_CONVERSION_RUNTIME_NOT_READY_MESSAGE;
}

/**
 * Run the synchronous native transaction once LibreOffice's UI mutex becomes
 * available. The delay yields the browser/worker event loop between attempts,
 * while the deadline prevents a transient busy state from becoming a hang.
 */
export async function runNativeConversionWhenReady(
  convert: () => NativeConversionResult,
  options: NativeConversionReadyRetryOptions = {}
): Promise<NativeConversionResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_NATIVE_CONVERSION_READY_TIMEOUT_MS;
  const retryDelayMs = options.retryDelayMs
    ?? DEFAULT_NATIVE_CONVERSION_READY_RETRY_DELAY_MS;
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep
    ?? ((delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)));

  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new RangeError('Native conversion ready timeout must be a non-negative finite number');
  }
  if (!Number.isFinite(retryDelayMs) || retryDelayMs <= 0) {
    throw new RangeError('Native conversion retry delay must be a positive finite number');
  }

  const startedAt = now();
  while (true) {
    const result = convert();
    if (!isNativeConversionRuntimeNotReady(result)) {
      return result;
    }

    const elapsedMs = Math.max(0, now() - startedAt);
    const remainingMs = timeoutMs - elapsedMs;
    if (remainingMs <= 0) {
      throw new NativeConversionError(
        'conversion',
        `LibreOffice runtime did not become ready for conversion within ${timeoutMs} ms`,
        true,
        result
      );
    }

    await sleep(Math.min(retryDelayMs, remainingMs));
  }
}

export function assertNativeConversionSucceeded(
  result: NativeConversionResult
): asserts result is NativeConversionResult & { ok: true; stage: 'complete'; cleanup: 'clean' } {
  if (!result.ok) {
    throw new NativeConversionError(
      'conversion',
      result.message || `Native conversion failed during ${result.stage}`,
      isNativeConversionRuntimeReusable(result),
      result
    );
  }
}
