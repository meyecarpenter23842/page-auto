import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { initializeDatabase } from './index'
import { CaptchaSettingsRepository } from './captchaSettingsRepository'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function createRepository() {
  const directory = mkdtempSync(join(tmpdir(), 'page-auto-captcha-settings-'))
  tempDirectories.push(directory)
  const runtime = initializeDatabase(join(directory, 'page-auto.sqlite'))
  return { runtime, repository: new CaptchaSettingsRepository(runtime.client) }
}

describe('CaptchaSettingsRepository', () => {
  it('stores provider configuration without returning plaintext API keys', () => {
    const { runtime, repository } = createRepository()

    const saved = repository.save({
      defaultProvider: 'omocaptcha',
      providers: {
        omocaptcha: { enabled: true, apiKey: 'omo-secret-123456789' },
        ezcaptcha: { enabled: false },
        '2captcha': { enabled: true, apiKey: 'two-secret-987654321' }
      }
    })

    expect(saved.defaultProvider).toBe('omocaptcha')
    expect(saved.providers.omocaptcha.configured).toBe(true)
    expect(saved.providers.omocaptcha.maskedApiKey).not.toContain('omo-secret')
    expect(JSON.stringify(saved)).not.toContain('omo-secret-123456789')

    const persisted = repository.get()
    expect(persisted.providers['2captcha'].configured).toBe(true)
    expect(JSON.stringify(persisted)).not.toContain('two-secret-987654321')

    runtime.close()
  })

  it('keeps an existing key when saving an empty draft and can clear it explicitly', () => {
    const { runtime, repository } = createRepository()

    repository.save({
      defaultProvider: 'ezcaptcha',
      providers: {
        omocaptcha: { enabled: false },
        ezcaptcha: { enabled: true, apiKey: 'existing-key-1234' },
        '2captcha': { enabled: false }
      }
    })

    const kept = repository.save({
      defaultProvider: 'ezcaptcha',
      providers: {
        omocaptcha: { enabled: false },
        ezcaptcha: { enabled: true, apiKey: '' },
        '2captcha': { enabled: false }
      }
    })
    expect(kept.providers.ezcaptcha.configured).toBe(true)

    const cleared = repository.save({
      defaultProvider: null,
      providers: {
        omocaptcha: { enabled: false },
        ezcaptcha: { enabled: false, clearApiKey: true },
        '2captcha': { enabled: false }
      }
    })
    expect(cleared.providers.ezcaptcha.configured).toBe(false)
    expect(cleared.defaultProvider).toBeNull()

    runtime.close()
  })
})
