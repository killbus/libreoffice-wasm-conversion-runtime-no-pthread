# Implementation plan: successor runtime qualification

## 1. Clean build

- [x] Push the integrated contract branch without merging or publishing.
- [x] Dispatch a clean `conversion-only` Build WASM run.
- [x] Require the workflow conversion gate and artifact upload to succeed.

## 2. Refreeze

- [x] Download the workflow artifact into a fresh controlled root.
- [x] Reject partial, pointer-sized, or unexpected native assets.
- [x] Build wrapper assets from the exact qualifying commit.
- [x] Derive a new frozen spec, hashes, and candidate identity.
- [x] Prove the old spec rejects the successor bytes.
- [x] Run deterministic double assembly and archive verification.

## 3. Bounded acceptance

- [x] Run exact native ABI and package inventory gates.
- [x] Run sequential DOCX->PDF, XLSX->CSV, PPTX->PDF, PDF->PNG, and PPTX->SVG.
- [x] Prove facade shape, runtime reuse, safe rejection, and clean destroy.
- [x] Run real-browser Worker conversion with pthread `main-script` mode.
- [x] Prove no standalone `soffice.worker.js` request or package entry exists.

## 4. Receipt

- [x] Bind the receipt to workflow run, source commit, candidate identity,
      archive hash, browser/runtime evidence, and exact downloaded bytes.
- [x] Mark the successor and parent tasks complete only after every gate passes.
