import { describe, expect, it } from 'vitest';
import {
  NativeConversionError,
  assertNativeConversionSucceeded,
  createNativeConversionRequest,
  decodeNativeConversionResult,
  encodeNativeConversionRequest,
  isNativeConversionRuntimeReusable,
  normalizeLibreOfficeUrl,
  resolveLibreOfficeExportFilter,
} from '../src/native-conversion-bridge.js';
import { ConversionErrorCode, FORMAT_FILTER_OPTIONS } from '../src/types.js';

describe('native conversion bridge contract', () => {
  it.each([
    ['docx', 'writer_pdf_Export'],
    ['xlsx', 'calc_pdf_Export'],
    ['pptx', 'impress_pdf_Export'],
    ['odg', 'draw_pdf_Export'],
  ])('resolves %s -> PDF to an explicit document-family filter', (input, expected) => {
    expect(resolveLibreOfficeExportFilter(input, 'PDF')).toBe(expected);
  });

  it('builds the normalized DOCX -> PDF schema-v1 request', () => {
    const request = createNativeConversionRequest({
      inputPath: '/tmp/input/document.docx',
      outputPath: '/tmp/output/document.pdf',
      inputFormat: 'DOCX',
      outputFormat: 'PDF',
    });

    expect(request).toEqual({
      schemaVersion: 1,
      inputUrl: 'file:///tmp/input/document.docx',
      outputUrl: 'file:///tmp/output/document.pdf',
      inputFilter: null,
      inputFilterOptions: null,
      password: null,
      outputFilter: 'writer_pdf_Export',
      outputFilterOptions: null,
      filterData: {},
    });
    expect(JSON.parse(encodeNativeConversionRequest(request))).toEqual(request);
  });

  it('maps CSV import options at the native load boundary', () => {
    const request = createNativeConversionRequest({
      inputPath: '/tmp/input/document.csv',
      outputPath: '/tmp/output/document.pdf',
      inputFormat: 'csv',
      outputFormat: 'pdf',
    });

    expect(request.inputFilter).toBe('Text - txt - csv (StarCalc)');
    expect(request.inputFilterOptions).toBe(
      '44,34,76,1,,1033,false,true,false,false,false,0,true,false,true'
    );
    expect(request.outputFilter).toBe('calc_pdf_Export');
  });

  it('builds CSV export requests with the same singular effective option', () => {
    const defaultRequest = createNativeConversionRequest({
      inputPath: '/tmp/input/document.xlsx',
      outputPath: '/tmp/output/document.csv',
      inputFormat: 'xlsx',
      outputFormat: 'csv',
    });
    const custom = '59,39,76,1,,1033,true,false,true,true,true,0,true,true,false';
    const customRequest = createNativeConversionRequest({
      inputPath: '/tmp/input/document.xlsx',
      outputPath: '/tmp/output/document.csv',
      inputFormat: 'xlsx',
      outputFormat: 'csv',
      filterOptions: custom,
    });

    expect(defaultRequest.outputFilterOptions).toBe(FORMAT_FILTER_OPTIONS.csv);
    expect(customRequest.outputFilterOptions).toBe(custom);
    expect(customRequest.filterData).toEqual({});
  });

  it.each(['-1', '1', '-2', 'sheet'])(
    'rejects CSV sheet token %j while keeping the runtime reusable',
    (sheetToken) => {
      expect(() => createNativeConversionRequest({
        inputPath: '/tmp/input/document.xlsx',
        outputPath: '/tmp/output/document.csv',
        inputFormat: 'xlsx',
        outputFormat: 'csv',
        filterOptions: `44,34,76,1,,0,false,true,false,false,false,${sheetToken}`,
      })).toThrowError(expect.objectContaining({
        code: ConversionErrorCode.INVALID_INPUT,
      }));
    }
  );

  it('separates JSON FilterData from string FilterOptions', () => {
    const filterData = {
      SelectPdfVersion: { type: 'long' as const, value: '2' },
      Quality: { type: 'long' as const, value: '85' },
    };
    const request = createNativeConversionRequest({
      inputPath: '/tmp/input/document.docx',
      outputPath: '/tmp/output/document.pdf',
      inputFormat: 'docx',
      outputFormat: 'pdf',
      filterOptions: JSON.stringify(filterData),
    });

    expect(request.outputFilterOptions).toBeNull();
    expect(request.filterData).toEqual(filterData);
  });

  it('keeps non-JSON filter options as FilterOptions', () => {
    const request = createNativeConversionRequest({
      inputPath: '/tmp/input/document.docx',
      outputPath: '/tmp/output/document.txt',
      inputFormat: 'docx',
      outputFormat: 'txt',
      filterOptions: 'UTF8,LF',
    });

    expect(request.outputFilterOptions).toBe('UTF8,LF');
    expect(request.filterData).toEqual({});
  });

  it('rejects unsupported pairs and malformed FilterData before native invocation', () => {
    expect(() => resolveLibreOfficeExportFilter('docx', 'xlsx')).toThrowError(
      /Unsupported conversion: docx -> xlsx/
    );

    try {
      createNativeConversionRequest({
        inputPath: '/tmp/input/document.docx',
        outputPath: '/tmp/output/document.pdf',
        inputFormat: 'docx',
        outputFormat: 'pdf',
        filterOptions: '{not-json',
      });
      throw new Error('Expected malformed FilterData to be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(NativeConversionError);
      expect(error).toMatchObject({ kind: 'contract', runtimeReusable: true });
    }
  });

  it('validates request URLs, schema versions, and FilterData entry shapes', () => {
    const request = createNativeConversionRequest({
      inputPath: '/tmp/input/document.docx',
      outputPath: '/tmp/output/document.pdf',
      inputFormat: 'docx',
      outputFormat: 'pdf',
    });

    expect(normalizeLibreOfficeUrl('file:///already/absolute.docx')).toBe(
      'file:///already/absolute.docx'
    );
    expect(() => encodeNativeConversionRequest({
      ...request,
      schemaVersion: 2,
    } as never)).toThrowError(/schemaVersion/);
    expect(() => encodeNativeConversionRequest({
      ...request,
      inputUrl: 'relative/document.docx',
    })).toThrowError(/absolute URL/);
    expect(() => encodeNativeConversionRequest({
      ...request,
      filterData: {
        Quality: { type: 'unsupported', value: '85' },
      },
    } as never)).toThrowError(/type is not supported/);
  });

  it('decodes valid success and stable-stage failures centrally', () => {
    const success = decodeNativeConversionResult({
      schemaVersion: 1,
      ok: true,
      stage: 'complete',
      cleanup: 'clean',
      hiddenLoad: true,
      visibleFrameSetupEntered: false,
    });
    const loadFailure = decodeNativeConversionResult({
      schemaVersion: 1,
      ok: false,
      stage: 'load',
      cleanup: 'not-needed',
      hiddenLoad: false,
      visibleFrameSetupEntered: false,
      message: 'password required',
    });
    const cleanupFailure = decodeNativeConversionResult({
      schemaVersion: 1,
      ok: false,
      stage: 'cleanup',
      cleanup: 'uncertain',
      hiddenLoad: true,
      visibleFrameSetupEntered: false,
      message: 'close was vetoed',
    });

    expect(success.stage).toBe('complete');
    expect(loadFailure.stage).toBe('load');
    expect(isNativeConversionRuntimeReusable(loadFailure)).toBe(true);
    expect(isNativeConversionRuntimeReusable(cleanupFailure)).toBe(false);
    expect(() => assertNativeConversionSucceeded(success)).not.toThrow();

    try {
      assertNativeConversionSucceeded(cleanupFailure);
      throw new Error('Expected cleanup failure');
    } catch (error) {
      expect(error).toMatchObject({
        kind: 'conversion',
        runtimeReusable: false,
        result: cleanupFailure,
      });
    }
  });

  it.each([
    [null, /must be an object/],
    [{ schemaVersion: 2 }, /schemaVersion/],
    [{
      schemaVersion: 1,
      ok: true,
      stage: 'export',
      cleanup: 'clean',
      hiddenLoad: true,
      visibleFrameSetupEntered: false,
    }, /success invariants/],
    [{
      schemaVersion: 1,
      ok: false,
      stage: 'load',
      cleanup: 'uncertain',
      hiddenLoad: true,
      visibleFrameSetupEntered: false,
    }, /requires stage=cleanup/],
    [{
      schemaVersion: 1,
      ok: false,
      stage: 'complete',
      cleanup: 'clean',
      hiddenLoad: true,
      visibleFrameSetupEntered: false,
    }, /failure cannot have stage=complete/],
  ])('rejects invalid native result contracts %#', (value, message) => {
    try {
      decodeNativeConversionResult(value);
      throw new Error('Expected invalid native result contract');
    } catch (error) {
      expect(error).toBeInstanceOf(NativeConversionError);
      expect(error).toMatchObject({ kind: 'contract', runtimeReusable: false });
      expect((error as Error).message).toMatch(message);
    }
  });
});
