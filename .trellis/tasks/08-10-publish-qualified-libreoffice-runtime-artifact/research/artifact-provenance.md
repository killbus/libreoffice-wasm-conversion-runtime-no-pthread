# Frozen artifact provenance

Captured: 2026-08-10 (Asia/Shanghai)

## Purpose

This record is the external identity anchor for the runtime candidate that TEAM
B is allowed to package. Packaging must fail on any mismatch; it must not
normalize changed bytes into the same candidate ID.

## Candidate identity

| Field | Frozen value |
|---|---|
| Candidate ID | `21fcdfd7e9f49efc08c6ba56c13337cc0be59a9b496f5424adbe57e0fb4a6e7b` |
| Native runtime commit | `71d33678ed74872ebbb1bc37f5778143f8f5e401` |
| Wrapper commit | `df3f73c789e6d2abf71cbcd75186118d2bbc795a` |
| Native GHA run | `31211473147` |
| Native ABI | `lok-convert-document-v1` |
| Native schema | `1` |
| Pthread worker mode | `main-script` |
| External worker | `null` |
| Current qualification | `releaseQualified: false` |

Local evidence roots at capture time were:

```text
D:\tmp\lo-artifacts-08-08-31211473147
D:\tmp\lo-native-bridge-7c1d42e
D:\Repositories\pdfhow.com-next\third_party\libreoffice-wasm-conversion-runtime-dev
```

These absolute paths are evidence only. They are not public manifest fields and
must not be hard-coded by release tooling.

## Exact runtime assets

The eight runtime assets total **248,930,047 bytes**.

| Relative path | Role/source | Bytes | SHA-256 |
|---|---|---:|---|
| `dist/browser.d.ts` | wrapper output at `df3f73c` | 71,783 | `73d0f6ab719d0f643d38fc1839be295f0aed4cb09a8c8cb8f054d65a224f63fb` |
| `dist/browser.js` | wrapper output at `df3f73c` | 87,881 | `9fa0fef0b7554bef5c5a59c4fc85a325d77b0a218129be38febf4a6d02a4518c` |
| `dist/browser.worker.global.js` | wrapper output at `df3f73c` | 122,735 | `9cababb37ce81ca8d60158cd6ffe1b5e218cbcb33c5d87bc74f08ec8e3804741` |
| `wasm/loader.cjs` | wrapper loader at `df3f73c`; not a native GHA output | 10,513 | `7cebd863dcd071a5eb02bc26fa7701e7dc5c865d1e130e5595672e56a34934cf` |
| `wasm/soffice.cjs` | native GHA run `31211473147` | 439,517 | `0c18483bdf23a83e9ab1d180fc8d3c850f6cd57a42e4e1cda545e25c512940a5` |
| `wasm/soffice.data` | native GHA run `31211473147` | 99,735,790 | `c4b8a92b566d4e0d4723d321ef926e1b9fbeb575d28cdd6466d27fd2c17c5514` |
| `wasm/soffice.js` | native GHA run `31211473147` | 439,517 | `0c18483bdf23a83e9ab1d180fc8d3c850f6cd57a42e4e1cda545e25c512940a5` |
| `wasm/soffice.wasm` | native GHA run `31211473147` | 148,022,311 | `b24a888550d27d2942ff9c8c9a84e20cd0c852db154e8558647cb9c5294ff291` |

There is no `soffice.worker.js`. The browser glue uses the main script as the
pthread script, and the wrapper models that state explicitly as
`pthreadWorkerMode: "main-script"`, `externalWorker: null`.

## Original native workflow archive

The original downloaded workflow ZIP is preserved as provenance for the four
native build outputs:

| Field | Value |
|---|---|
| Name | `soffice-wasm-conversion-only-31211473147.zip` |
| Bytes | 78,834,433 |
| SHA-256 | `ff378040a97d5e8df32c0e221add55200bbaa33015213fa2225849822d558e3e` |

`wasm/loader.cjs` was copied beside the extracted native files to make the Node
probe load from that directory. It was not part of the original GHA ZIP.

## Native gate evidence already obtained

The archived Trellis task is:

```text
.trellis/tasks/archive/2026-08/
  08-07-official-hidden-native-conversion-bridge/
```

Its `implement.md` section **Successful fresh-artifact gate record
(2026-08-09)** records, against the bytes above:

- two consecutive DOCX-to-PDF conversions in one initialized process;
- non-empty outputs beginning with `%PDF-`;
- `ok=true`, `stage=complete`, `cleanup=clean`;
- `hiddenLoad=true`, `visibleFrameSetupEntered=false`;
- structured malformed JSON, unsupported-schema, missing-URL, missing-file, and
  wrong-password failures;
- successful conversion after safe failures;
- correct `_lok_convertFree` and Emscripten `_free` allocation ownership;
- no C++/WASM exception escaping the private ABI;
- no additional expensive WASM build after GHA run `31211473147`.

The pinned large fixture used there is:

| Path | Bytes | SHA-256 |
|---|---:|---|
| `test.docx` | 6,693,403 | `a78495545ae41486aa61c9a0e8c4c78f6491a8e7b3cfacbd4185ed0f124f59df` |

## Downstream browser identity

PDFHow's validated ignored overlay contained these eight runtime assets plus
three local control files (`LOCAL-CANDIDATE-METADATA.json`, `SHA256SUMS`, and
`package.json`). The 11-file overlay totaled 248,933,733 bytes. Its local
metadata is historical candidate-gate evidence and intentionally says
`releaseQualified: false`.

Do not turn that local file from false to true. A public candidate manifest must
remove local source paths, and a separate qualification manifest must bind a
later independent acceptance receipt.

## Fail-closed identity rules

- Any different hash/size/path is a new candidate.
- Any different commit, run ID, ABI/schema, or pthread state is a new candidate.
- Adding an external worker is a new candidate and would invalidate the prior
  browser evidence.
- Rebuilding wrapper output is only a reproducibility probe; non-matching output
  must not be substituted.
- A package/release version does not override these byte-level rules.
- A successful semantic-release run is not evidence that these native bytes
  were packaged or published.
