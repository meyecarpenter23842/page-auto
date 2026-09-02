# PAGE-AUTO — Baseline triển khai hiện hành

> Đây là baseline bắt buộc phải đọc trước khi sửa code. Khi sửa core/runtime Facebook phải đọc thêm `ARCHITECTURE.md`. Nếu `PROJECT_PLAN_DETAILS.md` hoặc tài liệu cũ có điểm xung đột thì `PROJECT_PLAN.md` được ưu tiên; thay đổi kiến trúc đã chốt phải cập nhật `ARCHITECTURE.md` trong cùng lô.
>
> **Quyết định K4.5.1 — Thư viện Bài viết chung:** `content_sets/content_items` là nguồn bài viết dùng chung toàn app, không phải mỗi Page Tab một DB bài viết riêng. Page/Kịch Bản/nghiệp vụ chỉ tham chiếu nguồn; tuần tự/random là cấu hình của consumer. Khi bắt đầu run phải snapshot nội dung để sửa thư viện giữa phiên không làm thay đổi run đang chạy. Trong giai đoạn chuyển tiếp, `content_sets.page_tab_id != NULL` chỉ là compatibility cho Page Tab cũ; các cụm “Content/Post Library” ở mục Group bên dưới được hiểu là **tham chiếu/consumer UI**, không còn là ownership dữ liệu riêng của Page.

## 1. Mục tiêu sản phẩm

PAGE-AUTO là desktop app Windows portable để quản lý nhiều tài khoản Facebook và tự động hóa nhiều nghiệp vụ trên nhiều Page độc lập.

Nguyên tắc cốt lõi:

- Account là session/profile thực tế.
- Page không phải account; Page được switch theo Page UID từ session account.
- **1 Page Tab = 1 Page UID + một container nhiều nghiệp vụ của Page đó**, không còn được hiểu là chỉ một cấu hình đăng Group.
- Danh sách account của Page được dùng làm nguồn chung; từng nghiệp vụ có cấu hình/runtime riêng khi cần.
- `accountConcurrency` là policy của từng orchestration/workspace, không phải một giới hạn cố định toàn app. Config/record legacy thiếu field phải giữ default `1`; workflow cho phép parallel phải snapshot giá trị này khi Start.
- `group_post` Page Tab không còn bị khóa bởi invariant “bắt buộc tuần tự”: `TK song song = 1` giữ behavior legacy, còn `>1` phải chạy rolling/refill qua common account lease và atomic Group claim theo Issue #263.
- Workspace `Tương tác` là reference implementation hiện tại của **rolling pool/cuốn chiếu**: luôn cố giữ tối đa N account active; slot nào kết thúc thì account kế tiếp vào ngay, không chờ cả nhóm N account cùng xong.
- Nhiều Page Tab/workspace khác nhau có thể chạy song song theo giới hạn cấu hình và account-level lock.
- Group gốc không bị xóa; mỗi run Group clone snapshot riêng để chống trùng trong phiên.
- Bài viết gốc nằm trong Thư viện Bài viết chung; consumer snapshot nội dung khi tạo run.
- React chỉ làm UI; renderer không truy cập DB/browser trực tiếp.
- Electron Main quản lý SQLite, scheduler và worker lifecycle.
- Playwright chạy ở worker/utility process riêng để browser lỗi không làm treo UI.
- Không xây anti-detection/evasion hoặc cơ chế né bảo vệ nền tảng.
- CAPTCHA challenge có thể dùng provider API thông qua adapter cấu hình rõ ràng. Checkpoint/login/xác minh danh tính vẫn là trạng thái riêng và không được tự động bypass.

Các nghiệp vụ Page đã chốt theo hướng mở rộng:

- `group_post` — đăng Nhóm, là nghiệp vụ hiện có.
- `page_wall_post` — Đăng Tường Page.
- `page_edit` — Sửa thông tin Page.
- Sau này có thể thêm `comment`, reply, reels, story... mà không copy lại login/2FA/checkpoint/Page switch.

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

## 3. Kiến trúc process và 3 tầng bắt buộc

### 3.1. Process boundary

```text
Electron Main
  +-- SQLite / repositories
  +-- Scheduler / Run Orchestration
  +-- Worker Manager
  |     +-- Account/Profile Worker -> Playwright
  |     +-- Page/Task Worker A -> Playwright
  |     +-- Page/Task Worker B -> Playwright
  +-- Provider adapters
  |     +-- CaptchaProviderAdapter
  +-- Typed IPC / preload
        +-- React Renderer
```

