# Email/Microsoft Auth V2 — Batch 0 Audit & Contract Lock

Issue: #347

Baseline audited: `main@d72cc914032a31989e5fa69acb431aeb915ef0bc`
Main CI at audit start: `#2243` — success.

## Scope

Batch 0 is intentionally **non-behavioral**. It locks the V2 contracts and records what is proven from source/live evidence before any runtime migration.

No production selector, navigation, provider polling, Microsoft handler, DB/schema, Facebook flow or UI behavior is changed in this batch.

## Mandatory architecture read

Audited together with:

- `PROJECT_PRINCIPLES.md`
- `PROJECT_PLAN.md`
- `ARCHITECTURE.md`

The existing Electron Main / utility-process Playwright / renderer boundary remains unchanged.

---

## 1. Source audit — confirmed structural problems

### 1.1 Microsoft controller and handlers are still coupled

`email-browser-worker.ts` currently owns detection, page navigation, credential handling, recovery dispatch and action completion. `microsoftRecoveryChallenge.ts` owns both Microsoft recovery UI actions and mailbox-provider lifecycle.

Conclusion: file separation exists, but orchestration ownership is not separated enough for a re-entrant state-driven flow.

### 1.2 Page index is still used as identity

Current source contains paths equivalent to:

```ts
const page = context.pages()[0] ?? await context.newPage()
```

for Outlook/Security targets.

This is unsafe once the same profile can contain Microsoft auth, Outlook, provider/mailbox and unrelated pages. Page order is not page identity.

V2 contract therefore locks explicit roles:

```text
microsoft_auth
outlook_mail
mailbox_provider
unrelated
```

Batch 1 must resolve/adopt pages by role evidence, never by index.

### 1.3 Recovery provider lifecycle is cleared too early

Current recovery code submit path can clear `requestedAt` and call provider-round cleanup immediately after clicking Microsoft Next/Continue.

That happens before a new Microsoft surface has proven that the submitted code was accepted.

V2 invariant:

> Clicking Next is not success. The controller must detect Microsoft again before recovery-round cleanup.

### 1.4 Provider failures are not modeled as first-class recoverable states

Popup interception, a closed provider page, navigation settle, mailbox already open and message-detail state are currently handled through local retries/fallbacks rather than a durable provider state model.

V2 mailbox surface contract therefore includes:

```text
provider_closed
provider_unavailable
overlay_blocking
home
add_inbox_dialog
mailbox_ready_expected
mailbox_ready_other
message_list
message_detail_expected
message_detail_other
```

### 1.5 Provider page is coupled to foreground switching

Current recovery code path uses `bringToFront()` around provider polling and Microsoft submit.

Owner requirement for V2: provider/mailbox work should remain background whenever Playwright can operate safely without foregrounding it. Foreground is only for provider/manual surfaces that truly require operator interaction.

### 1.6 Existing code already proves a re-entrant detector is feasible

`emailLoginPolicy.ts` already classifies multiple Microsoft surfaces from URL + structured DOM evidence. This should be migrated into the single V2 detector rather than copied into per-flow branching.

Unknown/security surfaces must continue to fail closed; V2 must not bypass checkpoint/identity/security protection.

---

## 2. Live evidence matrix

