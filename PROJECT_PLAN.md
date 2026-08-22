# PAGE-AUTO — Kế hoạch triển khai chi tiết

> Mục tiêu: xây dựng một ứng dụng desktop Windows để quản lý nhiều tài khoản Facebook, cấu hình nhiều **Page Tab** độc lập, và chạy automation theo lịch bằng browser session của từng tài khoản.
>
> Nguyên tắc cốt lõi: **Account là phiên đăng nhập thực tế; Page chỉ là danh tính được chuyển sang trong phiên account. Mỗi Page Tab có cấu hình riêng và chạy tuần tự các account đã được thêm vào tab đó. Nhiều Page Tab khác nhau có thể chạy song song.**

---

## 1. Phạm vi sản phẩm

### 1.1. Account Manager

Một khu quản lý tài khoản trung tâm, tách biệt hoàn toàn khỏi Page Tab.

Mỗi account có thể lưu nhiều trường dữ liệu, tương tự cách các tool desktop kiểu MaxCare/FPlus tổ chức data-grid:

- UID / UserName
- Password (optional)
- Tên hiển thị
- Status
- Category / Folder / Nhóm tài khoản
- Friend count (optional)
- Cookie / Session
- Cookie status
- Last cookie/session check
- Proxy / SSH
- Proxy type
- Proxy host
- Proxy port
- Proxy username
- Proxy password
- 2FA key (optional)
- Email
- Password email (optional)
- Email backup/support
- Phone
- UserAgent
- Ngày tạo
- Note
- Lần dùng cuối
- Tab/Page đang được gán (tham khảo UI, không phải khóa toàn cục)
- Các metadata bổ sung về sau

### 1.2. Page Tabs

- Mỗi tab đại diện cho **một Page UID**.
- Mỗi tab có cấu hình hoàn toàn độc lập.
- Account nào được add vào tab thì tab chỉ dùng đúng danh sách account đó.
- Account trong một tab chạy **lần lượt theo thứ tự cấu hình**.
- Trong một tab chỉ có **một account đang thực thi tại một thời điểm**.
- Nhiều tab/Page khác nhau được phép chạy song song.
- MVP không cần global account lock; giả định người vận hành chủ động gán account đúng tab mong muốn.

### 1.3. Automation chính

Mỗi Page Tab cần hỗ trợ:

- Page UID
- Danh sách account chạy
- Thứ tự account
- Số bài mỗi account trong một lượt
- Khoảng nghỉ giữa hai bài
- Khoảng nghỉ khi chuyển sang account tiếp theo
- Ngày chạy
- Một hoặc nhiều khung giờ trong ngày
- Danh sách Group UID gốc
- Cơ chế chống trùng trong một phiên chạy
- Bộ bài viết / content set
- Folder ảnh
- Chế độ lấy bài viết
- Chế độ lấy ảnh
- Start / Pause / Resume / Stop
- Runtime status
- Execution log

---

## 2. Luồng vận hành chuẩn

Ví dụ Page Tab A:

```text
Page UID A
Accounts: TK01 -> TK02 -> TK03
Số bài/account: 5
Nghỉ giữa bài: 3-5 phút
Nghỉ khi đổi account: 10-15 phút
Khung giờ: 08:00-11:00, 13:30-17:00, 19:00-21:00
Group Set: G001...G500
Content Set: Content-A
Image Folder: D:\PageAuto\PageA\images
```

Runtime:

```text
Đến khung giờ
  -> lấy account đầu tiên của tab
  -> mở đúng browser session của account
  -> kiểm tra session
  -> chuyển danh tính sang Page UID của tab
  -> lấy Group UID tiếp theo trong phiên
  -> mở group
  -> chọn content + ảnh
  -> đăng
  -> xác nhận kết quả
  -> nếu thành công: consume Group UID khỏi run hiện tại
  -> nghỉ theo cấu hình
  -> tiếp tục group kế tiếp
  -> đủ số bài của account: chuyển account tiếp theo
  -> hết account nhưng vẫn còn group + còn khung giờ: quay lại account đầu
  -> hết khung giờ: pause ở trạng thái WAITING_WINDOW
  -> tới khung giờ tiếp theo: resume
```

