import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BrowserEngineService, chromeExecutableCandidates } from './browserEngineService'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('chromeExecutableCandidates', () => {
  it('builds stable Chrome candidates from Windows install roots without duplicates', () => {
    const candidates = chromeExecutableCandidates({
      PROGRAMFILES: 'C:\\Program Files',
      'PROGRAMFILES(X86)': 'C:\\Program Files (x86)',
      LOCALAPPDATA: 'C:\\Users\\PC\\AppData\\Local'
    })

    expect(candidates).toEqual([
      join('C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join('C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join('C:\\Users\\PC\\AppData\\Local', 'Google', 'Chrome', 'Application', 'chrome.exe')
    ])
  })

  it('does not duplicate the same install root', () => {
    const candidates = chromeExecutableCandidates({
      PROGRAMFILES: 'C:\\ChromeRoot',
      'PROGRAMFILES(X86)': 'C:\\ChromeRoot'
    })
    expect(candidates).toHaveLength(1)
  })
})

describe('BrowserEngineService probe', () => {
  it('checks the executable path without launching Chrome as a side effect', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'page-auto-chrome-probe-'))
    temporaryDirectories.push(directory)
    const executablePath = join(directory, 'chrome.exe')
    writeFileSync(executablePath, 'not-a-real-executable', 'utf8')

    const service = new BrowserEngineService()
    const result = await service.probeExecutable(executablePath)

    expect(result).toEqual({
      status: 'found',
      executablePath,
      version: null,
      message: 'Đã tìm thấy file Chrome.'
    })
  })
})
