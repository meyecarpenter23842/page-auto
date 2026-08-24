import { describe, expect, it } from 'vitest'
import { EmailProxyPool, normalizeEmailProxyLines, parseEmailProxyLine } from './emailProxyPool'

describe('EmailProxyPool', () => {
  it('accepts IPv4 proxies and never exposes credentials in display', () => {
    expect(parseEmailProxyLine('1.2.3.4:8080:user:secret')).toMatchObject({
      server: 'http://1.2.3.4:8080',
      username: 'user',
      password: 'secret',
      display: 'http://1.2.3.4:8080'
    })
    expect(parseEmailProxyLine('proxy.example.com:8080')).toBeNull()
    expect(() => normalizeEmailProxyLines('1.2.3.4:8080\nproxy.example.com:9000')).toThrow(/IPv4/)
  })

  it('keeps proxy assignment in runtime memory only and rotate affects future sessions', () => {
    const pool = new EmailProxyPool(() => ({ mode: 'random_ipv4', entries: ['1.2.3.4:8000', '5.6.7.8:9000'] }))
    const first = pool.acquire(10)
    expect(first).not.toBeNull()
    expect(pool.acquire(10)).toEqual(first)
    expect(pool.status().activeSessions).toBe(1)
    expect(pool.rotate().message).toMatch(/phiên Email kế tiếp/)
    expect(pool.acquire(10)).toEqual(first)
    pool.release(10)
    expect(pool.status().activeSessions).toBe(0)
  })
})
