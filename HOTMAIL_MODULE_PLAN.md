# PAGE-AUTO — EMAIL / HOTMAIL MODULE PLAN

> Tài liệu kế hoạch riêng cho module Email/Hotmail của PAGE-AUTO.
> Mục tiêu: đạt mức nghiệp vụ quản lý mail kiểu MaxHotmail, nhưng UI phải dễ hiểu hơn và tuyệt đối không làm lẫn Facebook.
>
> Phần Facebook External Profile Root đã chuyển sang issue #77. Tài liệu này chỉ còn phạm vi Email.

---

## 1. Mục tiêu module

Email phải là một khu nghiệp vụ độc lập, không còn là popup phụ hoặc một màn kỹ thuật khó hiểu.

Mục tiêu chính:

- Quản lý số lượng lớn Hotmail/Outlook bằng data-grid mật độ cao.
- Dùng dữ liệu Email/PassEmail/BackupEmail từ Account Manager, không tạo database account mail riêng.
- Dùng đúng **Email Profile Root** đã chọn.
- Quy tắc profile: **1 UID = 1 folder `EmailProfileRoot\UID`**.
- Mở đúng profile Email cũ tại chỗ; không clone/copy/fallback sang profile khác.
- Browser Email mặc định **Auto**; chọn file `.exe` chỉ là phần nâng cao.
- Hỗ trợ mở mail, kiểm tra mail, lấy mã hàng loạt.
- Có proxy/IP riêng cho Email, ưu tiên **IPv4**; không dùng proxy Facebook.
- Có runtime/worker riêng cho Email.
- Có log đủ để biết UID nào đang dùng profile/browser/proxy nào.
- Không để lỗi Email ảnh hưởng Facebook.
- Không bypass checkpoint / identity verification / security lock của Microsoft. Gặp xác minh danh tính thì chuyển xử lý thủ công.

---

# 2. Ranh giới bắt buộc giữa Facebook và Email

## 2.1. Profile tách hoàn toàn

Facebook profile và Email profile là **hai profile khác nhau**.

Ví dụ cùng UID:

```text
Facebook:
<FacebookProfileRoot>\615123456789

Email:
<EmailProfileRoot>\615123456789
```

UID chỉ là khóa để tìm đúng folder của từng bên.

Không được:

- dùng Email profile làm Facebook profile;
- dùng Facebook profile làm Email profile;
- dùng chung cookie/session;
- fallback từ Email sang Facebook hoặc ngược lại;
- ép cả hai nghiệp vụ chạy trong cùng một browser profile.

Lý do: Facebook và Email có yêu cầu mạng khác nhau. Email hiện ưu tiên IPv4 và có thể cần proxy khác Facebook. Khi thao tác Facebook + Email cùng lúc, hai bên phải có thể mở độc lập bằng **2 profile + 2 proxy khác nhau**.

## 2.2. Proxy tách hoàn toàn

- Proxy Facebook thuộc Facebook.
- Proxy Email thuộc Email.
- Email không đọc/ghi `accounts.proxy` để điều khiển mail.
- Đổi IP Email không được làm thay đổi proxy Facebook.
- Email proxy pool không được trở thành proxy cố định của account Facebook.

## 2.3. Chỉ dùng chung phần nền rất thấp khi thật sự giống nhau

Có thể dùng chung primitive như:

- kiểm tra browser executable tồn tại;
- timeout;
- process lifecycle thấp tầng;
- window placement thấp tầng;
- logging primitive.

Không dùng chung nghiệp vụ:

- profile resolver;
- profile root;
- session/cookie;
- proxy pool;
- runtime state;
- login/checkpoint;
- Page switch;
- mail reading.

Không refactor phần Facebook chỉ để phục vụ Email.

---

# 3. Quy tắc UI mới — bỏ UI Email cũ làm chuẩn

UI Email hiện tại **không dùng làm chuẩn nghiệp vụ**.

Mục tiêu mới: học cách tổ chức thao tác của MaxHotmail nhưng giữ giao diện PAGE-AUTO sạch, dễ hiểu và thao tác nhanh.

## 3.1. Sidebar

Sidebar trái chỉ có **1 mục `Email`**.

Không tách riêng các mục như:

- Proxy
- Microsoft
- Profile
- Recovery
- OAuth

ra ngoài sidebar.

## 3.2. Toàn bộ nghiệp vụ nằm trong màn Email

