# Implementation plan: official hidden native conversion bridge

## Preconditions

- [x] Work in `D:/tmp/lo-native-bridge-7c1d42e`.
- [x] Confirm branch `feature/official-hidden-native-bridge` is at exact base
      `7c1d42e9c603ad4b0f371762c2689b4fdca51493`.
- [x] Leave the dirty `main` worktree untouched.
- [x] Record the verified baseline artifact and official CLI probe evidence.
- [x] Start this Trellis task only after the PRD convergence pass.

## 1. Create the native patch atom

- [x] Create a pristine worktree from pinned LibreOffice revision
      `d1c9e0e4e1ddeb24fe8f93e56860b3765043f8b1`; do not modify the existing
      diagnostic worktree at `D:/tmp/lo-core-24-8`.
- [x] Apply the two baseline conversion-only patch atoms in build order.
- [x] Implement the private JSON C ABI in `desktop/source/lib/init.cxx`.
- [x] Export `_lok_convertDocument` and `_lok_convertFree` in the WASM link
      configuration while retaining legacy exports.
- [x] Add the minimal native hidden/visible diagnostic evidence needed by the
      first artifact gate.
- [x] Generate `build/patches/wasm-native-conversion-bridge.patch` as an
      independent patch.
- [x] Add its conditional application to `build/build-wasm.sh` after the
      baseline atoms.

## 2. Add the shared bridge contract and binding

- [x] Search existing mappings, UTF-8/pointer helpers, and error conventions
      before adding helpers.
- [x] Add versioned request/result types and one decoder from `unknown`.
- [x] Add one explicit filter-resolution source of truth, including
      DOCX -> `writer_pdf_Export` for PDF output.
- [x] Extend the Emscripten module type with both private bridge exports.
- [x] Add a `lok-bindings.ts` wrapper that guarantees native and Emscripten
      allocations are freed on all paths.
- [x] Surface cleanup state and runtime-reusability without exposing native
      document pointers.

## 3. Migrate basic conversion only

- [x] Switch `converter-node.ts` basic conversion to the shared bridge.
- [x] Switch `converter.ts` basic conversion to the shared bridge.
- [x] Switch the non-image basic branch in `browser.worker.ts` to the bridge.
- [x] Ensure `subprocess.worker.cts` and`node.worker.ts` inherit the Node
      bridge through `LibreOfficeConverter.convert()`.
- [x] Leave editor/render/preview/multi-page-image pointer flows unchanged.
- [x] Enforce runtime quarantine/termination after `cleanup=uncertain`.

## 4. Add inexpensive tests and checks

- [x] Unit-test request encoding, centralized result decoding, schema rejection,
      explicit filter selection, and all allocation/free paths.
- [x] Mock bridge success and each stable failure stage.
- [x] Assert an uncertain cleanup makes the runtime non-reusable.
- [x] Assert basic conversion never calls `documentLoad*`, `documentSaveAs`, or
      `documentDestroy`.
- [x] Add source/build structural checks for ABI exports, CLI-equivalent hidden
      properties, cleanup fallback, patch ordering, and absence of later trims.
- [x] Dry-run patch apply and reverse against the pristine pinned source.
- [x] Run repository formatting/lint/type-check/unit/build gates that do not
      compile LibreOffice WASM.

## 5. Prepare the single expensive build

- [x] Review the exact diff and record the branch/base/patch hashes.
- [x] Confirm every inexpensive gate is green.
- [x] Trigger each reviewed `build-wasm.yml` attempt only after inexpensive gates are green.
- [x] Download the artifact to a dedicated `D:/tmp` directory and record its
      SHA-256 hashes.
- [x] Verify `_lok_convertDocument` and `_lok_convertFree` exports.
- [x] Run `test.docx` -> PDF and assert `%PDF-`, non-empty output,
      `ok=true`, `stage=complete`, `cleanup=clean`, and hidden-path evidence.
- [x] Run a second conversion in the same Worker/process.
- [x] Run malformed-request and load/password-failure negative gates.
- [x] Store fresh-artifact gate scripts and machine-readable results beside the
      artifact.

## Validation commands

Commands will be finalized against repository scripts before execution. The
expected inexpensive gate set is:

```powershell
git diff --check
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm exec vitest run --exclude 'tests/*converter*.test.ts'
pnpm build
```

Patch verification will use `git apply --check` and
`git apply --reverse --check` in the pristine pinned LibreOffice worktree.

## Local gate record (2026-08-07)

- Runtime branch: `feature/official-hidden-native-bridge`.
- Runtime base/HEAD before commit:
  `7c1d42e9c603ad4b0f371762c2689b4fdca51493`.
- Pinned LibreOffice source:
  `d1c9e0e4e1ddeb24fe8f93e56860b3765043f8b1`.
- Bridge patch SHA-256:
  `822E4AF2AD282D13646F4F46B408B4306254AA91FE6B00573AF9B36CD1523129`.
- Patch scope: 4 files, 992 insertions, 1 deletion.
- `git diff --check`: passed in both runtime and LibreOffice worktrees.
- Patch forward check against the baseline-only LibreOffice index: passed.
- Patch reverse check against the bridge-applied LibreOffice worktree: passed.
- Directed bridge suite: 6 files passed, 52 tests passed.
- CI-equivalent non-artifact suite: 15 files passed, 140 tests passed,
  1 skipped.
- `pnpm install --frozen-lockfile`: passed.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed with 0 errors and 22 warnings.
- `pnpm build`: passed.
- `pnpm-lock.yaml` was minimized to synchronize only the pre-existing `jszip`
  dev dependency; unrelated pnpm 11 libc/deprecation metadata churn was removed,
  and `pnpm install --frozen-lockfile` passed again.
- The checked-in baseline `wasm/` artifact does not export the new ABI, so
  fresh-artifact integration gates remain intentionally pending.

## First expensive build record (2026-08-07)

