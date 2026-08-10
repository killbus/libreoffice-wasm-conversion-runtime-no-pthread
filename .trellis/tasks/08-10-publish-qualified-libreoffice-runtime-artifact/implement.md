# Implementation plan: publish qualified LibreOffice runtime artifact

## Ownership convention

- **`[TEAM B]`** items are implemented and evidenced by TEAM B.
- **`[ACCEPTANCE]`** items are executed and signed by `killbus`; TEAM B must not
  check them on the acceptance owner's behalf.
- **`[HANDOFF]`** is a mandatory stop point. A draft must not be published while
  waiting for acceptance.

## Preconditions

- [ ] **[TEAM B]** Read `prd.md`, `design.md`, and all files under `research/`.
- [ ] **[TEAM B]** Run `task.py start` only after accepting the handoff and
      confirming branch ownership; this planning session intentionally does not
      start the task.
- [ ] **[TEAM B]** Work from `main` at or after
      `df3f73c789e6d2abf71cbcd75186118d2bbc795a` on
      `feat/publish-qualified-libreoffice-runtime-artifact` (or record an
      explicitly reviewed replacement branch).
- [ ] **[TEAM B]** Confirm the repository/worktree status and preserve unrelated
      work. Do not reset or absorb another worktree's WIP.
- [ ] **[TEAM B]** Record the frozen candidate ID, native/wrapper commits, run ID,
      exact eight-file table, and original native archive hash before editing.
- [ ] **[TEAM B]** Confirm in writing that no native/WASM build command or
      workflow will be invoked by this task.

## 1. Guard existing release-event workflows

- [ ] **[TEAM B]** Map every workflow triggered by `release.published`, including
      permissions, default-branch behavior, and asset mutation/deployment.
- [ ] **[TEAM B]** Add an explicit semantic-package tag/manual-dispatch decision
      gate to `.github/workflows/pages.yml`.
- [ ] **[TEAM B]** Add the equivalent gate to
      `.github/workflows/font-bundles.yml` so runtime tags cannot reach its
      `--clobber` upload loop.
- [ ] **[TEAM B]** Preserve valid `v<semver>` release behavior and intentional
      `workflow_dispatch` behavior.
- [ ] **[TEAM B]** Add an executable test/check for allowed `v<semver>`, denied
      `runtime-artifact-*`, denied malformed/empty release tags, and allowed
      explicit manual dispatch.
- [ ] **[TEAM B]** Document that these guards must be merged to the default branch
      before final runtime release publication.

## 2. Define the frozen candidate and schemas

- [ ] **[TEAM B]** Add one machine-readable frozen candidate specification for
      `21fcdfd7e9f49efc08c6ba56c13337cc0be59a9b496f5424adbe57e0fb4a6e7b`.
- [ ] **[TEAM B]** Include native/wrapper provenance, ABI/schema, pthread mode,
      external worker `null`, and the exact sorted asset table.
- [ ] **[TEAM B]** Model source provenance by asset so `loader.cjs` is not
      misrepresented as a GHA native output.
- [ ] **[TEAM B]** Define and validate separate schemas/kinds for candidate
      manifest, staging report, acceptance receipt, and qualified release
      manifest.
- [ ] **[TEAM B]** Make `releaseQualified: true` invalid in candidate/local
      metadata and valid only in a release manifest bound to a passing receipt.
- [ ] **[TEAM B]** Add canonical JSON serialization and candidate-ID derivation
      tests that reproduce the existing candidate ID exactly.

## 3. Implement deterministic assembly and verification

Suggested ownership is a small release module plus CLI scripts and focused
Vitest tests; TEAM B may choose names that fit existing repository conventions.

- [ ] **[TEAM B]** Implement assembly from explicit native/wrapper roots or
      immutable downloaded roots; no developer path may be hard-coded.
- [ ] **[TEAM B]** Resolve staging/destination boundaries before replacing any
      directory and limit cleanup to the declared fresh staging root.