Khi bấm `Email`, toàn bộ chức năng nằm trong màn này dưới dạng tab/khu con.

Khung mục tiêu:

```text
Email
  ├─ Danh sách mail
  ├─ Mở mail
  ├─ Lấy mã / Kiểm tra mail
  ├─ Mail khôi phục
  ├─ Đổi IP / Proxy
  ├─ Nhật ký
  └─ Cài đặt
```

Tên/tab cuối cùng có thể gom lại để UI gọn hơn, nhưng nguyên tắc không đổi: **mọi nghiệp vụ Email nằm trong một màn Email duy nhất**.

## 3.3. Ngôn ngữ UI phải theo nghiệp vụ người dùng

Màn chính ưu tiên các từ dễ hiểu:

- `Mở mail`
- `Lấy mã`
- `Kiểm tra mail`
- `Mail khôi phục`
- `Đổi IP`
- `Proxy`
- `Trình duyệt`
- `Nhật ký`
- `Cài đặt`

Không dùng tên công nghệ làm điều hướng chính.

Các từ như:

- Microsoft OAuth
- Microsoft Graph
- token
- adapter
- runtime state

chỉ xuất hiện trong **Cài đặt nâng cao / Chẩn đoán** khi thật sự cần.

Người vận hành không cần hiểu công nghệ phía sau mới dùng được chức năng `Lấy mã` hoặc `Kiểm tra mail`.

---

# 4. Data-grid Email là trung tâm

Grid chính là nơi quản lý và thao tác account Email.

Cột mục tiêu:

- Checkbox
- STT
- UID
- Email
- Pass Email (mask)
- Mail khôi phục
- Loại mail khôi phục
- Tên
- Tình trạng mail
- Tình trạng profile
- Profile Path
- Trình duyệt
- Proxy/IP
- Ngày tạo
- Category/Folder
- Tình trạng chạy
- Mã mới nhất
- Thời gian lấy mã
- Nguồn gửi
- Lỗi gần nhất
- Ghi chú

Hỗ trợ:

- chọn nhiều dòng;
- Ctrl/Shift selection;
- select all;
- filter/sort/search UID/Email;
- filter status/folder/category;
- hide/show/reorder/resize cột;
- lưu layout;
- compact row;
- sticky header;
- virtual scroll khi account lớn;
- màu trạng thái nhưng luôn có text rõ ràng;
- context menu áp dụng trên selection;
- bulk action.

Toolbar chính dùng ngôn ngữ dễ hiểu:

```text
[Mở mail]
[Lấy mã]
[Kiểm tra mail]
[Refresh]
[Đổi IP]
[Thao tác khác ▼]
[Cài đặt]
```

---

# 5. Context menu

Chuột phải trên account/selection:

```text
Mở mail
Mở thư mục profile
Copy đường dẫn profile
Kiểm tra mail
Lấy mã
Refresh profile
Đóng profile
-----------------
Copy Email
Copy UID
Copy mail khôi phục
Copy trạng thái
-----------------
Gán Category/Folder
Ghi chú
```

Các thao tác kỹ thuật như reconnect OAuth chỉ để trong `Thao tác khác` hoặc phần nâng cao nếu cần.

---

# 6. Email Profile lifecycle

## 6.1. Email Profile Root

User chọn root, ví dụ:

```text
F:\MaxHotmail\profiles
```

UID:

```text
615123456789
```

Resolve đúng:

```text
F:\MaxHotmail\profiles\615123456789
```

Không:

- scan thư mục khác;
- tự thêm tầng `profiles`;
- fallback sang `data\browser-profiles`;
- fallback sang Facebook profile;
- clone/copy profile;
- tạo `UID-copy`, `UID-2`;
- tự import account chỉ vì thấy folder UID.

## 6.2. Trạng thái profile

Trạng thái nghiệp vụ hiển thị:

- Chưa cấu hình
- Chưa có profile
- Có profile
- Đang mở
- Đang sử dụng
- Đang mở...
- Lỗi

Grid phải có `Profile Path` đầy đủ để người dùng biết chính xác app đang dùng folder nào.

## 6.3. Tạo profile

Scan/list không tự tạo profile.

Chỉ tạo nếu có action rõ ràng được thiết kế cho phép tạo mới.

Nếu mục tiêu là dùng kho MaxHotmail đã có mà folder UID không tồn tại thì mặc định báo `Chưa có profile`, không lén tạo ở nơi khác.

## 6.4. Profile đang chạy

