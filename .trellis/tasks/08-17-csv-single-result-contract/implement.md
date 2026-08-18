# Implementation plan: CSV single-result contract

## 1. Characterization and shared contract

- [x] Add focused tests for the current/default request and rejected token values.
- [x] Add a shared helper that validates/resolves singular CSV filter options.
- [x] Change the built-in CSV default from token 11 `-1` to `0`.

## 2. Entry-point enforcement

- [x] Validate before public convenience APIs initialize a runtime.
- [x] Validate in the native request builder so direct converter/worker paths
      cannot bypass the contract.
- [x] Ensure Node worker/subprocess owners transmit the zero default unchanged.

## 3. Exact output and cleanup

- [x] Keep the exact requested output as the only readable success artifact.
- [x] Report native-success/exact-output-missing as a contract failure.
- [x] Remove transaction-owned suffixed CSV siblings on success and failure.

## 4. Verification

- [x] Run focused native-request and converter-path tests.
- [x] Run worker/subprocess tests.
- [x] Run typecheck and the relevant non-native suite.
- [x] Run a real two-sheet WASM fixture when an existing fixture/gate can do so
      without rebuilding WASM; otherwise record it as a required successor gate.
- [x] Review the diff for unrelated API, pthread, release, native-patch, or WASM
      changes.

## 5. Transaction-freshness remediation

- [x] Enumerate before native execution, remove stale exact output, and prove
      its absence before accepting any later exact-path bytes.
- [x] Treat baseline/final enumeration and input/exact/sibling unlink failures
      as cleanup uncertainty instead of swallowing them.
- [x] Reject success and quarantine direct runtimes on cleanup uncertainty so
      browser/Node worker and subprocess owners observe quarantine.
- [x] Preserve `Error` primary failures in place and throw the returned cleanup
      wrapper for non-`Error` primary failures when cleanup is also uncertain.
- [x] Add stateful FS regressions for stale output and every cleanup boundary.

## Implementation evidence

- Shared resolver: `src/types.ts`; built-in token 11 is `0`, accepted values are
  absent/empty/missing/`0`, and all other explicit token values fail with
  `ConversionErrorCode.INVALID_INPUT`.
- Defense-in-depth boundaries: direct browser/Node converters, browser Worker,
  Node Worker, subprocess owner, root/server convenience APIs, and
  `createNativeConversionRequest` all use the same resolver.
- Exact-output boundary and transaction-attributable sibling cleanup:
  `src/conversion-output.ts`, used by all direct native conversion owners. It
  proves pre-transaction freshness and post-transaction absence; uncertainty
  quarantines the runtime rather than returning success.
- Focused/relevant suite:
  `npm exec -- vitest run tests/csv-single-result-contract.test.ts tests/native-conversion-bridge.test.ts tests/native-conversion-path.test.ts tests/node-owner-quarantine.test.ts tests/browser-worker-quarantine.test.ts tests/convert-document-validation.test.ts tests/pdf-filter-options.test.ts tests/converter.test.ts tests/native-conversion-ready-retry.test.ts tests/lok-native-conversion.test.ts`
  — 10 files passed, 111 tests passed, 2 pre-existing tests skipped.
- Stateful remediation coverage in `tests/native-conversion-path.test.ts`:
  stale exact output, baseline/removal-proof/final enumeration failures,
  input/exact/sibling unlink failures, owner quarantine signaling, and primary
  `Error` and non-`Error` primary failure preservation — 26 tests passed.
- Typecheck: `npm run typecheck` — passed.
- Diff hygiene: `git diff --check` — passed; no pthread, release, native patch,
  or WASM source/artifact was changed.
- Remaining successor gate: run a real two-sheet XLSX-to-CSV conversion against
  a qualified WASM artifact and assert exactly `/tmp/output/doc.csv` is produced.
  This worktree cannot execute it because `wasm/soffice.wasm` is a 134-byte
  placeholder rather than a runnable artifact; no WASM rebuild was performed.

## Rollback

This child changes only wrapper source/tests/task records. Revert its commit as
one unit before successor qualification. Never alter a frozen candidate to hide
a rollback.
