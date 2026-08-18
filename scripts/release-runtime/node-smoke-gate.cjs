#!/usr/bin/env node
// node-smoke-gate.cjs — TEAM B Node DOCX->PDF smoke gate with explicit
// converter cleanup evidence (acceptance remediation item 4).
//
// Uses the repository's public createConverter() facade (dist/index.cjs) with
// the EXTRACTED runtime bytes from the downloaded draft release archive as the
// wasmLoader, matching the independent acceptance path. The gate explicitly
// destroys the converter and
// records the disposal in the result phases, closing the documented gap:
// "The bespoke gate did not explicitly dispose the converter or otherwise
// record clean cleanup."
//
// Usage:
//   node scripts/release-runtime/node-smoke-gate.cjs \
//     --extract <extracted-wasm-dir> \
//     --input <docx-fixture> \
//     --work <output-dir>

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    args[key] = argv[i + 1];
  }
  if (!args.extract) { console.error('Missing --extract'); process.exit(2); }
  if (!args.input)   { console.error('Missing --input');   process.exit(2); }
  if (!args.work)    { console.error('Missing --work');    process.exit(2); }
  return args;
}

const args = parseArgs(process.argv);
const wasmDir = path.resolve(args.extract);
const inputDocx = path.resolve(args.input);
const workDir = path.resolve(args.work);
fs.mkdirSync(workDir, { recursive: true });

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

const loaderPath = path.join(wasmDir, 'loader.cjs');
if (!fs.existsSync(loaderPath)) {
  console.error('loader.cjs not found in', wasmDir);
  process.exit(1);
}
const wasmLoader = require(loaderPath);

const scriptDir = path.resolve(__dirname);
const repoRoot = path.resolve(scriptDir, '..', '..');
const { createConverter } = require(path.join(repoRoot, 'dist', 'index.cjs'));

const RESULTS_PATH = 'node-smoke-result.json';

