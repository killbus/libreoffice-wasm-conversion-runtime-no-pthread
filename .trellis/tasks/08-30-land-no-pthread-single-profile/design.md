# Design: no-pthread single-profile runtime

## Architecture

The fork produces one native artifact compiled without Emscripten pthread support. Browser conversion continues to run inside the library's existing outer Web Worker, so synchronous native conversion does not block the page UI. No nested pthread worker, shared WebAssembly memory, or `SharedArrayBuffer` is part of the runtime contract.

## Native Build

- Add a dedicated final patch after the existing consolidated and conversion-only patches.
- Remove pthread-related compiler/linker settings from `EMSCRIPTEN_INTEL_GCC.mk`.
- Reconfigure from a clean-enough source state so stale threaded objects cannot enter the result.
- Resolve failures from source evidence and linker diagnostics. Do not pre-create broad thread shims based only on symbols found in a threaded binary.
- Prefer existing LibreOffice single-thread abstractions and compile-time branches; add narrow Emscripten-specific synchronous implementations only where the build or runtime proves they are required.

## Runtime Contract

- Remove `pthreadWorkerMode` and external pthread-worker selection from the public browser API.
- Keep one browser worker boundary owned by this package.
- Reject accidental threaded artifacts during packaging by inspecting glue text, WASM memory/import metadata, and auxiliary worker files.
- Browser acceptance must run on a server that deliberately omits COOP and COEP.

## Release Contract

- Replace threaded candidate metadata with an explicit no-pthread runtime marker.
- A new native build creates a new immutable candidate identity and hashes.
- Existing qualified threaded bytes remain historical evidence only and are never copied into a no-pthread release.

## Build-Economy Gate

A remote native build is allowed only after:

1. all repository edits are committed on the feature branch;
2. shell syntax and patch applicability checks pass;
3. TypeScript build, unit tests, typecheck, and relevant release-contract tests pass;
4. the workflow input and cache key uniquely identify the no-pthread build;
5. the expected first-build failure surface is documented.

After each remote build, download and inspect logs/artifacts before deciding whether another build is justified.

## Rollback

Before publication, rollback is deleting or reverting the no-pthread branch. After publication, rollback is publishing a new corrected no-pthread artifact; this fork does not fall back to a threaded profile.