Ràng buộc:

- Renderer chỉ gọi typed IPC qua preload.
- Main giữ quyền DB, filesystem và worker.
- Concurrency là policy của từng orchestration/business workspace, không phải giả định cố định toàn app. Workflow cho phép parallel dùng common rolling pool theo `accountConcurrency`; legacy/default = `1`.
- `group_post` Page Tab được phép configurable account concurrency theo Issue #263; `1` giữ semantics tuần tự cũ, `>1` phải rolling/refill và dùng Group claim atomic.
- Cùng một account không được bị hai workflow điều khiển đồng thời; mọi flow phải tôn trọng account-level execution coordinator/lease dùng chung.
- Nhiều Page Tab/workspace có thể chạy song song khi không tranh cùng account và còn giới hạn runtime cho phép.
- Mỗi browser action/provider action phải có typed result; không viết một script dài khó bảo trì.

### 3.2. Tầng A — Facebook dùng chung

Đây là nguồn xử lý duy nhất cho hành vi Facebook dùng chung giữa các nghiệp vụ:

- resolve/open/giữ/đóng browser profile của account;
- kiểm tra session;
- login lại khi session hết;
- saved-profile/password flow;
- 2FA;
- phát hiện checkpoint/xác minh danh tính;
- xác minh account identity;
- cập nhật trạng thái account/session theo result typed;
- chuyển sang đúng Page theo Page UID;
- xác minh lại Page identity sau switch;
- pacing/delay thao tác browser dùng chung khi phù hợp;
- recovery/lifecycle dùng chung khi account/browser lỗi.

**Không được copy login/2FA/checkpoint/Page switch vào Group, Đăng Tường, Sửa Page hoặc nghiệp vụ mới.** Facebook đổi chỗ nào thì sửa module dùng chung tương ứng một lần.

### 3.3. Tầng B — Điều khiển phiên chạy

Tầng này quản lý phiên nhưng **không biết selector/nút Facebook cụ thể**:

- account nào đang chạy;
- account nào đã chạy lượt trong phiên;
- policy tuần tự hoặc concurrency của workspace;
- rolling pool/slot refill khi workspace hỗ trợ chạy song song;
- account-level lease để không chạy trùng cùng một account giữa nhiều workflow;
- số bài/account;
- delay giữa bài;
- delay đổi account;
- pause/resume/stop;
- hết lượt account, đổi account, hết phiên;
- scheduler/time window;
- worker lifecycle;
- runtime status/log/recovery policy.

### 3.4. Tầng C — Nghiệp vụ riêng

Mỗi nghiệp vụ chỉ giữ logic mục tiêu của chính nó và sử dụng Tầng A + B:

- `group_post`: Group navigation, Group-specific publish/result verification, chống trùng Group.
- `page_wall_post`: composer/publish trên Tường Page, đăng ngay hoặc hẹn giờ theo thiết kế nghiệp vụ.
- `page_edit`: cập nhật field Page theo workflow riêng.
- `comment` và nghiệp vụ tương lai: chỉ thêm flow riêng, không nhân bản session/Page runtime.

Hướng phụ thuộc bắt buộc:

```text
Business Task -> shared contracts
Business Task -> Facebook Common Runtime
Run Orchestration -> Business Task / Facebook Common Runtime
Facebook Common Runtime -X-> Group/Post-wall/Page-edit cụ thể
```

Chi tiết ownership file/module và lộ trình tách source nằm trong `ARCHITECTURE.md`.

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
- thao tác chọn nhanh bằng chuột thuận tiện và context menu cho selection

Toolbar/nghiệp vụ chính:

- Add account
- Import
- Import Custom
- Update existing
- Edit/Delete
- Open Chrome
- Check session
- Assign Category/Folder
- Columns

### 4.3. Import và Update

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
- Category/Folder
- Note
- Friend
- Created Date

Validation:

- trim whitespace, bỏ dòng trống
- báo dòng lỗi
- bắt UID thiếu/trùng trong source
- DB duplicate: Skip hoặc Update existing
- lỗi import không echo credential plaintext

Update existing có semantics riêng, không được nhập nhằng với Import:

- UID là khóa chuẩn để tìm account cần update.
- Field **không chọn update** = giữ nguyên giá trị cũ.
- Field **được chọn update nhưng input trống** = chủ động ghi rỗng/xóa giá trị cũ, ví dụ xóa 2FA.
- UI phải phân biệt rõ Import mới và Update existing.

Preset built-in:

- Basic — UID | Cookie
- Basic — UID | Cookie | Note
- Full account — 9 cột mặc định ở trên
- Custom preset do người dùng lưu

---

## 5. Page Tabs — container đa nghiệp vụ

Mỗi Page Tab có phần dùng chung:

- Page UID
- danh sách account + thứ tự + enable/disable
- điều khiển start/pause/resume/stop ở phạm vi phù hợp
- trạng thái runtime của Page/phiên
- log chung/đường dẫn tới log nghiệp vụ

Bên trong Page có các tab nghiệp vụ:

### 5.1. Nhóm (`group_post`)

Giữ toàn bộ nghiệp vụ hiện tại:

- Group UID list
- tham chiếu Thư viện Bài viết chung; không sở hữu DB bài viết riêng về đích
- ảnh/folder ảnh theo bài hoặc consumer config phù hợp
- số bài/account
- delay bài, delay đổi account
- ngày chạy + nhiều time windows
- `TK song song` / `accountConcurrency`: legacy/default `1`; người dùng có thể chủ động tăng và khi `>1` phải chạy rolling/refill, không chia batch
- account đang bận ở workflow khác không được chiếm chết slot nếu còn account khác runnable
- sequential/random ở consumer
- runtime/log
- snapshot Group chống trùng trong phiên với claim/reservation atomic khi có nhiều account active
- snapshot bài viết khi mở run để thư viện gốc có thể sửa độc lập

### 5.2. Đăng Tường (`page_wall_post`)

Sau khi common Facebook runtime ổn định mới triển khai:

- chọn nguồn từ Thư viện Bài viết chung
- nội dung/ảnh lấy từ snapshot của run
- đăng ngay
- hẹn ngày/giờ
- danh sách bài đã hẹn
- trạng thái/log

### 5.3. Sửa Page (`page_edit`)

Sau Đăng Tường mới triển khai. Đây là workflow riêng, ví dụ:

- tên/mô tả/bio
- avatar/cover
- thông tin liên hệ
- các field Page phù hợp về sau

Không nhét logic sửa Page vào Group Post.

### 5.4. Trạng thái account trong phiên Page

Status gốc của account và status trong phiên phải tách riêng.

Trạng thái UI phiên đã chốt:

- chưa chạy
- xanh dương = đã chạy lượt trong phiên
- xanh lá = đang chạy
- đỏ = checkpoint/lỗi account
- vàng = chờ/delay

Status phiên không được phá status gốc/lịch sử account.

### 5.5. Thư viện Bài viết chung

Nguồn bài viết là app-level data source, không thuộc một Page Tab cụ thể:

```text
content_sets (global)
  -> content_items
      -> nhiều biến thể nội dung
      -> cấu hình nguồn ảnh cơ bản

Page / Kịch Bản / business consumer
  -> tham chiếu content_set
  -> chọn sequential/random theo config consumer
  -> tạo run snapshot
  -> worker chỉ dùng snapshot của run
```

Trong K4.5.1, `content_sets.page_tab_id` được chuyển nullable để `NULL` biểu diễn nguồn global. Row có Page Tab ID và `page_tab_posts` vẫn được giữ compatibility; chưa đổi runtime consumer trong cùng lô migration/UI này.

---

## 6. Group chống trùng

Phần này thuộc nghiệp vụ `group_post`.

Group Set gốc luôn giữ nguyên.

```text
Group Set gốc -> clone -> run_items
```

Run item hiện có trạng thái: pending / processing / success / failed / skipped.

Constraint hiện tại: `UNIQUE(run_id, group_uid)`.

Khi nhiều account chạy cùng một run, allocator phải claim item atomically tại repository/DB boundary. Một `run_item` chỉ được có tối đa một owner/claim tại một thời điểm; account khác chỉ lấy item chưa claim hoặc đã release hợp lệ. Success consume item trong run hiện tại; lỗi trước khi hoàn thành target phải release/retry/terminal-fail theo policy rõ, không để `processing` treo sau Stop/crash/recovery.

