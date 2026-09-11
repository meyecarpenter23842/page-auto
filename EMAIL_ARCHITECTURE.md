# PAGE-AUTO — Email Module Architecture

> Trạng thái: **kiến trúc đích bắt buộc** cho toàn bộ Email/Microsoft runtime.
>
> Baseline audit: `main@484bdf641df1e1cc3d56e7caebae29cfcfb42f6c` sau rollback PR #377, Main CI #2464 xanh.
>
> Tài liệu này tách rõ hai khái niệm thường bị trộn: **Microsoft Authentication** và **Mailbox Provider**. Khi sửa Email phải đọc cùng `PROJECT_PRINCIPLES.md`, `PROJECT_PLAN.md` và `ARCHITECTURE.md`.

---

## 1. Quy tắc cốt lõi

> **Mỗi loại mail là một module độc lập. Đụng loại nào thì sửa module đó.**

Các module không được chia theo kiểu “cùng liên quan Email nên dùng chung selector/flow”. Chỉ contract và orchestration thật sự generic mới được dùng chung.

Các identity khác nhau phải được xem là module khác nhau dù cùng nhà cung cấp:

- **Microsoft Auth** = đăng nhập/xác minh tài khoản Microsoft đang được thao tác.
- **Hotmail/Outlook Mailbox** = đọc mailbox Microsoft/Outlook để lấy mail/code.

Hai module này **không phải một module**.

---

## 2. Sơ đồ đích

```text
Consumer
  |
  +--> Microsoft Auth Controller
  |       username/password/recovery/passkey/checkpoint
  |       |
  |       | cần code cho mailbox X
  |       v
  +--> Mailbox Router / Coordinator
          |
          +--> Inboxes Module
          +--> FviaInboxes Module
          +--> MailtoPlus Module
          +--> Hotmail/Outlook Mailbox Module
          +--> provider tương lai
```

Điểm nối giữa Microsoft Auth và mailbox chỉ là typed contract.

Microsoft Auth **không được biết** mailbox X đang chạy bằng website/API nào.

---

## 3. Module ownership bắt buộc

### 3.1. Microsoft Auth module

Sở hữu:

- detect Microsoft surface hiện tại;
- state-driven `detect -> handler -> detect lại`;
- username;
- password;
- account picker;
- stay signed in;
- recovery method choice;
- recovery email confirmation;
- recovery code input/submit;
- passkey/sign-in continuation khi được audit;
- authenticated / checkpoint / needs_attention typed result;
- Microsoft page ownership.

Không được sở hữu:

- selector Inboxes/Fvia/MailtoPlus/Outlook mailbox;
- URL mailbox provider;
- popup/ad/vignette provider;
- refresh/reload policy riêng của provider;
- poll interval/timeout hard-code theo từng provider;
- cách provider tìm/open/read message;
- provider browser lifecycle cụ thể.

Microsoft Auth chỉ được gọi một contract kiểu:

```text
prepareChallenge(mailbox)
getFreshCode(challenge)
releaseChallenge(...)
```

và nhận typed result.

### 3.2. Inboxes module

Sở hữu toàn bộ hành vi riêng của Inboxes:

- domain nhận diện;
- page readiness;
- mailbox add/open/reuse;
- list/detail DOM;
- popup/overlay/vignette;
- reload/recovery;
- freshness/message identity;
- snapshot messageKey;
- lấy verification code;
- lifecycle provider page.

Không được biết Microsoft đang ở `password`, `recovery_email`, `recovery_code` hay state nào khác.

### 3.3. FviaInboxes module

Sở hữu toàn bộ:

- Fvia URL/domain;
- form/list/detail DOM;
- login/open mailbox nếu provider yêu cầu;
- message selection;
- message identity;
- code extraction;
- timeout/retry policy đã audit riêng cho Fvia;
- provider page lifecycle.

Không dùng Inboxes-specific recovery chỉ vì hai provider đều là web mailbox.

### 3.4. MailtoPlus module

Sở hữu:

- MailtoPlus API/web transport;
- mailbox/message identity;
- polling/freshness;
- code extraction;
- provider-specific failures.

Không để Microsoft Auth mở page MailtoPlus trực tiếp.

### 3.5. Hotmail/Outlook Mailbox module

Đây là **module mailbox riêng**, không đồng nghĩa với Microsoft Auth.

Sở hữu:

- OAuth/Graph hoặc Outlook mailbox transport đã chốt;
- token/mailbox state;
- list/read message;
- freshness/message identity;
- verification-code parsing;
- typed mailbox failure.

Microsoft Auth có thể dùng Hotmail/Outlook Mailbox làm Mail KP giống như dùng Inboxes/Fvia, nhưng chỉ qua Mailbox Router.

---

## 4. Common được phép chứa gì

Common chỉ được chứa primitive không phụ thuộc provider:

