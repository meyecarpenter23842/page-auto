# PAGE-AUTO — EMAIL / HOTMAIL MODULE PLAN

> Plan chính thức cho module Email/Hotmail của PAGE-AUTO.
>
> Bản này thay thế cách hiểu cũ sau live review 2026-08-26. UI Email đã merge ở PR #84 **không được coi là baseline nghiệp vụ đúng** vì đã hiểu sai mô hình MaxHotmail: nhân cùng một danh sách account sang nhiều tab con. Phải rework theo plan này trước khi tiếp tục mở rộng.
>
> Phần Facebook External Profile Root vẫn thuộc #77. #43 sở hữu module Email; phần Facebook chỉ dùng một contract lấy mã Email, không sở hữu profile/proxy/runtime Email.

---

## 1. Bản chất module Email

Email không phải một hệ account tách rời khỏi Facebook.

**Account Manager/Facebook account là nguồn dữ liệu gốc.** Mỗi account đã có:

```text
UID | Email | PassEmail | BackupEmail
```

Email module phải đọc đúng account đó theo `accountId/UID`. Không tạo một bản danh sách credential Email độc lập rồi tự lệch dữ liệu với bảng Facebook.

Khi nghiệp vụ Email làm thay đổi dữ liệu thực của mailbox:

- đổi Password Email -> cập nhật lại `PassEmail` của đúng account;
- thêm/đổi/xóa Mail khôi phục -> cập nhật lại `BackupEmail` của đúng account;
- thay đổi Email chính nếu có nghiệp vụ được chấp nhận -> cập nhật đúng `Email` của account;
- OAuth state được lưu như extension 1:1 của account, không tạo một account Email thứ hai.

**Không lấy từ Facebook:** profile Facebook, cookie Facebook, session Facebook, proxy Facebook, browser process Facebook.

---

## 2. Profile và mạng: Facebook/Email tách tuyệt đối

Cùng một UID nhưng là hai browser identity khác nhau:

```text
Facebook profile: <FacebookProfileRoot>\<UID>
Email profile:    <EmailProfileRoot>\<UID>
```

Bắt buộc:

- không dùng chung folder profile;
- không dùng chung cookie/session;
- không fallback qua lại;
- không ép Email mở trong Chrome/profile Facebook;
- không ép Facebook mở trong profile Email.

### Proxy/IP

- Facebook dùng network/proxy của Facebook và có thể chạy IPv6.
- Email dùng network/proxy riêng, baseline ưu tiên IPv4.
- Hai bên có thể chạy đồng thời với hai proxy khác nhau.
- Đổi IP Email không được sửa `accounts.proxy` hoặc làm thay đổi proxy Facebook.

Lý do nghiệp vụ quan trọng: Facebook có thể đang chạy bằng IPv6 trong lúc Hotmail cần IPv4. Vì vậy không thể login Hotmail trong cùng profile/browser Facebook chỉ để lấy mã.

---

## 3. OAuth Email là cầu nối lấy mã cho Facebook

Đây là điểm cốt lõi mới phải khóa.

Mỗi account có Email OAuth state gắn 1:1 theo `accountId`, tối thiểu:

- OAuth Client ID hiện hành;
- Refresh Token hiện hành;
- trạng thái token;
- thời gian cập nhật/token check gần nhất;
- lỗi gần nhất.

Refresh Token là secret: lưu mã hóa/secret store, mask mặc định, không log plaintext.

### 3.1. Email module là nơi tạo/kiểm tra/cập nhật OAuth

Từ grid Email, operator có các nghiệp vụ thật kiểu MaxHotmail:

- Xem trạng thái RefreshToken OAuth2;
- Check Live RefreshToken OAuth2;
- Lấy/Cập nhật RefreshToken OAuth2 Hotmail;
- xem Client ID đang dùng;
- lấy mã thủ công;
- check live mailbox.

Khi Email lấy được Refresh Token/Client ID mới, phải lưu ngay vào **canonical Email OAuth state của đúng account**. Không copy sang một “bảng Facebook token” thứ hai.

### 3.2. Facebook runtime dùng chính OAuth state mới nhất

Khi Facebook đang chạy và gặp challenge cần mã gửi về Email:

```text
Facebook Common Runtime
  -> accountId/UID hiện tại
  -> EmailCodeProvider / Email Support Service
  -> đọc canonical Email OAuth state của account
  -> dùng Client ID + Refresh Token mới nhất để đọc mailbox
  -> tìm mã phù hợp
  -> trả mã typed result cho Facebook runtime
  -> Facebook nhập mã và tiếp tục flow được hỗ trợ
```

