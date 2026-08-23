# PAGE-AUTO — Baseline triển khai hiện hành

> Đây là baseline bắt buộc phải đọc trước khi sửa code. Nếu `PROJECT_PLAN_DETAILS.md` có điểm xung đột thì file này được ưu tiên.

## 1. Mục tiêu sản phẩm

PAGE-AUTO là desktop app Windows portable để quản lý nhiều tài khoản Facebook và tự động hóa đăng bài theo nhiều Page Tab độc lập.

Nguyên tắc cốt lõi:

- Account là session/profile thực tế.
- Page không phải account; Page được switch theo Page UID từ session account.
- 1 Page Tab = 1 Page UID + 1 cấu hình automation độc lập.
- Account trong cùng tab chạy tuần tự, không song song.
- Nhiều Page Tab khác nhau có thể chạy song song.
- Group gốc không bị xóa; mỗi run clone snapshot riêng để chống trùng trong phiên.
- React chỉ làm UI; renderer không truy cập DB/browser trực tiếp.
- Electron Main quản lý SQLite, scheduler và worker lifecycle.
- Playwright chạy ở worker/utility process riêng.
- Không xây anti-detection/evasion hoặc cơ chế né bảo vệ nền tảng.
- CAPTCHA challenge có thể dùng provider API thông qua adapter cấu hình rõ ràng. Checkpoint/login/xác minh danh tính vẫn là trạng thái riêng và không được tự động bypass.

---

## 2. Stack đã chốt

- Electron + React + TypeScript strict + Vite/electron-vite.
- SQLite local + Drizzle ORM + migration versioned.
- Playwright worker riêng.
- electron-builder cho Windows portable folder/ZIP.
- Không dùng Supabase cho core local.
- Không dùng installer/NSIS/Setup trong baseline hiện tại.

Portable layout mục tiêu:

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

Runtime account/session/profile/cookie thật không commit Git.

---

## 3. Kiến trúc process

```text
Electron Main
  +-- SQLite / repositories
  +-- Scheduler
  +-- Worker Manager
  |     +-- Account/Profile Worker -> Playwright
  |     +-- Tab Worker A -> Playwright
  |     +-- Tab Worker B -> Playwright
  +-- Provider adapters
  |     +-- CaptchaProviderAdapter
  +-- Typed IPC / preload
        +-- React Renderer
```

Ràng buộc:

- Renderer chỉ gọi typed IPC qua preload.
- Main giữ quyền DB, filesystem và worker.
- 1 active Page Tab có tối đa 1 sequential worker cho tab đó.
- Nhiều Page Tab được chạy song song theo giới hạn cấu hình.
- Mỗi browser action/provider action phải có typed result; không viết một script dài khó bảo trì.

---

## 4. Account Manager

### 4.1. Dữ liệu account

Account hỗ trợ:

- UID/UserName, UserName riêng
- Password
- Tên hiển thị
- Status
- Category/Folder
- Friend count
- Cookie/session + cookie status + last check
- Proxy raw + type/host/port/username/password
- 2FA
- Email + Password Email + Backup Email
- Phone
- UserAgent
- Ngày tạo
- Note
- Lần dùng cuối
- metadata bổ sung về sau

Password, Cookie, 2FA, Password Email, Proxy Password phải mask mặc định. Không log plaintext secret.

### 4.2. Data-grid

Account Manager là data-grid mật độ cao kiểu công cụ quản lý account desktop, không dùng card list.

Grid cần:

- nhiều dòng hiển thị đồng thời
- row height thấp, text-first
- sort/filter/search
- chọn một/nhiều dòng
- hide/show/reorder/resize cột
- persist layout sau restart
- cột nhạy cảm mặc định ẩn/mask

Toolbar:

- Add account
- Import
- Import Custom
- Edit/Delete
- Open Chrome
- Check session
- Assign Category
- Columns

### 4.3. Import

Import nhanh mặc định delimiter `|` nhưng không khóa format.

Custom Import phải mở popup rộng và có mapping theo thứ tự cột. Khi chưa paste dữ liệu vẫn hiển thị tối thiểu 9 mapping để phù hợp format account phổ biến:

```text
UID | Password | 2FA | Cookie | Email | PassEmail | Proxy | UserAgent | Note
```

Người dùng có thể đổi từng mapping, thêm/bớt cột và lưu preset. Khi paste dòng có nhiều cột hơn, UI tự mở rộng mapping tương ứng.

