#!/usr/bin/env node
// Real-Chromium no-pthread acceptance. Serves explicit candidate assets without
// cross-origin isolation and records every runtime request.

import http from "node:http";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { chromium } from "playwright";
import { parseOptions, CliUsageError } from "./lib/cli.mjs";
import { serializePrettyJson } from "./lib/canonical.mjs";

const USAGE = `Usage:
  node scripts/release-runtime/browser-worker-gate.mjs \\
    --native-root <downloaded-native-dir> \\
    --wrapper-root <wrapper-build-dir> \\
    --fixture <docx-file> \\
    --out <evidence.json> \\
    [--chrome <executable>]`;
const FLAGS = new Set([
  "native-root",
  "wrapper-root",
  "fixture",
  "out",
  "chrome",
]);
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
  ".data": "application/octet-stream",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function buildAssets(args) {
  const nativeRoot = resolve(args["native-root"]);
  const wrapperRoot = resolve(args["wrapper-root"]);
  const fixture = resolve(args.fixture);
  const paths = new Map([
    ["/dist/browser.js", resolve(wrapperRoot, "dist/browser.js")],
    [
      "/dist/browser.worker.global.js",
      resolve(wrapperRoot, "dist/browser.worker.global.js"),
    ],
    ["/wasm/soffice.js", resolve(nativeRoot, "soffice.js")],
    ["/wasm/soffice.wasm", resolve(nativeRoot, "soffice.wasm")],
    ["/wasm/soffice.data", resolve(nativeRoot, "soffice.data")],
    ["/fixture.docx", fixture],
  ]);
  const assets = new Map();
  for (const [urlPath, filePath] of paths) {
    assets.set(urlPath, { filePath, bytes: await readFile(filePath) });
  }
  return assets;
}

function gateHtml() {
  return Buffer.from(
    `<!doctype html><meta charset="utf-8"><title>runtime gate</title>
<script type="module">
globalThis.__gateResult = { status: 'running' };
const startedAt = Date.now();
let converter;
try {
  const { createWorkerBrowserConverter } = await import('/dist/browser.js');
  converter = createWorkerBrowserConverter({
    browserWorkerJs: '/dist/browser.worker.global.js',
    sofficeJs: '/wasm/soffice.js',
    sofficeWasm: '/wasm/soffice.wasm',
    sofficeData: '/wasm/soffice.data',
  });
  const facadeKeys = Object.keys(converter).sort();
  const frozen = Object.isFrozen(converter);
  await converter.initialize();
  const input = new Uint8Array(await (await fetch('/fixture.docx')).arrayBuffer());
  const result = await converter.convert(
    input,
    { inputFormat: 'docx', outputFormat: 'pdf' },
    'fixture.docx',
  );
  const head = new TextDecoder('ascii').decode(result.data.slice(0, 5));
  globalThis.__gateResult = {
    status: 'passed',
    crossOriginIsolated,
    sharedArrayBuffer: typeof SharedArrayBuffer === 'function',
    facadeKeys,
    frozen,
    pdfHead: head,
    pdfBytes: result.data.length,
    mimeType: result.mimeType,
    filename: result.filename,
    ms: Date.now() - startedAt,
  };
} catch (error) {
  globalThis.__gateResult = {
    status: 'failed',
    error: error instanceof Error ? error.stack || error.message : String(error),
    ms: Date.now() - startedAt,
  };
} finally {
  if (converter) {
    try {
      await converter.destroy();
      globalThis.__gateResult.cleanup = {
        destroyed: true,
        readyAfterDestroy: converter.isReady(),
      };
    } catch (error) {
      globalThis.__gateResult.status = 'failed';
      globalThis.__gateResult.cleanup = {
        destroyed: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  globalThis.__gateResult.finished = true;
}
</script>`,
    "utf8",
  );
}