Điểm bắt buộc:

- Facebook không mở Hotmail trong browser Facebook;
- Facebook không dùng Email profile;
- Facebook không dùng proxy Email như proxy Facebook;
- Facebook runtime không giữ một bản Refresh Token cache độc lập lâu dài dễ bị cũ;
- nếu token đã được Email cập nhật thì lần gọi tiếp theo của Facebook phải đọc bản mới nhất;
- nếu OAuth thiếu/hết hạn/lỗi thì trả typed state như `email_auth_missing`, `email_auth_expired`, `email_code_not_found` thay vì treo phiên.

`Lấy mã` vì vậy có **hai consumer** dùng chung một service phía sau:

1. operator bấm lấy mã thủ công trong Email;
2. Facebook Common Runtime gọi lấy mã trong phiên Facebook đang chạy.

### 3.3. Ranh giới checkpoint

Chỉ tự động với challenge lấy mã Email trong flow tài khoản được hỗ trợ và mailbox thuộc đúng account.

Nếu Facebook/Microsoft chuyển sang identity review, security lock, guardian/phone challenge hoặc xác minh danh tính không thể giải bằng mã Email hợp lệ thì trả trạng thái thủ công. Không xây cơ chế bypass identity/security review.

---

## 4. UI chính thức — một grid Email, không nhân grid theo tab

Sidebar trái chỉ có **một mục `Email`**.

Khi vào Email, **một data-grid chính là trung tâm**. Đây là nơi chọn account và gọi nghiệp vụ.

### 4.1. Cấm cấu trúc sai hiện tại

Không làm:

```text
Tab Danh sách mail -> grid A
Tab Lấy mã        -> lại grid A đổi vài cột
Tab Mở mail       -> lại grid A đổi vài cột
Tab Mail khôi phục-> lại grid A đổi vài cột
```

Việc này không có giá trị nghiệp vụ và làm thao tác rối.

### 4.2. Cấu trúc đúng

```text
Email
  ├─ Grid mail chính
  │    ├─ Toolbar
  │    ├─ Filter/Search/Folder
  │    ├─ Multi-select
  │    └─ Right-click / Thao tác khác
  ├─ Queue/Kết quả thao tác khi cần
  ├─ Proxy/IP
  ├─ Nhật ký
  └─ Cài đặt
```

`Mở mail`, `Lấy mã`, `Check Live`, `Refresh Token`, `Đổi pass`, `Mail khôi phục`... là **action trên selection**, không phải mỗi action là một tab chứa bản sao của grid.

Một action phức tạp có thể mở popup/side panel/queue riêng để nhập option và xem kết quả, nhưng không nhân bản danh sách account.

### 4.3. Grid lấy dữ liệu từ Account Manager

Cột mục tiêu:

- Checkbox / STT
- UID
- Email
- Pass Email (mask)
- Mail khôi phục
- Tên / Category / Folder / Note từ account nếu cần
- Tình trạng Hotmail
- Tình trạng OAuth
- Client ID trạng thái/preview phù hợp
- Refresh Token status + updated time, **không show plaintext mặc định**
- Tình trạng Email profile
- Email Profile Path
- Email Proxy/IP
- mã mới nhất + thời gian nhận
- runtime/action hiện tại
- lỗi gần nhất

Grid hỗ trợ:

- Ctrl/Shift selection;
- rê/chọn nhiều dòng thuận tiện;
- filter/sort/search;
- hide/show/reorder/resize cột;
- persist layout;
- context menu áp dụng cho selection;
- bulk action;
- virtual scroll khi danh sách lớn.

---

## 5. Danh mục nghiệp vụ tham khảo MaxHotmail

Ảnh MaxHotmail được dùng làm **tham khảo nghiệp vụ**, không copy UI thô.

### 5.1. Email/Profile/OAuth/Code

- Thiết lập Email Support
- Mở/Xem Hotmail Chrome
- Xem trạng thái RefreshToken OAuth2
- Check Live RefreshToken OAuth2
- Lấy/Cập nhật RefreshToken OAuth2 Hotmail
- Get Code Hotmail / Lấy mã
- Get Code Email Support
- Check Live Hotmail

### 5.2. Password / Recovery mail / Account support

Backlog nghiệp vụ cần thiết kế lần lượt:

- đổi pass Hotmail;
- đổi pass hết hạn;
- thêm Email khôi phục;
- xóa Email khôi phục;
- xóa + thêm Email khôi phục;
- thêm Email khôi phục khi chưa có thông tin cũ;
- đổi pass + thêm Email khôi phục;
- thêm/xóa Email khôi phục + đổi pass;
- reset pass qua Email khôi phục theo flow chính thức;
- xử lý challenge phone/recovery theo flow được hỗ trợ;
- các combo thao tác batch khi thật sự có nhu cầu vận hành.

Các action có thể dẫn tới identity/security review phải dừng typed manual state; không bypass.

### 5.3. Mailbox / alias / housekeeping

Có thể đưa vào backlog nâng cao:

- xóa toàn bộ mail trong mailbox;
- xóa toàn bộ alias;
- thao tác alias/recovery khác;
- xác nhận người giám hộ nếu đây là flow chính thức và operator chủ động thực hiện.

Action phá dữ liệu như xóa toàn bộ mail/alias phải có confirmation rõ ràng và không chạy do click nhầm.

Không nhất thiết ship toàn bộ danh sách MaxHotmail trong MVP; nhưng plan/data model/action framework phải không khóa đường mở rộng các nghiệp vụ này.

---

## 6. Email Profile lifecycle

User chọn `Email Profile Root` riêng.

Resolve tuyệt đối:

```text
<EmailProfileRoot>\<UID>
```

Yêu cầu:

- dùng trực tiếp profile MaxHotmail hiện có;
- không clone/copy;
- không fallback sang Facebook profile;
- không fallback sang profile AppData khác khi external root được chọn;
- không tự tạo `UID-copy`, `UID-2`;
- hiển thị Profile Path;
- attach live CDP nếu an toàn;
- stale endpoint + không có real lock -> relaunch cùng profile;
- real lock/không attach được -> báo `Đang sử dụng`;
- không xóa lock cưỡng bức.

Browser Email mặc định **Tự động**. Manual executable là nâng cao.

Validation browser phải dùng cùng persistent-profile semantics với runtime thật.

---

## 7. Proxy/IP Email

Email có network settings riêng:

- Direct;
- Random IPv4 pool;
- provider khác mở rộng sau.

Yêu cầu:

- pool IPv4 riêng;
- test IP/proxy;
- rotate;
- fail count/cooldown;
- session nào đang sở hữu proxy nào phải rõ;
- không đổi proxy giữa một browser process đang chạy rồi giả vờ đã áp dụng;
- credential proxy không log plaintext.

---

## 8. Runtime Email và Email Support Service

Email có worker/queue riêng cho thao tác browser/mailbox batch.

Facebook không dùng queue Page Tab để chạy nghiệp vụ Email.

Tuy nhiên `EmailCodeProvider` là service contract có thể được Facebook Common Runtime gọi trong phiên.

Phân biệt:

```text
Email UI batch runtime
  -> mở profile/check mail/lấy OAuth/đổi pass/recovery...

Email Support Service
  -> lookup account email state
  -> lấy code qua OAuth khi có thể
  -> trả typed result cho caller như Facebook Common Runtime
```

Worker crash Email không được kéo treo Facebook UI/runtime. Caller nhận timeout/error typed rõ ràng.

---

## 9. Data ownership đề xuất

Không tạo bảng account mail độc lập.

### `accounts` — source of truth identity/credential fields

Giữ các field nghiệp vụ chính:

- UID
- Email
- PassEmail
- BackupEmail
- Name/Category/Folder/Note...

### `account_email_state` — extension 1:1 theo `account_id`

Mục tiêu lưu trạng thái Email, ví dụ:

- `account_id` UNIQUE/FK
- `oauth_client_id`
- `refresh_token_ciphertext`
- `oauth_status`
- `oauth_updated_at`
- `mail_status`
- `last_mail_check_at`
- `last_code_at`
- `last_error_code/message` sanitized

Latest verification code nếu persist thì phải có TTL ngắn/mask policy; không biến DB/log thành kho OTP lịch sử.

### Các bảng/config riêng Email

Có thể giữ:

- `email_profile_settings`
- `email_proxy_settings`
- `email_runtime_sessions`
- `email_runtime_events`

Nhưng tất cả runtime state phải join về `account_id`, không tạo một identity Email song song.

---

## 10. Security / logging

Không log plaintext:

- PassEmail;
- Refresh Token;
- access token;
- OTP/code cũ;
- proxy password;
- cookie/session Facebook hoặc Email.

