import { createServer, type Server, type Socket } from 'node:net'
import { describe, expect, it } from 'vitest'
import { ProxyBuilderCheckerService, checkProxyLineNow, parseProxyLine } from './checkerService'

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('test server did not bind TCP port')
  return address.port
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

async function waitForDone(service: ProxyBuilderCheckerService, runId: string): Promise<ReturnType<ProxyBuilderCheckerService['status']>> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const snapshot = service.status({ runId })
    if (snapshot && snapshot.status !== 'running') return snapshot
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('checker test timed out')
}

describe('Proxy Builder checker parser', () => {
  it('supports no-auth, basic auth, URL and bracketed IPv6 without exposing password in the mask', () => {
    const basic = parseProxyLine('proxy.example:3128:user:super-secret')
    expect(basic.host).toBe('proxy.example')
    expect(basic.port).toBe(3128)
    expect(basic.maskedProxy).toBe('proxy.example:3128:user:••••')
    expect(basic.maskedProxy).not.toContain('super-secret')

    const url = parseProxyLine('http://alpha:beta@127.0.0.1:8080')
    expect(url.maskedProxy).toBe('127.0.0.1:8080:alpha:••••')

    const ipv6 = parseProxyLine('[2001:db8::1]:9000')
    expect(ipv6.host).toBe('2001:db8::1')
    expect(ipv6.maskedProxy).toBe('[2001:db8::1]:9000')
  })

  it('rejects incomplete auth and invalid ports', () => {
    expect(() => parseProxyLine('127.0.0.1:0')).toThrow(/Port proxy/)
    expect(() => parseProxyLine('127.0.0.1:8080:user')).toThrow(/đủ user và password/)
  })
})

describe('Proxy Builder checker lifecycle', () => {
  it('marks a real refused TCP proxy DEAD without leaking credentials', async () => {
    const reserved = createServer()
    const port = await listen(reserved)
    await close(reserved)

    const service = new ProxyBuilderCheckerService()
    const started = service.start({ proxies: [`127.0.0.1:${port}:user:secret-value`], retries: 0, timeoutMs: 3_000 })
    const done = await waitForDone(service, started.runId)

    expect(done?.status).toBe('completed')
    expect(done?.dead).toBe(1)
    expect(done?.results[0]?.status).toBe('dead')
    expect(done?.results[0]?.maskedProxy).toBe(`127.0.0.1:${port}:user:••••`)
    expect(JSON.stringify(done)).not.toContain('secret-value')
    service.dispose()
  })

  it('supports one-shot external verification for newly provisioned proxies', async () => {
    const reserved = createServer()
    const port = await listen(reserved)
    await close(reserved)

    const checked = await checkProxyLineNow('127.0.0.1:' + port + ':user:secret-value', 3_000, 0)
    expect(checked.live).toBe(false)
    expect(checked.error).toMatch(/Kết nối proxy|Timeout/)
    expect(JSON.stringify(checked)).not.toContain('secret-value')
  })

  it('cancels an in-flight CONNECT check and destroys its socket', async () => {
    const accepted = new Set<Socket>()
    let resolveAccepted: (() => void) | null = null
    const acceptedPromise = new Promise<void>((resolve) => { resolveAccepted = resolve })
    const server = createServer((socket) => {
      accepted.add(socket)
      socket.on('close', () => accepted.delete(socket))
      resolveAccepted?.()
    })
    const port = await listen(server)
    const service = new ProxyBuilderCheckerService()

    try {
      const started = service.start({ proxies: [`127.0.0.1:${port}`], retries: 0, timeoutMs: 10_000 })
      await acceptedPromise
      const cancelled = service.cancel({ runId: started.runId })
      expect(cancelled?.status).toBe('cancelled')
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(service.status({ runId: started.runId })?.status).toBe('cancelled')
    } finally {
      service.dispose()
      for (const socket of accepted) socket.destroy()
      await close(server)
    }
  })
})
