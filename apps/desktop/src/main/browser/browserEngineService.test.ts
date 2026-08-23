import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { chromeExecutableCandidates } from './browserEngineService'

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
