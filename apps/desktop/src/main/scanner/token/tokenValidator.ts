import type { ScannerTokenValidationState } from '../../../shared/scanner'

export const SCANNER_META_GRAPH_API_VERSION = 'v26.0'
const META_GRAPH_ME_URL = `https://graph.facebook.com/${SCANNER_META_GRAPH_API_VERSION}/me?fields=id,name`
const VALIDATION_TIMEOUT_MS = 15_000

export interface ScannerTokenValidationResult {
  state: ScannerTokenValidationState
  message: string | null
  subjectId: string | null
  subjectName: string | null
}

export interface ScannerTokenValidatorLike {
  validate(accessToken: string): Promise<ScannerTokenValidationResult>
}

export type ScannerTokenFetch = (input: string, init?: RequestInit) => Promise<Response>

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function safeString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

async function responseJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    return recordValue(await response.json())
  } catch {
    return null
  }
}

export async function classifyMetaGraphTokenResponse(response: Response): Promise<ScannerTokenValidationResult> {
  const payload = await responseJson(response)
  if (response.ok) {
    const subjectId = safeString(payload?.id)
    if (!subjectId) {
      return {
        state: 'invalid',
        message: 'Meta Graph trả về phản hồi không có subject ID.',
        subjectId: null,
        subjectName: null
      }
    }
    return {
      state: 'valid',
      message: 'Đã xác minh token với /me; quyền cho từng nghiệp vụ quét sẽ được kiểm tra riêng khi adapter token production được mở.',
      subjectId,
      subjectName: safeString(payload?.name)
    }
  }

  const graphError = recordValue(payload?.error)
  const code = finiteNumber(graphError?.code)
  const subcode = finiteNumber(graphError?.error_subcode)

  if (code === 190 && subcode === 463) {
    return {
      state: 'expired',
      message: 'Access Token đã hết hạn và cần được cấp lại bằng luồng được hỗ trợ.',
      subjectId: null,
      subjectName: null
    }
  }
  if (code === 190 || response.status === 401) {
    return {
      state: 'needs_reauth',
      message: 'Access Token không còn xác thực được; cần cấp lại bằng luồng được hỗ trợ.',
      subjectId: null,
      subjectName: null
    }
  }
  if (code === 10 || code === 200 || response.status === 403) {
    return {
      state: 'permission_limited',
      message: 'Token xác thực nhưng quyền hiện tại không đủ cho yêu cầu kiểm tra này.',
      subjectId: null,
      subjectName: null
    }
  }
  if (response.status === 429 || (code !== null && [4, 17, 32].includes(code))) {
    return {
      state: 'unverified',
      message: 'Meta đang giới hạn tần suất; chưa thay đổi kết luận hiệu lực của token.',
      subjectId: null,
      subjectName: null
    }
  }
  if (response.status >= 500) {
    return {
      state: 'unverified',
      message: 'Meta Graph tạm thời không khả dụng; có thể xác minh lại sau.',
      subjectId: null,
      subjectName: null
    }
  }
  return {
    state: 'invalid',
    message: 'Access Token không hợp lệ với endpoint kiểm tra hiện tại.',
    subjectId: null,
    subjectName: null
  }
}

export class MetaGraphScannerTokenValidator implements ScannerTokenValidatorLike {
  constructor(private readonly fetchImpl: ScannerTokenFetch = (input, init) => fetch(input, init)) {}

  async validate(accessToken: string): Promise<ScannerTokenValidationResult> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), VALIDATION_TIMEOUT_MS)
    try {
      const response = await this.fetchImpl(META_GRAPH_ME_URL, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        signal: controller.signal
      })
      return classifyMetaGraphTokenResponse(response)
    } catch {
      return {
        state: 'unverified',
        message: 'Không thể kết nối Meta Graph để xác minh token lúc này.',
        subjectId: null,
        subjectName: null
      }
    } finally {
      clearTimeout(timer)
    }
  }
}
