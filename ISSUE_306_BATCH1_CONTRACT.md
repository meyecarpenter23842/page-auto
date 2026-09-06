# Issue #306 — Batch 1 source audit + contract lock

Baseline audit: `main@8730ee9472c6ec4f3e6acb1c13d84520f6d61001`.

Scope của tài liệu này chỉ là **source audit + khóa contract** cho Account Change Info. Không thêm selector Facebook, không thêm executor mutation, không đổi schema production trong Batch 1.

Related: #140, #233, #306. Page Edit (#283/#77) là scope khác.

---

## 1. Kết luận kiến trúc

`change_info` là **Action Workspace/composer** cho actor Profile, không phải runtime Facebook mới.

Luồng đích:

```text
Account Manager selection / Change Info tab
  -> action_workspaces + canonical account bindings
  -> Change Info workspace config + Data Source
  -> freeze run snapshot + resolve assignment per account/action
  -> runRollingAccountPool(accountConcurrency)
  -> AccountExecutionCoordinator.tryAcquireLease(accountId)
  -> per-account selected actions chạy TUẦN TỰ
  -> ActionRunRequest
  -> Common Action Runner
  -> Facebook Common Action Host
  -> ensure session -> ensure exact Profile actor -> visual/layout guard
  -> atomic executor đã live-audit
  -> post-state verification
  -> per-action result -> per-account aggregate
  -> canonical Account field update chỉ sau verified success
```

Không tạo:

- Change Info Action Registry thứ hai;
- Change Info browser/session/login runtime;
- Change Info account store/binding riêng;
- thread pool/concurrency engine riêng;
- selector chung kiểu page-wide `nth()`;
- executor Facebook cho field chưa live-audit.

---

## 2. Source audit hiện tại

| Chức năng | Loại | Source hiện tại | Hướng xử lý |
|---|---|---|---|
| Chọn nhiều account | UI / binding | `renderer/accounts/AccountManager.tsx` dùng `selectedIds: Set<number>` + canonical `AccountRecord.id` | Reuse selection; entry Change Info phải truyền/bind ID canonical, không copy account data |
| Right-click selection | UI | `AccountManager.tsx` giữ selection hiện tại hoặc chọn đúng row được right-click | Batch 2 thêm entry `Sửa thông tin`; không tạo selection model mới |
| Workspace persistence | Workspace | `shared/actionWorkspaces.ts`, `ActionWorkspaceRepository`, `action_workspaces`, `action_workspace_accounts` | Mở rộng `ActionWorkspaceType` thêm `change_info`; reuse bảng + binding hiện có |
| Workspace UI shell | UI | `renderer/actions/ActionWorkspace.tsx`, `actionWorkspaceRegistry.ts` | Batch 2 thêm Change Info tab definition/component/default draft |
| Action Registry | Shared action contract | `shared/actionRegistry.ts` | Reuse. Atomic action ready phải đăng ký vào registry canonical |
| Action Picker/Kịch Bản | UI | `ActionPickerModal.tsx` đọc trực tiếp `ACTION_REGISTRY` | Action mới đúng registry tự xuất hiện theo capability; không tạo picker riêng |
| Common Action Runner | Runtime | `main/services/actionRunner.ts` | Reuse nguyên validate/actor capability/preparation/retry/result/sanitization |
| Executor registration | Runtime | `main/browser/actionRuntime/actions/index.ts` | Executor Change Info tương lai đăng ký theo pipeline hiện hành; không registry mới |
| Profile actor preparation | Facebook common | `facebookCommonActionHost.ts`, `facebookProfileIdentity.ts` | Bắt buộc `ensureSession -> ensureProfile`; active Page phải restore Profile trước mutation |
| Account global lease | Orchestration | `AccountExecutionCoordinator` | Reuse `tryAcquireLease`; cùng account không chạy đồng thời giữa workspace |
| Rolling pool | Orchestration | `runRollingAccountPool()` | Reuse rolling/refill; account đang lock không chiếm chết slot |
| Workspace composition pattern | Reference | `interactionWorkspaceComposition.ts` | Học pattern compose scalar action requests; không copy business logic Tương tác |
| Workspace runtime pattern | Reference | `InteractionWorkspaceRunnerService` | Học snapshot, rolling pool, per-account action loop, pause/stop |
| Verification | Common action | `actionVerification.ts` + `verification_uncertain` | Reuse immediate/revisit/poll semantics; không blind retry consequential mutation |
| Canonical Account fields | Data | `shared/accounts.ts`, `AccountRepository` | Chỉ update field canonical có thật sau verified success |
| Singleton settings | Persistence | `app_settings` / `AppSettingsRepository` | Không dùng làm store cho nhiều Change Info preset |
| Named preset pattern | Persistence | `import_presets` CRUD trong AccountRepository | Dùng pattern nhiều bản ghi; Batch 2 tạo generic workspace preset store |
| Scenario composition | Canonical workflow | Scenario repository/runner + Action Registry | Before/After chỉ giữ reference scenario; không copy scenario definition |
| Global pacing / browser lifecycle | Facebook common | Common Runtime / paced Facebook page / browser launch gate hiện hành | Atomic action không được bypass |