---

## 3. Cơ chế Group Set và chống trùng

### 3.1. Group gốc không bị xóa

Danh sách Group Set gốc là cấu hình lâu dài:

```text
GROUP_SET_A
G001
G002
G003
...
G500
```

Không xóa item khỏi Group Set gốc khi đã đăng.

### 3.2. Mỗi phiên tạo snapshot riêng

Khi scheduler mở một phiên chạy:

```text
RUN_2026_08_23_0800
G001 pending
G002 pending
G003 pending
...
```

Sau khi G001 đăng thành công:

```text
G001 success
G002 pending
G003 pending
...
```

UI có thể hiển thị danh sách "còn lại" như thể G001 đã được xóa khỏi phiên, nhưng DB vẫn giữ lịch sử trạng thái để audit.

### 3.3. Phiên kế tiếp clone lại từ Group Set gốc

Ngày/lịch chạy tiếp theo:

```text
RUN_NEXT
G001 pending
G002 pending
G003 pending
...
```

=> chống trùng trong **cùng một run**, nhưng không phá danh sách group gốc.

### 3.4. Trạng thái Run Item

- `pending`
- `processing`
- `success`
- `failed`
- `skipped`

Unique constraint:

```text
UNIQUE(run_id, group_uid)
```

để cùng một group không xuất hiện hai lần trong một phiên.

---

## 4. Account Import

### 4.1. Import nhanh

Hỗ trợ paste nhiều dòng, delimiter mặc định `|`.

Ví dụ:

```text
uid|cookie|note
uid|password|2fa|cookie|email|proxy|useragent|note
```

Không ép một format cố định.

### 4.2. Custom Import Mapping

Sau khi paste dữ liệu:

```text
Cột 1 -> UID
Cột 2 -> Password
Cột 3 -> 2FA
Cột 4 -> Cookie
Cột 5 -> Email
Cột 6 -> Password Email
Cột 7 -> Proxy
Cột 8 -> UserAgent
Cột 9 -> Note
```

Các lựa chọn mapping dự kiến:

- Ignore
- UID/UserName
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
- UserAgent
- Category
- Note
- Created Date

### 4.3. Import Preset

Cho phép lưu preset import:

- Basic: `UID | Cookie`
- Full account
- Custom 1
- Custom 2

Không phụ thuộc cứng vào một tool bên thứ ba; preset chỉ là cấu hình mapping của PAGE-AUTO.

### 4.4. Validation khi import

- Trim khoảng trắng
- Bỏ dòng trống
- Báo dòng lỗi
- Phát hiện UID trùng
- Cho chọn: Skip / Update existing
- Không log plaintext credential vào console

---

## 5. UI — Account Manager

Trang account dùng **data-grid mạnh**, không dùng card đơn giản.

### 5.1. Toolbar

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

### 5.2. Data-grid

Các cột mặc định nên hiện:

- UID/UserName
- Tên
- Status
- Category
- Cookie status
- Proxy
- Note
- Tab/Page tham chiếu
- Lần dùng cuối

Các cột nhạy cảm/ít dùng mặc định ẩn:

- Password
- Cookie raw
- 2FA key
- Email
- Password email
- Proxy credential
- UserAgent
- Phone
- Friend
- Ngày tạo
- Backup email
- metadata khác

### 5.3. Column Manager

Cho phép:

- Hide/show từng cột
- Reorder cột
- Resize
- Pin left
- Auto width
- Reset default
- Save layout

Layout phải được nhớ khi mở app lại.

### 5.4. Bảo vệ dữ liệu nhạy cảm

- Password/Cookie/2FA/Proxy password mask mặc định
- Reveal theo thao tác người dùng
- Không hiển thị toàn bộ cookie ở grid nếu không cần
- Edit Account mở form riêng

---

## 6. UI — Page Tabs

### 6.1. Cấu trúc chung

Thanh tab ngang:

