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
- No publication, semantic-release, native/WASM rebuild, formal Acceptance claim, or Attempt 8 invocation marker occurred.
