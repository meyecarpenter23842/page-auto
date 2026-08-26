# PAGE-AUTO — Live Test Backlog

> Mục tiêu của file này: gom các lô đã merge nhưng chưa được live-test đầy đủ vào một chỗ, để không phải lấy account thật ra test sau mỗi thay đổi nhỏ.
>
> Baseline trước khi tạo file: `main@402581789bd2d04cd50f7ab7694e4f7638466267`.
>
> `CI PASS` chỉ chứng minh typecheck/unit/build/smoke/package đã qua. **Không đồng nghĩa live Facebook/Email đã được xác nhận ngoài thực tế.**

---

## 1. Quy tắc live-test bắt buộc

1. **Không dùng account quan trọng để test batch mới.** Dùng account/profile test riêng trước.
2. Mỗi batch Facebook phải bắt đầu ở mức nhỏ nhất: **1 account → 1 Page → 1 Group → 1 bài**. Chỉ tăng lên 2 account / nhiều Page sau khi mức nhỏ pass.
3. Nếu Facebook yêu cầu login/checkpoint/xác minh danh tính thì **dừng test account đó**, ghi lại log/status. Không cho retry vòng lặp để cố vượt challenge.
4. Không stress-test bằng delay cực ngắn chỉ để chạy nhanh. Test đúng cấu hình sử dụng thực tế trước.
5. Khi test scheduler/rotation, dùng Group test riêng và số Group nhỏ để dễ đối chiếu thứ tự, tránh đăng hàng loạt ngoài ý muốn.
6. Trước batch có thể ảnh hưởng profile/session: backup `data/` hoặc dùng data directory test riêng nếu cần.
7. Mỗi test phải ghi một trong các trạng thái:
   - `PENDING` — chưa live-test.
   - `PASS` — live-test đạt kỳ vọng.
   - `FAIL` — live-test sai; ghi log + triệu chứng + account/page/group test tương ứng nhưng **không ghi secret/cookie/password/token**.
   - `BLOCKED` — không thể test an toàn ở thời điểm hiện tại.
8. Sau khi một batch `FAIL`, **không test tiếp hàng loạt account khác để xác nhận lại cùng một lỗi**. Dừng, gom log, sửa một lần rồi mới retest.

---

## 2. Thứ tự test khuyến nghị

Test từ ít rủi ro tới nhiều rủi ro:

1. UI/Settings không mở Facebook.
2. Email grid / Email profile riêng.
3. Chrome slot/layout với profile test.
4. Facebook mở session + Page identity nhưng chưa đăng.
5. Facebook đăng 1 Group / 1 bài.
6. Rotation nhiều account trong 1 Page.
7. Nhiều Page chạy song song.
8. Scheduler nhiều khung giờ / rollover ngày.
9. Email-code bridge trong Facebook runtime.

Không cần test lại toàn bộ sau mỗi commit. Chỉ test lại batch liên quan và các regression quan trọng bị nó chạm tới.

---

## 3. Backlog các lô đã merge gần đây

| Issue / khu vực | PR đã merge | Nội dung | CI | Live status | Mức rủi ro |
| --- | --- | --- | --- | --- | --- |
| #70 Chrome slots | #74, #75 | Slot pool + diagnostics/capacity | CI PASS | PENDING | Thấp–TB |
| #27 Facebook verification | #76 | Saved-profile/password → 2FA, Page reuse, runtime status | CI PASS | PENDING / có follow-up cũ | Cao |
| #77 Architecture | #78 | Kiến trúc Facebook Common / Orchestration / Business | CI PASS | N/A docs | Không live |
| #77 Settings | #80 | Settings scroll + audit Account UX hiện có | CI PASS | PENDING | Thấp |
| #77 Page workspace | #81 | Nhóm / Đăng Tường / Sửa Page shell | CI PASS | PENDING | Thấp |
| #77 Page runtime UI | #82, #83, #85, #86 | Runtime account state, post preview, Page controls | CI PASS | PENDING | TB |
| #77 Facebook Common | #90 | Tách common runtime khỏi Group posting | CI PASS | PENDING | Cao |
| Browser lifecycle | #93 | Xác nhận Chrome posting shutdown, truthful logs | CI PASS | PENDING | TB |
| Page schedule/rotation | #95 | Chạy liên tục trong khung + `Mỗi ngày` + rollover | CI PASS | PENDING | Cao |
| #43 Email docs | #79, #89 | Chốt Email architecture/plan | CI PASS | N/A docs | Không live |
| #43 Email canonical state | #91 | OAuth state theo account | CI PASS | PENDING | TB |
| #43 Email UI | #84, #92 | Email workspace rồi rework về one-grid | CI PASS | PENDING | Thấp–TB |
| #43 Email profile/network | #94 | Email profile/browser/proxy riêng | CI PASS | PENDING | TB |
| #43 Email code bridge | #96 | OAuth code provider + bridge vào Facebook Common | CI PASS | PENDING | Cao |

