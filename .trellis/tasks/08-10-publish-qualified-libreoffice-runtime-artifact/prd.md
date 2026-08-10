# Publish qualified LibreOffice runtime artifact

## Goal

Publish the exact LibreOffice WASM runtime candidate already validated in Node
and in PDFHow Chromium as a dedicated, content-addressed GitHub Release. TEAM B
owns implementation and draft staging. `killbus` owns independent acceptance.
The release must remain a draft and must not claim qualification until that
independent acceptance has passed.

This task publishes an artifact; it does not rebuild LibreOffice/WASM and does
not switch PDFHow production to the artifact.

## Ownership and handoff

| Responsibility | Owner |
|---|---|
| Release tooling, workflow guards, deterministic packaging, draft release, implementation evidence | TEAM B |
| Independent download, verification, runtime/browser gates, acceptance receipt | `killbus` |
| Final release manifest and publication after a passing receipt | TEAM B |

TEAM B may run its own preflight tests, but those results do not replace the
independent acceptance checkpoint. TEAM B must stop after preparing the draft
and hand it to the acceptance owner.

## Frozen candidate

- Candidate ID:
  `21fcdfd7e9f49efc08c6ba56c13337cc0be59a9b496f5424adbe57e0fb4a6e7b`
- Native commit: `71d33678ed74872ebbb1bc37f5778143f8f5e401`
- Native GitHub Actions run: `31211473147`
- Wrapper commit: `df3f73c789e6d2abf71cbcd75186118d2bbc795a`
- Native ABI/schema: `lok-convert-document-v1` / `1`
- Pthread mode: `main-script`; external worker: `null`
- Runtime payload: the eight files and hashes recorded in
  `research/artifact-provenance.md`
- Current state: candidate evidence says `releaseQualified: false`

Any asset byte, size, provenance field, ABI field, pthread mode, or expected file
set that differs from this frozen identity is a different candidate and must
fail this task. It must not be published under the ID above.

## Requirements

### R1. Preserve the validated bytes and provenance

1. Package exactly the eight frozen runtime assets. Reject missing, extra,
   changed, or renamed runtime assets and reject any `soffice.worker.js`.
2. Accept explicit source roots or immutable remote inputs; never hard-code one
   developer's `D:\tmp` path into implementation or public metadata.
3. Verify every expected byte length and full SHA-256 before staging and again
   after packaging.
4. Preserve the provenance distinction: the four `soffice` build outputs came
   from run `31211473147`; `wasm/loader.cjs` and `dist/*` belong to wrapper
   commit `df3f73c`.
5. Do not invoke `build:wasm`, `build-wasm.yml`, `build/build-wasm.sh`, or an
   equivalent native compilation. Do not create a compatibility file or borrow
   a worker from an older artifact.
6. A wrapper rebuild is allowed only as a reproducibility check. The bytes to be
   published must still match the frozen hashes exactly; changed output creates
   a new candidate requiring a new browser gate.

### R2. Deterministic, fail-closed packaging and verification

1. Add checked-in tooling that assembles the release payload from explicit
   inputs and a checked-in/frozen candidate specification.
2. Stage into a newly created safe temporary directory. Resolve path boundaries
   before replacement and never recursively delete outside the declared staging
   root.
3. Emit a deterministic archive, canonical candidate manifest, and
   `SHA256SUMS`. Two assemblies in separate fresh directories with the same
   inputs must produce byte-identical release assets and the same archive hash.
4. Normalize archive entry order, path separators, timestamps, permissions, and
   metadata. Archive entries must be relative regular files only: no absolute
   paths, `..`, symlinks, hardlinks, devices, or undeclared files.
5. Add an independent verify/extract mode that rejects unsafe archive paths,
   schema drift, duplicate entries, missing/extra files, size/hash drift,
   provenance drift, and candidate-ID drift before exposing extracted bytes.
6. Public manifests must not contain developer-local absolute paths. The
   existing `LOCAL-CANDIDATE-METADATA.json` remains historical local evidence
   with `releaseQualified: false`; do not edit it to claim release status.