- [ ] **[TEAM B]** Verify expected file type, byte length, and full SHA-256 before
      every file enters staging.
- [ ] **[TEAM B]** Reject undeclared files and any `soffice.worker.js`; never copy
      an older worker as a compatibility shim.
- [ ] **[TEAM B]** Emit the canonical candidate manifest,
      `ASSET-SHA256SUMS`, deterministic payload archive, external
      `SHA256SUMS`, and a machine-readable assembly report.
- [ ] **[TEAM B]** Normalize archive paths, order, timestamps, permissions,
      ownership metadata, compression settings, line endings, and JSON bytes.
- [ ] **[TEAM B]** Implement inspect/verify/extract mode that checks the complete
      archive before extraction and extracts only into a fresh safe root.
- [ ] **[TEAM B]** Verify candidate ID from immutable provenance plus the
      canonical asset table rather than trusting a supplied ID string.
- [ ] **[TEAM B]** Run assembly twice from separate roots and assert identical
      archive bytes, hashes, manifests, and sums.

### Negative tests

- [ ] **[TEAM B]** Missing expected asset.
- [ ] **[TEAM B]** Extra/renamed asset or forbidden standalone worker.
- [ ] **[TEAM B]** One-byte content change, size drift, or wrong expected hash.
- [ ] **[TEAM B]** Wrong native/wrapper commit, run ID, ABI/schema, or pthread
      mode.
- [ ] **[TEAM B]** Malformed/unknown manifest schema or invalid qualification
      state.
- [ ] **[TEAM B]** Absolute/drive-qualified path, `..` traversal, separator
      confusion, duplicate normalized entry, and case-fold collision.
- [ ] **[TEAM B]** Symlink, hardlink, directory/device entry, or extraction target
      escaping the fresh root.
- [ ] **[TEAM B]** Non-deterministic timestamp/order/metadata regression.
- [ ] **[TEAM B]** Attempt to reuse the same candidate ID with changed bytes.

## 4. Add controlled draft-release automation

- [ ] **[TEAM B]** Add a manual, fail-closed draft staging command/workflow. It
      must not be coupled to semantic-release or a push to `main`.
- [ ] **[TEAM B]** Pin/record all third-party Actions used and grant only required
      permissions (`contents: write` only where release creation needs it).
- [ ] **[TEAM B]** Acquire the exact native run artifact and wrapper inputs, or
      accept explicitly supplied roots, then verify the frozen hashes before
      packaging.
- [ ] **[TEAM B]** If wrapper JS is rebuilt as a check, compare it to all three
      frozen `dist/*` hashes and fail on any difference. Never publish newly
      differing wrapper output as this candidate.
- [ ] **[TEAM B]** Use tag namespace
      `runtime-artifact-<full-candidate-id>` and create a **draft** release.
- [ ] **[TEAM B]** Upload each unqualified payload/control asset exactly once.
      Do not use `--clobber`, deletion/re-upload, or a mutable `latest` name.
- [ ] **[TEAM B]** Record release database ID, draft URL, tag, target commit,
      asset IDs/names/lengths/hashes, workflow run ID, and uploader commit in the
      staging report.
- [ ] **[TEAM B]** Download the draft into a fresh CI/local path and run the
      verifier as TEAM B preflight without claiming independent acceptance.
- [ ] **[TEAM B]** Prove no `build-wasm`/native build workflow was dispatched and
      no npm/Pages/font publication occurred during draft staging.

## 5. Run inexpensive implementation gates

Finalize exact commands from repository scripts, but the expected minimum is:

```powershell
npm ci
npm run typecheck
npm run lint
npm run build
npx vitest run --exclude 'tests/*converter*.test.ts'
git diff --check
python ./.trellis/scripts/task.py validate .trellis/tasks/08-10-publish-qualified-libreoffice-runtime-artifact
```

- [ ] **[TEAM B]** Run focused manifest/archive/workflow tests, including every
      negative case above.
- [ ] **[TEAM B]** Run repository type-check, lint, JS/TS build, and appropriate
      non-native tests.