### Không tính là hoàn tất

- **PR #53 — `fix: make compact layout square`**: hiện vẫn đang mở, chưa merge. Không test như tính năng main cho tới khi có lệnh merge riêng và main CI xanh.

---

## 4. Checklist test chi tiết — #70 Chrome Slots (#74, #75)

### Mục tiêu

Xác nhận một account giữ đúng một slot Chrome, slot được nhả khi owner cuối đóng, và diagnostics phản ánh đúng runtime.

### Cách test

- [ ] Mở Chrome của 1 account test từ Account Manager.
- [ ] Vào Settings → Chrome Slots, kiểm account xuất hiện đúng 1 slot.
- [ ] Nếu cùng account được posting worker dùng lại, kiểm không xuất hiện slot thứ hai cho cùng account.
- [ ] Đóng browser/profile account; kiểm slot được giải phóng.
- [ ] Mở account khác; kiểm dùng slot trống thấp nhất mà không làm nhảy vị trí Chrome đang chạy khác.
- [ ] Thử `Sắp xếp lại Chrome` chỉ khi chủ động bấm; polling không được tự compact/move browser.

**PASS khi:** slot map khớp browser thật, không duplicate slot, không còn slot ma sau khi browser cuối đã đóng.

---

## 5. Checklist test chi tiết — #27 verification / 2FA / Page reuse (#76)

### Mục tiêu

Kiểm tra flow session hiện có mà không làm account test bị retry liên tục.

### Cách test an toàn

- [ ] Dùng **1 account test** đã biết trạng thái session.
- [ ] Case session còn sống: mở flow và kiểm không login lại vô ích.
- [ ] Case Page identity đã đúng: kiểm runtime reuse Page hiện tại thay vì switch thừa.
- [ ] Nếu flow yêu cầu 2FA: chỉ kiểm app nhận đúng trạng thái/tiếp tục đúng sau khi người vận hành hoàn thành bước hợp lệ.
- [ ] Nếu xuất hiện checkpoint/xác minh danh tính: dừng account đó, ghi status/log; không tiếp tục vòng retry.

### Known follow-up cần chú ý

PR #76 từng ghi nhận hai follow-up live:

- checkpoint live có ca chưa phản ánh account status như kỳ vọng;
- sau 2FA có ca đứng trước nghiệp vụ.

Nếu gặp lại, đánh `FAIL` ngay tại mục này thay vì tiếp tục thử nhiều account.

---

## 6. Checklist test chi tiết — #77 Page UI/runtime (#80–#86)

### UI không cần đăng bài

- [ ] Settings ở cửa sổ thấp: menu trái và content cuộn đúng, không đẩy cả workspace.
- [ ] Page có tab `Nhóm / Đăng Tường / Sửa Page`.
- [ ] Start/Pause/Resume/Stop của từng Page nằm đúng header và enable/disable theo runtime state.
- [ ] `Điều khiển Page` nhiều Page mở đúng popup.

### Runtime display với 1 account test

