export const AI_AGENT_IPC = {
  catalog: 'ai-agent:catalog',
  importJson: 'ai-agent:import-json',
  setEnabled: 'ai-agent:set-enabled',
  setDefault: 'ai-agent:set-default',
  delete: 'ai-agent:delete',
  saveGeminiApiKey: 'ai-agent:save-gemini-api-key',
  clearGeminiApiKey: 'ai-agent:clear-gemini-api-key',
  generatePosts: 'ai-agent:generate-posts'
} as const

export const AI_AGENT_PROVIDER = 'google-gemini' as const
export type AiAgentProvider = typeof AI_AGENT_PROVIDER
export type AiContentAction = 'create' | 'random'
export type AiAgentInputFieldType = 'text' | 'textarea' | 'select' | 'number' | 'toggle'

export interface AiAgentInputField {
  key: string
  label: string
  type: AiAgentInputFieldType
  required: boolean
  placeholder: string
  options: string[]
  defaultValue: string | number | boolean | null
}

export interface AiAgentRecord {
  id: string
  provider: AiAgentProvider
  providerId: string | null
  name: string
  description: string
  instructions: string
  model: string
  tools: string[]
  inputFields: AiAgentInputField[]
  enabled: boolean
  isDefault: boolean
  sourceFileName: string
  sourceFormat: string
  importedAt: number
}

export interface AiAgentCatalogView {
  agents: AiAgentRecord[]
  defaultAgentId: string | null
  credentialConfigured: boolean
}

export interface AiAgentImportResult {
  catalog: AiAgentCatalogView
  fileName: string
  importedCount: number
  updatedCount: number
  warnings: string[]
}

export interface AiAgentIdPayload {
  agentId: string
}

export interface AiAgentEnabledPayload extends AiAgentIdPayload {
  enabled: boolean
}

export interface SaveGeminiApiKeyInput {
  apiKey: string
}

export interface GenerateAiPostsInput {
  agentId: string
  action: AiContentAction
  postCount: number
  subject: string
  sourceInfo: string
  highlight: string
  audience: string
  randomSourcePosts: string[]
  postType: string
  tone: string
  structure: string
  length: string
  emoji: boolean
  hashtag: boolean
  extraFields: Record<string, string | number | boolean>
}

export interface GenerateAiPostsResult {
  agentId: string
  model: string
  posts: string[]
  output: string
  warning: string | null
}

export interface ParsedAiAgentImport {
  agents: Omit<AiAgentRecord, 'enabled' | 'isDefault' | 'importedAt'>[]
  warnings: string[]
  sourceFormat: string
}

const NAME_KEYS = ['displayName', 'display_name', 'name', 'title', 'agentName', 'agent_name'] as const
const DESCRIPTION_KEYS = ['description', 'goal', 'summary'] as const
const INSTRUCTION_KEYS = [
  'instructions', 'instruction', 'systemInstruction', 'system_instruction',
  'systemPrompt', 'system_prompt', 'prompt'
] as const
const MODEL_KEYS = ['model', 'modelId', 'model_id', 'modelName', 'model_name'] as const
const ID_KEYS = ['id', 'agentId', 'agent_id', 'resourceName', 'resource_name'] as const
const WRAPPER_KEYS = ['config', 'spec', 'data', 'agent', 'definition', 'properties'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (isRecord(value)) {
      for (const nestedKey of ['name', 'id', 'model', 'displayName', 'display_name']) {
        const nested = value[nestedKey]
        if (typeof nested === 'string' && nested.trim()) return nested.trim()
      }
    }
  }
  return ''
}

function deepFirstString(value: unknown, keys: readonly string[], depth = 0): string {
  if (depth > 7) return ''
  if (isRecord(value)) {
    const direct = firstString(value, keys)
    if (direct) return direct
    for (const nested of Object.values(value)) {
      const found = deepFirstString(nested, keys, depth + 1)
      if (found) return found
    }
  } else if (Array.isArray(value)) {
    for (const item of value) {
      const found = deepFirstString(item, keys, depth + 1)
      if (found) return found
    }
  }
  return ''
}

