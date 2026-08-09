# Design: official hidden native conversion bridge

## Architecture boundary

The outer conversion runtime remains unchanged:

```text
public API
  -> subprocess/browser Worker
  -> VFS input/output bytes
  -> shared TypeScript bridge binding
  -> private C ABI
  -> synchronous UNO hidden load/export/cleanup transaction
```

Only basic document conversion crosses the new ABI. Editor, render, preview,
and multi-page image code retains raw LOK document handles.

## Native ABI

```c
int lok_convertDocument(
    LibreOfficeKit* kit,
    const char* requestJson,
    char** resultJson);
void lok_convertFree(char* allocation);
```

- `0` means the bridge produced a decodable result object; conversion success
  is represented by `result.ok`, not by the C return value.
- A non-zero return is reserved for ABI-level failures where no trustworthy
  result can be returned (invalid output pointer, allocation failure, or an
  equivalent boundary failure).
- `resultJson` is allocated by native code with `malloc` and must be released
  through `lok_convertFree`.
- The bridge is private to this WASM runtime. It is exported directly by
  Emscripten and is not added to the public LibreOfficeKit ABI.

## Request contract

```json
{
  "schemaVersion": 1,
  "inputUrl": "file:///tmp/input/document.docx",
  "outputUrl": "file:///tmp/output/document.pdf",
  "inputFilter": null,
  "inputFilterOptions": null,
  "password": null,
  "outputFilter": "writer_pdf_Export",
  "outputFilterOptions": null,
  "filterData": {}
}
```

Required fields are `schemaVersion`, `inputUrl`, `outputUrl`, and a non-empty
`outputFilter`. URLs must be valid absolute URLs accepted by LibreOffice. The
optional fields are normalized by the shared TypeScript encoder; native code
still validates all untrusted JSON at the ABI boundary.

## Result contract

Success:

```json
{
  "schemaVersion": 1,
  "ok": true,
  "stage": "complete",
  "cleanup": "clean",
  "hiddenLoad": true,
  "visibleFrameSetupEntered": false
}
```

Failure:

```json
{
  "schemaVersion": 1,
  "ok": false,
  "stage": "load",
  "cleanup": "clean",
  "message": "stable human-readable diagnostic",
  "hiddenLoad": true,
  "visibleFrameSetupEntered": false
}
```

`stage` is one of `validate`, `load`, `export`, `cleanup`, or `complete`.
`cleanup` is `not-needed`, `clean`, or `uncertain`. The TypeScript decoder
rejects unknown schema versions, missing fields, and invalid enum values.

## Native transaction

1. Acquire the existing LOK/UNO context under the same Solar mutex discipline
   used by `desktop/source/lib/init.cxx`.
2. Parse and validate request JSON before loading a component.
3. Build load properties matching `dispatchwatcher.cxx`:
   `ReadOnly=true`, `OpenNewView=true`, `Hidden=true`, `Silent=true`, optional
   input filter/options/password; load synchronously with target `_blank`.
4. Build export properties: `ConversionRequestOrigin=CommandLine`,
   `Overwrite=true`, explicit `FilterName`, optional `FilterOptions` and
   `FilterData`; call `XStorable::storeToURL`.
5. Cleanup in a scope guard/finalization path:
   - prefer `XCloseable::close(true)`;
   - if no `XCloseable`, call `XComponent::dispose()` and report clean;
   - if close vetoes/throws, attempt `dispose()` and report uncertain.
6. Catch all UNO/std/unknown exceptions and serialize a stable result. No
   exception crosses the C ABI.

The diagnostic visible-frame marker must be derived from the native control
flow, not copied from request data. It is intentionally minimal and removable
after the first artifact proves the path.

## TypeScript ownership

A shared module owns:

- request/result types and schema version;
- runtime validation/decoding from `unknown`;
- supported input-family/output-filter mapping;
- conversion-result error construction;
- the rule deciding whether a runtime remains reusable.

`lok-bindings.ts` owns WASM pointer mechanics:

1. allocate and UTF-8 encode request JSON;
2. allocate and zero one 32-bit result-pointer slot;
3. call `_lok_convertDocument(lokPtr, requestPtr, resultSlot)`;
4. read and centrally decode the returned JSON;
5. always call `_lok_convertFree(resultPtr)` when non-null;
6. always `_free` request and slot allocations.

Node and browser basic converters call this one binding. They do not implement
their own JSON parsing or raw load/save/destroy transaction.

## Filter resolution

The public API still deals in user-facing input/output formats. Before crossing
the ABI, a single mapping resolves the input document family and output format
to LibreOffice's explicit native filter. The first required mapping is:

```text
DOCX (Writer family) + PDF -> writer_pdf_Export
```

Additional pairs are added only with an explicit known filter. Missing pairs
fail deterministically in TypeScript before touching native state.

## Runtime lifecycle

- `cleanup=clean`: conversion result may be returned and the runtime may be
  reused.
- `cleanup=not-needed`: valid only when no component was loaded; the failed
  conversion does not itself poison the runtime.
- `cleanup=uncertain`: mark the converter unusable immediately. Worker/process
  owners must terminate/restart it; no subsequent request may execute there.

This preserves the stronger outer process-isolation boundary while moving the
transaction semantics to the layer that can implement them correctly.

## Build integration and rollback

`build/build-wasm.sh` applies a third independent feature atom after the two
baseline conversion-only atoms:

```text
wasm-build-fixes.patch
wasm-trim-lok-exports-conversion-only.patch
wasm-trim-lok-shims-conversion-only.patch
wasm-native-conversion-bridge.patch
```

The first bridge artifact retains old exports. Rollback is removal of the new
patch application plus the TypeScript bridge call sites; the two validated
baseline atoms remain untouched.

## Validation strategy

Cheap gates run first: patch apply/reverse, source-structure assertions,
contract/binding unit tests, mock conversion-path tests, type-check, and the
existing test suite. Only then is one manual GHA WASM build triggered. The
fresh artifact gate verifies real exports, DOCX -> PDF, hidden-path evidence,
same-runtime reuse, malformed input, and load/password failure.
