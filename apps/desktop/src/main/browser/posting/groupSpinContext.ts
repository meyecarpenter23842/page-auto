export function groupTargetNameFromFacebookTitle(title: string): string | null {
  const normalized = title.trim().replace(/\s+/g, ' ')
  if (!normalized) return null

  const withoutNotificationCount = normalized.replace(/^\(\d+\)\s*/, '')
  const groupName = withoutNotificationCount
    .replace(/\s*(?:\||·)\s*Facebook(?:\s+Groups)?\s*$/i, '')
    .trim()

  if (!groupName || /^Facebook(?:\s+Groups)?$/i.test(groupName)) return null
  if (/^(?:log in|facebook\s*[-–—]\s*log in|đăng nhập)(?:\b|\s)/i.test(groupName)) return null
  return groupName
}
