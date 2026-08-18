import { beforeEach, describe, expect, it, vi } from 'vitest';
import { convertDocument, ConversionErrorCode } from '../src/index.js';
import { convertDocument as convertServerDocument } from '../src/server.js';

const subprocessMocks = vi.hoisted(() => ({
  createSubprocessConverter: vi.fn(async () => {
    throw new Error('WASM initialization must not be reached');
  }),
}));

vi.mock('../src/subprocess.worker-converter.js', () => ({
  SubprocessConverter: class {},
  createSubprocessConverter: subprocessMocks.createSubprocessConverter,
}));

describe('convertDocument request validation', () => {
  beforeEach(() => {
    subprocessMocks.createSubprocessConverter.mockClear();
  });

  it('rejects an unknown output format before initializing WASM', async () => {
    await expect(
      convertDocument(new Uint8Array([1]), {
        inputFormat: 'docx',
        outputFormat: 'mp3' as never,
      })
    ).rejects.toMatchObject({
      name: 'ConversionError',
      code: ConversionErrorCode.UNSUPPORTED_FORMAT,
      message: 'Unsupported output format: mp3',
    });

    expect(subprocessMocks.createSubprocessConverter).not.toHaveBeenCalled();
  });

  it('rejects an unsupported conversion path before initializing WASM', async () => {
    await expect(
      convertDocument(new Uint8Array([1]), {
        inputFormat: 'pdf',
        outputFormat: 'docx',
      })
    ).rejects.toMatchObject({
      name: 'ConversionError',
      code: ConversionErrorCode.UNSUPPORTED_FORMAT,
    });

    expect(subprocessMocks.createSubprocessConverter).not.toHaveBeenCalled();
  });

  it.each([
    ['root', convertDocument],
    ['server', convertServerDocument],
  ])('rejects a non-singular CSV sheet option in the %s entry before initializing WASM', async (_entry, convert) => {
    await expect(
      convert(new Uint8Array([1]), {
        inputFormat: 'xlsx',
        outputFormat: 'csv',
        filterOptions: '44,34,76,1,,0,false,true,false,false,false,-1',
      })
    ).rejects.toMatchObject({
      name: 'ConversionError',
      code: ConversionErrorCode.INVALID_INPUT,
      message: expect.stringContaining('token 11'),
    });

    expect(subprocessMocks.createSubprocessConverter).not.toHaveBeenCalled();
  });
});
