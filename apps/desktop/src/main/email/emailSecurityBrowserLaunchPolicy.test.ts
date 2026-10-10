import { describe, expect, it } from 'vitest'
import { emailBrowserLaunchPolicy } from './emailSecurityBrowserLaunchPolicy'

describe('emailBrowserLaunchPolicy', () => {
  it('keeps normal Outlook open-mail launch behavior unchanged', () => {
    expect(emailBrowserLaunchPolicy('open-mail')).toEqual({ ignoreDefaultArgs: [] })
  })

  it('removes only Playwright automation UI flag for recovery Security actions', () => {
    expect(emailBrowserLaunchPolicy('recovery-action')).toEqual({
      ignoreDefaultArgs: ['--enable-automation']
    })
  })

  it('removes only Playwright automation UI flag for password Security actions', () => {
    expect(emailBrowserLaunchPolicy('password-action')).toEqual({
      ignoreDefaultArgs: ['--enable-automation']
    })
  })
})
