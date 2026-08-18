# Implementation plan: pthread main-script artifact contract

## 1. Default and type contract

- [x] Make omitted `pthreadWorkerMode` resolve to `main-script`.
- [x] Make `createWasmPaths()` return the main-script profile without a worker URL.
- [x] Update public docs and discriminated path types so an omitted mode cannot
      pair with `sofficeWorkerJs`.
- [x] Keep explicit external mode only with an explicit non-empty worker URL.

## 2. Cross-owner enforcement

- [x] Reuse one resolver for direct-browser and classic Worker initialization.
- [x] Assert default init messages contain `pthreadWorkerMode: 'main-script'`
      and no `sofficeWorkerJs` property.
- [x] Reject main-script/worker URL mixtures, worker-URL-only legacy input,
      unknown modes, empty paths, and explicit external mode without a URL
      synchronously before runtime I/O.
- [x] Retain fail-closed handling when main-script glue unexpectedly requests a
      `*.worker.*` file; do not probe or fall back.

## 3. Inventory and release guards

- [x] Centralize standalone-worker basename detection.
- [x] Apply it to frozen-spec, manifest, packager, and archive-verifier paths.
- [x] Add nested-path negatives that exercise the basename guard directly.
- [x] Inspect actual `npm pack --dry-run --json --ignore-scripts` inventory and
      reject `soffice.worker.js` at any depth.
- [x] Make the active native build and CI artifact upload explicit main-script
      producers with no file-existence inference or standalone worker output.
- [x] Leave candidate spec, browser-assets, package allowlist, and native/WASM
      bytes unchanged.

## 4. Verification

- [x] Run focused resolver/Worker-init tests and TypeScript typecheck.
- [x] Run package, schema, packager, verifier, and canonical identity suites.
- [x] Run the native-package byte gate with materialized successor assets.
- [x] Run the broader unit suite, classify artifact-dependent failures, and run
      `git diff --check`.
- [x] Audit the diff to prove no frozen candidate/native/WASM mutation.
- [x] With a runnable successor artifact, run the real-browser default conversion
      gate and prove zero standalone-worker requests.
- [x] Prove wrapper provenance, runtime profile, identity-bearing manifest
      fields, and declared asset byte/hash changes derive a successor candidate
      identity rather than mutating the old identity.

## Implementation evidence

- Wrapper/type matrix: `src/types.ts`, `src/browser-runtime-paths.ts`, and
  `tests/browser-pthread-worker-mode.test.ts`; omitted mode is main-script,
  external mode requires a non-empty explicit URL, mixed/legacy/unknown inputs
  fail before a browser Worker is created, and default init messages omit the
  standalone-worker property.
- Inventory matrix: one `isForbiddenWorkerPath()` predicate is shared by frozen
  spec, candidate manifest, packager preflight, and archive verification.
  Nested-path negatives reach each intended guard. `tests/package-contract.test.ts`
  checks a controlled, materialized `dist/` through the actual
  `npm pack --dry-run --json --ignore-scripts` file list and proves a nested
  forbidden fixture would be published and detected.
- Build-profile matrix: `build/build-wasm.sh` requires main-script glue, rejects
  external-worker glue, ignores optional sidecar presence, removes stale worker
  outputs, and proves none survived. CI no longer uploads worker paths.
  `scripts/test-wasm-packaging-contract.sh` exercises these boundaries without a
  LibreOffice rebuild.
- Real-browser gate definition: `tests/browser/conversion.spec.ts` records
  runtime requests, requires `soffice.js`, and rejects any request whose basename
  is `soffice.worker.js` after a successful conversion. Execution remains a
  successor qualification gate because this checkout contains 133/134-byte Git
  LFS pointers for the large native assets.
- Focused verification: 8 files and 70 tests passed; `npm run typecheck` passed.
  The packaging simulation and `bash -n build/build-wasm.sh` also passed.
- Current broader verification excluding the three explicitly artifact-dependent
  files: 31 files and 309 tests passed, 67 skipped. A full run additionally
  passed 23 tests inside the artifact-related area before reaching the expected
  gates: native byte verification sees the 133-byte data pointer, while
  subprocess conversion gates time out against the placeholder runtime.
- Playwright discovery: all 24 browser conversion cases across Chromium,
  Firefox, and Edge load successfully. Runtime execution remains deferred to the
  runnable successor gate.
- Hygiene: `git diff --check` passed. Diff from CSV commit `b12289c` is empty for
  `wasm/`, `scripts/release-runtime/candidate-spec.json`,
  `src/browser-assets.ts`, and `package.json`.
- Successor closure: candidate `70c87563...0c68` passed the exact downloaded-byte
  native gate and real-Chromium Worker conversion. Chromium observed four
  pthread Workers loading `soffice.js` and zero `soffice.worker.js` requests.

## Ground-fact constraints

- Actual checked-in glue behavior outranks assumptions based on generic
  Emscripten or LibreOffice build files.
- LibreOffice's `libreoffice-24-8` build configuration proves pthread support and
  recognizes possible `.worker.js` auxiliary targets, but it does not prove that
  this particular frozen artifact uses external-worker glue.
- Real-browser evidence is not complete while `wasm/soffice.wasm` is only a Git
  LFS pointer; record that as a successor qualification gate, not a passing test.
