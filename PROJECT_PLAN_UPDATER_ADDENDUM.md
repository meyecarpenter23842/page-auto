# PROJECT_PLAN — R2 Auto Updater addendum

Quyết định ngày 2026-09-06 cho **Lô 3 — Cập nhật PAGE-AUTO qua Cloudflare R2**. Tài liệu này bổ sung `PROJECT_PLAN.md` và `PROJECT_PLAN_INSTALLER_ADDENDUM.md`; không đổi stack Electron + React + TypeScript + Vite + Playwright + SQLite + Drizzle.

## Mục tiêu lô 3

- Thêm mục **Cập nhật** trong màn Cài đặt.
- Người dùng bấm `Kiểm tra cập nhật` để Main kiểm tra metadata phiên bản mới.
- Khi có bản mới, app tự tải và hiển thị phần trăm/tiến trình.
- Tải xong mới cho bấm `Khởi động lại & cập nhật`.
- Chỉ báo cập nhật thành công sau khi app thực sự khởi động lại bằng version mới.
- DB, account, Page, browser profile/session và runtime data không bị thay thế bởi updater.

## Update feed

Public feed dùng bởi app:

```text
https://pub-4e0416c66f7b4c7e9542bb6296775673.r2.dev
```

Provider trong `electron-builder` là `generic`. App chỉ biết public feed này. R2 Account ID, S3 API endpoint, access key/secret và thông tin upload riêng của operator **không được đóng gói vào app, preload, renderer, log hoặc update metadata**.

Lô này pin `electron-updater` stable `6.8.9`; không chuyển sang nhánh alpha chỉ để dùng provider R2 native. Public R2 hoạt động như generic static update server.

`r2.dev` dùng cho giai đoạn test updater. Khi phát hành rộng nên chuyển feed sang custom domain riêng mà không đổi state machine của updater.

## Version test đầu tiên

- Bản installer đã test trước lô này: `1.0.0`.
- Bản updater live-test của lô này: `1.0.1`.
- Acceptance chính: cài/running `1.0.0` -> check -> download `1.0.1` -> restart/install -> mở lại `1.0.1` -> data/session còn nguyên.

## Runtime contract

Renderer không gọi R2 trực tiếp. Luồng bắt buộc:

```text
Settings / Cập nhật
  -> typed preload IPC
  -> Electron Main updater service
  -> electron-updater
  -> public R2 generic feed
```

State tối thiểu:

```text
idle
checking
available
downloading
ready
installing
up_to_date
updated
error
unsupported (development)
```

- `autoDownload = false`: app chủ động bắt đầu download sau khi check xác nhận có bản mới.
- `autoInstallOnAppQuit = false`: không âm thầm cài khi người dùng đóng app bình thường.
- Install chỉ bắt đầu từ nút `Khởi động lại & cập nhật` sau state `ready`.
- `quitAndInstall()` phải đi qua lifecycle `before-quit` hiện hữu để DB/runtime/worker được dispose trước khi installer thay file chương trình.
- Development mode không kiểm tra/tải/cài update thật.

## Build + upload contract

Build release update chỉ làm local:

```powershell
npm run package:update
npm run verify:update-artifacts
```

Artifact cần có:

```text
dist/PageAuto-Setup-<version>.exe
dist/PageAuto-Setup-<version>.exe.blockmap
dist/latest.yml
```

Upload thủ công lên bucket `page-auto` theo thứ tự bắt buộc:

1. `PageAuto-Setup-<version>.exe`
2. `PageAuto-Setup-<version>.exe.blockmap`
3. `latest.yml` **cuối cùng**

`latest.yml` là pointer công bố version mới nên không được upload trước binary/blockmap. CI không upload R2 và `package:update` giữ `--publish never`.

## Post-restart verification

Trước khi gọi `quitAndInstall`, Main ghi marker nhỏ gồm version cũ/version đích. Lần startup sau:

- nếu app version đúng version đích và khác version cũ -> state `updated`, hiển thị thành công;
- nếu version không đổi -> không báo success giả, xóa marker stale và cho phép kiểm tra lại.

Marker không chứa credential hay business data.

## Acceptance trước merge

1. Typecheck/unit/build/smoke/installer-config/updater-config đều xanh.
2. Build `1.0.1` local sinh `.exe`, `.blockmap`, `latest.yml` và `app-update.yml` đúng public feed.
3. Upload 3 artifact lên R2 theo đúng thứ tự, `latest.yml` cuối.
4. Từ PageAuto `1.0.0`, mở Cài đặt -> Cập nhật, bấm `Kiểm tra cập nhật`.
5. UI thấy `1.0.1`, download progress chạy tới 100%.
6. Bấm `Khởi động lại & cập nhật`; app đóng sạch và mở lại.
7. App hiển thị `1.0.1` và thông báo đã cập nhật chỉ sau restart.
8. Account/Page/Settings/Thư viện bài viết/browser profile/session còn nguyên.
9. Restart thêm lần nữa không lặp success marker và data vẫn nguyên.
10. Không merge PR updater cho tới khi có lệnh rõ ràng của chủ dự án.
