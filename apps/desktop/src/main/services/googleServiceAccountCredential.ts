export interface GoogleServiceAccountCredential {
  type: 'service_account'
  projectId: string
  clientEmail: string
  privateKey: string
  tokenUri: string
  sourceFileName: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseGoogleServiceAccountJson(
  rawText: string,
  sourceFileName: string
): GoogleServiceAccountCredential {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawText) as unknown
  } catch {
    throw new Error('File Google Cloud credential không phải JSON hợp lệ.')
  }
  if (!isRecord(parsed)) {
    throw new Error('File credential phải là JSON object.')
  }

  if (parsed.type !== 'service_account') {
    if (
      typeof parsed.name === 'string'
      || typeof parsed.instructions === 'string'
      || typeof parsed.instruction === 'string'
    ) {
      throw new Error(
        'Đây có vẻ là file cấu hình Agent, không phải service-account JSON để kết nối Google Cloud.'
      )
    }
    throw new Error(
      'File này không phải Google Cloud service-account JSON (thiếu type = "service_account").'
    )
  }

  const projectId = typeof parsed.project_id === 'string' ? parsed.project_id.trim() : ''
  const clientEmail = typeof parsed.client_email === 'string' ? parsed.client_email.trim() : ''
  const privateKey = typeof parsed.private_key === 'string' ? parsed.private_key.trim() : ''
  const tokenUri = typeof parsed.token_uri === 'string' && parsed.token_uri.trim()
    ? parsed.token_uri.trim()
    : 'https://oauth2.googleapis.com/token'

  if (!projectId) throw new Error('Service account JSON thiếu project_id.')
  if (!clientEmail) throw new Error('Service account JSON thiếu client_email.')
  if (!privateKey.includes('BEGIN PRIVATE KEY')) {
    throw new Error('Service account JSON thiếu private_key hợp lệ.')
  }
  if (!tokenUri.startsWith('https://')) {
    throw new Error('Service account JSON có token_uri không hợp lệ.')
  }

  return {
    type: 'service_account',
    projectId,
    clientEmail,
    privateKey,
    tokenUri,
    sourceFileName
  }
}
