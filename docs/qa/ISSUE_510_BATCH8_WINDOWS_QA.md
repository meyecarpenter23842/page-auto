# Issue #510 — Batch 8 Windows QA and regression evidence

Baseline: `main@c5e2f395d2703a3d58ed19ed60d89d1004aab9d0` (PR #518 merged; main CI run 38018932704 success).
Branch: `feat/issue-510-batch8-windows-qa-evidence`.

## Evidence classification (do not conflate)

- **CODE-REVIEW**: inspected source or test definition; not proof it ran successfully.
- **CI-PASS**: named job/step succeeded on a specific SHA, with log/artifact link.
- **FIXTURE-PASS**: renderer/Electron interactions using test data/mocks; not live Facebook/Email/Zalo.
- **WINDOWS-MANUAL-PASS**: operator actually ran the packaged/dev Windows app; attach OS/build, monitor/DPI, screenshots or video, test data scope, reproduction/expected/actual.
- **LIVE-PASS**: separately authorized limited live profile/scheduler test, with sanitized evidence; never inferred from CI.
- **PENDING / BLOCKED / FAIL**: no verified pass; record reason, impact, owner and follow-up.

Do not mark rows PASS based only on smoke screenshot creation. Do not commit real profiles, account credentials, cookies, 2FA, API keys, or proxy secrets. Collect only sanitized logs and synthetic datasets.

## Environment matrix — Windows manual (all currently PENDING)

| OS | Resolution | DPI | Theme | Window mode | Evidence |
| --- | --- | --- | --- | --- | --- |
| Win 10 | 1280×800 / 1366×768 / 1920×1080 / 2560×1440 | 100% / 125% / 150% | light / dark | normal / maximized / restored | PENDING |
| Win 11 | 1280×800 / 1366×768 / 1920×1080 / 2560×1440 | 100% / 125% / 150% | light / dark | normal / maximized / restored | PENDING |

Record an actual subset of combinations tested; **never** promote a single environment to all combinations. Prioritize 1280×800@150%, 1366×768@125%, 1920×1080@100%, 2560×1440@150%. Capture topbar, sidebar, table viewport, context menus and modal clipping, keyboard focus, console errors, accessibility labels/contrast and maximize/restore screenshots.

## Workspace QA inventory and acceptance

| Surface | Interaction / persistence cases | Current evidence |
| --- | --- | --- |
| Account Manager | 1/10/100/1000 rows; Ctrl/Shift/drag, self-scroll, filtered select-all, right-click in/out of selection; target IDs, masked credentials, import/update preset, columns on restart | PENDING Windows |
| Email Manager | keyboard/range/checkbox, batch target count, security action feedback, persistent table preferences; email-profile launch separately | PENDING Windows |
| Proxy Center / Builder | folders, mark used vs live, copy/move/test selected, overlay/modal and scroll, packaged builder UI | PENDING Windows |
| Scanner / Datasets | filter, select, context actions, save/export, no horizontal overflow, dataset persistence | PENDING Windows |
| Page Tabs / Group | Page A/B independent settings, dirty Page switch guard, schedule sorted weekday-then-time, account binding target IDs, waiting-window, controls | PENDING Windows |
| Page Wall | canonical post pool binding, rotation UI, schedule save/reopen, missing drafts, no duplicate storage | PENDING Windows |
| Library / Posts | folder → canonical post → variant/preview; bind/unbind without deleting original; modal keyboard and draft guard | PENDING Windows |
| Actions / Scenarios | account/preset selection, edits, dirty nav, progress/log and status; no duplicate runner | PENDING Windows |
| Zalo | selection, post picker, modal, saved preferences; browser/profile/scale separately | PENDING Windows |
| Settings / Logs | 11 section search/navigation, auto-save vs explicit Save, sanitized errors, filter and focus, restart | PENDING Windows |
| App shell | 10 consecutive route changes, dirty cancel/confirm, resize, scroll, route restore and console errors | PENDING Windows |

For every data-grid run: test drag outside bottom edge (auto-scroll), Ctrl and Shift, checkbox without unintended drag, right-click on selection and new row, Escape, filtered select all, copy and bulk operation with **IDs/count verified**, sort/filter while selected, long text and keyboard navigation. Destructive actions only on synthetic data.

## Protected regression gates (NO runtime edits in Batch 8)

| Gate | Minimum test | Evidence / status |
| --- | --- | --- |
| Chrome/profile | one and multiple **test profiles**, normal/compact, scale/viewport, slots, browser dock, minimize/maximize/restore; verify no unsolicited window grouping or different profile root | PENDING manual; separate real-Chrome tests already present in source |
| Email/Zalo profiles | actual profile root isolation, no fallback, window scale, browser lifecycle | PENDING manual |
| Scheduler | two Pages and distinct schedules, waiting-window, Start/Pause/Resume/Stop, startup policy, account lease and concurrency | PENDING manual/live; unit regression separate |
| Group posting | run_items snapshot, atomic claim, no duplicate, success-only consume; source groups remain immutable | PENDING controlled live; unit regression separate |
| Canonical posts | global binding, immutable run snapshot, no duplicate DB ownership | PENDING controlled regression |
| Sessions/challenges | valid reuse, login/checkpoint stops safely, no bypass/retry loops | PENDING limited controlled live |

Use a disposable data directory, backup prior to any manual state-changing test. Start live tests at **1 test account, 1 test Page, 1 test Group, 1 post**, only expand after explicit authorization. For challenge/checkpoint, stop and record typed status; no retry loops.

## Existing GitHub CI baseline / limitations

`.github/workflows/ci.yml` runs on `windows-latest`:
`npm run typecheck`, `npm test`, `npm run build`, native rebuild, Electron smoke, Page Business UI, Page Scenario UI, Page Wall UX, Scanner UI, packaged Proxy Builder UI, packaging/verification and legacy DB smoke.

Known screenshots uploaded by current CI: `dist/page-business-ui-smoke.png`, `dist/page-scenario-ui-smoke.png`, `dist/page-wall-ux-smoke.png`, `dist/page-wall-schedule-smoke.png`, `dist/scanner-ui-smoke.png`, `dist/proxy-builder-packaged-ui-smoke.png`. These are targeted smoke surfaces, **not** full desktop visual baselines, and cannot establish Windows 10 compatibility, DPI 125/150%, profile correctness, or Facebook live success.

For each CI run, retain run URL, SHA, test/job name, pass/fail, artifact name and capture timestamp. Attach before/after screenshots from the **same OS/DPI/theme/window mode** before deleting old CSS overrides. If QA reveals UI defect: reproduce → isolate root cause → add regression test → change only renderer/UI code → run typecheck/test/build/smokes → one cohesive PR. Runtime defects must be filed separately with sanitized evidence and no surprise core changes.

## Test evidence record (copy per case)

```text
Test ID:
Date/time and tester:
Branch / full SHA / Windows build / dev or portable:
Resolution / DPI / theme / window normal/maximized/restored:
Workspace / test data cardinality / synthetic fixture:
Steps:
Expected / Actual:
Status (PENDING / BLOCKED / FAIL / FIXTURE-PASS / WINDOWS-MANUAL-PASS / LIVE-PASS):
Sanitized screenshot/video/log paths or CI run+artifact URLs:
Console/a11y findings:
Affected target IDs or counts (non-sensitive):
Root cause / related issue / retest after fix:
```

## Current audit result

**No source change or proven Windows UI bug is claimed by this evidence-only PR.** GitHub CI main success certifies its existing checks only. Windows manual matrix and live/profiles remain PENDING until actual execution evidence is attached. Do not close #510/Batch 8 before these gates are met.
