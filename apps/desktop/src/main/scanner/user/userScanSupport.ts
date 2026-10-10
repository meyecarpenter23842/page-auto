const NON_PROFILE_SURFACES = new Set([
  'bookmarks', 'events', 'friends', 'gaming', 'groups', 'help', 'home.php', 'login', 'marketplace',
  'messages', 'notifications', 'pages', 'permalink.php', 'photo', 'photos', 'profile.php', 'reel', 'reels',
  'search', 'settings', 'share', 'story.php', 'watch'
])

export interface UserDirectTarget {
  raw: string
  url: string
  uid: string | null
  username: string | null
}

function isFacebookHost(hostname: string): boolean {
  const host = hostname.toLocaleLowerCase()
  return host === 'facebook.com' || host.endsWith('.facebook.com')
}

export function userUidFromHref(value: string): string | null {
  try {
    const url = new URL(value, 'https://www.facebook.com/')
    if (!isFacebookHost(url.hostname)) return null
    if (url.pathname.toLocaleLowerCase() === '/profile.php') {
      const id = url.searchParams.get('id')?.trim() ?? ''
      return /^\d+$/.test(id) ? id : null
    }
    const segments = url.pathname.split('/').filter(Boolean).map((segment) => decodeURIComponent(segment).trim())
    if (/^\d+$/.test(segments[0] ?? '')) return segments[0] ?? null
    if ((segments[0] ?? '').toLocaleLowerCase() === 'people' && /^\d+$/.test(segments.at(-1) ?? '')) {
      return segments.at(-1) ?? null
    }
    return null
  } catch {
    return null
  }
}

export function userUsernameFromHref(value: string): string | null {
  try {
    const url = new URL(value, 'https://www.facebook.com/')
    if (!isFacebookHost(url.hostname)) return null
    if (url.pathname.toLocaleLowerCase() === '/profile.php') return null
    const firstSegment = decodeURIComponent(url.pathname.split('/').filter(Boolean)[0] ?? '').trim()
    if (!firstSegment || /^\d+$/.test(firstSegment) || NON_PROFILE_SURFACES.has(firstSegment.toLocaleLowerCase())) return null
    if (firstSegment.toLocaleLowerCase() === 'people') return null
    return firstSegment
  } catch {
    return null
  }
}

export function normalizeUserProfileUrl(value: string): string | null {
  const raw = value.trim()
  if (!raw) return null
  if (/^\d+$/.test(raw)) return `https://www.facebook.com/profile.php?id=${encodeURIComponent(raw)}`
  const href = /^(?:www\.)?facebook\.com\//i.test(raw) ? `https://${raw}` : raw
  try {
    const url = new URL(href)
    if (!isFacebookHost(url.hostname)) return null
    const uid = userUidFromHref(url.toString())
    if (url.pathname.toLocaleLowerCase() === '/profile.php' && uid) {
      return `https://www.facebook.com/profile.php?id=${encodeURIComponent(uid)}`
    }
    const parts = url.pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part).trim())
    if (!parts.length) return null
    if ((parts[0] ?? '').toLocaleLowerCase() === 'people' && uid) {
      return `https://www.facebook.com/profile.php?id=${encodeURIComponent(uid)}`
    }
    const first = parts[0] ?? ''
    if (!first || NON_PROFILE_SURFACES.has(first.toLocaleLowerCase())) return null
    return `https://www.facebook.com/${encodeURIComponent(first)}/`
  } catch {
    return null
  }
}

function directTarget(value: string): UserDirectTarget | null {
  const raw = value.trim()
  if (!raw) return null
  const url = normalizeUserProfileUrl(raw)
  if (!url) return null
  return {
    raw,
    url,
    uid: userUidFromHref(url),
    username: userUsernameFromHref(url)
  }
}

export function parseUserScanTargets(query: string): UserDirectTarget[] {
  const lines = query.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (!lines.length) return []
  const targets = lines.map(directTarget)
  if (!targets.every((target): target is UserDirectTarget => Boolean(target))) {
    throw new Error('Quét Người dùng chỉ hỗ trợ UID hoặc URL Profile, mỗi dòng một người dùng.')
  }
  const seen = new Set<string>()
  return targets.filter((target) => {
    const key = (target.uid ?? target.url).toLocaleLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function compactNumber(raw: string, suffix: string | undefined): number | null {
  const source = raw.trim().replace(/\s+/g, '')
  if (!source) return null
  let normalized = source
  if (suffix) {
    if (source.includes(',') && !source.includes('.')) normalized = source.replace(',', '.')
  } else {
    normalized = source.replace(/[.,](?=\d{3}(?:\D|$))/g, '')
  }
  const value = Number(normalized)
  if (!Number.isFinite(value)) return null
  const factor = suffix?.toLocaleLowerCase() === 'k'
    ? 1_000
    : suffix?.toLocaleLowerCase() === 'm'
      ? 1_000_000
      : 1
  return Math.round(value * factor)
}

export function extractUserFollowerCount(text: string): number | null {
  const match = text.match(/(\d[\d.,]*)\s*([kKmM])?\s*(?:followers?|người theo dõi)/i)
  if (!match?.[1]) return null
  return compactNumber(match[1], match[2])
}

export function hasTemporaryUserRestriction(text: string): boolean {
  return /(?:temporarily (?:blocked|restricted)|tạm thời (?:bị )?(?:chặn|hạn chế)|tài khoản của bạn hiện bị hạn chế)/i.test(text)
}

export function scanJobStatusFromFacebookAccess(result: { status: string; code?: string }): 'failed' | 'needs_attention' {
  return result.status === 'needs_login' || result.code === 'verification_required'
    ? 'needs_attention'
    : 'failed'
}