```text
[ Page A ] [ Page B ] [ Page C ] [ + ]
```

Mỗi tab là một cấu hình Page độc lập.

Dashboard có thể có overview trạng thái nhiều tab, nhưng màn cấu hình chính chỉ chỉnh **tab đang active** để tránh rối.

### 6.2. Header tab

- Tab name
- Page name (nếu có)
- Page UID
- Status badge
- Start
- Pause
- Resume
- Stop
- Duplicate Tab
- Delete Tab

### 6.3. Section: Accounts

- Add account từ Account Manager
- Remove account khỏi tab
- Kéo thả thay đổi thứ tự
- Enable/disable account trong tab
- Hiển thị trạng thái session
- Hiển thị account hiện tại đang chạy

### 6.4. Section: Rotation

- Số bài / account
- Delay giữa bài: fixed hoặc min-max
- Delay khi chuyển account: fixed hoặc min-max
- Khi hết account: quay vòng nếu còn group và còn khung giờ

### 6.5. Section: Schedule

- Enable schedule
- Chọn ngày trong tuần
- Nhiều khung giờ mỗi ngày
- Ví dụ:
  - 08:00-11:00
  - 13:30-17:00
  - 19:00-21:00
- Khi ngoài giờ: `WAITING_WINDOW`
- Khi tới giờ: tự resume

### 6.6. Section: Groups

- Paste UID list
- Import TXT/CSV
- Count total
- Deduplicate khi lưu Group Set
- Hiển thị số group còn lại trong current run
- Checkbox: consume khỏi current run sau success
- Failed group có thể:
  - retry cuối queue
  - mark failed
  - skip current run

### 6.7. Section: Content

- Content Set
- Add/Edit/Delete content
- Import TXT
- Mỗi content là một item độc lập
- Chế độ:
  - Sequential
  - Random
  - Round-robin

### 6.8. Section: Image Folder

- Chọn folder Windows
- Preview file count
- Supported: jpg/jpeg/png/webp (MVP)
- Chế độ:
  - Sequential
  - Random
  - Match by filename/key
- Số ảnh / bài
- Nếu thiếu ảnh: policy cấu hình (post text-only hoặc skip)

### 6.9. Runtime panel

Hiển thị realtime:

- Tab status
- Account hiện tại
- Page UID
- Group hiện tại
- Content hiện tại
- Ảnh hiện tại
- Đã đăng
- Còn lại
- Failed
- Started at
- Runtime
- Next action time

---

## 7. Browser Session

### 7.1. Mỗi account có profile/session riêng

Đề xuất:

```text
data/
  browser-profiles/
    account-<id>/
```

Không trộn session giữa account.

### 7.2. Login

Hỗ trợ hai luồng:

1. Import cookie/session của account do người vận hành kiểm soát.
2. Mở Chrome từ app và login thủ công một lần, sau đó lưu persistent profile.

### 7.3. Session state

- `unknown`
- `valid`
- `needs_login`
- `disabled`

Nếu Facebook yêu cầu login/checkpoint/xác minh:

- dừng account hiện tại
- chuyển status `needs_login`
- log rõ lý do
- người vận hành mở Chrome và xử lý thủ công

Không xây tính năng bypass CAPTCHA/checkpoint hoặc né cơ chế bảo vệ của nền tảng.

---

## 8. Browser Automation Modules

Không viết automation thành một script dài. Chia module để Facebook đổi UI chỉ sửa đúng module liên quan.

Các module:

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

### 8.1. PageIdentitySwitcher

Input:

```text
account_session + page_uid
```

Output:

```text
switched / not_available / needs_login / error
```

### 8.2. GroupNavigator

Input:

```text
group_uid
```

Output:

```text
opened / unavailable / permission_denied / error
```

### 8.3. PublishResultDetector

Không coi click nút "Đăng" là success ngay.

Cần xác định một trong các dấu hiệu:

- UI xác nhận đăng thành công
- composer đóng + post xuất hiện
- navigation/result state hợp lệ

Nếu không chắc chắn -> `unknown/failed`, không consume group một cách mù quáng.

