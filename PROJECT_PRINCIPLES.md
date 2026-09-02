# PAGE-AUTO — Project-wide invariants

> Đây là tài liệu nguyên tắc chung của dự án và là entrypoint bắt buộc trước `PROJECT_PLAN.md`/`ARCHITECTURE.md` khi thay đổi kiến trúc hoặc data ownership. Nếu wording legacy trong tài liệu cũ mâu thuẫn với một invariant được **explicitly supersede** tại đây thì invariant mới hơn được ưu tiên; implementation phải mở migration/cleanup riêng thay vì tiếp tục nhân rộng mô hình cũ.
>
> **Project-wide invariant không được thay đổi ngầm trong một feature/bugfix. Muốn đổi invariant phải được người sở hữu dự án chấp thuận rõ ràng và cập nhật tài liệu invariant trước khi sửa implementation. Code cũ mâu thuẫn với invariant mới được xem là technical debt cần migration, không được dùng làm lý do nhân rộng behavior sai.**
>
> **Precedence riêng cho dữ liệu bài viết:** Issue #188 và mục Canonical Post Library bên dưới **supersede** wording K4.5.1/K4.5.2 cũ trong `PROJECT_PLAN.md` (đặc biệt phần mở đầu K4.5.1, §5.5, §9, §12, §13) và `ARCHITECTURE.md` §24 khi các đoạn đó mô tả `content_sets/content_items`, “global source” hoặc `contentSetId` như kiến trúc đích. Các đoạn cũ đó chỉ mô tả source/compatibility transition hiện tại cho tới khi #188 migration hoàn tất; không được dùng để mở rộng thêm mô hình Content Set.

## 1. Canonical Post Library — một kho bài viết gốc duy nhất

Quyết định kiến trúc từ Issue #188:

- Toàn app chỉ có **một kho bài viết canonical**. Một bài có một identity gốc (`post_id`) và nội dung/variants/media gốc chỉ lưu một lần.
- Tab **Bài viết / Thư viện bài viết** là màn quản lý tổng của kho canonical, không phải một “nguồn global” đứng cạnh các Page/Kịch Bản library khác.
- Page, Kịch Bản và các business context **không sở hữu DB bài viết riêng**. Mỗi context chỉ giữ binding/reference tới những `post_id` nó đang dùng, cùng config context như `enabled`, `sort_order` và override nếu nghiệp vụ thực sự cần.
- Danh sách bài trong một context chỉ hiện các bài đã bind vào context đó. Muốn nhìn toàn kho hoặc lấy bài khác phải mở **Chọn từ thư viện**.
- `+ Bài mới` tại một context = tạo canonical post + bind ngay vào context hiện tại trong cùng thao tác.
- `Chọn từ thư viện` = bind bài canonical có sẵn; **không copy nội dung thành row bài mới**.
- `Xóa` trong Page/Kịch Bản/context = chỉ bỏ binding của context; **không xóa canonical post** khỏi thư viện tổng và không ảnh hưởng context khác.
- Nếu context cho phép sửa riêng, thay đổi riêng phải là **override của binding/context**, không âm thầm mutate canonical post. Chỉ sửa tại Thư viện tổng mới là sửa bản gốc.
- Một canonical post có thể được nhiều Page/Kịch Bản/nghiệp vụ dùng đồng thời.
- UI tránh thuật ngữ gây hiểu nhầm như `Nguồn global`, `Nguồn bài viết`, `Content Set` khi người dùng thực chất đang chọn bài/bộ bài từ cùng một kho canonical.

### Ví dụ bắt buộc phải đúng

```text
Canonical posts: #101 #102 #103 #104 #105
Page A bindings: #101 #103
Page B bindings: #102 #105
Scenario X bindings: #101 #104
```

Page A bình thường chỉ thấy #101/#103. Page B không tự thấy bài Page A. Nhưng popup **Chọn từ thư viện** ở cả hai nơi đều có thể thấy toàn canonical library.

### Runtime invariant

Binding/config là dữ liệu sống, nhưng khi **Start run** phải resolve `post_id` + override hiện tại thành **immutable run snapshot**. Worker chỉ đọc snapshot của run; sửa/xóa bài hoặc binding sau Start không được làm thay đổi phiên đang chạy.

### Migration invariant

Source hiện tại có `content_sets/content_items`, `page_tab_posts` compatibility và Scenario K4.5.2 `contentSetId`. Đây là legacy/transition cần audit theo Issue #188; **không được nhân rộng thành nhiều kho bài độc lập**.

Mọi migration sang canonical posts + context bindings phải:

- không mất nội dung, variants, media/image config, thứ tự, enabled state hay reference hiện có;
- giữ backup/restore tương thích hoặc có migration version rõ ràng;
- có regression cho Page A/Page B/Scenario binding, unlink không xóa gốc, override isolation và immutable run snapshot;
- không drop compatibility data trước khi có bằng chứng migration + CI xanh.

## 2. Quan hệ với các invariant hiện có

Nguyên tắc Canonical Post Library **không thay đổi** các boundary khác đã chốt:

- React Renderer chỉ UI/typed IPC; Electron Main sở hữu DB/scheduler/worker lifecycle.
- Facebook Common Runtime là nguồn duy nhất cho session/login/2FA/checkpoint/account identity/Page switch dùng chung.
- Business task không copy common Facebook flow.
- Group source không bị xóa; Group anti-duplicate vẫn dùng run snapshot/run items của phiên.
- Không anti-detection/evasion, không bypass checkpoint/xác minh danh tính.
- Account/session/profile/cookie thật không commit Git.