- `MailProvider` / `MailboxProvider` interface;
- normalized mailbox address;
- provider ID/domain registry;
- typed result/status;
- challenge ID;
- baseline/consumed message-key contract;
- provider factory/registration ở **composition root**;
- coordinator chỉ điều phối typed provider call;
- secret redaction;
- generic cancellation/timeout plumbing nếu semantics thật sự giống nhau.

Common **không được chứa**:

- `if provider === inboxes` để dismiss vignette;
- `if provider === fvia` để check URL;
- selector provider;
- provider-specific reload/recovery;
- provider-specific DOM classification;
- provider-specific polling magic numbers;
- Microsoft selector/state transition.

Nếu Common cần biết một chi tiết web cụ thể của provider thì boundary đang sai; chi tiết đó phải quay về module provider.

---

## 5. Router / composition root

Router được phép biết **provider ID -> module implementation**, ví dụ:

```text
inboxes       -> InboxesMailboxProvider
fvia_inboxes  -> FviaInboxesMailboxProvider
mailto_plus   -> MailtoPlusMailboxProvider
microsoft     -> MicrosoftMailboxProvider
```

Router chỉ:

1. resolve mailbox -> provider ID;
2. lấy đúng provider implementation;
3. chuyển request typed vào provider;
4. trả typed result về caller.

Router không click DOM và không sửa state Microsoft Auth.

---

## 6. Contract ráp module

Contract tối thiểu phải giữ identity của challenge và message:

```ts
interface MailboxCodeRequest {
  mailbox: string
  purpose: 'microsoft_security' | 'generic_verification'
  challengeId: string
  notBefore?: number
  baselineMessageKeys?: readonly string[]
  consumedMessageKeys?: readonly string[]
  timeoutMs?: number
}

interface MailboxCodeResult {
  providerId: MailProviderId
  mailbox: string
  status: 'success' | 'message_not_found' | 'timeout' | 'provider_unavailable' | 'needs_attention'
  code: string | null
  messageKey: string | null
}
```

Tên type cuối cùng có thể reuse type hiện hữu, nhưng semantics trên là bắt buộc.

Provider trả `success` phải có `code + messageKey` đủ để chống submit lại cùng mail.

---

## 7. Recovery nhiều vòng

Một Microsoft auth session có thể hỏi code nhiều lần.

Flow bắt buộc:

```text
Microsoft recovery challenge #1
  -> Router -> đúng Mailbox Module
  -> code/messageKey #1
  -> Microsoft submit
  -> detect lại

Microsoft recovery challenge #2
  -> Router -> cùng/khác Mailbox Module
  -> loại messageKey #1 + baseline cũ
  -> code/messageKey #2
  -> Microsoft submit
  -> detect lại
```

Không được:

- reuse code/messageKey đã submit;
- cleanup recovery state chỉ vì vừa click Next;
- giả định challenge sau giống challenge trước;
- provider tự quyết định Microsoft đã authenticated.

---

## 8. Browser/page ownership

Mỗi page có owner rõ:

```text
Microsoft Auth page       -> Microsoft Auth module
Inboxes page              -> Inboxes module
Fvia page                 -> Fvia module
MailtoPlus page           -> MailtoPlus module nếu dùng browser
Outlook mailbox page      -> Microsoft Mailbox module nếu dùng browser
Unrelated/operator page   -> không module nào được tự đóng/chiếm
```

Không dùng `context.pages()[0]` như identity.

Module A không được navigate/close page do module B sở hữu ngoài cleanup contract đã chốt.

Provider page có thể chạy background; Microsoft Auth page là operator foreground mặc định. Việc focus provider chỉ do chính provider yêu cầu, không phải Microsoft Auth hard-code.

---

## 9. Dependency direction

Được phép:

```text
MicrosoftAuth -> mailbox contract/router
MailboxRouter -> provider registration/factory
Provider -> common mailbox contracts/utilities
Consumer -> MicrosoftAuth
Consumer -> MailboxRouter
```

Bị cấm:

```text
MicrosoftAuth -> Inboxes driver
MicrosoftAuth -> Fvia driver
MicrosoftAuth -> MailtoPlus driver
MicrosoftAuth -> Outlook mailbox DOM/API implementation

MailboxCode common -> Inboxes vignette logic
MailboxCode common -> Fvia URL/DOM logic

Inboxes/Fvia/MailtoPlus -> Microsoft Auth state machine
```

Một import vi phạm các mũi tên cấm phải được coi là architecture regression.

---

## 10. Audit source hiện tại tại `main@484bdf64`

Source hiện tại **chưa đạt đích**.

### Đã đúng hướng

- `mailProvider.ts` đã có contract chung.
- `mailProviderRegistry.ts` đã resolve domain thành provider ID.
- `inboxesProvider.ts`, `fviaInboxesProvider.ts`, `mailtoPlusProvider.ts` đã có adapter/provider riêng.
- Microsoft Auth V2 đã có detector/dispatcher/handler foundation.
- recovery round đã có baseline/consumed message identity.