Mapping hỗ trợ:

- Ignore
- UID/UserName
- UserName
- Password
- Name
- Cookie
- 2FA
- Email
- Password Email
- Backup Email
- Phone
- Proxy
- Proxy Type
- Proxy Host/Port/Username/Password
- UserAgent
- Category
- Note
- Friend
- Created Date

Validation:

- trim whitespace, bỏ dòng trống
- báo dòng lỗi
- bắt UID thiếu/trùng trong source
- DB duplicate: Skip hoặc Update existing
- lỗi import không echo credential plaintext

Preset built-in:

- Basic — UID | Cookie
- Basic — UID | Cookie | Note
- Full account — 9 cột mặc định ở trên
- Custom preset do người dùng lưu

---

## 5. Page Tabs

Mỗi Page Tab lưu độc lập:

- Page UID
- account list + thứ tự + enable/disable
- số bài/account
- delay bài, delay đổi account
- ngày chạy + nhiều time windows
- Group UID list
- Content Set
- Image Folder
- sequential/random khi phù hợp
- Start/Pause/Resume/Stop
- runtime status + log

Account trong tab luôn tuần tự; nhiều tab khác nhau có thể song song.

---

## 6. Group chống trùng

Group Set gốc luôn giữ nguyên.

```text
Group Set gốc -> clone -> run_items
```

Run item: pending / processing / success / failed / skipped.

Constraint: `UNIQUE(run_id, group_uid)`.

Chỉ consume group khỏi run hiện tại khi publish được xác nhận success. Không xóa group khỏi source và không coi click nút Đăng là success.

---

## 7. Browser session, posting và CAPTCHA providers

### 7.1. Session

Account states:

- unknown
- valid
- needs_login
- disabled

Nếu Facebook yêu cầu login/checkpoint/xác minh danh tính:

- dừng account hiện tại
- chuyển `needs_login`
- ghi log lý do
- mở đúng persistent browser profile để người vận hành xử lý

Checkpoint hoặc xác minh danh tính không được route sang CAPTCHA provider như một cách bypass.

### 7.2. CAPTCHA challenge

Settings có khu `CAPTCHA Providers`.

Provider baseline:

- OmoCaptcha
- EzCaptcha
- 2Captcha

Yêu cầu cấu hình:

- enable/disable từng provider
- chọn provider mặc định
- nhập/thay/xóa API key
- API key mask trên UI sau khi lưu
- API key không được log
- Config Backup không chứa CAPTCHA API key
- provider config lưu local trong `app_settings`
- renderer không đọc plaintext API key đã lưu; Main/provider adapter giữ quyền truy cập

Runtime integration mục tiêu:

```text
ChallengeDetector
  -> nếu là CAPTCHA được hỗ trợ
     -> CaptchaProviderAdapter(default provider)
     -> typed solve result
  -> nếu là login/checkpoint/identity verification
     -> needs_login/manual handling
```

Lô UI/settings có thể hoàn thành trước khi wiring solver vào posting worker. Không được trộn việc thêm provider UI với thay đổi lớn posting core trong cùng một commit nếu chưa test riêng.

### 7.3. Browser modules

```text
BrowserProfileManager
SessionChecker
PageIdentitySwitcher
GroupNavigator
ComposerDetector
PostComposer
MediaUploader
PublishAction
PublishResultDetector
ChallengeDetector
CaptchaProviderAdapter
RuntimeRecovery
```

---

## 8. Scheduler + recovery

Tab states: idle / scheduled / running / paused / waiting_window / stopping / stopped / error.

Run states: created / running / paused / completed / stopped / failed.

App restart không mất config/lịch sử. Item đang processing mà publish chưa xác nhận không được tự coi success hoặc retry mù.

Retry chỉ áp dụng lỗi được policy đánh dấu an toàn; lỗi publish_unconfirmed/manual_review không auto-retry.

---

## 9. Database hướng mục tiêu

```text
accounts
account_categories
account_sessions
account_custom_fields
page_tabs
page_tab_accounts
page_tab_schedules
group_sets
group_set_items
content_sets
content_items
image_sources
runs
run_items
run_events
execution_logs
app_settings
import_presets
column_layouts
```

`app_settings` chứa cấu hình app-level như CAPTCHA providers. Secret trong app settings không được đưa vào config backup hoặc log.

Page Tab reference account ID; không copy password/cookie/proxy sang tab.

---

## 10. Logging và security

