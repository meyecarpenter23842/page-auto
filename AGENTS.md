# PAGE-AUTO — Mandatory Agent / Chat Entrypoint

This file is the root startup contract for every coding agent, ChatGPT/Codex session, review session, bugfix, feature batch, release/update task, and documentation change in this repository.

## 1. Mandatory startup — no reminder required

Before analyzing implementation details, proposing code changes, editing source, committing, pushing, reviewing a PR, packaging, updating, or releasing, the agent/chat **MUST do all of the following automatically even when the project owner does not repeat the instruction**:

1. Read `PROJECT_PRINCIPLES.md`.
2. Read `PROJECT_PLAN.md`.
3. Read `ARCHITECTURE.md`.
4. Verify the repository is `meyecarpenter23842/page-auto`.
5. Verify the current/default branch and exact HEAD SHA before choosing the work batch.
6. Read the relevant issue/PR/handoff for the current batch when one exists.
7. Audit the current source/schema/runtime involved before changing behavior; do not infer architecture from UI labels or stale chat memory.

Conversation memory, previous summaries, or an old handoff are **not substitutes** for reading these three repository documents at the start of a new work session.

If any of the three required documents cannot be read, stop before implementation and report the blocker instead of guessing.

## 2. Precedence and architecture safety

- `PROJECT_PRINCIPLES.md` contains project-wide invariants and explicit superseding decisions.
- `PROJECT_PLAN.md` contains the current product/implementation baseline.
- `ARCHITECTURE.md` contains source/runtime ownership and dependency boundaries.
- A feature or bugfix must not silently change stack, process boundaries, data ownership, common Facebook runtime ownership, concurrency semantics, or other project-wide invariants.
- If a requested change truly requires changing an invariant, obtain explicit project-owner approval and update the governing documentation in the same batch before expanding the implementation.

## 3. Canonical local data root — critical invariant

For packaged PageAuto builds, the canonical live data root is the `data` directory beside the running application executable:

```text
<PageAuto install/folder>/
  PageAuto.exe
  resources/
  data/
    page-auto.sqlite
    browser-profiles/
    logs/
    screenshots/
    backups/
    ...
```

Therefore:

- The canonical packaged SQLite database is `<PageAuto install/folder>/data/page-auto.sqlite`.
- Once that portable database exists, normal startup must keep using it; it must not silently fall back to an old `%AppData%`/`%LocalAppData%` database.
- Updates and manual replacement/install flows must preserve the complete live `data` tree. Application binaries/resources may be replaced; live user data must not be deleted or reset.
- Legacy-data migration must be fail-safe: do not overwrite an existing canonical portable DB, do not delete the legacy source as part of migration, and keep migration/rollback behavior covered by regression tests.
- Running another copy of `PageAuto.exe` from a different folder may intentionally produce/use a different adjacent `data` root; do not treat different executable folders as the same installation.
- Any future change touching `dataDirectory`, packaging, installer/updater hooks, migrations, DB initialization, or executable layout must explicitly preserve this invariant and update/add regression coverage.

## 4. Required work discipline

- Work in coherent batches with a clear scope.
- Test locally when the environment is available before push; otherwise state the limitation and rely on appropriate CI/test evidence.
- Do not spam small `fix CI`/`try again` commits. Aggregate related failures, identify causes, fix the batch, then push again.
- After every push, monitor all required CI workflows until green before reporting the batch as complete.
- Do not call a bug fixed merely because code changed; require test/CI evidence.
- Do not merge a PR without an explicit merge command from the project owner.
- After an authorized merge, monitor required `main` CI to green before reporting completion.
- Do not deploy or release without a separate explicit command.
- Never commit real account credentials, cookies, sessions, browser profiles, 2FA secrets, or other live private data.

## 5. New-chat rule

A new chat/session working on PAGE-AUTO must begin by following Sections 1–4 above **without waiting for the owner to remind it**. The first implementation decision of a new session must be based on the current repository documents and current HEAD, not solely on prior-chat context.