- [ ] **[TEAM B]** Review the final diff for accidental build, LFS, generated
      binary, package-version, and post-baseline trimming changes.
- [ ] **[TEAM B]** Record command versions and results. Existing warnings must be
      distinguished from new failures.
- [ ] **[TEAM B]** Confirm no command equivalent to `npm run build:wasm` ran.

## 6. Mandatory acceptance handoff

- [ ] **[TEAM B]** Prepare one handoff record containing:
  - draft release ID and URL;
  - expected tag and target commit;
  - candidate ID and all provenance fields;
  - release asset names, GitHub asset IDs, byte lengths, and SHA-256 values;
  - verifier command/version;
  - workflow-guard commit and event/tag test result;
  - deterministic assembly comparison result;
  - explicit no-native-build evidence;
  - known prior cold-start timeout disclosure.
- [ ] **[TEAM B]** Confirm the release is still draft and no
      `RELEASE-MANIFEST.json` claims qualification.
- [ ] **[HANDOFF]** Stop. Notify `killbus`. Do not publish or self-author a
      passing acceptance receipt.

## 7. Independent acceptance

These boxes belong to `killbus`, not TEAM B.

- [ ] **[ACCEPTANCE]** Check the draft release identity and asset inventory
      through GitHub API/CLI.
- [ ] **[ACCEPTANCE]** Download all draft assets through GitHub into a new
      acceptance directory, not TEAM B's staging path.
- [ ] **[ACCEPTANCE]** Run archive preflight and safe extraction; independently
      recompute archive/control/runtime hashes and sizes.
- [ ] **[ACCEPTANCE]** Verify the exact eight runtime paths, provenance,
      candidate ID, ABI/schema, `main-script`/`null` worker state, and absence of
      `soffice.worker.js`.
- [ ] **[ACCEPTANCE]** Run a fresh downloaded-byte Node DOCX-to-PDF smoke and
      assert `%PDF-`, hidden path, no visible frame, and clean cleanup.
- [ ] **[ACCEPTANCE]** Run or bind exact-byte equivalence to the existing
      negative/reuse/recovery gates; verify no unsafe-runtime reuse.
- [ ] **[ACCEPTANCE]** Materialize a fresh PDFHow candidate test root using only
      downloaded runtime bytes and generated non-runtime control metadata.
- [ ] **[ACCEPTANCE]** Run PDFHow's full retry-free Chromium candidate gate and
      verify conversion, network/MIME, COOP/COEP, SAB, reuse, recovery,
      cancellation/restart/disposal, and Worker termination evidence.
- [ ] **[ACCEPTANCE]** Run at least five consecutive fresh browser/profile
      cold-start conversions with retries disabled; record each duration and
      result separately.
- [ ] **[ACCEPTANCE]** Reject on any failure or timeout; do not rerun until green
      and hide the failed sample.
- [ ] **[ACCEPTANCE]** Verify release-trigger guards are on default branch and
      verify no new native build run exists.
- [ ] **[ACCEPTANCE]** Produce a schema-valid accepted or rejected receipt bound
      to the exact draft, target commit, candidate, and archive hash.

## 8. Finalize only after acceptance

- [ ] **[TEAM B]** Validate that the receipt is from the declared acceptance
      owner, says accepted, and exactly matches the current draft release ID,
      target, candidate ID, and payload hash.
- [ ] **[TEAM B]** On rejection or mismatch, leave the release draft/unqualified
      and return to analysis; do not mutate the payload or trigger a build.
- [ ] **[TEAM B]** Generate `RELEASE-MANIFEST.json` with
      `releaseQualified: true`, binding all payload/control/receipt hashes and
      the final release identity.
- [ ] **[TEAM B]** Anchor the final manifest/digest through the evidenced
      immutable-release or protected tag/commit policy.
- [ ] **[TEAM B]** Add the receipt/final manifest once without replacing any
      accepted asset and regenerate only non-circular final inventory evidence.
