# CP282 U5 — Live Windows Acceptance

> Issue #136 U5 gate. CI/unit tests are necessary but **do not close #136** without the live Windows matrix below.

## Build under test

Record before testing:

- app/branch SHA;
- Windows version;
- Chrome version used by PAGE-AUTO;
- portable executable root;
- app `dataDirectory` shown by runtime;
- timestamp of the test session.

Do not commit real account credentials, cookies, 2FA secrets, OAuth tokens, mailbox contents, checkpoint images, or screenshots containing sensitive account data. Keep live evidence local and redact identifiers in issue/PR notes.

## Matrix

| ID | Case | Expected result | Local evidence |
| --- | --- | --- | --- |
| U5-01 | One account with one existing `Folder282/<UID>.*` | Preflight = Canonical; run uses canonical; no replacement/promotion; terminal browser is released | redacted result + history state |
| U5-02 | Batch with 2+ accounts | Accounts execute sequentially in Workbench; a manual/login gate pauses at the current account; no later account starts until continuation | redacted sequence timestamps |
| U5-03 | New numeric UID, no canonical, explicit source image | After the exact source image is actually used, operator confirms it, Recheck resolves, and `c_user` matches UID: image is promoted to `Folder282/<UID>.<ext>` | source filename hash/size + canonical path, no image commit |
| U5-04 | Waiting/manual, failed run, timeout, stop, or unresolved login | Source image is **not** promoted | history/promotion state |
| U5-05 | Missing source and duplicate canonical | Missing blocks Start. Duplicate blocks Start until one canonical is explicitly kept; non-kept copies go to archive, never random-selected | redacted preflight + archive filenames |
| U5-06 | Expired cookie -> password -> 2FA when Facebook asks -> continuation | Facebook Common performs login flow, same account/profile continues, final session/account identity is revalidated; no secret appears in logs | redacted Common state transitions |
| U5-07 | Same account/profile already owned by another operation | CP282 returns retryable busy result instead of stealing/launching the same profile. After owner releases, retry can proceed | redacted busy + retry result |
| U5-08 | Press `Dừng & đóng browser` while CP282 is running | Current run becomes `stopped`; browser closes; no asset promotion; same account lock is released | history `stop/stopped` + process/browser observation |
| U5-09 | Close Workbench while it is holding manual/login continuation, then reopen | Close performs safe stop/release first; reopening preflight/history is consistent; no orphan browser/profile lock | redacted history before/after reopen |
| U5-10 | Portable app launched outside C:, e.g. D:/F: | `data/checkpoint-assets/282` follows the portable executable/data root; no fallback/hard-code to C: | app info `dataDirectory` + Folder282 path |

## Pass rules

1. `Folder ảnh nguồn`, `Folder282`, and Evidence remain separate.
2. Canonical resolver always wins when exactly one canonical exists.
3. No source asset promotion unless the result is `resolved`, the operator confirmed the exact tracked source image was used, and numeric `c_user` matches the account UID.
4. `waiting_manual`, `needs_login`, `error`, `stopped`, timeout, and other checkpoint states never promote a source asset.
5. `needs_login` pauses the batch and is retryable through Recheck after the operator/Common login flow is ready.
6. A held CP282 account owns the same-account execution lease; unrelated accounts remain runnable.
7. Stop/close releases the browser/profile and same-account lease without recording a false success.
8. No checkpoint/identity/security bypass is attempted.
9. Required Windows CI for the exact code SHA is green.

## Closure

After all rows pass live on Windows, add a redacted summary to issue #136 with the tested SHA and local evidence locations. Only then mark U5 complete and close #136.
