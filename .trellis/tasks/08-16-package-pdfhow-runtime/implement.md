# Implementation Plan

1. Update fork package identity, lifecycle scripts, repository metadata, and package file allowlist.
2. Add the typed browser asset contract entry and wire it through tsup/package exports/typesVersions.
3. Add focused tests for identity, lifecycle safety, exact asset contract, and export-target completeness.
4. Update README package/install and browser deployment examples to consume the explicit contract.
5. Install dependencies with lifecycle scripts disabled, build JS, run focused/unit/type checks, and create an inspected tarball.
6. Validate imports and strict TypeScript resolution from a temporary installed consumer without publishing or rebuilding WASM.
7. Record measured facts in this task, commit, and push the isolated feature branch.

## Validation record

- Dependency preparation: `pnpm install --frozen-lockfile --ignore-scripts` completed in 13.7 seconds with 497 packages reused and zero downloads; no lifecycle script ran.
- Sequential JS/declaration build: `pnpm build` passed in 24.435 seconds and produced every exported `dist` target, including `browser-assets.js` and `browser-assets.d.ts`.
- Real package lifecycle: `npm pack --json` passed in 42.329 seconds. Its only lifecycle action was `node scripts/build-package.mjs --silent`; it did not invoke `build:wasm`.
- Tarball: `@killbus/libreoffice-converter@2.7.2-pdfhow.1`, 40 entries, 79,653,972 packed bytes, SHA-256 `C58DF0BACF2645C85F7F13CCAB07B38D52702EF70257DC35FF12A7263018AB8E`.
- Tarball inspection found all required root/browser/server/types/browser-assets/loader/package-json targets and all four declared runtime assets. It found no `soffice.worker*` or `soffice.data.js.metadata` path.
- Isolated consumer: `pnpm install --offline --ignore-scripts` installed the local `file:` tarball with zero downloads after selecting the already-cached `@types/node@20.19.26`. ESM root/browser/types/browser-assets checks passed; CJS root/server/loader/package-json checks passed; strict TypeScript `/types` and `/browser-assets` compilation passed.
- Regression checks: package contract 5/5 passed, repository typecheck passed, release-runtime guards 67/67 passed, and repository lint completed with zero errors (23 pre-existing warnings).
- PR #5 was opened Ready; CI run `31928644034` passed install, lint, typecheck, JS build, and test in 1m55s.
- PR #5 merged to `main` as `6b2f2fce5c8b6f9ebd14a79611bd803a69b02282` on 2026-08-16. Main CI run `31929264333` passed every install, lint, typecheck, build, and test step.
- Release run `31929264247` (`push`) and Release run `31929342327` (`workflow_run`) both completed with their `release` job skipped and no steps executed.
- No Build WASM run was created after the merge. The npm registry still returned `E404` for `@killbus/libreoffice-converter`, and the GitHub Release list contained no release created after the merge.
- No publication, semantic-release, native/WASM rebuild, formal Acceptance claim, or Attempt 8 invocation marker occurred.

## Authoritative native-asset correction checkpoint

- Follow-up PR #7 bound the published package paths to the exact four native files from frozen candidate `21fcdfd7e9f49efc08c6ba56c13337cc0be59a9b496f5424adbe57e0fb4a6e7b` and added a fail-closed verifier for paths, sizes, SHA-256 values, WASM parseability, conversion exports, and glue bindings.
- The reproducible tarball was 80,001,764 bytes with SHA-256 `3b62173f43e4542d764e54d5ea6057354a43b691c1541132ec70421455418a0c`. Two unchanged packs were byte-identical.
- A clean Node consumer initialized in 3,061 ms, converted DOCX to a valid 42,173-byte PDF in 5,087 ms, reused the module for a second conversion in 850 ms, and cleaned up in 3 ms with `isReady() === false` after release.
- PDFHow real entry passed in Chrome `145.0.7632.68` with a temporary fresh profile and a reused-profile relaunch. Both sessions were cross-origin isolated, produced a valid 14,670-byte PDF, and created/terminated one worker; totals were 45,568.66 ms fresh and 11,804.29 ms reused.
- PR #7 merged as `59f042320928cc33ba1d79096fa1297f35bb5959`. Main CI run `31956273828` passed; Release runs `31956273699` (`push`) and `31956323983` (`workflow_run`) skipped without executing release steps. No Build WASM run or npm/GitHub publication occurred.
- The same legacy converter test remained at 39 passed / 17 failed on both the pre-correction baseline and correction branch. Those failures are retained as a separate viewer/editor ABI follow-up and are not part of this conversion-only checkpoint.
- This record is non-formal. It does not admit or invoke Attempt 8, create an invocation marker, or claim formal Acceptance.
