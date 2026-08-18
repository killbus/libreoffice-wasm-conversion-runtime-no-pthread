# Close conversion runtime contracts

## Goal

Make the package, its public API, and its shipped conversion-only WASM artifact
describe one product with three invariants:

1. singular `convert()` requests produce exactly one requested result;
2. public capabilities do not exceed the artifact's actual ABI;
3. pthread topology is declared by the artifact profile, not guessed at runtime.

## Requirements

- Preserve the already-frozen runtime candidate and its release history. Any
  changed wrapper or native byte belongs to a successor candidate with a new
  identity.
- Deliver independently reviewable child tasks in this order:
  1. `08-17-csv-single-result-contract`;
  2. `08-17-pthread-main-script-contract`;
  3. `08-17-conversion-only-public-surface`;
  4. `08-17-successor-runtime-qualification`.
- Keep each child independently testable and reversible. The parent owns the
  cross-child requirements and integration audit; it does not own product code.
- Do not restore the 44 editor/render/interaction shims to the conversion-only
  artifact. A full LibreOfficeKit-compatible product, if required, must use a
  separate artifact and entry point.
- Do not introduce an all-sheet CSV API without a concrete consumer and a
  separately specified multi-result/native-manifest contract.
- Do not modify or republish an existing frozen candidate in place.

## Acceptance Criteria

- [ ] Singular CSV conversion defaults to sheet token `0`, rejects every
      explicit non-zero/invalid sheet token before native invocation, reads the
      exact requested path, and leaves no suffixed CSV artifacts.
- [ ] Wrapper default, actual glue, frozen runtime profile, and package inventory
      all agree on `main-script`; `soffice.worker.js` is absent and no fallback
      or auto-detection exists.
- [ ] Published TypeScript/JavaScript entry points expose only capabilities
      backed by the conversion-only artifact, or fail explicitly at a documented
      compatibility boundary.
- [ ] The integrated bytes receive a new candidate identity and pass Node,
      browser, package-inventory, ABI, lifecycle, and release-verifier gates.
- [ ] The previous candidate remains immutable and unqualified/qualified state
      is not rewritten.

## Notes

- Ground truth was checked against LibreOffice 24.8 source at
  `d1c9e0e4e1ddeb24fe8f93e56860b3765043f8b1`, upstream wrapper commit
  `b72a3d584bc28c5111afafcf25def7a24fb5fcb0`, and current commit
  `5e8322ee7bdc4a8c81f9c0c0de0a4fb7157aedf2`.
