import { readFile, stat } from 'node:fs/promises'
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

export async function validateEmailProfileRoot(root: string): Promise<string> {
  const normalizedRoot = root.trim()
  if (!normalizedRoot) throw new Error('Chưa cấu hình Email Profile Root.')
  if (!isAbsolute(normalizedRoot)) throw new Error('Email Profile Root phải là đường dẫn tuyệt đối.')

  const resolvedRoot = resolve(normalizedRoot)
  let info
  try {
    info = await stat(resolvedRoot)
  } catch {
    throw new Error('Email Profile Root không tồn tại.')
  }
  if (!info.isDirectory()) throw new Error('Email Profile Root không phải thư mục.')
  return resolvedRoot
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
  if (!candidateEndpoint) {
    return { status: 'available', profileDirectory, cdpEndpoint: null }
  }

  const live = await probeCdpEndpoint(candidateEndpoint)
  return {
    // A dead DevToolsActivePort is stale metadata, not proof of a real lock.
    // Treat the existing UID profile as launchable; Chromium itself will decide
    // whether a real ProcessSingleton owner blocks the persistent launch.
    status: live ? 'running' : 'available',
    profileDirectory,
    cdpEndpoint: live ? candidateEndpoint : null
  }
}

export function resolveEmailProfileDirectory(root: string, uid: string): string | null {
  return safeProfileDirectory(root, uid)
}
