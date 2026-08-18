# Implementation plan: pthread main-script artifact contract

## 1. Default and type contract

- [ ] Make omitted `pthreadWorkerMode` resolve to `main-script`.
- [ ] Make `createWasmPaths()` return the main-script profile without a worker URL.
- [ ] Update public docs and discriminated path types so an omitted mode cannot
      pair with `sofficeWorkerJs`.
- [ ] Keep explicit external mode only with an explicit non-empty worker URL.

## 2. Cross-owner enforcement

- [ ] Reuse one resolver for direct-browser and classic Worker initialization.
- [ ] Assert default init messages contain `pthreadWorkerMode: 'main-script'`
      and no `sofficeWorkerJs` property.
- [ ] Reject main-script/worker URL mixtures, worker-URL-only legacy input,
      unknown modes, empty paths, and explicit external mode without a URL
      synchronously before runtime I/O.
- [ ] Retain fail-closed handling when main-script glue unexpectedly requests a
      `*.worker.*` file; do not probe or fall back.

## 3. Inventory and release guards

- [ ] Centralize standalone-worker basename detection.
- [ ] Apply it to frozen-spec, manifest, packager, and archive-verifier paths.
- [ ] Add nested-path negatives that exercise the basename guard directly.
- [ ] Inspect actual `npm pack --dry-run --json --ignore-scripts` inventory and
      reject `soffice.worker.js` at any depth.
- [ ] Leave candidate spec, browser-assets, package allowlist, and native/WASM
      bytes unchanged.

## 4. Verification

- [ ] Run focused resolver/Worker-init tests and TypeScript typecheck.
- [ ] Run package, native-package, schema, packager, verifier, and canonical
      identity suites.
- [ ] Run the relevant broader test suite and `git diff --check`.
- [ ] Audit the diff to prove no frozen candidate/native/WASM mutation.
- [ ] With a runnable successor artifact, run the real-browser default conversion
      gate and prove zero standalone-worker requests.
- [ ] Prove wrapper/runtime/manifest/asset changes derive a successor candidate
      identity rather than mutating the old identity.

## Ground-fact constraints

- Actual checked-in glue behavior outranks assumptions based on generic
  Emscripten or LibreOffice build files.
- LibreOffice's `libreoffice-24-8` build configuration proves pthread support and
  recognizes possible `.worker.js` auxiliary targets, but it does not prove that
  this particular frozen artifact uses external-worker glue.
- Real-browser evidence is not complete while `wasm/soffice.wasm` is only a Git
  LFS pointer; record that as a successor qualification gate, not a passing test.