Nếu profile đang chạy và có thể attach an toàn:

- attach vào process hiện tại;
- không mở process thứ hai vào cùng folder;
- proxy giữ theo process đang sở hữu browser.

Nếu endpoint cũ/stale và không có lock thật:

- cho phép relaunch cùng profile.

Nếu profile đang bị process khác giữ mà không attach an toàn được:

- báo `Đang sử dụng`;
- không xóa lock cưỡng bức.

## 6.5. Tiện ích profile

- Mở thư mục profile
- Copy path
- Refresh trạng thái
- Kiểm tra lock
- Kiểm tra browser đang chạy
- Hiển thị Profile Root

---

# 7. Browser Email

## 7.1. Chế độ

Mặc định:

```text
Trình duyệt Email: Tự động
```

Nâng cao:

```text
Chọn file trình duyệt thủ công
```

Không bắt user chọn `.exe` mới dùng được Email.

## 7.2. Auto detect

Thứ tự có thể thử:

1. browser phù hợp cạnh MaxHotmail/profile root;
2. Chrome system;
3. Edge system;
4. Chromium phù hợp;
5. fallback đã được kiểm tra.

## 7.3. Validation phải giống runtime thật

Nếu runtime Email mở persistent profile thì phần test browser cũng phải test persistent profile.

Không được có tình trạng:

```text
Test browser: pass
Runtime mở profile: chớp rồi tắt
```

Manual browser fail phải báo rõ bằng ngôn ngữ dễ hiểu.

Auto mode nếu candidate lỗi thì thử candidate kế tiếp.

## 7.4. Bố trí cửa sổ

Email có cấu hình riêng:

- số browser hiển thị đồng thời;
- grid X × Y;
- spacing;
- delay mở;
- compact mode riêng Email nếu cần;
- nhớ vị trí.

Không phụ thuộc ChromeDriver.

---

# 8. Runtime Email riêng

Email có queue/worker riêng, không dùng runtime của Page Tab Facebook.

Luồng nghiệp vụ chính:

```text
Chờ
-> Xếp hàng
-> Kiểm tra profile
-> Chọn browser
-> Lấy proxy/IP Email
-> Mở/attach browser khi cần
-> Mở mail / kiểm tra mail / lấy mã
-> Hoàn tất
```

Trạng thái lỗi cần phân biệt:

- Cần đăng nhập
- Profile đang sử dụng
- Browser lỗi
- Proxy lỗi
- Kết nối mail hết hạn
- Lỗi đọc mail
- Cần xác minh thủ công
- Lỗi khác

Hỗ trợ:

- chạy 1 account;
- chạy selection;
- chạy theo filter;
- giới hạn số worker/browser;
- queue;
- pause/resume/stop/stop all;
- delay mở browser;
- delay giữa account;
- timeout;
- worker crash không làm treo UI;
- retry thủ công khi phù hợp.

---

# 9. Lấy mã / Kiểm tra mail

Mục tiêu UI chỉ cần cho người dùng thao tác:

- `Lấy mã`
- `Kiểm tra mail`
- Mã mới nhất
- Thời gian nhận
- Nguồn gửi
- Lỗi nếu có

Phần Microsoft OAuth/Graph là cách triển khai phía sau, không phải cấu trúc chính của UI.

Yêu cầu phía sau:

- kết nối mailbox hợp lệ;
- refresh token khi cần;
- đọc recent mail;
- parser nhiều mẫu mail;
- lọc sender/domain;
- tránh lấy mã quá cũ;
- lưu timestamp;
- single + batch;
- không hiển thị plaintext refresh token/secret trên UI/log/backup.

Nếu Microsoft yêu cầu identity verification/security review thì chuyển `Cần xác minh thủ công`.

---

# 10. Mail khôi phục

Dữ liệu:

- Backup Email
- Provider
- Domain
- Status
- Note

Hỗ trợ:

- copy mail khôi phục;
- nhận diện provider;
- mở provider;
- kiểm tra field thiếu;
- lọc account thiếu/có mail khôi phục;
- custom domain/provider khi cần.

Provider catalog chỉ là metadata, không khóa hệ thống vào một nhà cung cấp.

---

# 11. Proxy / Đổi IP Email

## 11.1. Nguyên tắc

Email có cấu hình mạng riêng.

Baseline:

```text
Direct
Random IPv4 pool
Provider-based IPv4 rotation (mở rộng sau)
```