- The first workflow attempt was dispatched as
  [GHA 31177338506](https://github.com/killbus/libreoffice-wasm-conversion-runtime/actions/runs/31177338506).
- Dispatch head: `f27003112840b9d7858c1367e1f2e96e7f881973`.
- Inputs: `mode=conversion-only`, `clean_build=false`,
  `use_conversion_autogen=false`.
- Final status: `failure`; diagnosis and failed-artifact evidence are recorded
  below. The corrected retry is recorded in the second-build diagnosis.

## Patch-stack replay and first-build diagnosis (2026-08-07)

- The first expensive run [GHA 31177338506](https://github.com/killbus/libreoffice-wasm-conversion-runtime/actions/runs/31177338506) failed before compilation reached a native-bridge defect.
- The Actions cache restored LibreOffice source with the baseline patch and later conversion atoms already applied. The old whole-baseline reverse dry-run was invalidated because later atoms touched the same files; the script then reapplied the baseline and produced duplicate definitions. The first compiler error was `include/comphelper/lok.hxx: OperationType` multiple definition.
- The bridge patch itself applied successfully in that run. The failed artifact (`D:/tmp/lo-native-bridge-run-31177338506-artifact`, artifact `8993448347`, archive digest `sha256:63ea9ef08dffac7e81997953dc58cf2e474bcdb52a1ed7b96686598c13b2462c`) was the checked-in stale LFS WASM and did not contain `_lok_convertDocument` or `_lok_convertFree`.
- The fix adds `build/patch-stack.sh` with `applied`, `pending`, and `inconsistent` states; only a fully pending patch may be applied, with `--fuzz=0`. GNU patch reverse probes use `--force` so a failed reverse probe cannot cancel `-R` and misclassify pristine source. `RESET_PATCHED_SOURCE=1` resets tracked source and removes only exact patch-created paths while preserving ignored LibreOffice build outputs.
- The workflow now enables source reset and removes `wasm/soffice.*` before building, preventing an early failure from uploading stale checked-in artifacts.
- The corrected full-stack gate at `D:/tmp/lo-full-patch-stack-gate.sh` passed against pinned LibreOffice `d1c9e0e4e1ddeb24fe8f93e56860b3765043f8b1`: pristine stack checks, mixed-state fail-hard detection, reset preservation, and strict second replay all passed.

## Repair gate record (2026-08-07)

- Bash syntax checks passed for `build/build-wasm.sh` and
  `build/patch-stack.sh`.
- Directed native-bridge and patch-stack suite: 7 files, 56 tests passed.
- CI-equivalent non-artifact suite: 16 files, 144 tests passed, 1 skipped.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed with 0 errors and 22 existing warnings.
- `pnpm build`: passed.
- `git diff --check`: passed.
- Full four-patch apply, reset, and second replay against pinned LibreOffice:
  passed while preserving ignored `workdir/`.
- Reusable replay rules were captured in
  `.trellis/spec/backend/wasm-patch-stack.md`.

## Second expensive build diagnosis and bridge-header repair (2026-08-08)

- The corrected retry, GHA `31187837196`, replayed the normalized patch stack
  and reached compilation of the native bridge at runtime commit
  `b761aef5558469a47d5ca89d03e879e1dd16a41c`.
- Compilation failed in `desktop/source/lib/init.cxx` because the bridge used
  `comphelper::NamedValueCollection` without directly including its declaring
  header. This is a bridge patch dependency omission, not a conversion-runtime
  semantic failure or another patch-stack replay failure.
- `wasm-native-conversion-bridge.patch` now adds
  `<comphelper/namedvaluecollection.hxx>`, and the source-structure suite has a
  regression assertion for that direct include.
- Updated bridge patch SHA-256:
  `F4884155F7CE2242FFC3E56E19237DEEB8308A2BF0E60061E49C110536FB4F9F`.
- Directed native-bridge and patch-stack tests passed: 12 tests.
- CI-equivalent non-artifact suite passed: 16 files, 144 tests, 1 skipped.
- `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, and
  `pnpm build` passed; lint retained the 22 existing warnings and no errors.
- The complete four-patch apply/reset/strict-replay gate passed again against
  pinned LibreOffice `d1c9e0e4e1ddeb24fe8f93e56860b3765043f8b1`, preserving
  ignored `workdir/` outputs.
- At that point, a fresh expensive build remained required for artifact-level
  acceptance.

## Successful fresh-artifact gate record (2026-08-09)

- The repaired bridge compiled successfully in
  [GHA 31211473147](https://github.com/killbus/libreoffice-wasm-conversion-runtime/actions/runs/31211473147)
  at exact runtime HEAD
  `71d33678ed74872ebbb1bc37f5778143f8f5e401`.
- The bridge patch SHA-256 in that build was
  `F4884155F7CE2242FFC3E56E19237DEEB8308A2BF0E60061E49C110536FB4F9F`.
- The downloaded and extracted artifact is stored at
  `D:/tmp/lo-artifacts-08-08-31211473147`. The original workflow artifact
  inventory is:
  - `soffice-wasm-conversion-only-31211473147.zip`: 78,834,433 bytes,
    SHA-256
    `ff378040a97d5e8df32c0e221add55200bbaa33015213fa2225849822d558e3e`;
  - `soffice.wasm`: 148,022,311 bytes, SHA-256
    `b24a888550d27d2942ff9c8c9a84e20cd0c852db154e8558647cb9c5294ff291`;
  - `soffice.data`: 99,735,790 bytes, SHA-256
    `c4b8a92b566d4e0d4723d321ef926e1b9fbeb575d28cdd6466d27fd2c17c5514`;
  - `soffice.cjs`: 439,517 bytes, SHA-256
    `0c18483bdf23a83e9ab1d180fc8d3c850f6cd57a42e4e1cda545e25c512940a5`;
  - `soffice.js`: 439,517 bytes, SHA-256
    `0c18483bdf23a83e9ab1d180fc8d3c850f6cd57a42e4e1cda545e25c512940a5`.
- `loader.cjs` was copied beside the extracted files only so the Node probe
  resolves the artifact from its own directory. It is not an original workflow
  artifact; its SHA-256 is
  `7cebd863dcd071a5eb02bc26fa7701e7dc5c865d1e130e5595672e56a34934cf`.
- The raw WebAssembly export table exposes `lok_convertDocument` and
  `lok_convertFree`, while the Emscripten module exposes and successfully calls
  `_lok_convertDocument` and `_lok_convertFree`. The missing underscore in the
  raw table is Emscripten naming behavior, not a missing export.

### Positive gate

- Input `test.docx`: 6,693,403 bytes, SHA-256
  `a78495545ae41486aa61c9a0e8c4c78f6491a8e7b3cfacbd4185ed0f124f59df`.
- `gate/success.json`: 1,702 bytes, SHA-256
  `37132a98adddbd7fd2b19000d95b1112d38b4d005346a5f6b74a68202cfb1a28`.
- One initialized runtime, process PID `1580`, completed two consecutive
  DOCX-to-PDF conversions. Both outputs were 651,789 bytes and began with
  `%PDF-`:
  - `gate/test-first.pdf`: SHA-256
    `f1e549d62dcb2c964881832c453f40335e231d3d4eae07f4b5f247fe88345985`;
  - `gate/test-second.pdf`: SHA-256
    `67214893422978428602f7097ae57f564d843e00dca01df496b1432e71ba3e36`.
- Both native calls returned `ok=true`, `stage=complete`, `cleanup=clean`,
  `hiddenLoad=true`, and `visibleFrameSetupEntered=false`. This is native
  control-flow evidence that the official hidden path ran without entering
  visible-frame setup.

### Negative and recovery gate

- Reproducible runner `gate/run-negative-gate.cjs`: 17,724 bytes, SHA-256
  `cf04e26d8ff9048a8d6f698c27d8693f049c3575d73998cd0e70a37976280669`.
- Machine-readable result `gate/negative.json`: 11,424 bytes, SHA-256
  `1b4dbadd1db9289580057ea4cddb17edc600589aaf3f47b92b308ce07ad99442`.
  The final run used PID `10176`, reported `status=passed`, and exited `0`.
- Malformed JSON, unsupported `schemaVersion: 2`, and a missing `inputUrl`
  each returned a structured `validate/not-needed` failure. A missing input
  file returned a structured `load/not-needed` failure.
- The real encrypted fixture
  `gate/fixtures/Encrypted_MSO2007_abc.docx` is 18,432 bytes with SHA-256
  `ea105a1eb01653c904320ef9ab426686cc468b09503f617725c41cee2f6f549f`.
  Password `abc` completed through the hidden path and produced
  `gate/encrypted-correct.pdf` (6,385 bytes, `%PDF-`, SHA-256
  `ce9b29a160a9509e8f342fd847570c773d9ea2df3d7b45bc6b150534fd4eb1a0`);
  password `not-abc` returned a structured `load/not-needed` failure.
- After all safe failures, that same runtime successfully converted the valid
  DOCX again with `cleanup=clean`, `hiddenLoad=true`, and
  `visibleFrameSetupEntered=false`. `gate/valid-after-failures.pdf` is 651,789
  bytes with SHA-256
  `01a117aa9250421e5dffb28497bf93b1009a432c15ea1ad5347558e79468dc10`.
- Every bridge call returned ABI code `0`; no C++/WASM exception escaped.
  Native result allocations were released with `_lok_convertFree`, and request
  plus result-slot allocations were released with Emscripten `_free`. No
  `cleanup=uncertain` result was observed, and the runner rejects reuse if one
  is ever observed.
- The final non-WASM full-scope check passed again: 16 Vitest files with 144
  tests passed and 1 skipped; type-check passed; lint reported 0 errors and the
  same 22 existing warnings; package build, `git diff --check`, and Trellis task
  validation passed.
- Phase 3.3 found no additional spec change for artifact acceptance: the
  reusable cached-source replay rules already live in
  `.trellis/spec/backend/wasm-patch-stack.md`, while artifact hashes, process
  IDs, and gate outcomes are run-specific evidence retained in this task.
- No additional expensive WASM build was triggered after GHA `31211473147`;
  all positive, negative, password, ownership, and recovery checks reused this
  one successful artifact.

## Risk and rollback points

- ABI memory ownership: every result pointer must be freed by the matching
  native allocator; tests must force decode and call failures.
- UNO cleanup: a close exception must not bypass fallback disposal; uncertain
  cleanup must poison the runtime.
- Filter behavior: extension strings are not native filter names; unsupported
  pairs fail before native invocation.
- Scope leakage: raw LOK remains necessary for pointer-based features; migration
  is limited to basic conversion.
- Build cost: no workflow dispatch until all local evidence is reviewed.
- Rollback: remove the bridge call sites and the single bridge patch atom; do
  not alter or revert either validated baseline atom.
