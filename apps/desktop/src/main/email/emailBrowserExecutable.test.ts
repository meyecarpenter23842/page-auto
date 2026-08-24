import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { emailBrowserExecutableCandidates } from './emailBrowserExecutable'

describe('email browser executable candidates', () => {
  it('keeps a manually selected executable authoritative', () => {
    expect(emailBrowserExecutableCandidates('', 'C:\\Custom\\chrome.exe', 'C:\\Fallback\\chrome.exe', {}))
      .toEqual(['C:\\Custom\\chrome.exe'])
  })

  it('looks beside the Email profile root before system installs when auto-detecting', () => {
    const profileRoot = resolve('MaxHotmail', 'profiles')
    const appRoot = resolve('MaxHotmail')
    const candidates = emailBrowserExecutableCandidates(profileRoot, '', null, {})
    expect(candidates).toContain(join(appRoot, 'chrome.exe'))
    expect(candidates).toContain(join(appRoot, 'Chromium', 'Application', 'chrome.exe'))
  })

  it('includes PAGE-AUTO fallback plus common Chrome, Edge and Chromium installs', () => {
    const env = {
      PROGRAMFILES: 'C:\\Program Files',
      'PROGRAMFILES(X86)': 'C:\\Program Files (x86)',
      LOCALAPPDATA: 'C:\\Users\\PC\\AppData\\Local'
    }
    const candidates = emailBrowserExecutableCandidates('', '', 'D:\\PageAuto\\chrome.exe', env)
    expect(candidates[0]).toBe('D:\\PageAuto\\chrome.exe')
    expect(candidates.some((candidate) => candidate.endsWith(join('Google', 'Chrome', 'Application', 'chrome.exe')))).toBe(true)
    expect(candidates.some((candidate) => candidate.endsWith(join('Microsoft', 'Edge', 'Application', 'msedge.exe')))).toBe(true)
    expect(candidates.some((candidate) => candidate.endsWith(join('Chromium', 'Application', 'chrome.exe')))).toBe(true)
  })
})
