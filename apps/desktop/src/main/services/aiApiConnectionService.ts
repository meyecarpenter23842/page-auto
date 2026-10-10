import { randomUUID } from 'node:crypto'
import { safeStorage } from 'electron'
import type Database from 'better-sqlite3'
import {
  API_PROVIDER_DEFAULTS, type AiApiConnectionDraft, type AiApiConnectionView,
  type AiApiDiscoveryInput, type AiApiModel, type AiApiProvider, type AiApiTestInput,
  validateAiApiDraft, validateAiApiEndpoint, validateAiApiModelId
} from '../../shared/aiApiConnections'
import { assertGenerateAiPostsInput, joinAiPosts, type GenerateAiPostsInput, type GenerateAiPostsResult } from '../../shared/aiAgents'
import { buildAgentBuilderPrompt, parseAgentPostOutput } from './googleAgentRuntimeService'

const KEY = 'ai.api.connections.encrypted.v1'
const MAX_CONNECTIONS = 30
const RESPONSE_LIMIT = 2 * 1024 * 1024
const MODEL_DISCOVERY_TIMEOUT_MS = 20_000
const MODEL_TEST_TIMEOUT_MS = 25_000
const GENERATE_TIMEOUT_MS = 90_000

/** Includes both waiting for HTTP headers AND reading a potentially stalled response body. */
export async function withAiApiDeadline<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`API không phản hồi trong ${Math.ceil(timeoutMs / 1000)} giây. Đã dừng kiểm tra; thử model khác hoặc kiểm tra nhà cung cấp.`))
      controller.abort()
    }, timeoutMs)
  })
  try {
    return await Promise.race([run(controller.signal), expired])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

export function getAiApiHttpError(status: number): string {
  switch (status) {
    case 400: return 'HTTP 400: Model không chấp nhận yêu cầu hoặc định dạng chat hiện tại.'
    case 401: return 'HTTP 401: API Key không hợp lệ hoặc đã hết hiệu lực.'
    case 403: return 'HTTP 403: Tài khoản chưa được cấp quyền gọi model này.'
    case 404: return 'HTTP 404: Model hoặc endpoint tạo văn bản không khả dụng. Tải Model thành công không bảo đảm gọi inference được.'
    case 408: return 'HTTP 408: Máy chủ API không phản hồi kịp.'
    case 429: return 'HTTP 429: Nhà cung cấp giới hạn lượt gọi hoặc hạn mức tài khoản.'
    default: return `API trả HTTP ${status}. Kiểm tra quyền truy cập và tình trạng dịch vụ.`
  }
}
interface StoredConnection extends AiApiConnectionView { apiKey: string }
type Stored = { defaultId: string | null; items: StoredConnection[] }
function empty(): Stored { return { defaultId: null, items: [] } }
function publicRecord(record: StoredConnection, defaultId: string | null): AiApiConnectionView {
  const { apiKey: _hidden, ...rest } = record
  void _hidden
  return { ...rest, isDefault: record.id === defaultId }
}

function getBaseUrl(provider: AiApiProvider, value: string): string {
  return validateAiApiEndpoint(value.trim() || API_PROVIDER_DEFAULTS[provider])
}
function requestHeaders(provider: AiApiProvider, key: string): Record<string, string> {
  if (provider === 'gemini') return { 'x-goog-api-key': key }
  if (provider === 'anthropic') return { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
  return { Authorization: 'Bearer ' + key }
}
function endpoint(baseUrl: string, path: string): string {
  return baseUrl.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, '')
}
function textContent(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map((v) => typeof v?.text === 'string' ? v.text : '').join('')
  return ''
}
export function parseApiModels(provider: AiApiProvider, payload: unknown): AiApiModel[] {
  const raw = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  const list = provider === 'gemini' ? raw.models : raw.data
  if (!Array.isArray(list)) throw new Error('API không có danh sách model tương thích. Hãy kiểm tra endpoint hoặc quyền API.')
  const models = list.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const entry = item as Record<string, unknown>
    const name = typeof entry.id === 'string' ? entry.id : typeof entry.name === 'string' ? entry.name : ''
    const id = provider === 'gemini' ? name.replace(/^models\//, '') : name
    try { validateAiApiModelId(id) } catch { return [] }
    if (provider === 'gemini' && Array.isArray(entry.supportedGenerationMethods)
      && !entry.supportedGenerationMethods.includes('generateContent')) return []
    const label = typeof entry.displayName === 'string' && entry.displayName ? entry.displayName + ' · ' + id : id
    return [{ id, label }]
  })
  const unique = [...new Map(models.map((m) => [m.id, m])).values()]
  return unique.sort((a,b)=>a.id.localeCompare(b.id)).slice(0, 2000)
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const declared = Number(response.headers.get('content-length'))
  if (declared > RESPONSE_LIMIT) throw new Error('Phản hồi API vượt giới hạn 2 MB.')
  const reader = response.body?.getReader()
  if (!reader) throw new Error('API trả phản hồi rỗng.')
  let size = 0
  const chunks: Uint8Array[] = []
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > RESPONSE_LIMIT) throw new Error('Phản hồi API vượt giới hạn 2 MB.')
      chunks.push(next.value)
    }
  } finally { reader.releaseLock() }
  const merged = Buffer.concat(chunks.map((c)=>Buffer.from(c))).toString('utf8')
  try { const parsed: unknown = JSON.parse(merged); return parsed && typeof parsed==='object' ? parsed as Record<string,unknown> : {} }
  catch { throw new Error('API trả JSON không hợp lệ.') }
}
export class AiApiConnectionService {
  constructor(private readonly db: Database.Database, private readonly fetchImpl: typeof fetch = fetch) {}
  private load(): Stored {
    const row = this.db.prepare('SELECT value FROM app_settings WHERE key = ?').get(KEY) as { value: string } | undefined
    if (!row) return empty()
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Máy không hỗ trợ giải mã API Key.')
    try {
      const raw = safeStorage.decryptString(Buffer.from(row.value,'base64'))
      const parsed = JSON.parse(raw) as Stored
      if (!Array.isArray(parsed.items)) throw new Error('bad-data')
      return parsed
    } catch { throw new Error('Không giải mã được kết nối AI. Hãy kiểm tra quyền mã hóa của Windows.') }
  }
  private persist(state: Stored): void {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows không thể mã hóa API Key; không lưu plaintext.')
    const encrypted = safeStorage.encryptString(JSON.stringify(state)).toString('base64')
    this.db.prepare(`INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
      .run(KEY, encrypted, Date.now())
  }
  list(): AiApiConnectionView[] {
    const state = this.load()
    return state.items.map((item) => publicRecord(item,state.defaultId))
  }
  private byId(id: string): StoredConnection {
    const item = this.load().items.find((x)=>x.id === id)
    if (!item) throw new Error('Kết nối API không tồn tại.')
    return item
  }
  save(input: AiApiConnectionDraft): AiApiConnectionView[] {
    const valid = validateAiApiDraft(input)
    const state = this.load()
    if (state.items.length >= MAX_CONNECTIONS) throw new Error('Tối đa 30 kết nối AI.')
    const record: StoredConnection = { ...valid, id: randomUUID(), createdAt: Date.now(), isDefault: false }
    state.items.push(record)
    state.defaultId ??= record.id
    this.persist(state)
    return this.list()
  }
  updateModel(id: string, modelId: string): AiApiConnectionView[] {
    const state = this.load()
    const connection = state.items.find((item)=>item.id === id)
    if (!connection) throw new Error('Kết nối API không tồn tại.')
    connection.modelId = validateAiApiModelId(modelId)
    this.persist(state)
    return this.list()
  }
  remove(id: string): AiApiConnectionView[] {
    const state = this.load()
    if (!state.items.some((v)=>v.id === id)) throw new Error('Kết nối API không tồn tại.')
    state.items = state.items.filter((v)=>v.id !== id)
    if (state.defaultId === id) state.defaultId = state.items[0]?.id ?? null
    this.persist(state)
    return this.list()
  }
  setDefault(id: string): AiApiConnectionView[] {
    const state = this.load()
    if (!state.items.some((v)=>v.id === id)) throw new Error('Kết nối API không tồn tại.')
    state.defaultId = id
    this.persist(state)
    return this.list()
  }
  private credentials(input: AiApiDiscoveryInput): { provider: AiApiProvider; baseUrl: string; apiKey: string } {
    if (input.connectionId) {
      const stored = this.byId(input.connectionId)
      return {provider: stored.provider, baseUrl: stored.baseUrl, apiKey: stored.apiKey}
    }
    if (!input || !['openai-compatible','gemini','anthropic'].includes(input.provider)) throw new Error('Nhà cung cấp không hỗ trợ.')
    const apiKey = input.apiKey?.trim() ?? ''
    if (!apiKey || apiKey.length > 8192) throw new Error('Nhập API Key trước khi tải Model.')
    return {provider: input.provider,baseUrl:getBaseUrl(input.provider,input.baseUrl),apiKey}
  }
  private async request(provider: AiApiProvider, baseUrl: string, apiKey: string,
    path: string, method: 'GET'|'POST', body?: Record<string, unknown>,
    timeoutMs = method === 'GET' ? MODEL_DISCOVERY_TIMEOUT_MS : GENERATE_TIMEOUT_MS
  ): Promise<Record<string, unknown>> {
    // The deadline covers both fetch and response streaming. No provider error body is logged.
    const safeBase = validateAiApiEndpoint(baseUrl)
    const url = endpoint(safeBase, path)
    return withAiApiDeadline(async (signal) => {
      let response: Response
      try {
        response = await this.fetchImpl(url, {
          method, redirect: 'error',
          headers: {...requestHeaders(provider, apiKey), 'Content-Type': 'application/json'},
          ...(body ? {body: JSON.stringify(body)} : {}),
          signal
        })
      } catch {
        throw new Error('Không kết nối được API HTTPS. Kiểm tra URL, mạng và chứng chỉ TLS.')
      }
      if (!response.ok) throw new Error(getAiApiHttpError(response.status))
      return readJson(response)
    }, timeoutMs)
  }
  async discover(input: AiApiDiscoveryInput): Promise<AiApiModel[]> {
    const {provider,baseUrl,apiKey} = this.credentials(input)
    const data = await this.request(provider,baseUrl,apiKey,'models','GET')
    return parseApiModels(provider,data)
  }
  private async completion(
    provider: AiApiProvider, baseUrl: string, apiKey: string, modelId: string,
    prompt: string, maxTokens: number, timeoutMs = GENERATE_TIMEOUT_MS
  ): Promise<string> {
    const model = validateAiApiModelId(modelId)
    if (prompt.length > 50000) throw new Error('Nội dung đầu vào AI quá dài.')
    let path: string
    let body: Record<string, unknown>
    if (provider === 'gemini') {
      path = 'models/' + encodeURIComponent(model) + ':generateContent'
      body = {contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{maxOutputTokens:maxTokens}}
    } else if (provider === 'anthropic') {
      path = 'messages'
      body = {model,max_tokens:maxTokens,messages:[{role:'user',content:prompt}]}
    } else {
      path = 'chat/completions'
      body = {model,messages:[{role:'user',content:prompt}],max_tokens:maxTokens}
    }
    const data = await this.request(provider,baseUrl,apiKey,path,'POST',body,timeoutMs)
    let output: unknown
    if (provider === 'gemini') {
      const candidates = data.candidates
      const first = Array.isArray(candidates) ? candidates[0] as {content?:{parts?:{text?:string}[]}}|undefined : undefined
      output = first?.content?.parts?.map((x)=>x.text??'').join('')
    } else if (provider === 'anthropic') {
      output = textContent(data.content)
    } else {
      const first = Array.isArray(data.choices) ? data.choices[0] as {message?:{content?:unknown}}|undefined : undefined
      output = textContent(first?.message?.content)
    }
    if (typeof output !== 'string' || !output.trim()) throw new Error('Model không trả nội dung văn bản. Kiểm tra khả năng của model.')
    return output.trim()
  }
  async test(input: AiApiTestInput): Promise<boolean> {
    const {provider,baseUrl,apiKey} = this.credentials(input)
    const result = await this.completion(
      provider, baseUrl, apiKey, input.modelId, 'Trả lời đúng một từ: OK', 32, MODEL_TEST_TIMEOUT_MS
    )
    return Boolean(result)
  }
  async generate(input: GenerateAiPostsInput): Promise<GenerateAiPostsResult> {
    assertGenerateAiPostsInput(input)
    if (!input.agentId.startsWith('api:')) throw new Error('Không phải kết nối API.')
    const stored = this.byId(input.agentId.slice(4))
    const prompt = buildAgentBuilderPrompt(input)
    const text = await this.completion(stored.provider,stored.baseUrl,stored.apiKey,stored.modelId,prompt,Math.min(8192,Math.max(512,input.postCount*450)))
    const posts = parseAgentPostOutput(text)
    if (!posts.length) throw new Error('Model không trả bài viết nào.')
    return {
      agentId: input.agentId, model: stored.modelId, posts,
      output: joinAiPosts(posts),
      warning: posts.length === input.postCount ? null : `Yêu cầu ${input.postCount} bài, model trả về ${posts.length} bài.`
    }
  }
}