Chỉ consume group khỏi run hiện tại khi publish được xác nhận success theo policy hiện hành. Không xóa group khỏi source và không coi click nút Đăng là success.

Pause không cấp claim mới; Resume tiếp tục snapshot cũ. Run/time window sau tạo snapshot mới từ Group source gốc.

Refactor kiến trúc không được làm thay đổi hành vi Group đang chạy ổn ngoài semantics concurrency/claim đã được Issue #263 chốt.

---

## 7. Facebook runtime, session, profile và CAPTCHA

### 7.1. Session dùng chung

Account states hiện hành:

- unknown
- valid
- needs_login
- disabled

Nếu Facebook yêu cầu login/checkpoint/xác minh danh tính:

- trả result typed về Main/orchestration;
- dừng hoặc kết thúc lượt account theo policy;
- cập nhật trạng thái đúng ở DB/UI;
- mở/giữ đúng persistent browser profile khi cần người vận hành xử lý;
- không để từng nghiệp vụ tự vá login/checkpoint riêng.

Checkpoint hoặc xác minh danh tính không được route sang CAPTCHA provider như một cách bypass.

Khi auto re-login/2FA thành công trong flow được hỗ trợ:

- phải xác minh session/account identity thật;
- lấy cookie/session mới;
- lưu lại qua Main theo policy;
- trả control về common runtime/orchestration để tiếp tục nghiệp vụ nếu an toàn;
- không để Group Post tự sở hữu logic phục hồi này.

### 7.2. Browser profile resolver

Mọi flow Facebook phải dùng chung một profile resolver.

Baseline local hiện có persistent profile do app quản lý. Hạng mục External Profile Root từ #43 khi triển khai phải tuân thủ:

- chọn root ngoài và resolve account theo `Root\UID`;
- không clone profile;
- khi external mode bật, **không được tự fallback/tạo profile trong AppData/ổ C**;
- lỗi root/profile phải trả typed error, không âm thầm đổi nguồn profile;
- Account Open Chrome, session check, posting và mọi nghiệp vụ Page dùng cùng resolver.

### 7.3. CAPTCHA challenge

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

Lô UI/settings có thể hoàn thành trước khi wiring solver vào worker. Không được trộn việc thêm provider UI với thay đổi lớn posting core trong cùng một commit nếu chưa test riêng.

### 7.4. Module responsibility hướng mục tiêu

Tên cụ thể có thể được di chuyển dần, nhưng ownership phải theo 3 tầng:

```text
Facebook Common
  BrowserProfileResolver / BrowserProfileManager
  SessionChecker / LoginRecovery / TwoFactor
  ChallengeDetector / CheckpointClassifier
  AccountIdentityVerifier
  PageIdentitySwitcher
  Common browser pacing/recovery

Run Orchestration
  Scheduler
  Account turn / rotation / rolling account pool
  Account execution lease
  Pause / Resume / Stop
  Worker lifecycle
  Runtime status / logs

Business
  GroupPost
    GroupNavigator
    Group publish verification
  PageWallPost
  PageEdit
```

Composer/content/media/publish primitives chỉ được đặt ở common khi thật sự không phụ thuộc Group/Tường cụ thể; logic xác minh đích riêng vẫn thuộc business task.

---

## 8. Scheduler + recovery

Tab states: idle / scheduled / running / paused / waiting_window / stopping / stopped / error.

Run states: created / running / paused / completed / stopped / failed.

App restart không mất config/lịch sử. Item đang processing mà publish chưa xác nhận không được tự coi success hoặc retry mù.

Retry chỉ áp dụng lỗi được policy đánh dấu an toàn; lỗi publish_unconfirmed/manual_review không auto-retry.

Orchestration không được chứa Facebook selector cụ thể.

### 8.1. Rolling account concurrency cho workspace Tương tác