7. Qualification is represented by a separate release manifest produced only
   after independent acceptance. Candidate identity and release qualification
   are separate facts.

### R3. Dedicated draft release

1. Use a dedicated runtime tag namespace:
   `runtime-artifact-<full-candidate-id>`. Semantic package tags remain
   `v<semver>`.
2. Create a draft GitHub Release first. Its title, notes, target commit, tag,
   candidate ID, payload hash, and full asset inventory must be recorded in a
   machine-readable staging report.
3. Upload each named release asset once. Runtime publication tooling must not
   use `gh release upload --clobber`, delete-and-reupload, or any equivalent
   replacement behavior.
4. The draft must contain enough unqualified payload metadata for an
   independent party to download and verify it without access to TEAM B's
   staging directory.
5. Draft creation must not publish an npm package, deploy Pages, update tracked
   LFS binaries, or change the production package identity.

### R4. Isolate existing release-triggered workflows

1. Before the runtime release is published, guard
   `.github/workflows/pages.yml` and
   `.github/workflows/font-bundles.yml` so dedicated runtime-artifact releases
   cannot execute their semantic-package release jobs.
2. Preserve deliberate `workflow_dispatch` behavior and semantic `v<semver>`
   behavior. Add an event/tag decision test or equivalent executable check for
   both allowed and denied cases.
3. The guards must be present on the default branch before final publication,
   because release-event workflows are resolved from the default branch.
4. Prove that publishing `runtime-artifact-*` neither deploys the old tracked
   LFS WASM to Pages nor uploads font bundles with `--clobber`.
5. Do not claim that the existing semantic-release workflow publishes this
   runtime: `.github/workflows/publish.yml` currently does not promote the
   frozen native artifact.

### R5. Independent qualification checkpoint

1. TEAM B must provide a handoff containing the draft release URL/ID, expected
   tag and target, immutable candidate identity, release-asset names/hashes,
   exact verification commands, and implementation check results.
2. The acceptance owner downloads release assets through GitHub into a fresh
   path. Acceptance must not consume TEAM B's staging directory or a previously
   assembled local overlay.
3. The acceptance owner recomputes all hashes/sizes, verifies the archive path
   safety and exact inventory, and verifies provenance, ABI/schema, pthread
   mode, and absence of `soffice.worker.js`.
4. The downloaded/extracted bytes must pass the Node positive, negative, reuse,
   and recovery gates, or an acceptance script must prove exact-byte
   equivalence to the already accepted Node evidence and still perform a fresh
   conversion smoke gate.
5. The downloaded/extracted bytes must pass PDFHow's real Chromium candidate
   gate. Because one isolated 180-second native-ABI cold-start timeout was
   previously observed, run at least five consecutive fresh-browser cold-start
   conversions with retries disabled. Any failed/timeout run fails acceptance;
   it must not be hidden by retrying.
6. Acceptance also verifies that no new native build ran and that the release
   trigger guards are active on the default branch.
7. A passing result produces an acceptance receipt bound to the candidate ID,
   archive hash, draft release ID, target commit, test commands/results, and
   timestamp. A failure produces a rejection record and leaves the release
   draft/unqualified.

### R6. Qualification manifest and final publication

1. Only a passing independent acceptance receipt authorizes TEAM B to create a
   separate `RELEASE-MANIFEST.json` with `releaseQualified: true`.
2. The release manifest must bind the frozen candidate, archive SHA-256,
   candidate-manifest SHA-256, acceptance-receipt SHA-256, release tag, target
   commit, and final release-asset inventory. It must not rewrite candidate
   history.
3. Before publishing, the acceptance owner gets a final inventory/hash review
   opportunity. No previously accepted asset may change.
4. Publish only after an immutability policy is active and evidenced. Prefer
   GitHub immutable releases when available and compatible; otherwise anchor
   the content-addressed manifest in a protected Git tag/commit and provide a
   verifier that rejects any replacement bytes under the same identity.
