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
- Concurrency là policy orchestration của từng workflow, không phải giả định cố định toàn app. `group_post` Page Tab hiện vẫn chạy account tuần tự; workspace `Tương tác` có thể chạy rolling concurrency theo config đã snapshot.
- Dù có nhiều workspace/Page Tab chạy song song, cùng một account không được bị hai flow điều khiển đồng thời; account-level execution coordinator là lock dùng chung toàn Main.
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
  |      scheduler / account turn / concurrency       |
  |      rolling pool / delay / status                |
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
- login lại khi session hết;
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
- policy tuần tự/concurrency của workflow;
- account hiện tại hoặc tập account active;
- account đã hoàn thành lượt;
- rolling pool/slot refill nếu workflow cho phép concurrency;
- global account execution lease để cùng một account không chạy trùng giữa workflow;
- số task/bài mỗi account;
- delay giữa bài;
- delay đổi account;
- pause/resume/stop;
- hết lượt account;
- đổi/account refill slot;
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

### 5.3. Rolling concurrency của workspace Tương tác

`Tương tác` là workspace đầu tiên có concurrency account cấu hình được. Invariant hiện hành:

- config `accountConcurrency` thuộc orchestration và được validate `1..20`;
- config legacy thiếu field phải parse về `1`;
- Start freeze config + account order vào run snapshot;
- runner dùng **rolling pool**, không chia batch: khi một slot hoàn tất thì slot đó lấy account kế tiếp ngay dù các slot còn lại vẫn đang chạy;
- account đang bị workflow khác giữ global execution lease không được làm mất slot nếu queue còn account khác acquire được; orchestration có thể bỏ qua tạm và quay lại account bị lock sau;
- Pause ngăn cấp account/action mới và cooperative-pause các action đang active; Resume tiếp tục snapshot cũ; Stop dừng active worker và không cấp account mới;
- `AccountExecutionCoordinator` vẫn là global account lock dùng chung giữa Scenario/Page/Action flows;
- thay đổi này **không đổi** `group_post` rotation hiện hành: Group Page Tab vẫn tuần tự cho tới một batch riêng chủ đích thay semantics đó.

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

- coordination account-level; ownership mục tiêu: Orchestration;
- lock table là global trong Electron Main; rolling pool phải acquire lease trước khi chiếm slot thực thi để cùng account không chạy trùng giữa workflow.

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
- rolling pool không có batch barrier: slot xong phải refill account kế tiếp ngay;
- account global-lock không được chiếm mất concurrency slot nếu còn account khác runnable;
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

---

## 20. Email Support bridge — ownership sau E4-R

E4-R thêm một cầu nối hẹp từ Facebook Common Runtime sang module Email nhưng **không nhập hai browser identity vào nhau**.

Flow hiện hành sau batch này:

```text
Email UI — Lấy mã
        |
        +------------------------------+
                                       v
                              EmailCodeProvider
                                       |
Facebook Common Runtime               |  đọc canonical state mới nhất
  -> posting utility worker            |  theo accountId mỗi lần gọi
  -> typed EmailCode RPC --------------+
                                       |
                                       v
                         account_email_state
                         Client ID + Refresh Token
                                       |
                                       v
                         Microsoft OAuth + Graph Mail
```

Ownership bắt buộc:

- `apps/desktop/src/shared/emailCode.ts` là contract secret-free giữa consumer và Email Support Service.
- Canonical Email OAuth state vẫn thuộc Main/DB theo `accountId`; Refresh Token không được gửi sang renderer hoặc posting worker.
- Manual `Lấy mã` và Facebook Common Runtime dùng cùng `EmailCodeProvider`, không duy trì hai đường parser/token riêng.
- Posting worker chỉ được gửi `accountId`, `consumer`, `notBefore`, `timeoutMs` và nhận typed result/code; không nhận Email profile path, Email proxy credential, Client ID hay Refresh Token.
- Facebook Common chỉ tự xử lý challenge có tín hiệu **mã gửi qua Email** rõ ràng. Identity review, phone/guardian/security review khác vẫn trả manual verification; không bypass.
- Sau khi Email challenge thành công, control quay lại Facebook session state machine hiện hữu để xác minh session/account identity trước khi chạy business task.

Typed failure từ Email Support phải giữ nguyên tới caller:

```text
email_auth_missing
email_auth_expired
email_code_not_found
email_support_error
email_code_failed
```

Network/profile invariant:

- Facebook không mở Hotmail bằng Facebook profile để lấy mã.
- Email Support RPC không mang Facebook proxy/cookie/profile sang module Email.
- Facebook browser có thể đang dùng proxy/network IPv6 trong khi Email Support chạy độc lập; request lấy mã không phụ thuộc network config của posting job.
- OAuth/Graph transport hiện là service-side trong Main và không kế thừa Facebook browser proxy. Nếu sau này cần route transport qua proxy, phải dùng adapter/network ownership riêng của Email, tuyệt đối không mượn Facebook proxy.

