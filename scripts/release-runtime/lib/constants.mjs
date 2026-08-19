// Frozen, deterministic naming and kind constants for the LibreOffice runtime
// publication pipeline. Keep this file free of developer-local paths and
// timestamps so it can never leak into a public manifest.

// Candidate identity contract. The canonical identity kind and schema version
// are kept byte-for-byte compatible with the original validating derivation so
// that deriving the identity from the frozen provenance/runtime/asset table
// reproduces the frozen candidate ID exactly
// (research/artifact-provenance.md).
export const CANDIDATE_IDENTITY_KIND = 'pdfhow-libreoffice-runtime-candidate'
export const CANDIDATE_IDENTITY_SCHEMA_VERSION = 1

// Distinct control-record kinds.
export const STAGING_REPORT_KIND = 'libreoffice-wasm-runtime-staging-report'
export const ACCEPTANCE_RECEIPT_KIND = 'libreoffice-wasm-runtime-acceptance-receipt'
export const RELEASE_MANIFEST_KIND = 'libreoffice-wasm-runtime-release-manifest'

export const CONTROL_SCHEMA_VERSION = 1

export const CANDIDATE_MANIFEST_FILE = 'CANDIDATE-MANIFEST.json'
export const ASSET_SHA256SUMS_FILE = 'ASSET-SHA256SUMS'
export const RELEASE_SHA256SUMS_FILE = 'SHA256SUMS'
export const STAGING_REPORT_FILE = 'STAGING-REPORT.json'
export const RELEASE_MANIFEST_FILE = 'RELEASE-MANIFEST.json'

export const RUNTIME_TAG_PREFIX = 'runtime-artifact-'

// Deterministic ZIP normalization (design.md §5):
// - single fixed DOS timestamp (1980-01-01 00:00:00) for every entry;
// - stored (method 0) entries only, so the archive does not depend on the
//   host zlib/deflate implementation;
// - no extra fields, no comment, no external-attribute host variation.
export const FIXED_DOS_TIME = 0x0000
export const FIXED_DOS_DATE = 0x0021 // 1980-01-01
export const ZIP_METHOD_STORE = 0

export const FORBIDDEN_WORKER_FILE = 'soffice.worker.js'

/** Reject the standalone pthread worker at any inventory depth. */
export function isForbiddenWorkerPath(path) {
  if (typeof path !== 'string') return false
  const segments = path.split(/[\\/]/)
  return segments.at(-1) === FORBIDDEN_WORKER_FILE
}
