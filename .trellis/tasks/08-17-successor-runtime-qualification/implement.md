# Implementation plan: successor runtime qualification

## 1. Clean build

- [x] Push the integrated contract branch without merging or publishing.
- [x] Dispatch a clean `conversion-only` Build WASM run.
- [ ] Require the workflow conversion gate and artifact upload to succeed.

## 2. Refreeze

- [ ] Download the workflow artifact into a fresh temporary root.
- [ ] Reject partial, pointer-sized, or unexpected native assets.
- [ ] Build wrapper assets from the exact qualifying commit.
- [ ] derive a new frozen spec, hashes, and candidate identity.
- [ ] Prove the old spec rejects the successor bytes.
- [ ] Run deterministic double assembly and archive verification.

## 3. Bounded acceptance

- [ ] Run exact native ABI and package inventory gates.
- [ ] Run sequential DOCX->PDF, XLSX->CSV, PPTX->PDF, PDF->PNG, and PPTX->SVG.
- [ ] Prove facade shape, runtime reuse, safe rejection, and clean destroy.
- [ ] Run real-browser Worker conversion with pthread `main-script` mode.
- [ ] Prove no standalone `soffice.worker.js` request or package entry exists.

## 4. Receipt

- [ ] Bind the receipt to workflow run, source commit, candidate identity,
      archive hash, browser/runtime evidence, and exact downloaded bytes.
- [ ] Mark the successor and parent tasks complete only after every gate passes.
