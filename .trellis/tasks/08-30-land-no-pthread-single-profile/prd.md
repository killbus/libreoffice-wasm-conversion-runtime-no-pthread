# Land no-pthread single-profile runtime

## Goal

Convert this fork into a browser-first, single-profile LibreOffice WASM runtime that does not use Emscripten pthreads or `SharedArrayBuffer`, and therefore does not require cross-origin isolation for normal browser conversion.

## Requirements

- Produce LibreOffice native artifacts without `-pthread`, `USE_PTHREADS`, `PTHREAD_POOL_SIZE`, `PROXY_TO_PTHREAD`, or pthread worker glue.
- Keep the existing conversion-only native ABI and supported document conversion behavior.
- Make the public browser and Node wrappers describe and load one no-pthread artifact profile; do not retain a parallel threaded profile in this fork.
- Remove runtime checks, options, documentation, examples, and release metadata whose only purpose is selecting or supporting pthread worker modes.
- Remove the documented requirement for `SharedArrayBuffer`, COOP/COEP headers, and `coi-serviceworker` after the no-pthread artifact is verified.
- Preserve deterministic artifact identity, provenance, packaging, and release verification for the replacement artifact.
- Treat the current qualified artifact as a comparison baseline, not as input evidence that a no-pthread build succeeds.
- Avoid remote native builds until patch application, configuration, wrapper tests, release-contract tests, and workflow validation pass locally.

## Acceptance Criteria

- [ ] A clean LibreOffice build completes with no pthread-related compile or link flags.
- [ ] Produced JavaScript contains no pthread worker bootstrap and no `SharedArrayBuffer` requirement.
- [ ] Produced WASM imports no pthread-specific Emscripten functions and does not import shared memory.
- [ ] Node conversion tests pass against the new native artifact.
- [ ] Browser conversion passes without COOP/COEP and with `crossOriginIsolated === false`.
- [ ] The existing conversion matrix passes, including repeated conversions, timeout handling, failure recovery, and cleanup.
- [ ] Public types and runtime configuration expose only the no-pthread profile.
- [ ] Package and release manifests bind the exact new artifact hashes and reject pthread artifacts.
- [ ] Documentation and examples no longer instruct consumers to enable cross-origin isolation.
- [ ] Expensive remote builds are triggered only from a reviewed commit after all applicable local gates pass.

## Constraints

- This repository intentionally supports one no-pthread profile; dual-profile compatibility is out of scope.
- Do not weaken conversion correctness or silently skip unsupported thread-dependent paths.
- Do not claim feasibility from static inspection alone; successful build and runtime evidence are mandatory.
- Network, API, authorization-service, 4xx/5xx, or stream-disconnect failures are retried as transient unless repeated evidence proves a permanent configuration error.
