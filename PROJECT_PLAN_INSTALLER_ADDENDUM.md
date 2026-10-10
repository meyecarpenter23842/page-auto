# PROJECT_PLAN — Windows Installer addendum

Quyết định ngày 2026-09-06 cho lô Windows Installer. Tài liệu này bổ sung và thay thế phần **portable-only** của baseline packaging hiện có; không thay đổi stack Electron + React + TypeScript + Vite + Playwright + SQLite + Drizzle.

## Mục tiêu lô 2

- Phát hành được file cài Windows dạng NSIS `.exe`.
- Installer dùng assisted mode, không phải one-click.
- Người dùng được chọn thư mục cài, vì vậy có thể cài ở ổ C, D, E hoặc thư mục khác.
- Tạo shortcut Desktop và Start Menu.
- Không deploy, không release, không upload R2 trong lô này.
- Bản release thực tế do chủ dự án build local.

## Build contract

Lệnh local từ repo root:

```powershell
npm run package:installer
npm run verify:installer
```

Artifact mong đợi:

```text
dist/PageAuto-Setup-<version>.exe
```

`package:installer` bắt buộc chạy với `--publish never`. CI chỉ kiểm tra contract cấu hình installer; CI không build/publish installer R2.

Portable ZIP hiện có vẫn được giữ để regression/CI và không bị installer thay thế bắt buộc.

## Data contract khi chuyển từ dev/portable sang bản cài

File chương trình và runtime data là hai ownership độc lập:

```text
Chosen install folder (C:/D:/E:/...)
  PageAuto.exe
  resources/

Runtime data
  existing legacy data with page-auto.sqlite -> reuse in place
  fresh packaged install -> %LOCALAPPDATA%\PageAuto\data
```

Invariant:

- Không đóng gói `page-auto.sqlite`, `browser-profiles`, cookie/session hoặc data thật vào installer.
- Nếu bản packaged tìm thấy data cũ có `page-auto.sqlite` ở legacy location, dùng data đó tại chỗ; không copy toàn bộ browser profile lúc startup.
- Nếu stable `%LOCALAPPDATA%\PageAuto\data` đã có DB thì stable root thắng.
- Development tiếp tục dùng `app.getPath('userData')/data` để không làm mất data đang test.
- Fresh install không có legacy DB mới tạo `%LOCALAPPDATA%\PageAuto\data`.
- Cài lại/đổi ổ cài không được xóa runtime data.

Lý do reuse-in-place: browser profile có thể rất lớn; copy sync cả cây profile trước khi mở Electron đã gây live regression `starting electron app...` nhìn như treo. Installer không được lặp lại lỗi đó.

## Acceptance local trước merge/release

1. Build `PageAuto-Setup-<version>.exe` bằng `npm run package:installer`.
2. Chạy `npm run verify:installer`.
3. Mở Setup và xác nhận có màn chọn thư mục cài.
4. Chọn thử một ổ/thư mục khác mặc định, ví dụ D hoặc E nếu máy có.
5. Cài xong mở PageAuto.
6. Xác nhận account, Page, Settings, thư viện bài viết và browser profile/session hiện tại vẫn còn.
7. Tắt/mở app lần hai và xác nhận data vẫn nguyên.
8. Gỡ/cài lại app không được coi là quyền xóa runtime data.

## Lô sau

Updater R2 là lô riêng. Khi làm updater mới thêm `electron-updater`, version metadata, `latest.yml`/blockmap, download progress và `Khởi động lại & cập nhật`. R2 không thuộc lô installer này.