---

## 3. Workspace type contract

Batch 2 mở rộng:

```ts
ActionWorkspaceType = 'interaction' | 'group' | 'change_info'
```

`change_info` tiếp tục dùng:

```text
action_workspaces
  id
  workspace_type = 'change_info'
  label
  config_json
  created_at
  updated_at

action_workspace_accounts
  workspace_id
  account_id
  sort_order
  enabled
```

Không cần migration chỉ để cho phép value `change_info` vì `workspace_type` hiện là TEXT không có SQL enum constraint. Type validation/repository/UI phải được mở rộng đồng bộ.

### Account Manager entry

Batch 2 phải có entry từ selection hiện tại:

```text
selected AccountRecord.id[]
  -> mở route Hành động
  -> tạo/mở Change Info workspace
  -> bind đúng các account ID đã chọn
```

Không serialize Password/Cookie/2FA vào renderer handoff hay workspace config.

---

## 4. Change Info catalog contract

### 4.1. Tách support status khỏi global runtime status

Global Action Registry hiện có:

```ts
ActionRuntimeStatus = 'placeholder' | 'ready'
```

Không đổi semantics này thành `audit_required`.

Change Info catalog có status riêng:

```ts
type ChangeInfoSupportStatus = 'audit_required' | 'ready'
```

Mỗi catalog item tối thiểu:

```ts
interface ChangeInfoCatalogItem {
  key: string
  category: ChangeInfoCategory
  label: string
  supportStatus: ChangeInfoSupportStatus
  actionType: string | null
  allowedSources: readonly ChangeInfoDataSourceType[]
  destructive?: boolean
  canonicalAccountField?: AccountWritableField
}
```

Quy tắc:

- `audit_required`: hiện được trong UI catalog để biết roadmap/capability, nhưng **không được Start** nếu đang enabled.
- `ready`: phải có `actionType` trỏ tới action canonical có `runtimeStatus === 'ready'` + actor `profile` + executor thật.
- Không tạo placeholder Action Registry chỉ để làm UI Change Info.
- Một item chỉ chuyển `audit_required -> ready` sau live audit editor + Save + post-state verifier của chính field đó.

### 4.2. Category UI Change Info

Catalog workspace dùng các nhóm:

1. `personal` — Thông tin cá nhân.
2. `education_work` — Học tập & công việc.
3. `media` — Ảnh hồ sơ.
4. `privacy` — Quyền riêng tư.
5. `account_mode` — Chế độ tài khoản.
6. `security_contact` — Bảo mật & liên hệ.
7. `workflow` — Workflow & runtime.

Các category này là UI/workspace catalog; không ép phải trùng `ScenarioActionCategory`.

Khi atomic Profile action đầu tiên được đưa vào global Action Registry, thêm category canonical `profile` vào Scenario/Action Picker thay vì nhét tất cả vào `other`.

---

## 5. Inventory action tại baseline

Tại baseline Batch 1 **chưa có** atomic executor/registry action cho các mutation Account/Profile của #306. Vì vậy tất cả mutation dưới đây bắt đầu ở `audit_required`.