- `accountConcurrency` là config orchestration, không phải một atomic Facebook action.
- Giá trị hiện hành cho UI/runtime Tương tác là `1..20`; config legacy không có field này phải parse về `1` để giữ compatibility.
- Khi Start, config và account order được freeze vào snapshot. Thay đổi `TK song song` trên UI sau đó không đổi phiên đang chạy.
- Runner dùng **rolling pool**, không chia batch: nếu N slot đang chạy và một account hoàn tất/needs-attention/off, slot vừa trống được cấp account kế tiếp ngay khi phiên còn runnable.
- Account đang bị một workflow khác giữ global execution lease không được chiếm một slot rỗng nếu còn account khác trong queue có thể acquire; queue sẽ quay lại account bị lock sau.
- Pause/Resume/Stop phải tác động trên toàn bộ account active trong pool và không cấp account mới khi phiên paused/stopping.
- `Tương tác` là reference implementation hiện có của contract rolling-pool; Issue #263 mở cùng contract cho các multi-account flow khác thay vì viết pool riêng.

### 8.2. Issue #263 — chuẩn hóa Account Concurrency toàn các runner

Audit tại `main@8adb1e2faf98d2990d5be7de494d4d05df2e1325` chốt ma trận hiện trạng và lộ trình:

| Flow | Hiện trạng audit | Policy đích |
| --- | --- | --- |
| Tương tác | đã dùng `runRollingAccountPool` + `tryAcquireLease()` | giữ configurable rolling concurrency |
| Kịch Bản/Scenario | custom `Promise.all` worker-loop + `accountExecution.run()` | migrate sang common rolling pool; locked account không chiếm slot |
| Nhóm standalone | common pool nhưng hard-code `concurrency: 1` | thêm `accountConcurrency`, legacy/default `1` |
| Page → Tham gia nhóm | common pool nhưng hard-code `concurrency: 1` | thêm `accountConcurrency`, legacy/default `1` |
| Page Tab `group_post` | `RotationService` tuần tự | configurable `accountConcurrency`, default `1`; `>1` rolling + Group claim atomic |
| Page Wall job | một account/job | giữ single-account job; không thêm concurrency giả nếu orchestration không cần |

Yêu cầu chung:

- Config/DB/IPC/UI của flow được mở parallel phải validate và snapshot concurrency khi Start.
- Common rolling pool phải refill ngay khi slot trống; không dùng batch barrier.
- Global `AccountExecutionCoordinator` vẫn là một lock table toàn Main; không tạo lock riêng theo workspace.
- Global Browser Launch Spacing độc lập với concurrency; tăng slot không được bulk-launch Chrome.
- Pause không cấp account/claim mới; Resume dùng snapshot cũ; Stop ngừng cấp việc mới và recovery phải giải phóng resource/claim đúng policy.

Audit `run_items` cho thấy model hiện có status/attempt/timestamp và `RunRepository.claimNext()` đã dùng transaction + conditional update để tránh hai update cùng thắng, nhưng chưa lưu owner account/worker. Batch `group_post` concurrency phải tận dụng model này, bổ sung ownership/recovery tối thiểu nếu cần và dùng chung primitive cho Scenario/flow khác cùng consume `run_items`.

Thứ tự implementation Issue #263:

1. Docs + repo-wide audit.
2. Chuẩn hóa common orchestration; migrate Scenario + regression global lease/slot refill.
3. Mở concurrency Nhóm standalone và Page → Tham gia nhóm, gồm config/IPC/UI/snapshot, default `1`.
4. Mở Page Tab `group_post` + atomic Group claim/release/recovery.
5. Regression toàn ma trận + CI; không merge khi chưa có lệnh.

---

## 9. Database và contract hướng mục tiêu

Database hiện tại/hướng nền:

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

`content_sets/content_items` là canonical shared post library cho thiết kế mới. `page_tab_id` nullable dùng để phân biệt global rows (`NULL`) với compatibility rows của Page Tab cũ trong giai đoạn chuyển đổi. Không tạo một bảng “bài viết riêng” mới cho từng Page/Kịch Bản.

`app_settings` chứa cấu hình app-level như CAPTCHA providers. Secret trong app settings không được đưa vào config backup hoặc log.

Page Tab reference account ID; không copy password/cookie/proxy sang tab.

Để hỗ trợ đa nghiệp vụ, request/run contract sẽ được thiết kế dần theo hướng có `task type` + `target`, tối thiểu:

- `group_post`
- `page_wall_post`
- `page_edit`
- `comment`

**Không bắt buộc migrate DB lớn trong một commit.** Mỗi thay đổi schema/contract phải chia lô an toàn, migration versioned và giữ compatibility khi cần.

---

## 10. Logging và security

Execution log khi phù hợp có timestamp, task/tab/account/page/target/content/images/action/result/error/attempt/evidence.

