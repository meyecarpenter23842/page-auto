# ARCHITECTURE — R2 Auto Updater addendum

Quyết định kiến trúc ngày 2026-09-06 cho updater Windows. Tài liệu này bổ sung `ARCHITECTURE.md` và không thay đổi process ownership Facebook/DB hiện có.

## Ownership

```text
React Settings UI
  |
  | typed IPC only
  v
Preload: pageAutoUpdater
  |
  v
Electron Main: AppUpdater service
  |
  +--> electron-updater
  |      |
  |      +--> public generic feed on Cloudflare R2
  |
  +--> update-pending marker (version only)

Runtime DB / browser profiles
  X--> updater artifact
```

Renderer không fetch `latest.yml`, installer hoặc blockmap trực tiếp. Renderer chỉ hiển thị state/progress do Main phát qua IPC.

## Feed boundary

App packaged chỉ chứa public feed:

```text
https://pub-4e0416c66f7b4c7e9542bb6296775673.r2.dev
```

Không đưa R2 S3 API endpoint, Account ID dùng vận hành, access key hoặc secret vào runtime. Upload artifact là thao tác local/operator riêng và nằm ngoài app.

Generic provider được dùng với `electron-updater 6.8.9` stable. Việc đổi từ `r2.dev` sang custom domain sau này chỉ là đổi public generic feed, không đổi IPC/state machine.

## State machine

```text
idle
  -> checking
      -> up_to_date
      -> available -> downloading -> ready -> installing
                                      |           |
                                      |           -> app quits
                                      |               -> NSIS replaces binaries
                                      |               -> app restarts
                                      |                   -> updated
                                      -> error
```

Development runtime resolve `unsupported` và không thực hiện network/install update.

## Install lifecycle

`Khởi động lại & cập nhật` chỉ hợp lệ ở state `ready`.

Trước `quitAndInstall()`:

1. ghi marker `{ fromVersion, toVersion, requestedAt }` trong Electron userData;
2. chuyển state sang `installing`;
3. gọi `quitAndInstall(false, true)`.

Khi quit, các listener `before-quit` hiện hữu vẫn là nơi dispose scenario/interaction/Page Wall runtime, IPC runtime và đóng SQLite. Updater không sở hữu DB và không được xóa/migrate business data.

Sau startup mới:

- marker target == `app.getVersion()` và version đã đổi -> success thật (`updated`);
- target không khớp -> không báo success, marker bị xóa và user có thể retry.

## Packaging boundary

NSIS installer/update chỉ chứa application binaries/resources. Runtime data tiếp tục theo contract installer:

- data hiện hữu được reuse theo resolver hiện hành;
- fresh packaged install dùng stable LocalAppData;
- DB/profile/cookie/session không nằm trong `.exe`, `.blockmap`, `latest.yml`.

Build local tạo update metadata nhưng không publish tự động. CI chỉ verify config/contract, không giữ credential và không release R2.

## Release atomicity ở mức metadata

R2 không có transaction multi-file cho release này, vì vậy publication dùng `latest.yml` làm commit pointer:

1. upload installer;
2. upload blockmap;
3. upload `latest.yml` cuối.

Client chỉ nhìn thấy version mới sau bước 3, tránh metadata trỏ tới binary chưa có.
