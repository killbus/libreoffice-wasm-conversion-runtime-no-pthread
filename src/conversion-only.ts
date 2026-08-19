import type {
  ConversionOptions,
  ConversionResult,
  ILibreOfficeConverter,
} from './types.js';

interface ConversionRuntime {
  initialize(): Promise<void>;
  convert(
    input: Uint8Array | ArrayBuffer,
    options: ConversionOptions,
    filename?: string
  ): Promise<ConversionResult>;
  destroy(): Promise<void>;
  isReady(): boolean;
}

/** Expose only capabilities implemented by the conversion-only native ABI. */
export function exposeConversionOnly(
  runtime: ConversionRuntime
): ILibreOfficeConverter {
  return Object.freeze({
    initialize: () => runtime.initialize(),
    convert: (
      input: Uint8Array | ArrayBuffer,
      options: ConversionOptions,
      filename?: string
    ) =>
      runtime.convert(input, options, filename),
    destroy: () => runtime.destroy(),
    isReady: () => runtime.isReady(),
  });
}