| Catalog item | Phân loại | Baseline | Hướng xử lý |
|---|---|---|---|
| Display name | Action FB | Chưa có action canonical | Live audit -> atomic Profile action -> verifier -> ready |
| Birthday | Action FB | Chưa có | Live audit riêng |
| Gender | Action FB | Chưa có | Chỉ làm nếu surface hiện hành rõ và verify được |
| Bio | Action FB | Chưa có | Live audit riêng |
| Nickname / other name | Action FB | Chưa có | Live audit riêng |
| Language | Action FB | Chưa có | Live audit riêng |
| Website | Action FB | Chưa có | Live audit riêng |
| University / High School | Action FB | Chưa có | Live audit từng editor |
| Work / Company / Job title | Action FB | Chưa có | Live audit từng editor |
| Current city / Hometown | Action FB | Chưa có | Live audit từng editor |
| Relationship | Action FB | Chưa có | Live audit riêng |
| Avatar / Cover | Action FB + media | Chưa có Change Info atomic action | Live audit upload/save/verify; Data Source folder resolve thành file cụ thể |
| Featured photos | Action FB + media | Chưa có | Audit support trước |
| Follow / visibility controls | Action FB | Chưa có | Audit current state reader + toggle + verify |
| Professional Mode | Action FB | Chưa có | Audit enable/disable riêng |
| Profile protection/lock | Action FB | Chưa có | Không giả support; region/account dependent |
| Facebook password | Security action | Không có Facebook password action trong Action Registry | Audit/reuse Common Runtime; secret qua runtime data, verified success mới update `accounts.password` |
| 2FA enable/disable | Security action | Chưa có canonical FB action | Audit + destructive confirmation + no blind retry |
| Logout other sessions | Security action | Chưa có | Audit riêng |
| Username | Action FB | Chưa có | Audit availability + verifier; success mới update `accounts.username` |
| Add/remove email | Security/contact | Chưa có FB action canonical | Reuse account/email canonical data, không copy Microsoft email runtime vào Facebook action |
| Add/remove phone | Security/contact | Chưa có | Audit/provider flow riêng |
| Before/After Scenario | Composition | Scenario canonical đã có | Chỉ reference scenario ID; implement orchestration ở batch sau |
| Random/sequential/file/folder | Config/Data Source | Có pattern rời rạc ở workspace khác | Chuẩn hóa tại Change Info workspace layer, không thành Facebook action |
| accountConcurrency | Orchestration | rolling pool + global lease đã có | Reuse; default 1 |
| Global action delay | Common runtime | Đã có | Không cho Change Info override/bypass |

Các mục copy post/copy album/xóa content/token/proxy reset không thuộc core Change Info.

---

## 6. Common Data Source contract

Data Source là **workspace-layer config**, không nằm trong atomic Action Registry schema.

```ts
type ChangeInfoDataSourceType =
  | 'fixed'
  | 'list'
  | 'file'
  | 'folder'
  | 'random_from_list'
  | 'sequential_from_list'
  | 'random_generator'
  | 'source_profile'
```

Mỗi catalog item khai báo `allowedSources`; không action nào mặc định hỗ trợ tất cả source type.

### 6.1. Persisted source config

Workspace/preset có thể persist source **definition**, ví dụ:

```ts
interface ChangeInfoDataSourceConfig {
  type: ChangeInfoDataSourceType
  value?: string | number | boolean
  values?: Array<string | number | boolean>
  path?: string
  generatorId?: string
  sourceProfileUid?: string
}
```

Schema code cuối cùng có thể dùng discriminated union chặt hơn; contract bắt buộc là không persist credential plaintext.

### 6.2. Resolution boundary

Trước khi gọi atomic action:

```text
workspace Data Source
  -> resolve once for account + catalog item
  -> frozen assignment
  -> scalar ActionConfig
     + optional ephemeral runtimeData
  -> ActionRunRequest
```

`ActionConfig` canonical tiếp tục chỉ là scalar `string | number | boolean`.

Không nới `ActionConfig` thành nested arbitrary object chỉ để chứa Data Source.

### 6.3. Determinism / snapshot

Khi Start:

- snapshot workspace `configJson`;
- snapshot enabled account IDs + order;
- snapshot action order/enabled state;
- list/file: snapshot values dùng cho run;
- folder: snapshot candidate file list dùng cho run;
- sequential: snapshot cursor/order;
- random: resolve assignment một lần và giữ assignment per account/action;
- Stop/Resume của cùng run không random lại assignment đã chốt;
- không mutate source list/folder gốc sau khi một account dùng xong.

### 6.4. Secret data

Action Registry hiện cấm secret-like keys trong persisted action config. Contract giữ nguyên.

- Password/2FA/cookie/email password hiện có: đọc từ canonical Account/Common Session Policy khi action cần.
- Secret mới do Change Info tạo/nhập: chỉ được mang trong **ephemeral runtime data** hoặc secret reference chuyên biệt, không ghi vào preset/workspace config/log/evidence.
- Log/result metadata chỉ lưu masked/safe metadata, không plaintext secret.
- Canonical secret field chỉ update sau verified mutation success.

