# Official hidden native conversion bridge

## Goal

Replace the basic document-conversion transaction implemented through raw
LibreOfficeKit document handles with a private native bridge that performs the
official hidden load, export, and cleanup sequence inside LibreOffice. Preserve
the existing Worker/VFS/process-isolation runtime and build the change directly
on commit `7c1d42e9c603ad4b0f371762c2689b4fdca51493`.

## Background

- The artifact from GHA run `30902972344`, built at `7c1d42e`, has already
  converted `test.docx` to a valid PDF through LibreOffice's official
  `_main --headless --convert-to pdf` path. This proves the baseline contains
  the required conversion capability.
- Calling `_main` from JavaScript is only a diagnostic probe. It relies on CLI
  process-global behavior and is not a production ABI.
- The existing runtime's outer pipeline is sound: Worker/process isolation,
  VFS file transfer, byte ownership, and runtime termination remain useful.
  The semantic gap is limited to the raw LOK load/save/destroy transaction.
- The official CLI conversion path loads synchronously with `ReadOnly=true`,
  `OpenNewView=true`, `Hidden=true`, `Silent=true`, and target `_blank`; exports
  with `ConversionRequestOrigin=CommandLine`, `Overwrite=true`, and an explicit
  `FilterName`; then closes or disposes the component.
- Repository changes after `7c1d42e` contain additional trimming whose benefit
  has not been demonstrated. They are not inputs to this task.

## Requirements

### R1. Baseline isolation

- Development MUST occur on `feature/official-hidden-native-bridge`, whose
  starting commit is exactly `7c1d42e9c603ad4b0f371762c2689b4fdca51493`.
- The dirty `main` worktree MUST remain untouched.
- No post-baseline UI/module/data/LTO trimming may be copied into this branch.

### R2. Private native ABI

- Add a private C ABI implemented in `desktop/source/lib/init.cxx`:

  ```c
  int lok_convertDocument(
      LibreOfficeKit* kit,
      const char* requestJson,
      char** resultJson);
  void lok_convertFree(char* allocation);
  ```

- Export `_lok_convertDocument` and `_lok_convertFree` from the Emscripten
  artifact.
- Do not add this ABI to the public LibreOfficeKit header or vtable and do not
  expose UNO/document/model/view pointers to JavaScript.
- No C++ exception may cross the ABI boundary. Every completed call returns a
  structured result when result allocation is possible.

### R3. Native transaction ownership

- Native code owns the complete synchronous transaction:
  request validation -> hidden load -> `XStorable::storeToURL` -> cleanup.
- The first implementation MUST match the official CLI load semantics:
  `ReadOnly=true`, `OpenNewView=true`, `Hidden=true`, `Silent=true`, target
  `_blank`.
- Export properties MUST include `ConversionRequestOrigin=CommandLine`,
  `Overwrite=true`, and a caller-supplied explicit native `FilterName`.
- Optional filter options/data may be forwarded, but the bridge MUST NOT hard
  code Writer or PDF semantics.

### R4. Cleanup invariant

- Every successful load MUST reach cleanup on success and failure paths.
- Successful `XCloseable::close(true)` (or normal `dispose()` when no
  `XCloseable` exists) reports `cleanup=clean`.
- If close is vetoed or throws, native code MUST attempt fallback `dispose()`
  and report `cleanup=uncertain`, even when fallback disposal succeeds.
- A JavaScript runtime receiving `cleanup=uncertain` MUST be quarantined and
  terminated/restarted rather than reused.
- Only a runtime whose previous conversion returned `cleanup=clean` may run a
  second conversion.

### R5. Versioned JSON contract and memory ownership

- The request and result schemas start at `schemaVersion: 1`.
- TypeScript owns one shared request encoder/result decoder. Consumers MUST NOT
  parse or cast native result JSON independently.
- Native result memory is released only with `lok_convertFree`; temporary
  request/result-slot allocations are released with Emscripten `_free` on all
  paths.
- Stable failure stages are `validate`, `load`, `export`, and `cleanup`.

### R6. Explicit output filters

- Add one source of truth that maps supported input document categories and
  output formats to explicit LibreOffice export filter names.
- The initial vertical slice MUST map DOCX to PDF through
  `writer_pdf_Export`.
- Unsupported pairs MUST fail before invoking native conversion; they must not
  silently fall back to extension-only save behavior.

### R7. Migration boundary

- Migrate basic conversion in Node and browser paths to the bridge.
- Preserve raw LOK APIs for editor, rendering, preview, and multi-page image
  flows that intentionally require a live document pointer.
- Preserve the legacy raw exports in the first bridge artifact for A/B testing
  and compatibility. Removing them is a separate, evidence-driven task.

### R8. Independent build atom

- Implement the LibreOffice source change as a new reversible patch atom,
  applied after the two already-validated `7c1d42e` conversion-only atoms.
- Do not rewrite the baseline export/shim patches.
- The patch must support forward and reverse dry-run checks against the pinned
  LibreOffice source revision.

### R9. Observable hidden-path evidence

- The fresh artifact gate MUST expose evidence that conversion used the hidden
  path and did not enter visible-frame setup. A minimal removable diagnostic
  marker is acceptable for the first artifact.
- Merely echoing the request's `Hidden=true` value is not sufficient evidence.

### R10. Build economics

- Do not trigger the 2-4 hour GHA WASM build until patch checks, structural
  checks, TypeScript checks, and unit/mock tests pass locally.
- Prepare one reviewed build input and use one expensive build as the final
  integration gate.

## Acceptance Criteria

- [ ] AC1 (`R1`, `R8`): branch ancestry and patch-manifest checks prove the
      implementation starts at exact commit `7c1d42e` and contains no later
      trimming patches.
- [ ] AC2 (`R2`, `R5`): unit tests cover ABI allocation/free behavior, malformed
      JSON, unsupported schema versions, and centralized result decoding.
- [ ] AC3 (`R3`, `R4`): source/behavior tests cover stable load/export/cleanup
      stages, close/dispose fallback, and `cleanup=uncertain` quarantine.
- [ ] AC4 (`R6`, `R7`): mocked basic conversion sends
      `outputFilter=writer_pdf_Export` for DOCX -> PDF and does not call legacy
      `documentLoad*`, `documentSaveAs`, or `documentDestroy`.
- [ ] AC5 (`R7`): editor/render/preview/multi-page-image pointer flows remain on
      their existing raw LOK path and continue to type-check/test.
- [ ] AC6 (`R8`): the new LibreOffice patch applies cleanly after the baseline
      atoms and reverses cleanly against the pinned source.
- [ ] AC7 (`R2`, `R3`, `R9`): a fresh artifact exports both bridge symbols and
      converts `test.docx` to non-empty bytes beginning with `%PDF-`, returning
      `ok=true`, `stage=complete`, `cleanup=clean`, plus hidden-path evidence.
- [ ] AC8 (`R4`): the same Worker/process completes a second conversion after a
      clean first conversion.
- [ ] AC9 (`R4`, `R5`): fresh-artifact negative gates cover malformed requests
      and a load/password failure without leaking exceptions or reusing a
      runtime after uncertain cleanup.
- [ ] AC10 (`R10`): all inexpensive gates pass before the single GHA WASM build
      is manually triggered; artifact hashes and gate results are recorded.

## Out of Scope

- Replacing editor, rendering, preview, or multi-page image APIs that require a
  live document handle.
- Removing legacy raw LOK exports in the first artifact.
- Re-evaluating or importing post-`7c1d42e` trimming work.
- Public LibreOfficeKit API changes.
- Triggering the expensive GHA build before local gates are green.
