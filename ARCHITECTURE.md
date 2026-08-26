# PAGE-AUTO — Architecture

> Tài liệu này mô tả ranh giới source/runtime bắt buộc cho Page đa nghiệp vụ. Khi sửa core Facebook, phải đọc cùng `PROJECT_PLAN.md` trước khi code.

Baseline khi tạo tài liệu: `main@0926cdb7b3a6e0a00c74a3d9743e8ab099207c0a` — sau PR #76. Tài liệu phân biệt rõ **source hiện tại** và **đích refactor**; việc một module được ghi là “target/common” không có nghĩa source đã được di chuyển xong.

---

## 1. Vì sao phải tách kiến trúc

PAGE-AUTO ban đầu phát triển quanh flow Page đăng Group. Khi thêm Đăng Tường, Sửa Page, Comment... nếu mỗi nghiệp vụ tự mang theo login, 2FA, checkpoint, profile và Page switch thì sẽ xảy ra hai vấn đề:

1. Facebook đổi UI/flow ở một điểm nhưng phải sửa nhiều bản copy.
2. Một lỗi session có thể được xử lý khác nhau giữa Group/Tường/Sửa Page, làm runtime khó kiểm chứng.

Từ Issue #77, Page Tab được hiểu là **khu quản lý một Page**. Bên trong Page có nhiều nghiệp vụ. Phần Facebook dùng chung chỉ có một nguồn xử lý.

Quy tắc ngắn gọn:

> Facebook đổi chỗ nào thì chỉ sửa module đó. Không copy login/2FA/checkpoint/Page switch vào từng nghiệp vụ.

---

## 2. Các nguyên tắc không được phá

- React Renderer chỉ làm UI và gọi typed IPC qua preload.
- Electron Main sở hữu DB, filesystem, scheduler và worker lifecycle.
- Playwright chạy ngoài renderer; browser lỗi không được kéo treo UI.
- Account là session/profile thật; Page là identity được switch từ account.
- Một phiên/nghiệp vụ trong Page chạy account tuần tự; nhiều Page Tab có thể chạy song song.
- Secret không log plaintext.
- Checkpoint/xác minh danh tính không được tự động bypass.
- Không thêm anti-detection/evasion.
- Group source không bị xóa; anti-duplicate dùng snapshot/run items của phiên.
- Kiến trúc được tách dần theo batch; không đổi hành vi đang chạy ổn chỉ để “đẹp source”.

---

## 3. Sơ đồ tổng thể

```text
React Renderer
      |
      v
Typed IPC / Preload
      |
      v
Electron Main
  |
  +--> SQLite / Repositories
  |
  +--> Run Orchestration -----------------------------+
  |      scheduler / account turn / delay / status    |
  |      pause / resume / stop / worker lifecycle     |
  |                                                   |
  +--> Facebook Common Runtime <------------------+    |
  |      browser/profile                          |    |
  |      session/login/2FA/checkpoint             |    |
  |      account identity                         |    |
  |      Page switch + Page identity              |    |
  |      common pacing/recovery                   |    |
  |                                               |    |
  +--> Business Task -----------------------------+----+
         group_post
         page_wall_post
         page_edit
         comment / future tasks
              |
              v
        Playwright Worker
```

Business task được phép gọi primitive Facebook dùng chung, nhưng common runtime **không được phụ thuộc ngược** vào Group/Tường/Sửa Page cụ thể.

---

## 4. Tầng A — Facebook Common Runtime

### 4.1. Trách nhiệm

Tầng này sở hữu mọi hành vi Facebook có thể tái sử dụng giữa các nghiệp vụ:

#### Browser/profile

- resolve profile directory của account;
- launch/attach/giữ/đóng browser context theo policy;
- browser settings, proxy, User-Agent và lifetime ở mức dùng chung;
- external profile root khi tính năng đó được bật.

#### Session/login

- kiểm tra session;
- bootstrap session từ profile/cookie;
- login lại khi hết session;
- saved-profile/password-only flow;
- 2FA;
- xác minh sau login/2FA;
- lấy cookie/session mới sau recovery thành công;
- trả typed result để Main lưu lại.

#### Checkpoint/challenge

