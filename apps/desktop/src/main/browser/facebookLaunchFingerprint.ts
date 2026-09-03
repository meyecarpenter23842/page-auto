import { createHash } from 'node:crypto'

interface FacebookLaunchProxy {
  server: string
  username?: string
  password?: string
}

export interface FacebookLaunchFingerprintSource {
  profileDirectory: string
  userAgent?: string | null
  proxy?: FacebookLaunchProxy | null
}

function normalized(value: string | null | undefined): string | null {
  const text = value?.trim()
  return text ? text : null
}

/**
 * Browser launch options are immutable after Chrome starts. Keep only a digest in
 * worker registries so a proxy password is never retained/logged as a comparison key.
 */
export function facebookLaunchFingerprint(source: FacebookLaunchFingerprintSource): string {
  const payload = JSON.stringify({
    profileDirectory: source.profileDirectory,
    userAgent: normalized(source.userAgent),
    proxy: source.proxy
      ? {
          server: normalized(source.proxy.server),
          username: normalized(source.proxy.username),
          password: source.proxy.password ?? null
        }
      : null
  })
  return createHash('sha256').update(payload).digest('hex')
}

export type FacebookLaunchReuseDecision = 'reuse' | 'replace' | 'busy'

export function facebookLaunchReuseDecision(
  currentFingerprint: string,
  nextFingerprint: string,
  busy: boolean
): FacebookLaunchReuseDecision {
  if (currentFingerprint === nextFingerprint) return 'reuse'
  return busy ? 'busy' : 'replace'
}