function mergedRecord(record: Record<string, unknown>): Record<string, unknown> {
  let result = { ...record }
  for (let depth = 0; depth < 4; depth += 1) {
    let changed = false
    for (const key of WRAPPER_KEYS) {
      const nested = result[key]
      if (!isRecord(nested)) continue
      result = { ...result, ...nested }
      changed = true
    }
    if (!changed) break
  }
  return result
}

function normalizeModel(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return 'gemini-3.5-flash'
  const slash = trimmed.split('/').filter(Boolean).at(-1) ?? trimmed
  const normalized = slash
    .replace(/^models[/:]/i, '')
    .replace(/^publishers\/google\/models\//i, '')
    .replace(/\s+/g, '-')
    .replace(/_/g, '-')
    .toLowerCase()
  if (normalized.startsWith('gemini-')) return normalized
  if (normalized.includes('gemini')) return normalized.replace(/^.*?(gemini)/, '$1')
  return normalized
}

function toolNames(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const names: string[] = []
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) names.push(item.trim())
    else if (isRecord(item)) {
      const name = firstString(item, ['displayName', 'display_name', 'name', 'id', 'type'])
      if (name) names.push(name)
    }
  }
  return [...new Set(names)]
}

function fieldType(value: unknown): AiAgentInputFieldType {
  if (value === 'textarea' || value === 'select' || value === 'number' || value === 'toggle') return value
  return 'text'
}

function inputFields(record: Record<string, unknown>): AiAgentInputField[] {
  const pageAuto = isRecord(record.pageAuto) ? record.pageAuto : isRecord(record.page_auto) ? record.page_auto : null
  const candidate = pageAuto?.fields ?? pageAuto?.inputFields ?? record.inputFields ?? record.input_fields ?? record.formFields
  if (!Array.isArray(candidate)) return []
  const result: AiAgentInputField[] = []
  for (const item of candidate) {
    if (!isRecord(item)) continue
    const key = firstString(item, ['key', 'id', 'name'])
    if (!key) continue
    const label = firstString(item, ['label', 'title', 'name']) || key
    const rawOptions = Array.isArray(item.options)
      ? item.options.flatMap((option) => {
        if (typeof option === 'string') return option.trim() ? [option.trim()] : []
        if (isRecord(option)) {
          const text = firstString(option, ['label', 'value', 'name'])
          return text ? [text] : []
        }
        return []
      })
      : []
    const rawDefault = item.defaultValue ?? item.default ?? null
    const defaultValue = typeof rawDefault === 'string' || typeof rawDefault === 'number' || typeof rawDefault === 'boolean'
      ? rawDefault
      : null
    result.push({
      key,
      label,
      type: fieldType(item.type),
      required: item.required === true,
      placeholder: typeof item.placeholder === 'string' ? item.placeholder : '',
      options: rawOptions,
      defaultValue
    })
  }
  return result
}

function stableId(input: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `agent-${(hash >>> 0).toString(36)}`
}

function sourceFormat(root: unknown): string {
  if (!isRecord(root)) return 'generic-json'
  if (Array.isArray(root.nodes)) return 'google-agent-builder-graph'
  if (Array.isArray(root.agents)) return 'agent-pack'
  if (root.rootAgent || root.root_agent) return 'google-adk'
  return 'generic-json'
}

function candidateLooksLikeAgent(record: Record<string, unknown>, path: readonly string[]): boolean {
  const merged = mergedRecord(record)
  const name = firstString(merged, NAME_KEYS)
  const instructions = firstString(merged, INSTRUCTION_KEYS)
  const model = firstString(merged, MODEL_KEYS)
  const kind = firstString(merged, ['type', 'kind', 'nodeType', 'node_type']).toLowerCase()
  const pathLooksAgent = path.some((segment) => segment.toLowerCase().includes('agent'))
  return Boolean(name && (instructions || model || kind.includes('agent') || pathLooksAgent))
}

function collectCandidateRecords(root: unknown): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = []
  const seen = new Set<Record<string, unknown>>()

  const visit = (value: unknown, path: string[], depth: number) => {
    if (depth > 8) return
    if (Array.isArray(value)) {
      for (const item of value) visit(item, path, depth + 1)
      return
    }
    if (!isRecord(value)) return

    if (candidateLooksLikeAgent(value, path) && !seen.has(value)) {
      seen.add(value)
      result.push(value)
    }

    for (const [key, nested] of Object.entries(value)) {
      visit(nested, [...path, key], depth + 1)
    }
  }

  visit(root, [], 0)
  return result
}

