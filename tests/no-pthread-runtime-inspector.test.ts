import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inspectNoPthreadRuntime } from '../scripts/inspect-no-pthread-runtime.mjs';

const WASM_HEADER = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

function encodeName(value: string): number[] {
  const bytes = [...Buffer.from(value)];
  return [bytes.length, ...bytes];
}

function wasmWithMemoryImport(shared: boolean): Buffer {
  const payload = [
    1,
    ...encodeName('env'),
    ...encodeName('memory'),
    2,
    shared ? 3 : 1,
    1,
    1,
  ];
  return Buffer.from([...WASM_HEADER, 2, payload.length, ...payload]);
}

async function runtimeFixture(glue = 'var Module = {};', wasm = WASM_HEADER) {
  const root = await mkdtemp(join(tmpdir(), 'no-pthread-runtime-'));
  await writeFile(join(root, 'soffice.js'), glue);
  await writeFile(join(root, 'soffice.wasm'), wasm);
  return root;
}

describe('no-pthread runtime inspector', () => {
  it('accepts ordinary glue and unshared WebAssembly memory', async () => {
    const root = await runtimeFixture('var Module = {};', wasmWithMemoryImport(false));
    await expect(inspectNoPthreadRuntime(root)).resolves.toMatchObject({
      threading: 'none',
      sharedMemory: false,
    });
  });

  it.each(['PThread', 'SharedArrayBuffer', 'mainScriptUrlOrBlob', 'soffice.worker.js'])(
    'rejects the threaded glue marker %s',
    async (marker) => {
      const root = await runtimeFixture(`var marker = ${JSON.stringify(marker)};`);
      await expect(inspectNoPthreadRuntime(root)).rejects.toThrow('threaded glue markers');
    },
  );

  it('rejects threaded markers in the packaged Node glue', async () => {
    const root = await runtimeFixture();
    await writeFile(join(root, 'soffice.cjs'), 'var marker = "PThread";');
    await expect(inspectNoPthreadRuntime(root)).rejects.toThrow(
      'soffice.cjs contains threaded glue markers'
    );
  });

  it('rejects a standalone pthread worker artifact', async () => {
    const root = await runtimeFixture();
    await writeFile(join(root, 'soffice.worker.js'), 'worker');
    await expect(inspectNoPthreadRuntime(root)).rejects.toThrow('unexpected pthread worker artifacts');
  });

  it('rejects shared WebAssembly memory', async () => {
    const root = await runtimeFixture('var Module = {};', wasmWithMemoryImport(true));
    await expect(inspectNoPthreadRuntime(root)).rejects.toThrow('declares shared memory');
  });
});