`source_profile` giữ `audit_required` cho từng field cho tới khi có flow đọc nguồn hợp lệ; không scrape/profile-copy chung theo đoán.

---

## 7. Atomic action invocation contract

Một Change Info item `ready` phải resolve thành đúng một atomic action invocation:

```ts
interface ResolvedChangeInfoInvocation {
  catalogKey: string
  actionType: string
  label: string
  config: Record<string, string | number | boolean>
  runtimeData?: unknown
}
```

Request gửi vào common runner:

```ts
{
  runKey,
  actionType,
  label,
  actor: {
    kind: 'profile',
    accountId,
    accountUid
  },
  config,
  runtimeData,
  retry: { maxAttempts: 1, delayMs: 0, retryableCodes: [] }
}
```

Retry có thể được mở riêng cho lỗi read-only/transient sau audit; **consequential mutation không blind retry**. `verification_uncertain` luôn non-retryable theo common runner.

Action của cùng một account chạy tuần tự theo order snapshot. Không chạy song song nhiều Profile mutation trên cùng browser/account.

---

## 8. Live audit gate cho từng atomic action

Ba kiểu mở editor đã xác nhận cần support:

```text
row -> pencil -> editor
row -> ... -> Edit <field> -> editor
section -> + Add <field> -> editor
```

Mỗi action phải có support matrix trước implementation:

```text
catalogKey/actionType
surface + route
actor = profile
preconditions
exact section scope
current-state reader
editor opening mode
scoped control strategy
mutation sequence
Save/commit behavior
immediate verifier
safe revisit verifier
pending/review semantics
locale/layout variants
idempotency/retry policy
needs_attention states
evidence policy
canonical field mapping (nếu có)
```

Selector rule:

- scope đúng section -> row -> control;
- không dùng global page-wide `nth()`;
- text/role/label chỉ dùng trong scope semantic đã xác định;
- editor phải được xác định bằng relationship với field/row/section, không “modal thứ N”.

`click()`/`Save()` resolve **không phải success**.

Verifier ưu tiên:

```text
immediate target-scoped state
  -> nếu chưa chắc: stabilize/layout guard
  -> revisit exact target bằng read-only navigation
  -> bounded poll
  -> verified hoặc verification_uncertain
```

Không lặp lại consequential click khi outcome chưa chắc.

---

## 9. Result contract

### 9.1. Per-action result

Giữ `ActionResult` canonical:

```text
success
skipped
needs_attention
failed
stopped
```

Mỗi Change Info action runtime lưu safe metadata tối thiểu:

```ts
interface ChangeInfoActionRuntimeResult {
  catalogKey: string
  actionType: string
  orderIndex: number
  status: 'success' | 'skipped' | 'needs_attention' | 'failed' | 'stopped'
  code?: string
  message?: string
  attempts: number
  startedAt: number
  finishedAt: number
  sourceMeta?: Record<string, unknown> // secret-safe only
}
```

Không lưu secret value trong `sourceMeta`.

### 9.2. Per-account aggregate

```ts
type ChangeInfoAccountResultStatus =
  | 'success'
  | 'partial_success'
  | 'needs_attention'
  | 'failed'
  | 'stopped'
```

Priority/semantics:

1. `stopped`: run/account bị Stop trước khi hoàn tất; các success trước đó vẫn giữ nguyên.
2. `needs_attention`: có action/session yêu cầu manual attention; không chạy tiếp mutation nguy hiểm sau boundary đó.
3. `partial_success`: không có attention/stop, có ít nhất một success và ít nhất một failed.
4. `failed`: không có success và có failed.
5. `success`: toàn bộ runnable action success hoặc skipped hợp lệ.

`audit_required` enabled không được biến thành skipped; validation phải block Start trước run.

Không rollback giả những Facebook mutation đã verified success trước khi action sau lỗi.

---

## 10. Canonical Account update contract

Sau mỗi atomic action **verified success**, action-specific integration mới được update canonical Account field nếu app đang sở hữu field đó.

Candidate hiện có:

```text
name
username
password
email
backupEmail
phone
```

Mapping cuối cùng chỉ mở khi action tương ứng live-audit xong.

Không thêm DB column hometown/work/school/bio/... chỉ để mirror Facebook About nếu app không có nghiệp vụ cần canonical hóa field đó.

`pending`, `needs_attention`, `failed`, `verification_uncertain` không được ghi DB như mutation đã thành công.

---

