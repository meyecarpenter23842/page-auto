# PAGE-AUTO — Baseline triển khai hiện hành

> Đây là file baseline bắt buộc phải đọc trước khi sửa code. Bản kế hoạch chi tiết trước khi chuẩn hóa portable được giữ nguyên tại [`PROJECT_PLAN_DETAILS.md`](./PROJECT_PLAN_DETAILS.md) để tra cứu đầy đủ. Nếu hai file có điểm xung đột, **`PROJECT_PLAN.md` hiện hành được ưu tiên**.

## 1. Mục tiêu sản phẩm

PAGE-AUTO là **desktop app Windows portable** để quản lý nhiều tài khoản Facebook và tự động hóa đăng bài theo nhiều Page Tab độc lập.

Nguyên tắc cốt lõi:

- Account là phiên đăng nhập/session thực tế.
- Page không phải account; Page được switch theo Page UID từ session account.
- Account Manager là màn riêng, quản lý dữ liệu account tập trung.
- 1 Page Tab = 1 Page UID + 1 cấu hình automation độc lập.
- Account trong cùng tab chạy **lần lượt**, không song song.
- Nhiều Page Tab khác nhau có thể chạy song song.
- Group gốc không bị xóa khi run; mỗi run clone snapshot riêng để chống trùng trong phiên.
- React chỉ làm UI; renderer không truy cập DB hoặc browser trực tiếp.
- Electron Main quản lý DB, scheduler và worker lifecycle.
- Playwright chạy ở **worker/utility process riêng**, không chạy trong renderer và không để browser crash làm treo UI.
- Không xây CAPTCHA/checkpoint bypass, anti-detection/evasion hoặc cơ chế né bảo vệ nền tảng.

---

## 2. Stack đã chốt

### Desktop

- Electron
- React
- TypeScript strict
- Vite / electron-vite

### Database

- SQLite local
- Drizzle ORM
- Migration có version
- Repository/service layer; renderer không query DB trực tiếp

### Browser automation

- Node.js worker / Electron utility process
- Playwright
- Persistent browser profile riêng từng account
- Browser headed là mặc định cho MVP để dễ kiểm tra và login thủ công

### Packaging

- Dùng `electron-builder` khi tới Phase Packaging.
- **Không dùng Windows installer / Setup / NSIS trong MVP.**
- Artifact mặc định là **folder portable hoặc ZIP portable**.
- `PageAuto.exe` là file chạy ứng dụng trực tiếp, không phải trình cài đặt.
- Khi đã package, dữ liệu runtime mặc định nằm cạnh executable:

```text
Page-Auto/
  PageAuto.exe
  resources/
  data/
    page-auto.sqlite
    browser-profiles/
      account-<id>/
    logs/
    screenshots/
```

- Ưu tiên folder/ZIP portable thay vì ép toàn bộ Playwright/browser/native SQLite vào một file portable duy nhất.
- Copy nguyên folder sang máy Windows khác là mô hình phân phối mục tiêu; migration/backup phải xử lý dữ liệu local an toàn.

---

## 3. Kiến trúc process

```text
Electron Main
  |
  +-- SQLite / repositories
  +-- Scheduler
  +-- Worker Manager
  |      +-- Account/Profile Worker -> Playwright
  |      +-- Tab Worker A -> Playwright
  |      +-- Tab Worker B -> Playwright
  |      +-- Tab Worker C -> Playwright
  |
  +-- Typed IPC / preload bridge
         |
         +-- React Renderer
```

Ràng buộc:

- Renderer chỉ gọi API qua preload/IPC.
- Main giữ quyền truy cập DB và tạo worker.
- 1 active Page Tab có tối đa 1 sequential worker cho tab đó.
- Nhiều Page Tab có thể có worker song song theo giới hạn cấu hình.
- Mỗi browser action về sau phải có typed result; không viết một script automation dài khó bảo trì.

---

