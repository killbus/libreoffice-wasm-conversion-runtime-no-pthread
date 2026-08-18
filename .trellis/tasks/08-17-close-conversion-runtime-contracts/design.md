# Design: close conversion runtime contracts

## Product boundary

The target is a conversion-only runtime, not a drop-in full LibreOfficeKit
workstation. Its public promise is derived from the shipped artifact:

```text
public API <= shipped ABI
singular conversion cardinality = 1
wrapper pthread default = glue profile = manifest profile = package inventory
```

The current artifact exports 52 symbols versus upstream's 94. It intentionally
removes 44 editor/render/interaction symbols and adds the native conversion
transaction. Restoring the removed surface would select a different product.

## Task boundaries

- CSV child owns filter-option cardinality and exact output-path semantics.
- Pthread child owns runtime paths, browser asset inventory, release schemas,
  and cross-layer profile tests.
- Public-surface child owns package entry points, types, implementation reachability,
  migration, and the exact capability allowlist.
- Qualification child owns rebuild, content identity, immutable release records,
  and downloaded-byte acceptance.

Changes crossing these boundaries require an explicit dependency recorded in
both affected child plans. The children are implemented serially so one failing
contract cannot be hidden by a later change.

## Ordering decision

Start with CSV because it is a fully specified, user-visible correctness defect
and can be repaired without choosing the future public API shape. Pthread must
land before any successor candidate is frozen. Public-surface removal follows a
reviewed allowlist because it is the only intentionally breaking change. The
successor is rebuilt and qualified once, after all wrapper changes are final.

## Compatibility and rollback

Each child is a separate review/commit boundary. Before successor qualification,
any child can be reverted independently. After publication, an existing
candidate is never changed; rollback means publishing another successor.
