# Design: conversion-only public surface

## Product boundary

The package exposes one conversion product. Public entry points must not return
raw runtime objects that also carry editor, rendering, callback, view, or UNO
methods absent from the shipped conversion-only WASM ABI.

```text
public object surface:
  initialize
  convert
  destroy
  isReady

public functions:
  one-shot conversion and supported image export
  format validation and immutable format metadata
  browser file/download helpers
  font loading and standalone image encoding helpers

not public:
  raw LOK bindings or converter implementations
  document sessions and editor tool APIs
  page inspection/rendering and callback/view/UNO operations
  LOK interaction constants
```

Raw Node, subprocess, browser, and Worker implementations remain internal so
existing conversion code does not need a simultaneous rewrite. Public factories
return frozen facades whose own properties are exactly the four conversion
methods. The runtime object is held only in closures and cannot be recovered
through an exported property.

## Native ABI allowlist

The conversion artifact at SHA-256
`b24a888550d27d2942ff9c8c9a84e20cd0c852db154e8558647cb9c5294ff291`
has 52 WebAssembly exports. Its exact LibreOfficeKit-facing allowlist is:

```text
lok_abortOperation
lok_convertDocument
lok_convertFree
lok_destroy
lok_documentDestroy
lok_documentLoad
lok_documentLoadWithOptions
lok_documentSaveAs
lok_getError
lok_getOperationState
lok_preinit
lok_preinit_2
lok_resetAbort
lok_setOperationTimeout
```

The four legacy document functions remain required only for the retained image
export path. The 44 editor/render/callback/view symbols present in the upstream
94-export artifact are forbidden from the conversion candidate. Native package
verification compares the full `lok_*` set, rather than checking only that the
two native conversion functions exist.

## Entry-point allowlist

- Root and server entries: conversion factories/functions, conversion/error
  types and metadata, font loaders, image encoders, and pure validation helpers.
- Browser entry: conversion-only factories, browser file/download/drop-zone
  helpers, runtime path helpers, font loading, and conversion/error types.
- Types entry: conversion, configuration, progress, runtime, and image-encoding
  types only.
- Browser-assets entry: unchanged immutable deployment contract.

Exact JavaScript keys are tested for every runtime entry. Type tests reject old
raw classes, editor factories/types, LOK constants, page rendering, document
sessions, and editor operations.

## Format boundary

`jpg` is not a valid LibreOffice conversion output in any current category and
is removed from `OutputFormat` and image export. JPEG encoding remains available
through the standalone RGBA encoder.

Writer/text HTML fails in the upstream 2.7.2 artifact and the current native
artifact with the same missing `com.sun.star.form.Forms` service. Remove HTML
only from the text conversion matrix; spreadsheet, presentation, drawing, and
PDF behavior remain separately represented.

Image export keeps the basic load/save/destroy ABI and accepts `png` or `svg`.
The public helper requires an explicit input format so PDF and other inputs are
not silently treated as DOCX before validation.

## Rollback

This child is one breaking-change commit. Reverting it restores the old public
surface without changing native bytes. No compatibility shim may return dummy
values or route missing editor calls into the conversion artifact.
