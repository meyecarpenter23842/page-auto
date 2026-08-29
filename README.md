# PAGE-AUTO

Windows desktop application for managing Facebook account sessions and independent Page Tab automation configurations.

## MVP status

Phase 9 completes the current MVP baseline:

- Electron Main owns SQLite, scheduler/runtime state and worker lifecycle.
- React renderer remains UI-only and talks to Main through typed preload/IPC APIs.
- Playwright posting runs outside the renderer through Electron utility processes.
- Each Page Tab has its own queue/runtime; accounts stay sequential inside one tab while different tabs can run in parallel.
- Recovery, execution logs, bounded retry and screenshot evidence are persisted locally.
- Windows distribution is a **portable folder + ZIP** with `PageAuto.exe`; there is no Setup/NSIS installer in the MVP.

Before changing architecture/data ownership, read these canonical entrypoints in order:

1. [`PROJECT_PRINCIPLES.md`](./PROJECT_PRINCIPLES.md) — project-wide invariants and explicit supersedence decisions.
2. [`PROJECT_PLAN.md`](./PROJECT_PLAN.md) — accepted implementation baseline/order.
3. [`ARCHITECTURE.md`](./ARCHITECTURE.md) — source/runtime ownership boundaries.

For the post/content data model specifically, **Issue #188 + `PROJECT_PRINCIPLES.md` supersede older `content_sets/content_items` / `contentSetId` wording** still present in transitional K4.5.1/K4.5.2 documentation. Those references describe legacy/compatibility source until the #188 migration is implemented; they must not be treated as the target architecture.

## Development

Requirements:

- Windows 10/11 recommended
- Node.js 22.12+
- npm 10+
- Google Chrome installed for the current headed Playwright flow

```bash
npm install
npm run typecheck
npm test
npm run build
npm run rebuild:native
npm run smoke
npm run dev
```

`better-sqlite3` is a native module. `npm run rebuild:native` rebuilds it against the Electron ABI before the desktop smoke test/development run.

## Portable Windows build

Build the final MVP portable artifacts on Windows:

```bash
npm install
npm run package:portable
npm run verify:portable
```

Expected output:

```text
dist/
  win-unpacked/
    PageAuto.exe
    resources/
  PageAuto-1.0.0-win-x64.zip
```

No installer is generated. Copy the unpacked folder or ZIP to another Windows machine, extract it if needed, then run `PageAuto.exe` directly.

At runtime the packaged application stores local state beside the executable:

```text
Page-Auto/
  PageAuto.exe
  resources/
  data/
    page-auto.sqlite
    browser-profiles/
    logs/
    screenshots/
    backups/
```

Keep the `data/` folder when replacing the application with a newer portable version. SQLite migrations are versioned and run automatically when the existing database is opened by the newer app.

## Config backup / restore

The Settings page can export/import a PAGE-AUTO config backup JSON. It includes:

- Page Tabs and account references by UID
- schedules, rotation, Group UID list, Content Set and Image Folder config
- Import Presets
- Account Manager column layout

The config backup intentionally excludes plaintext account credentials and runtime evidence: password, cookie/session, 2FA, email password, proxy password, browser profiles, execution logs and screenshots.

Restore merges Page Tabs and creates a non-secret `unknown` account shell when a referenced UID does not exist locally. Existing account secrets are not overwritten.

## CI

Windows CI runs typecheck, unit tests, desktop build, native rebuild, Electron smoke test, portable packaging and artifact verification. The portable ZIP is uploaded as a short-lived CI artifact for validation; this is not a GitHub Release.

## Sensitive data

Never commit real account credentials, cookies, 2FA secrets, browser profiles, exported sessions, runtime screenshots, SQLite files or local `data/` contents.