function normalizeCandidate(record: Record<string, unknown>, fileName: string, format: string) {
  const merged = mergedRecord(record)
  const name = firstString(merged, NAME_KEYS)
  const description = firstString(merged, DESCRIPTION_KEYS)
  const instructions = firstString(merged, INSTRUCTION_KEYS)
  const model = normalizeModel(firstString(merged, MODEL_KEYS))
  const providerId = firstString(merged, ID_KEYS) || null
  const tools = toolNames(merged.tools ?? merged.availableTools ?? merged.available_tools)
  const fields = inputFields(merged)
  const identity = providerId || `${fileName}|${name}|${model}|${instructions.slice(0, 180)}`
  return {
    id: stableId(identity),
    provider: AI_AGENT_PROVIDER,
    providerId,
    name,
    description,
    instructions,
    model,
    tools,
    inputFields: fields,
    sourceFileName: fileName,
    sourceFormat: format
  }
}

export function parseAiAgentJson(fileName: string, rawText: string): ParsedAiAgentImport {
  let root: unknown
  try {
    root = JSON.parse(rawText) as unknown
  } catch {
    throw new Error('File Agent không phải JSON hợp lệ.')
  }
  if (!isRecord(root) && !Array.isArray(root)) throw new Error('File Agent JSON không có cấu trúc object/array hợp lệ.')

  const format = sourceFormat(root)
  const normalized = collectCandidateRecords(root)
    .map((record) => normalizeCandidate(record, fileName, format))
    .filter((agent) => agent.name)

  const deduped = new Map<string, (typeof normalized)[number]>()
  for (const agent of normalized) deduped.set(agent.id, agent)

  if (!deduped.size) {
    const fallbackName = deepFirstString(root, NAME_KEYS) || fileName.replace(/\.json$/i, '').trim() || 'Imported Agent'
    const fallbackInstructions = deepFirstString(root, INSTRUCTION_KEYS)
    const fallbackModel = deepFirstString(root, MODEL_KEYS)
    if (!fallbackInstructions && !fallbackModel) {
      throw new Error('Không tìm thấy Agent trong file JSON. Cần object có tên Agent kèm instructions hoặc model.')
    }
    const fallback = normalizeCandidate({
      name: fallbackName,
      instructions: fallbackInstructions,
      model: fallbackModel,
      description: deepFirstString(root, DESCRIPTION_KEYS)
    }, fileName, format)
    deduped.set(fallback.id, fallback)
  }

  const warnings: string[] = []
  for (const agent of deduped.values()) {
    if (!agent.instructions) warnings.push(`Agent “${agent.name}” không có instructions; Page-Auto chỉ dùng model + cấu hình tạo bài.`)
    if (agent.tools.length) warnings.push(`Agent “${agent.name}” có ${agent.tools.length} tool; runtime text hiện không tự thực thi tool external.`)
  }

  return { agents: [...deduped.values()], warnings, sourceFormat: format }
}

export function assertGenerateAiPostsInput(input: GenerateAiPostsInput): void {
  if (!input.agentId.trim()) throw new Error('Chưa chọn Agent.')
  if (!Number.isInteger(input.postCount) || input.postCount < 1 || input.postCount > 50) throw new Error('Số lượng bài phải từ 1 đến 50.')
  if (input.action === 'create') {
    if (!input.subject.trim()) throw new Error('Chưa nhập sản phẩm / chủ đề.')
    if (!input.sourceInfo.trim()) throw new Error('Chưa nhập thông tin chính.')
  } else if (!input.randomSourcePosts.some((post) => post.trim())) {
    throw new Error('Chưa có nội dung nguồn để Random.')
  }
}

export function joinAiPosts(posts: readonly string[]): string {
  return posts
    .map((post) => post.trim().replace(/\|/g, '｜'))
    .filter(Boolean)
    .join('\n|\n')
}
