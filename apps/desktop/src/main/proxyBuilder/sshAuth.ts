import { Buffer } from 'node:buffer'
import { readFileSync, statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { utils, type ConnectConfig } from 'ssh2'
import type { ProxyBuilderSshAuth } from '../../shared/proxyBuilder'

const MAX_PRIVATE_KEY_BYTES = 1024 * 1024

type KeyAuth = Extract<ProxyBuilderSshAuth, { type: 'key' }>

export function normalizeProxyBuilderPrivateKey(value: string): Buffer {
  const normalized = value.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim()
  if (!normalized) throw new Error('SSH Private Key trống.')
  const key = Buffer.from(normalized + '\n', 'utf8')
  if (key.byteLength > MAX_PRIVATE_KEY_BYTES) throw new Error('SSH Private Key vượt quá giới hạn 1 MB.')
  return key
}

export function loadProxyBuilderPrivateKey(auth: KeyAuth): Buffer {
  let key: Buffer
  if (auth.privateKeyPath?.trim()) {
    const path = auth.privateKeyPath.trim()
    if (!isAbsolute(path)) throw new Error('Đường dẫn SSH Private Key không hợp lệ.')
    try {
      const stat = statSync(path)
      if (!stat.isFile()) throw new Error('not-file')
      if (stat.size > MAX_PRIVATE_KEY_BYTES) throw new Error('too-large')
      key = readFileSync(path)
    } catch (error) {
      if (error instanceof Error && error.message === 'too-large') throw new Error('SSH Private Key vượt quá giới hạn 1 MB.')
      throw new Error('Không đọc được file SSH Private Key đã chọn.')
    }
  } else {
    key = normalizeProxyBuilderPrivateKey(auth.privateKey)
  }

  if (!key.byteLength) throw new Error('SSH Private Key trống.')
  const passphrase = auth.passphrase?.length ? auth.passphrase : undefined
  const parsed = utils.parseKey(key, passphrase)
  if (parsed instanceof Error) {
    if (/encrypted|passphrase|decrypt/i.test(parsed.message)) {
      throw new Error('SSH Private Key cần passphrase hoặc passphrase không đúng.')
    }
    throw new Error('SSH Private Key không hợp lệ hoặc không đọc được.')
  }
  return key
}

export function applyProxyBuilderSshAuth(config: ConnectConfig, auth: ProxyBuilderSshAuth): void {
  if (auth.type === 'password') {
    config.password = auth.password
    config.tryKeyboard = true
    return
  }
  config.privateKey = loadProxyBuilderPrivateKey(auth)
  if (auth.passphrase?.length) config.passphrase = auth.passphrase
}
