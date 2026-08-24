import { describe, expect, it } from 'vitest'
import type { HotmailSettings } from '../../shared/hotmail'
import { EmailProxyPool, parseEmailProxy } from './emailProxyPool'

describe('EmailProxyPool', () => {
  it('parses proxy credentials without touching account proxy fields', () => {
    expect(parseEmailProxy('1.2.3.4:8080:user:pass')).toMatchObject({
      server: 'http://1.2.3.4:8080',
      host: '1.2.3.4',
      port: 8080,
      username: 'user',
      password: 'pass'
    })
  })

  it('rotates a global proxy and keeps it outside account data', () => {
    let settings: HotmailSettings = {
      profileRoot: null,
      browserExecutablePath: null,
      oauthClientId: null,
      oauthTenant: 'consumers',
      proxyMode: 'random_ipv4',
      proxyList: ['1.1.1.1:8000', '2.2.2.2:8000'],
      currentProxy: '1.1.1.1:8000',
      updatedAt: null
    }
    const pool = new EmailProxyPool({
      getSettings: () => settings,
      setCurrentProxy: (proxy) => {
        settings = { ...settings, currentProxy: proxy }
        return settings
      }
    })
    const result = pool.rotate()
    expect(result.ok).toBe(true)
    expect(result.currentProxy).toBe('2.2.2.2:8000')
  })
})
