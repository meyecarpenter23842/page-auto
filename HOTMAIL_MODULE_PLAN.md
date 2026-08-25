# PAGE-AUTO — HOTMAIL / EMAIL MODULE PLAN

> Tài liệu kế hoạch riêng cho module Hotmail/Outlook của PAGE-AUTO.  
> Mục tiêu: đạt mức nghiệp vụ quản lý mail kiểu MaxHotmail, nhưng giữ đúng kiến trúc PAGE-AUTO và không làm lẫn domain Facebook.
>
> Baseline kiến trúc vẫn theo `PROJECT_PLAN.md`: Electron + React + TypeScript + Vite + Playwright + SQLite + Drizzle; Electron Main quản lý DB/runtime; browser chạy worker riêng; renderer chỉ dùng typed IPC.

---

## 1. Mục tiêu module

Module Email/Hotmail phải trở thành một **trung tâm quản lý mailbox + profile + runtime automation độc lập**, không còn là một popup phụ.

Mục tiêu chính:

- Quản lý số lượng lớn Hotmail/Outlook trong data-grid mật độ cao.
- Account Email dùng dữ liệu account gốc từ Account Manager, không copy credential sang bảng riêng.
- 1 UID/account Facebook có thể gắn Email/PassEmail/BackupEmail/OAuth state/profile Email.
- Dùng đúng **Email Profile Root** đã chọn.
- Quy tắc profile: **1 UID = 1 folder `EmailProfileRoot\UID`**.
- Mở đúng profile cũ tại chỗ; không clone/copy/fallback sang thư mục khác.
- Browser Email mặc định **Auto**, manual executable chỉ là Advanced override.
- Hỗ trợ mở/check/lấy code hàng loạt.
- Hỗ trợ proxy/IP pool riêng cho Email.
- Hỗ trợ Microsoft OAuth + Microsoft Graph để đọc mailbox.
- Hỗ trợ recovery mail provider/catalog.
- Có runtime worker riêng cho Email.
- Có log đủ để biết chính xác UID nào đang dùng profile/browser/proxy nào.
- Không để lỗi Hotmail ảnh hưởng Facebook.
- Không tự động bypass checkpoint / identity verification / security lock của Microsoft. Nếu gặp bước xác minh danh tính thì chuyển manual handling.

---

# 2. Nguyên tắc kiến trúc bắt buộc

## 2.1. Tách domain

Cấu trúc mục tiêu:

```text
apps/desktop/src/main/
  browser/
    core/
      browserExecutableProbe.ts
      browserProcessLifecycle.ts
      browserWindowLayout.ts
      browserErrors.ts
      browserTypes.ts

  facebook/
    profile/
    session/
    page/
    posting/
    runtime/

  email/
    profile/
      emailProfileResolver.ts
      emailProfileInspector.ts
      emailProfileService.ts

    browser/
      emailBrowserExecutable.ts
      emailBrowserValidation.ts
      emailBrowserManager.ts
      email-browser-worker.ts
      emailWindowLayout.ts

    microsoft/
      microsoftOAuthService.ts
      microsoftGraphMailAdapter.ts
      verificationCodeParser.ts

    recovery/
      emailRecoveryProviders.ts
      emailRecoveryService.ts

    proxy/
      emailProxyPool.ts
      emailProxyTester.ts

    runtime/
      emailRuntimeCoordinator.ts
      emailBatchWorkerManager.ts
      emailRuntimeState.ts

    emailService.ts
    emailIpc.ts
```

## 2.2. Quy tắc dùng chung

Chỉ đưa vào `browser/core` nếu hành vi thực sự giống nhau giữa Facebook và Email.

Có thể dùng chung:

- kiểm tra file executable tồn tại;
- process lifecycle primitive;
- timeout primitive;
- window placement primitive;
- typed browser error primitive;
- logging primitive.

Không dùng chung nghiệp vụ:

- Email Profile Root;
- `root\UID`;
- Outlook URL;
- Microsoft OAuth;
- Graph Mail;
- Email proxy pool;
- Email recovery;
- Email runtime state;
- Facebook cookie/session;
- Page switch;
- Group posting;
- Facebook checkpoint state.

## 2.3. Không reuse sai ngữ cảnh

Email runtime thật dùng persistent profile thì browser validation cũng phải test theo persistent profile.

Không được:

```text
test bằng chromium.launch()
nhưng runtime lại dùng launchPersistentContext()
```