## 3. Quy tắc triển khai thay đổi kiến trúc

- Trước khi code phải đọc tài liệu này, `PROJECT_PLAN.md`, `ARCHITECTURE.md` và issue kiến trúc liên quan.
- Audit source/schema/runtime hiện tại trước; không sửa theo tên UI rồi đoán ownership data.
- Chia migration thành lô có boundary rõ; ưu tiên data/repository -> IPC/UI binding -> consumer runtime -> cleanup compatibility.
- Không spam commit/CI. Gom lỗi cùng nguyên nhân, sửa một lượt, local test khi có môi trường rồi mới push.
- Sau push phải theo CI tới toàn bộ workflow bắt buộc xanh mới báo xong.
- Không merge PR nếu chưa có lệnh merge rõ ràng. Không deploy/release nếu chưa có lệnh riêng.

## 4. Global Runtime Invariants — Delay, Concurrency và Browser Launch

Các quy tắc trong mục này áp dụng cho **toàn bộ ứng dụng**, không phụ thuộc Page Tab, Kịch Bản, Workspace, Account Manager hay loại action. Implementation cũ mâu thuẫn với các invariant này là technical debt cần migration; không được dùng behavior cũ để định nghĩa lại semantics.

### 4.1. Global Facebook Action Delay

- `browser.actionDelayMinMs` / `browser.actionDelayMaxMs` là **delay thao tác Facebook dùng chung toàn app**.
- Mọi thao tác Facebook có tác động thực tế như navigation, click, nhập dữ liệu, upload, submit hoặc thao tác UI tương đương phải đi qua Facebook Common pacing.
- Workspace/action/business module không được tự bypass global pacing hoặc tạo một bản global delay riêng.
- Delay riêng của nghiệp vụ như delay giữa bài, delay giữa Group, delay đổi account hoặc delay giữa action trong Kịch Bản là **delay cộng thêm**, không thay thế Global Facebook Action Delay.
- Exception chỉ dành cho flow kỹ thuật thật sự time-critical và phải được định nghĩa tại Common Runtime; từng action không được tự quyết định bypass.

### 4.2. Global Browser Launch Spacing

- `runtime.browserLaunchSpacingMs` có một nghĩa duy nhất: **khoảng cách tối thiểu giữa hai lần thực sự mở Chrome/Profile mới trên toàn ứng dụng**.
- UI/tài liệu không được diễn đạt field này thành “Delay mở Chrome giữa Page Tab” vì semantics là app-wide.
- Mọi nơi có khả năng tạo Chrome mới đều phải đi qua **một Global Browser Launch Gate duy nhất thuộc Electron Main**: Account Manager, Page Tabs, Kịch Bản, Workspace, login/checkpoint và module tương lai.
- Không được tạo `BrowserLaunchGate` riêng theo worker manager, workspace, Page hoặc business flow.
- Không được dùng `runId`, `scopeId`, Page UID, workspace ID hoặc định danh tương tự để bỏ qua global launch spacing.
- Khi nhiều profile được yêu cầu mở cùng lúc, request có thể xếp hàng nhưng actual launch phải tuần tự theo gate:

```text
Chrome 1 mở
↓ browserLaunchSpacingMs
Chrome 2 mở
↓ browserLaunchSpacingMs
Chrome 3 mở
...
```

- Reuse/attach một Chrome đã mở không phải launch mới và không tiêu thụ launch spacing.

### 4.3. Concurrency và Browser Launch Spacing là hai khái niệm độc lập

- **Concurrency** = tối đa bao nhiêu account/Chrome được phép hoạt động đồng thời trong một orchestration/workspace.
- **Browser Launch Spacing** = tốc độ các Chrome mới được phép thực sự xuất hiện.
- Có concurrency lớn không cho phép bulk-launch Chrome.

Ví dụ:

```text
Account concurrency = 10
Browser launch spacing = 5 giây

0s   Chrome 1
5s   Chrome 2
10s  Chrome 3
...
45s  Chrome 10
```

App vẫn có thể đạt 10 account chạy đồng thời sau khi các slot được lấp đầy, nhưng không được mở cả 10 Chrome tại cùng thời điểm.

### 4.4. Account Concurrency là orchestration rule dùng chung

- Workspace có nhiều account phải dùng common orchestration/rolling-pool primitive thay vì tự viết cơ chế cấp account song song riêng nếu primitive chung đáp ứng được.
- Mỗi workflow phải khai báo rõ concurrency policy của nó; không suy đoán từ UI hoặc code legacy.
- Nếu workflow cho phép chạy song song, concurrency là config/runtime policy của workflow và phải được validate/snapshot phù hợp; không hard-code tùy tiện.
- Nếu workflow được thiết kế bắt buộc tuần tự thì phải được ghi rõ thành business invariant. `group_post` Page Tab hiện vẫn tuần tự cho tới khi có batch riêng được chấp thuận để đổi semantics.
- Cùng một account tuyệt đối không được hai Page/Workspace/Kịch Bản điều khiển đồng thời.
- `AccountExecutionCoordinator` là global account lock/lease dùng chung trong Electron Main và mọi runner phải tôn trọng.

### 4.5. Không implementation cục bộ rule toàn app

Business/workspace module không được tự sở hữu hoặc tự định nghĩa lại:

- global browser launch gate;
- global Facebook action pacing;
- global account execution lock;
- global runtime limits có semantics app-wide.

Các module chỉ được đọc/sử dụng service chung từ Electron Main/Facebook Common Runtime. Nếu cần thay đổi một semantics app-wide, phải cập nhật mục invariant này trước rồi mới migration implementation.
