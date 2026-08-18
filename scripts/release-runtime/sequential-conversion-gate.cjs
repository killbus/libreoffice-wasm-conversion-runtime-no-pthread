#!/usr/bin/env node
// Run the bounded downloaded-byte conversion matrix with one converter and no
// retries. The process owns one WASM instance for the whole matrix and writes
// only compact hashes/headers, not full conversion outputs.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 2) {
    const key = argv[index]?.replace(/^--/, '');
    const value = argv[index + 1];
    if (!key || value === undefined || value.startsWith('--')) {
      throw new Error('arguments must be --name value pairs');
    }
    args[key] = value;
  }
  for (const key of ['wasm-dir', 'docx', 'xlsx', 'pptx', 'pdf', 'work']) {
    if (!args[key]) throw new Error(`Missing --${key}`);
  }
  return args;
}

const args = parseArgs(process.argv);
const wasmDir = path.resolve(args['wasm-dir']);
const workDir = path.resolve(args.work);
fs.mkdirSync(workDir, { recursive: true });

const loaderPath = path.join(wasmDir, 'loader.cjs');
if (!fs.existsSync(loaderPath)) throw new Error(`loader.cjs not found in ${wasmDir}`);
const wasmLoader = require(loaderPath);
const repoRoot = path.resolve(__dirname, '..', '..');
const { createConverter } = require(path.join(repoRoot, 'dist', 'index.cjs'));

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function head(bytes, length = 16) {
  return Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(length, bytes.byteLength));
}

function checkOutput(caseName, result) {
  const bytes = result.data;
  if (!bytes || bytes.length === 0) throw new Error(`${caseName} returned empty output`);
  const outputHead = head(bytes);
  const checks = {
    'docx-pdf': outputHead.subarray(0, 5).toString('ascii') === '%PDF-',
    'xlsx-csv': bytes.length > 0,
    'pptx-pdf': outputHead.subarray(0, 5).toString('ascii') === '%PDF-',
    'pdf-png': outputHead.subarray(0, 8).equals(Buffer.from('\x89PNG\r\n\x1a\n', 'binary')),
    'pptx-svg': /^\uFEFF?\s*(?:<\?xml[^?]*\?>\s*)?(?:<!DOCTYPE\s+svg\b[^>]*>\s*)?<svg\b/i.test(
      Buffer.from(bytes).toString('utf8', 0, 512),
    ),
  };
  if (!checks[caseName]) throw new Error(`${caseName} failed output signature check`);
  return {
    bytes: bytes.length,
    sha256: sha256(bytes),
    headHex: outputHead.toString('hex'),
    mimeType: result.mimeType,
    filename: result.filename,
  };
}

async function main() {
  const cases = [
    { name: 'docx-pdf', input: args.docx, inputFormat: 'docx', outputFormat: 'pdf' },
    { name: 'xlsx-csv', input: args.xlsx, inputFormat: 'xlsx', outputFormat: 'csv' },
    { name: 'pptx-pdf', input: args.pptx, inputFormat: 'pptx', outputFormat: 'pdf' },
    { name: 'pdf-png', input: args.pdf, inputFormat: 'pdf', outputFormat: 'png', image: { pageIndex: 0 } },
    { name: 'pptx-svg', input: args.pptx, inputFormat: 'pptx', outputFormat: 'svg', image: { pageIndex: 0 } },
  ];
  const evidence = {
    gate: 'sequential-conversion-matrix',
    status: 'running',
    wasmDir,
    cases: [],
    startedAt: new Date().toISOString(),
  };
  let converter;
  try {
    converter = await createConverter({ wasmLoader, wasmPath: wasmDir, verbose: false });
    for (const testCase of cases) {
      const inputPath = path.resolve(testCase.input);
      const input = fs.readFileSync(inputPath);
      const started = Date.now();
      const result = await converter.convert(
        input,
        {
          inputFormat: testCase.inputFormat,
          outputFormat: testCase.outputFormat,
          ...(testCase.image ? { image: testCase.image } : {}),
        },
        path.basename(inputPath),
      );
      evidence.cases.push({
        name: testCase.name,
        input: inputPath,
        inputBytes: input.length,
        ms: Date.now() - started,
        ...checkOutput(testCase.name, result),
      });
    }
    evidence.status = 'passed';
  } catch (error) {
    evidence.status = 'failed';
    evidence.error = error instanceof Error ? error.stack || error.message : String(error);
    throw error;
  } finally {
    if (converter) {
      try {
        await converter.destroy();
        evidence.cleanup = { destroyed: true, readyAfterDestroy: converter.isReady() };
      } catch (error) {
        evidence.cleanup = {
          destroyed: false,
          error: error instanceof Error ? error.message : String(error),
        };
        evidence.status = 'failed';
      }
    }
    evidence.finishedAt = new Date().toISOString();
    fs.writeFileSync(
      path.join(workDir, 'sequential-conversion-result.json'),
      JSON.stringify(evidence, null, 2),
    );
  }
  console.log(JSON.stringify(evidence, null, 2));
}

main().catch(() => process.exitCode = 1);