Không dùng IPv6 pool cho workflow Email hiện tại.

Không lấy proxy Facebook của account làm proxy Email.

## 11.2. Pool

Hỗ trợ:

- import proxy list;
- host:port:user:pass;
- mask password;
- test proxy;
- kiểm tra public IP;
- current IP;
- rotate;
- fail count;
- cooldown;
- tạm bỏ proxy lỗi;
- giới hạn số tác vụ đổi IP.

Proxy Email được chọn cho phiên/lượt Email, không biến thành proxy cố định của account Facebook.

## 11.3. Browser đã chạy từ app khác

Nếu attach vào profile MaxHotmail đang được process khác mở:

- PAGE-AUTO không được giả vờ đổi proxy của process đó;
- UI phải báo browser đang dùng mạng/proxy do process hiện tại quản lý.

---

# 12. Cài đặt Email

Tất cả vẫn nằm trong màn `Email > Cài đặt`.

## 12.1. Profile & Trình duyệt

- Email Profile Root
- Trình duyệt: Tự động / Thủ công
- File trình duyệt thủ công
- Test trình duyệt
- Số browser chạy cùng lúc
- Delay mở
- Timeout
- Bố trí cửa sổ
- Browser đang được phát hiện

## 12.2. Kết nối mailbox

Màn thường chỉ hiển thị:

- Trạng thái kết nối
- Kết nối lại
- Kiểm tra kết nối

Thông tin OAuth/Graph/tenant/client ID để trong phần nâng cao.

## 12.3. Proxy/IP

- Direct / Random IPv4
- Proxy list/provider
- Test
- Đổi IP
- Current IP
- Concurrency

## 12.4. Mail khôi phục

- provider catalog
- domain mapping
- custom provider/domain

## 12.5. Nâng cao

- CAPTCHA provider adapter nếu có challenge được hỗ trợ
- OTP provider framework
- browser diagnostics
- token diagnostics

Không route checkpoint/identity verification thành CAPTCHA/OTP bypass.

---

# 13. Logging

Mỗi action cần log đủ để chẩn đoán:

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

Không log plaintext:

- password
- pass email
- cookie
- 2FA
- refresh token
- proxy password
- CAPTCHA key
- OTP key

UI log hỗ trợ:

- filter UID
- filter action
- filter success/error
- copy log
- export log đã loại secret

---

# 14. Database hướng mục tiêu

Account nguồn vẫn là `accounts`.

Email chỉ bổ sung state/settings riêng, ví dụ:

```text
account_email_state
email_profile_settings
email_proxy_settings
email_runtime_sessions
email_runtime_events
```

Không duplicate credential Email thành một account database khác.

Migration làm dần theo từng batch, không phá schema hiện hành.

---

# 15. Thứ tự triển khai

## Batch E0 — Audit + khóa ranh giới

- audit toàn bộ Email hiện tại;
- xác định UI cũ phần nào bỏ, phần nào giữ;
- map dependency Email;
- không sửa Facebook;
- không refactor browser Facebook;
- xác nhận #43 chỉ còn Email.

Acceptance:

- có danh sách file Email;
- có danh sách UI cần thay;
- không đổi hành vi runtime.

## Batch E1 — UI Email shell mới

- sidebar chỉ còn 1 mục `Email`;
- toàn bộ nghiệp vụ thành tab/khu con trong màn Email;
- bỏ wording kỹ thuật khỏi màn chính;
- dense grid;
- toolbar;
- selection/context menu foundation;
- layout rõ, dễ thao tác kiểu MaxHotmail.

## Batch E2 — Profile Email + Browser Auto

- Email Profile Root;
- resolve `root\UID`;
- Profile Path;
- mở folder/copy path;
- trạng thái profile;
- Browser Auto;
- persistent profile validation;
- attach/lock protection;
- không fallback profile sai nơi.

## Batch E3 — Runtime Email

- queue;
- concurrency;
- pause/resume/stop;
- worker isolation;
- runtime state;
- structured log.

## Batch E4 — Lấy mã / Kiểm tra mail

- kết nối mailbox phía sau;
- single/batch;
- latest code/time/source;
- parser;
- reconnect khi cần;
- UI không lộ thuật ngữ kỹ thuật không cần thiết.

## Batch E5 — Proxy/IP Email

- IPv4 pool riêng;
- test IP;
- rotate;
- fail policy;
- current IP;
- không ảnh hưởng Facebook proxy.

## Batch E6 — Mail khôi phục