Execution log khi phù hợp có timestamp, tab/account/page/group/content/images/action/result/error/attempt/evidence.

Không ghi plaintext:

- password
- cookie/session
- 2FA
- email password
- proxy password
- CAPTCHA provider API key

Config Backup mặc định loại toàn bộ secret ở trên, browser profile, runtime log và screenshot.

---

## 11. Phase baseline

Phase 0 — Bootstrap: Electron/React/TS, DB migration, shell, logging.

Phase 1 — Account Manager: full grid, CRUD, import/custom mapping/preset, masking, persistent profile.

Phase 2 — Session Engine: session loader/checker, valid/needs_login, manual login flow.

Phase 3 — Page Tab Config: CRUD/duplicate tab, account order, delays, schedules, groups/content/images.

Phase 4 — Run Queue: snapshot, clone groups, anti-duplicate, resume, metrics.

Phase 5 — Posting Core: switch Page, navigate Group, compose/media/publish/result verification.

Phase 6 — Account Rotation: N bài/account, delays, sequential account transitions.

Phase 7 — Multi Page Tabs: worker manager, independent queues, realtime runtime UI.

Phase 8 — Recovery + Logs: crash recovery, detailed logs, retry policy, resume-after-restart.

Phase 9 — Portable Packaging: Windows folder/ZIP, data migration, backup/restore, versioning, release notes.

Post-MVP polish đang triển khai:

- Account Manager high-density UI
- Custom Import tối thiểu 9 mapping
- CAPTCHA Provider settings + provider adapter foundation

---

## 12. Test baseline

Account:

- import 1 và 1,000+ account
- duplicate UID
- invalid/custom delimiter
- custom mapping 9+ cột
- preset persistence
- hidden/reordered/width columns persist
- secret masked mặc định
- CRUD/filter/sort

CAPTCHA settings:

- default empty state
- save enable/default provider
- save API key nhưng IPC view không trả plaintext
- lưu lại khi draft API key trống
- clear API key explicit
- config backup không chứa CAPTCHA API key

Run/Group/Multi-tab giữ toàn bộ test chống trùng, schedule, rotation, recovery và portable packaging hiện có.

---

## 13. Acceptance Criteria hiện hành

1. Import/manage account bằng dense data-grid.
2. Custom Import map tối thiểu 9 cột và mở rộng theo input.
3. Account giữ persistent session qua restart.
4. Page Tabs độc lập và account tuần tự trong từng tab.
5. Group source không bị phá; run chống trùng.
6. Content/Image/Schedule hoạt động.
7. Nhiều Page Tab chạy song song.
8. Pause/resume/stop/recovery/log hoạt động.
9. Secret không lộ mặc định.
10. CAPTCHA provider settings lưu local, API key mask và không nằm trong backup/log.
11. Windows artifact là portable folder/ZIP với PageAuto.exe.

---

## 14. Không làm theo baseline

- SaaS/cloud multi-user
- subscription/license server
- mobile app
- remote worker farm
- auto-create Facebook account
- checkpoint/identity-verification bypass
- anti-detection/evasion
- installer/NSIS/Setup workflow

---

## 15. Quy tắc làm việc bắt buộc

- Trước khi sửa phải đọc `PROJECT_PLAN.md`, kiểm tra đúng repo/branch/SHA.
- Không tự đổi stack/kiến trúc/phạm vi nếu chưa cập nhật plan hoặc chưa có lệnh của anh.
- Làm theo từng lô có mục tiêu rõ ràng.
- Test local trước khi push khi môi trường cho phép.
- Không commit/push/run CI dồn dập cho từng lỗi nhỏ.
- Khi CI đỏ: đọc đủ lỗi liên quan, gom sửa một lần rồi push lại.
- Sau mỗi push phải theo dõi workflow bắt buộc tới xanh.
- Chỉ báo “xong” khi có bằng chứng test/CI; nếu còn đỏ phải nói blocker chính xác.
- Ưu tiên một commit/lô gọn, dễ review.
- Không merge PR tự động.
- Chỉ merge khi anh ra lệnh rõ ràng.
- Sau merge, nếu `main` có CI thì theo dõi `main` tới xanh mới báo hoàn tất.
- Không deploy/release nếu chưa có lệnh riêng.
- Trước mọi commit/push phải báo rõ phạm vi thay đổi nếu cuộc trao đổi hiện tại chưa cho phép thao tác đó.

**Baseline này là quyết định hiện hành để code.**