- [ ] **[ACCEPTANCE]** Perform the final pre-publication inventory/hash review.
- [ ] **[TEAM B]** Publish the draft through the explicit finalize action.

## 9. Post-publication verification

- [ ] **[TEAM B]** Record the published release ID/URL/tag/target and all public
      asset IDs.
- [ ] **[ACCEPTANCE]** Download public assets into another fresh directory and
      verify they are byte-identical to the accepted draft.
- [ ] **[TEAM B]** Verify Pages and font-bundle jobs were skipped/absent for the
      runtime tag and no tracked-LFS deployment occurred.
- [ ] **[TEAM B]** Exercise the immutable/fail-closed policy: a changed byte or
      manifest must be rejected under the same candidate/tag.
- [ ] **[TEAM B]** Record any release-triggered runs and their final conclusions.
- [ ] **[TEAM B]** Update task evidence and request final acceptance-owner review.

## 10. Completion gate

The task is complete only when:

- [ ] all TEAM B implementation and finalization boxes are evidenced;
- [ ] all independent acceptance boxes are checked by `killbus`;
- [ ] the public re-download matches the accepted draft;
- [ ] no native build, npm cutover, PDFHow production change, Pages deployment,
      or font upload occurred as a side effect;
- [ ] the runtime artifact has a content-addressed, fail-closed public identity;
- [ ] task validation and final diff/repository checks pass.

## Risk and rollback points

- **Hash drift:** stop and create a separately validated candidate; never reuse
  this ID.
- **Archive ambiguity:** reject before extraction/upload.
- **Cold-start timeout:** reject qualification and preserve diagnostics; no
  automatic retry or native build.
- **Workflow guard not merged:** final publication is blocked.
- **Receipt mismatch:** final publication is blocked.
- **Draft error:** remove the draft only after explicit review; recreate rather
  than clobbering assets.
- **Published error:** preserve the original release evidence and issue an
  explicit revocation/new release; never replace assets in place.

## Acceptance attempt 1 — rejected (2026-08-10)

Independent acceptance owner `killbus` rejects qualification of draft release
`367637128`. The decision is bound to candidate
`21fcdfd7e9f49efc08c6ba56c13337cc0be59a9b496f5424adbe57e0fb4a6e7b`,
target `df3f73c789e6d2abf71cbcd75186118d2bbc795a`, and payload archive
SHA-256 `e9aac8dde2fb627251155fc97651c2bd35bec63b01e39f882d342c024a87de9a`.

The independent download, safe extraction, archive/runtime identity checks,
ABI and pthread-mode checks passed. The downloaded-byte Node functional gate
passed conversion, reuse, negative, recovery, and ABI checks, but did not
explicitly record converter cleanup and is therefore partial.

Qualification is blocked by all of the following:

- the retry-free Chromium candidate gate failed at
  `tests/office-conversion/office-browser.playwright.ts:501:58`, receiving
  cancellation progress phase `finalizing` instead of `converting`, and its
  command boundary later timed out with exit code `124`;
- cold-start sample 1 failed, so samples 2–5 were intentionally not run and no
  retry was performed;
- the required release-event guards are absent from default branch `main`, and
  the feature-branch guard incorrectly allows malformed tags including
  `vfoo.bar`, `v1.x`, `v1..2`, and `v1.2`;
- the verifier help and parser disagree about `--spec`,
  `--expected-candidate-id`, and the undocumented required `--report-out`.

The rejected receipt and supporting records are:

- `acceptance/acceptance-receipt.rejected.json`;
- `acceptance/acceptance-evidence.json`;
- `acceptance/acceptance-report.md`.

The failed Chromium diagnostics remain preserved under
`D:\tmp\lo-runtime-acceptance-367637128-20260810-1251\browser-gate-failure`.
TEAM B retains implementation ownership and must remediate the blockers before
a distinct acceptance attempt. Release `367637128` must remain draft and
unqualified; do not publish it, replace its payload, trigger a native build, or
represent a later run as erasing this failed sample. No completion checkbox is
advanced by this rejected attempt.

