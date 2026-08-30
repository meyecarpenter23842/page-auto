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

export const AI_AGENT_PROVIDER = 'google-agent-runtime' as const
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
  providerId: string
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
  projectId: string
  location: string
}

export interface AiAgentCatalogView {
  agents: AiAgentRecord[]
  defaultAgentId: string | null
  credentialConfigured: boolean
  projectId?: string | null
  serviceAccountEmail?: string | null
  lastSyncAt?: number | null
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

/**
 * Compatibility-only preload shape from the first AI prototype.
 * Agent Builder runtime no longer uses a Gemini API key.
 */
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

export interface GoogleCloudCredentialView {
  configured: boolean
  projectId: string | null
  serviceAccountEmail: string | null
  sourceFileName: string | null
}

export interface RemoteAgentDescriptor {
  resourceName: string
  displayName: string
  description: string
  projectId: string
  location: string
}

export function assertGenerateAiPostsInput(input: GenerateAiPostsInput): void {
  if (!input.agentId.trim()) throw new Error('Chưa chọn Agent Builder.')
  if (!Number.isInteger(input.postCount) || input.postCount < 1 || input.postCount > 50) {
    throw new Error('Số lượng bài phải từ 1 đến 50.')
  }
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
