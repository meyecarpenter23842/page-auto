import { createSign } from 'node:crypto'
import {
  assertGenerateAiPostsInput,
  joinAiPosts,
  type GenerateAiPostsInput,
  type GenerateAiPostsResult,
  type RemoteAgentDescriptor
} from '../../shared/aiAgents'
import { AiAgentRepository } from '../database/aiAgentRepository'
import type { GoogleServiceAccountCredential } from './googleServiceAccountCredential'

const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform'
const AGENT_RUNTIME_LOCATIONS = [
  'us-east1',
  'us-east4',
  'us-west1',
  'us-central1',
  'europe-west1',
  'europe-west2',
  'europe-west3',
  'europe-west4',
  'europe-west6',
  'europe-west8',
  'europe-southwest1',
  'asia-east1',
  'asia-east2',
  'asia-northeast1',
  'asia-northeast3',
  'asia-south1',
  'asia-southeast1',
  'asia-southeast2',
  'australia-southeast2',
  'me-west1',
  'northamerica-northeast1',
  'northamerica-northeast2',
  'southamerica-east1',
  'us',
  'eu'
] as const

interface CredentialProvider {
  get(): GoogleServiceAccountCredential
}

interface AccessTokenResponse {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

interface ReasoningEngineResource {
  name?: string
  displayName?: string
  description?: string
}

interface ReasoningEngineListResponse {
  reasoningEngines?: ReasoningEngineResource[]
  nextPageToken?: string
  error?: { message?: string }
}

interface CachedToken {
  projectId: string
  clientEmail: string
  token: string
  expiresAt: number
}

function base64Url(value: string | Buffer): string {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

export function createServiceAccountAssertion(
  credential: GoogleServiceAccountCredential,
  nowSeconds = Math.floor(Date.now() / 1000)
): string {
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = base64Url(JSON.stringify({
    iss: credential.clientEmail,
    scope: CLOUD_PLATFORM_SCOPE,
    aud: credential.tokenUri,
    iat: nowSeconds,
    exp: nowSeconds + 3600
  }))
  const unsigned = `${header}.${claims}`
  const signer = createSign('RSA-SHA256')
  signer.update(unsigned)
  signer.end()
  const signature = base64Url(signer.sign(credential.privateKey))
  return `${unsigned}.${signature}`
}

async function parseJson<T>(response: Response, providerName: string): Promise<T> {
  try {
    return await response.json() as T
  } catch {
    throw new Error(`${providerName} trả dữ liệu không đọc được (HTTP ${response.status}).`)
  }
}

function locationFromResourceName(name: string): string {
  const match = name.match(/\/locations\/([^/]+)\//)
  return match?.[1] ?? ''
}

function extractTextFragments(value: unknown, fragments: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) extractTextFragments(item, fragments)
    return
  }
  if (!value || typeof value !== 'object') return

  const record = value as Record<string, unknown>
  if (typeof record.output === 'string' && record.output.trim()) {
    fragments.push(record.output.trim())
    return
  }
  if (typeof record.text === 'string' && record.text.trim()) {
    fragments.push(record.text.trim())
    return
  }

  const content = record.content
  if (content && typeof content === 'object' && !Array.isArray(content)) {
    const parts = (content as { parts?: unknown }).parts
    if (Array.isArray(parts)) {
      for (const part of parts) extractTextFragments(part, fragments)
      return
    }
  }

  for (const nested of Object.values(record)) extractTextFragments(nested, fragments)
}

function parseEventStreamText(raw: string): string {
  const fragments: string[] = []
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith(':') || line === '[DONE]') continue
    const payloadText = line.startsWith('data:') ? line.slice(5).trim() : line
    if (!payloadText || payloadText === '[DONE]') continue
    try {
      extractTextFragments(JSON.parse(payloadText) as unknown, fragments)
    } catch {
      // Keep tolerant: some custom runtimes may return plain text lines.
      if (!line.startsWith('event:') && !line.startsWith('id:')) fragments.push(payloadText)
    }
  }
  return fragments.join('\n').trim()
}

function cleanPost(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\|/g, '｜') : ''
}

export function parseAgentPostOutput(text: string): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []

  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (Array.isArray(parsed)) return parsed.map(cleanPost).filter(Boolean)
    if (parsed && typeof parsed === 'object') {
      const posts = (parsed as { posts?: unknown }).posts
      if (Array.isArray(posts)) return posts.map(cleanPost).filter(Boolean)
      const output = (parsed as { output?: unknown }).output
      if (typeof output === 'string') return parseAgentPostOutput(output)
    }
  } catch {
    // Plain Agent output is expected for most Agent Builder deployments.
  }

  return trimmed
    .split(/\r?\n\s*\|\s*\r?\n/g)
    .map(cleanPost)
    .filter(Boolean)
}

