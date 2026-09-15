import type { ScanFieldMap } from '../../../shared/scanner'

const NON_GROUP_SURFACES = new Set(['discover', 'feed', 'joins', 'notifications', 'search'])

export type GroupScanPrivacy = 'Public' | 'Private' | null
export type GroupScanMode =
  | { kind: 'direct'; targets: string[] }
  | { kind: 'keyword'; keyword: string }

export function hasTemporaryGroupRestriction(text: string): boolean {
  return /(?:temporarily (?:blocked|restricted)|tạm thời (?:bị )?(?:chặn|hạn chế)|tài khoản của bạn hiện bị hạn chế)/i.test(text)
}

export function scanJobStatusFromFacebookAccess(result: { status: string; code?: string }): 'failed' | 'needs_attention' {
  return result.status === 'needs_login' || result.code === 'verification_required'
    ? 'needs_attention'
    : 'failed'
}

export interface GroupScanFilterableRecord {
  members: number | null
  privacy: GroupScanPrivacy
  rawText: string
}

export function groupIdentityFromHref(value: string): string | null {
  try {
    const url = new URL(value, 'https://www.facebook.com')
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts[0]?.toLocaleLowerCase() !== 'groups' || !parts[1]) return null
    const identity = decodeURIComponent(parts[1]).trim()
    if (!identity || NON_GROUP_SURFACES.has(identity.toLocaleLowerCase())) return null
    return identity
  } catch {
    return null
  }
}

export function normalizeGroupUrl(identity: string): string {
  return `https://www.facebook.com/groups/${encodeURIComponent(identity.trim())}/`
}

function directIdentity(value: string): string | null {
  const raw = value.trim()
  if (!raw) return null
  const href = /^(?:www\.)?facebook\.com\//i.test(raw) ? `https://${raw}` : raw
  const fromUrl = groupIdentityFromHref(href)
  if (fromUrl) return fromUrl
  return /^\d+$/.test(raw) ? raw : null
}

export function parseGroupScanQuery(query: string): GroupScanMode {
  const lines = query.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (!lines.length) return { kind: 'keyword', keyword: '' }

  const direct = lines.map(directIdentity)
  if (direct.every((value): value is string => Boolean(value))) {
    const seen = new Set<string>()
    return {
      kind: 'direct',
      targets: direct.filter((value) => {
        const key = value.toLocaleLowerCase()
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

export function extractGroupMemberCount(text: string): number | null {
  const match = text.match(/(\d[\d.,]*)\s*([kKmM])?\s*(?:members?|thành viên)/i)
  if (!match?.[1]) return null
  return compactNumber(match[1], match[2])
}

export function detectGroupPrivacy(text: string): GroupScanPrivacy {
  if (/(?:\bpublic\b|công khai|\bopen\b)/i.test(text)) return 'Public'
  if (/(?:\bprivate\b|riêng tư|\bclosed\b|\bsecret\b|bí mật)/i.test(text)) return 'Private'
  return null
}

function filterNumber(filters: ScanFieldMap, key: string): number | null {
  const value = filters[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function filterString(filters: ScanFieldMap, key: string): string {
  const value = filters[key]
  return typeof value === 'string' ? value.trim() : ''
}

export function groupRecordMatchesFilters(record: GroupScanFilterableRecord, filters: ScanFieldMap): boolean {
  const minimum = Math.max(0, filterNumber(filters, 'membersMin') ?? 0)
  const maximum = Math.max(0, filterNumber(filters, 'membersMax') ?? 0)
  if (minimum > 0 && (record.members === null || record.members < minimum)) return false
  if (maximum > 0 && (record.members === null || record.members > maximum)) return false

  const privacy = filterString(filters, 'privacy').toLocaleLowerCase()
  if (privacy === 'public' && record.privacy !== 'Public') return false
  if (privacy === 'private' && record.privacy !== 'Private') return false

  const location = filterString(filters, 'location').toLocaleLowerCase()
  if (location && !record.rawText.toLocaleLowerCase().includes(location)) return false
  return true
}
