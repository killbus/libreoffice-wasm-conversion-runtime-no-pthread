#!/usr/bin/env node

import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const FORBIDDEN_GLUE_MARKERS = Object.freeze([
  'PThread',
  'SharedArrayBuffer',
  'mainScriptUrlOrBlob',
  'soffice.worker.',
]);

const PTHREAD_IMPORT_PATTERN = /(?:^|_)(?:pthread|emscripten_(?:futex|thread)|wasi_thread_spawn)/i;

function fail(message) {
  throw new Error(`No-pthread runtime verification failed: ${message}`);
}

function readVarUint(bytes, cursor) {
  let value = 0;
  let shift = 0;
  while (cursor.offset < bytes.length) {
    const byte = bytes[cursor.offset++];
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return value >>> 0;
    shift += 7;
    if (shift > 35) fail('invalid unsigned LEB128 value');
  }
  fail('unexpected end of WebAssembly binary');
}

function skipName(bytes, cursor) {
  const length = readVarUint(bytes, cursor);
  cursor.offset += length;
  if (cursor.offset > bytes.length) fail('truncated WebAssembly name');
}

function readName(bytes, cursor) {
  const length = readVarUint(bytes, cursor);
  const end = cursor.offset + length;
  if (end > bytes.length) fail('truncated WebAssembly name');
  const value = new TextDecoder().decode(bytes.subarray(cursor.offset, end));
  cursor.offset = end;
  return value;
}

function readLimits(bytes, cursor) {
  const flags = readVarUint(bytes, cursor);
  readVarUint(bytes, cursor);
  if ((flags & 1) !== 0) readVarUint(bytes, cursor);
  return { shared: (flags & 2) !== 0 };
}

function inspectWasmMemory(bytes) {
  if (bytes.length < 8 || bytes[0] !== 0x00 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) {
    fail('soffice.wasm has an invalid WebAssembly header');
  }

  const cursor = { offset: 8 };
  const imports = [];
  let sharedMemory = false;

  while (cursor.offset < bytes.length) {
    const sectionId = bytes[cursor.offset++];
    const sectionSize = readVarUint(bytes, cursor);
    const sectionEnd = cursor.offset + sectionSize;
    if (sectionEnd > bytes.length) fail(`truncated WebAssembly section ${sectionId}`);

    if (sectionId === 2) {
      const count = readVarUint(bytes, cursor);
      for (let index = 0; index < count; index += 1) {
        const moduleName = readName(bytes, cursor);
        const fieldName = readName(bytes, cursor);
        const kind = bytes[cursor.offset++];
        imports.push({ module: moduleName, name: fieldName, kind });
        if (kind === 0) {
          readVarUint(bytes, cursor);
        } else if (kind === 1) {
          cursor.offset += 1;
          if (readLimits(bytes, cursor).shared) sharedMemory = true;
        } else if (kind === 2) {
          if (readLimits(bytes, cursor).shared) sharedMemory = true;
        } else if (kind === 3) {
          cursor.offset += 2;
        } else if (kind === 4) {
          readVarUint(bytes, cursor);
          readVarUint(bytes, cursor);
        } else {
          fail(`unsupported WebAssembly import kind ${kind}`);
        }
      }
    } else if (sectionId === 5) {
      const count = readVarUint(bytes, cursor);
      for (let index = 0; index < count; index += 1) {
        if (readLimits(bytes, cursor).shared) sharedMemory = true;
      }
    }

    cursor.offset = sectionEnd;
  }

  return { imports, sharedMemory };
}

export async function inspectNoPthreadRuntime(runtimeDirectory) {
  const directory = resolve(runtimeDirectory);
  const entries = await readdir(directory);
  const workerFiles = entries.filter((name) => /^soffice\.worker\./.test(name));
  if (workerFiles.length > 0) {
    fail(`unexpected pthread worker artifacts: ${workerFiles.join(', ')}`);
  }

  const glueFiles = entries.filter((name) => name === 'soffice.js' || name === 'soffice.cjs');
  if (!glueFiles.includes('soffice.js')) fail('soffice.js is missing');
  for (const glueFile of glueFiles) {
    const glue = await readFile(resolve(directory, glueFile), 'utf8');
    const forbiddenMarkers = FORBIDDEN_GLUE_MARKERS.filter((marker) => glue.includes(marker));
    if (forbiddenMarkers.length > 0) {
      fail(`${glueFile} contains threaded glue markers: ${forbiddenMarkers.join(', ')}`);
    }
  }

  const wasmPath = resolve(directory, 'soffice.wasm');
  const wasmBytes = await readFile(wasmPath);
  const { imports, sharedMemory } = inspectWasmMemory(wasmBytes);
  if (sharedMemory) fail('soffice.wasm declares shared memory');

  const pthreadImports = imports.filter(({ module, name }) =>
    PTHREAD_IMPORT_PATTERN.test(`${module}.${name}`)
  );
  if (pthreadImports.length > 0) {
    fail(`soffice.wasm imports pthread functions: ${pthreadImports.map(({ module, name }) => `${module}.${name}`).join(', ')}`);
  }

  return {
    threading: 'none',
    workerFiles,
    imports: imports.map(({ module, name }) => `${module}.${name}`),
    sharedMemory,
  };
}

const isCli = process.argv[1] !== undefined
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isCli) {
  try {
    const runtimeDirectory = process.argv[2];
    if (!runtimeDirectory) fail('usage: inspect-no-pthread-runtime.mjs <runtime-directory>');
    const report = await inspectNoPthreadRuntime(runtimeDirectory);
    console.log(`[no-pthread] verified ${resolve(runtimeDirectory)}: threading=${report.threading}, imports=${report.imports.length}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
