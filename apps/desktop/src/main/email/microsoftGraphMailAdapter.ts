import type { MailMessageSnapshot } from './verificationCodeParser'

interface GraphMessage {
  id?: string
  receivedDateTime?: string
  subject?: string
  bodyPreview?: string
  body?: { content?: string; contentType?: string }
  from?: { emailAddress?: { address?: string; name?: string } }
}

interface GraphMessagesResponse {
  value?: GraphMessage[]
}

function htmlToText(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

function toSnapshot(message: GraphMessage): MailMessageSnapshot | null {
  const id = message.id?.trim()
  const receivedAt = Date.parse(message.receivedDateTime ?? '')
  if (!id || !Number.isFinite(receivedAt)) return null
  const address = message.from?.emailAddress?.address?.trim() ?? ''
  const name = message.from?.emailAddress?.name?.trim() ?? ''
  const content = message.body?.content ?? ''
  return {
    id,
    receivedAt,
    sender: name && address ? `${name} <${address}>` : (address || name),
    subject: message.subject?.trim() ?? '',
    bodyPreview: message.bodyPreview?.trim() ?? '',
    bodyText: message.body?.contentType?.toLowerCase() === 'html' ? htmlToText(content) : content.trim()
  }
}

export class MicrosoftGraphMailAdapter {
  async listRecentMessages(accessToken: string, limit = 25): Promise<MailMessageSnapshot[]> {
    const top = Math.max(1, Math.min(50, Math.trunc(limit)))
    const params = new URLSearchParams({
      '$top': String(top),
      '$select': 'id,receivedDateTime,subject,from,bodyPreview,body',
      '$orderby': 'receivedDateTime desc'
    })
    const response = await fetch(`https://graph.microsoft.com/v1.0/me/messages?${params.toString()}`, {
      headers: {
        authorization: `Bearer ${accessToken}`,
        prefer: 'outlook.body-content-type="text"'
      }
    })
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error('Microsoft OAuth token hết hạn hoặc thiếu quyền Mail.Read.')
      throw new Error(`Microsoft Graph mail error (${response.status}).`)
    }
    const payload = await response.json() as GraphMessagesResponse
    return (payload.value ?? []).map(toSnapshot).filter((item): item is MailMessageSnapshot => item !== null)
  }
}
