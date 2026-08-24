import { access, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { HotmailProfileStatus } from '../../shared/hotmail'

export interface EmailProfileInspection {
  status: HotmailProfileStatus
  profileDirectory: string | null
  cdpEndpoint: string | null
  message: string
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function readCdpEndpoint(profileDirectory: string): Promise<string | null> {
  try {
    const [port] = (await readFile(join(profileDirectory, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/)
    if (port && /^\d+$/.test(port)) return `http://127.0.0.1:${port}`
  } catch {
    // A closed profile normally has no DevToolsActivePort file.
  }
  return null
}

export class EmailProfileResolver {
  constructor(private readonly getRoot: () => string | null) {}

  resolve(uid: string): string | null {
    const root = this.getRoot()?.trim()
    const normalizedUid = uid.trim()
    if (!root || !normalizedUid) return null
    return join(root, normalizedUid)
  }

  async inspect(uid: string): Promise<EmailProfileInspection> {
    const profileDirectory = this.resolve(uid)
    if (!profileDirectory) {
      return {
        status: 'unconfigured',
        profileDirectory: null,
        cdpEndpoint: null,
        message: 'Chưa chọn thư mục profile MaxHotmail.'
      }
    }

    try {
      const profileStat = await stat(profileDirectory)
      if (!profileStat.isDirectory()) {
        return {
          status: 'missing',
          profileDirectory,
          cdpEndpoint: null,
          message: 'Profile UID không tồn tại dưới Email Profile Root.'
        }
      }
    } catch {
      return {
        status: 'missing',
        profileDirectory,
        cdpEndpoint: null,
        message: 'Profile UID không tồn tại dưới Email Profile Root.'
      }
    }

    const cdpEndpoint = await readCdpEndpoint(profileDirectory)
    if (cdpEndpoint) {
      return {
        status: 'running',
        profileDirectory,
        cdpEndpoint,
        message: 'Profile đang chạy và có CDP endpoint.'
      }
    }

    const lockNames = ['SingletonLock', 'SingletonSocket', 'SingletonCookie']
    const locked = (await Promise.all(lockNames.map((name) => exists(join(profileDirectory, name))))).some(Boolean)
    if (locked) {
      return {
        status: 'in_use',
        profileDirectory,
        cdpEndpoint: null,
        message: 'Profile có lock nhưng không có CDP endpoint; không mở process thứ hai.'
      }
    }

    return {
      status: 'available',
      profileDirectory,
      cdpEndpoint: null,
      message: 'Profile sẵn sàng mở trực tiếp từ MaxHotmail root.'
    }
  }
}