function extraFieldLines(values: GenerateAiPostsInput['extraFields']): string[] {
  return Object.entries(values).flatMap(([key, value]) => {
    if (typeof value === 'string' && !value.trim()) return []
    return [`- ${key}: ${String(value)}`]
  })
}

export function buildAgentBuilderPrompt(input: GenerateAiPostsInput): string {
  const common = [
    `Số lượng: ${input.postCount} bài.`,
    `Loại bài: ${input.postType}.`,
    `Giọng văn: ${input.tone}.`,
    `Cấu trúc: ${input.structure}.`,
    `Độ dài: ${input.length}.`,
    `Emoji: ${input.emoji ? 'có, dùng nhẹ' : 'không'}.`,
    `Hashtag: ${input.hashtag ? 'có' : 'không'}.`
  ]

  const task = input.action === 'random'
    ? [
        'NHIỆM VỤ PAGE-AUTO: tạo các biến thể mới từ nội dung nguồn.',
        ...common,
        'Giữ đúng fact của nguồn; không tự bịa giá, địa chỉ, ưu đãi, thông số hoặc cam kết.',
        'NỘI DUNG NGUỒN:',
        ...input.randomSourcePosts.map((post, index) => `[Nguồn ${index + 1}]\n${post}`)
      ]
    : [
        'NHIỆM VỤ PAGE-AUTO: viết bài mới từ thông tin người dùng cung cấp.',
        ...common,
        `Sản phẩm / chủ đề: ${input.subject.trim()}`,
        `Thông tin chính:\n${input.sourceInfo.trim()}`,
        input.highlight.trim() ? `Điểm cần nhấn mạnh: ${input.highlight.trim()}` : '',
        input.audience.trim() ? `Đối tượng: ${input.audience.trim()}` : '',
        ...extraFieldLines(input.extraFields),
        'Chỉ dùng fact đã được cung cấp. Nếu thiếu fact quan trọng, không tự bịa.'
      ]

  return [
    ...task.filter(Boolean),
    '',
    'ĐỊNH DẠNG ĐẦU RA BẮT BUỘC:',
    `- Trả đúng ${input.postCount} bài.`,
    '- Giữa hai bài đặt đúng một dòng chỉ có ký tự |.',
    '- Không dùng ký tự | bên trong nội dung từng bài.',
    '- Không thêm lời giải thích, tiêu đề kỹ thuật, markdown fence hay dữ liệu ngoài các bài.'
  ].join('\n')
}

export class GoogleAgentRuntimeService {
  private cachedToken: CachedToken | null = null

