# Successor runtime qualification

## Goal

Rebuild, assign a new candidate identity, and qualify the integrated successor only after contract repairs land.

## Requirements

- Depend on successful completion of the CSV, pthread, and public-surface children.
- Rebuild wrapper/native artifacts only after all source contracts are final.
- Derive a new content-addressed candidate identity; never reuse or mutate the
  existing frozen candidate, tag, release assets, or acceptance evidence.
- Run independent downloaded-byte Node and browser acceptance without retrying
  failed formal samples.

## Acceptance Criteria

- [ ] New hashes and candidate identity differ whenever source/runtime bytes differ.
- [ ] Old specification rejects new bytes and old release state is unchanged.
- [ ] Package inventory, ABI allowlist, CSV cardinality, pthread profile, lifecycle,
      and real-browser conversions pass from freshly downloaded bytes.
- [ ] Qualification receipt binds the exact successor release, payload, and hashes.

## Notes

- This child owns the only rebuild/refreeze step. Earlier children must not publish.
