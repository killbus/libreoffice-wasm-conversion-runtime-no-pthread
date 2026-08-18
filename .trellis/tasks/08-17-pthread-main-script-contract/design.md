# Design: pthread main-script artifact contract

## Contract

```text
current frozen profile:
  pthreadWorkerMode = "main-script"
  externalWorker = null
  browser glue starts pthreads from Module.mainScriptUrlOrBlob / soffice.js
  package, candidate, and browser deployment inventories contain no
  basename "soffice.worker.js" at any depth

wrapper default:
  omitted pthreadWorkerMode -> main-script
  main-script + any sofficeWorkerJs -> synchronous artifact-contract failure
  explicit external + non-empty sofficeWorkerJs -> accepted only as an
  explicitly selected, separately frozen future profile
  explicit external without URL -> synchronous artifact-contract failure

runtime:
  main-script init messages contain no sofficeWorkerJs field
  any *.worker.* request in main-script mode fails closed
  no mode inference, asset probing, or fallback
```

## Authoritative profile

The checked-in candidate spec, immutable browser-assets contract, package
inventory, and actual Emscripten glue already agree on `main-script`. The glue
uses `Module.mainScriptUrlOrBlob`, which both direct-browser and classic Worker
owners set to `soffice.js`. The defect is the wrapper's legacy omitted-mode
default and helper-generated standalone-worker path.

The frozen candidate spec, native assets, browser-assets declaration, and
package allowlist are evidence, not edit targets for this child. Wrapper changes
belong to a successor identity; they must not be relabeled as the old candidate.

## Type and resolver boundary

`BrowserWasmPaths` is discriminated so omitted mode belongs to the main-script
branch. `createWasmPaths()` returns the three core paths plus explicit
`pthreadWorkerMode: 'main-script'` and no worker URL. Runtime option interfaces
remain permissive enough for JavaScript callers, but the shared resolver applies
the same fail-closed matrix before any fetch or Worker initialization.

Explicit `external` remains representable only to avoid conflating two artifact
profiles. It has no default URL and is never inferred from `sofficeWorkerJs`.
Shipping or qualifying it requires a separate spec, inventory, glue artifact,
and candidate identity.

## Inventory boundary

One shared path predicate defines a forbidden standalone-worker asset by
basename, not root-relative string equality. Frozen specs, candidate manifests,
the packager's inspected set, archive verification, and the actual npm pack file
list must reject `soffice.worker.js` at any nesting depth. Negative tests must
reach the basename rule rather than fail earlier only because the asset count is
wrong.

## Browser proof

Unit tests prove resolver and init-message behavior. The browser qualification
gate records all network requests, fails immediately on any standalone-worker
basename, initializes the default wrapper, completes a conversion, and proves
pthread execution came from `soffice.js`/`mainScriptUrlOrBlob` with zero external
worker requests.

The checked-out `wasm/soffice.wasm` is a 134-byte Git LFS pointer, so this worktree
cannot honestly execute that gate. The test/gate may be prepared here, but its
passing evidence must use the runnable, newly identified successor artifact; it
cannot be replaced by mocked Worker evidence.

## Rollback and identity

Rollback is an atomic revert of wrapper/resolver/schema/test changes. Never add
a compatibility worker, edit the frozen candidate to match new wrapper bytes,
or restore implicit external mode. Candidate identity derivation must continue
to change for wrapper provenance, runtime profile, manifest, or artifact-byte
changes.
