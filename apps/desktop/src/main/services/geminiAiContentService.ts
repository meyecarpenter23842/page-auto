import {
  assertGenerateAiPostsInput,
  joinAiPosts,
  type AiAgentRecord,
  type GenerateAiPostsInput,
  type GenerateAiPostsResult
} from '../../shared/aiAgents'
import { AiAgentRepository } from '../database/aiAgentRepository'

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> }
    finishReason?: string
  }>
  promptFeedback?: { blockReason?: string }
  error?: { message?: string }
}

function cleanPost(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\|/g, '｜') : ''
}

function parsePostsFromModelText(text: string): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (Array.isArray(parsed)) return parsed.map(cleanPost).filter(Boolean)
    if (parsed && typeof parsed === 'object') {
      const posts = (parsed as { posts?: unknown }).posts
      if (Array.isArray(posts)) return posts.map(cleanPost).filter(Boolean)
    }
  } catch {
    // Fall through to a tolerant text parser for provider/model variations.
  }
  return trimmed
    .split(/\n\s*\|\s*\n/g)
    .map((post) => cleanPost(post))
    .filter(Boolean)
}

function extraFieldLines(values: GenerateAiPostsInput['extraFields']): string[] {
  return Object.entries(values).flatMap(([key, value]) => {
    if (typeof value === 'string' && !value.trim()) return []
    return [`- ${key}: ${String(value)}`]
  })
}

export function buildAiGenerationPrompt(input: GenerateAiPostsInput): string {
  const common = [
    `Số lượng: ${input.postCount} bài.`,
    `Loại bài: ${input.postType}.`,
    `Giọng văn: ${input.tone}.`,
    `Cấu trúc: ${input.structure}.`,
    `Độ dài: ${input.length}.`,
    `Emoji: ${input.emoji ? 'có, dùng nhẹ' : 'không'}.`,
    `Hashtag: ${input.hashtag ? 'có' : 'không'}.`
  ]

  if (input.action === 'random') {
    return [
      'NHIỆM VỤ: tạo các biến thể mới từ nội dung nguồn.',
      ...common,
      'Yêu cầu: giữ đúng thông tin/fact của nguồn, không tự bịa giá, địa chỉ, ưu đãi, thông số hoặc cam kết.',
      'Các bài phải khác nhau đủ rõ về cách diễn đạt nhưng không làm sai nội dung.',
      'NỘI DUNG NGUỒN:',
      ...input.randomSourcePosts.map((post, index) => `[Nguồn ${index + 1}]\n${post}`)
    ].join('\n')
  }

  return [
    'NHIỆM VỤ: viết bài mới từ thông tin người dùng cung cấp.',
    ...common,
    `Sản phẩm / chủ đề: ${input.subject.trim()}`,
    `Thông tin chính:\n${input.sourceInfo.trim()}`,
    input.highlight.trim() ? `Điểm cần nhấn mạnh: ${input.highlight.trim()}` : '',
    input.audience.trim() ? `Đối tượng: ${input.audience.trim()}` : '',
    ...extraFieldLines(input.extraFields),
    'Chỉ dùng các fact đã được cung cấp. Nếu thiếu fact quan trọng, không được tự bịa.'
  ].filter(Boolean).join('\n')
}

export class GeminiAiContentService {
  constructor(
    private readonly agents: AiAgentRepository,
    private readonly getApiKey: () => string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async generate(input: GenerateAiPostsInput): Promise<GenerateAiPostsResult> {
    assertGenerateAiPostsInput(input)
    const agent = this.agents.getEnabledById(input.agentId)
    const apiKey = this.getApiKey()
    const prompt = buildAiGenerationPrompt(input)
    const body = this.requestBody(agent, input.postCount, prompt)

    const response = await this.fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(agent.model)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000)
      }
    )

    let payload: GeminiResponse
    try {
      payload = await response.json() as GeminiResponse
    } catch {
      throw new Error(`Gemini trả dữ liệu không đọc được (HTTP ${response.status}).`)
    }

    if (!response.ok) {
      throw new Error(payload.error?.message?.trim() || `Gemini API lỗi HTTP ${response.status}.`)
    }
    if (payload.promptFeedback?.blockReason) {
      throw new Error(`Gemini từ chối prompt: ${payload.promptFeedback.blockReason}.`)
    }

    const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim() ?? ''
    const posts = parsePostsFromModelText(text)
    if (!posts.length) throw new Error('Gemini không trả về bài viết nào.')

    const warningParts: string[] = []
    if (posts.length !== input.postCount) warningParts.push(`Yêu cầu ${input.postCount} bài nhưng Gemini trả ${posts.length} bài.`)
    if (agent.tools.length) warningParts.push(`Agent có ${agent.tools.length} tool external; runtime text này chưa thực thi tool.`)

    return {
      agentId: agent.id,
      model: agent.model,
      posts,
      output: joinAiPosts(posts),
      warning: warningParts.length ? warningParts.join(' ') : null
    }
  }

  private requestBody(agent: AiAgentRecord, postCount: number, prompt: string): Record<string, unknown> {
    const systemInstruction = [
      agent.instructions.trim(),
      'Ràng buộc Page-Auto:',
      `- Trả đúng ${postCount} bài.`,
      '- Không dùng ký tự | bên trong nội dung bài.',
      '- Trả JSON object theo schema có trường posts là mảng string.',
      '- Không thêm markdown fence, lời giải thích hoặc dữ liệu ngoài các bài.'
    ].filter(Boolean).join('\n')

    return {
      systemInstruction: {
        parts: [{ text: systemInstruction }]
      },
      contents: [{
        role: 'user',
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        temperature: 0.9,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'object',
          properties: {
            posts: {
              type: 'array',
              minItems: postCount,
              maxItems: postCount,
              items: { type: 'string' }
            }
          },
          required: ['posts']
        }
      }
    }
  }
}