- [ ] Account đang chạy hiển thị trạng thái theo **phiên**, không ghi đè master status sai.
- [ ] Preview bài đang xử lý hiện đúng Group UID/content summary/số ảnh khi worker đã chuẩn bị dữ liệu.
- [ ] Khi chuyển task, preview được clear/update hợp lý.
- [ ] Error/checkpoint của account trong run hiển thị trạng thái lỗi tương ứng.

**Không dùng preview placeholder giữa hai task làm bằng chứng posting bị dừng.** Phải đối chiếu runtime status/log.

---

## 7. Checklist test chi tiết — Facebook Common Runtime (#90)

### Mục tiêu

Đảm bảo refactor ownership không làm đổi behavior Group đang chạy ổn.

### Mức 1 — không đăng

- [ ] 1 account test mở persistent profile thành công.
- [ ] Session còn sống được nhận đúng.
- [ ] Account UID được xác minh đúng.
- [ ] Switch/reuse đúng Page UID.
- [ ] Pause/Stop trước publish không làm treo worker/browser.

### Mức 2 — 1 bài test

- [ ] 1 account + 1 Page + 1 Group test + 1 content đơn giản.
- [ ] Worker chuẩn bị common runtime trước, sau đó mới vào Group business.
- [ ] Post thành công chỉ consume Group của **run hiện tại**; Group source gốc còn nguyên.
- [ ] Sau thành công, browser lifecycle đúng policy.

**FAIL ngay** nếu login/2FA/checkpoint/Page switch bị xử lý khác bất thường so với trước refactor.

---

## 8. Checklist test chi tiết — Chrome shutdown (#93)

### Mục tiêu

Xác nhận log `RELEASE complete` tương ứng với Chrome posting thực sự đã được đóng theo Playwright lifecycle.

### Cách test

- [ ] Chạy 1 Page / 1 account / 1 bài trước.
- [ ] Sau khi account kết thúc lượt, kiểm cửa sổ Chrome posting đóng.
- [ ] Log success kỳ vọng có `posting worker confirmed browser shutdown` và `RELEASE complete`.
- [ ] Nếu log có `RELEASE warning` hoặc `Chrome close không được xác nhận`, đánh `FAIL` và giữ log.
- [ ] Sau khi case 1 account pass mới thử 2 Page Tab song song.

### Nếu Chrome còn mở dù log báo confirmed

Ghi rõ đây là case đặc biệt: cần audit tiếp `BrowserProfileManager/browser-profile-worker`, không tự kết luận scheduler lỗi.

---

## 9. Checklist test chi tiết — Schedule/Rotation (#95)

### A. `Mỗi ngày`

- [ ] Tạo 1 lịch, tick `Mỗi ngày`, đặt một khung giờ.
- [ ] Lưu → đóng editor → mở lại.
- [ ] Vẫn hiển thị một dòng lịch và `Mỗi ngày` vẫn tick.
- [ ] Bỏ `Mỗi ngày`, chọn vài thứ riêng → lưu/mở lại đúng.

### B. Continuous rotation trong cùng khung

Cấu hình test nhỏ:

- Account A: `Bài/lượt = 1`.
- Account B: `Bài/lượt = 1`.
- 5 Group test.
- Khung giờ hiện tại đang active.

Kỳ vọng:

```text
A → B → A → B → A
```

Không được dừng sau `A → B` nếu vẫn còn Group và vẫn trong khung.

Case quota khác:

- A: 2 bài/lượt.
- B: 1 bài/lượt.

Kỳ vọng:

```text
A → A → B → A → A → B → ...
```

### C. Boundary

- [ ] Hết Group → dừng run hiện tại.
- [ ] Hết khung giờ → chờ khung tiếp theo.
- [ ] Pause → không phát sinh bài mới cho đến Resume.
- [ ] Stop → không tự resume.
- [ ] Sang ngày chạy mới → tạo run mới từ Group source, progress bắt đầu lại 0.

**Không cần chỉnh ngày Windows trên máy chính để test rollover nếu không có môi trường test riêng; regression unit đã cover logic này.**

---

## 10. Checklist test chi tiết — Email canonical/UI/profile (#91, #92, #94)