  constructor(
    private readonly agents: AiAgentRepository,
    private readonly credentials: CredentialProvider,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async syncAgents(): Promise<RemoteAgentDescriptor[]> {
    const credential = this.credentials.get()
    const token = await this.getAccessToken(credential)
    const results = await Promise.all(
      AGENT_RUNTIME_LOCATIONS.map((location) => this.listLocation(credential.projectId, location, token))
    )

    const successfulRegions = results.filter((result) => result.ok)
    if (!successfulRegions.length) {
      const permissionError = results.find((result) => result.error)?.error
      throw new Error(
        permissionError
        || 'Không truy cập được Agent Runtime bằng service account này.'
      )
    }

    const deduped = new Map<string, RemoteAgentDescriptor>()
    for (const result of successfulRegions) {
      for (const agent of result.agents) deduped.set(agent.resourceName, agent)
    }
    return [...deduped.values()].sort((a, b) => a.displayName.localeCompare(b.displayName, 'vi'))
  }

  async generate(input: GenerateAiPostsInput): Promise<GenerateAiPostsResult> {
    assertGenerateAiPostsInput(input)
    const agent = this.agents.getEnabledById(input.agentId)
    const credential = this.credentials.get()
    if (credential.projectId !== agent.projectId) {
      throw new Error('Agent đã lưu không thuộc Google Cloud project đang kết nối. Hãy kết nối lại Agent Builder.')
    }

    const token = await this.getAccessToken(credential)
    const prompt = buildAgentBuilderPrompt(input)
    const text = await this.invokeAgent(agent.providerId, agent.location, token, prompt)
    const posts = parseAgentPostOutput(text)
    if (!posts.length) throw new Error('Agent Builder không trả về bài viết nào.')

    const warning = posts.length === input.postCount
      ? null
      : `Yêu cầu ${input.postCount} bài nhưng Agent Builder trả ${posts.length} bài.`

    return {
      agentId: agent.id,
      model: 'Agent Builder',
      posts,
      output: joinAiPosts(posts),
      warning
    }
  }

  private async getAccessToken(credential: GoogleServiceAccountCredential): Promise<string> {
    const now = Date.now()
    if (
      this.cachedToken
      && this.cachedToken.projectId === credential.projectId
      && this.cachedToken.clientEmail === credential.clientEmail
      && this.cachedToken.expiresAt - 60_000 > now
    ) {
      return this.cachedToken.token
    }

    const assertion = createServiceAccountAssertion(credential)
    const response = await this.fetchImpl(credential.tokenUri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion
      }).toString(),
      signal: AbortSignal.timeout(30_000)
    })
    const payload = await parseJson<AccessTokenResponse>(response, 'Google OAuth')
    if (!response.ok || !payload.access_token) {
      throw new Error(
        payload.error_description?.trim()
        || payload.error?.trim()
        || `Google OAuth lỗi HTTP ${response.status}.`
      )
    }

    const expiresIn = Math.max(60, Number(payload.expires_in) || 3600)
    this.cachedToken = {
      projectId: credential.projectId,
      clientEmail: credential.clientEmail,
      token: payload.access_token,
      expiresAt: now + expiresIn * 1000
    }
    return payload.access_token
  }

  private async listLocation(
    projectId: string,
    location: string,
    token: string
  ): Promise<{ ok: boolean; agents: RemoteAgentDescriptor[]; error: string | null }> {
    const agents: RemoteAgentDescriptor[] = []
    let pageToken = ''

    for (let page = 0; page < 10; page += 1) {
      const query = new URLSearchParams({ pageSize: '100' })
      if (pageToken) query.set('pageToken', pageToken)
      const response = await this.fetchImpl(
        `https://${location}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/locations/${encodeURIComponent(location)}/reasoningEngines?${query}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(20_000)
        }
      )

      if (response.status === 400 || response.status === 404) {
        return { ok: false, agents: [], error: null }
      }

      const payload = await parseJson<ReasoningEngineListResponse>(response, 'Agent Runtime')
      if (!response.ok) {
        return {
          ok: false,
          agents: [],
          error: payload.error?.message?.trim() || `Agent Runtime lỗi HTTP ${response.status}.`
        }
      }

      for (const item of payload.reasoningEngines ?? []) {
        const resourceName = item.name?.trim() ?? ''
        if (!resourceName) continue
        const resourceLocation = locationFromResourceName(resourceName) || location
        agents.push({
          resourceName,
          displayName: item.displayName?.trim() || resourceName.split('/').at(-1) || 'Agent Builder',
          description: item.description?.trim() || '',
          projectId,
          location: resourceLocation
        })
      }

      pageToken = payload.nextPageToken?.trim() ?? ''
      if (!pageToken) break
    }

    return { ok: true, agents, error: null }
  }

  private async invokeAgent(
    resourceName: string,
    location: string,
    token: string,
    prompt: string
  ): Promise<string> {
    const baseUrl = `https://${location}-aiplatform.googleapis.com/v1/${resourceName}`
    const streamResponse = await this.fetchImpl(`${baseUrl}:streamQuery?alt=sse`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        class_method: 'async_stream_query',
        input: {
          user_id: 'page-auto',
          message: prompt
        }
      }),
      signal: AbortSignal.timeout(120_000)
    })

    const streamText = await streamResponse.text()
    if (!streamResponse.ok) {
      throw new Error(this.providerError(streamText, streamResponse.status))
    }

    const parsed = parseEventStreamText(streamText)
    if (parsed) return parsed
    throw new Error(
      'Agent Builder không trả nội dung từ async_stream_query. Kiểm tra Agent đã deploy bằng ADK và quyền service account.'
    )
  }

  private providerError(raw: string, status: number): string {
    try {
      const parsed = JSON.parse(raw) as { error?: { message?: string } }
      const message = parsed.error?.message?.trim()
      if (message) return message
    } catch {
      // Ignore JSON parse failure and return a safe HTTP-only error below.
    }
    return `Agent Runtime lỗi HTTP ${status}.`
  }
}
