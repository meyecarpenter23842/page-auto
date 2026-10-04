import type Database from 'better-sqlite3'
import {
  CAPTCHA_PROVIDER_IDS,
  DEFAULT_CAPTCHA_SETTINGS,
  type CaptchaProviderId,
  type CaptchaSettingsStored,
  type CaptchaSettingsView,
  type SaveCaptchaSettingsInput
} from '../../shared/captchaSettings'

const CAPTCHA_SETTINGS_KEY = 'captcha.providers.v1'

function cloneDefaults(): CaptchaSettingsStored {
  return {
    defaultProvider: DEFAULT_CAPTCHA_SETTINGS.defaultProvider,
    providers: {
      omocaptcha: { ...DEFAULT_CAPTCHA_SETTINGS.providers.omocaptcha },
      ezcaptcha: { ...DEFAULT_CAPTCHA_SETTINGS.providers.ezcaptcha },
      '2captcha': { ...DEFAULT_CAPTCHA_SETTINGS.providers['2captcha'] }
    }
  }
}

function isProviderId(value: unknown): value is CaptchaProviderId {
  return typeof value === 'string' && (CAPTCHA_PROVIDER_IDS as readonly string[]).includes(value)
}

function parseStored(raw: string | undefined): CaptchaSettingsStored {
  if (!raw) return cloneDefaults()
  try {
    const parsed = JSON.parse(raw) as Partial<CaptchaSettingsStored>
    const result = cloneDefaults()
    result.defaultProvider = isProviderId(parsed.defaultProvider) ? parsed.defaultProvider : null
    for (const providerId of CAPTCHA_PROVIDER_IDS) {
      const provider = parsed.providers?.[providerId]
      if (!provider || typeof provider !== 'object') continue
      result.providers[providerId] = {
        enabled: provider.enabled === true,
        apiKey: typeof provider.apiKey === 'string' ? provider.apiKey.trim() : ''
      }
    }
    if (result.defaultProvider && !result.providers[result.defaultProvider].enabled) {
      result.defaultProvider = null
    }
    return result
  } catch {
    return cloneDefaults()
  }
}

function maskApiKey(value: string): string | null {
  if (!value) return null
  if (value.length <= 8) return '••••••••'
  return `${value.slice(0, 4)}••••••${value.slice(-4)}`
}

function toView(stored: CaptchaSettingsStored): CaptchaSettingsView {
  return {
    defaultProvider: stored.defaultProvider,
    providers: {
      omocaptcha: {
        enabled: stored.providers.omocaptcha.enabled,
        configured: Boolean(stored.providers.omocaptcha.apiKey),
        maskedApiKey: maskApiKey(stored.providers.omocaptcha.apiKey)
      },
      ezcaptcha: {
        enabled: stored.providers.ezcaptcha.enabled,
        configured: Boolean(stored.providers.ezcaptcha.apiKey),
        maskedApiKey: maskApiKey(stored.providers.ezcaptcha.apiKey)
      },
      '2captcha': {
        enabled: stored.providers['2captcha'].enabled,
        configured: Boolean(stored.providers['2captcha'].apiKey),
        maskedApiKey: maskApiKey(stored.providers['2captcha'].apiKey)
      }
    }
  }
}

export class CaptchaSettingsRepository {
  constructor(private readonly client: Database.Database) {}

  private readStored(): CaptchaSettingsStored {
    const row = this.client
      .prepare('SELECT value FROM app_settings WHERE key = ?')
      .get(CAPTCHA_SETTINGS_KEY) as { value: string } | undefined
    return parseStored(row?.value)
  }

  get(): CaptchaSettingsView {
    return toView(this.readStored())
  }

  save(input: SaveCaptchaSettingsInput): CaptchaSettingsView {
    const current = this.readStored()
    const next = cloneDefaults()

    for (const providerId of CAPTCHA_PROVIDER_IDS) {
      const patch = input.providers[providerId]
      const currentApiKey = current.providers[providerId].apiKey
      next.providers[providerId] = {
        enabled: patch.enabled === true,
        apiKey: patch.clearApiKey === true
          ? ''
          : (typeof patch.apiKey === 'string' && patch.apiKey.trim() ? patch.apiKey.trim() : currentApiKey)
      }
    }

    next.defaultProvider = isProviderId(input.defaultProvider) && next.providers[input.defaultProvider].enabled
      ? input.defaultProvider
      : null

    this.client.prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value=excluded.value,
        updated_at=excluded.updated_at
    `).run(CAPTCHA_SETTINGS_KEY, JSON.stringify(next), Date.now())

    return toView(next)
  }
}
