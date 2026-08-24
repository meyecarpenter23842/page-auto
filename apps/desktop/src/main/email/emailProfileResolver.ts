import { access, mkdir, readFile, stat } from 'node:fs/promises'
import { request } from 'node:http'
import { isAbsolute, relative, resolve } from 'node:path'
import type { HotmailProfileInspection } from '../../shared/hotmail'

function safeProfileDirectory(root: string, uid: string): string | null {
  const normalizedRoot = root.trim()
  const normalizedUid = uid.trim()
  if (!normalizedRoot || !normalizedUid) return null
  if (!isAbsolute(normalizedRoot)) return null
  if (normalizedUid === '.' || normalizedUid === '..' || /[\\/]/.test(normalizedUid)) return null
  const base = resolve(normalizedRoot)
  const candidate = resolve(base, normalizedUid)
  const rel = relative(base, candidate)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null
  return candidate
}

async function readCdpEndpoint(profileDirectory: string): Promise<string | null> {
  try {
    const [portText] = (await readFile(resolve(profileDirectory, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/)
    if (!portText || !/^\d+$/.test(portText)) return null
    const port = Number(portText)
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null
    return `http://127.0.0.1:${port}`
  } catch {
    return null
  }
}

export async function probeCdpEndpoint(endpoint: string, timeoutMs = 650): Promise<boolean> {
  return await new Promise<boolean>((resolveProbe) => {
    let settled = false
    const finish = (value: boolean) => {
      if (settled) return
      settled = true
      resolveProbe(value)
    }
    try {
      const url = new URL('/json/version', endpoint)
      const req = request(url, { method: 'GET', timeout: timeoutMs }, (response) => {
        response.resume()
        finish((response.statusCode ?? 500) >= 200 && (response.statusCode ?? 500) < 500)
      })
      req.once('timeout', () => {
        req.destroy()
        finish(false)
      })
      req.once('error', () => finish(false))
      req.end()
    } catch {
      finish(false)
    }
  })
}

async function hasProfileLock(profileDirectory: string): Promise<boolean> {
  for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    try {
      await access(resolve(profileDirectory, name))
      return true
    } catch {
      // Try the next Chromium lock marker.
    }
  }
  return false
}

export async function inspectEmailProfile(root: string, uid: string): Promise<HotmailProfileInspection> {
  if (!root.trim()) {
    return { status: 'not_configured', profileDirectory: null, cdpEndpoint: null }
  }

  const profileDirectory = safeProfileDirectory(root, uid)
  if (!profileDirectory) {
    return { status: 'missing', profileDirectory: null, cdpEndpoint: null }
  }

  try {
    const info = await stat(profileDirectory)
    if (!info.isDirectory()) return { status: 'missing', profileDirectory, cdpEndpoint: null }
  } catch {
    return { status: 'missing', profileDirectory, cdpEndpoint: null }
  }

  const candidateEndpoint = await readCdpEndpoint(profileDirectory)
  const cdpEndpoint = candidateEndpoint && await probeCdpEndpoint(candidateEndpoint) ? candidateEndpoint : null
  const locked = !cdpEndpoint && await hasProfileLock(profileDirectory)
  return {
    status: cdpEndpoint ? 'running' : locked ? 'in_use' : 'available',
    profileDirectory,
    cdpEndpoint
  }
}

export async function ensureEmailProfileDirectory(root: string, uid: string): Promise<string> {
  const normalizedRoot = root.trim()
  if (!normalizedRoot) throw new Error('Chưa cấu hình Email Profile Root.')

  const profileDirectory = safeProfileDirectory(normalizedRoot, uid)
  if (!profileDirectory) throw new Error('Email Profile Root hoặc UID không hợp lệ.')

  let rootInfo
  try {
    rootInfo = await stat(resolve(normalizedRoot))
  } catch {
    throw new Error('Email Profile Root không tồn tại.')
  }
  if (!rootInfo.isDirectory()) throw new Error('Email Profile Root không phải thư mục.')

  try {
    const existing = await stat(profileDirectory)
    if (!existing.isDirectory()) throw new Error('Đường dẫn profile UID đã tồn tại nhưng không phải thư mục.')
    return profileDirectory
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  try {
    await mkdir(profileDirectory)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const raced = await stat(profileDirectory).catch(() => null)
    if (!raced?.isDirectory()) throw new Error('Đường dẫn profile UID đã tồn tại nhưng không phải thư mục.')
  }
  return profileDirectory
}

export function resolveEmailProfileDirectory(root: string, uid: string): string | null {
  return safeProfileDirectory(root, uid)
}