5. After publication, independently download the public assets again and prove
   they match the accepted draft hashes and final manifest.
6. Confirm release-triggered Pages/font jobs are skipped or absent for the
   runtime tag. Any unintended deployment/upload is a release failure.

### R7. Evidence and rollback

1. Persist implementation, draft, acceptance, and post-publication evidence in
   this Trellis task or a task-referenced machine-readable location. Do not rely
   on chat history.
2. Record all GitHub run/release IDs and explicitly record that no new native
   build occurred.
3. Before publication, rollback is deleting the draft release through an
   explicitly reviewed operation; never mutate the frozen payload into a new
   candidate. After publication, do not replace assets in place. Revoke through
   a new explicit record/release while preserving the original evidence.

## Acceptance Criteria

- [ ] **AC1 (`R1`):** The packaged runtime contains exactly the eight frozen
      assets with the recorded byte lengths and SHA-256 values, and contains no
      `soffice.worker.js`.
- [ ] **AC2 (`R1`):** Evidence proves no LibreOffice/WASM build was triggered and
      all provenance fields match candidate
      `21fcdfd7e9f49efc08c6ba56c13337cc0be59a9b496f5424adbe57e0fb4a6e7b`.
- [ ] **AC3 (`R2`):** Two fresh assemblies are byte-identical, and negative tests
      reject missing/extra/changed files, malformed metadata, path traversal,
      duplicate entries, symlinks, and candidate-ID drift.
- [ ] **AC4 (`R2`):** Candidate/public/qualification manifests have distinct
      semantics; historical local metadata remains unmodified and false.
- [ ] **AC5 (`R3`):** A dedicated draft release exists with content-addressed
      assets uploaded once, no clobber path, and a complete handoff report.
- [ ] **AC6 (`R4`):** Default-branch event/tag gates allow semantic `v<semver>`
      and deliberate manual dispatch while denying runtime tags for Pages and
      font-bundle jobs.
- [ ] **AC7 (`R5`):** The acceptance owner downloads from GitHub into a fresh
      path and independently verifies safe extraction, exact inventory, hashes,
      provenance, ABI/schema, pthread mode, and worker absence.
- [ ] **AC8 (`R5`):** Downloaded bytes pass fresh Node smoke/recovery coverage and
      PDFHow's full Chromium gate.
- [ ] **AC9 (`R5`):** Five consecutive retry-free fresh-browser cold-start runs
      pass; any timeout is surfaced rather than retried away.
- [ ] **AC10 (`R5`):** A machine-readable acceptance receipt from `killbus` binds
      the exact draft release and payload, or the release remains a draft.
- [ ] **AC11 (`R6`):** `RELEASE-MANIFEST.json` is created only after AC10 and
      binds the receipt plus all final release identity fields with
      `releaseQualified: true`.
- [ ] **AC12 (`R6`):** Post-publication downloads match the accepted draft and
      an evidenced immutable/fail-closed identity policy prevents replacement
      bytes from being accepted under the same candidate/tag.
- [ ] **AC13 (`R6`):** Runtime publication causes no Pages deployment of tracked
      LFS WASM and no font-bundle upload.
- [ ] **AC14 (`R7`):** Task evidence contains commands, hashes, run/release IDs,
      ownership checkpoints, and rollback/revocation behavior.

## Out of Scope

- A new native/WASM build or changes to the native bridge.
- Post-baseline trimming or size-optimization experiments.
- Replacing the repository's tracked LFS WASM files.
- npm publication, semantic package versioning, or renaming the npm package.
- PDFHow production dependency, lockfile, root Vite, or deployment changes.
- Treating the existing ignored PDFHow candidate overlay as a production
  artifact.
- Hiding or auto-retrying the previously observed cold-start timeout.
- Broad Office fidelity/format expansion beyond the already accepted candidate
  gates.

## Planning status

This is a complex handoff task. `prd.md`, `design.md`, `implement.md`, research,
and context manifests must be reviewed before TEAM B runs `task.py start`.
Creation of this planning task does not authorize implementation, publication,
or a native build.
