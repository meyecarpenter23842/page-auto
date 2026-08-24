import type { HotmailActionItemResult } from '../../shared/hotmail'
import type { HotmailRepository } from '../database/hotmailRepository'
import type { MicrosoftOAuthService } from './microsoftOAuthService'
import { parseVerificationCode, type MailCandidate } from './verificationCodeParser'

interface GraphMessage {
  id?: unknown
  subject?: unknown
  receivedDateTime?: unknown
  bodyPreview?: unknown
  body?: { content?: unknown } | null
  from?: { emailAddress?: { address?: unknown } | null } | null
}

interface GraphListResponse {
  value?: unknown
}

function graphMessageToCandidate(value: GraphMessage): MailCandidate | null {
  if (typeof value.id !== 'string') return null
  const receivedAt = typeof value.receivedDateTime === 'string' ? Date.parse(value.receivedDateTime) : Number.NaN
  if (!Number.isFinite(receivedAt)) return null
  const bodyContent = value.body && typeof value.body.content === 'string' ? value.body.content : ''
  const preview = typeof value.bodyPreview === 'string' ? value.bodyPreview : ''
  return {
    id: value.id,
    sender: value.from?.emailAddress && typeof value.from.emailAddress.address === 'string' ? value.from.emailAddress.address : '',
    subject: typeof value.subject === 'string' ? value.subject : '',
    receivedAt,
    body: `${preview}\n${bodyContent}`
  }
}

export class MailReadService {
  constructor(
    private readonly repository: HotmailRepository,
    private readonly oauth: MicrosoftOAuthService
  ) {}

  async check(accountId: number): Promise<HotmailActionItemResult> {
    try {
      await this.listMessages(accountId)
      const now = Date.now()
      this.repository.setMailState(accountId, 'ready', now, null, null, null)
      return { accountId, ok: true, code: null, message: 'Mailbox đọc được bằng Microsoft Graph.' }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.repository.setMailState(accountId, 'error', Date.now(), null, null, message)
      return { accountId, ok: false, code: null, message }
    }
  }

  async getCode(accountId: number): Promise<HotmailActionItemResult> {
    try {
      const messages = await this.listMessages(accountId)
      const match = parseVerificationCode(messages)
      const now = Date.now()
      if (!match) {
        this.repository.setMailState(accountId, 'ready', now, null, null, null)
        return { accountId, ok: true, code: null, message: 'Đọc mail thành công nhưng chưa thấy mã xác minh mới trong 24 giờ.' }
      }
      this.repository.setMailState(accountId, 'ready', now, match.code, match.receivedAt, null)
      return { accountId, ok: true, code: match.code, message: `Đã lấy code ${match.code} từ mail phù hợp nhất.` }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.repository.setMailState(accountId, 'error', Date.now(), null, null, message)
      return { accountId, ok: false, code: null, message }
    }
  }

  private async listMessages(accountId: number): Promise<MailCandidate[]> {
    const token = await this.oauth.getAccessToken(accountId)
    const query = new URLSearchParams({
      '$top': '25',
      '$select': 'id,subject,from,receivedDateTime,bodyPreview,body',
      '$orderby': 'receivedDateTime desc'
    })
    const response = await fetch(`https://graph.microsoft.com/v1.0/me/messages?${query.toString()}`, {
      headers: {
        authorization: `Bearer ${token}`,
        prefer: 'outlook.body-content-type="text"'
      },
      signal: AbortSignal.timeout(30_000)
    })
    if (!response.ok) throw new Error(`Microsoft Graph đọc mail thất bại (HTTP ${response.status}).`)
    const payload = await response.json() as GraphListResponse
    if (!Array.isArray(payload.value)) throw new Error('Microsoft Graph trả mailbox payload không hợp lệ.')
    return payload.value
      .filter((item): item is GraphMessage => typeof item === 'object' && item !== null)
      .map(graphMessageToCandidate)
      .filter((item): item is MailCandidate => item !== null)
  }
}