## 11. Preset persistence contract

Change Info cần nhiều named preset CRUD và preset không chứa account selection.

Không dùng `AppSettings` singleton JSON list.

Batch 2 tạo generic workspace preset store:

```text
action_workspace_presets
  id
  workspace_type
  name
  config_json
  created_at
  updated_at
  UNIQUE(workspace_type, name)
```

Mục tiêu là reusable cho workspace khác về sau, không tạo table `change_info_presets` riêng.

Preset lưu:

- selected/enabled catalog items;
- workspace item config;
- Data Source definitions không secret;
- action order;
- optional before/after scenario references khi capability được mở;
- runtime defaults phù hợp.

Preset không lưu:

- account IDs/bindings;
- cookie/password/2FA/email password/proxy password;
- run snapshot/cursor assignment;
- resolved random secret/value per account.

---

## 12. Before / After Scenario contract

Workspace config có thể dành chỗ cho reference:

```ts
beforeScenarioId: number | null
afterScenarioId: number | null
```

Không copy Scenario JSON/action definition vào Change Info.

Batch runtime sau phải resolve scenario canonical tại Start và snapshot reference/content theo semantics Scenario hiện hành.

Failure policy mặc định được khóa:

- Before Scenario `failed` / `needs_attention` -> **không chạy Change Info** cho account đó.
- Change Info có ordinary action failure nhưng không `needs_attention` -> tiếp tục các action còn lại theo per-action policy; sau cùng có thể `partial_success`.
- `needs_attention` -> dừng chuỗi account tại safe boundary.
- After Scenario chỉ chạy khi account không `stopped` và không `needs_attention`; ordinary Change Info `partial_success` vẫn cho phép After chạy để workflow cleanup/follow-up có thể hoàn tất.

Batch 6 mới implement orchestration này.

---

## 13. Concurrency / lifecycle contract

```text
accountConcurrency default = 1
```

- dùng `runRollingAccountPool`;
- lease bằng `AccountExecutionCoordinator.tryAcquireLease`;
- account bị workspace khác lock không chiếm slot nếu account kế tiếp runnable;
- Pause: không cấp account/action mới; action hiện tại dừng tại cooperative pause point;
- Resume: tiếp tục frozen run assignment;
- Stop: không cấp mutation mới, dừng tại safe boundary, release lease/browser đúng common lifecycle;
- browser launch spacing và Facebook action pacing vẫn do common runtime/settings quản lý;
- delay riêng Change Info nếu thêm sau chỉ là delay cộng thêm.

---

## 14. Batch 2 implementation boundary

Batch 2 được phép làm framework/shell sau khi contract này merge/được owner cho triển khai:

1. mở rộng `ActionWorkspaceType` với `change_info`;
2. Change Info definition/tab + Account Manager entry/binding;
3. typed workspace draft parser/serializer/version;
4. catalog UI + search/category + dynamic config;
5. `ChangeInfoSupportStatus = audit_required | ready`;
6. Data Source types/parser/validation/resolver framework;
7. generic `action_workspace_presets` migration/repository/IPC/UI CRUD;
8. contract tests/persistence tests;
9. Start validation phải chặn item `audit_required`;
10. **không có Facebook selector/executor mutation thật trong Batch 2 nếu action chưa live-audit**.

---

## 15. Acceptance của Batch 1

- [x] Đã đọc baseline plan/principles/architecture + #140/#233/#306.
- [x] Đã verify remote baseline sau installer/updater.
- [x] Đã audit Account Manager selection/context, workspace persistence, Action Registry/Runner, Profile actor host, rolling pool/lease, verification, preset/settings pattern và canonical Account fields.
- [x] Đã chốt `change_info` là workspace type dùng `action_workspaces` + binding hiện có.
- [x] Đã tách Change Info `audit_required|ready` khỏi global `placeholder|ready`.
- [x] Đã khóa Data Source resolution ở workspace layer -> scalar config + optional ephemeral runtime data.
- [x] Đã khóa deterministic run snapshot/random assignment.
- [x] Đã khóa secret handling không persist vào preset/action config/log.
- [x] Đã khóa per-action/per-account result semantics.
- [x] Đã khóa generic named preset persistence direction.
- [x] Đã khóa live-audit gate + scoped locator + post-state verification.
- [x] Không hard-code selector Facebook.
- [x] Không tạo runtime/registry/account store riêng.

Batch 1 không tuyên bố bất kỳ mutation Profile nào là production-ready.