- phát hiện checkpoint/identity verification;
- phân loại challenge;
- CAPTCHA provider chỉ xử lý CAPTCHA được hỗ trợ;
- checkpoint/xác minh danh tính trả trạng thái cần xử lý, không bypass.

#### Identity

- xác minh account UID đang active;
- switch sang Page UID;
- xác minh Page identity sau switch;
- reuse Page identity nếu đã đúng và an toàn.

#### Common pacing/recovery

- các delay thao tác browser dùng chung khi phù hợp;
- timeout/network/browser failure result;
- lifecycle/recovery primitive không gắn với một nghiệp vụ cụ thể.

### 4.2. Không được làm

Facebook Common không được biết:

- Group UID list của tab;
- số Group đã consume trong run;
- Group random/sequential;
- logic “bài này thuộc Tường hay Group” nếu primitive không cần biết;
- field cụ thể của workflow Sửa Page;
- scheduler business-specific ngoài contract được truyền vào.

---

## 5. Tầng B — Run Orchestration

### 5.1. Trách nhiệm

Orchestration điều khiển **khi nào/ai chạy**, không điều khiển **Facebook click nút nào**.

Nó sở hữu:

- account list và thứ tự của phiên;
- account hiện tại;
- account đã hoàn thành lượt;
- số task/bài mỗi account;
- delay giữa bài;
- delay đổi account;
- pause/resume/stop;
- hết lượt account;
- đổi account;
- hết phiên;
- scheduler/time windows;
- worker allocation/lifecycle;
- run status/events/log;
- recovery policy sau crash/restart;
- trạng thái account **trong phiên**.

### 5.2. Không được làm

Orchestration không được chứa:

- selector Facebook;
- text regex của nút Login/Post/Continue;
- URL cụ thể để switch Page/Group nếu đó là hành vi Facebook business/common;
- code nhập password/2FA;
- code mở composer/upload media/publish cụ thể.

Nếu `rotationService` hoặc service orchestration phải biết selector Facebook để chạy được, boundary đang bị sai.

---

## 6. Tầng C — Business Tasks

### 6.1. `group_post`

Đây là nghiệp vụ hiện tại và là regression baseline quan trọng nhất.

Business-specific ownership:

- chọn target Group từ snapshot/run item;
- Group navigation;
- Group availability;
- content/image selection theo config Group;
- Group-specific publish verification;
- anti-duplicate Group trong phiên;
- random/sequential Group selection;
- message/log liên quan Group target.

Không sở hữu:

- login/re-login;
- 2FA;
- checkpoint detection chung;
- account identity;
- Page switch;
- profile resolver.

### 6.2. `page_wall_post`

Sau khi common runtime ổn định, flow Tường chỉ nên cần:

1. nhận một Facebook runtime đã sẵn sàng đúng account/Page;
2. mở surface Tường cần thiết;
3. compose content/media;
4. publish hoặc schedule theo nghiệp vụ;
5. verify result theo Tường;
6. trả typed task result.

Nghiệp vụ này **không copy GroupNavigator hoặc session/Page switch**.

### 6.3. `page_edit`

Workflow Sửa Page sở hữu:

- target field/update intent;
- navigation tới surface Settings/Profile phù hợp;
- thao tác field;
- xác minh thay đổi;
- typed result riêng.

Nó dùng common account/Page runtime và không sửa logic Group Post.

### 6.4. Nghiệp vụ tương lai

Comment/Reply/Reels/Story... phải đi theo cùng mẫu:

- định nghĩa task type + target + config + result;
- gọi common Facebook preparation;
- chạy qua orchestration;
- chỉ implement flow đích riêng.

---

## 7. Source hiện tại — audit ownership tại `main@0926cdb`

Phần này mô tả source đang có để người tiếp quản biết chỗ nào đang đúng boundary, chỗ nào cần tách.

### 7.1. Browser/session đang tương đối gần Common

`apps/desktop/src/main/browser/browserProfileManager.ts`

- quản lý persistent browser profile;
- về đích sẽ nằm dưới ownership Browser/Profile Common;
- External Profile Root phải đi qua cùng resolver, không tạo một đường profile riêng cho từng flow.

`apps/desktop/src/main/browser/browserRuntime.ts`

- browser settings/runtime primitives;
- thuộc Common Browser Runtime.