### Post-rejection readiness check 1 — Attempt 2 not admitted

At `2026-08-10T08:04:49Z`, the acceptance owner performed a read-only
readiness refresh without rerunning any browser or cold-start gate:

- local branch `feat/publish-qualified-libreoffice-runtime-artifact` remains at
  rejected-attempt HEAD `0b2bf1654994db0dd524ce8f6ca32ab5dce7c348` with no
  tracked implementation delta;
- GitHub `main` remains at the pre-guard commit
  `df3f73c789e6d2abf71cbcd75186118d2bbc795a`;
- GitHub has no branch named
  `feat/publish-qualified-libreoffice-runtime-artifact` and no PR for that
  head;
- release `367637128` remains an unpublished draft with the same five asset
  IDs, sizes, and SHA-256 digests recorded by Attempt 1;
- Build WASM run `31211473147` remains the newest native-build run.

There is therefore no distinct TEAM B remediation commit or handoff to admit
into Acceptance Attempt 2. The strict-semver guards and verifier CLI defects
remain unchanged, while no remediation evidence exists for the Chromium
cancellation/command-hang failure or the Node cleanup coverage gap. Attempt 2
was not started, and the no-retry record for Attempt 1 remains intact.

Machine-readable readiness evidence:

- `acceptance/readiness-check-1.json`;
- SHA-256
  `3d4a73847b1186f9b5b8db4353f65f5f893b63fd01995c0bfa9db4e8844957ed`.

### Post-rejection readiness check 2 — acceptance waiting blocked

At `2026-08-10T08:12:15Z`, a second post-rejection read-only refresh again
found exactly the state captured by readiness check 1:

- local implementation HEAD remains
  `0b2bf1654994db0dd524ce8f6ca32ab5dce7c348`;
- GitHub `main` remains
  `df3f73c789e6d2abf71cbcd75186118d2bbc795a`;
- the TEAM B feature branch and every PR for that head remain absent;
- release `367637128` remains the same unpublished five-asset draft;
- Build WASM run `31211473147` remains newest.

This is the third consecutive observation of the same external blocking
condition: Attempt 1 required remediation, readiness check 1 found no delta,
and readiness check 2 again found no delta. The acceptance workflow is now
blocked waiting for a distinct TEAM B remediation commit and handoff. Attempt 2
remains ineligible and unstarted; no Chromium, cold-start, native-build,
publication, or asset-mutation action was performed.

Machine-readable blocked-state evidence:

- `acceptance/readiness-check-2.json`;
- SHA-256
  `ed9171ccf32b7a0bba30466b3ba1beba529fd03b400cb43aa18786ea0bae8c95`.

### Post-rejection remediation evidence (TEAM B, in progress)

The working tree on
`feat/publish-qualified-libreoffice-runtime-artifact` now carries the code
remediation for the guard and verifier CLI contract blockers and, separately,
explicit Node converter cleanup evidence:

- Strict semantic-version release gating:
  - `scripts/release-runtime/lib/workflow-decision.mjs` uses a strict
    `v<major>.<minor>.<patch>` (optionally `-pre`/`+build`) pattern; the
    malformed probe tags `vfoo.bar`, `v1.x`, `v1..2`, `v1.2` are now denied.
  - `scripts/release-runtime/guard-release-tag.mjs` provides the fail-closed
    first job step; `pages.yml` and `font-bundles.yml` invoke it for
    `release` events before any build/deploy/`--clobber` upload.
  - Covered by `tests/release-runtime/workflow-guard.test.ts` and
    `tests/release-runtime/cli-contract.test.ts` (guard CLI matrix).
- Verifier CLI contract:
  - `parseOptions` now supports `optional` and `bool` option sets;
    `verify.mjs`/`pack.mjs`/`stage-draft.mjs` declare `--spec` and
    `--expected-candidate-id` optional, and `verify.mjs` documents the required
    `--report-out` and writes the report file.
  - Covered by `tests/release-runtime/cli-contract.test.ts`.