## 4. Account Manager

### 4.1. Dữ liệu account

Account hỗ trợ các field chính:

- UID / UserName
- Password
- Tên hiển thị
- Status
- Category / Folder
- Friend count
- Cookie / Session
- Cookie status
- Last cookie/session check
- Proxy raw
- Proxy type / host / port / username / password
- 2FA key
- Email
- Password email
- Backup/support email
- Phone
- UserAgent
- Ngày tạo
- Note
- Lần dùng cuối
- metadata bổ sung về sau

Password, Cookie, 2FA, Password Email và Proxy Password phải mask mặc định trên UI. Không log plaintext secret.

### 4.2. Data-grid

Account Manager dùng **data-grid mạnh**, không dùng card list.

Toolbar mục tiêu:

- Import
- Import Custom
- Add account
- Edit
- Delete
- Check session
- Open Chrome
- Assign Category
- Search
- Filter Status
- Filter Category
- Column settings

Grid cần:

- nhiều cột
- sort/filter
- chọn một/nhiều dòng
- hide/show cột
- reorder cột
- resize/width
- save layout và restore sau restart

Cột nhạy cảm/ít dùng mặc định ẩn; người dùng chủ động bật/reveal khi cần.

### 4.3. Import

Import nhanh mặc định delimiter `|`, nhưng không khóa format duy nhất.

Custom Import cho map từng cột sang:

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
- Proxy Host / Port / Username / Password
- UserAgent
- Category
- Note
- Friend
- Created Date

Validation:

- trim whitespace
- bỏ dòng trống
- báo dòng lỗi
- bắt UID thiếu/trùng trong nguồn import
- duplicate DB: `Skip` hoặc `Update existing`
- lỗi import không được echo credential plaintext

Preset:

- Basic: `UID | Cookie`
- Basic + Note
- Full account
- Custom preset do người dùng lưu

### 4.4. Browser profile ở Phase 1

- Mỗi account có folder `data/browser-profiles/account-<id>/`.
- Nút Open Chrome gọi Main -> BrowserProfileManager -> worker Playwright riêng.
- Worker mở persistent context của đúng account.
- Phase 1 **chưa** kiểm tra session Facebook và chưa posting; `SessionChecker` thuộc Phase 2.

---

## 5. Page Tabs

Mỗi tab chứa cấu hình độc lập:

- Page UID
- danh sách account + thứ tự
- enable/disable từng account
- số bài/account
- delay giữa bài
- delay khi chuyển account
- ngày chạy + nhiều time windows/ngày
- Group UID list
- Content Set
- Image Folder
- sequential/random/round-robin khi phù hợp
- Start / Pause / Resume / Stop
- runtime status + log

Account trong cùng tab chạy tuần tự. Nhiều tab có thể chạy song song.

---

## 6. Group chống trùng

Group Set gốc luôn giữ nguyên.

Khi mở run:

```text
Group Set gốc
  -> clone -> run_items
```

Run item states:

- pending
- processing
- success
- failed
- skipped

Constraint:

```text
UNIQUE(run_id, group_uid)
```

Khi đăng thành công, group được consume khỏi queue **của run hiện tại** nhưng không xóa khỏi Group Set gốc. Run/ngày sau clone lại đầy đủ từ nguồn gốc.

Không consume group khi kết quả publish chưa đủ bằng chứng success.

---

## 7. Browser Session và posting modules

### Session

Account session states:

- unknown
- valid
- needs_login
- disabled

Nếu Facebook yêu cầu login/checkpoint/xác minh:

- dừng account hiện tại
- chuyển `needs_login`
- log lý do dễ đọc
- người vận hành mở browser profile và xử lý thủ công

