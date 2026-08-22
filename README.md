# PAGE-AUTO

Windows desktop application for managing Facebook account sessions and independent Page Tab automation configurations.

## Current phase

Phase 0 bootstrap:

- Electron main process owns local persistence and lifecycle.
- React renderer is UI-only and has no direct database access.
- SQLite is local via Drizzle ORM + `better-sqlite3`.
- Preload exposes a narrow IPC bridge with context isolation enabled.
- Browser automation is intentionally not part of Phase 0; it will run in a separate worker process in later phases.

See [`PROJECT_PLAN.md`](./PROJECT_PLAN.md) for the accepted architecture and implementation order.

## Development

Requirements:

- Windows 10/11 recommended
- Node.js 22.12+
- npm 10+

```bash
npm install
npm run typecheck
npm test
npm run build
npm run rebuild:native
npm run dev
```

`better-sqlite3` is a native module. `npm run rebuild:native` rebuilds it against the Electron ABI before launching the desktop app.

## CI smoke test

The smoke test starts the compiled Electron main process without creating a window, initializes the SQLite database in a temporary folder, verifies the database file was created, and exits.

```bash
npm run smoke
```

## Sensitive data

Never commit real account credentials, cookies, 2FA secrets, browser profiles, or exported session data. Runtime data belongs under the application data directory and is excluded from Git.