async function main(argv) {
  const args = parseOptions(argv, FLAGS, USAGE, { optional: ["chrome"] });
  const assets = await buildAssets(args);
  assets.set("/gate.html", { filePath: "<generated>", bytes: gateHtml() });
  const serverRequests = [];
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    serverRequests.push(pathname);
    const asset = assets.get(pathname);
    if (!asset) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("not found");
      return;
    }
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": MIME[extname(pathname)] ?? "application/octet-stream",
      "Content-Length": String(asset.bytes.length),
    });
    response.end(asset.bytes);
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });

  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("server has no TCP address");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const browserRequests = [];
  const workerUrls = [];
  const consoleMessages = [];
  let browser;
  let pageResult;
  let gateError;
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: args.chrome ?? "/usr/bin/google-chrome",
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const context = await browser.newContext({ serviceWorkers: "block" });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await cdp.send("Network.setBypassServiceWorker", { bypass: true });
    page.on("request", (request) => {
      browserRequests.push({
        path: new URL(request.url()).pathname,
        resourceType: request.resourceType(),
      });
    });
    page.on("worker", (worker) => workerUrls.push(worker.url()));
    page.on("console", (message) => {
      if (consoleMessages.length < 100) {
        consoleMessages.push({
          type: message.type(),
          text: message.text().slice(0, 1000),
        });
      }
    });
    page.on("pageerror", (error) => {
      consoleMessages.push({
        type: "pageerror",
        text: error.message.slice(0, 1000),
      });
    });
    await page.goto(`${baseUrl}/gate.html`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => globalThis.__gateResult?.finished === true,
      undefined,
      { timeout: 180_000 },
    );
    pageResult = await page.evaluate(() => globalThis.__gateResult);
  } catch (error) {
    gateError =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
  } finally {
    await browser?.close().catch(() => {});
    await new Promise((resolveClose) => server.close(resolveClose));
  }

  const standaloneWorkerRequests = [
    ...new Set(
      [...serverRequests, ...browserRequests.map(({ path }) => path)].filter(
        (path) => path.split("/").at(-1) === "soffice.worker.js",
      ),
    ),
  ];
  const coreRequestCounts = Object.fromEntries(
    [
      "browser.worker.global.js",
      "soffice.js",
      "soffice.wasm",
      "soffice.data",
    ].map((assetName) => [
      assetName,
      serverRequests.filter((path) => path.split("/").at(-1) === assetName)
        .length,
    ]),
  );
  const passed =
    !gateError &&
    pageResult?.status === "passed" &&
    pageResult?.crossOriginIsolated === false &&
    pageResult?.sharedArrayBuffer === false &&
    pageResult?.frozen === true &&
    JSON.stringify(pageResult?.facadeKeys) ===
      JSON.stringify(["convert", "destroy", "initialize", "isReady"]) &&
    pageResult?.pdfHead === "%PDF-" &&
    pageResult?.pdfBytes > 0 &&
    pageResult?.cleanup?.destroyed === true &&
    pageResult?.cleanup?.readyAfterDestroy === false &&
    standaloneWorkerRequests.length === 0 &&
    Object.values(coreRequestCounts).every((count) => count === 1) &&
    workerUrls.length === 1 &&
    workerUrls.every(
      (url) => new URL(url).pathname === "/dist/browser.worker.global.js",
    );

  const evidence = {
    schemaVersion: 1,
    gate: "real-browser-worker-no-pthread",
    status: passed ? "passed" : "failed",
    pageResult,
    gateError,
    workerUrls,
    browserRequests,
    serverRequests,
    coreRequestCounts,
    standaloneWorkerRequests,
    servedAssets: [...assets.entries()].map(([path, asset]) => ({
      path,
      source: asset.filePath,
      bytes: asset.bytes.length,
      sha256: sha256(asset.bytes),
    })),
    consoleMessages,
  };
  const out = resolve(args.out);
  await mkdir(resolve(out, ".."), { recursive: true });
  await writeFile(out, serializePrettyJson(evidence), "utf8");
  process.stdout.write(serializePrettyJson(evidence));
  if (!passed) process.exitCode = 1;
}

if (process.argv.slice(2).includes("--help")) {
  console.log(USAGE);
} else {
  main(process.argv.slice(2)).catch((error) => {
    if (error instanceof CliUsageError) console.error(error.message);
    else
      console.error(
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      );
    process.exitCode = 1;
  });
}
