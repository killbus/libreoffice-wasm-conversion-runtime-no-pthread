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

## Run 32146386224

- Source: `0f583b66570bcecb9562220e0df1d823eb010362`
- Inputs: `conversion-only`, `clean_build=true`,
  `use_conversion_autogen=false`
- Checkout without LFS succeeded and npm dependency installation completed.
- Result: success. The clean native build ran from 14:25:19Z to 17:48:15Z;
  the freshly-built conversion gate, artifact upload, and job cleanup all
  completed successfully.
- Artifact: `soffice-wasm-conversion-only-32146386224.zip`, 78,834,449 bytes,
  SHA-256 `8b6b6e75caad9a136b00807d2bb807d9dccb87e21354d5f4ffc539a09fbd1e87`.
