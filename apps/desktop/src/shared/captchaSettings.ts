export const CAPTCHA_PROVIDER_IDS = ['omocaptcha', 'ezcaptcha', '2captcha'] as const
export type CaptchaProviderId = (typeof CAPTCHA_PROVIDER_IDS)[number]

export interface CaptchaProviderStoredConfig {
  enabled: boolean
  apiKey: string
}

export interface CaptchaSettingsStored {
  defaultProvider: CaptchaProviderId | null
  providers: Record<CaptchaProviderId, CaptchaProviderStoredConfig>
}

export interface CaptchaProviderView {
  enabled: boolean
  configured: boolean
  maskedApiKey: string | null
}

export interface CaptchaSettingsView {
  defaultProvider: CaptchaProviderId | null
  providers: Record<CaptchaProviderId, CaptchaProviderView>
}

export interface CaptchaProviderUpdate {
  enabled: boolean
  apiKey?: string
  clearApiKey?: boolean
}

export interface SaveCaptchaSettingsInput {
  defaultProvider: CaptchaProviderId | null
  providers: Record<CaptchaProviderId, CaptchaProviderUpdate>
}

export const DEFAULT_CAPTCHA_SETTINGS: CaptchaSettingsStored = {
  defaultProvider: null,
  providers: {
    omocaptcha: { enabled: false, apiKey: '' },
    ezcaptcha: { enabled: false, apiKey: '' },
    '2captcha': { enabled: false, apiKey: '' }
  }
}
