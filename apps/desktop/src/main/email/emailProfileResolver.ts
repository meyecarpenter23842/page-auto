import { access, readFile, stat } from 'node:fs/promises'
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

  const cdpEndpoint = await readCdpEndpoint(profileDirectory)
  const locked = !cdpEndpoint && await hasProfileLock(profileDirectory)
  return {
    status: cdpEndpoint ? 'running' : locked ? 'in_use' : 'available',
    profileDirectory,
    cdpEndpoint
  }
}

export function resolveEmailProfileDirectory(root: string, uid: string): string | null {
  return safeProfileDirectory(root, uid)
}
