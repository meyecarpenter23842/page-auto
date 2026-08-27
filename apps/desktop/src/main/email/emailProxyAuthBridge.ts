import { createServer, request as httpRequest, type IncomingHttpHeaders, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { connect as netConnect, type Socket } from 'node:net'
import { connect as tlsConnect } from 'node:tls'

export interface EmailProxyAuthConfig {
  server: string
  username?: string
  password?: string
}

export interface EmailProxyAuthBridge {
  server: string
  close: () => Promise<void>
}

function upstreamProxyUrl(proxy: EmailProxyAuthConfig): URL | null {
  try {
    const url = new URL(proxy.server)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

export function shouldBridgeEmailProxyAuth(proxy: EmailProxyAuthConfig | null): boolean {
  if (!proxy || (!proxy.username && !proxy.password)) return false
  return upstreamProxyUrl(proxy) !== null
}

function proxyAuthorization(proxy: EmailProxyAuthConfig): string {
  return `Basic ${Buffer.from(`${proxy.username ?? ''}:${proxy.password ?? ''}`, 'utf8').toString('base64')}`
}

function sanitizedForwardHeaders(headers: IncomingHttpHeaders, authorization: string): IncomingHttpHeaders {
  const next = { ...headers }
  delete next['proxy-authorization']
  delete next['proxy-connection']
  next['proxy-authorization'] = authorization
  return next
}

export async function startEmailProxyAuthBridge(proxy: EmailProxyAuthConfig): Promise<EmailProxyAuthBridge | null> {
  if (!shouldBridgeEmailProxyAuth(proxy)) return null
  const upstream = upstreamProxyUrl(proxy)
  if (!upstream) return null

  const upstreamPort = Number(upstream.port || (upstream.protocol === 'https:' ? 443 : 80))
  const authorization = proxyAuthorization(proxy)
  const sockets = new Set<Socket>()
  let closed = false

  const trackSocket = <T extends Socket>(socket: T): T => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    return socket
  }

  const server = createServer((request, response) => {
    const handleResponse = (upstreamResponse: IncomingMessage) => {
      if (upstreamResponse.statusCode === 407) {
        upstreamResponse.resume()
        response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
        response.end('Upstream Email proxy authentication failed.')
        return
      }
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers)
      upstreamResponse.pipe(response)
    }
    const options = {
      hostname: upstream.hostname,
      port: upstreamPort,
      method: request.method,
      path: request.url,
      headers: sanitizedForwardHeaders(request.headers, authorization)
    }
    const upstreamRequest = upstream.protocol === 'https:'
      ? httpsRequest({ ...options, servername: upstream.hostname }, handleResponse)
      : httpRequest(options, handleResponse)

    upstreamRequest.once('error', () => {
      if (!response.headersSent) response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('Upstream Email proxy connection failed.')
    })
    request.pipe(upstreamRequest)
  })

  server.on('connection', (socket) => trackSocket(socket))
  server.on('connect', (request, clientSocket, head) => {
    const upstreamSocket = trackSocket(
      upstream.protocol === 'https:'
        ? tlsConnect({ host: upstream.hostname, port: upstreamPort, servername: upstream.hostname })
        : netConnect({ host: upstream.hostname, port: upstreamPort })
    )
    const readyEvent = upstream.protocol === 'https:' ? 'secureConnect' : 'connect'
    let responseBuffer = Buffer.alloc(0)
    let tunnelReady = false

    const failTunnel = () => {
      if (!clientSocket.destroyed) {
        clientSocket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
      }
      upstreamSocket.destroy()
    }

    upstreamSocket.once('error', failTunnel)
    clientSocket.once('error', () => upstreamSocket.destroy())

    upstreamSocket.once(readyEvent, () => {
      upstreamSocket.write(
        `CONNECT ${request.url ?? ''} HTTP/1.1\r\n`
        + `Host: ${request.url ?? ''}\r\n`
        + `Proxy-Authorization: ${authorization}\r\n`
        + 'Proxy-Connection: Keep-Alive\r\n\r\n'
      )
    })

    upstreamSocket.on('data', function onProxyResponse(chunk: Buffer) {
      if (tunnelReady) return
      responseBuffer = Buffer.concat([responseBuffer, chunk])
      const headerEnd = responseBuffer.indexOf('\r\n\r\n')
      if (headerEnd < 0) {
        if (responseBuffer.length > 64 * 1024) failTunnel()
        return
      }

      const responseHead = responseBuffer.subarray(0, headerEnd + 4)
      const remaining = responseBuffer.subarray(headerEnd + 4)
      const statusMatch = /^HTTP\/1\.[01]\s+(\d{3})/i.exec(responseHead.toString('latin1'))
      const statusCode = statusMatch ? Number(statusMatch[1]) : 0
      upstreamSocket.off('data', onProxyResponse)

      if (statusCode !== 200) {
        failTunnel()
        return
      }

      tunnelReady = true
      clientSocket.write(responseHead)
      if (remaining.length > 0) clientSocket.write(remaining)
      if (head.length > 0) upstreamSocket.write(head)
      upstreamSocket.pipe(clientSocket)
      clientSocket.pipe(upstreamSocket)
    })
  })

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      server.off('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(0, '127.0.0.1')
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('Không thể tạo local Email proxy bridge.')
  }

  return {
    server: `http://127.0.0.1:${address.port}`,
    close: async () => {
      if (closed) return
      closed = true
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
}
