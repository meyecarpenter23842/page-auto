# PAGE-AUTO v1.0.0 — MVP Release Notes

## Portable Windows MVP

PAGE-AUTO v1.0.0 completes the current Phase 0–9 MVP baseline.

### Packaging

- Windows x64 portable folder with `PageAuto.exe`.
- Windows x64 ZIP artifact: `PageAuto-1.0.0-win-x64.zip`.
- No Setup/NSIS installer in the MVP.
- Branded PAGE-AUTO application icon is used by the packaged executable/window.
- Runtime data is stored in `data/` beside `PageAuto.exe`.

### Data and upgrades

- Versioned SQLite migrations continue to run automatically against the portable `data/page-auto.sqlite` database.
- Portable data layout includes browser profiles, logs, screenshots and backup folders.
- Keep the `data/` directory when replacing the app folder with a newer version.

### Config backup / restore

- Settings UI can export a JSON backup of Page Tabs, account references, schedules, Group/Content/Image configuration, Import Presets and Account Manager column layout.
- Config backup does not export plaintext password, cookie/session, 2FA, email password, proxy password, browser profiles, logs or screenshots.
- Restore merges matching Page Tabs and creates non-secret account shells for missing referenced UIDs.
- Restore is blocked while an active run exists.

### Existing MVP features

- Account Manager with custom import and persistent browser profiles.
- Session/account status flow with manual login handling.
- Independent Page Tab configuration.
- Run queue with Group anti-duplicate semantics.
- Browser posting modules with publish-result verification.
- Sequential account rotation per Page Tab.
- Parallel runtime across multiple Page Tabs.
- Crash recovery, detailed execution logs, failure screenshots and bounded retry policy.

### Build verification

Windows CI validates typecheck, unit tests, desktop build, native SQLite rebuild, Electron smoke test, portable folder/ZIP packaging and artifact structure before the Phase 9 PR is considered complete.