`apps/desktop/src/main/browser/facebookSession.ts`

- hiện chứa session/login/saved-profile/password/2FA state machine;
- đây là nguồn quan trọng của Facebook Session Common;
- lỗi post-2FA continuation phải sửa ở common flow nếu nguyên nhân nằm tại đây, không vá riêng Group.

`apps/desktop/src/main/browser/facebookAccountIdentity.ts`

- xác minh account identity;
- thuộc Facebook Common.

`apps/desktop/src/main/browser/facebookProfileInfo.ts`

- đọc thông tin identity/profile dùng chung;
- thuộc Facebook Common nếu không gắn business-specific behavior.

`apps/desktop/src/main/browser/managedBrowserBridge.ts`
`apps/desktop/src/main/browser/managedBrowserRegistry.ts`
`apps/desktop/src/main/browser/postingWorkerLifecycle.ts`
`apps/desktop/src/main/browser/runtimeLaunchGate.ts`

- là các primitive/lifecycle hiện hữu cần được giữ dưới boundary browser/worker dùng chung, tránh nhân bản theo business.

### 7.2. Các module đang nằm trong `browser/posting/` nhưng ownership thực tế không hẳn là Posting Business

`apps/desktop/src/main/browser/posting/pageIdentitySwitcher.ts`

- Page switch/Page identity là Facebook Common;
- việc file đang nằm trong `posting/` là debt tổ chức source, không có nghĩa nó thuộc Group Post.

`apps/desktop/src/main/browser/posting/managedPagesSwitcher.ts`

- hỗ trợ Page switch;
- ownership mục tiêu là Facebook Common/Page Identity.

`apps/desktop/src/main/browser/posting/pageState.ts`

- state/active profile và access block dùng chung cần được audit khi tách;
- phần generic thuộc Common, phần business-specific nếu có phải tách riêng.

`apps/desktop/src/main/browser/posting/facebookCheckpoint.ts`

- checkpoint là Facebook Common;
- không được để Group/Tường/Sửa Page có classifier riêng.

### 7.3. `postingEngine.ts` là điểm trộn 3 tầng hiện tại

`apps/desktop/src/main/browser/posting/postingEngine.ts` hiện đang làm trong một flow:

1. launch persistent context;
2. proxy/browser setup;
3. bootstrap Facebook session;
4. inspect account identity;
5. reuse/switch Page identity;
6. mở Group;
7. mở composer;
8. fill content;
9. upload media;
10. click publish;
11. verify bài theo Group;
12. validate/recover session sau run.

Trong cùng file hiện còn các class/logic như:

- `GroupNavigator`;
- `PostComposer`;
- `MediaUploader`;
- `PublishAction`;
- `PublishResultDetector`.

Điều này chạy được nhưng khiến common Facebook + orchestration concern + Group business bị dính nhau. Mục tiêu của #77 là làm `postingEngine` mỏng dần hoặc thay bằng task executor/composition rõ boundary, **không rewrite một phát toàn bộ**.

### 7.4. Composer/publish primitives

Các file trong `apps/desktop/src/main/browser/posting/` như composer detection/readiness/media/publish primitives cần phân loại theo nguyên tắc:

- nếu primitive chỉ cần `Page/Locator/content/media` và dùng được cho nhiều business -> có thể đưa về Common Posting Primitive;
- nếu nó biết Group URL, Group bucket, Group verification route -> thuộc `group_post`;
- không ép mọi thứ vào Common chỉ vì tên nghe chung.

Ví dụ hiện tại `PublishResultDetector` trong `postingEngine.ts` dùng Group UID và Group-specific verification URL, nên phần đó **không phải generic publish verifier**.

### 7.5. Orchestration/service hiện tại

`apps/desktop/src/main/services/accountExecutionCoordinator.ts`

- coordination account-level; ownership mục tiêu: Orchestration.

`apps/desktop/src/main/services/pageTabWorkerManager.ts`

- Page Tab worker lifecycle; ownership mục tiêu: Orchestration/Worker Manager.

`apps/desktop/src/main/services/rotationService.ts`

- account rotation/run control lớn hiện tại;
- khi refactor phải giữ nó ở tầng Orchestration và đẩy Facebook-specific browser actions ra common/business adapter.

