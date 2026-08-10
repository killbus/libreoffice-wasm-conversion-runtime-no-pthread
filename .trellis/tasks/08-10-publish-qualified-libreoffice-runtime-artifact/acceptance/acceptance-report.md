# Independent acceptance attempt 1 — REJECTED

Acceptance owner: `killbus`

Receipt generated: `2026-08-10T07:38:41.340Z`

## Bound identity

| Field | Accepted input |
|---|---|
| Draft release | `367637128` |
| Draft URL | `https://github.com/killbus/libreoffice-wasm-conversion-runtime/releases/tag/untagged-dc0c60d518acc26b2117` |
| Tag | `runtime-artifact-21fcdfd7e9f49efc08c6ba56c13337cc0be59a9b496f5424adbe57e0fb4a6e7b` |
| Target | `df3f73c789e6d2abf71cbcd75186118d2bbc795a` |
| Candidate | `21fcdfd7e9f49efc08c6ba56c13337cc0be59a9b496f5424adbe57e0fb4a6e7b` |
| Payload ZIP | `248934231` bytes |
| Payload SHA-256 | `e9aac8dde2fb627251155fc97651c2bd35bec63b01e39f882d342c024a87de9a` |

## Decision

Qualification is rejected. Release `367637128` must remain draft and
unqualified. This receipt does not authorize a final manifest, publication,
asset replacement, native build, Pages deployment, font upload, npm release,
or PDFHow production cutover.

| Gate | Result | Evidence |
|---|---|---|
| GitHub draft identity and five-asset inventory | PASS | GitHub API and independent download agree |
| Archive preflight, safe extraction, eight runtime files, identity, ABI, pthread mode, hashes | PASS | Independent verifier report |
| Downloaded-byte Node smoke, reuse, negative, recovery, ABI | PARTIAL | Functional checks pass; explicit converter cleanup was not recorded |
| PDFHow full retry-free Chromium candidate gate | FAIL | Cancellation progress assertion failed; command boundary timed out |
| Five consecutive fresh-browser samples | FAIL | Sample 1 failed; samples 2-5 intentionally not run |
| Strict semantic-release workflow isolation | FAIL | Guards absent from `main`; feature guard accepts malformed tags |
| No newer native build | PASS | `31211473147` remains newest Build WASM run |
| Verifier CLI contract | FAIL | Documented optional arguments are implemented as required |
| Draft/unqualified state retained | PASS | GitHub draft plus `releaseQualified: false` metadata |

## Blocking evidence

### Chromium candidate gate

The acceptance command used only the downloaded candidate bytes materialized in
PDFHow's ignored local-candidate root:

```powershell
$env:CI=$null
$env:OFFICE_RUNTIME_ROOT='D:\Repositories\pdfhow.com-next\third_party\libreoffice-wasm-conversion-runtime-dev'
$env:OFFICE_BROWSER_DOCX_FIXTURE='D:\tmp\lo-post-baseline-trim-wip\test.docx'
pnpm exec playwright test tests/office-conversion/office-browser.playwright.ts --config playwright.config.ts --reporter=line
```

The fixed fixture is `6693403` bytes with SHA-256
`a78495545ae41486aa61c9a0e8c4c78f6491a8e7b3cfacbd4185ed0f124f59df`.

Playwright's test-level trace records a deterministic assertion failure after
approximately `193873` ms:

- test: `validates conversion, recovery, assets, and teardown in local-candidate mode`;
- source: `tests/office-conversion/office-browser.playwright.ts:501:58`;
- expected `lastProgress.phase`: `converting`;
- received `lastProgress.phase`: `finalizing`;
- snapshot: `lastErrorCode=CANCELLED`, `conversions=6`, `cancellations=1`,
  `disposals=0`.

The test trace shows cleanup finishing around `195627` ms, but the outer command
did not return and the harness terminated it after `604.1` seconds with exit code
`124`. No acceptance retry was performed. The same failed execution is cold-start
sample 1; samples 2-5 were not run because the specification requires rejection
on the first failure or timeout.

No matching PDFHow/Playwright process and no listener on port `5174` remained
when the scene was inspected. Diagnostics were copied before any other browser
run to:

`D:\tmp\lo-runtime-acceptance-367637128-20260810-1251\browser-gate-failure`

| Retained file | SHA-256 |
|---|---|
| `.last-run.json` | `3a3dd27f4427ddfee447e94522f127b3f0c550b8148d46910c9fe62d23df6e41` |
| `error-context.md` | `f4a85a7e69efc7d3eff30a9b981a04c2e68cb22bb629552829ab3f4de1928c25` |
| `trace.zip` | `38982a380479a47be96928691f67079e54704e86dcc07b0496f2983ccb241de0` |
| `video.webm` | `43efdda9bffe7017d326211cb817e45c8dc9598b8f96ade180d60336bfe878fa` |

### Release-trigger isolation

GitHub reports `main` at
`df3f73c789e6d2abf71cbcd75186118d2bbc795a`. The workflow blobs on that
default-branch commit are the pre-guard versions:

- `.github/workflows/pages.yml`: `73d4a5182ccc3301791fe26c997a352a2548f6cd`;
- `.github/workflows/font-bundles.yml`: `eef16a2804ed592c58a57c257e9627034b3c1397`.

Therefore the required guards are not on the default branch. Independently, the
feature-branch decision function and matching workflow expression only require a
tag to start with `v`, contain `.`, and omit `runtime`. The executable probe
incorrectly returned `allowed: true` for all of these malformed tags:

- `vfoo.bar`;
- `v1.x`;
- `v1..2`;
- `v1.2`.

This does not satisfy the strict `v<semver>` allow-list required by the design.

### Verifier CLI contract

`verify.mjs --help` marks `--spec` and `--expected-candidate-id` optional and
does not list `--report-out`. `parseOptions` instead treats every member of
`FLAGS` as required. Supplying all documented arguments but omitting the
undocumented report option exits `1` with:

```text
Missing required option: --report-out
```

The archive verifier itself passed after supplying all five arguments, so this
is a tooling-contract defect rather than an archive-integrity failure.

## Passing evidence

- GitHub API still reports release `367637128` as `draft: true`,
  `published_at: null`, with the expected five asset IDs, lengths, and digests.
- Independent safe extraction reproduced candidate ID, archive hash, candidate
  manifest hash, eight exact runtime paths, ABI `lok-convert-document-v1`, and
  `main-script` pthread mode with external worker `null`.
- The independent Node gate produced `%PDF-` for positive, reuse, and recovery
  conversions and rejected its negative case. Its result file SHA-256 is
  `4ee7a3a398aa2432074715da19366a2152420c31c88c2b940cfdb42af1bbf0f5`.
- GitHub Actions workflow `325462492` (`Build WASM`) still has run
  `31211473147` as its newest run; no build was triggered by staging or
  acceptance.
- PDFHow local-candidate metadata remains bound to the exact candidate with
  `releaseQualified: false`.

## TEAM B remediation

1. Preserve this rejected receipt and failed sample; diagnose both the
   cancellation progress-state mismatch and the post-test command hang.
2. Implement a strict semantic-version allow-list for release events and merge
   both harmless guard paths to the default branch before publication.
3. Align verifier option parsing with the documented optional arguments and add
   `--report-out` to help.
4. Add explicit Node converter cleanup evidence or bind that requirement to an
   existing exact-byte gate.
5. Keep the current draft and payload unqualified. A later acceptance must be a
   distinct attempt that retains this failure; it must not be represented as a
   retry-erased green run.

Machine-readable records:

- `acceptance/acceptance-receipt.rejected.json`;
- `acceptance/acceptance-evidence.json`.