### Modules

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
ScreenshotService
RuntimeRecovery
```

Không coi click nút Đăng là success. `PublishResultDetector` phải xác minh UI/result state đủ tin cậy; nếu chưa chắc thì `unknown/failed` và không consume group mù quáng.

---

## 8. Scheduler và state machine

Tab states:

- idle
- scheduled
- running
- paused
- waiting_window
- stopping
- stopped
- error

Run states:

- created
- running
- paused
- completed
- stopped
- failed

App restart không làm mất cấu hình/lịch sử. Job đang `processing` mà chưa xác nhận success phải được recovery/review/retry an toàn, không tự coi là thành công.

---

## 9. Database hướng mục tiêu

Các bảng dự kiến:

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

Nguyên tắc:

- Page Tab reference account ID, không copy password/cookie/proxy.
- Sửa account ở Account Manager thì tab dùng dữ liệu mới.
- Group Set gốc và Run Items tách riêng.
- Migration DB có version.

---

## 10. Logging và security

Log action quan trọng gồm khi phù hợp:

- timestamp
- tab_id
- account_id
- page_uid
- group_uid
- content_id
- image(s)
- action
- result
- error_code
- error_message
- screenshot path

Không ghi plaintext password/cookie/2FA/email password/proxy password vào log.

Runtime data/profile không commit Git. Export/backup có secret phải có cảnh báo và mặc định tránh plaintext nếu không cần.

---

## 11. MVP phases

### Phase 0 — Bootstrap

- Electron + React + TypeScript
- SQLite migration
- app shell/sidebar
- error boundary
- logging cơ bản

Done khi app mở/đóng ổn, DB tự tạo, navigation hoạt động và CI Windows xanh.

### Phase 1 — Account Manager

- data model account
- grid nhiều cột
- hide/show/reorder/width + persist layout
- Add/Edit/Delete
- search/filter/sort
- basic import
- custom import mapping
- import preset
- cookie/session fields + masking
- persistent browser profile
- Open Chrome qua Playwright worker riêng

Done khi import/manage account được, restart vẫn giữ DB/layout, và mở đúng persistent browser profile theo account.

### Phase 2 — Session Engine

- BrowserProfileManager hoàn thiện
- cookie/session loader
- SessionChecker
- valid / needs_login
- manual login flow

Done khi restart app vẫn mở đúng profile và kiểm tra session được.

### Phase 3 — Page Tab Config

- Create/Edit/Delete/Duplicate Page Tab
- Page UID
- add/remove/reorder account
- rotation/delay
- schedule windows
- Group Set
- Content Set
- Image Folder

Done khi cấu hình tab lưu DB và restore chính xác sau restart.

### Phase 4 — Run Queue + Anti-duplicate

- create run snapshot
- clone Group Set -> Run Items
- consume success trong current run
- giữ Group Set gốc
- resume run
- runtime metrics

Done khi test 500+ group giả lập không trùng trong cùng run và run mới clone đủ source.

### Phase 5 — Browser Posting Core

- PageIdentitySwitcher
- GroupNavigator
- ComposerDetector
- PostComposer
- MediaUploader
- PublishAction
- PublishResultDetector

Done khi một account/session chạy end-to-end một job thử nghiệm trong môi trường được phép sử dụng.

### Phase 6 — Account Rotation

- N bài/account
- delay giữa bài
- delay đổi account
- move next account
- loop account list
- pause ngoài schedule window

Done khi một tab chạy đúng thứ tự account và số bài cấu hình.

### Phase 7 — Multi Page Tabs

- Worker Manager
- nhiều tab song song
- queue riêng từng tab
- realtime runtime UI

Done khi Page A/B chạy song song nhưng bên trong mỗi tab vẫn tuần tự.

### Phase 8 — Recovery + Logs

- crash recovery
- screenshot lỗi
- detailed execution log
- retry policy
- resume after restart

### Phase 9 — Portable Packaging

- build Windows portable folder/ZIP
- không installer/NSIS/Setup trong MVP
- packaged data migration
- backup/restore config
- versioning
- release notes

---

## 12. Test baseline

### Account

- import 1 account
- import 1,000+ account
- duplicate UID
- missing cookie
- invalid/custom delimiter
- custom mapping
- preset persistence
- hidden/reordered/width columns persist after restart
- secret masked mặc định
- CRUD + filter/sort
- đúng browser profile theo account

### Session

- valid session
- expired session
- manual login then save
- restart và reopen same profile

### Tab / Group / Scheduler / Multi-tab

Giữ toàn bộ test cases trong `PROJECT_PLAN_DETAILS.md`, gồm reorder account, nhiều time windows, 500+ groups, consume current run only, content/image selection, schedule transitions, multi-tab isolation và recovery.

---

## 13. Acceptance Criteria MVP

MVP đạt khi:

1. Import/manage account với custom columns được.
2. Account giữ persistent browser session qua restart.
3. Tạo nhiều Page Tab độc lập.
4. Mỗi tab add đúng account và giữ thứ tự.
5. Rotation/delay/schedule windows hoạt động.
6. Group Set gốc không bị phá sau run.
7. Mỗi run chống trùng Group UID.
8. Content Set + Image Folder hoạt động.
9. Một tab chạy tuần tự account đúng cấu hình.
10. Nhiều Page Tab chạy song song độc lập.
11. Pause/resume/stop hoạt động.
12. Runtime status/log đủ truy lỗi account/page/group/post.
13. Restart không mất config/lịch sử.
14. Secret không bị phơi ra log/UI mặc định.
15. Bản phát hành Windows là portable folder/ZIP, không installer trong MVP.

---

## 14. Không làm trong MVP

- SaaS/cloud multi-user
- subscription/license server
- mobile app
- remote worker farm
- AI content generation
- inbox/comment automation
- marketing analytics nâng cao
- auto-create Facebook account
- CAPTCHA/checkpoint bypass
- anti-detection/evasion
- installer/NSIS/Setup workflow

---

## 15. Quy tắc code và làm việc bắt buộc

- TypeScript strict.
- Renderer không truy cập DB/browser trực tiếp.
- DB dùng repository/service layer.
- Browser automation chạy worker riêng.
- Mỗi browser action có typed result.
- Không swallow exception.
- Không log secrets.
- Migration DB có version.
- Mỗi phase có test trước khi sang phase sau.
- Không đổi stack/kiến trúc/phạm vi đã chốt nếu chưa cập nhật plan.
- Không sửa posting core và scheduler cùng lúc khi debug một lỗi production.

Trước khi sửa:

1. đọc `PROJECT_PLAN.md` và phần chi tiết liên quan trong `PROJECT_PLAN_DETAILS.md` nếu cần;
2. kiểm tra đúng repo/local/branch/SHA;
3. xác định lô thay đổi rõ ràng;
4. test local trước;
5. gom lỗi trong cùng lô rồi mới push;
6. không spam commit kiểu `fix CI`, `fix again`, `try again`;
7. sau push theo CI tới khi mọi workflow bắt buộc xanh;
8. chỉ báo xong khi có bằng chứng test/CI;
9. không tự merge PR;
10. chỉ merge khi anh ra lệnh rõ ràng;
11. sau merge nếu `main` có CI thì theo tới xanh;
12. không deploy/release nếu chưa có lệnh riêng.

---

## 16. Thứ tự ưu tiên thực tế

```text
Account Manager
-> Session ổn định
-> Page Tab config
-> Group Run snapshot/chống trùng
-> 1 job đăng end-to-end
-> rotation nhiều account trong 1 tab
-> schedule
-> nhiều tab song song
-> recovery/log
-> portable packaging
```

Không làm UI phụ, license, analytics hoặc tính năng marketing trước khi posting core + session + run queue ổn định.

**Baseline này là quyết định hiện hành để code. Nếu thay đổi Account/Page model, worker model, anti-duplicate hoặc portable packaging thì phải sửa plan trước khi triển khai phần liên quan.**