`apps/desktop/src/main/services/rotationSchedule.ts`

- scheduler/time-window logic; Orchestration.

`apps/desktop/src/main/services/runtimeRecovery.ts`
`apps/desktop/src/main/services/runtimeFailureTracker.ts`
`apps/desktop/src/main/services/sessionFailurePolicy.ts`

- policy/recovery thuộc Orchestration hoặc Common tùy dữ liệu đầu vào;
- nguyên tắc là policy có thể hiểu typed failure code nhưng không chứa selector Facebook.

`apps/desktop/src/main/services/postingService.ts`
`apps/desktop/src/main/browser/postingWorkerManager.ts`
`apps/desktop/src/main/browser/posting-worker.ts`

- hiện là dispatch/worker boundary của posting;
- về đa nghiệp vụ cần tiến dần sang task dispatch generic thay vì hard-code Group job xuyên toàn stack.

---

## 8. Contract hiện tại và hướng generic task

### 8.1. Hiện tại

`apps/desktop/src/shared/posting.ts` có `PostingJobRequest` với các field trực tiếp như:

```ts
pageUid: string
groupUid: string
content: string
imagePaths: string[]
```

Điều này chứng minh request contract hiện đang gắn trực tiếp với Group Post.

### 8.2. Hướng mục tiêu

Không migrate DB lớn ngay. Trước hết contract cần có khái niệm rõ:

```ts
type FacebookTaskType =
  | 'group_post'
  | 'page_wall_post'
  | 'page_edit'
  | 'comment'
```

Và target có thể phát triển theo discriminated union, ví dụ định hướng:

```ts
type FacebookTaskTarget =
  | { kind: 'group'; groupUid: string }
  | { kind: 'page_wall'; pageUid: string }
  | { kind: 'page'; pageUid: string }
  | { kind: 'post'; postId: string }
```

Tên/interface cuối cùng có thể điều chỉnh trong batch code, nhưng invariants không đổi:

- task type phải explicit;
- target business phải explicit;
- session/profile/account/Page common data không copy vào từng schema business theo cách tạo nhiều nguồn sự thật;
- migration phải versioned và compatibility được test.

---

## 9. Chuẩn bị Facebook runtime trước business task

Đích flow nên có ý nghĩa tương tự:

```text
Orchestration chọn account + task
        |
        v
ProfileResolver.resolve(account)
        |
        v
FacebookSession.prepare(account, profile)
        |
        +--> ready
        +--> needs_login
        +--> checkpoint/verification_required
        +--> failed
        |
        v
AccountIdentity.verify
        |
        v
PageIdentity.ensure(pageUid)
        |
        v
PreparedFacebookRuntime
        |
        v
BusinessTask.execute(...)
```

Business task chỉ được chạy sau khi common runtime trả trạng thái sẵn sàng phù hợp.

### 9.1. Post-2FA/re-login continuation

Khi common session flow tự login lại và đi qua 2FA thành công:

1. chờ surface 2FA thật sự kết thúc;
2. xác minh session hợp lệ;
3. xác minh account identity nếu có thể;
4. đọc cookie/session mới;
5. gửi secret-free result về Main để Main lưu cookie/session theo contract hiện hành;
6. đảm bảo Page identity lại đúng trước khi tiếp tục;
7. trả control về orchestration/business task.

Không được coi “đã click Submit 2FA” là recovery thành công.

### 9.2. Checkpoint

Checkpoint flow phải trả typed state đủ để trace:

```text
Worker result
  -> Main service
  -> DB account/session status
  -> Page run account status
  -> Renderer
```

Không sửa UI thành đỏ giả nếu DB/Main state chưa đúng.

---

## 10. Status account: master và per-run là hai dữ liệu khác nhau

### 10.1. Master account status

Phản ánh tình trạng account/session ở mức quản lý account, ví dụ valid/needs_login/disabled hoặc status domain tương ứng.

### 10.2. Page run account status

Chỉ phản ánh vị trí của account trong **phiên Page hiện tại**:

- `not_started` — chưa chạy;
- `completed_turn` — xanh dương;
- `running` — xanh lá;
- `error` / checkpoint — đỏ;
- `waiting` — vàng.

