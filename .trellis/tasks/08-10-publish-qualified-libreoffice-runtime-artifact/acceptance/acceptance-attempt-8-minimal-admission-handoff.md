# Acceptance Attempt 8 minimal admission handoff

- Date: 2026-08-16; preparation checkpoint updated 2026-08-17.
- State: NOT ADMITTED; eligible false; started false; formal invocation count 0; decision null.
- Classification: non-formal checkpoint for independent admission review.

## Fixed candidate

- Runtime candidate: 21fcdfd7e9f49efc08c6ba56c13337cc0be59a9b496f5424adbe57e0fb4a6e7b.
- Executable package source: PR #7 merge 59f042320928cc33ba1d79096fa1297f35bb5959.
- Checkpoint record: PR #8 merge 8895e8828ecf8336c9ad327223a49d25a84dc301.
- Reproducible tarball: 80,001,764 bytes; SHA-256 3b62173f43e4542d764e54d5ea6057354a43b691c1541132ec70421455418a0c.
- scripts/verify-native-package-assets.mjs binds the exact soffice.js, soffice.cjs, soffice.wasm, and soffice.data assets and fails closed on drift.

## Passed integration facts

- Local package resolution: isolated file: tarball install with lifecycle scripts disabled; ESM, CJS, exports, and strict TypeScript resolution passed.
- Node: initialized in 3,061 ms; converted DOCX to a valid 42,173-byte PDF in 5,087 ms; reused the module in 850 ms; released in 3 ms with isReady() false.
- PDFHow real entry: Chrome 145.0.7632.68 passed with a temporary fresh profile and its reused-profile relaunch. Both were cross-origin isolated, produced a valid 14,670-byte PDF, and created/terminated one worker; totals were 45,568.66 ms fresh and 11,804.29 ms reused.
- Evidence: .trellis/tasks/08-16-package-pdfhow-runtime/implement.md and task.json.

## Conversion-only scope

The legacy suite remained 39 passed / 17 failed on both the pre-correction baseline and corrected package branch. Those unchanged viewer/editor ABI failures are a separate follow-up and are outside this DOCX-to-PDF conversion-only scope.

## Authorized preparation checkpoint

- Independent disposition: PR #9 passed minimal admission handoff review and authorized preparation only after merge `54b64eafe922552239d5a9d09d0442b5eda5d9f0` and its guarded main workflows passed.
- Exact preparation harness source: commit `794661a45e20d2957b24f35e322cc4850ef3cde7`, exposed as Draft PR #10 against the historical feature branch so its four-commit delta is reviewable without proposing the old feature history to main.
- Result: passed; 17/17 preparation commands passed, with 0 failures, 0 timeouts, and 0 retries; command span 389.092 seconds.
- Preparation manifest SHA-256: `68ff7e6935da5bc11fe5f941446d0ccad4a4a5dfc2381d1520630fc0d25cc964`.
- Sealed-input manifest SHA-256: `75cba0574ff947c344f967a1703c14dcdf718e3e97ff8d3e88a025d9991fcaa3`; sealed verifier passed.
- Pinned fixture: 6,693,403 bytes; SHA-256 `a78495545ae41486aa61c9a0e8c4c78f6491a8e7b3cfacbd4185ed0f124f59df`.
- Classification remains `not acceptance evidence`; formal attempt started false; formal invocation count 0; decision null.

## Boundary

This update records only the independently authorized preparation result. It does not change the Attempt 8 protocol, persist an admission decision, publish, trigger Build WASM, create an Attempt 8 marker, start formal execution, or claim Acceptance. The 17 legacy ABI failures remain OPEN / unresolved. Until the independent owner issues a separate admission decision, Attempt 8 remains NOT ADMITTED.
