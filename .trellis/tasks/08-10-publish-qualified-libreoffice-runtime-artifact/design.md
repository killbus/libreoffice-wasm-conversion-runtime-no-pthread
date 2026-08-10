# Design: publish qualified LibreOffice runtime artifact

## 1. First-principles boundary

The thing being qualified is a byte set plus provenance, not a branch name, a
successful semantic release, or a directory on one developer's machine.
Publication therefore has two separate state transitions:

```text
validated candidate bytes
  -> deterministic unqualified payload
  -> draft GitHub Release
  -> independent acceptance receipt
  -> qualified release manifest
  -> public immutable/fail-closed release
```

Candidate identity never changes during this flow. Qualification is a later
statement about that identity. The existing local candidate metadata remains
`releaseQualified: false`; qualification is not implemented by editing history.

## 2. Trust and ownership boundaries

```text
GHA run 31211473147 + wrapper df3f73c
  |  TEAM B: acquire and verify exact inputs
  v
safe staging + deterministic packager
  |  TEAM B: upload once
  v
draft GitHub Release
  |  killbus: download through GitHub, never from staging
  v
fresh extraction + Node/Chromium acceptance
  |  killbus: acceptance receipt or rejection
  v
qualified manifest + protected final release
  |  TEAM B: finalize only with passing receipt
  v
public re-download and post-publication verification
```

The GitHub download boundary matters: it covers packaging, upload, release
metadata, and download behavior that a local byte comparison alone cannot test.
The role boundary matters: TEAM B's implementation report cannot authorize its
own irreversible promotion.

## 3. Frozen input contract

The packager consumes one canonical candidate specification containing:

- candidate ID;
- native commit and GitHub Actions run ID;
- wrapper commit;
- native ABI and schema version;
- pthread worker mode and optional external-worker state;
- sorted asset entries with relative path, role, MIME metadata, byte length,
  and full SHA-256.

The canonical table is recorded in `research/artifact-provenance.md`. Source
roots are runtime parameters and are never candidate-identity fields. The
packager validates sources against the specification before copying anything.

The allowed runtime paths are exactly:

```text
dist/browser.d.ts
dist/browser.js
dist/browser.worker.global.js
wasm/loader.cjs
wasm/soffice.cjs
wasm/soffice.data
wasm/soffice.js
wasm/soffice.wasm
```

`wasm/loader.cjs` is wrapper-owned loading support. It must not be falsely
reported as an original output from native GHA run `31211473147`. No standalone
pthread worker exists because this candidate uses `main-script` mode.

## 4. Release artifact model

The exact filenames may be finalized by TEAM B, but the public model has four
non-overlapping records.

### 4.1 Candidate payload archive

Recommended name:

```text
libreoffice-wasm-runtime-<full-candidate-id>.zip
```

Recommended layout:

```text
dist/
  browser.d.ts
  browser.js
  browser.worker.global.js
wasm/
  loader.cjs
  soffice.cjs
  soffice.data
  soffice.js
  soffice.wasm
CANDIDATE-MANIFEST.json
ASSET-SHA256SUMS
```

The two control files describe the eight runtime files and do not count as
runtime assets. `CANDIDATE-MANIFEST.json` states that this is the frozen
candidate awaiting/independent of release qualification; it does not claim
`releaseQualified: true`.

### 4.2 Candidate manifest and `SHA256SUMS`

Publish the canonical candidate manifest separately as well as inside the
archive so consumers can inspect identity before extraction. A release-level
`SHA256SUMS` binds at least the payload archive and standalone candidate
manifest. It is generated before draft upload and never replaced.

Canonical JSON uses UTF-8 without BOM, LF endings, stable key ordering where
applicable, and no timestamps or absolute source paths in identity material.
Operational timestamps belong in staging/acceptance records, not the candidate
ID.

### 4.3 Acceptance receipt

The acceptance owner produces a machine-readable receipt only after downloading
the draft through GitHub and running the independent gates. It binds:

- schema/kind and decision (`accepted` or `rejected`);
- candidate ID and payload archive hash;
- draft release database ID/URL and tag name;
- release target commit;
- verifier version/commit;
- exact gate commands and summarized outcomes;
- five retry-free cold-start run results;
- acceptance owner and timestamp.

TEAM B may provide the schema and validation tooling, but TEAM B must not forge
or pre-populate a passing receipt.

### 4.4 Qualified release manifest

After a passing receipt, TEAM B creates `RELEASE-MANIFEST.json` with
`releaseQualified: true`. It references the hashes of the candidate manifest,
payload archive, `SHA256SUMS`, and acceptance receipt, plus the final tag,
target commit, release ID, and complete asset inventory.

This record is added once; it does not replace the candidate manifest. Its
canonical bytes or digest must be anchored by the final protected tag/commit or
by a platform immutable-release mechanism.

## 5. Deterministic archive contract

Determinism covers the archive bytes, not only extracted file hashes:

1. sort entries by normalized POSIX relative path;
2. use one fixed timestamp policy (for example a documented constant or an
   immutable source timestamp);
3. normalize regular-file permissions and ownership metadata;
4. omit host-specific extra fields and comments;
5. select and pin one compression algorithm/level implementation;
6. serialize control files canonically;
7. build twice in separate fresh staging roots and compare full archive
   SHA-256 and byte length.

The verifier first inspects the central directory/entry headers and rejects
absolute paths, drive-qualified paths, `..`, duplicate normalized names,
case-fold collisions, non-regular files, symlinks, hardlinks, and undeclared
entries. It extracts only after this check, into an empty boundary-checked root,
then recomputes every file hash and candidate ID.

