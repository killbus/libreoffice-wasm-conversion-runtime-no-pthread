# Release-trigger preflight

Captured: 2026-08-10 (Asia/Shanghai)

Repository baseline at research time:

```text
main @ df3f73c789e6d2abf71cbcd75186118d2bbc795a
```

## Current release paths

### `.github/workflows/publish.yml`

The workflow named `Release` runs on pushes to `main` and successful `CI`
workflow runs for `main`. It:

1. checks out Git LFS;
2. installs dependencies;
3. type-checks, lints, and builds TypeScript;
4. runs Vitest while excluding `tests/*converter*.test.ts`;
5. runs semantic-release.

It does not download GHA run `31211473147`, verify the frozen candidate hashes,
assemble the eight runtime files, or promote this native artifact. Therefore a
successful semantic release is not publication evidence for candidate
`21fcdf...`.

### `.github/workflows/pages.yml`

The workflow named `Deploy WASM to GitHub Pages` runs on:

```yaml
on:
  release:
    types: [published]
  workflow_dispatch:
```

There is no tag or release-kind guard. Its build job checks out the repository
with LFS, runs the wrapper build, copies tracked `dist/` and `wasm/` into a Pages
artifact, and deploys it.

The tracked LFS WASM is not the frozen `21fcdf...` native candidate. Publishing
a dedicated runtime-artifact release under the current workflow would therefore
trigger a Pages deployment assembled from different/older tracked bytes. This
would create a mixed or falsely associated release state even if the dedicated
GitHub Release assets themselves were correct.

### `.github/workflows/font-bundles.yml`

The workflow named `Font Bundles` also runs for every published release plus
manual dispatch. For release events it uses the event's tag and uploads each
font ZIP with:

```text
gh release upload "$TAG" "$zip" --clobber
```

A dedicated runtime-artifact release would therefore trigger unrelated font
builds and mutating uploads into that release. This is incompatible with a
minimal content-addressed runtime asset inventory.

## Required release namespace

Use disjoint tag kinds:

```text
semantic package: v<semver>
runtime artifact: runtime-artifact-<full-candidate-id>
```

The runtime tag for this task is expected to be:

```text
runtime-artifact-21fcdfd7e9f49efc08c6ba56c13337cc0be59a9b496f5424adbe57e0fb4a6e7b
```

A mutable generic tag such as `runtime-latest` is not an identity and must not
be used as the release anchor.

## Guard requirements

Before publishing the runtime release:

1. Pages and font jobs must explicitly allow deliberate manual dispatch.
2. For `release.published`, they must allow only valid semantic-package tags and
   deny `runtime-artifact-*`, empty, and malformed tags.
3. The decision must be executable/tested rather than inferred only from YAML
   text.
4. The guard changes must be merged to the default branch before the release is
   published. GitHub release-event workflows use the default-branch workflow
   definition; a guard only on TEAM B's feature branch is not sufficient.
5. The runtime staging/finalization path must never call the existing font
   `--clobber` behavior or any equivalent replacement upload.

Minimum decision matrix:

| Event | Tag/input | Expected Pages/font release job |
|---|---|---|
| `release.published` | `v2.7.3` | allowed |
| `release.published` | `runtime-artifact-21fc...` | denied/skipped |
| `release.published` | empty or malformed | denied/skipped |
| `workflow_dispatch` | valid explicit operator input | allowed |

## Draft versus published behavior

A draft release is the correct acceptance transport because `published` jobs
must not run while TEAM B is still staging unqualified bytes. TEAM B must record
whether the selected GitHub API/CLI creates a Git tag at draft creation or only
at publication instead of assuming that behavior.

The finalization design must ensure:

- draft assets are downloaded and accepted before the public transition;
- existing accepted assets are not deleted/reuploaded;
- the final tag/target/manifest binding is stable;
- `RELEASE-MANIFEST.json` does not claim qualification before the acceptance
  receipt exists;
- after publication, Pages/font jobs are demonstrably skipped/absent for the
  runtime tag.

## Immutability constraint

Current workflows do not by themselves prove that release assets cannot be
replaced. TEAM B must investigate the repository's actual GitHub immutable
release and tag/ruleset capabilities.

Acceptable outcomes are:

1. enable/use a platform immutable-release mechanism and prove compatibility
   with existing semantic release behavior; or
2. anchor the final content-addressed manifest digest in a protected Git
   tag/commit and provide a verifier that rejects changed release bytes under
   the same candidate/tag.

The fallback must be described as fail-closed verification, not as a claim that
an administrator cannot edit a release page.

## No-build audit

This task has no reason to dispatch a LibreOffice/WASM build. Publication should
consume the exact existing run artifact and wrapper bytes, verify them, and
stop on mismatch. Acceptance must inspect GitHub run history and TEAM B's
staging logs to prove no new native build was triggered as an attempted repair.
