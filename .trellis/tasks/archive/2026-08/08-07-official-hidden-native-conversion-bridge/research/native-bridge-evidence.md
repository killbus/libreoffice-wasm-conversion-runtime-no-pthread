# Native bridge evidence

## Baseline and artifact

- Runtime base commit:
  `7c1d42e9c603ad4b0f371762c2689b4fdca51493`
- GHA run: `30902972344`
- Artifact directory: `D:/tmp/lo-artifact-08-04-30902972344`
- WASM SHA-256:
  `5AF6440801891DF5485CDD08B37DCF2D621055832DDB277A7E5A55FEB1F9016B`

The diagnostic browser CLI probe at
`D:/tmp/lo-artifact-08-04-30902972344/browser-gate` called the artifact's
official `_main --headless --convert-to pdf` path:

- input `test.docx`: 6,693,403 bytes
- output `test.pdf`: 651,789 bytes
- elapsed: 13,758 ms
- output header: `%PDF-`
- PDF SHA-256:
  `200ae798f09a798ade9aeb3d58a33ffbda6e13d6b2f4c7ff96cbd0e418b733b4`

Conclusion: the baseline already contains working official conversion code.
The `_main` probe establishes feasibility, not a production ABI.

## LibreOffice source anchors

Pinned source cache: `D:/tmp/lo-core-24-8`, revision
`d1c9e0e4e1ddeb24fe8f93e56860b3765043f8b1`. That worktree has diagnostic
changes and is read-only evidence; implementation requires a new pristine
worktree.

### `desktop/source/lib/init.cxx`

Pristine anchors at the pinned revision:

- `convertOString`: around line 388; allocates returned strings with `malloc`
- `getAbsoluteURL`: around line 402
- `lo_documentLoadWithOptions` declaration: around line 2525
- `lo_documentLoadWithOptions` implementation: around line 2651
- `doc_saveAs`: around line 3394
- `lo_destroy`: around line 8311

The file already has JSON/property helpers, `XStorable`, an UNO context,
Solar-mutex conventions, and a matching malloc/free ownership model. The raw
LOK load path does not set `Hidden`, `ReadOnly`, or `OpenNewView`.

### `desktop/source/app/dispatchwatcher.cxx`

Pristine anchors:

- hidden load properties: around line 378
- synchronous dispatch: around line 529
- `ConversionRequestOrigin`: around line 649
- `storeToURL`: around line 715
- `XCloseable` cleanup: around line 776

Official conversion loads with `ReadOnly=true`, `OpenNewView=true`,
`Hidden=true`, `Silent=true`, target `_blank`; exports with
`ConversionRequestOrigin=CommandLine`, `Overwrite=true`, explicit filter
properties; then closes or disposes the component.

## Runtime path evidence

- Node public conversion reaches `converter-node.ts::performConversion()` via
  `subprocess.worker.cts` and `node.worker.ts`.
- Browser basic conversion exists both in `converter.ts` and in the non-image
  branch of `browser.worker.ts`.
- `lok-bindings.ts` already centralizes string allocation/readback, pointer
  reads, fresh heap views, `_malloc`/`_free`, and the LOK instance pointer.
- Editor/render/preview/multi-page-image paths need live document pointers and
  are not candidates for this transaction bridge.

## Build-patch evidence

At `7c1d42e`, conversion-only build order is:

1. `wasm-build-fixes.patch`
2. `wasm-trim-lok-exports-conversion-only.patch`
3. `wasm-trim-lok-shims-conversion-only.patch`

The native bridge is a new fourth, reversible atom. The first bridge artifact
keeps legacy LOK and `_main` exports for A/B evidence and pointer-based feature
compatibility.