### Technical debt phải migrate

#### `mailboxCodeService.ts`

Hiện vẫn import trực tiếp:

- Inboxes provider/driver;
- Fvia provider/driver;
- Inboxes vignette guard;
- URL/readiness/reload riêng từng provider.

Đây là vi phạm boundary. `MailboxCodeService` phải trở thành coordinator generic hoặc được thay bằng router/coordinator mỏng; provider-specific behavior chuyển về provider module.

#### `microsoftRecoveryChallenge.ts`

Hiện vẫn biết:

- browser provider factory;
- provider ID cụ thể;
- timeout/poll riêng Inboxes/Fvia;
- legacy provider page lifecycle;
- cách chọn đường MailboxCodeService hay legacy provider.

Đây là coupling phải bỏ. Microsoft recovery chỉ gọi mailbox contract/router.

#### Microsoft mailbox

`MicrosoftOAuthService` + `MicrosoftGraphMailAdapter` + canonical code provider đã có chức năng đọc Hotmail/Outlook mailbox nhưng chưa được đóng gói hoàn toàn thành provider ngang hàng với Inboxes/Fvia/MailtoPlus cho mọi mailbox-code consumer.

---

## 11. Migration plan — không rewrite một phát

### Batch E-MOD-1 — Contracts + composition root

- khóa contract mailbox;
- tạo provider registration/router;
- không đổi selector/behavior provider;
- regression mapping domain/provider.

### Batch E-MOD-2 — Tách Inboxes khỏi Common

- chuyển vignette/reload/page recovery về Inboxes module;
- Common chỉ gọi provider contract;
- regression Inboxes code 1 vòng + 2 vòng.

### Batch E-MOD-3 — Tách Fvia khỏi Common

- chuyển Fvia URL/DOM/lifecycle/timeout policy về Fvia module;
- không thay Microsoft login policy;
- regression Fvia riêng.

### Batch E-MOD-4 — Microsoft Auth chỉ dùng Router

- bỏ import/provider branching khỏi `microsoftRecoveryChallenge.ts`;
- Microsoft recovery nhận typed mailbox result;
- giữ state-driven detect lại sau mỗi action.

### Batch E-MOD-5 — Hotmail/Outlook Mailbox provider

- đóng gói OAuth/Graph mailbox thành `microsoft` mailbox provider;
- Microsoft Auth vẫn không import implementation này;
- regression Mail KP là Hotmail/Outlook.

### Batch E-MOD-6 — Cleanup + architecture guard

- xóa legacy cross-import;
- test/static guard dependency direction;
- live matrix;
- chỉ lúc này mới coi migration module hoàn tất.

Mỗi batch là một PR review được; không gom selector fixes không liên quan vào migration.

---

## 12. Regression bắt buộc trước merge từng batch

### Contract/module tests

- domain -> đúng provider;
- provider A không gọi implementation provider B;
- Common không chứa provider-specific behavior mới;
- Microsoft Auth không import concrete mailbox provider;
- typed result được bảo toàn.

### Integration matrix

```text
Microsoft Auth + Inboxes          code 1 vòng
Microsoft Auth + Inboxes          code 2 vòng / mail mới lần 2
Microsoft Auth + Fvia             code mới đúng provider
Microsoft Auth + MailtoPlus       provider contract
Microsoft Auth + Hotmail mailbox  OAuth/Graph mailbox provider
```

### Failure matrix

- provider unavailable -> typed failure, Microsoft không nhập bừa;
- unknown Microsoft surface -> fail closed;
- old messageKey -> không submit lại;
- provider page đóng -> chỉ provider xử lý recovery;
- Microsoft page đóng -> Microsoft Auth xử lý, provider không chiếm page khác;
- checkpoint/security review -> needs_attention, không bypass.

---

## 13. Quy tắc sửa bug sau migration

Khi có bug phải xác định owner trước:

```text
Microsoft nhập sai field       -> Microsoft Auth
Inboxes không mở đúng mail     -> Inboxes
Fvia chọn sai message          -> Fvia
MailtoPlus API đổi             -> MailtoPlus
Outlook/Graph đọc mail lỗi     -> Hotmail/Outlook Mailbox
Sai chọn provider theo domain  -> Router/Registry
Sai chống dùng lại code        -> generic challenge contract/coordinator
```

Không sửa module khác để “né” bug của module owner.

---

## 14. Non-goals của lô kiến trúc này

Tài liệu này **không tuyên bố runtime đã migrate xong**.

Lô docs không:

- đổi selector;
- sửa Passkey;
- đổi password/recovery priority;
- đổi Inboxes/Fvia behavior;
- đổi DB;
- deploy/release;
- tự merge.

Sau khi tài liệu được merge, implementation phải đi theo Batch E-MOD-1 -> E-MOD-6 và giữ behavior live đang ổn bằng regression trước khi cleanup legacy.
