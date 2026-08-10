# Downstream PDFHow browser-gate evidence

Captured: 2026-08-10 (Asia/Shanghai)

## Source task

The downstream validation was performed in:

```text
D:\Repositories\pdfhow.com-next\.trellis\tasks\
  08-09-validate-project-owned-libreoffice-runtime-artifact
```

Relevant records are `prd.md`, `design.md`, `research/preflight.md`, and
`research/browser-candidate-gate.md`. The candidate was consumed from an ignored
test-only overlay; PDFHow production dependency/Vite/lockfile state was not
changed.

## Browser identity

- Candidate ID:
  `21fcdfd7e9f49efc08c6ba56c13337cc0be59a9b496f5424adbe57e0fb4a6e7b`
- Native/wrapper identity and all eight hashes match
  `research/artifact-provenance.md`.
- Native mode: `lok-convert-document-v1`, schema `1`, `main-script` pthread,
  external worker `null`.
- Candidate Chromium result: **2 passed (3.3m)**.
- Installed Matbee control result: **2 passed (3.2m)**.
- Playwright retries were not used to conceal candidate behavior.

## Functional and lifecycle evidence

The final full candidate run produced valid `%PDF-` output for:

| Case | PDF bytes | Duration |
|---|---:|---:|
| Generated DOCX | 14,670 | 940 ms |
| Same-Worker reuse | 14,670 | 83 ms |
| Hash-pinned `test.docx` | 651,789 | 3,824 ms |
| Legacy DOC | 11,445 | 79 ms |
| Valid conversion after malformed input | 14,670 | 59 ms |
| Custom-font conversion | 14,670 | 312 ms |
| Valid conversion after cancellation/restart | 14,670 | 1,257 ms |

Additional evidence:

- `crossOriginIsolated === true` and `SharedArrayBuffer` was available;
- successful calls emitted hidden-native-path evidence with
  `hidden=1 visible-frame-setup-entered=0`;
- no diagnostic entered visible-frame setup;
- the healthy second conversion reused the first conversion Worker;
- malformed input remained bounded and a following valid conversion recovered;
- cancellation/restart/disposal paths terminated all three Workers they created;
- profile restart and runtime disposal behavior passed;
- no standalone `soffice.worker.js` existed or was requested.

## Network and MIME evidence

The browser requested exactly four unique runtime network assets. Type
declarations, `loader.cjs`, and Node glue are package/runtime files but are not
browser network requests for this path.

| Requested asset | MIME | Bytes |
|---|---|---:|
| `browser.worker.global.9cababb37ce81ca8.js` | `text/javascript` | 122,735 |
| `soffice.0c18483bdf23a83e.js` | `text/javascript` | 439,517 |
| `soffice.b24a888550d27d29.wasm` | `application/wasm` | 148,022,311 |
| `soffice.c4b8a92b566d4e0d.data` | `application/octet-stream` | 99,735,790 |

All returned HTTP 200 with the expected MIME and uncompressed
`Content-Length`; no request failed or came from a Service Worker. Worker
`responseBodySize` was treated as observational because Chromium can report
zero/negative cache-adjusted values for Worker/importScripts traffic.

## Reliability observation that remains open

The first focused candidate run after enabling transfer capture completed all
four HTTP transfers and reached native `event=abi-enter`, but did not return
within the 180-second conversion bound. The gate disposed the runtime and
failed. It did not retry inside the test, patch the artifact, or trigger a native
build.

An immediate clean focused rerun passed (`1 passed (3.8m)`), and the full run
then passed (`2 passed (3.3m)`). The timeout did not reproduce. It is therefore
not proof of a deterministic defect, but it is real production-qualification
evidence and must remain visible.

## Consequence for independent acceptance

A single successful browser gate is insufficient for publication. Acceptance
must:

1. download the draft release through GitHub into a fresh path;
2. verify/extract it without reusing TEAM B staging or the prior overlay;
3. materialize only non-runtime test control metadata around those downloaded
   exact bytes;
4. run the full PDFHow Chromium candidate gate with retries disabled;
5. run at least **five consecutive fresh browser/profile cold-start
   conversions**, each reported separately and with retries disabled;
6. fail qualification on any timeout or conversion failure rather than rerun
   until green;
7. retain traces/network/native-stage diagnostics for a failed sample.

The soak is an acceptance activity owned by `killbus`. TEAM B may run a
preflight soak but cannot use it as the independent receipt.

## Production boundary

Passing the browser candidate gate proves compatibility of this exact byte set
with PDFHow's real Worker/network/isolation model. It does not itself:

- make the ignored overlay release-qualified;
- publish an immutable project-owned artifact;
- update PDFHow production dependency identity;
- verify production build output/headers;
- remove the installed Matbee rollback boundary.

Those cutover actions remain a separate follow-up task after this public
artifact release passes independent acceptance.
