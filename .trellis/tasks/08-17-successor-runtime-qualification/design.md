# Design: successor runtime qualification

## Identity boundary

The successor is a new immutable candidate. It must not reuse or mutate the
existing `21fcdfd7...` candidate, its release state, or its acceptance evidence.
The candidate identity binds the clean native build output, the wrapper build
from the qualifying commit, runtime mode, provenance, and every asset hash.

## Build boundary

- Source ref: `0f583b66570bcecb9562220e0df1d823eb010362`.
- Workflow: `Build WASM`, run `32146386224`.
- Inputs: `conversion-only`, clean build, baseline autogen.
- The workflow uploads artifacts only. It does not update LFS, create a release,
  publish npm, or promote a candidate.

## Qualification boundary

All checks consume freshly downloaded workflow bytes. Native ABI verification
parses `soffice.wasm` and requires the exact 14-symbol `lok_*` allowlist. Public
Node and browser checks use only frozen conversion facades. Editor, render,
page-inspection, callback, view, and raw Emscripten access are out of scope and
must remain unreachable.

Run memory-heavy gates sequentially with one live WASM instance. Any formal
sample failure is recorded as a failure; no hidden retry may turn it into a
pass.

## Promotion boundary

This task may assemble and verify a new candidate and produce a qualification
receipt. It does not publish npm, promote a GitHub release, update Pages, or
merge to `main` without a separate explicit action.