Security invariant:

- Access Token/Refresh Token không log plaintext và không đi qua worker RPC.
- OTP/code không được ghi vào log; nếu lưu `lastCode` để UI thao tác thì TTL ngắn và được purge theo policy Email.
- Worker timeout/crash trả typed support error; không treo phiên Facebook vô hạn.

---

## 21. Trạng thái Đăng Tường — lô nền 5A

Lô 5A trong trao đổi hiện tại thuộc **Batch 7 — Đăng Tường** của `PROJECT_PLAN.md`. Mục tiêu của lô này là tạo contract/runtime boundary trước khi nối publish thật.

Source mới trong lô:

- `apps/desktop/src/shared/facebookTasks.ts`
  - định nghĩa `FacebookTaskType` cho `group_post`, `page_wall_post`, `page_edit`, `comment`;
  - target là discriminated union theo business;
  - `FacebookTaskJobBase` lấy common account/Page/runtime material từ contract posting hiện hành nhưng bỏ `groupUid`;
  - `PageWallPostTaskJobRequest` vì vậy **không cần Group UID**;
  - Group hiện tại có adapter `groupPostTaskFromLegacy` / `legacyPostingJobFromGroupTask` để chứng minh round-trip không đổi observable fields trong lúc migrate dần.
- `apps/desktop/src/main/business/page-wall-post/pageWallTask.ts`
  - là business module đầu tiên của Tường;
  - chỉ nhận `PreparedPageWallRuntime` đã có `Page`, timing, common pacing và `checkAccessBlock`;
  - tự sở hữu navigation tới surface Tường theo Page UID;
  - không chứa login selector, 2FA, checkpoint classifier, account identity hoặc Page switch.

Giới hạn cố ý của 5A:

- `PostingJobRequest` + posting worker hiện tại vẫn là **legacy Group execution path**; chưa đổi worker dispatch để tránh tạo đường `success` giả cho bài Tường chưa publish.
- Chưa nối composer/content/media/publish/result verification cho `page_wall_post`.
- Chưa tạo DB migration, run item/scheduler mới, IPC hoặc renderer wiring cho Tường.
- `PageWallTask.prepare()` chỉ xác minh boundary prepared-runtime + mở surface Tường; 5B mới được phép nối đường đăng ngay và phải có result/evidence riêng trước khi coi publish thành công.

Invariant sau 5A:

> Có thể biểu diễn `page_wall_post` bằng typed contract mà không giả định `groupUid`, và business Tường có thể chạy trên runtime đã chuẩn bị mà không copy session/login/2FA/checkpoint/Page switch. Group Post production path chưa bị thay đổi.

---

## 22. Trạng thái Đăng Tường — lô 5B publish trực tiếp

Lô 5B nối **đăng ngay** ở business layer trên `PreparedPageWallRuntime`, nhưng vẫn chưa wire Main/worker/UI/scheduler. Mục tiêu là hoàn tất và test được flow publish Tường trước khi đưa nó vào orchestration production.

Source trong lô:

- `apps/desktop/src/main/business/page-wall-post/pageWallPostFlow.ts`
  - điều phối baseline -> composer -> content/media -> publish -> verification;
  - tái sử dụng `RobustComposerDetector`, `PostComposer`, `MediaUploader`, `PublishAction` hiện hữu thay vì copy selector/logic;
  - hỗ trợ bài text+ảnh và image-only; không gửi publish nếu không chụp được baseline xác minh trước đó.
- `apps/desktop/src/main/business/page-wall-post/pageWallPublishVerifier.ts`
  - verifier riêng của Tường, không dùng Group bucket verifier;
  - evidence mạnh là post key mới so với baseline và, khi có text, nội dung khớp bài cần đăng;
  - kiểm DOM ngay sau publish, nếu chưa thấy thì tải lại đúng Tường Page bằng navigation timeout rồi kiểm lần nữa;
  - nếu vẫn không có evidence thì trả `publish_unconfirmed`, **không coi click nút Đăng là success và không tự retry**;
  - nếu login/checkpoint xuất hiện sau click thì giữ typed common state và kèm cảnh báo review Tường trước khi retry.
- `apps/desktop/src/main/browser/posting/publishVerification.ts`
  - giữ default Group fingerprint 12 ký tự;
  - mở rộng helper theo tham số để Page Wall có thể xác minh text ngắn bằng new-post-key + content, và image-only bằng new-post-key khi baseline hợp lệ;
  - default call path của Group không đổi.