Tên enum cuối cùng có thể được chốt trong batch code, nhưng UI semantics/màu đã chốt.

Per-run status không được ghi đè lịch sử/master status chỉ để hiển thị màu.

---

## 11. External Profile Root — một resolver duy nhất

Hạng mục từ #43 thuộc Facebook Common, không phải một feature riêng của Group.

Contract bắt buộc khi triển khai:

```text
External Root
  +-- <UID A>/
  +-- <UID B>/
  +-- <UID C>/
```

- account UID resolve tới `Root\UID`;
- không clone profile;
- external mode bật thì profile thiếu/root lỗi phải fail rõ;
- **không fallback** sang profile AppData/ổ C;
- không tự tạo app-managed profile để “cứ chạy tiếp”;
- mọi flow: Open Chrome, Check session, Page task worker... gọi cùng resolver.

Nếu có hai hàm resolve profile khác nhau cho Account và Group thì refactor chưa đạt yêu cầu.

---

## 12. Group Post regression invariants

Tách source không được âm thầm đổi Group behavior. Các invariant phải giữ:

- Group Set gốc không bị xóa;
- mỗi run clone snapshot/run items;
- success consume Group trong phiên theo policy hiện hành;
- account trong tab chạy tuần tự;
- số bài/account và delay giữ semantics;
- pause/resume/stop giữ semantics;
- scheduler/time windows giữ semantics;
- content/image selection giữ semantics trừ batch sửa bug riêng;
- publish verification không được biến click nút thành success nếu policy hiện hành yêu cầu evidence;
- failure/result code mapping được regression test;
- browser/session recovery không duplicate Group logic.

Bug `random` hiện còn OPEN thì phải giữ là bug OPEN; refactor không được “đánh dấu fixed” nếu chưa test đúng hành vi.

---

## 13. Cấu trúc thư mục mục tiêu

Đây là **ownership target**, không yêu cầu move toàn bộ trong một commit:

```text
apps/desktop/src/main/
  facebook/
    browser/
      profileResolver
      browserRuntime
    session/
      sessionRuntime
      loginRecovery
      twoFactor
      challengeDetector
    identity/
      accountIdentity
      pageIdentity
    posting/
      composerPrimitives
      mediaPrimitives
      publishPrimitives

  orchestration/
    pageTaskCoordinator
    accountRotation
    scheduler
    workerLifecycle
    runtimeStatus
    recovery

  business/
    group-post/
      groupNavigator
      groupTask
      groupPublishVerification
    page-wall-post/
      pageWallTask
    page-edit/
      pageEditTask

apps/desktop/src/shared/
  tasks/
    taskTypes
    taskTargets
    taskResults
```

Không bắt buộc dùng chính xác tên file trên. Điều bắt buộc là dependency boundary và một nguồn xử lý Facebook Common.

Trong thời gian migrate, có thể giữ adapter/re-export compatibility để PR nhỏ và review được.

---

## 14. Quy tắc khi thêm nghiệp vụ mới

Trước khi code business mới, trả lời được 7 câu:

1. `task type` là gì?
2. target business là gì?
3. config nào thuộc business, config nào thuộc Page/common?
4. common Facebook runtime đã cung cấp session + Page identity chưa?
5. orchestration đã cung cấp account turn/delay/pause/resume chưa?
6. result/evidence nào xác nhận business thành công?
7. test nào chứng minh không copy login/2FA/checkpoint/Page switch?

Checklist source:

- [ ] Không có login selector trong business task.
- [ ] Không có 2FA generator/submit flow trong business task.
- [ ] Không có checkpoint classifier riêng trong business task.
- [ ] Không có Page switch implementation riêng trong business task.
- [ ] Profile path đi qua common resolver.
- [ ] Task có typed result.
- [ ] Orchestration chỉ hiểu typed state/result.
- [ ] Secret không log.
- [ ] Regression của business hiện có vẫn xanh.

---

## 15. Testing strategy theo tầng

### Facebook Common

Test:

- session valid/expired;
- saved profile/password-only;
- 2FA transitions;
- post-2FA valid session verification;
- checkpoint/verification classification;
- account identity match/mismatch;
- Page identity reuse/switch/failure;
- profile resolver local/external strict behavior;
- proxy/browser failure typed result.

