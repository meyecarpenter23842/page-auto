import type { AccountRecord } from '../../shared/accounts'
import type { PostingProxyConfig } from '../../shared/posting'

type AccountProxySource = Pick<
  AccountRecord,
  'proxy' | 'proxyType' | 'proxyHost' | 'proxyPort' | 'proxyUsername' | 'proxyPassword'
>

export type AccountProxyResolution =
  | { status: 'none' }
  | { status: 'valid'; proxy: PostingProxyConfig }
  | { status: 'invalid'; message: string }

function normalizeScheme(value: string | null | undefined): string {
  const raw = value?.trim().toLowerCase().replace(/:\/\/$/, '').replace(/:$/, '') ?? ''
  if (raw === 'https' || raw === 'socks4' || raw === 'socks5') return raw
  return 'http'
}

function validPort(value: string | number | null | undefined): number | null {
  const port = typeof value === 'number' ? value : Number.parseInt(value?.trim() ?? '', 10)
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : null
}

function withCredentials(
  server: string,
  username: string | null | undefined,
  password: string | null | undefined
): PostingProxyConfig {
  const normalizedUsername = username?.trim()
  const normalizedPassword = password?.trim()
  return {
    server,
    ...(normalizedUsername ? { username: normalizedUsername } : {}),
    ...(normalizedPassword ? { password: normalizedPassword } : {})
  }
}

export function parseProxyRaw(
  rawProxy: string | null | undefined,
  fallbackType?: string | null
): PostingProxyConfig | undefined {
  const raw = rawProxy?.trim()
  if (!raw) return undefined

  if (raw.includes('://')) {
    try {
      const url = new URL(raw)
      const port = validPort(url.port)
      if (!url.hostname || !port) return undefined
      const scheme = normalizeScheme(url.protocol)
      return withCredentials(
        `${scheme}://${url.hostname}:${port}`,
        url.username ? decodeURIComponent(url.username) : null,
        url.password ? decodeURIComponent(url.password) : null
      )
    } catch {
      return undefined
    }
  }

  const parts = raw.split(':')
  const host = parts[0]?.trim() ?? ''
  const port = validPort(parts[1])
  if (!host || !port) return undefined

  const username = parts[2]?.trim() || null
  const password = parts.length > 3 ? parts.slice(3).join(':').trim() || null : null
  return withCredentials(`${normalizeScheme(fallbackType)}://${host}:${port}`, username, password)
}

export function hasConfiguredProxy(account: AccountProxySource): boolean {
  return Boolean(
    account.proxy?.trim()
    || account.proxyHost?.trim()
    || account.proxyPort !== null
    || account.proxyUsername?.trim()
    || account.proxyPassword?.trim()
  )
}

export function resolveAccountProxyState(account: AccountProxySource): AccountProxyResolution {
  const host = account.proxyHost?.trim()
  const port = validPort(account.proxyPort)
  if (host && port) {
    return {
      status: 'valid',
      proxy: withCredentials(
        `${normalizeScheme(account.proxyType)}://${host}:${port}`,
        account.proxyUsername,
        account.proxyPassword
      )
    }
  }

  const rawProxy = parseProxyRaw(account.proxy, account.proxyType)
  if (rawProxy) return { status: 'valid', proxy: rawProxy }
  if (!hasConfiguredProxy(account)) return { status: 'none' }

  return {
    status: 'invalid',
    message: 'Proxy của account thiếu host/port hợp lệ hoặc sai định dạng; không mở kết nối trực tiếp thay thế.'
  }
}

export function resolveAccountProxy(account: AccountProxySource): PostingProxyConfig | undefined {
  const resolution = resolveAccountProxyState(account)
  return resolution.status === 'valid' ? resolution.proxy : undefined
}