### Canonical account state

- [ ] Email grid đọc `Email/PassEmail/BackupEmail` theo Account Manager hiện tại.
- [ ] Sửa Email/PassEmail trong Account Manager → Email grid phản ánh dữ liệu mới, không có credential copy cũ.
- [ ] OAuth state hiển thị metadata an toàn; không lộ Refresh Token plaintext.

### One-grid UI

- [ ] Chỉ có một account grid Email chính.
- [ ] Ctrl/Shift/checkbox selection hoạt động đúng trên visible rows.
- [ ] Context menu thao tác trên đúng selection.
- [ ] Search/quick filter không làm action chạy nhầm account ẩn.
- [ ] Đặc biệt retest OAuth/Lấy mã khi chọn nhiều account: xác nhận action nào hỗ trợ multi-selection và action nào chỉ chạy một account.

### Email profile/browser/network

- [ ] Chọn Email Profile Root tuyệt đối đã tồn tại.
- [ ] Account chỉ dùng đúng `<EmailProfileRoot>/<UID>` đã tồn tại; không tự tạo profile fallback ngoài ý muốn.
- [ ] Profile đang được process khác dùng → app trả `profile_in_use`, không xóa lock thật.
- [ ] Browser Email Auto không mượn browser setting của Facebook làm runtime source.
- [ ] Proxy Email không thay đổi proxy Facebook.
- [ ] Log chỉ hiện proxy server, không lộ credential.

---

## 11. Checklist test chi tiết — Email code bridge vào Facebook (#96)

### Điều kiện trước khi test

Chỉ test sau khi các mục Email canonical/profile ở trên đã PASS với account test.

### Cách test

- [ ] Account test có canonical Email OAuth state hợp lệ.
- [ ] Manual `Lấy mã` đọc được mã mới qua cùng provider.
- [ ] Facebook runtime gặp challenge **có tín hiệu rõ ràng mã được gửi qua Email** thì gọi bridge bằng accountId.
- [ ] Worker Facebook không nhận Refresh Token/password/proxy credential Email.
- [ ] Code cũ ngoài TTL không được dùng lại.
- [ ] Sau khi code hợp lệ được xử lý, Facebook runtime quay lại state machine session/account hiện có.
- [ ] Nếu Email auth thiếu/hết hạn/not-found/support-error thì status typed đúng và runtime dừng phù hợp.
- [ ] Nếu challenge là checkpoint/xác minh danh tính không thuộc Email-code support thì không được cố xử lý như OTP Email.

### Stop condition

Nếu account vào security review/checkpoint hoặc challenge không xác định: **dừng live-test account đó**. Không thử nhiều lần chỉ để xem bridge có vượt qua được hay không.

---

## 12. Mẫu ghi kết quả live-test

Copy block này xuống cuối file cho mỗi phiên test:

```md
### YYYY-MM-DD — <batch/PR>

- Main SHA: `<sha>`
- Tester build: dev / portable
- Scope: <1 account / 2 accounts / 2 Page ...>
- Test data: <số Page, số Group, số bài; không ghi secret>
- Kết quả: PASS / FAIL / BLOCKED
- Triệu chứng nếu fail:
- Log marker cần giữ:
- Có checkpoint/login/verification không: Có / Không
- Có tiếp tục test account khác không: Không nếu cùng lỗi đã tái hiện
- Follow-up issue/PR:
```

---

## 13. Quy tắc cập nhật file từ nay

Mỗi PR có thay đổi cần live-test phải cập nhật file này **trước hoặc ngay sau merge**:

- thêm PR/issue;
- ghi đúng checklist test tay;
- đánh rủi ro `Thấp / TB / Cao`;
- ghi `CI PASS` riêng với `Live status`;
- không đánh `PASS` chỉ vì CI xanh;
- khi live-test fail, ghi đủ triệu chứng/log marker rồi dừng batch test liên quan;
- khi fix xong, giữ lịch sử FAIL và thêm lần retest mới, không xóa dấu vết cũ.
