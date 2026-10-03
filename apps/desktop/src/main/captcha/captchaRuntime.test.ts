import { describe, expect, it } from 'vitest'
import type { CaptchaSettingsStored } from '../../shared/captchaSettings'
import {
  buildCaptchaBrowserRuntimeState,
  resolveCaptchaRuntimeSnapshot
} from './captchaRuntime'

function settings(): CaptchaSettingsStored {
  return {
    defaultProvider: 'omocaptcha',
    providers: {
      omocaptcha: { enabled: true, apiKey: ' omo-secret-key ' },
      ezcaptcha: { enabled: false, apiKey: 'ez-secret-key' },
      '2captcha': { enabled: true, apiKey: 'two-secret-key' }
    }
  }
}

describe('captcha runtime resolver', () => {
  it('uses only the enabled default provider and keeps plaintext out of the revision', () => {
    const snapshot = resolveCaptchaRuntimeSnapshot(settings())
    expect(snapshot.provider).toBe('omocaptcha')
    expect(snapshot.apiKey).toBe('omo-secret-key')
    expect(snapshot.revision).toHaveLength(64)
    expect(snapshot.revision).not.toContain('omo-secret-key')
  })

  it('returns disabled state without a usable default provider/key', () => {
    const noDefault = settings()
    noDefault.defaultProvider = null
    expect(resolveCaptchaRuntimeSnapshot(noDefault)).toEqual({
      provider: null,
      apiKey: null,
      revision: 'disabled'
    })

    const disabled = settings()
    disabled.providers.omocaptcha.enabled = false
    expect(resolveCaptchaRuntimeSnapshot(disabled).provider).toBeNull()

    const missingKey = settings()
    missingKey.providers.omocaptcha.apiKey = ''
    expect(resolveCaptchaRuntimeSnapshot(missingKey).provider).toBeNull()
  })

  it('builds one managed provider directory under the app extension root', () => {
    const runtime = buildCaptchaBrowserRuntimeState(
      resolveCaptchaRuntimeSnapshot(settings()),
      'C:\\PageAuto\\captcha-extensions'
    )
    expect(runtime.active?.provider).toBe('omocaptcha')
    expect(runtime.active?.extensionDirectory.toLowerCase()).toContain('omocaptcha')
    expect(runtime.active?.extensionDirectory).not.toContain('omo-secret-key')
  })
})