UI secret mask mặc định. Reveal/copy secret nếu có phải là action chủ động.

OAuth desktop dùng public-client pattern phù hợp; không nhét client secret cố định vào renderer/source.

---

## 11. Rework plan từ trạng thái hiện tại

### E0-R — Reset acceptance sau PR #84

- audit UI Email đang có trên main;
- đánh dấu phần duplicate-grid là sai cấu trúc;
- xác định component/backend nào tái sử dụng được;
- không tiếp tục thêm nghiệp vụ lên shell sai.

### E1-R — Account binding + canonical Email state

- grid Email đọc account từ Account Manager;
- `accountId/UID` là khóa xuyên module;
- sync PassEmail/BackupEmail khi nghiệp vụ Email thay đổi dữ liệu;
- thêm/migrate `account_email_state` nếu cần;
- secret storage đúng.

### E2-R — UI Email đúng kiểu MaxHotmail

- một grid chính;
- toolbar + context menu mạnh;
- không duplicate grid theo action;
- action panel/queue riêng khi cần;
- sửa wording dựa trên nghiệp vụ thực.

### E3-R — Email profile/browser/network

- Email Profile Root `root\UID`;
- Browser Auto;
- persistent validation;
- proxy IPv4 riêng;
- live/stale/lock lifecycle.

### E4-R — OAuth lifecycle + lấy mã + Facebook bridge

- View/Check/Lấy RefreshToken OAuth2;
- quản lý Client ID;
- canonical token state;
- manual Get Code;
- `EmailCodeProvider` typed contract;
- Facebook Common Runtime đọc token mới nhất theo accountId;
- test trường hợp Facebook đang chạy IPv6 nhưng lấy code qua Email Support Service mà không mở Hotmail trong profile Facebook.

### E5-R — Mail support/recovery/password

- Check Live Hotmail;
- password actions;
- recovery mail actions;
- các combo action cần thiết;
- typed manual state khi gặp identity/security verification.

### E6-R — Queue/log/window/bulk polish

- batch queue/concurrency;
- pause/resume/stop;
- window layout Email;
- detailed sanitized logs;
- filter/layout persist;
- destructive confirmations;
- live Windows acceptance.

Không trộn tất cả vào một PR lớn.

---

## 12. Acceptance bắt buộc

- [ ] Email grid lấy đúng `UID | Email | PassEmail | BackupEmail` từ Account Manager.
- [ ] Không có account credential Email duplicate độc lập với account Facebook.
- [ ] Khi Email đổi PassEmail/BackupEmail, Account Manager phản ánh dữ liệu mới của đúng account.
- [ ] OAuth state gắn 1:1 với accountId và là nguồn chuẩn duy nhất cho Facebook lấy mã.
- [ ] Email cập nhật Refresh Token/Client ID mới -> Facebook call sau dùng ngay bản mới nhất.
- [ ] Facebook không mở Hotmail trong profile/browser Facebook để lấy code.
- [ ] Facebook profile/proxy và Email profile/proxy tách hoàn toàn.
- [ ] Facebook có thể chạy IPv6 đồng thời Email dùng IPv4 riêng.
- [ ] `Lấy mã` dùng được cả thủ công lẫn qua Facebook Common Runtime bằng cùng service phía sau.
- [ ] OAuth/token lỗi trả typed state, không làm treo phiên Facebook.
- [ ] Một grid Email chính; không nhân cùng danh sách sang tab Mở mail/Lấy mã/Mail khôi phục.
- [ ] Context menu/toolbar có nghiệp vụ kiểu MaxHotmail và áp dụng cho selection.
- [ ] Refresh Token không lộ plaintext mặc định/log.
- [ ] Email Profile Path đúng `<EmailProfileRoot>\<UID>` và không fallback sai.
- [ ] Identity/security review không bị bypass; chuyển manual state.
- [ ] Destructive action có confirmation.
- [ ] CI Windows xanh trước merge.
- [ ] Không merge nếu chưa có lệnh rõ ràng.

---

## Liên quan

- Issue Email: #43
- Facebook Common Runtime/Page architecture: #77
- Baseline chung: `PROJECT_PLAN.md`
- Facebook architecture: `ARCHITECTURE.md`

Khi implement phần Facebook-side của `EmailCodeProvider`, phải đọc lại `PROJECT_PLAN.md` + `ARCHITECTURE.md` và cập nhật architecture trong cùng lô nếu contract thực tế thay đổi.