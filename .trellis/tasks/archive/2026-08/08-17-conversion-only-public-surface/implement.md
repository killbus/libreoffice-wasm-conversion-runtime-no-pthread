# Implementation plan: conversion-only public surface

## 1. Freeze contracts

- [x] Record the exact 52 WebAssembly exports and exact 14-symbol `lok_*`
      allowlist from the materialized frozen artifact.
- [x] Define exact JavaScript entry-point allowlists for root, server, browser,
      types, and browser-assets.
- [x] Reduce `ILibreOfficeConverter` to lifecycle plus singular conversion.

## 2. Remove public reachability

- [x] Stop exporting raw Node, subprocess, browser, and Worker converter classes.
- [x] Return frozen four-method facades from public converter factories.
- [x] Remove editor tools/types, LOK constants, render/inspection/session types,
      and raw advanced APIs from every package entry point.
- [x] Keep internal implementations available only to the conversion wrappers.

## 3. Align format capabilities

- [x] Remove unreachable JPG conversion declarations while preserving standalone
      JPEG encoding utilities.
- [x] Remove Writer/text HTML from the conversion matrix.
- [x] Require explicit input format for PNG/SVG page export.
- [x] Update README, API docs, browser examples, and package descriptions.

## 4. Verification

- [x] Add exact runtime-export and compile-time negative contract tests.
- [x] Make native package verification reject any missing or extra `lok_*` export.
- [x] Run typecheck, package build against materialized frozen assets, and
      bounded unit/integration suites with one WASM process at a time.
- [x] Run DOCX->PDF, XLSX->CSV, PPTX->PDF, PDF->PNG, and PPTX->SVG smoke tests
      through public entry points using materialized assets.
- [x] Prove the frozen candidate/native bytes remain unchanged and commit this
      child independently.

## Dependencies

- CSV cardinality is supplied by commit `b12289c`.
- Pthread main-script alignment is supplied by commit `f56317e`.
- Successor identity and browser qualification remain owned by
  `08-17-successor-runtime-qualification`.
