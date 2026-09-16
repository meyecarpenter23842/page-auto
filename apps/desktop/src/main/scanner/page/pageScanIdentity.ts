export function pageUidFromAppLink(value: string | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol.toLocaleLowerCase() !== 'fb:' || url.hostname.toLocaleLowerCase() !== 'page') return null
    const queryId = url.searchParams.get('id')?.trim() ?? ''
    if (/^\d+$/.test(queryId)) return queryId
    const pathId = decodeURIComponent(url.pathname.split('/').filter(Boolean)[0] ?? '').trim()
    return /^\d+$/.test(pathId) ? pathId : null
  } catch {
    return null
  }
}

export function requireVerifiedPageUid(requestedUid: string | null, verifiedUid: string | null): string {
  const verified = verifiedUid?.trim() ?? ''
  if (!/^\d+$/.test(verified)) {
    throw new Error('Không xác minh được Page UID số từ Page-specific identity evidence.')
  }
  const requested = requestedUid?.trim() ?? ''
  if (requested && requested !== verified) {
    throw new Error(`Không xác minh được Page UID: Page đã tải UID ${verified} không khớp UID yêu cầu ${requested}.`)
  }
  return verified
}
