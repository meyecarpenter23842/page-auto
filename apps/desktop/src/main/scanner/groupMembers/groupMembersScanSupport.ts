export interface GroupMembersTarget {
  raw: string
  groupId: string
  membersUrl: string
}

export interface GroupMemberIdentity {
  groupId: string
  memberUid: string
}

function isFacebookHost(hostname: string): boolean {
  const host = hostname.toLocaleLowerCase()
  return host === 'facebook.com' || host.endsWith('.facebook.com')
}

export function groupIdFromFacebookUrl(value: string): string | null {
  try {
    const url = new URL(value, 'https://www.facebook.com/')
    if (!isFacebookHost(url.hostname)) return null
    const parts = url.pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part).trim())
    if ((parts[0] ?? '').toLocaleLowerCase() !== 'groups') return null
    const groupId = parts[1] ?? ''
    return groupId && !['discover', 'feed', 'joins', 'notifications', 'search'].includes(groupId.toLocaleLowerCase())
      ? groupId
      : null
  } catch {
    return null
  }
}

export function groupMembersUrl(groupId: string): string {
  return `https://www.facebook.com/groups/${encodeURIComponent(groupId.trim())}/members`
}

export function groupMembersTargetFromValue(value: string): GroupMembersTarget | null {
  const raw = value.trim()
  if (!raw) return null
  if (/^\d+$/.test(raw)) return { raw, groupId: raw, membersUrl: groupMembersUrl(raw) }
  const href = /^(?:www\.)?facebook\.com\//i.test(raw) ? `https://${raw}` : raw
  const groupId = groupIdFromFacebookUrl(href)
  return groupId ? { raw, groupId, membersUrl: groupMembersUrl(groupId) } : null
}

export function parseGroupMembersTargets(query: string): GroupMembersTarget[] {
  const lines = query.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (!lines.length) return []
  const targets = lines.map(groupMembersTargetFromValue)
  if (!targets.every((target): target is GroupMembersTarget => Boolean(target))) {
    throw new Error('Thành viên nhóm chỉ hỗ trợ Group UID hoặc URL Group, mỗi dòng một Group.')
  }
  const seen = new Set<string>()
  return targets.filter((target) => {
    const key = target.groupId.toLocaleLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function groupMemberIdentityFromHref(value: string, expectedGroupId?: string | null): GroupMemberIdentity | null {
  try {
    const url = new URL(value, 'https://www.facebook.com/')
    if (!isFacebookHost(url.hostname)) return null
    const parts = url.pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part).trim())
    if ((parts[0] ?? '').toLocaleLowerCase() !== 'groups') return null
    const groupId = parts[1] ?? ''
    if (!groupId || (parts[2] ?? '').toLocaleLowerCase() !== 'user') return null
    const memberUid = parts[3] ?? ''
    if (!/^\d+$/.test(memberUid)) return null
    const expected = expectedGroupId?.trim() ?? ''
    if (expected && groupId !== expected) return null
    return { groupId, memberUid }
  } catch {
    return null
  }
}

export function userProfileUrlFromUid(uid: string): string {
  return `https://www.facebook.com/profile.php?id=${encodeURIComponent(uid.trim())}`
}

export function hasGroupMembersPermissionBlock(text: string): boolean {
  return /(?:join this group to see|you (?:must|need to) join (?:this )?group|only members can see|this content isn't available|content isn't available right now|hãy tham gia nhóm|cần tham gia nhóm|chỉ thành viên.*(?:xem|thấy)|nội dung này hiện không (?:hiển thị|khả dụng))/i.test(text)
}

export function normalizeGroupMemberName(value: string | null | undefined, uid: string): string {
  const text = value?.replace(/\s+/g, ' ').trim() ?? ''
  if (!text || text.length > 120) return uid
  if (/^(?:follow|following|add friend|message|admin|moderator)$/i.test(text)) return uid
  return text
}