Mọi validation Email phải phản ánh đúng cách runtime Email thực sự mở.

---

# 3. Phạm vi tính năng mục tiêu kiểu MaxHotmail

## 3.1. Data-grid Email chính

Grid là trung tâm của module.

Cột mặc định:

- Checkbox
- STT
- UID
- Email
- Pass Email (mask)
- Mail khôi phục
- Loại mail khôi phục
- Tên
- OAuth2
- Mail Status
- Profile Status
- Profile Path
- Browser
- Proxy/IP
- Ngày tạo
- Thư mục/Category
- Tình trạng
- Runtime
- Code mới nhất
- Thời gian lấy code
- Lỗi gần nhất
- Ghi chú

Hỗ trợ:

- chọn nhiều dòng;
- Ctrl/Shift selection;
- select all;
- filter;
- sort;
- search UID/Email;
- filter theo status;
- filter theo folder/category;
- hide/show/reorder/resize cột;
- persist grid layout;
- row density compact;
- trạng thái màu;
- sticky header;
- virtual scrolling nếu account lớn.

## 3.2. Màu trạng thái

Ví dụ:

- xanh dương: đang chọn / đang chạy;
- xanh lá: mail sống / ready;
- đỏ/hồng: lỗi / dead / needs login;
- vàng: pending / waiting;
- xám: unknown / chưa check.

Màu chỉ hỗ trợ nhìn nhanh; status text vẫn bắt buộc.

---

# 4. Toolbar chính

Toolbar đề xuất:

```text
[Mở Profile]
[Lấy Code]
[Check Mail]
[Kết nối Microsoft]
[Refresh]
[Proxy/IP]
[Thao tác khác ▼]
[Thiết lập Email]
```

Bulk actions:

- Mở profile hàng loạt
- Đóng profile hàng loạt
- Check mail hàng loạt
- Lấy code hàng loạt
- Kết nối lại Microsoft
- Refresh trạng thái profile
- Gán category/folder
- Copy Email
- Copy UID
- Copy Profile Path
- Mở thư mục profile
- Export kết quả được chọn

---

# 5. Context menu kiểu MaxHotmail

Chuột phải trên account:

```text
Mở mail / profile
Mở thư mục profile
Copy đường dẫn profile
Check mail
Lấy verification code
Kết nối Microsoft
Kết nối lại Microsoft
Refresh profile
Đóng profile
-----------------
Copy Email
Copy UID
Copy Backup Email
Copy trạng thái
-----------------
Gán Category
Ghi chú
```

Nếu nhiều dòng đang selected thì context menu áp dụng cho selection.

---

# 6. Profile lifecycle

## 6.1. Email Profile Root

User chọn:

```text
F:\...\MaxHotmail\profiles
```

Với UID:

```text
615123456789
```

PAGE-AUTO phải resolve đúng:

```text
F:\...\MaxHotmail\profiles\615123456789
```

Không:

- scan thư mục khác;
- tự thêm tầng `profiles`;
- fallback sang `data\browser-profiles`;
- clone profile;
- tạo UID-copy;
- tạo UID-2.

## 6.2. Trạng thái profile

Typed state:

```text
not_configured
missing
available
running
in_use
opening
error
```

UI label:

- Chưa cấu hình
- Chưa có profile
- Có profile
- Đang mở
- Đang sử dụng
- Đang mở...
- Lỗi

## 6.3. Tạo profile

Scan/list không tự tạo.

Chỉ tạo profile khi user:

- bấm `Tạo / mở profile`;
- hoặc luồng automation rõ ràng được cấu hình cho phép tạo.

Tạo đúng:

```text
root\UID
```

Concurrent create phải idempotent.

## 6.4. Profile path phải nhìn thấy

Grid phải có `Profile Path`.

Ví dụ:

```text
F:\MaxHotmail\profiles\615123456789
```

Không chỉ hiển thị `Sẵn sàng`.

Status/log khi mở:

```text
UID=615123456789
Profile=F:\...\profiles\615123456789
Browser=Auto -> C:\Program Files\Google\Chrome\Application\chrome.exe
Proxy=Direct
Result=Started
```

## 6.5. Tiện ích profile

- Mở thư mục profile.
- Copy path.
- Refresh profile state.
- Check lock.
- Check live CDP.
- Show profile root.
- Show profile folder exists/missing.

---

# 7. Browser Email

## 7.1. Chế độ Browser