A verifier must not trust `SHA256SUMS` merely because it came from the same
archive. The frozen candidate specification and/or protected release manifest
is the external trust anchor.

## 6. Release workflow separation

There are currently three distinct release concepts:

| Concept | Trigger/tag | Payload |
|---|---|---|
| Semantic npm/package release | `v<semver>` from `main` | TypeScript package and existing release behavior |
| Runtime artifact release | `runtime-artifact-<candidate-id>` | This exact content-addressed runtime payload |
| Manual operational workflows | explicit `workflow_dispatch` | Operator-selected Pages/font behavior |

`pages.yml` currently runs for every published release and checks out tracked
LFS WASM. `font-bundles.yml` also runs for every published release and uploads
with `--clobber`. Therefore runtime publication is unsafe until both workflows
have an explicit tag/event decision gate on the default branch.

An executable decision function or workflow test should cover at least:

| Event | Tag | Pages/font semantic job |
|---|---|---|
| `release.published` | `v2.7.3` | allow |
| `release.published` | `runtime-artifact-21fc...` | deny |
| `release.published` | malformed/empty | deny |
| `workflow_dispatch` | explicit valid input | allow intentionally |

A simple textual workflow diff is not sufficient if quoting or GitHub
expression semantics leave the runtime path reachable.

## 7. Draft and promotion state machine

```text
PLANNED
  -> STAGED                 exact bytes verified twice
  -> DRAFT_UPLOADED         GitHub draft, unqualified records only
  -> ACCEPTED | REJECTED    decision by killbus
  -> QUALIFIED_DRAFT        passing receipt + final manifest, still draft
  -> PUBLISHED              explicit TEAM B finalize action
  -> VERIFIED_PUBLIC        public re-download and workflow checks pass
```

Forbidden transitions:

- `DRAFT_UPLOADED -> PUBLISHED` without a bound passing receipt;
- `REJECTED -> PUBLISHED`;
- replacing any accepted asset while keeping the candidate/tag;
- changing a hash and recalculating the same candidate ID;
- treating a TEAM B preflight as `ACCEPTED`;
- triggering a native build to repair a packaging or acceptance failure.

The finalization workflow should require an explicit acceptance-receipt input
and preferably a protected GitHub Environment with the acceptance owner as a
required reviewer. If repository settings cannot enforce that, the checked-in
workflow must still validate the receipt/hash binding and fail closed.

## 8. Immutability model

The strongest option is a GitHub immutable release, provided it is available
and does not silently break existing post-publish semantic-release workflows.
TEAM B must verify, not assume, that repository behavior.

If platform immutability is unavailable or incompatible, the equivalent policy
must make replacement bytes unacceptable:

1. the full candidate ID and archive hash are content-addressed;
2. the final manifest digest is anchored in a protected tag/commit;
3. tag update/deletion is prevented by an evidenced repository ruleset or an
   equivalent control;
4. the consumer/verifier requires the anchored digest and full payload hash;
5. re-uploaded or changed bytes fail before extraction/use.

This fallback does not claim that an administrator is physically unable to
alter the release page; it proves altered bytes cannot pass the release
identity contract.

## 9. Independent acceptance architecture

The acceptance owner works in fresh directories and uses the draft URL as the
only payload source:

```text
gh/GitHub API download
  -> release inventory check
  -> archive preflight/path-safety check
  -> fresh extraction
  -> exact hashes + metadata + candidate-ID verification
  -> fresh Node conversion smoke/recovery gate
  -> PDFHow candidate adapter/overlay created from extracted exact bytes
  -> full Chromium gate
  -> 5 x fresh browser/profile cold-start conversion, retries=0
  -> receipt
```

The PDFHow adapter/control metadata may be generated in the fresh acceptance
workspace, but runtime bytes must come only from the downloaded archive. The
adapter must not add or patch runtime assets. Browser output must still show the
hidden native path, no visible-frame entry, correct runtime network inventory,
COOP/COEP and `SharedArrayBuffer`, healthy reuse/recovery/disposal, and no
standalone worker request.

The prior isolated 180-second timeout makes retries an invalid reliability
measurement. Each soak iteration is a separately reported sample. A timeout or
failure ends with rejection and retained diagnostics.

## 10. Evidence model

TEAM B persists:

- preflight source acquisition and expected hashes;
- deterministic-build comparison report;
- negative verifier test results;
- workflow event/tag matrix results;
- draft release handoff with release ID/URL/target/assets;
- proof that no native build was triggered;
- final manifest, publication, public re-download, and release-trigger results.

The acceptance owner persists:

- downloaded release inventory and recomputed hashes;
- safe-extraction/verifier report;
- Node and Chromium results;
- five cold-start samples with retries disabled;
- accepted/rejected receipt.

Evidence should use machine-readable JSON where identity is involved and a
human-readable task report for interpretation.

## 11. Failure and rollback

- Input/hash drift: fail before staging; classify as a new candidate.
- Unsafe/non-deterministic archive: fail before upload.
- Draft upload mismatch: reject/delete the draft after explicit review; never
  clobber an asset.
- Browser timeout or runtime failure: preserve traces, reject qualification,
  and do not trigger a native build automatically.
- Release-trigger guard not on default branch: do not publish.
- Final manifest/receipt mismatch: do not publish.
- Post-publication mismatch or unintended Pages/font action: mark publication
  failed, preserve original evidence, and use an explicit revocation record;
  never silently replace assets under the same identity.

## 12. Downstream boundary

A verified public runtime release is an input to a separate PDFHow production
cutover task. That later task may change dependency identity, Vite publication,
lockfile, deployment output, and rollback selection. None of those changes are
part of this release task.
