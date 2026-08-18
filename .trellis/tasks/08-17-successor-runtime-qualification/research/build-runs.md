# Successor build runs

## Run 32145696172

- Source: `a7fbf36d4dab4a0d1f88940a46b41ed6c1d75b58`
- Inputs: `conversion-only`, `clean_build=true`,
  `use_conversion_autogen=false`
- Result: failed before compilation in `Checkout (with LFS)`.
- Evidence: GitHub LFS batch API returned `This repository exceeded its LFS
  budget`; setup, dependency installation, JS build, native build, and
  conversion gate were never entered.
- Disposition: infrastructure-only attempt; no native candidate bytes exist.

The successor workflow now checks out without LFS because it deletes the
checked-in native assets before rebuilding them. Its subprocess-worker bundle
is built through the pure sequential JS builder, while package/prepack builds
continue to enforce the frozen native package gate.