async function main() {
  const results = {
    gate: 'node-smoke',
    startedAt: new Date().toISOString(),
    inputDocx,
    inputDocxSha256: sha256(fs.readFileSync(inputDocx)),
    inputDocxBytes: fs.statSync(inputDocx).size,
    wasmDir,
    phases: [],
    status: 'running',
  };
  let converter = null;

  function log(phase, data) {
    const entry = { phase, ...data };
    results.phases.push(entry);
    console.log(`[${phase}] ${JSON.stringify(data)}`);
  }

  function fail(reason) {
    log('failed', { reason });
    results.status = 'failed';
  }

  try {
    const t0 = Date.now();
    log('init-start', { wasmDir });

    converter = await createConverter({
      wasmLoader,
      wasmPath: wasmDir,
      verbose: false,
    });
    log('init-done', {
      ms: Date.now() - t0,
      facadeKeys: Object.keys(converter).sort(),
      frozen: Object.isFrozen(converter),
    });

    const docxData = fs.readFileSync(inputDocx);

    // Positive gate: DOCX -> PDF -------------------------------------------------
    const t1 = Date.now();
    const result1 = await converter.convert(docxData, { outputFormat: 'pdf', inputFormat: 'docx' }, 'input.docx');
    const pdfHead1 = Buffer.from(result1.data.buffer, result1.data.byteOffset, Math.min(5, result1.data.length)).toString('ascii');
    log('positive', {
      ms: Date.now() - t1,
      pdfBytes: result1.data.length,
      pdfHead: pdfHead1,
      pdfSha256: sha256(result1.data),
      mimeType: result1.mimeType,
      filename: result1.filename,
    });

    if (pdfHead1 !== '%PDF-') {
      fail('positive missing %PDF-');
      return;
    }

    // Reuse gate: second conversion in the same process --------------------------
    const t2 = Date.now();
    const result2 = await converter.convert(docxData, { outputFormat: 'pdf', inputFormat: 'docx' }, 'input.docx');
    const pdfHead2 = Buffer.from(result2.data.buffer, result2.data.byteOffset, Math.min(5, result2.data.length)).toString('ascii');
    log('reuse', {
      ms: Date.now() - t2,
      pdfBytes: result2.data.length,
      pdfHead: pdfHead2,
      pdfSha256: sha256(result2.data),
    });

    if (pdfHead2 !== '%PDF-') {
      fail('reuse missing %PDF-');
      return;
    }

    // Negative gate: unsupported output format ------------------------------------
    const t3 = Date.now();
    let negResult = {};
    try {
      await converter.convert(docxData, { outputFormat: 'mp3', inputFormat: 'docx' }, 'input.docx');
      negResult = { case: 'unsupported-format', unexpectedSuccess: true };
    } catch (error) {
      negResult = {
        case: 'unsupported-format',
        rejected: true,
        errorType: error?.constructor?.name ?? typeof error,
        message: error instanceof Error ? error.message : String(error),
      };
    }
    log('negative', { ms: Date.now() - t3, ...negResult });
    if (negResult.unexpectedSuccess) {
      fail('unsupported output format unexpectedly succeeded');
      return;
    }

    // Recovery gate: valid conversion after the safe failure ----------------------
    const t4 = Date.now();
    const result4 = await converter.convert(docxData, { outputFormat: 'pdf', inputFormat: 'docx' }, 'input.docx');
    const pdfHead4 = Buffer.from(result4.data.buffer, result4.data.byteOffset, Math.min(5, result4.data.length)).toString('ascii');
    log('recovery', {
      ms: Date.now() - t4,
      pdfBytes: result4.data.length,
      pdfHead: pdfHead4,
      pdfSha256: sha256(result4.data),
    });

    if (pdfHead4 !== '%PDF-') {
      fail('recovery missing %PDF-');
      return;
    }

    // Parse downloaded bytes directly; the public facade deliberately exposes no
    // Emscripten module or raw LOK bindings.
    const nativeVerifier = await import(
      path.join(repoRoot, 'scripts', 'verify-native-package-assets.mjs')
    );
    const wasmModule = new WebAssembly.Module(
      fs.readFileSync(path.join(wasmDir, 'soffice.wasm'))
    );
    const wasmExports = WebAssembly.Module.exports(wasmModule).map((entry) => entry.name);
    const lokExportDrift = nativeVerifier.findLokExportDrift(wasmExports);
    const abiExports = {
      lokExports: lokExportDrift.actual,
      missing: lokExportDrift.missing,
      extra: lokExportDrift.extra,
    };
    log('abi-exports', abiExports);
    if (abiExports.missing.length > 0 || abiExports.extra.length > 0) {
      fail('conversion-only LOK export allowlist drift');
    }
  } catch (error) {
    fail(error instanceof Error ? error.stack ?? error.message : String(error));
  } finally {
    if (converter) {
      const cleanupStartedAt = Date.now();
      try {
        await converter.destroy();
        const disposed = {
          ms: Date.now() - cleanupStartedAt,
          destroyed: true,
          initializedFalse: converter.isReady() === false,
        };
        log('cleanup', disposed);
        if (!disposed.initializedFalse) {
          fail('converter cleanup was not recorded as clean');
        }
      } catch (error) {
        log('cleanup', {
          ms: Date.now() - cleanupStartedAt,
          destroyed: false,
          error: error instanceof Error ? error.message : String(error),
        });
        fail('converter cleanup threw');
      }
    }

    if (results.status === 'running') {
      results.status = 'passed';
    }
    finish(results);
  }
}

function finish(results) {
  results.finishedAt = new Date().toISOString();
  const outPath = path.join(workDir, RESULTS_PATH);
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log('\n=== RESULT: ' + results.status.toUpperCase() + ' ===');
  console.log('Evidence: ' + outPath);
  process.exit(results.status === 'passed' ? 0 : 1);
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
