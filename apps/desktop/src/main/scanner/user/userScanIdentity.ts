export function userUidFromAppLink(value: string | null | undefined): string | null {
  const source = value?.trim() ?? ''
  if (!source) return null
  const match = source.match(/^fb:\/\/profile(?:\/(\d+)|\/?\?id=(\d+))(?:[/?&#]|$)/i)
  return match?.[1] ?? match?.[2] ?? null
}

export function requireVerifiedUserUid(requestedUid: string | null, loadedUid: string | null): string {
  if (!loadedUid) {
    throw new Error('Không xác minh được UID người dùng từ metadata profile Facebook.')
  }
  if (requestedUid && requestedUid !== loadedUid) {
    throw new Error(`UID profile đã tải (${loadedUid}) không khớp UID yêu cầu (${requestedUid}).`)
  }
  return loadedUid
}