- `apps/desktop/src/main/business/page-wall-post/pageWallTask.ts`
  - `prepare()` vẫn chỉ dùng prepared common runtime;
  - `execute()` mới gọi flow 5B sau khi Wall surface qua common access check.

Giới hạn cố ý của 5B:

- `posting-worker.ts`, `PostingWorkerManager`, `PostingService`, DB run/scheduler, IPC và renderer **chưa dispatch `page_wall_post`**; Group production path vì vậy chưa bị đổi bởi lô này.
- Chưa làm hẹn ngày/giờ hoặc danh sách bài đã hẹn; đó là wiring/scheduler/UI lô sau.
- Chưa đổi Group `PublishResultDetector` hay Group anti-duplicate semantics.

Invariant sau 5B:

> Business Tường đã có flow đăng ngay với strong verification riêng và có thể chạy khi được cấp prepared common runtime; production orchestration vẫn chỉ dispatch Group cho tới lô wiring kế tiếp.

---

## 23. Trạng thái Đăng Tường — lô 5C production task dispatch

Lô 5C đưa `page_wall_post` qua **production Main/utility-worker execution boundary** nhưng chưa bật renderer, IPC, scheduler hay Wall run-items. Mục tiêu là làm worker đa nghiệp vụ thật mà vẫn giữ Group production behavior hiện hữu.

Source/wiring trong lô:

- `apps/desktop/src/shared/facebookTasks.ts`
  - `FacebookPostWorkerRequestMessage` mang `FacebookPostTaskJobRequest` explicit thay vì worker phải giả định mọi job đều có `groupUid`;
  - legacy Group contract vẫn được giữ qua `groupPostTaskFromLegacy()`.
- `apps/desktop/src/main/facebook/facebookPostTaskDispatcher.ts`
  - validate task rồi route `group_post` về `executePostingJob()` hiện hữu;
  - route `page_wall_post` sang executor Tường riêng;
  - không chứa selector, session/login hoặc Page-switch logic.
- `apps/desktop/src/main/business/page-wall-post/executePageWallPostJob.ts`
  - mở đúng `FacebookCommonRuntime` dùng chung;
  - chạy `prepareForPage()` để xác minh session/account/Page identity trước business task;
  - sau đó mới gọi `PageWallTask.execute()`;
  - dùng chung trace/screenshot evidence và after-run session validation/metadata như production Group path.
- `apps/desktop/src/main/browser/postingWorkerManager.ts`
  - `run(job: PostingJobRequest)` của Group vẫn tồn tại và chỉ wrap sang `group_post`;
  - `runTask(job: FacebookPostTaskJobRequest)` là đường generic mới dùng cùng worker-per-account, timeout, browser reuse/retile và Email-code bridge.
- `apps/desktop/src/main/browser/posting-worker.ts`
  - utility process gọi dispatcher generic thay vì gọi thẳng Group engine.
- `apps/desktop/src/main/services/postingService.ts`
  - có `executeFacebookPostTask()` cho orchestration Main tương lai dùng cùng production worker pool;
  - kết quả Group và task generic dùng cùng helper sync account name/cookie/session status; secret vẫn bị strip/redact trước khi trả public result.
- `postingEvidence.ts` / `screenshotService.ts`
  - chỉ broaden input type sang common task-base vì evidence dùng `profileDirectory/runId/itemId/logging`, không phụ thuộc Group UID.

Verifier hardening kèm 5C sau review 5B:

- nhận diện cả Page permalink/post key dạng `pfbid...`, không chỉ numeric ID;
- caption ngắn không còn được xác minh bằng substring 1 ký tự: phải có **post key mới** và exact non-interactive text trong article; image-only vẫn chỉ dùng key-only khi baseline hợp lệ;
- sau khi thấy evidence, verifier vẫn gọi common access gate trước khi trả success để checkpoint/login overlay sau click không bị success giả;
- default Group fingerprint 12 ký tự và Group publish verifier không đổi.

Giới hạn cố ý của 5C:

- `PageBusinessWorkspace` vẫn là UI shell; chưa có nút renderer gọi Đăng Tường thật.
- Chưa tạo Wall run-item DB, scheduler/hẹn giờ, IPC hoặc config persistence riêng cho Tường.
- `RotationService`, Group `run_items`, Group anti-duplicate và Group `PublishResultDetector` không đổi semantics.
- `executeFacebookPostTask()` là Main execution entrypoint; account-turn scheduling cho Wall phải được nối ở lô orchestration/UI tiếp theo, không giả lập bằng Group run-item.

Invariant sau 5C:

> Khi Main orchestration cung cấp một `PageWallPostTaskJobRequest` hợp lệ, production utility worker có thể chạy Tường qua cùng Facebook Common Runtime, evidence lifecycle và account-session sync như Group mà không cần `groupUid`; UI/scheduler chưa được coi là hoàn thành cho tới lô wiring riêng tiếp theo.

