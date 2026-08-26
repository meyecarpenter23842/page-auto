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

  it('keeps proxy ownership per Email browser session and rotate affects only future sessions', () => {
    const pool = new EmailProxyPool(
      () => ({ mode: 'random_ipv4', entries: ['1.2.3.4:8000', '5.6.7.8:9000'] }),
      () => 1_000,
      () => 0
    )
    const first = pool.acquire(10)
    expect(first?.display).toBe('http://1.2.3.4:8000')
    expect(pool.acquire(10)).toEqual(first)
    expect(pool.status().message).toContain('#10 → http://1.2.3.4:8000')
    expect(pool.rotate().message).toMatch(/phiên Email kế tiếp/)
    expect(pool.acquire(10)).toEqual(first)
    expect(pool.acquire(11)?.display).toBe('http://5.6.7.8:9000')
    pool.release(10)
    expect(pool.status().activeSessions).toBe(1)
  })

  it('cools down a failed proxy without leaking credentials and restores it after success', () => {
    let now = 10_000
    const pool = new EmailProxyPool(
      () => ({ mode: 'random_ipv4', entries: ['1.2.3.4:8000:user:secret', '5.6.7.8:9000'] }),
      () => now,
      () => 0
    )
    const first = pool.peek()
    expect(first?.display).toBe('http://1.2.3.4:8000')
    if (!first) throw new Error('missing proxy test fixture')
    pool.recordFailure(first)
    expect(pool.cooldownCount()).toBe(1)
    expect(JSON.stringify(pool.status())).not.toContain('secret')
    expect(pool.peek()?.display).toBe('http://5.6.7.8:9000')

    now += 31_000
    expect(pool.peek()?.display).toBe('http://1.2.3.4:8000')
    pool.recordSuccess(first)
    expect(pool.cooldownCount()).toBe(0)
  })
})