Không ghi plaintext:

- password
- cookie/session
- 2FA
- email password
- proxy password
- CAPTCHA provider API key

Config Backup mặc định loại toàn bộ secret ở trên, browser profile, runtime log và screenshot. Thư viện Bài viết chung không chứa credential và phải được mang theo trong Config Backup.

Log của common Facebook runtime phải đủ để trace worker -> Main -> DB -> UI nhưng không lộ credential.

---

## 11. Lộ trình triển khai hiện hành — Issue #77

Thứ tự này là thứ tự hiện hành và ưu tiên hơn các phase cũ khi làm #77:

### Batch 1 — Kiến trúc + tài liệu

- cập nhật `PROJECT_PLAN.md`;
- tạo/cập nhật `ARCHITECTURE.md`;
- chốt 3 tầng và ownership;
- không đổi hành vi runtime trong batch tài liệu.

### Batch 2 — UI/lỗi nhỏ ít rủi ro

- Settings nhiều tab phải scroll được, không bị kẹt nội dung;
- Folder/nhóm cho account;
- audit hover/drag phủ chọn account + chuột phải action popup;
- Import/Update theo UID với semantics blank = xóa khi field được chọn update.

### Batch 3 — Page UI shell mới

- 3 tab `Nhóm / Đăng Tường / Sửa Page`;
- thu gọn `Điều phối Page Tab` + `Cấu hình nghiệp vụ`;
- preview bài/ảnh/account/đích đang chạy;
- trạng thái account trong phiên theo màu đã chốt;
- Nhóm dùng shell mới nhưng logic runtime hiện tại chưa bị đổi ngoài phạm vi cần thiết.

### Batch 4 — Tách source dùng chung

- session/login/2FA/checkpoint vào Facebook Common;
- Page identity/Page switch vào Facebook Common;
- Group navigation/Group verification thành `group_post` riêng;
- composer/media/publish primitive chỉ tách dùng chung ở mức hợp lý;
- Group phải có regression chứng minh hành vi trước/sau refactor tương đương.

### Batch 5 — Sửa lỗi live còn mở

- Group random hiện vẫn chạy theo thứ tự;
- account out -> login lại -> qua 2FA -> phải lưu cookie/session mới -> tiếp tục nghiệp vụ; hiện có ca đứng;
- checkpoint chưa ghi/hiển thị status đúng;
- chỉ đóng sau live retest thực tế, không chỉ vì unit test/CI xanh.

### Batch 6 — Facebook External Profile Root

- lấy yêu cầu phù hợp từ #43;
- `Root\UID`, không clone;
- strict external mode, không fallback AppData/ổ C;
- mọi flow Facebook dùng chung resolver.

### Batch 7 — Đăng Tường

Chỉ làm khi nền common runtime ổn định. Không copy session/Page switch từ Group.

### Batch 8 — Sửa Page

Làm sau Đăng Tường, workflow riêng, dùng common runtime.

Các phase nền cũ vẫn có giá trị lịch sử: Bootstrap -> Account -> Session -> Page Config -> Run Queue -> Posting -> Rotation -> Multi-tab -> Recovery -> Portable Packaging, nhưng #77 là trục refactor/polish hiện hành.

---

## 12. Test baseline

### Account

- import 1 và 1,000+ account
- duplicate UID
- invalid/custom delimiter
- custom mapping 9+ cột
- preset persistence
- hidden/reordered/width columns persist
- secret masked mặc định
- CRUD/filter/sort
- Update existing theo UID
- field không chọn không update
- field chọn nhưng blank xóa giá trị cũ

### CAPTCHA settings

- default empty state
- save enable/default provider
- save API key nhưng IPC view không trả plaintext
- lưu lại khi draft API key trống
- clear API key explicit
- config backup không chứa CAPTCHA API key

### Thư viện Bài viết chung

- migration giữ nguyên content Page Tab legacy;
- tạo nhiều global `content_sets` với `page_tab_id = NULL`;
- CRUD/reorder bài, variants và media config;
- repository global không được sửa legacy set;
- Config Backup round-trip nguồn chung và vẫn restore backup v1 cũ;
- khi nối runtime ở lô sau, run snapshot không đổi nếu thư viện gốc được sửa giữa phiên.

### Architecture/runtime regression

