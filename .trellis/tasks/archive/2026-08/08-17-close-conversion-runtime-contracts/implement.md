# Implementation plan: close conversion runtime contracts

## Coordination

- [x] Record grounded source/runtime facts and the three product invariants.
- [x] Create independently verifiable child tasks.
- [x] Complete and archive the children serially in the documented order.
- [x] Run a final integration audit across types, JS, WASM exports, package
      inventory, candidate specification, and downloaded-byte behavior.

## Child order

1. [x] `08-17-csv-single-result-contract`
2. [x] `08-17-pthread-main-script-contract`
3. [x] `08-17-conversion-only-public-surface`
4. [x] `08-17-successor-runtime-qualification`

## Parent completion gate

- [x] Every child is archived with its own evidence and rollback boundary.
- [x] No old candidate/tag/asset was mutated or reused for changed bytes.
- [x] Exact public export and WASM export inventories are recorded.
- [x] Node and real-browser conversion gates pass from successor package bytes.
