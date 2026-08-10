// Executable release-trigger decision mirror (design.md §6, prd.md R4).
//
// This is the semantic oracle the pages/font job-level `if:` conditions are
// kept aligned with. Because GitHub expressions cannot express a regex, the
// guaranteed enforcement happens in two places:
//
//   1. a job-level `if:` structural gate (dispatch always allowed; release
//      only for tags that start with "v", contain a ".", and do not include
//      the runtime namespace); and
//   2. a fail-closed first job step that runs the exact same oracle below via
//      `guard-release-tag.mjs`, so any tag the oracle denies (including
//      malformed tags that pass the structural `if:`) fails the job before it
//      can reach build/deploy/`--clobber` upload side effects.
//
// allowed  : explicit `workflow_dispatch` (operator intent)
//          : `release.published` tag matching strict semver `v<major>.<minor>.<patch>`
//            (optionally a `-prerelease` identifier or `+build` metadata)
//          : tag must NOT contain the `runtime` namespace
// denied   : `runtime-artifact-*`, `runtime-latest`, empty/missing tags,
//            non-`v` tags, and any malformed tag such as `vfoo.bar`, `v1.x`,
//            `v1..2`, `v1.2`, `v2.7.3bad` (the acceptance probe matrix).

// Strict SemVer 2.0.0 core + optional prerelease/build, prefixed with "v"
// (semver.org regex adapted: leading "v" required by this repository's tags).
export const STRICT_SEMANTIC_PACKAGE_TAG_PATTERN =
  /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/

export function shouldRunSemanticPackageJobs({ eventName, tag }) {
  if (eventName === 'workflow_dispatch') {
    return true
  }
  if (eventName !== 'release') {
    return false
  }
  if (typeof tag !== 'string' || tag.length === 0) {
    return false
  }
  if (tag.includes('runtime')) {
    return false
  }
  return STRICT_SEMANTIC_PACKAGE_TAG_PATTERN.test(tag)
}

// The structural GitHub expression embedded in pages.yml / font-bundles.yml.
// Kept here so the coarse job-level `if:` can be asserted against the
// checked-in workflow files. Strictness is enforced by guard-release-tag.mjs,
// which runs the oracle above as the first fail-closed job step.
export const SEMANTIC_PACKAGE_RELEASE_GUARD_EXPRESSION =
  "github.event_name == 'workflow_dispatch' || (github.event_name == 'release' && startsWith(github.event.release.tag_name, 'v') && contains(github.event.release.tag_name, '.') && !contains(github.event.release.tag_name, 'runtime'))"