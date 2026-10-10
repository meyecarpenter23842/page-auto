# Page-Auto — AI API / JSON connections

## What is supported

The legacy Google Agent Builder integration has been removed from the application. The AI composer uses saved API/model connections only.

- **OpenAI-compatible chat completions**: OpenAI, NVIDIA NIM, xAI and OpenRouter presets, or a public HTTPS-compatible endpoint. Model discovery uses GET `/models` and text generation uses POST `/chat/completions`.
- **Google Gemini API**: GET `/v1beta/models`, POST `/v1beta/models/{id}:generateContent`, `x-goog-api-key` header.
- **Anthropic Claude API**: GET `/v1/models`, POST `/v1/messages`, `x-api-key` and `anthropic-version` headers.
- **API JSON config**: paste an object such as `{"name":"NVIDIA","provider":"openai-compatible","baseUrl":"https://integrate.api.nvidia.com/v1","apiKey":"YOUR_KEY"}` into the new **Nhập cấu hình JSON** field. This pre-fills the form; it does **not** install arbitrary scripts, credentials or models. Google service-account JSON and Vertex Agent Engine are no longer supported inside Page-Auto.
- **Unrecognized custom REST shapes**: not yet supported. Only APIs implementing one of the above protocols can auto-discover and generate. If `/models` is unavailable, enable manual Model ID and run **Kiểm tra Model**. Discovery does **not** guarantee inference access (the test actually calls the model).

## User flow

Open **Thư viện → Tạo bài bằng AI → Quản lý AI**, choose preset or HTTPS API address, paste key or config JSON, click **Tải danh sách Model**, search and select a returned model, optionally run **Kiểm tra Model**, click **Lưu kết nối**. The chosen model appears immediately in **AI / Model** in the AI composer; use it to create/randomize posts. Multiple connections can coexist; choose default or use **Đổi Model → Tải lại Model** without re-entering key.

## Storage and operational constraints

API keys are encrypted using Electron safeStorage in the same SQLite `app_settings` store, not stored in plaintext; save fails closed if encryption is unavailable. The preload exposes only nonsecret metadata from the list API. Transient credentials are sent to Electron Main over typed IPC exclusively for explicit Load/Test/Save clicks. The service requires HTTPS public hostnames, blocks plain HTTP/localhost/IP literals, disables redirect forwarding and enforces limits on models, response bytes and timeouts. Remote provider error bodies are not forwarded into UI or logs. Never commit live keys or JSON credentials.

**Manual verification** with valid keys for NVIDIA/OpenRouter/xAI/OpenAI/Gemini/Claude is still required. Mocked tests and CI screenshot smoke use fake fixture keys and do not incur real API costs or guarantee entitlements. Providers may change their APIs/models: show their live response and allow fallback entry, never invent model IDs. Canonical post library and scheduler are unchanged; the legacy Google Agent Builder runtime/UI is removed.


# Page-Auto — API-only AI provider UI (after Agent Builder removal)

The old Google Agent Builder / Vertex AI Agent Runtime integration is removed from the current UI and Electron IPC registrations:
- No deployed-Agent list, service-account JSON upload, agent-enable controls or direct Google Runtime branch in `generateAiPosts`.
- Content generation accepts **only** a saved `api:<connectionId>` selected from the API manager. Existing saved posts and canonical post library are not modified.
- Local encrypted legacy credentials or old agent catalog rows are not silently deleted (data compatibility). They are no longer read or used by this AI runtime, and the obsolete IPC endpoints are unregistered. No remote Google service-account or Agent Engine calls are initiated by this module.
- The new API/JSON connection functionality remains unchanged, including OpenAI-compatible (NVIDIA), Gemini and Claude; **Gemini API** is separate from **Vertex AI Agent Engine** and may incur provider charges when intentionally called.
- The manager popup uses most of the available window; short screens get a scrollable content pane and fixed close controls. Windows fixture smoke verifies modal geometry at 1280×800 and 1084×655, navigation, restarted selection, no old preload API and saved key masking.

## IMPORTANT: Existing Google Cloud deployment billing is separate from Page-Auto

Removing this feature does **not** delete the already-deployed Google Vertex AI Agent Engine resources or stop their ongoing compute/storage charges. To stop unnecessary charges, inspect the correct Google Cloud project under **Vertex AI → Agent Engine**, remove *only* unused deployed Agent Engine resources after backing up what matters, and review **Billing → Reports** to confirm the charge source. Alternatively, if the project is dedicated to this old Agent Builder and contains no other needed Google Cloud resources, the owner can disable billing for that project; this also stops other services and may cause data loss. Past costs may still appear with reporting delay. Page-Auto does not remotely delete resources or change Google Billing; it cannot verify that billing stopped.

CI mocks do not spend provider credits. Any live Gemini/NVIDIA/Claude usage depends on the owner's deliberate saved provider choice and API usage.

See Google Cloud official docs: https://docs.cloud.google.com/billing/docs/how-to/modify-project
