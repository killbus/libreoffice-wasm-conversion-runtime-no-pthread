# Implementation Plan

## Phase 1 — Establish Ground Truth

- [x] Inspect the exact LibreOffice 24.8 source files modified by the build patch.
- [x] Identify compile-time pthread assumptions separately from runtime thread use.
- [x] Record the current qualified artifact identity as comparison-only evidence.

## Phase 2 — Native Build Contract

- [x] Add a focused no-pthread patch/configuration layer.
- [x] Remove pthread compiler and linker flags.
- [x] Remove threaded-output packaging assumptions and add fail-closed checks.
- [x] Validate patch application against a pristine source checkout.

## Phase 3 — Wrapper Contract

- [x] Simplify browser runtime paths to one no-pthread profile.
- [x] Remove pthread worker options and compatibility branches.
- [x] Remove cross-origin-isolation checks and service-worker integration.
- [x] Update public types, examples, and documentation.

## Phase 4 — Local Gates

- [x] Run shell syntax and patch-state validation.
- [x] Run wrapper bundle build, typecheck, lint, and focused unit tests; defer package/native gates until the replacement artifact exists.
- [x] Run release schema and packaging tests with synthetic no-pthread artifacts.
- [x] Review the complete diff before authorizing remote build.

## Phase 5 — Native Build and Qualification

- [ ] Push one reviewed build-trigger commit.
- [ ] Monitor and retry transient network/API/authorization failures.
- [ ] Diagnose compiler/linker failures from complete logs before another build.
- [ ] Download artifacts and verify no pthread/SAB/shared-memory surface remains.
- [ ] Run Node and non-isolated-browser conversion gates.
- [ ] Freeze the new candidate identity and complete documentation.
