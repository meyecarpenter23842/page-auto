import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { utilityProcess, type UtilityProcess } from 'electron'
import type { BrowserProfileResult } from '../../shared/accounts'

export function accountProfileDirectory(dataDirectory: string, accountId: number): string {
  return join(dataDirectory, 'browser-profiles', `account-${accountId}`)
}

export class BrowserProfileManager {
  private readonly workers = new Map<number, UtilityProcess>()

  constructor(private readonly dataDirectory: string) {}

  open(accountId: number): BrowserProfileResult {
    const existing = this.workers.get(accountId)
    if (existing) {
      return {
        status: 'already_open',
        profileDirectory: accountProfileDirectory(this.dataDirectory, accountId),
        message: 'Browser profile của account này đang mở.'
      }
    }

    const profileDirectory = accountProfileDirectory(this.dataDirectory, accountId)
    mkdirSync(profileDirectory, { recursive: true })

    try {
      const workerPath = join(__dirname, 'browser-profile-worker.js')
      const worker = utilityProcess.fork(workerPath, [profileDirectory], {
        serviceName: `PAGE-AUTO account ${accountId}`
      })

      this.workers.set(accountId, worker)
      worker.once('exit', () => {
        if (this.workers.get(accountId) === worker) {
          this.workers.delete(accountId)
        }
      })

      return {
        status: 'started',
        profileDirectory
      }
    } catch (error) {
      return {
        status: 'error',
        profileDirectory,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }

  closeAll(): void {
    for (const worker of this.workers.values()) {
      worker.kill()
    }
    this.workers.clear()
  }
}