---

## 9. Scheduler và State Machine

### 9.1. Tab states

- `idle`
- `scheduled`
- `running`
- `paused`
- `waiting_window`
- `stopping`
- `stopped`
- `error`

### 9.2. Run states

- `created`
- `running`
- `paused`
- `completed`
- `stopped`
- `failed`

### 9.3. Resume sau restart app

App restart không được làm mất lịch sử.

Khi mở lại:

- load tab state từ DB
- các job `processing` chưa xác nhận phải đưa về trạng thái cần review/retry an toàn
- không tự coi là success
- scheduler tiếp tục từ current run nếu người dùng cho phép

---

## 10. Database đề xuất

MVP dùng SQLite local.

### 10.1. Tables

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

### 10.2. Quan hệ chính

```text
accounts
   ^
   |
page_tab_accounts
   |
page_tabs
   |---- group_sets -> group_set_items
   |---- content_sets -> content_items
   |---- schedules
   |---- runs -> run_items -> run_events
```

### 10.3. Nguyên tắc dữ liệu

- Page Tab chỉ reference account ID.
- Không copy cookie/password/proxy vào Page Tab.
- Sửa account một lần ở Account Manager thì tab tự dùng dữ liệu mới.
- Group Set gốc và Run Items tách riêng.

---

## 11. Tech Stack

Đề xuất MVP Windows local:

### Desktop UI

- Electron
- React
- TypeScript
- Vite
- TanStack Table hoặc AG Grid Community tùy license/nhu cầu
- Zustand hoặc Redux Toolkit cho app state

### Browser worker

- Node.js
- Playwright
- Persistent browser profiles

### Database

- SQLite
- Drizzle ORM hoặc Prisma (ưu tiên Drizzle nếu muốn nhẹ)

### Scheduler

- Worker process nội bộ
- Persistent jobs lưu DB
- Không phụ thuộc cron hệ điều hành cho logic chính

### Packaging

- electron-builder
- Windows installer `.exe`

---

## 12. Kiến trúc process

Không để browser automation chạy trực tiếp trong renderer UI.

```text
Electron Main
  |
  +-- SQLite / repositories
  +-- Scheduler
  +-- Worker Manager
  |      +-- Tab Worker A -> Playwright
  |      +-- Tab Worker B -> Playwright
  |      +-- Tab Worker C -> Playwright
  |
  +-- IPC
         |
         +-- React Renderer
```

Nguyên tắc:

- 1 active Page Tab = tối đa 1 sequential worker cho tab đó.
- Nhiều Page Tab có thể có nhiều worker song song.
- UI không bị treo khi browser chạy.

---

## 13. Logging và Audit

Mỗi action quan trọng phải có log:

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
- screenshot path (khi cần)

Log UI filter theo:

- Tab
- Account
- Group
- Success/Failed
- Ngày giờ

Không ghi plaintext password/cookie/2FA vào log.

---

## 14. Error Handling

### Account/session error

- needs_login
- cookie invalid
- browser profile corrupted

### Page error

- page unavailable cho account
- switch identity failed

### Group error

- group unavailable
- account/page không có quyền đăng
- composer không tìm thấy

### Media error

- file missing
- unsupported format
- upload failed

### Publish error

- publish button unavailable
- timeout
- result uncertain

Mỗi error phải có:

- retry policy
- screenshot nếu hữu ích
- readable message trên UI

---

## 15. Security

- DB local không log credential plaintext.
- Sensitive fields mask ở UI.
- Secrets có thể encrypt-at-rest bằng Windows DPAPI hoặc key lưu qua OS credential store.
- Browser profile folder không upload tự động ra cloud.
- Export account phải có cảnh báo vì chứa dữ liệu nhạy cảm.
- Backup mặc định tránh xuất plaintext secret nếu không cần.

---

## 16. Settings

Global Settings dự kiến:

- Data folder
- Browser executable
- Browser headless/headed (MVP ưu tiên headed để dễ debug)
- Screenshot folder
- Default timeout
- Default delay
- Max Page Tabs chạy song song
- Auto-start scheduler
- Log retention
- Backup settings
- UI theme

