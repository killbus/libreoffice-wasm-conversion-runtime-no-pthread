# CSV single-result contract

## Goal

Make every singular CSV conversion produce exactly one file at the requested
output URL, or fail before native execution.

## Requirements

- Change the built-in CSV export option's zero-based token 11 (the documented
  twelfth token) from `-1` to `0`.
- For `outputFormat: 'csv'`, allow an absent option, an empty option, a missing
  token 11, or token 11 equal to canonical numeric zero.
- Reject `-1`, positive/negative non-zero integers, and non-numeric token 11
  before invoking LibreOffice. Rejection must be a deterministic reusable-runtime
  input/contract error.
- Apply the rule to every singular entry point: direct Node/browser converters,
  worker/subprocess owners, and the native request builder.
- After native success, read the exact requested output URL and reject missing
  or empty output. Do not scan the directory, choose a suffixed file, or return
  a partial result.
- Before native execution, prove the exact CSV output is absent. Remove a stale
  exact output and re-enumerate to prove removal; never accept stale bytes.
- Clean the input, exact output, and unexpected CSV siblings created by the
  transaction without deleting unrelated paths. Baseline/final enumeration or
  transaction-owned unlink uncertainty must reject success and quarantine the
  runtime.
- Preserve custom CSV delimiter, quote, encoding, and other tokens when token 11
  is zero.
- Keep all-sheet export and a multi-result API out of scope.

## Acceptance Criteria

- [x] The default CSV filter string contains token 11 = `0`.
- [x] Unit tests accept absent/empty/zero and custom zero options.
- [x] Unit tests reject `-1`, `1`, other non-zero integers, and invalid text
      before the native spy is called.
- [x] Node and browser/native request paths pass the same effective option.
- [x] Native success followed by a missing exact output is reported as an output
      contract violation, not a successful conversion.
- [x] Cleanup tests prove no `doc-<sheet>.csv` sibling survives success or failure.
- [x] Stateful tests prove stale exact output is never accepted and cleanup
      uncertainty rejects success, quarantines the runtime, and reaches owners.
- [x] Existing PDF/image and CSV-import option tests remain green.

## Notes

- LibreOffice 24.8 reads token 11 in `sc/source/ui/dbgui/imoptdlg.cxx`.
  Zero uses the exact target stream; any non-zero value enters the suffixed-file
  branch in `sc/source/ui/docshell/docsh.cxx`.
- Token `0` means `GetSaveTab()` (falling back to tab 0 when no view exists), not
  a general promise that the caller selected the first sheet.
