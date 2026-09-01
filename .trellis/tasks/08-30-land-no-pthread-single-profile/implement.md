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

- [x] Push one reviewed build-trigger commit.
- [x] Monitor and retry transient network/API/authorization failures.
- [x] Diagnose compiler/linker failures from complete logs before another build.
- [x] Diagnose the third build's conversion deadlock from artifact disassembly and runtime profiling.
- [x] Validate the upstream-derived LibreOfficeKit VCL toolkit guard locally.
- [x] Trigger and diagnose the fourth clean native build from the reviewed patch.
- [x] Validate the complete upstream VCL guard port, including its required header.
- [x] Trigger and monitor a fifth clean native build from the reviewed patch.
- [x] Download artifacts and verify no pthread/SAB/shared-memory surface remains.
- [x] Run Node and non-isolated-browser conversion gates.
- [x] Freeze the new candidate identity and complete documentation.