- Node converter cleanup evidence (acceptance remediation item 4):
  - `scripts/release-runtime/node-smoke-gate.cjs` extends the rejected attempt's
    gate with an explicit `converter.destroy()` and records disposal state.
  - Executed against the downloaded-byte extraction at
    `temp/2026-08-10-runtime-artifact-acceptance/extract/wasm` with fixture
    `tests/sample_large.docx`. Result PASSED; evidence
    `temp/2026-08-10-runtime-artifact-acceptance/cleanup-gate-work/node-smoke-result.json`,
    SHA-256 `1da71d14c9c548831d72fc574b73456ff1a553f5a6e2e5d430fd101ffb39bb97`,
    records `phase: cleanup` with `destroyed: true`, `moduleReleased: true`,
    `initializedFalse: true`.

Implementation gates re-run after these changes: `tsc --noEmit` clean;
`vitest run` 215 passed / 1 skipped (converter tests excluded per plan);
`npm run lint` 0 errors; `npm run build` success; `git diff --check` clean.

Still open outside this repo/tree: the retained PDFHow Chromium cancellation
progress-state mismatch and the cold-start sample 1 failure (diagnosis only —
the cancellation assertion lives in PDFHow's `office-browser.playwright.ts`,
not in this repository), and merging the two guard workflows to default branch
`main` via a distinct remediation commit before any acceptance attempt 2.

### Independent remediation review 1 — Attempt 2 still ineligible

At `2026-08-10T13:03:05.602Z`, `killbus` independently reviewed TEAM B's
uncommitted post-rejection remediation. This review did not start Acceptance
Attempt 2 and did not rerun the retained Chromium failure or cold-start samples.

Confirmed remediation:

- the strict-semver executable oracle itself allows valid `v<semver>` tags and
  denies `vfoo.bar`, `v1.x`, `v1..2`, and `v1.2`;
- the verifier now documents required `--report-out`, keeps `--spec` and
  `--expected-candidate-id` optional, writes its report, and fails closed when
  the required output path is absent;
- the Node cleanup gap is closed for the reviewed successful execution. An
  independent rerun against the Attempt 1 downloaded-byte extraction passed
  positive, reuse, negative, recovery, ABI, and cleanup phases. Its result is
  `temp/2026-08-10-runtime-artifact-acceptance/acceptance-remediation-review/node-smoke-result.json`,
  SHA-256
  `9c70dcca89b0c95374afed2b9518cfd7c1860858066cc1c5e670761ce904d518`,
  with `destroyed`, `moduleReleased`, and `initializedFalse` all `true`;
- the archive and extracted runtime hashes were recomputed and match Attempt 1,
  binding that cleanup run to payload archive
  `e9aac8dde2fb627251155fc97651c2bd35bec63b01e39f882d342c024a87de9a`.

Independent validation passed: `npm run typecheck`; the planned
`vitest run --exclude "tests/*converter*.test.ts"` gate with 215 passed and 1
skipped; the two focused remediation files with 21 passed; `npm run lint` with
0 errors and 22 existing warnings; `npm run build`; and `git diff --check`.
An unfiltered Vitest invocation exceeded its 184-second command boundary, but
the task plan explicitly excludes `tests/*converter*.test.ts`; this timeout is
not treated as a remediation regression.

Two repository-local blockers remain:

1. In both `pages.yml` and `font-bundles.yml`, the first step executes
   `scripts/release-runtime/guard-release-tag.mjs` before `actions/checkout`.
   A clean-runner probe for valid tag `v2.7.3` therefore fails with
   `MODULE_NOT_FOUND`; the workflows do not preserve required semantic-package
   release behavior. Existing tests assert only that the guard text exists and
   do not assert checkout/guard execution order.
2. `stage-draft.mjs` documents `[--dry-run]` and declares it boolean, but omits
   it from `OPTIONAL_FLAGS`. Running the documented command without that flag
   fails with `Missing required option: --dry-run`. Existing parser tests do not
   cover an absent boolean option through this caller.

