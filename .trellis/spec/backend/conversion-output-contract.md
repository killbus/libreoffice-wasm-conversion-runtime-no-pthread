# Conversion Output Contract

> Freshness, ownership, cleanup, and failure rules for singular conversion results.

---

## Singular Result Boundary

A singular conversion succeeds only when the exact requested output path exists
and contains a non-empty `Uint8Array`. Directory scanning, basename guessing,
and accepting a sibling output are not success mechanisms.

CSV export is singular. Its effective filter-option token 11 must be absent,
empty, or `0`; every other explicit value is rejected as invalid input before
native execution. The built-in CSV default uses `0`.

## Freshness Before Native Execution

Before a CSV conversion starts, the owner must:

1. enumerate the exact output directory;
2. remove a stale exact output when present; and
3. enumerate again to prove that the stale exact output is absent.

Failure or uncertainty at any step is a transaction failure. Bytes at the exact
path may be read only after this freshness precondition has been established and
the current native conversion has reported success.

## Transaction-Owned Cleanup

Cleanup owns only:

- the current input path;
- the exact requested output path; and
- new CSV siblings matching the current fixed output stem, such as
  `doc-*.csv`, that were not present in the pre-transaction baseline.

Pre-existing siblings and unrelated directory entries must not be removed.
Cleanup must attempt all owned paths, enumerate afterward, and prove that no
owned path remains. The same cleanup rules apply after success and failure.

## Cleanup Uncertainty and Quarantine

Enumeration, unlink, or absence-proof failure is cleanup uncertainty. A result
must never be returned when cleanup is uncertain, including when native
conversion and exact-output reading otherwise succeeded.

The direct runtime is quarantined on cleanup uncertainty. Worker and subprocess
owners must discard the quarantined runtime and use a fresh owner for a later
request; a poisoned subprocess must not retry the request internally.

## Primary Failure Preservation

When conversion and cleanup both fail:

- an `Error` primary failure remains the thrown object and receives the cleanup
  uncertainty as non-enumerable diagnostic context; and
- a non-`Error` primary throw is retained as `primaryFailure` on the cleanup
  uncertainty error.

Cleanup diagnostics must not replace or erase the primary conversion cause.

## Forbidden Patterns

- Returning a CSV sibling when the exact requested output is missing.
- Reading an exact output without proving it was absent before native execution.
- Swallowing CSV enumeration or unlink failures as best-effort cleanup.
- Returning success and quarantining only for a later request.
- Deleting pre-existing or unrelated output-directory entries.
- Allowing public, worker, subprocess, or native request paths to bypass the
  shared singular CSV option validator.

## Verification Expectations

Tests must cover the public and native validation boundaries, stale exact
outputs, missing or empty exact outputs, new sibling cleanup, every enumeration
and unlink uncertainty boundary, owner quarantine propagation, and both `Error`
and non-`Error` primary failures. A qualified successor runtime must also run a
real multi-sheet spreadsheet-to-CSV gate and prove that exactly one requested
CSV artifact is returned and transaction-owned paths are clean.
