export function isMicrosoftAccountHostUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.hostname.toLowerCase() === 'account.microsoft.com'
  } catch {
    return false
  }
}

export function isMicrosoftSecurityHubUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.hostname.toLowerCase() === 'account.microsoft.com'
      && url.pathname.toLowerCase().startsWith('/security')
  } catch {
    return false
  }
}

export function isMicrosoftSignInManagementUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.hostname.toLowerCase() === 'account.live.com'
      && url.pathname.toLowerCase().includes('/proofs/manage')
  } catch {
    return false
  }
}

export function isMicrosoftPasswordChangeUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.hostname.toLowerCase() === 'account.live.com'
      && /\/(client\/)?password\/change/i.test(url.pathname)
  } catch {
    return false
  }
}

export function isMicrosoftFidoCreateUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.hostname.toLowerCase() === 'login.microsoft.com'
      && url.pathname.toLowerCase().includes('/consumers/fido/create')
  } catch {
    return false
  }
}