The external blockers are also unchanged: PDFHow still retains the
`converting` versus `finalizing` cancellation mismatch and failed cold-start
sample 1, while samples 2-5 remain intentionally unrun. GitHub `main` remains
at `df3f73c789e6d2abf71cbcd75186118d2bbc795a`; no remediation branch or PR
exists; release `367637128` remains the same unpublished five-asset draft.

Machine-readable review evidence:

- `acceptance/remediation-review-1.json`;
- SHA-256
  `991c5a869f92c36a674ec4c5d13a53dec06e75b23d1fda13dfbcc1a788872fc3`.

Decision: remediation is not ready. Attempt 2 remains `eligible: false` and
`started: false`. TEAM B retains implementation ownership; no release asset,
qualified manifest, native build, PDFHow file, or completion state was changed.

### Post-remediation readiness check 3 — announced handoff not received

At `2026-08-10T13:22:22.861Z`, acceptance intake resumed after a new TEAM B
report was announced. No report body, persisted handoff record, new task
evidence, distinct remediation commit, remote feature branch, or PR was present.
Local HEAD remained `0b2bf1654994db0dd524ce8f6ca32ab5dce7c348` with the
same uncommitted remediation reviewed previously.

The mandatory handoff described by PRD R5.1 and implementation section 6 is
therefore missing. Independent probes also reconfirmed both repository-local
failures:

- from a clean runner directory, valid semantic tag `v2.7.3` still fails with
  `MODULE_NOT_FOUND` because both workflows execute the repository-local guard
  before `actions/checkout`;
- the documented `stage-draft.mjs` invocation without `[--dry-run]` still fails
  with `Missing required option: --dry-run` because the boolean flag is not in
  `OPTIONAL_FLAGS`.

The focused workflow/CLI test files still report 21 passed tests. That green
result is insufficient for admission because both direct execution probes fail;
the tests do not cover workflow checkout order or the absent boolean through
the real `stage-draft.mjs` caller.

PDFHow remains at `a307a616b8f39a86c268b322bcd73bb93d229576`; the three
reviewed cancellation-path files are unchanged, including the `converting`
assertion and subsequent `finalizing` progress update. GitHub `main` remains at
`df3f73c789e6d2abf71cbcd75186118d2bbc795a`, the feature branch returns 404,
the PR query is empty, release `367637128` remains the unchanged unpublished
five-asset draft, and Build WASM run `31211473147` remains newest.

Machine-readable readiness evidence:

- `acceptance/readiness-check-3.json`;
- SHA-256
  `b2f65181e21a0285bf74f51f1053d90e0a6bfb2f0c2ed13fcce34b6ffbd85206`.

Decision: the handoff is incomplete and Acceptance Attempt 2 was not admitted.
No Chromium/cold-start retry, native build, release mutation, qualified
manifest, PDFHow edit, implementation commit, or completion-state change was
performed by the acceptance owner.

### TEAM B remediation implementation handoff — 2026-08-10 22:34 +08:00

The user authorized the current operator to finish the remaining implementation
work. Because this operator has now changed implementation code, it is no longer
eligible to own Acceptance Attempt 2. A different independent acceptance owner
must be assigned before that attempt is admitted. The task remains
status: `in_progress`, assigned to `team-b`; no completion or acceptance box is
advanced by this handoff.

The two repository-local defects identified by independent remediation review 1
are now closed in the uncommitted runtime working tree:

- .github/workflows/pages.yml and .github/workflows/font-bundles.yml now
  check out the repository before invoking the repository-local release-tag
  guard;
- scripts/release-runtime/stage-draft.mjs now treats the documented
  --dry-run boolean as optional;
- `tests/release-runtime/workflow-guard.test.ts` now asserts checkout-before-guard
  order and executes the copied guard from a clean temporary runner using valid
  tag `v2.7.3`;
- `tests/release-runtime/cli-contract.test.ts` now invokes the real
  stage-draft.mjs process with all mandatory options but no --dry-run, and
  asserts dryRun: false without a missing-option failure.

