import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { accountProfileDirectory } from './browserProfileManager'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('persistent browser profile restart', () => {
  it('resolves the same account profile directory after an app restart and preserves profile data', () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), 'page-auto-profile-restart-'))
    tempDirectories.push(dataDirectory)

    const beforeRestart = accountProfileDirectory(dataDirectory, 42)
    mkdirSync(beforeRestart, { recursive: true })
    writeFileSync(join(beforeRestart, 'session-marker.txt'), 'persisted-session', 'utf8')

    const afterRestart = accountProfileDirectory(dataDirectory, 42)
    expect(afterRestart).toBe(beforeRestart)
    expect(readFileSync(join(afterRestart, 'session-marker.txt'), 'utf8')).toBe('persisted-session')
    expect(accountProfileDirectory(dataDirectory, 43)).not.toBe(beforeRestart)
  })
})