---

## 24. K4.5.1 — ownership Thư viện Bài viết chung

K4.5.1 chốt `content_sets/content_items` là **shared application data** ở Main/SQLite, không thuộc Facebook Common Runtime và cũng không thuộc riêng `group_post`, `page_wall_post`, Page Tab hay Kịch Bản.

Ownership hiện hành sau K4.5.1:

```text
React — Thư viện Bài viết
        |
        v
Typed IPC / Preload
        |
        v
ContentLibraryRepository (Main)
        |
        +--> content_sets
        |      page_tab_id = NULL => nguồn global
        |
        +--> content_items
               variants + media source config

Consumer Page / Kịch Bản / business config
        |
        +--> tham chiếu contentSetId
        +--> giữ mode/override của consumer
        |
        v
Run Orchestration
        |
        +--> snapshot nội dung + media selection input khi Start
        |
        v
Business worker chỉ đọc snapshot của run
```

Các invariant bắt buộc:

- Renderer không đọc SQLite hay filesystem trực tiếp; picker folder/file text đi qua Main.
- Một nguồn global có thể được nhiều Page/Kịch Bản/nghiệp vụ dùng lại; không copy nguyên bài thành DB riêng cho từng consumer.
- `sequential/random` là quyết định của consumer/run, không phải ownership của bản thân nguồn global.
- Sau khi một run đã tạo snapshot, sửa/xóa nội dung gốc không được âm thầm thay đổi nội dung của run đang chạy.
- `ContentLibraryRepository` chỉ được CRUD row global (`content_sets.page_tab_id IS NULL`) và không được mutate compatibility row của Page Tab cũ.
- Migration v13 giữ row `page_tab_id != NULL` và `page_tab_posts` hiện hữu để Group/Page runtime đang chạy không bị đổi observable behavior trong K4.5.1.
- K4.5.1 **chưa** đổi `group_post/page_wall_post` consumer runtime. Lô K4.5.2 mới được phép nối tham chiếu `contentSetId`, selection mode và snapshot sang consumer; khi đó cần regression chứng minh Group hiện tại không bị mất semantics.
- Config Backup phải mang nguồn global nhưng vẫn đọc được backup v1 cũ không có trường thư viện chung.

Ranh giới quan trọng:

> Facebook Common chuẩn bị browser/session/Page identity; Content Library chỉ cung cấp dữ liệu đầu vào. Business task không được đọc live Content Library trong lúc publish, và Content Library không được biết selector Facebook hay trạng thái worker.

---

## 25. Workspace Tương tác — rolling account pool

Lô rolling concurrency của workspace `Tương tác` bổ sung orchestration policy mà không tạo Facebook selector/runtime riêng.

Source ownership:

- `shared/interactionWorkspaceConfig.ts` sở hữu `accountConcurrency` + compatibility/default;
- `main/services/rollingAccountPool.ts` là helper orchestration generic: quản lý queue/slot/refill, không biết Facebook selector;
- `main/services/interactionWorkspaceRunnerService.ts` snapshot config/account, acquire `AccountExecutionCoordinator` lease và chạy account qua worker/Common Runtime hiện hữu;
- UI Tương tác chỉ chỉnh config/hiển thị runtime, không trực tiếp mở browser/DB.

Semantics bắt buộc:

```text
accountConcurrency = 4

A  B  C  D  -> active
|        |
A xong   D vẫn chạy
|
v
E vào ngay slot A

B/C/D không cần kết thúc trước khi E bắt đầu.
```

Đây là **rolling/worker-pool concurrency**, không phải `chunk(4)` rồi `await Promise.all(batch)`.

Account-level safety:

- pool chỉ coi account là chiếm slot sau khi acquire được global account lease;
- account đang bận ở Page/Scenario/workspace khác có thể được bỏ qua tạm để account kế tiếp lấp slot;
- khi lease được giải phóng, account bị bỏ qua vẫn nằm queue và được xét lại;
- business/Common Runtime không tự tạo lock thứ hai cạnh tranh với coordinator.

UI account selection cho workspace phải giữ parity với picker Account Manager/Page Tab: search UID/tên/email/note, filter status/category, chọn đang lọc, dense grid, multi-select và Apply; không tạo một card-list picker khác chỉ cho Tương tác.

Regression tối thiểu:

- concurrency 2: account 1 và 2 bắt đầu; account 1 xong trong khi account 2 còn pending -> account 3 phải bắt đầu ngay;
- locked account không làm pool tụt từ N slot xuống N-1 nếu còn account runnable khác;
- legacy config -> concurrency 1;
- Pause/Resume/Stop không tạo account mới sai trạng thái;
- `group_post` sequential invariant vẫn xanh.