# Implementation plan: close conversion runtime contracts

## Coordination

- [x] Record grounded source/runtime facts and the three product invariants.
- [x] Create independently verifiable child tasks.
- [ ] Complete and archive the children serially in the documented order.
- [ ] Run a final integration audit across types, JS, WASM exports, package
      inventory, candidate specification, and downloaded-byte behavior.

## Child order

1. [ ] `08-17-csv-single-result-contract`
2. [ ] `08-17-pthread-main-script-contract`
3. [ ] `08-17-conversion-only-public-surface`
4. [ ] `08-17-successor-runtime-qualification`

## Parent completion gate

- [ ] Every child is archived with its own evidence and rollback boundary.
- [ ] No old candidate/tag/asset was mutated or reused for changed bytes.
- [ ] Exact public export and WASM export inventories are recorded.
- [ ] Node and real-browser conversion gates pass from successor package bytes.
