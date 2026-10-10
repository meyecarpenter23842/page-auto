# PAGE-AUTO — R5 Windows UI/UX QA & Regression Acceptance

Parent: #521 · Master: #510. QA evidence is required before either issue is closed.

## Status vocabulary

**CI FIXTURE-PASS** = Windows GitHub Actions runner with a throwaway test data directory, simulated CSS viewport, no real accounts/sessions/credentials. Requires a SUCCESS workflow.
**LIVE-PASS** = actual Windows operator/test machine with redacted screenshot/log evidence.
**PENDING** = not yet tested. **BLOCKED** = required environment unavailable. **FAIL** = reproduced issue.

## CI QA coverage

The Windows CI invokes apps/desktop/scripts/windows-r5-ui-smoke.mjs after desktop build/native rebuild. It navigates all 10 workspaces; screenshots light at 1280×800, 1366×768, 1920×1080, 2560×1440 plus dark at 1280×800 = 50 captures. Checks sidebar/workspace overlap, mounted content and unique aria-current selection. Electron native maximize/restore is exercised, and the last Settings route must survive restart using the same disposable data root. The artifact PageAuto-r5-windows-ui-SHA contains PNG images and evidence.json with OS details, measured DPR and error *counts* (no raw logs/secrets). This is NOT a claim of Windows 10/11 coverage, native 100/125/150% DPI or production data-grid interaction.

Unit test: helper covers 3/10/100 checked-row selection and existing filtered 1000-row range. Separate CI smoke tests already cover Page Overview/Group/Wall/Scenario, Scanner, Settings/Logs, Proxy packaged UI and packaged DB. Screenshot review is still manual; there is no automated baseline pixel comparison.

## Manual acceptance checklist (not yet verified)

| Focus | Required proof | Initial state |
|---|---|---|
| Windows OS + DPI | Windows 10/11, OS build, DPI 100/125/150, supported monitors 1280×800 through 2560×1440 | BLOCKED without Windows 10/11 operator host |
| Windowing/theme | Normal/maximize/restore, light/dark across app, no clipped buttons/modals | PENDING |
| Data grids | Accounts/Email/Proxy/Scanner with 1/3/10/100/1000 rows, Ctrl/Shift/drag/scroll/context menu, bulk target IDs | PENDING |
| Preferences | Restart column/order/visibility, filters, import preset, Page selection, schedule/draft | PENDING |
| Input/modals | Tab/Shift+Tab/Escape/focus, unreadable content, errors, screenshot/console | PENDING |
| Real browser | Chrome slots/dock, normal/compact/zoom/scale, Email/Zalo profile/session and checkpoint handling | BLOCKED without isolated test accounts |
| Scheduler/data | Multi-Page waiting windows/start/pause/resume/stop, lease, immutable Group run_items, canonical run snapshot | BLOCKED without controlled integration fixture |
| Evidence privacy | No plaintext password/cookie/token/2FA in screenshot/log/report | PENDING |

For each FAIL: OS/build, SHA, resolution/DPI, route, steps, expected/observed, severity P0/P1/P2, sanitized evidence, test and cause. Keep core runtime problems in separate issues; R5 UI is not authorization to edit Main/DB/IPC/Chrome/scheduler.

**Exit:** required CI green, no untriaged P0/P1 UI regressions, live evidence for approved scope, visual signoff by owner. Until then R5 is PARTIAL, NOT ACCEPTED.
