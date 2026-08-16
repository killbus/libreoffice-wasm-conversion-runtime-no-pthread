# Acceptance Attempt 8 minimal admission handoff

- Date: 2026-08-16
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

## Boundary

This handoff does not change the Attempt 8 protocol, run preparation, publish, trigger Build WASM, create an Attempt 8 marker, start formal execution, or claim Acceptance. The independent owner may persist a separate admission decision or return a specific blocker; until then Attempt 8 remains NOT ADMITTED.
