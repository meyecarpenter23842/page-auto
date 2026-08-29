# PAGE-AUTO — Project-wide invariants

> Đây là tài liệu nguyên tắc chung của dự án và là entrypoint bắt buộc trước `PROJECT_PLAN.md`/`ARCHITECTURE.md` khi thay đổi kiến trúc hoặc data ownership. Nếu wording legacy trong tài liệu cũ mâu thuẫn với một invariant được **explicitly supersede** tại đây thì invariant mới hơn được ưu tiên; implementation phải mở migration/cleanup riêng thay vì tiếp tục nhân rộng mô hình cũ.
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