Mặc định:

```text
Browser Email: Auto
```

Advanced:

```text
Manual executable override
```

Không bắt user phải chọn `.exe`.

## 7.2. Auto detect candidate

Thứ tự gợi ý:

1. browser phù hợp cạnh MaxHotmail/profile root;
2. Chrome system;
3. Edge system;
4. Chromium system;
5. app-level fallback đã validated.

## 7.3. Validation đúng runtime

Không chỉ test browser mở blank.

Email validation phải:

1. nhận executable;
2. nhận temporary/purpose-built persistent test profile;
3. gọi đúng `launchPersistentContext`;
4. xác nhận browser sống đủ thời gian;
5. tạo page;
6. navigate `about:blank`;
7. xác nhận context không tự close;
8. đóng sạch.

Manual executable fail:

```text
Browser Email không khởi động được với persistent profile.
```

Auto mode:

- candidate fail -> thử candidate kế tiếp;
- candidate pass -> dùng candidate đó;
- cache theo executable + version + runtime mode;
- invalid cache phải tự invalidate.

## 7.4. Existing MaxHotmail profile

Nếu profile đang chạy và có live CDP:

- attach;
- không mở process thứ hai;
- proxy giữ theo process hiện tại.

Nếu `DevToolsActivePort` stale:

- probe fail;
- nếu không có lock thật -> relaunch cùng profile.

Nếu lock thật:

```text
Đang sử dụng
```

Không xóa lock file.

## 7.5. Browser window layout

Học từ MaxHotmail nhưng không phụ thuộc ChromeDriver:

- số Chrome hiển thị đồng thời;
- bố trí grid X × Y;
- spacing;
- delay giữa lần mở;
- optional compact mode riêng Email;
- remember placement.

Không dùng `Update ChromeDriver`.

---

# 8. Runtime / luồng auto Email

## 8.1. State machine

```text
idle
-> queued
-> resolving_profile
-> resolving_browser
-> acquiring_proxy
-> opening_browser
-> attaching_browser
-> opening_mail
-> checking_mail
-> reading_code
-> ready
-> completed
```

Error states:

```text
needs_login
profile_in_use
browser_failed
proxy_failed
oauth_expired
mail_error
manual_verification
error
```

## 8.2. Batch runtime

Hỗ trợ:

- chạy 1 account;
- chạy selection;
- chạy tất cả account theo filter;
- giới hạn số luồng;
- queue;
- pause;
- resume;
- stop;
- stop all.

Không spawn vô hạn.

## 8.3. Concurrency

Email có cấu hình:

```text
Max concurrent Email workers
Delay mở browser
Delay giữa account
Timeout mở browser
Timeout check mail
```

Mỗi account độc lập.

Facebook runtime không dùng concurrency limit này.

## 8.4. Worker isolation

Email browser chạy utility worker riêng.

Crash worker:

- UI không treo;
- runtime account -> error;
- ghi log;
- release proxy;
- cho phép retry thủ công.

---

# 9. Mail / Microsoft OAuth

## 9.1. Microsoft OAuth

Hỗ trợ:

- connect Microsoft;
- reconnect;
- token state;
- token refresh;
- OAuth status.

State:

```text
missing
pending
valid
expired
error
```

## 9.2. Microsoft Graph

Chức năng:

- check mailbox;
- đọc recent messages;
- lấy verification code;
- lấy sender;
- lấy received time;
- lưu code gần nhất;
- không hiển thị plaintext refresh token.

## 9.3. Verification code

Parser:

- nhiều template mail;
- sender/domain filter;
- code pattern adapter;
- tránh lấy code quá cũ;
- lưu timestamp.

Grid hiển thị:

- Latest Code
- Received At
- Source/Sender

---

# 10. Recovery Mail

## 10.1. Dữ liệu

- Backup Email
- Provider
- Domain
- Status
- Note

## 10.2. Provider catalog

Hỗ trợ catalog provider/domain kiểu MaxHotmail:

- Outlook/Hotmail
- Gmail
- Mail thường
- Mail dùng nhanh/temporary
- Custom domain

Catalog chỉ là metadata, không khóa hệ thống vào provider cố định.

## 10.3. Recovery actions

- copy recovery mail;
- detect provider;
- open provider;
- check field completeness;
- filter account thiếu recovery;
- filter account có recovery.

## 10.4. Security boundary

Nếu Microsoft yêu cầu:

- checkpoint;
- identity verification;
- security review;
- locked account requiring ownership proof;

PAGE-AUTO chuyển:

```text
manual_verification
```

và mở đúng profile để người vận hành xử lý.

Không tự động bypass bước xác minh danh tính.

---

# 11. Proxy / đổi IP

## 11.1. Chế độ

```text
Direct
Random IPv4 pool
Fixed per account
Provider-based rotation (optional)
```

## 11.2. Pool

- import proxy list;
- parse host:port:user:pass;
- mask password;
- test proxy;
- public IP;
- current proxy;
- fail count;
- rotate;
- cooldown;
- disable bad proxy tạm thời.

## 11.3. Concurrency

Giới hạn riêng:

```text
Max proxy workers
Max concurrent IP rotations
```

## 11.4. UI

Settings Proxy:

- mode;
- pool;
- current IP;
- test;
- rotate;
- status.

Grid có cột `Proxy/IP`.

---

# 12. CAPTCHA / provider adapter

PAGE-AUTO đã có CAPTCHA provider foundation.

Email module có thể dùng adapter cho CAPTCHA challenge được hỗ trợ:

- 2Captcha
- OmoCaptcha
- EzCaptcha
- provider khác qua adapter

Yêu cầu:

- API key mask;
- test provider;
- provider state;
- không log API key;
- config backup không chứa API key.

Checkpoint/identity verification không được route thành CAPTCHA solve.

---

# 13. SMS / OTP provider framework

Để đạt mức mở rộng như MaxHotmail, kiến trúc có thể chuẩn bị adapter:

```text
OtpProviderAdapter
```

Provider được thêm dưới dạng plugin/config:

- provider name;
- API key secret;
- balance check;
- request number;
- read code;
- cancel/finish request.

Không hard-code logic provider vào Email UI.

Mặc định phase đầu chỉ dựng framework + settings; không tự động dùng để bypass ownership verification.

---

# 14. Settings Email

## 14.1. Profile & Browser

- Email Profile Root
- Browser Mode: Auto / Manual
- Manual executable
- Test browser
- Max concurrent browsers
- Delay open
- Timeout
- Window grid
- Show/Hide browser
- Open minimized (nếu browser/platform hỗ trợ an toàn)
- Current detected browser

## 14.2. Microsoft

- OAuth Client ID
- Tenant
- Connection status
- Reconnect
- Test Graph

## 14.3. Recovery

- provider catalog
- domain mapping
- custom provider/domain

## 14.4. Proxy

- Direct / Random
- proxy list
- test
- rotate
- concurrency

## 14.5. CAPTCHA

- provider
- API key
- test

## 14.6. OTP

- provider adapter config
- API key
- test balance

---

# 15. Logging

Mỗi action phải có structured log.

Ví dụ:

```text
timestamp
accountId
uid
email
action
profileRoot
profileDirectory
browserMode
resolvedExecutable
proxyDisplay
runtimeState
result
durationMs
errorCode
errorMessage
```

Không log:

- password;
- pass email;
- cookie;
- 2FA;
- refresh token;
- proxy password;
- CAPTCHA key;
- OTP key.

## 15.1. Log UI

Có panel log:

- filter UID;
- filter action;
- filter success/error;
- copy log;
- export sanitized log.

---

# 16. Import / dữ liệu account

Email module không tạo account database riêng.

Nguồn dữ liệu vẫn là Account Manager:

```text
UID
Email
PassEmail
BackupEmail
Name
Category
Note
...
```

Email module chỉ thêm state:

- OAuth state;
- mail state;
- profile state;
- runtime state;
- latest code;
- last check;
- Email-specific settings.

Không duplicate credential.

---

# 17. Database mục tiêu

Bảng chính liên quan Email:

```text
accounts

account_email_state
  account_id
  provider
  oauth_status
  refresh_token_ciphertext
  mail_status
  last_check_at
  last_code
  last_code_at
  last_error
  updated_at

email_profile_settings
  id
  external_root
  browser_mode
  browser_executable
  max_concurrency
  open_delay_ms
  startup_timeout_ms
  window_layout_json
  oauth_client_id
  oauth_tenant
  updated_at

email_proxy_settings
  id
  mode
  proxy_list_json
  updated_at

email_runtime_sessions
  id
  account_id
  state
  profile_directory
  resolved_executable
  proxy_display
  started_at
  finished_at
  last_error

email_runtime_events
  id
  session_id
  event
  payload_sanitized_json
  created_at
```

