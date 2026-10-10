import type { ScanFieldMap } from '../../../shared/scanner'

const NON_PAGE_SURFACES = new Set([
  'bookmarks', 'events', 'friends', 'gaming', 'groups', 'help', 'home.php', 'login', 'marketplace',
  'messages', 'notifications', 'pages', 'photo', 'photos', 'profile.php', 'reel', 'search', 'settings',
  'share', 'story.php', 'watch'
])

export interface PageDirectTarget {
  raw: string
  url: string
  uid: string | null
}

export type PageScanMode =
  | { kind: 'direct'; targets: PageDirectTarget[] }
  | { kind: 'keyword'; keyword: string }

export interface PageScanFilterableRecord {
  followers: number | null
  likes: number | null
  category: string | null
  location: string | null
}

function isFacebookHost(hostname: string): boolean {
  const host = hostname.toLocaleLowerCase()
  return host === 'facebook.com' || host.endsWith('.facebook.com')
}

export function pageUidFromHref(value: string): string | null {
  try {
    const url = new URL(value, 'https://www.facebook.com/')
    if (!isFacebookHost(url.hostname)) return null
    if (url.pathname.toLocaleLowerCase() === '/profile.php') {
      const id = url.searchParams.get('id')?.trim() ?? ''
      return /^\d+$/.test(id) ? id : null
    }
    const firstSegment = decodeURIComponent(url.pathname.split('/').filter(Boolean)[0] ?? '').trim()
    return /^\d+$/.test(firstSegment) ? firstSegment : null
  } catch {
    return null
  }
}

export function pageUsernameFromHref(value: string): string | null {
  try {
    const url = new URL(value, 'https://www.facebook.com/')
    if (!isFacebookHost(url.hostname)) return null
    const firstSegment = decodeURIComponent(url.pathname.split('/').filter(Boolean)[0] ?? '').trim()
    if (!firstSegment || /^\d+$/.test(firstSegment) || NON_PAGE_SURFACES.has(firstSegment.toLocaleLowerCase())) return null
    return firstSegment
  } catch {
    return null
  }
}

export function normalizePageUrl(value: string): string | null {
  const raw = value.trim()
  if (!raw) return null
  if (/^\d+$/.test(raw)) return `https://www.facebook.com/${raw}/`
  const href = /^(?:www\.)?facebook\.com\//i.test(raw) ? `https://${raw}` : raw
  try {
    const url = new URL(href)
    if (!isFacebookHost(url.hostname)) return null
    const uid = pageUidFromHref(url.toString())
    if (url.pathname.toLocaleLowerCase() === '/profile.php' && uid) {
      return `https://www.facebook.com/profile.php?id=${encodeURIComponent(uid)}`
    }
    const parts = url.pathname.split('/').filter(Boolean)
    if (!parts.length) return null
    const first = decodeURIComponent(parts[0] ?? '').trim()
    if (!first || NON_PAGE_SURFACES.has(first.toLocaleLowerCase())) return null
    return `https://www.facebook.com/${encodeURIComponent(first)}/`
  } catch {
    return null
  }
}

function directTarget(value: string): PageDirectTarget | null {
  const raw = value.trim()
  if (!raw) return null
  const url = normalizePageUrl(raw)
  if (!url) return null
  return { raw, url, uid: pageUidFromHref(url) }
}

export function parsePageScanQuery(query: string): PageScanMode {
  const lines = query.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (!lines.length) return { kind: 'keyword', keyword: '' }
  const direct = lines.map(directTarget)
  if (direct.every((value): value is PageDirectTarget => Boolean(value))) {
    const seen = new Set<string>()
    return {
      kind: 'direct',
      targets: direct.filter((target) => {
        const key = (target.uid ?? target.url).toLocaleLowerCase()
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
    }
  }
  return { kind: 'keyword', keyword: query.trim() }
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

function extractLabeledCount(text: string, label: RegExp): number | null {
  const match = text.match(new RegExp(`(\\d[\\d.,]*)\\s*([kKmM])?\\s*(?:${label.source})`, 'i'))
  if (!match?.[1]) return null
  return compactNumber(match[1], match[2])
}

export function extractPageFollowerCount(text: string): number | null {
  return extractLabeledCount(text, /followers?|người theo dõi/)
}

export function extractPageLikeCount(text: string): number | null {
  return extractLabeledCount(text, /likes?|lượt thích/)
}

export function hasTemporaryPageRestriction(text: string): boolean {
  return /(?:temporarily (?:blocked|restricted)|tạm thời (?:bị )?(?:chặn|hạn chế)|tài khoản của bạn hiện bị hạn chế)/i.test(text)
}

export function scanJobStatusFromFacebookAccess(result: { status: string; code?: string }): 'failed' | 'needs_attention' {
  return result.status === 'needs_login' || result.code === 'verification_required'
    ? 'needs_attention'
    : 'failed'
}

function filterNumber(filters: ScanFieldMap, key: string): number | null {
  const value = filters[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function filterString(filters: ScanFieldMap, key: string): string {
  const value = filters[key]
  return typeof value === 'string' ? value.trim().toLocaleLowerCase() : ''
}

export function pageRecordMatchesFilters(record: PageScanFilterableRecord, filters: ScanFieldMap): boolean {
  const followersMin = Math.max(0, filterNumber(filters, 'followersMin') ?? 0)
  const followersMax = Math.max(0, filterNumber(filters, 'followersMax') ?? 0)
  const likesMin = Math.max(0, filterNumber(filters, 'likesMin') ?? 0)
  const likesMax = Math.max(0, filterNumber(filters, 'likesMax') ?? 0)
  if (followersMin > 0 && (record.followers === null || record.followers < followersMin)) return false
  if (followersMax > 0 && (record.followers === null || record.followers > followersMax)) return false
  if (likesMin > 0 && (record.likes === null || record.likes < likesMin)) return false
  if (likesMax > 0 && (record.likes === null || record.likes > likesMax)) return false

  const category = filterString(filters, 'category')
  if (category && !record.category?.toLocaleLowerCase().includes(category)) return false
  const location = filterString(filters, 'location')
  if (location && !record.location?.toLocaleLowerCase().includes(location)) return false
  return true
}
