# Page-Auto — AI API / JSON connections

## What is supported

The existing Google Agent Builder **remains independent** (service-account JSON, deployed Agent Runtime, Google catalog). The AI composer also supports saved API + text-model choices:

- **OpenAI-compatible chat completions**: OpenAI, NVIDIA NIM, xAI and OpenRouter presets, or a public HTTPS-compatible endpoint. Model discovery uses GET `/models` and text generation uses POST `/chat/completions`.
- **Google Gemini API**: GET `/v1beta/models`, POST `/v1beta/models/{id}:generateContent`, `x-goog-api-key` header.
- **Anthropic Claude API**: GET `/v1/models`, POST `/v1/messages`, `x-api-key` and `anthropic-version` headers.
- **API JSON config**: paste an object such as `{"name":"NVIDIA","provider":"openai-compatible","baseUrl":"https://integrate.api.nvidia.com/v1","apiKey":"YOUR_KEY"}` into the new **Nhập cấu hình JSON** field. This pre-fills the form; it does **not** install arbitrary scripts, credentials or models. Google service-account JSON is imported via the existing separate Google workflow.
- **Unrecognized custom REST shapes**: not yet supported. Only APIs implementing one of the above protocols can auto-discover and generate. If `/models` is unavailable, enable manual Model ID and run **Kiểm tra Model**. Discovery does **not** guarantee inference access (the test actually calls the model).

## User flow

Open **Thư viện → Tạo bài bằng AI → Quản lý AI**, choose preset or HTTPS API address, paste key or config JSON, click **Tải danh sách Model**, search and select a returned model, optionally run **Kiểm tra Model**, click **Lưu kết nối**. The chosen model appears immediately in **AI / Model** in the AI composer; use it to create/randomize posts. Multiple connections can coexist; choose default or use **Đổi Model → Tải lại Model** without re-entering key.

## Storage and operational constraints

API keys are encrypted using Electron safeStorage in the same SQLite `app_settings` store, not stored in plaintext; save fails closed if encryption is unavailable. The preload exposes only nonsecret metadata from the list API. Transient credentials are sent to Electron Main over typed IPC exclusively for explicit Load/Test/Save clicks. The service requires HTTPS public hostnames, blocks plain HTTP/localhost/IP literals, disables redirect forwarding and enforces limits on models, response bytes and timeouts. Remote provider error bodies are not forwarded into UI or logs. Never commit live keys or JSON credentials.

**Manual verification** with valid keys for NVIDIA/OpenRouter/xAI/OpenAI/Gemini/Claude is still required. Mocked tests and CI screenshot smoke use fake fixture keys and do not incur real API costs or guarantee entitlements. Providers may change their APIs/models: show their live response and allow fallback entry, never invent model IDs. Google Agent Builder behavior, canonical content library and scheduler are unchanged.