Có thể bổ sung migration dần, không phá schema hiện hành.

---

# 18. UI parity với MaxHotmail

| Nhóm | MaxHotmail-style target | PAGE-AUTO target |
|---|---|---|
| Dense grid | Có | Bắt buộc |
| Checkbox bulk | Có | Bắt buộc |
| Context menu | Có | Bắt buộc |
| Status colors | Có | Bắt buộc |
| Folder profiles | Có | Bắt buộc + hiển thị rõ hơn |
| Multi browser threads | Có | Bắt buộc |
| Browser layout | Có | Nên có |
| Delay open/close | Có | Bắt buộc |
| Proxy/IP rotation | Có | Bắt buộc |
| Recovery mail | Có | Bắt buộc |
| OAuth2 | Có | Bắt buộc |
| Check mail | Có | Bắt buộc |
| Verification code | Có | Bắt buộc |
| Captcha provider | Có | Adapter |
| OTP provider | Có | Adapter framework |
| ChromeDriver update | Có | Không dùng; Playwright thay thế |
| Auto unlock security lock | Có trong một số workflow | Không bypass; manual verification |
| Profile path visibility | Hạn chế | PAGE-AUTO phải tốt hơn |
| Browser executable visibility | Hạn chế | Auto mặc định + log resolved path |
| Structured logs | Hạn chế | PAGE-AUTO phải tốt hơn |

---

# 19. Luồng người dùng chuẩn

## 19.1. Setup lần đầu

1. Mở Email.
2. Chọn `Email Profile Root`.
3. Browser để `Auto`.
4. Cấu hình Microsoft OAuth.
5. Cấu hình Proxy nếu cần.
6. Save.
7. Grid refresh profile state.

## 19.2. Mở profile

1. Chọn account.
2. Bấm `Mở Profile`.
3. Resolve `root\UID`.
4. Nếu running + CDP -> attach.
5. Nếu available -> resolve browser.
6. Launch persistent context.
7. Open Outlook.
8. UI log full path + browser.

## 19.3. Lấy code hàng loạt

1. Select accounts.
2. `Lấy Code`.
3. Queue theo concurrency.
4. Refresh OAuth token.
5. Graph read.
6. Parse code.
7. Update grid.
8. Report success/error per account.

## 19.4. Batch open profile

1. Select N accounts.
2. Start.
3. Queue.
4. Max concurrency.
5. Delay giữa mỗi browser.
6. Window layout.
7. Stop/Pause/Resume.

---

# 20. Refactor hiện trạng

## Phase H0 — Audit + boundary

- map toàn bộ Email imports;
- map browser shared dependency;
- xác định chỗ Email đang reuse BrowserEngineService sai semantics;
- không đổi behavior.

Acceptance:

- dependency map rõ;
- danh sách file Facebook-specific trong `browser/`;
- danh sách file Email-specific.

## Phase H1 — Profile visibility

- thêm Profile Path column;
- full path trong runtime message;
- context menu Open Folder / Copy Path;
- current Profile Root visible;
- test resolve đúng `root\UID`.

Acceptance:

- user nhìn UI biết chính xác profile nào đang dùng.

## Phase H2 — Browser Email validation

- Browser Mode Auto/Manual;
- persistent-context validation;
- Auto candidate fallback;
- không reuse test browser thường cho Email;
- friendly diagnostics;
- regression test “flash then exit”.

Acceptance:

- manual bad executable bị reject;
- auto mode thử candidate khác;
- runtime và validation dùng cùng launch semantics.

## Phase H3 — Email runtime coordinator

- state machine;
- queue;
- concurrency;
- pause/resume/stop;
- worker isolation;
- structured runtime events.

## Phase H4 — Grid + bulk operations

- dense grid;
- status colors;
- selection;
- context menu;
- bulk open/check/code;
- persist layout.

## Phase H5 — Microsoft mail operations

- OAuth connection UX;
- Graph check;
- code retrieval;
- batch result.

## Phase H6 — Proxy/IP

- pool;
- rotate;
- test;
- fail policy;
- current IP;
- per-account status.

## Phase H7 — Recovery providers

- provider catalog;
- domain detection;
- filters;
- actions.

## Phase H8 — CAPTCHA / OTP adapters

- settings;
- provider interface;
- test;
- no bypass identity verification.

## Phase H9 — Window management

