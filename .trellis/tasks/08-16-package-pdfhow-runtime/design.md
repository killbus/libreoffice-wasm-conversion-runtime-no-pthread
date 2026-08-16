# Design

## Package identity

Use `@killbus/libreoffice-converter@2.7.2-pdfhow.1`. The prerelease suffix distinguishes the fork package while retaining the audited upstream package baseline. Repository, bugs, and homepage metadata point to `killbus/libreoffice-wasm-conversion-runtime`. `publishConfig.access` is public because npm scoped packages otherwise default to restricted publication, but this task performs no publication.

## Lifecycle

Use `scripts/build-package.mjs` for both `build` and `prepack`. It invokes the five tsup configurations sequentially (and silently during packing), avoiding npm-pack/Node 24 Windows heap corruption observed when tsup ran all configurations concurrently under a captured lifecycle process. The script creates JavaScript, source maps, and declarations only. There is deliberately no `prepare`, `postinstall`, or other install-time package build. `build:wasm` remains an explicit manual/native workflow and is not referenced by package lifecycle scripts.

## Browser assets

Add a dedicated `src/browser-assets.ts` entry and package export. It exports a frozen schema-versioned contract:

- runtime mode: `main-script`
- `browserWorkerJs` -> `dist/browser.worker.global.js`
- `sofficeJs` -> `wasm/soffice.js`
- `sofficeWasm` -> `wasm/soffice.wasm`
- `sofficeData` -> `wasm/soffice.data`

Each asset carries a stable key, package-relative path, deployment basename, and MIME type. The package does not choose public URLs or mutate the consumer filesystem. PDFHow's sync script remains responsible for hashing and copying these exact files to content-addressed URLs.

The frozen runtime uses Emscripten's main-script pthread mode, proven by the candidate spec and release identity tests. Therefore `soffice.worker.js` and `soffice.worker.cjs` are intentionally absent from the package allowlist and deployment contract.

## Verification

Build and pack from the isolated worktree with dependency lifecycle scripts disabled during install. Inspect the tarball file list and lifecycle output, import CJS/ESM exports, compile a strict TypeScript consumer including `/types` and `/browser-assets`, and install the tarball into a temporary consumer. No command may invoke `build:wasm`, semantic-release, or npm publish.