Tab-level settings luôn override global default khi được set.

---

## 17. MVP — thứ tự triển khai

### Phase 0 — Bootstrap

- Electron + React + TypeScript
- SQLite migration
- App shell/sidebar
- Error boundary
- Logging cơ bản

**Done khi:** app mở/đóng ổn, DB tự tạo, navigation hoạt động.

### Phase 1 — Account Manager

- Data model account
- Grid nhiều cột
- Hide/show/reorder columns
- Add/Edit/Delete
- Import basic
- Import custom mapping
- Import preset
- Cookie/session field
- Open browser profile

**Done khi:** import được danh sách account và mở đúng persistent browser profile của từng account.

### Phase 2 — Session Engine

- BrowserProfileManager
- Cookie/session loader
- SessionChecker
- `valid / needs_login`
- Open Chrome for manual login

**Done khi:** account restart app vẫn giữ đúng profile và có thể kiểm tra session.

### Phase 3 — Page Tab Config

- Create/Edit/Delete/Duplicate Page Tab
- Page UID
- Add/remove/reorder account
- Số bài/account
- Delay configs
- Schedule windows
- Group Set
- Content Set
- Image Folder

**Done khi:** toàn bộ cấu hình tab lưu DB và restore chính xác sau restart.

### Phase 4 — Run Queue + Anti-duplicate

- Create Run snapshot
- Clone Group Set -> Run Items
- Consume success trong current run
- Group Set gốc giữ nguyên
- Resume run
- Runtime metrics

**Done khi:** test 500 group giả lập không trùng item trong cùng run và run mới clone đủ group gốc.

### Phase 5 — Browser Posting Core

- PageIdentitySwitcher
- GroupNavigator
- ComposerDetector
- PostComposer
- MediaUploader
- PublishAction
- PublishResultDetector

**Done khi:** một account/session có thể chạy end-to-end một job thử nghiệm trong môi trường được phép sử dụng.

### Phase 6 — Account Rotation

- N bài/account
- Delay giữa bài
- Delay đổi account
- Move next account
- Loop account list
- Pause ngoài schedule window

**Done khi:** một tab chạy đúng thứ tự account và số bài đã cấu hình.

### Phase 7 — Multi Page Tabs

- Worker Manager
- Nhiều tab chạy song song
- Mỗi tab giữ queue riêng
- UI runtime realtime

**Done khi:** Page A và Page B chạy song song nhưng bên trong từng tab vẫn tuần tự.

### Phase 8 — Recovery + Logs

- Crash recovery
- Screenshot lỗi
- Detailed execution log
- Retry policy
- Resume after app restart

### Phase 9 — Packaging

- Windows installer
- App data migration
- Backup/restore config
- Versioning
- Release notes

---

## 18. Test Plan

### Account

- Import 1 account
- Import 1,000+ account
- Duplicate UID
- Missing cookie
- Invalid delimiter
- Custom mapping
- Hidden columns persist after restart

### Session

- Valid session
- Expired session
- Manual login then save
- Restart app and reopen same profile

### Tab

- 1 account
- 5 accounts
- reorder accounts
- disable one account
- 1 / 3 / nhiều time windows

### Group

- duplicate UID in source
- 500+ groups
- success consumes current run only
- failed item policy
- next run restores full source list

### Content/Image

- sequential content
- random content
- missing image
- empty folder
- one/multiple images

### Scheduler

- start in active window
- start outside window
- cross into end of window
- resume next window
- restart app while waiting

### Multi-tab

- Page A only
- Page A + B simultaneously
- Pause A while B continues
- Stop B while A continues

### Error recovery

- Browser closes unexpectedly
- Session expires mid-run
- Group unavailable
- Publish result uncertain
- App crash/restart

---

## 19. Acceptance Criteria MVP

MVP được xem là đạt khi:

