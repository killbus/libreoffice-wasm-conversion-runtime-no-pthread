# Grounded CSV source facts

## Compared revisions

- Upstream wrapper: `b72a3d584bc28c5111afafcf25def7a24fb5fcb0`
- Current base: `5e8322ee7bdc4a8c81f9c0c0de0a4fb7157aedf2`
- LibreOffice 24.8 clone HEAD:
  `d1c9e0e4e1ddeb24fe8f93e56860b3765043f8b1`

## LibreOffice semantics

`sc/source/ui/dbgui/imoptdlg.cxx` reads zero-based token 11 from CSV export
FilterOptions:

- `-1`: export all sheets;
- `0` or empty: normal single output;
- positive integer: selected sheet, still using the suffixed-file branch.

`sc/source/ui/docshell/docsh.cxx` treats any non-zero value as a multi-file
branch and writes `<base>-<sheet>.<ext>`. The zero branch writes the requested
stream and exports `GetSaveTab()`; without a view the save tab falls back to tab
zero.

## Wrapper mismatch

- `src/types.ts` defines a singular `ConversionResult` and currently defaults
  CSV token 11 to `-1`.
- Direct converters request `/tmp/output/doc.csv` and read only that exact path.
- `src/native-conversion-bridge.ts` passes string FilterOptions unchanged and
  the native result schema contains no output manifest.
- Native `ok: true` proves the store transaction completed, not that the exact
  requested VFS path exists.

## Decision

The singular API uses token zero and rejects every explicit non-zero or invalid
sheet token before native execution. Directory scanning is permitted only for
transaction cleanup, never for selecting a successful result. All-sheet export
requires a future, separately specified multi-result API and native manifest.