Runtime-repository validation for this exact working tree passed:

- focused release-runtime tests: 23 passed;
- planned full Vitest gate: 217 passed and 1 skipped;
- pnpm typecheck: passed;
- pnpm lint: 0 errors and 22 pre-existing warnings;
- pnpm build: passed;
- Trellis task validation and git diff --check: passed.

During the final pre-commit rerun, the combined validation shell completed
type-check, all 217 planned tests (1 skipped), and lint, then one concurrent
`tsup` process exited with Windows status `3221226356` (`0xC0000374`) after
partial build output. An immediate isolated `pnpm build` rerun, without any code
change, completed all ESM/CJS/IIFE/declaration outputs successfully. The
transient process failure is retained here rather than hidden as a clean first
attempt.

After the handoff review, the two non-blocking Node helper follow-ups were also
closed before commit. `node-smoke-gate.cjs` now destroys the converter from a
`finally` block after intermediate failures, fails when the unsupported-format
case unexpectedly succeeds, and fails when a required ABI export is absent.
The hardened helper was rerun against the retained Attempt 1 downloaded-byte
extraction without starting Chromium or Acceptance Attempt 2. It passed the
positive, reuse, negative, recovery, ABI, and cleanup phases; cleanup recorded
`destroyed`, `moduleReleased`, and `initializedFalse` as `true`. The persisted
result is `research/node-smoke-result.post-hardening.json`, SHA-256
`b925c50209cb87cb12751bde002c9cd9aafa633106e9a49c8a6b888c55944dce`.

The PDFHow cancellation mismatch was traced to a synchronous progress callback
race. OfficeConversionRuntime rejected and detached the active engine when its
consumer aborted on converting, but the engine continued and later published
`finalizing`, overwriting the browser gate's retained progress. The uncommitted
PDFHow remediation is limited to:

- `app/lib/office-conversion/runtime/office-conversion-runtime.ts`, which wraps
  every forwarded engine progress event with active-operation assertions both
  before and after invoking the consumer listener;
- `app/lib/office-conversion/runtime/office-conversion-runtime.test.ts`, which
  aborts synchronously on converting and verifies a CANCELLED result, exactly
  `checking-capabilities` then `converting`, no late `finalizing`, and one engine
  disposal.

PDFHow validation passed for the focused runtime test (11 of 11) and targeted
Biome check. A no-emit TypeScript run remains globally red because of unrelated
existing i18n and route-type errors in the dirty PDFHow worktree; filtering that
same compiler output found no diagnostic for either changed runtime file. No
type escape, generated file, or unrelated PDFHow file was changed.

The retained Attempt 1 trace also changes the interpretation of the cold-start
blocker without changing its rejected status. Sample 1 successfully advanced
through the initial, pinned-fixture, and profile-restart conversions, then failed
at the later cancellation assertion (office-browser.playwright.ts:501). Its
Playwright trace records context close and Worker Cleanup completion at about
202 seconds. The recorded 604.1-second exit-124 condition therefore occurred at
the outer command boundary after the browser test worker cleaned up; it is not
evidence of a LibreOffice cold-initialization timeout. Because the assertion
short-circuited the test before its explicit recovery and gate.dispose() path,
the progress fix should allow that normal teardown path to run, but this remains
an implementation hypothesis until a distinct independent retry-free gate.

This is a persisted implementation handoff, not an acceptance-admission record.
The following conditions still block Attempt 2:

1. Commit the runtime remediation as a distinct implementation commit and merge
   the two guarded workflows to default branch main.
2. Commit or otherwise materialize the PDFHow runtime fix for the independent
   acceptance checkout without including unrelated PDFHow worktree changes.
3. Assign a new independent acceptance owner, who must run the full Chromium
   candidate gate and five fresh-browser samples without retries, preserving any
   new failure.
4. Keep release `367637128` draft and `releaseQualified: false`; do not replace
   assets, publish, trigger a native build, or start Attempt 2 beforehand.
