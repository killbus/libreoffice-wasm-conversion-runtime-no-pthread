# Grounded pthread artifact facts

## Compared sources

- Wrapper base: `5e8322ee7bdc4a8c81f9c0c0de0a4fb7157aedf2`.
- LibreOffice dependency branch: `libreoffice-24-8`.
- Independent depth-1 clone:
  `https://github.com/LibreOffice/core.git` at
  `d1c9e0e4e1ddeb24fe8f93e56860b3765043f8b1`.
- Clone proof: `git rev-parse --is-shallow-repository` returned `true`.

## Frozen artifact behavior

- `wasm/soffice.js` is 439,517 bytes and contains the sequence that selects
  `Module["mainScriptUrlOrBlob"]` as `pthreadMainJs` and calls
  `new Worker(pthreadMainJs, workerOptions)`.
- The glue contains no `soffice.worker.js` literal.
- `src/browser.ts` and `src/browser.worker.ts` set `mainScriptUrlOrBlob` to the
  resolved `soffice.js` URL.
- `scripts/release-runtime/candidate-spec.json` declares
  `pthreadWorkerMode: "main-script"` and `externalWorker: null`, with exactly
  eight assets and no standalone worker.
- `src/browser-assets.ts` declares `main-script` and exposes only the browser
  owner Worker, `soffice.js`, `soffice.wasm`, and `soffice.data`.
- `package.json` does not include `soffice.worker.js` in its publish allowlist.

## Wrapper contradiction

- `src/browser-runtime-paths.ts` currently resolves an omitted mode to
  `external` and synthesizes a default standalone-worker URL.
- `src/types.ts` documents the same legacy default, places omitted mode in the
  external branch, and makes `createWasmPaths()` return
  `/wasm/soffice.worker.js`.
- `tests/browser-pthread-worker-mode.test.ts` characterizes that contradictory
  legacy behavior.

## Release guard gap

- The archive verifier already rejects the forbidden basename at any depth.
- Frozen-spec/manifest schema and packager checks compare only the whole path to
  `soffice.worker.js`, so a nested path can bypass those specific guards.
- The existing frozen-spec negative adds a ninth asset and therefore fails the
  exact-eight-assets rule before it proves the worker-name rule.

## Upstream boundary

`solenv/gbuild/platform/EMSCRIPTEN_INTEL_GCC.mk` in the shallow LibreOffice clone
sets `-pthread`, `USE_PTHREADS=1`, and a thread pool, and lists `.worker.js` among
generic auxiliary targets. This proves build capability, not the bootstrap mode
of the checked-in frozen glue. The frozen glue and inventories are authoritative
for this contract.

## Decision

Align the wrapper default with the actual main-script artifact. Preserve explicit
external mode only as a separately selected future profile requiring its own URL
and frozen identity. Never infer, probe, or fall back between profiles. Any new
wrapper or artifact bytes belong to a successor candidate; the old frozen
candidate remains immutable.
