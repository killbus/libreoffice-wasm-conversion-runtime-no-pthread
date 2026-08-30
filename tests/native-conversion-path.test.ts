import { describe, expect, it, vi } from 'vitest';
import { LibreOfficeConverter } from '../src/converter-node.js';
import type {
  NativeConversionRequest,
  NativeConversionResult,
} from '../src/native-conversion-bridge.js';
import {
  ConversionErrorCode,
  type EmscriptenFS,
  type EmscriptenModule,
} from '../src/types.js';
import { createNodeWorkerFailureResponse } from '../src/node-worker-protocol.js';

const OUTPUT_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

const SUCCESS_RESULT: NativeConversionResult = {
  schemaVersion: 1,
  ok: true,
  stage: 'complete',
  cleanup: 'clean',
  hiddenLoad: true,
  visibleFrameSetupEntered: false,
};

function createHarness() {
  const files = new Map<string, Uint8Array>();
  const failReaddirOn = new Set<number>();
  const failUnlinkPaths = new Set<string>();
  let readdirCalls = 0;
  const listDirectory = (directory: string): string[] => {
    const prefix = directory === '/' ? '/' : `${directory}/`;
    const entries = [...files.keys()]
      .filter((path) => path.startsWith(prefix))
      .map((path) => path.slice(prefix.length))
      .filter((entry) => entry.length > 0 && !entry.includes('/'));
    return ['.', '..', ...entries.sort()];
  };
  const fs = {
    mkdir: vi.fn(),
    writeFile: vi.fn((path: string, data: Uint8Array | string) => {
      files.set(
        path,
        typeof data === 'string' ? new TextEncoder().encode(data) : data.slice()
      );
    }),
    readFile: vi.fn((path: string) => {
      const data = files.get(path);
      if (!data) throw new Error(`ENOENT: ${path}`);
      return data.slice();
    }),
    unlink: vi.fn((path: string) => {
      if (failUnlinkPaths.has(path)) throw new Error(`unlink failed: ${path}`);
      if (!files.delete(path)) throw new Error(`ENOENT: ${path}`);
    }),
    readdir: vi.fn((directory: string) => {
      readdirCalls += 1;
      if (failReaddirOn.has(readdirCalls)) {
        throw new Error(`readdir failed #${readdirCalls}: ${directory}`);
      }
      return listDirectory(directory);
    }),
    stat: vi.fn((path: string) => {
      const data = files.get(path);
      if (!data) throw new Error(`ENOENT: ${path}`);
      return { size: data.length, isDirectory: () => false };
    }),
    rmdir: vi.fn(),
    rename: vi.fn(),
    open: vi.fn(),
  };

  const module = {
    FS: fs as unknown as EmscriptenFS,
  } as unknown as EmscriptenModule;

  const nativeConvert = vi.fn<
    (request: NativeConversionRequest) => NativeConversionResult
  >((request) => {
    files.set(request.outputUrl.replace(/^file:\/\//, ''), OUTPUT_BYTES.slice());
    return SUCCESS_RESULT;
  });
  const documentLoad = vi.fn<(path: string) => number>(() => 77);
  const documentLoadWithOptions = vi.fn<
    (path: string, options: string) => number
  >(() => 77);
  const documentSaveAs = vi.fn<
    (document: number, outputPath: string, format: string, options: string) => void
  >((_document, outputPath) => {
    files.set(outputPath, OUTPUT_BYTES.slice());
  });
  const documentDestroy = vi.fn<(document: number) => void>();
  const bindings = {
    convertDocument: nativeConvert,
    documentLoad,
    documentLoadWithOptions,
    documentSaveAs,
    documentDestroy,
  };

  const converter = new LibreOfficeConverter();
  Object.assign(converter as unknown as Record<string, unknown>, {
    module,
    lokBindings: bindings,
    initialized: true,
    corrupted: false,
  });

  return {
    converter,
    fs,
    files,
    failReaddirOn,
    failUnlinkPaths,
    module,
    nativeConvert,
    documentLoad,
    documentLoadWithOptions,
    documentSaveAs,
    documentDestroy,
  };
}

async function convertDocxToPdf(converter: LibreOfficeConverter): Promise<void> {
  await converter.convert(
    new Uint8Array([1, 2, 3]),
    { inputFormat: 'docx', outputFormat: 'pdf' },
    'report.docx'
  );
}

describe('native basic conversion path', () => {
  it('sends DOCX -> PDF through the explicit native filter without raw document calls', async () => {
    const harness = createHarness();

    const result = await harness.converter.convert(
      new Uint8Array([1, 2, 3]),
      { inputFormat: 'docx', outputFormat: 'pdf' },
      'report.docx'
    );

    expect(result.data).toEqual(OUTPUT_BYTES);
    expect(harness.nativeConvert).toHaveBeenCalledWith(expect.objectContaining({
      schemaVersion: 1,
      inputUrl: 'file:///tmp/input/doc.docx',
      outputUrl: 'file:///tmp/output/doc.pdf',
      outputFilter: 'writer_pdf_Export',
    }));
    expect(harness.documentLoad).not.toHaveBeenCalled();
    expect(harness.documentLoadWithOptions).not.toHaveBeenCalled();
    expect(harness.documentSaveAs).not.toHaveBeenCalled();
    expect(harness.documentDestroy).not.toHaveBeenCalled();
  });

  it('passes the zero CSV default to native execution', async () => {
    const harness = createHarness();

    await harness.converter.convert(
      new Uint8Array([1, 2, 3]),
      { inputFormat: 'xlsx', outputFormat: 'csv' },
      'report.xlsx'
    );

    expect(harness.nativeConvert).toHaveBeenCalledWith(expect.objectContaining({
      outputUrl: 'file:///tmp/output/doc.csv',
      outputFilterOptions: '44,34,76,1,,0,false,true,false,false,false,0',
    }));
  });

  it.each(['-1', '1', '-2', 'sheet'])(
    'rejects CSV sheet token %j before native execution',
    async (sheetToken) => {
      const harness = createHarness();

      await expect(harness.converter.convert(
        new Uint8Array([1, 2, 3]),
        {
          inputFormat: 'xlsx',
          outputFormat: 'csv',
          filterOptions: `44,34,76,1,,0,false,true,false,false,false,${sheetToken}`,
        },
        'report.xlsx'
      )).rejects.toMatchObject({ code: ConversionErrorCode.INVALID_INPUT });
      expect(harness.nativeConvert).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['missing', () => { throw new Error('ENOENT'); }],
    ['empty', () => new Uint8Array()],
  ] as const)('rejects native success when the exact CSV output is %s', async (_case, read) => {
    const harness = createHarness();
    harness.fs.readFile.mockImplementation(read);

    await expect(harness.converter.convert(
      new Uint8Array([1, 2, 3]),
      { inputFormat: 'xlsx', outputFormat: 'csv' },
      'report.xlsx'
    )).rejects.toMatchObject({
      code: ConversionErrorCode.CONVERSION_FAILED,
      message: expect.stringContaining('output contract violation'),
    });
    expect(harness.nativeConvert).toHaveBeenCalledOnce();
  });

  it('removes only new suffixed CSV siblings after success', async () => {
    const harness = createHarness();
    harness.files.set('/tmp/output/doc-existing.csv', new Uint8Array([7]));
    harness.files.set('/tmp/output/notes.csv', new Uint8Array([8]));
    harness.files.set('/tmp/output/other-Sheet1.csv', new Uint8Array([9]));
    harness.nativeConvert.mockImplementationOnce((request) => {
      harness.files.set(request.outputUrl.replace(/^file:\/\//, ''), OUTPUT_BYTES.slice());
      harness.files.set('/tmp/output/doc-Sheet1.csv', new Uint8Array([1]));
      return SUCCESS_RESULT;
    });

    await harness.converter.convert(
      new Uint8Array([1, 2, 3]),
      { inputFormat: 'xlsx', outputFormat: 'csv' },
      'report.xlsx'
    );

    expect(harness.fs.unlink).toHaveBeenCalledWith('/tmp/output/doc-Sheet1.csv');
    expect(harness.fs.unlink).not.toHaveBeenCalledWith('/tmp/output/doc-existing.csv');
    expect(harness.fs.unlink).not.toHaveBeenCalledWith('/tmp/output/notes.csv');
    expect(harness.fs.unlink).not.toHaveBeenCalledWith('/tmp/output/other-Sheet1.csv');
    expect(harness.files.has('/tmp/output/doc-Sheet1.csv')).toBe(false);
    expect(harness.files.has('/tmp/output/doc-existing.csv')).toBe(true);
    expect(harness.files.has('/tmp/output/notes.csv')).toBe(true);
    expect(harness.files.has('/tmp/output/other-Sheet1.csv')).toBe(true);
  });

  it('removes new suffixed CSV siblings after native failure', async () => {
    const harness = createHarness();
    harness.nativeConvert.mockImplementation(() => {
      harness.files.set('/tmp/output/doc-Sheet1.csv', new Uint8Array([1]));
      return {
        schemaVersion: 1,
        ok: false,
        stage: 'export',
        cleanup: 'clean',
        hiddenLoad: true,
        visibleFrameSetupEntered: false,
        message: 'export failed',
      };
    });

    await expect(harness.converter.convert(
      new Uint8Array([1, 2, 3]),
      { inputFormat: 'xlsx', outputFormat: 'csv' },
      'report.xlsx'
    )).rejects.toMatchObject({ code: ConversionErrorCode.CONVERSION_FAILED });

    expect(harness.fs.unlink).toHaveBeenCalledWith('/tmp/output/doc-Sheet1.csv');
    expect(harness.files.has('/tmp/output/doc-Sheet1.csv')).toBe(false);
  });

  it('removes a stale exact output before native execution and never returns it', async () => {
    const harness = createHarness();
    harness.files.set('/tmp/output/doc.csv', new Uint8Array([9, 9, 9]));
    harness.nativeConvert.mockReturnValueOnce(SUCCESS_RESULT);

    await expect(harness.converter.convert(
      new Uint8Array([1, 2, 3]),
      { inputFormat: 'xlsx', outputFormat: 'csv' },
      'report.xlsx'
    )).rejects.toMatchObject({
      code: ConversionErrorCode.CONVERSION_FAILED,
      message: expect.stringContaining('exact output /tmp/output/doc.csv is missing'),
    });

    expect(harness.fs.unlink).toHaveBeenCalledWith('/tmp/output/doc.csv');
    expect(harness.files.has('/tmp/output/doc.csv')).toBe(false);
    expect(harness.converter.isReady()).toBe(true);
  });

  it('quarantines before native execution when the baseline cannot be enumerated', async () => {
    const harness = createHarness();
    harness.failReaddirOn.add(1);

    let failure: unknown;
    try {
      await harness.converter.convert(
        new Uint8Array([1]),
        { inputFormat: 'xlsx', outputFormat: 'csv' },
        'report.xlsx'
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      code: ConversionErrorCode.CONVERSION_FAILED,
      message: expect.stringContaining('cleanup uncertainty'),
    });
    expect(harness.nativeConvert).not.toHaveBeenCalled();
    expect(harness.converter.isReady()).toBe(false);
    expect(createNodeWorkerFailureResponse(
      'convert-id', 'convert', failure, harness.converter
    )).toMatchObject({ quarantine: true });
  });

  it('quarantines when stale exact-output removal fails before native execution', async () => {
    const harness = createHarness();
    harness.files.set('/tmp/output/doc.csv', new Uint8Array([9]));
    harness.failUnlinkPaths.add('/tmp/output/doc.csv');

    await expect(harness.converter.convert(
      new Uint8Array([1]),
      { inputFormat: 'xlsx', outputFormat: 'csv' },
      'report.xlsx'
    )).rejects.toMatchObject({
      message: expect.stringContaining('could not remove stale exact output'),
    });
    expect(harness.nativeConvert).not.toHaveBeenCalled();
    expect(harness.files.has('/tmp/output/doc.csv')).toBe(true);
    expect(harness.converter.isReady()).toBe(false);
  });

  it('quarantines when stale exact-output absence cannot be proven', async () => {
    const harness = createHarness();
    harness.files.set('/tmp/output/doc.csv', new Uint8Array([9]));
    harness.failReaddirOn.add(2);

    await expect(harness.converter.convert(
      new Uint8Array([1]),
      { inputFormat: 'xlsx', outputFormat: 'csv' },
      'report.xlsx'
    )).rejects.toMatchObject({
      message: expect.stringContaining('could not prove stale exact output'),
    });
    expect(harness.nativeConvert).not.toHaveBeenCalled();
    expect(harness.files.has('/tmp/output/doc.csv')).toBe(false);
    expect(harness.converter.isReady()).toBe(false);
  });

  it.each([
    ['input', '/tmp/input/doc.xlsx'],
    ['exact output', '/tmp/output/doc.csv'],
  ])('rejects success and quarantines when %s cleanup unlink fails', async (_label, path) => {
    const harness = createHarness();
    harness.failUnlinkPaths.add(path);

    await expect(harness.converter.convert(
      new Uint8Array([1]),
      { inputFormat: 'xlsx', outputFormat: 'csv' },
      'report.xlsx'
    )).rejects.toMatchObject({
      message: expect.stringContaining('cleanup uncertainty'),
    });
    expect(harness.files.has(path)).toBe(true);
    expect(harness.converter.isReady()).toBe(false);
  });

  it('rejects success and quarantines when a new CSV sibling cannot be removed', async () => {
    const harness = createHarness();
    harness.failUnlinkPaths.add('/tmp/output/doc-Sheet1.csv');
    harness.nativeConvert.mockImplementationOnce((request) => {
      harness.files.set(request.outputUrl.replace(/^file:\/\//, ''), OUTPUT_BYTES.slice());
      harness.files.set('/tmp/output/doc-Sheet1.csv', new Uint8Array([1]));
      return SUCCESS_RESULT;
    });

    await expect(harness.converter.convert(
      new Uint8Array([1]),
      { inputFormat: 'xlsx', outputFormat: 'csv' },
      'report.xlsx'
    )).rejects.toMatchObject({
      message: expect.stringContaining('cleanup uncertainty'),
    });
    expect(harness.files.has('/tmp/output/doc-Sheet1.csv')).toBe(true);
    expect(harness.converter.isReady()).toBe(false);
  });

  it('rejects success and quarantines when post-cleanup enumeration fails', async () => {
    const harness = createHarness();
    harness.failReaddirOn.add(5);

    await expect(harness.converter.convert(
      new Uint8Array([1]),
      { inputFormat: 'xlsx', outputFormat: 'csv' },
      'report.xlsx'
    )).rejects.toMatchObject({
      message: expect.stringContaining('could not enumerate /tmp/output after cleanup'),
    });
    expect(harness.converter.isReady()).toBe(false);
  });

  it('preserves a conversion failure while recording cleanup uncertainty', async () => {
    const harness = createHarness();
    harness.failUnlinkPaths.add('/tmp/input/doc.xlsx');
    harness.nativeConvert.mockReturnValue({
      schemaVersion: 1,
      ok: false,
      stage: 'export',
      cleanup: 'clean',
      hiddenLoad: true,
      visibleFrameSetupEntered: false,
      message: 'original export failure',
    });

    let failure: unknown;
    try {
      await harness.converter.convert(
        new Uint8Array([1]),
        { inputFormat: 'xlsx', outputFormat: 'csv' },
        'report.xlsx'
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      message: 'original export failure',
      details: expect.stringContaining('cleanup uncertainty'),
      cleanupUncertainty: expect.objectContaining({
        message: expect.stringContaining('transaction input'),
      }),
    });
    expect(harness.converter.isReady()).toBe(false);
  });

  it('returns the cleanup wrapper when a non-Error primary failure is also uncertain', async () => {
    const harness = createHarness();
    harness.fs.writeFile.mockImplementationOnce(() => {
      throw 'raw write failure';
    });
    harness.failReaddirOn.add(5);

    let failure: unknown;
    try {
      await harness.converter.convert(
        new Uint8Array([1]),
        { inputFormat: 'xlsx', outputFormat: 'csv' },
        'report.xlsx'
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      name: 'ConversionCleanupUncertaintyError',
      message: expect.stringContaining('could not enumerate /tmp/output after cleanup'),
    });
    expect((failure as Error & { primaryFailure?: unknown }).primaryFailure)
      .toBe('raw write failure');
    expect(harness.converter.isReady()).toBe(false);
  });

  it('reuses the same runtime for two clean native conversions', async () => {
    const harness = createHarness();

    await convertDocxToPdf(harness.converter);
    await convertDocxToPdf(harness.converter);

    expect(harness.nativeConvert).toHaveBeenCalledTimes(2);
    expect(harness.converter.isReady()).toBe(true);
    expect(harness.converter.getModule()).toBe(harness.module);
  });

  it.each([
    ['validate', {
      schemaVersion: 1,
      ok: false,
      stage: 'validate',
      cleanup: 'not-needed',
      hiddenLoad: false,
      visibleFrameSetupEntered: false,
      message: 'request rejected',
    }],
    ['load', {
      schemaVersion: 1,
      ok: false,
      stage: 'load',
      cleanup: 'not-needed',
      hiddenLoad: false,
      visibleFrameSetupEntered: false,
      message: 'document could not be loaded',
    }],
    ['export', {
      schemaVersion: 1,
      ok: false,
      stage: 'export',
      cleanup: 'clean',
      hiddenLoad: true,
      visibleFrameSetupEntered: false,
      message: 'export failed',
    }],
  ] as Array<[string, NativeConversionResult]>) (
    'keeps the runtime reusable after a clean %s failure',
    async (stage, failure) => {
      const harness = createHarness();
      harness.nativeConvert.mockImplementationOnce(() => failure);

      await expect(convertDocxToPdf(harness.converter)).rejects.toMatchObject({
        code: stage === 'load'
          ? ConversionErrorCode.LOAD_FAILED
          : ConversionErrorCode.CONVERSION_FAILED,
      });
      expect(harness.converter.isReady()).toBe(true);
      expect(harness.converter.getModule()).toBe(harness.module);

      await expect(convertDocxToPdf(harness.converter)).resolves.toBeUndefined();
      expect(harness.nativeConvert).toHaveBeenCalledTimes(2);
    }
  );

  it('quarantines an uncertain-cleanup runtime', async () => {
    const harness = createHarness();
    harness.nativeConvert.mockReturnValue({
      schemaVersion: 1,
      ok: false,
      stage: 'cleanup',
      cleanup: 'uncertain',
      hiddenLoad: true,
      visibleFrameSetupEntered: false,
      message: 'close was vetoed',
    });

    await expect(convertDocxToPdf(harness.converter)).rejects.toMatchObject({
      code: ConversionErrorCode.CONVERSION_FAILED,
    });

    expect(harness.converter.isReady()).toBe(false);
    expect(harness.converter.getModule()).toBeNull();
    expect(harness.converter.getLokBindings()).toBeNull();
  });

  it('keeps PNG conversion on the legacy raw document-pointer path', async () => {
    const harness = createHarness();

    await harness.converter.convert(
      new Uint8Array([1, 2, 3]),
      { inputFormat: 'docx', outputFormat: 'png' },
      'report.docx'
    );

    expect(harness.nativeConvert).not.toHaveBeenCalled();
    expect(harness.documentLoad).toHaveBeenCalledWith('/tmp/input/doc.docx');
    expect(harness.documentSaveAs).toHaveBeenCalledWith(
      77,
      '/tmp/output/doc.png',
      'png',
      expect.any(String)
    );
    expect(harness.documentDestroy).toHaveBeenCalledWith(77);
  });
});
