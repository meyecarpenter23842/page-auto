export const AI_API_IPC = {
  list: 'ai-api:list', discover: 'ai-api:discover', test: 'ai-api:test', cancelTest: 'ai-api:cancel-test',
  save: 'ai-api:save', remove: 'ai-api:remove', setDefault: 'ai-api:set-default', updateModel: 'ai-api:update-model'
} as const

export type AiApiProvider = 'openai-compatible' | 'gemini' | 'anthropic'
export interface AiApiConnectionView {
  id: string
  name: string
  provider: AiApiProvider
  baseUrl: string
  modelId: string
  isDefault: boolean
  createdAt: number
}
export interface AiApiConnectionDraft {
  name: string
  provider: AiApiProvider
  baseUrl: string
  apiKey: string
  modelId: string
}
export interface AiApiDiscoveryInput {
  provider: AiApiProvider
  baseUrl: string
  apiKey: string
  connectionId?: string
}
export const AI_MODEL_TEST_TIMEOUT_OPTIONS_MS = [60_000, 120_000] as const
export const DEFAULT_AI_MODEL_TEST_TIMEOUT_MS = AI_MODEL_TEST_TIMEOUT_OPTIONS_MS[0]
export function validateAiModelTestTimeout(value: unknown): number {
  if (value === undefined) return DEFAULT_AI_MODEL_TEST_TIMEOUT_MS
  if (typeof value !== 'number' || !AI_MODEL_TEST_TIMEOUT_OPTIONS_MS.some((limit) => limit === value)) {
    throw new Error('Thời gian kiểm tra Model phải là 60 hoặc 120 giây.')
  }
  return value
}
export interface AiApiTestInput extends AiApiDiscoveryInput {
  modelId: string
  timeoutMs?: number
  /** Per-test cancellation identity; never persisted. */
  requestId?: string
}
export interface AiApiModel { id: string; label: string }
export const API_PROVIDER_DEFAULTS: Record<AiApiProvider, string> = {
  'openai-compatible': 'https://integrate.api.nvidia.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  anthropic: 'https://api.anthropic.com/v1'
}

export function aiApiChoice(id: string): string { return 'api:' + id }
export function isAiApiChoice(id: string): boolean { return id.startsWith('api:') }
export function aiApiChoiceId(id: string): string { return id.slice(4) }

export function validateAiApiEndpoint(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length > 300) throw new Error('URL API quá dài.')
  let url: URL
  try { url = new URL(trimmed) } catch { throw new Error('URL API không hợp lệ.') }
  const host = url.hostname.toLowerCase()
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || !host.includes('.') || /^\d+(?:\.\d+){3}$/.test(host)
    || host.includes(':') || /(^|\.)(localhost|local|internal|test|invalid)$/.test(host)) {
    throw new Error('Chỉ cho phép API HTTPS công khai, không có thông tin đăng nhập trong URL.')
  }
  return url.href.replace(/\/+$/, '')
}

export function validateAiApiModelId(modelId: string): string {
  const value = modelId.trim()
  if (!value || value.length > 180 || !/^[\w.\-/:+@]+$/.test(value)) {
    throw new Error('Model ID không hợp lệ.')
  }
  return value
}

export function validateAiApiDraft(input: AiApiConnectionDraft): AiApiConnectionDraft {
  if (!input || !['openai-compatible','gemini','anthropic'].includes(input.provider)) {
    throw new Error('Nhà cung cấp API không hỗ trợ.')
  }
  const name = input.name?.trim() ?? ''
  if (!name || name.length > 80) throw new Error('Tên kết nối phải từ 1 đến 80 ký tự.')
  const apiKey = input.apiKey?.trim() ?? ''
  if (!apiKey || apiKey.length > 8192) throw new Error('Thiếu hoặc sai API Key.')
  return {
    name, provider: input.provider,
    baseUrl: validateAiApiEndpoint(input.baseUrl),
    apiKey, modelId: validateAiApiModelId(input.modelId)
  }
}
