import '../browser/browserRuntime'

export function isEmailProfileInUseError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /processsingleton|singletonlock|user data directory.*(in use|already)|profile.*(in use|already)|opening in existing browser session|another browser process/i.test(message)
}

export function friendlyEmailBrowserError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (isEmailProfileInUseError(message)) {
    return 'Profile Email đang được process khác sử dụng; PAGE-AUTO không xóa lock hoặc mở bản sao.'
  }
  if (/executable.*(doesn.t exist|not found)|enoent/i.test(message)) {
    return 'Không tìm thấy file Browser Email đã cấu hình.'
  }
  if (/proxy|tunnel|err_proxy|err_tunnel/i.test(message)) {
    return 'Proxy Email không kết nối được khi mở browser.'
  }
  if (/browser context|connectovercdp|cdp/i.test(message)) {
    return 'Browser Email đang chạy nhưng PAGE-AUTO không attach được qua CDP.'
  }
  return 'Browser Email không khởi động được. Hãy chọn Chrome/Edge/Chromium khác trong Cài đặt Email rồi thử lại.'
}

export function shouldKeepEmailBrowserWorker(status: 'started' | 'already_open' | 'needs_attention' | 'profile_in_use' | 'error'): boolean {
  return status === 'started' || status === 'already_open' || status === 'needs_attention'
}

export const EMAIL_PROFILE_IN_USE_CACHE_MS = 5_000

export function isEmailProfileInUseOverrideActive(expiresAt: number | undefined, now = Date.now()): boolean {
  return typeof expiresAt === 'number' && expiresAt > now
}
