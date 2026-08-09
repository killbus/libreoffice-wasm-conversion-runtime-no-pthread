// Executable release-trigger decision mirror (design.md §6, prd.md R4).
//
// This is the semantic oracle the pages/font job-level `if:` conditions are
// kept aligned with (they cannot express regex, so both sides use the same
// structural checks): manual dispatch always allowed; release.published
// allowed only for semantic-package tags (starts with "v", contains a ".",
// and does not include the runtime namespace).

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
  if (!tag.startsWith('v')) {
    return false
  }
  if (!tag.includes('.')) {
    return false
  }
  if (tag.includes('runtime')) {
    return false
  }
  return true
}

// The exact GitHub expression embedded in pages.yml / font-bundles.yml. Kept
// here so the guard can be asserted against the checked-in workflow files.
export const SEMANTIC_PACKAGE_RELEASE_GUARD_EXPRESSION =
  "github.event_name == 'workflow_dispatch' || (github.event_name == 'release' && startsWith(github.event.release.tag_name, 'v') && contains(github.event.release.tag_name, '.') && !contains(github.event.release.tag_name, 'runtime'))"