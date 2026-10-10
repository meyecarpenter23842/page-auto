import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { utils, type ConnectConfig } from 'ssh2'
import { applyProxyBuilderSshAuth, loadProxyBuilderPrivateKey, normalizeProxyBuilderPrivateKey } from './sshAuth'

function testPrivateKey(): string {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  return privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()
}

describe('Proxy Builder SSH key handling', () => {
  it('normalizes pasted BOM/CRLF keys before ssh2 parses them', () => {
    const pem = testPrivateKey()
    const key = normalizeProxyBuilderPrivateKey('\uFEFF' + pem.replace(/\n/g, '\r\n'))
    expect(utils.parseKey(key)).not.toBeInstanceOf(Error)
  })

  it('loads selected key files as raw bytes in Electron Main and applies them to ssh2', () => {
    const dir = mkdtempSync(join(tmpdir(), 'page-auto-proxy-key-'))
    const path = join(dir, 'test-key')
    try {
      const pem = testPrivateKey()
      writeFileSync(path, pem)
      const auth = { type: 'key' as const, privateKey: '', privateKeyPath: path }
      const key = loadProxyBuilderPrivateKey(auth)
      expect(key.equals(Buffer.from(pem))).toBe(true)
      const config: ConnectConfig = { host: '127.0.0.1', username: 'test' }
      applyProxyBuilderSshAuth(config, auth)
      expect(Buffer.isBuffer(config.privateKey)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects invalid key material before opening the SSH connection', () => {
    expect(() => loadProxyBuilderPrivateKey({ type: 'key', privateKey: 'not-a-private-key' }))
      .toThrow('SSH Private Key không hợp lệ hoặc không đọc được.')
  })
})