### Orchestration

Test bằng fake task/common adapter khi có thể:

- account order;
- N task/account;
- delays;
- pause/resume/stop;
- schedule windows;
- worker crash/recovery;
- per-run account statuses;
- không cần selector Facebook.

### Business Group

Test:

- target selection;
- random/sequential;
- snapshot chống trùng;
- content/media mapping;
- Group navigation/result verification;
- same observable behavior before/after common extraction.

### Live Windows retest

Unit/integration CI không thay thế live retest cho:

- checkpoint status end-to-end;
- login lại -> 2FA -> lưu session mới -> tiếp tục nghiệp vụ;
- browser profile thật/external root;
- Facebook UI-dependent Group publish.

---

## 16. Thứ tự thực thi Issue #77

Thứ tự hiện hành theo quyết định mới nhất:

1. **Kiến trúc + tài liệu**
   - `PROJECT_PLAN.md`
   - `ARCHITECTURE.md`
2. **UI/lỗi nhỏ ít rủi ro**
   - Settings scroll
   - Folder/nhóm account
   - selection/context menu audit
   - Import/Update UID semantics
3. **Page UI shell mới**
   - Nhóm / Đăng Tường / Sửa Page
   - compact controls
   - preview
   - per-run account status
4. **Tách source dùng chung**
   - Facebook Common
   - Orchestration boundary
   - Group thành business riêng
   - regression giữ Group behavior
5. **Lỗi live còn mở**
   - Group random
   - post-2FA continuation + persist session
   - checkpoint status end-to-end
6. **Facebook External Profile Root**
7. **Đăng Tường**
8. **Sửa Page**

Không trộn tất cả vào một PR lớn.

---

## 17. Known OPEN items tại thời điểm tạo tài liệu

Các mục dưới đây **chưa fixed chỉ vì tài liệu/CI xanh**:

- Group random vẫn có live report chạy theo thứ tự.
- Có ca account out -> login lại -> 2FA thành công trên Facebook nhưng runtime đứng, chưa tiếp tục nghiệp vụ/lưu session đầy đủ như kỳ vọng.
- Checkpoint được phát hiện nhưng status account/phiên chưa phản ánh đúng end-to-end.
- External Profile Root chưa phải resolver chung hoàn chỉnh theo yêu cầu strict của #77/#43.

Mỗi mục chỉ đóng khi batch tương ứng có test + bằng chứng live cần thiết.

---

## 18. Quy tắc cập nhật tài liệu

- Chat/lượt làm mới phải đọc `PROJECT_PLAN.md` trước khi sửa.
- Khi đụng core/runtime Facebook phải đọc thêm `ARCHITECTURE.md`.
- Nếu thay đổi ownership, dependency direction, task contract hoặc profile/session strategy thì cập nhật `ARCHITECTURE.md` trong cùng PR.
- Không ghi tài liệu target như thể code đã hoàn thành; phải dùng từ `hiện tại`, `target`, `đã migrate` rõ ràng.
- Nếu `ARCHITECTURE.md` mâu thuẫn với `PROJECT_PLAN.md`, dừng và sửa hai tài liệu cho thống nhất; trong lúc chưa cập nhật, `PROJECT_PLAN.md` là baseline ưu tiên.
- Không merge PR kiến trúc/code nếu chưa có lệnh rõ ràng của anh.

---

## 19. Definition of Done cho refactor kiến trúc

Refactor #77 chỉ đạt mục tiêu kiến trúc khi:

- login/2FA/checkpoint có một nguồn dùng chung;
- Page switch/Page identity có một nguồn dùng chung;
- profile resolver có một nguồn dùng chung;
- orchestration không chứa selector Facebook;
- Group Post nằm ở business boundary riêng;
- thêm Wall Post không cần copy Group/session;
- thêm Page Edit không cần sửa Group Post;
- `PostingJobRequest`/run contract không còn buộc toàn hệ thống phải giả định mọi task đều có `groupUid`;
- Group regression xanh;
- status master account và per-run status tách biệt;
- live checkpoint/post-2FA issues chỉ đóng sau live retest;
- tài liệu phản ánh đúng source thực tế sau từng batch.
