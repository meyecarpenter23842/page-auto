import { describe, expect, it } from 'vitest'
import type { AccountRecord } from '../../shared/accounts'
import { hasConfiguredProxy, parseProxyRaw, resolveAccountProxy, resolveAccountProxyState } from './proxyConfig'

function source(patch: Partial<AccountRecord>): Pick<AccountRecord, 'proxy' | 'proxyType' | 'proxyHost' | 'proxyPort' | 'proxyUsername' | 'proxyPassword'> {
  return {
    proxy: null,
    proxyType: null,
    proxyHost: null,
    proxyPort: null,
    proxyUsername: null,
    proxyPassword: null,
    ...patch
  }
}

describe('parseProxyRaw', () => {
  it('parses host:port:user:pass format used by account imports', () => {
    expect(parseProxyRaw('68.233.111.135:3238:proxy111:kB0-secret')).toEqual({
      server: 'http://68.233.111.135:3238',
      username: 'proxy111',
      password: 'kB0-secret'
    })
  })

  it('parses URL proxy format with credentials and socks scheme', () => {
    expect(parseProxyRaw('socks5://user:pass@example.com:1080')).toEqual({
      server: 'socks5://example.com:1080',
      username: 'user',
      password: 'pass'
    })
  })

  it('accepts host:port without authentication', () => {
    expect(parseProxyRaw('127.0.0.1:8080', 'https')).toEqual({
      server: 'https://127.0.0.1:8080'
    })
  })
})

describe('resolveAccountProxy', () => {
  it('prefers structured proxy fields when available', () => {
    expect(resolveAccountProxy(source({
      proxy: '1.1.1.1:80:raw:rawpass',
      proxyType: 'socks5',
      proxyHost: '10.0.0.2',
      proxyPort: 9000,
      proxyUsername: 'structured',
      proxyPassword: 'secret'
    }))).toEqual({
      server: 'socks5://10.0.0.2:9000',
      username: 'structured',
      password: 'secret'
    })
  })

  it('falls back to raw proxy when import did not populate host/port fields', () => {
    expect(resolveAccountProxy(source({ proxy: '10.10.10.10:3128:u:p' }))).toEqual({
      server: 'http://10.10.10.10:3128',
      username: 'u',
      password: 'p'
    })
  })

  it('distinguishes no proxy from malformed proxy so runtime never silently falls back direct', () => {
    expect(hasConfiguredProxy(source({}))).toBe(false)
    expect(resolveAccountProxyState(source({}))).toEqual({ status: 'none' })

    const invalid = resolveAccountProxyState(source({ proxy: 'missing-port' }))
    expect(invalid.status).toBe('invalid')
    if (invalid.status === 'invalid') {
      expect(invalid.message).toContain('không mở kết nối trực tiếp')
      expect(invalid.message).not.toContain('missing-port')
    }
  })

  it('treats partial structured credentials as configured but invalid when no usable endpoint exists', () => {
    expect(resolveAccountProxyState(source({ proxyUsername: 'user-only' }))).toMatchObject({ status: 'invalid' })
  })
})
