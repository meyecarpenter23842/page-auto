export type EmailBrowserCommandKind = 'open-mail' | 'recovery-action' | 'password-action'

export interface EmailBrowserLaunchPolicy {
  ignoreDefaultArgs: string[]
}

/**
 * Microsoft Account Security is more sensitive to Chrome's automation UI contract
 * than normal Outlook mail opening. Keep the launch decision isolated so normal
 * Email "Mở mail" retains its existing behavior.
 *
 * This mirrors the existing Page-Auto browser runtime policy that removes only
 * Playwright's --enable-automation default. Remote debugging / normal browser
 * security stay enabled.
 */
export function emailBrowserLaunchPolicy(kind: EmailBrowserCommandKind): EmailBrowserLaunchPolicy {
  return kind === 'open-mail'
    ? { ignoreDefaultArgs: [] }
    : { ignoreDefaultArgs: ['--enable-automation'] }
}
