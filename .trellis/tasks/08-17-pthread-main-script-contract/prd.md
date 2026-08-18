# Pthread main-script artifact contract

## Goal

Align wrapper defaults, package assets, glue, and release schemas on the main-script pthread profile.

## Requirements

- Make omitted pthread mode resolve to `main-script` in runtime types and code.
- Keep `soffice.worker.js` absent from the package and candidate inventory.
- Reject mixed main-script/external-worker configuration synchronously.
- Treat an external-worker build as a future, separately frozen artifact profile;
  do not auto-detect, fallback, or add a compatibility worker to this profile.
- Preserve existing candidate bytes; qualification uses a successor identity.

## Acceptance Criteria

- [ ] Wrapper default, glue behavior, browser-assets inventory, package files,
      release spec, packager, and verifier all say `main-script`.
- [ ] No package path at any depth is named `soffice.worker.js`.
- [ ] Real-browser evidence shows zero standalone worker requests and successful
      pthread conversion using `soffice.js`/`mainScriptUrlOrBlob`.
- [ ] Any wrapper/manifest byte change produces a different candidate identity.

## Notes

- Depends on the CSV child only for serial review discipline, not code.
- Must complete before successor qualification.
