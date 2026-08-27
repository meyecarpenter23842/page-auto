import { createServer, get as httpGet, type Server } from 'node:http'
import { connect as netConnect } from 'node:net'
import type { Duplex } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { shouldBridgeEmailProxyAuth, startEmailProxyAuthBridge } from './emailProxyAuthBridge'

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing test server address')
  return address.port
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

describe('Email proxy auth bridge', () => {
  it('is used only for authenticated HTTP(S) proxies', () => {
    expect(shouldBridgeEmailProxyAuth({ server: 'http://127.0.0.1:8080', username: 'user', password: 'secret' })).toBe(true)
    expect(shouldBridgeEmailProxyAuth({ server: 'https://127.0.0.1:8080', username: 'user', password: 'secret' })).toBe(true)
    expect(shouldBridgeEmailProxyAuth({ server: 'http://127.0.0.1:8080' })).toBe(false)
    expect(shouldBridgeEmailProxyAuth({ server: 'socks5://127.0.0.1:1080', username: 'user', password: 'secret' })).toBe(false)
  })

  it('answers HTTPS CONNECT through the upstream proxy with Proxy-Authorization automatically', async () => {
    let receivedAuthorization: string | null = null
    const upstreamTunnels = new Set<Duplex>()
    const upstream = createServer()
    upstream.on('connect', (request, socket) => {
      upstreamTunnels.add(socket)
      socket.once('close', () => upstreamTunnels.delete(socket))
      receivedAuthorization = typeof request.headers['proxy-authorization'] === 'string'
        ? request.headers['proxy-authorization']
        : null
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    })
    const upstreamPort = await listen(upstream)
    const bridge = await startEmailProxyAuthBridge({
      server: `http://127.0.0.1:${upstreamPort}`,
      username: 'proxy-user',
      password: 'proxy-secret'
    })
    if (!bridge) throw new Error('missing proxy bridge')

    const bridgeUrl = new URL(bridge.server)
    const client = netConnect({ host: bridgeUrl.hostname, port: Number(bridgeUrl.port) })
    try {
      const response = await new Promise<string>((resolve, reject) => {
        client.once('error', reject)
        client.once('connect', () => {
          client.write('CONNECT outlook.live.com:443 HTTP/1.1\r\nHost: outlook.live.com:443\r\n\r\n')
        })
        client.once('data', (chunk) => resolve(chunk.toString('latin1')))
      })
      expect(response).toMatch(/^HTTP\/1\.1 200/i)
      expect(receivedAuthorization).toBe(`Basic ${Buffer.from('proxy-user:proxy-secret').toString('base64')}`)
      expect(bridge.server).not.toContain('proxy-user')
      expect(bridge.server).not.toContain('proxy-secret')
    } finally {
      client.destroy()
      for (const socket of upstreamTunnels) socket.destroy()
      await bridge.close()
      await closeServer(upstream)
    }
  })

  it('converts an upstream 407 into a non-auth browser error instead of forwarding a credential prompt', async () => {
    let receivedAuthorization: string | null = null
    const upstream = createServer((request, response) => {
      receivedAuthorization = typeof request.headers['proxy-authorization'] === 'string'
        ? request.headers['proxy-authorization']
        : null
      response.writeHead(407, { 'proxy-authenticate': 'Basic realm="upstream"' })
      response.end()
    })
    const upstreamPort = await listen(upstream)
    const bridge = await startEmailProxyAuthBridge({
      server: `http://127.0.0.1:${upstreamPort}`,
      username: 'proxy-user',
      password: 'proxy-secret'
    })
    if (!bridge) throw new Error('missing proxy bridge')

    const bridgeUrl = new URL(bridge.server)
    try {
      const result = await new Promise<{ statusCode: number | undefined; proxyAuthenticate: string | string[] | undefined }>((resolve, reject) => {
        const request = httpGet({
          hostname: bridgeUrl.hostname,
          port: Number(bridgeUrl.port),
          path: 'http://example.test/',
          headers: { host: 'example.test' }
        }, (response) => {
          response.resume()
          resolve({ statusCode: response.statusCode, proxyAuthenticate: response.headers['proxy-authenticate'] })
        })
        request.once('error', reject)
      })
      expect(receivedAuthorization).toBe(`Basic ${Buffer.from('proxy-user:proxy-secret').toString('base64')}`)
      expect(result.statusCode).toBe(502)
      expect(result.proxyAuthenticate).toBeUndefined()
    } finally {
      await bridge.close()
      await closeServer(upstream)
    }
  })
})