- browser grid;
- max windows;
- delay;
- compact layout;
- restore placement.

## Phase H10 — Logs + diagnostics

- runtime log UI;
- sanitized export;
- browser/profile diagnostics;
- support bundle.

---

# 21. Test plan

## Profile

- root empty;
- root invalid;
- root exists;
- UID profile exists;
- UID missing;
- concurrent create;
- stale DevToolsActivePort;
- live CDP;
- profile lock;
- exact `root\UID`;
- no fallback.

## Browser

- manual valid;
- manual bad;
- browser flashes then exits;
- persistent context pass;
- auto candidate fail -> next candidate;
- cache invalidation;
- worker crash.

## OAuth/Mail

- missing OAuth;
- valid OAuth;
- expired token refresh;
- Graph 401/403;
- no code;
- new code;
- old code;
- sender filtering.

## Proxy

- Direct;
- valid proxy;
- bad proxy;
- rotate;
- pool empty;
- concurrency;
- release after worker crash.

## Batch

- 1 account;
- 10 accounts;
- 100+ accounts;
- pause;
- resume;
- stop;
- partial failures;
- worker crash.

## UI

- grid layout persist;
- hidden column persist;
- context menu selection;
- bulk selection;
- profile path visible;
- status color;
- masked secrets.

---

# 22. Acceptance Criteria cuối

Module Email chỉ được coi hoàn thiện khi:

1. User chọn Profile Root và UI luôn cho thấy root đang dùng.
2. Mỗi UID resolve đúng `root\UID`.
3. Grid hiển thị full Profile Path.
4. Browser Auto hoạt động mặc định.
5. Manual browser được test bằng persistent context thật.
6. Không còn trường hợp test pass nhưng runtime chớp rồi tắt do khác launch mode.
7. Existing MaxHotmail profile mở trực tiếp tại chỗ.
8. Live CDP attach được.
9. Stale CDP relaunch được nếu không lock.
10. Lock thật không bị xóa.
11. Bulk Open/Check/Get Code hoạt động theo concurrency.
12. OAuth + Graph mail hoạt động.
13. Recovery mail/provider được quản lý.
14. Proxy/IP pool hoạt động.
15. CAPTCHA/OTP là adapter tách biệt.
16. Checkpoint/identity verification chuyển manual handling.
17. Email worker crash không treo UI.
18. Facebook không bị ảnh hưởng khi sửa Email.
19. Log luôn cho biết UID + profile + browser + proxy + result.
20. CI Windows xanh toàn bộ trước merge.

---

# 23. Quy tắc phát triển module Email

- Mỗi lô chỉ sửa một nhóm mục tiêu.
- Không refactor Facebook cùng commit với bugfix Email.
- Không chuyển logic Email vào generic browser core chỉ vì “cùng mở Chrome”.
- Test đúng runtime semantics.
- Không push nhiều commit `fix again`.
- Gom lỗi liên quan rồi sửa một lần.
- PR phải ghi rõ phạm vi.
- Không merge nếu chưa có lệnh.
- Sau merge theo dõi main CI tới xanh.
- Không deploy/release nếu chưa có lệnh riêng.

---

# 24. Thứ tự ưu tiên thực tế

Ưu tiên cao nhất hiện tại:

```text
1. Profile Path visibility
2. Browser Auto mặc định
3. Persistent browser validation
4. Email runtime queue/concurrency
5. Dense grid + context menu + bulk
6. OAuth/Graph + verification code
7. Proxy/IP
8. Recovery provider
9. Window layout
10. CAPTCHA/OTP adapters
```

Lý do: trước khi mở rộng tính năng, phải làm chắc **profile + browser lifecycle** để tránh lỗi kiểu browser chớp/tắt và tránh user không biết app đang dùng profile nào.

---

# 25. Kết luận kiến trúc

PAGE-AUTO không cần copy code MaxHotmail.

Cần copy **tư duy nghiệp vụ**:

- grid là trung tâm;
- thao tác hàng loạt;
- profile root rõ ràng;
- runtime cấu hình rõ;
- proxy/IP rõ;
- recovery rõ;
- trạng thái màu;
- context menu;
- queue/multi-thread có kiểm soát.

PAGE-AUTO phải làm tốt hơn ở:

- separation Facebook / Email;
- typed state;
- worker isolation;
- full profile path visibility;
- browser Auto;
- structured logs;
- test/CI;
- không phụ thuộc ChromeDriver.