- Group source/run chống trùng không đổi ngoài thay đổi được chốt.
- Group Post trước/sau refactor common runtime phải giữ cùng observable behavior.
- `group_post` với `accountConcurrency = 1` phải giữ behavior tuần tự legacy; `>1` phải rolling/refill và không có hai account claim cùng Group run item.
- Workspace Tương tác có regression chứng minh rolling pool: với concurrency 2, account thứ 3 bắt đầu ngay khi một trong hai slot đầu kết thúc dù slot còn lại vẫn đang chạy.
- Scenario/Kịch Bản sau migration phải dùng common rolling-pool contract thay vì custom worker-loop, đồng thời giữ delay/pause/error semantics hiện có.
- Nhóm standalone và Page → Tham gia nhóm: legacy config thiếu `accountConcurrency` phải parse về `1`; khi `>1` slot trống phải refill ngay.
- Account bị global lock không làm mất một concurrency slot khi còn account khác có thể chạy; cùng một account không chạy trùng giữa workflow.
- Config legacy của Tương tác không có `accountConcurrency` phải giữ default 1; giới hạn concurrency được validate trước worker launch.
- Pause/Resume/Stop/crash recovery không được để Group claim hoặc account lease treo; Group source gốc vẫn đầy đủ cho run/time window mới.
- Session/login/2FA/checkpoint/Page switch có test ở common layer, không duplicate test implementation trong từng business.
- Orchestration test không phụ thuộc Facebook selector.
- Worker crash/browser failure không làm treo renderer.
- External Profile Root khi bật phải test không fallback sang app-managed profile.
- Runtime status account trong phiên không ghi đè status gốc account.

Run/Group/Multi-tab giữ toàn bộ test chống trùng, schedule, rotation, recovery và portable packaging hiện có.

Live bug liên quan checkpoint/2FA continuation chỉ được coi fixed sau live retest Windows phù hợp.

---

## 13. Acceptance Criteria hiện hành

1. Import/manage account bằng dense data-grid; Update existing dùng UID và có semantics field rõ ràng.
2. Custom Import map tối thiểu 9 cột và mở rộng theo input.
3. Account giữ persistent session qua restart.
4. Page Tab là container của một Page và hỗ trợ nhiều nghiệp vụ rõ ràng.
5. Mọi multi-account flow có concurrency policy explicit. `group_post` legacy/default `1` giữ tuần tự; `TK song song > 1` dùng rolling concurrency + atomic Group claim, không batch barrier và vẫn tôn trọng global account lock.
6. Login/2FA/checkpoint/account identity/Page switch có một nguồn Facebook Common dùng chung, không copy theo nghiệp vụ.
7. Group source không bị phá; success chỉ consume run item hiện tại, không hai account claim cùng Group, run/time window sau clone lại source.
8. UI Page có `Nhóm / Đăng Tường / Sửa Page`, compact control và preview runtime theo kế hoạch.
9. Status gốc account và status trong phiên Page tách biệt.
10. Pause/resume/stop/recovery/log hoạt động và orchestration không biết selector Facebook; account lease/Group claim không bị treo.
11. Secret không lộ mặc định; CAPTCHA provider key không nằm trong backup/log.
12. External Profile Root khi bật resolve `Root\UID` strict, không clone/fallback.
13. Windows artifact là portable folder/ZIP với PageAuto.exe.
14. Đăng Tường và Sửa Page sử dụng common runtime, không nhân bản code Group/session.
15. Thư viện Bài viết là nguồn global dùng chung; Page/Kịch Bản không sở hữu bản copy DB riêng và run dùng snapshot.
16. Các lỗi checkpoint + post-2FA continuation chỉ đóng sau live retest thực tế.
17. Account concurrency không bypass Global Browser Launch Spacing; tăng `TK song song` không được bulk-launch Chrome.

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

- Trước khi sửa phải đọc `PROJECT_PLAN.md`; khi đụng core/runtime Facebook phải đọc thêm `ARCHITECTURE.md`.
- Kiểm tra đúng repo/branch/SHA và các PR song song trước khi sửa.
- Không tự đổi stack/kiến trúc/phạm vi nếu chưa cập nhật plan hoặc chưa có lệnh của anh.
- Mọi thay đổi kiến trúc đáng kể phải cập nhật `ARCHITECTURE.md` trong cùng lô.
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