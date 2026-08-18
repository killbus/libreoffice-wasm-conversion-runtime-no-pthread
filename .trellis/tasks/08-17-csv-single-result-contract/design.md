# Design: CSV single-result contract

## Contract

```text
pre:
  runtime ready
  input non-empty and conversion pair valid
  effective CSV sheet token is absent, empty, or zero
  exact requested CSV output is proven absent

post on success:
  exact requested output exists and is non-empty
  returned result owns one Uint8Array with text/csv metadata
  transaction CSV paths are clean

post on failure:
  no partial result
  transaction paths are proven cleaned, or runtime is quarantined
  invalid sheet token never reaches native code
```

## Validation boundary

Add one shared CSV single-result validator/resolver used by the public option
validation and native request construction. It inspects zero-based token 11
without rewriting the caller's other tokens. The built-in default changes to
zero. Owners may still materialize the default before crossing a worker boundary,
but the worker/native boundary validates again as defense in depth.

## Output boundary

The requested path remains `/tmp/output/doc.csv`. Directory scanning is not a
success mechanism. Transaction cleanup may enumerate `/tmp/output` only to
remove unexpected `doc-*.csv` siblings attributable to this fixed transaction
basename. It must not delete unrelated files.

## Error model

Invalid options are reusable-runtime contract failures. Native success without
the exact file is a conversion/output-contract failure. Existing lifecycle rules
continue to decide whether cleanup uncertainty quarantines the runtime. CSV
baseline enumeration, stale-output removal proof, transaction-owned unlink, and
post-cleanup enumeration are mandatory: uncertainty rejects success and
quarantines the direct runtime so worker/subprocess owners discard it. When
conversion and cleanup both fail, the primary conversion failure is retained
and annotated with cleanup uncertainty. A non-`Error` primary throw is retained
as `primaryFailure` on the returned cleanup wrapper.

## Compatibility

The old default could not satisfy the singular return type even for a one-sheet
workbook because LibreOffice wrote a suffixed filename. Correcting it is a bug
fix. Explicit multi-sheet options now fail closed instead of leaving unreported
VFS side effects.
