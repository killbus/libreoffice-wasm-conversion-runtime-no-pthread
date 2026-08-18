# Conversion-only public surface

## Goal

Make the public TypeScript and runtime surface no broader than the conversion-only WASM ABI.

## Requirements

- Freeze an exact conversion-only capability/export allowlist before deletion.
- Remove or separately route public editor/render/interaction/callback APIs that
  depend on the 44 missing WASM shims.
- Never return `0`, empty arrays, `null`, or no-op success for an absent capability.
- If compatibility is required, expose it only through a documented full-artifact
  entry point with a distinct type; do not widen the conversion-only artifact.
- Preserve conversion, lifecycle, supported image-export, and required loading APIs.

## Acceptance Criteria

- [ ] Packed declaration and JavaScript exports exactly match the reviewed allowlist.
- [ ] Every retained capability imports, compiles, and runs against the shipped ABI.
- [ ] Every removed capability fails a consumer compilation test or resolves only
      through the explicit full-artifact compatibility entry point.
- [ ] Conversion smoke tests cover DOCX→PDF, XLSX→CSV, PPTX→PDF, and retained image export.

## Notes

- This is the intentionally breaking child and requires explicit allowlist review.
- Do not mix native shim restoration or pthread changes into this child.
