import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { parseAiAgentJson } from '../../shared/aiAgents'
import { AiAgentRepository } from '../database/aiAgentRepository'
import { initializeDatabase } from '../database'
import { buildAiGenerationPrompt, GeminiAiContentService } from './geminiAiContentService'

function input(agentId: string) {
  return {
    agentId,
    action: 'create' as const,
    postCount: 2,
    subject: 'Sản phẩm A',
    sourceInfo: 'Giá 100.000đ, giao nội thành.',
    highlight: 'Bảo hành 12 tháng',
    audience: 'Người mua online',
    randomSourcePosts: [],
    postType: 'Bán hàng',
    tone: 'Tự nhiên',
    structure: 'Hook → Nội dung → CTA',
    length: 'Ngắn',
    emoji: true,
    hashtag: false,
    extraFields: { khuVuc: 'TP.HCM' }
  }
}

function setupAgent() {
  const directory = mkdtempSync(join(tmpdir(), 'page-auto-gemini-'))
  const runtime = initializeDatabase(join(directory, 'page-auto.sqlite'))
  const repository = new AiAgentRepository(runtime.client)
  repository.import(parseAiAgentJson('agent.json', JSON.stringify({
    name: 'Facebook Content', instructions: 'Viết bài Facebook rõ ràng.', model: 'Gemini 3.5 Flash'
  })), 'agent.json')
  return { runtime, repository, agent: repository.get().agents[0]! }
}

describe('GeminiAiContentService', () => {
  it('builds a fact-bound create prompt', () => {
    const prompt = buildAiGenerationPrompt(input('agent-x'))
    expect(prompt).toContain('Sản phẩm A')
    expect(prompt).toContain('Giá 100.000đ')
    expect(prompt).toContain('khuVuc: TP.HCM')
    expect(prompt).toContain('không được tự bịa')
  })

  it('calls Gemini and returns the canonical pipe-delimited batch', async () => {
    const { runtime, repository, agent } = setupAgent()
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ posts: ['Bài A | chi tiết', 'Bài B'] }) }] } }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const service = new GeminiAiContentService(repository, () => 'secret-key', fetchMock as typeof fetch)

    const result = await service.generate(input(agent.id))
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(result.posts).toEqual(['Bài A ｜ chi tiết', 'Bài B'])
    expect(result.output).toBe('Bài A ｜ chi tiết\n|\nBài B')
    expect(result.warning).toBeNull()

    const [url, options] = fetchMock.mock.calls[0]!
    expect(String(url)).toContain('/gemini-3.5-flash:generateContent')
    expect((options?.headers as Record<string, string>)['x-goog-api-key']).toBe('secret-key')
    runtime.close()
  })

  it('surfaces provider errors without exposing the API key', async () => {
    const { runtime, repository, agent } = setupAgent()
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ error: { message: 'API key invalid' } }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    }))
    const service = new GeminiAiContentService(repository, () => 'do-not-log-this', fetchMock as typeof fetch)

    await expect(service.generate(input(agent.id))).rejects.toThrow('API key invalid')
    runtime.close()
  })
})
