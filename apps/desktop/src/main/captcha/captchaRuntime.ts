import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import type { CaptchaProviderId, CaptchaSettingsStored } from '../../shared/captchaSettings'

export interface CaptchaRuntimeSnapshot {
  provider: CaptchaProviderId | null
  apiKey: string | null
  revision: string
}

export interface CaptchaProviderRuntimeConfig {
  provider: CaptchaProviderId
  apiKey: string
  extensionDirectory: string
}

export interface CaptchaBrowserRuntimeState {
  revision: string
  managedExtensionRoot: string
  active: CaptchaProviderRuntimeConfig | null
}

export function resolveCaptchaRuntimeSnapshot(settings: CaptchaSettingsStored): CaptchaRuntimeSnapshot {
  const provider = settings.defaultProvider
  if (!provider) return { provider: null, apiKey: null, revision: 'disabled' }

  const config = settings.providers[provider]
  const apiKey = config.enabled ? config.apiKey.trim() : ''
  if (!apiKey) return { provider: null, apiKey: null, revision: 'disabled' }

  const revision = createHash('sha256')
    .update(provider)
    .update('\0')
    .update(apiKey)
    .digest('hex')

  return { provider, apiKey, revision }
}

export function buildCaptchaBrowserRuntimeState(
  snapshot: CaptchaRuntimeSnapshot,
  extensionRoot: string
): CaptchaBrowserRuntimeState {
  const managedExtensionRoot = resolve(extensionRoot)
  return {
    revision: snapshot.revision,
    managedExtensionRoot,
    active: snapshot.provider && snapshot.apiKey
      ? {
          provider: snapshot.provider,
          apiKey: snapshot.apiKey,
          extensionDirectory: join(managedExtensionRoot, snapshot.provider)
        }
      : null
  }
}
