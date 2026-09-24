import { EMAIL_RECOVERY_PROVIDERS } from '../../../shared/emailRecoveryProviders'
import type { HotmailSecurityAction } from '../../../shared/emailCombo'

export type HotmailSecurityPreset = 'add' | 'remove' | 'password' | 'combo'

export const HOTMAIL_SECURITY_RECOVERY_PROVIDERS = [
  {
    id: 'inboxes',
    label: 'Inboxes',
    domains: EMAIL_RECOVERY_PROVIDERS.find((provider) => provider.id === 'inboxes')?.domains ?? []
  },
  {
    id: 'fviainboxes',
    label: 'Fvia',
    domains: EMAIL_RECOVERY_PROVIDERS.find((provider) => provider.id === 'fviainboxes')?.domains ?? []
  }
] as const

export function hotmailSecurityPresetActions(preset: HotmailSecurityPreset): HotmailSecurityAction[] {
  if (preset === 'add') return ['add_recovery']
  if (preset === 'remove') return ['remove_recovery']
  if (preset === 'password') return ['password']
  return ['add_recovery', 'remove_recovery', 'password']
}

export function buildHotmailRecoveryAddress(
  primaryEmail: string | null | undefined,
  suffix: string,
  domain: string
): string | null {
  const normalized = primaryEmail?.trim().toLowerCase() ?? ''
  const at = normalized.lastIndexOf('@')
  const cleanDomain = domain.trim().toLowerCase()
  const cleanSuffix = suffix.trim()
  if (at < 1 || !cleanDomain || !cleanSuffix) return null
  const local = normalized.slice(0, at)
  if (!/^[a-z0-9._%+-]+$/i.test(local)) return null
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(cleanDomain)) return null
  if (/[@\s]/.test(cleanSuffix)) return null
  return `${local}${cleanSuffix}@${cleanDomain}`
}
