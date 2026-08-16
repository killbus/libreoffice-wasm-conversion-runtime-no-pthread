# Package PDFHow runtime artifact

## Goal

Turn the fork's already-qualified JS/WASM contents into a deterministic package that PDFHow can install and deploy without relying on a mutable local tarball or rebuilding native/WASM artifacts.

## Requirements

- Use a fork-owned scoped package identity and repository metadata; do not present the fork as the upstream `@matbee` package.
- Use a fork prerelease version that records the upstream package baseline without implying an upstream canonical release.
- Build JavaScript and declarations during `prepack`; package installation must not run a build and `prepack` must never invoke `build:wasm`.
- Remove stale or mode-incompatible package file entries. The frozen runtime is `pthreadWorkerMode: "main-script"`, so the browser deployment contract must not require `soffice.worker.js`.
- Export a typed, immutable browser-asset deployment contract that gives consumers the exact package-relative files, logical keys, MIME types, and pthread mode.
- Keep browser asset deployment consumer-controlled. Do not copy into an application during package installation.
- Preserve existing fork release guards. Do not publish, trigger semantic-release, create an Attempt 8 invocation marker, or claim formal Acceptance.

## Acceptance Criteria

- [x] `package.json` identifies `@killbus/libreoffice-converter` and the killbus fork repository, with an explicit public scoped-package publish setting.
- [x] The version is a fork prerelease based on `2.7.2`, not a false upstream `2.7.3`.
- [x] `prepack` runs only the JS/TypeScript build and a clean checkout can produce all exported `dist` files before packing.
- [x] The package file allowlist contains every required runtime file and contains neither the absent metadata file nor an external pthread worker for the main-script artifact.
- [x] `@killbus/libreoffice-converter/browser-assets` resolves in ESM and TypeScript and declares exactly `browser.worker.global.js`, `soffice.js`, `soffice.wasm`, and `soffice.data`.
- [x] The root, browser, server, types, browser-assets, loader, and package-json export targets exist in the packed tarball.
- [x] An isolated consumer can install the generated tarball and resolve/import the package without native/WASM rebuild or publication.
- [x] Validation records show no `build:wasm`, semantic-release, publication, or formal Attempt 8 action occurred.

## Notes

This is a non-formal package/integration slice under the existing 08-10 task. It makes the package contract permanent; it does not itself qualify or publish a release.
