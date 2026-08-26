import type { EmailCodeProvider } from '../../shared/emailCode'

let currentProvider: EmailCodeProvider | null = null

export function setEmailCodeProvider(provider: EmailCodeProvider): void {
  currentProvider = provider
}

export function getEmailCodeProvider(): EmailCodeProvider | null {
  return currentProvider
}

export function clearEmailCodeProvider(provider?: EmailCodeProvider): void {
  if (!provider || currentProvider === provider) currentProvider = null
}