1. Import/manage account với custom columns được.
2. Account giữ persistent browser session qua restart.
3. Tạo nhiều Page Tab độc lập.
4. Mỗi tab add đúng account cần chạy và giữ thứ tự.
5. Cấu hình số bài/account, delay bài, delay account, schedule windows.
6. Group Set gốc không bị phá sau run.
7. Mỗi run chống trùng Group UID.
8. Content Set + Image Folder hoạt động.
9. Một tab chạy tuần tự account đúng cấu hình.
10. Nhiều Page Tab chạy song song độc lập.
11. Pause/resume/stop hoạt động.
12. Có runtime status + log đủ để biết lỗi nằm ở account/page/group/post.
13. App restart không làm mất config/lịch sử.
14. Dữ liệu nhạy cảm không bị phơi ra log/UI mặc định.

---

## 20. Không làm trong MVP

Để tránh scope phình quá sớm, MVP chưa cần:

- SaaS/cloud multi-user
- Subscription/license server
- Mobile app
- Remote worker farm
- AI content generation
- Inbox/comment automation
- Analytics marketing nâng cao
- Auto-create Facebook account
- CAPTCHA/checkpoint bypass
- Anti-detection/evasion features

Các mục này chỉ xem xét sau khi posting core ổn định.

---

## 21. Rủi ro kỹ thuật chính

### Facebook UI thay đổi

Giải pháp:

- module hóa browser actions
- selector strategy nhiều lớp
- screenshot/debug log
- không hard-code toàn bộ workflow vào một file

### Session hết hạn

Giải pháp:

- SessionChecker
- status `needs_login`
- manual re-login flow

### Publish result không chắc chắn

Giải pháp:

- PublishResultDetector riêng
- không consume group khi chưa có bằng chứng success

### Nhiều tab chạy song song làm app nặng

Giải pháp:

- giới hạn max concurrent tabs
- worker lifecycle rõ ràng
- browser resource monitoring

---

## 22. Cấu trúc repo dự kiến

```text
page-auto/
  apps/
    desktop/
      src/
        main/
        renderer/
        ipc/
  packages/
    core/
    db/
    automation/
    scheduler/
    shared/
  docs/
    architecture.md
    account-import.md
    page-tab-runtime.md
    testing.md
  scripts/
  PROJECT_PLAN.md
  README.md
```

---

## 23. Nguyên tắc code

- TypeScript strict mode.
- Không để renderer truy cập DB/browser trực tiếp.
- Repository/service layer cho DB.
- Mỗi browser action có typed result.
- Không swallow exception.
- Không log secrets.
- Migration DB có version.
- Mỗi phase có test trước khi sang phase sau.
- Không sửa posting core và scheduler cùng lúc khi debug một lỗi production.

---

## 24. Thứ tự ưu tiên thực tế

Ưu tiên tuyệt đối:

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
-> packaging
```

Không nên làm UI phụ, license, analytics hoặc tính năng marketing khác trước khi **posting core + session + run queue** chạy ổn định.

---

## 25. Quyết định kiến trúc đã chốt từ yêu cầu ban đầu

- Account là đơn vị login/session thật.
- Page không phải account; Page được switch theo Page UID từ session account.
- Account Manager là màn riêng.
- Mỗi Page là một Tab cấu hình riêng.
- Mỗi tab có danh sách account được add thủ công.
- Account trong tab chạy lần lượt, không chạy song song trong cùng tab.
- Mỗi account có số bài/lượt riêng hoặc dùng default của tab.
- Có delay giữa bài và delay giữa account.
- Có nhiều khung giờ chạy trong ngày.
- Có Group UID gốc + Run snapshot riêng.
- Success consume group khỏi phiên hiện tại, không xóa group gốc.
- Có bộ bài viết + folder ảnh.
- Nhiều Page Tab khác nhau được chạy song song.
- Account grid phải hỗ trợ rất nhiều cột và hide/show linh hoạt, bao gồm Cookie và các metadata nâng cao.

Đây là baseline để code. Nếu thay đổi một trong các nguyên tắc trên thì phải cập nhật plan/schema trước khi triển khai phần liên quan.