| Surface/case | Evidence at Batch 0 | Status | Implementation rule |
| --- | --- | --- | --- |
| Recovery method choice with masked BackupEmail | Existing live flow + current regression fixtures | Confirmed | Separate `RecoveryMethodHandler`; canonical BackupEmail match required |
| Recovery email confirmation | Existing live flow + current regression fixtures | Confirmed | Separate `RecoveryEmailHandler`; fill/verify, then detect again |
| Microsoft recovery-code page | Existing live flow/screens + current regression fixtures | Confirmed | Separate `RecoveryCodeHandler`; code submit is not terminal |
| Inboxes correct mailbox already open | Owner live report + source audit | Confirmed requirement | Reuse/adopt; do not restart Add Inbox flow |
| Inboxes blocking popup | Owner live screenshots/report | Confirmed requirement | Detect overlay, dismiss boundedly, then reclassify |
| Inboxes provider tab closed while Microsoft waits for code | Owner live report | Confirmed requirement | Recreate/adopt provider page while preserving recovery-round metadata |
| Repeated Microsoft code challenge | Owner requirement + current architecture failure mode | Confirmed requirement | Re-detect and call the same `RecoveryCodeHandler` again; no linear-step assumption |
| Microsoft returns to Username/Password during recovery | Owner requirement | Confirmed requirement | Dispatcher routes to current surface handler, then returns to detection |
| Passkey prompt near final Sign in | Owner live report only | **Surface mechanism not yet proven** | Must become `passkey_prompt`, but selector/automation technique is blocked until DOM-vs-browser UI is proven |
| Sign in button after Passkey Cancel | Owner live report only | **Exact surface markers not yet proven** | Separate `sign_in_continue`; exact selector/evidence must come from live audit |

---

## 3. Passkey audit — blocker that must not be guessed

Repository search at this baseline finds no existing Passkey/WebAuthn handler.

The owner-reported live sequence is:

```text
Microsoft nearly finishes sign-in
-> Passkey prompt appears
-> Cancel
-> Sign in appears
-> click Sign in
-> Outlook Inbox
```

What is **not yet proven** from available evidence:

1. whether the Passkey prompt is Microsoft DOM/modal content inside the page;
2. whether it is Chromium/WebAuthn/browser-owned UI outside normal page DOM;
3. the exact structured marker for the post-Cancel `Sign in` surface;
4. whether Cancel causes navigation, same-document state change or browser-level dismissal.

Batch 0 deliberately does **not** invent selectors for this.

Required live evidence before Batch 2 implementation:

- screenshot/video including the full browser chrome when Passkey appears;
- current URL before/after Cancel;
- DOM snapshot/accessible-role evidence if the prompt is page-owned;
- proof of the `Sign in` control after Cancel.

Until that is captured, V2 locks the semantic states `passkey_prompt` and `sign_in_continue`, but leaves their detector/handler implementation unresolved.

---

## 4. V2 contract locked by this batch

### Microsoft surfaces

V2 has explicit state names including:

- username
- password
- account_picker
- stay_signed_in
- passkey_prompt
- sign_in_continue
- recovery_method_choice
- recovery_email_confirmation
- recovery_code
- authenticated
- existing security/manual/error surfaces

### Handler result semantics

```text
handled        -> non-terminal -> MUST detect again
retryable      -> non-terminal -> MUST detect again
needs_attention-> terminal for current action
 authenticated -> terminal only after detector proves authenticated state
```

No handler may return `handled` and directly select the next handler based on history.

### Recovery-round metadata

The durable round contract contains only metadata such as:

```text
challengeId
mailbox
providerId
requestedAt
consumedMessageKeys
lastSubmittedMessageKey
lastSubmittedCodeFingerprint
submitAttempts
```

Do not store/log plaintext PassEmail or plaintext verification code as durable round state.

---

## 5. Batch 1 entry conditions

Batch 1 may start once this contract branch is green. It must:

1. implement `EmailPageRegistry`/ownership resolution;
2. migrate detector/dispatcher skeleton without changing handler semantics yet;
3. add page-order regression proving a provider tab cannot be navigated as Microsoft just because it is `pages()[0]`;
4. preserve current unsupported-security fail-closed behavior.

Passkey implementation is **not** required for Batch 1 and must remain blocked until the live mechanism is proven.

---

## 6. Batch 0 exit status

Source architecture audit: complete.
Contract lock: complete in this branch.
Known live Inboxes/recovery requirements: recorded.
Passkey live mechanism audit: **blocked by missing live DOM/browser evidence; intentionally not guessed**.

Therefore Batch 0 can be merged as a non-behavioral contract/audit checkpoint, but Issue #347 must keep the Passkey evidence item open before Batch 2 implements that handler.