- provider/domain;
- filter;
- actions;
- completeness checks.

## Batch E7 — Window layout + diagnostics + polish

- bố trí nhiều browser;
- diagnostics;
- sanitized export;
- UX polish;
- regression test toàn module.

Không trộn tất cả vào một PR lớn.

---

# 16. Test plan

## Profile

- root trống/invalid/exists;
- UID profile exists/missing;
- exact `root\UID`;
- không fallback sang Facebook/AppData;
- concurrent open;
- live browser attach;
- stale endpoint;
- profile lock;
- không xóa lock cưỡng bức.

## Browser

- Auto mode;
- manual valid/bad;
- browser chớp rồi tắt;
- persistent context pass;
- candidate fail -> next candidate;
- worker crash.

## Mail

- chưa kết nối;
- kết nối hợp lệ;
- token hết hạn;
- không có mã;
- mã mới;
- mã cũ;
- sender filtering;
- batch partial failure.

## Proxy

- Direct;
- IPv4 hợp lệ;
- proxy lỗi;
- rotate;
- pool trống;
- release sau worker crash;
- không thay proxy Facebook.

## UI

- chỉ một mục Email ở sidebar;
- tab con nằm trong Email;
- grid layout persist;
- hidden/reordered/width persist;
- context menu selection;
- bulk selection;
- Profile Path visible;
- status text + color;
- secret masked;
- màn chính không bắt user hiểu OAuth/Graph/token.

---

# 17. Acceptance Criteria cuối

Module Email chỉ coi là đạt khi:

1. Sidebar chỉ có một mục `Email`.
2. Toàn bộ nghiệp vụ mail nằm bên trong màn Email.
3. UI cũ không còn là chuẩn; UI mới tổ chức theo nghiệp vụ dễ hiểu kiểu MaxHotmail.
4. Màn chính dùng từ như `Mở mail`, `Lấy mã`, `Kiểm tra mail`, `Đổi IP` thay vì tên công nghệ.
5. Facebook profile và Email profile hoàn toàn riêng.
6. Facebook proxy và Email proxy hoàn toàn riêng.
7. Có thể mở Facebook + Email đồng thời với 2 profile/2 proxy khác nhau.
8. Email resolve profile đúng `<EmailProfileRoot>\<UID>`.
9. Không clone/copy/fallback profile sai nơi.
10. Grid hiển thị đầy đủ Profile Path.
11. Browser Email Auto hoạt động mặc định.
12. Validation browser dùng đúng kiểu persistent profile của runtime thật.
13. Bulk Open/Check/Get Code hoạt động theo concurrency.
14. Email proxy dùng IPv4 pool riêng và không ảnh hưởng Facebook.
15. Mail khôi phục/provider quản lý được.
16. Worker Email lỗi không làm treo UI hoặc ảnh hưởng Facebook.
17. Checkpoint/identity verification chuyển manual handling.
18. Log cho biết UID + profile + browser + proxy + result nhưng không lộ secret.
19. CI Windows xanh trước merge.
20. Không merge nếu chưa có lệnh rõ ràng.

---

# 18. Quy tắc phát triển

- #43 chỉ theo dõi Email; Facebook theo #77.
- Mỗi batch chỉ sửa một nhóm mục tiêu.
- Không refactor Facebook cùng commit với Email.
- Không đưa logic Email vào generic browser core chỉ vì cùng mở Chrome.
- Test đúng runtime thật.
- Không push nhiều commit `fix again`.
- Gom lỗi liên quan rồi sửa một lần.
- PR ghi rõ phạm vi.
- Không merge nếu chưa có lệnh.
- Sau merge nếu main có CI thì theo dõi tới xanh.
- Không deploy/release nếu chưa có lệnh riêng.

---

# 19. Kết luận

PAGE-AUTO không cần copy code MaxHotmail.

Cần học cách tổ chức nghiệp vụ:

- grid là trung tâm;
- thao tác hàng loạt;
- context menu;
- profile root rõ ràng;
- proxy/IP rõ ràng;
- recovery rõ ràng;
- trạng thái dễ nhìn;
- queue có kiểm soát.

PAGE-AUTO phải làm tốt hơn ở:

- UI dễ hiểu hơn;
- Email/Facebook tách hẳn profile và proxy;
- worker isolation;
- full profile path visibility;
- Browser Auto;
- structured logs;
- test/CI;
- không phụ thuộc ChromeDriver.
