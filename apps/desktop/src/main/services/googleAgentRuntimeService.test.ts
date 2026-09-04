import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { AiAgentRepository } from '../database/aiAgentRepository'
import { initializeDatabase } from '../database'
import type { GoogleServiceAccountCredential } from './googleServiceAccountCredential'
import {
  buildAgentBuilderPrompt,
  createServiceAccountAssertion,
  GoogleAgentRuntimeService
} from './googleAgentRuntimeService'

function setupCredential(): GoogleServiceAccountCredential {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' }
  })
  return {
    type: 'service_account',
    projectId: 'project-a',
    clientEmail: 'agent-support@project-a.iam.gserviceaccount.com',
    privateKey,
    tokenUri: 'https://oauth2.googleapis.com/token',
    sourceFileName: 'service-account.json'
  }
}

function setupRepository() {
  const directory = mkdtempSync(join(tmpdir(), 'page-auto-agent-runtime-'))
  const runtime = initializeDatabase(join(directory, 'page-auto.sqlite'))
  const repository = new AiAgentRepository(runtime.client)
  return { runtime, repository }
}

function generationInput(agentId: string) {
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
    extraFields: {}
  }
}

describe('GoogleAgentRuntimeService', () => {
  it('builds an OAuth service-account assertion for cloud-platform access', () => {
    const credential = setupCredential()
    const assertion = createServiceAccountAssertion(credential, 1_700_000_000)
    const parts = assertion.split('.')
    expect(parts).toHaveLength(3)

    const claims = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as {
      iss: string
      scope: string
      aud: string
      iat: number
      exp: number
    }
    expect(claims.iss).toBe(credential.clientEmail)
    expect(claims.scope).toBe('https://www.googleapis.com/auth/cloud-platform')
    expect(claims.aud).toBe(credential.tokenUri)
    expect(claims.exp - claims.iat).toBe(3600)
  })

  it('discovers deployed reasoning engines instead of parsing the credential as an Agent', async () => {
    const credential = setupCredential()
    const { runtime, repository } = setupRepository()
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === credential.tokenUri) {
        return new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      }
      if (url.includes('us-central1-aiplatform.googleapis.com')) {
        return new Response(JSON.stringify({
          reasoningEngines: [{
            name: 'projects/project-a/locations/us-central1/reasoningEngines/123',
            displayName: 'Facebook Content Agent',
            description: 'Agent đã build'
          }]
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      }
      return new Response(JSON.stringify({ reasoningEngines: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    })

    const service = new GoogleAgentRuntimeService(
      repository,
      { get: () => credential },
      fetchMock as typeof fetch
    )
    const agents = await service.syncAgents()

    expect(agents).toContainEqual({
      resourceName: 'projects/project-a/locations/us-central1/reasoningEngines/123',
      displayName: 'Facebook Content Agent',
      description: 'Agent đã build',
      projectId: 'project-a',
      location: 'us-central1'
    })
    runtime.close()
  })

  it('sends the Page-Auto job to the selected deployed Agent Runtime', async () => {
    const credential = setupCredential()
    const { runtime, repository } = setupRepository()
    const remote = {
      resourceName: 'projects/project-a/locations/us-central1/reasoningEngines/123',
      displayName: 'Facebook Content Agent',
      description: 'Agent đã build',
      projectId: 'project-a',
      location: 'us-central1'
    }
    repository.syncRemote([remote])

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === credential.tokenUri) {
        return new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      }
      if (url.includes(':streamQuery')) {
        const body = JSON.parse(String(init?.body)) as {
          class_method: string
          input: { user_id: string; message: string }
        }
        expect(body.class_method).toBe('async_stream_query')
        expect(body.input.user_id).toBe('page-auto')
        expect(body.input.message).toContain('Sản phẩm A')
        expect(body.input.message).toContain('đúng 2 bài')
        return new Response(
          'data: {"author":"facebook-agent","content":{"parts":[{"text":"Bài A\\n|\\nBài B"}],"role":"model"}}\n\n',
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
        )
      }
      throw new Error(`Unexpected URL ${url}`)
    })

    const service = new GoogleAgentRuntimeService(
      repository,
      { get: () => credential },
      fetchMock as typeof fetch
    )
    const result = await service.generate(generationInput(remote.resourceName))

    expect(result.posts).toEqual(['Bài A', 'Bài B'])
    expect(result.output).toBe('Bài A\n|\nBài B')
    expect(result.warning).toBeNull()
    runtime.close()
  })

  it('keeps the post-count and separator contract in the Agent Builder prompt', () => {
    const prompt = buildAgentBuilderPrompt(generationInput('agent'))
    expect(prompt).toContain('Số lượng: 2 bài.')
    expect(prompt).toContain('dòng chỉ có ký tự |')
  })

  it('forces short readable sections instead of a wall of text', () => {
    const prompt = buildAgentBuilderPrompt({
      ...generationInput('agent'),
      structure: 'Hook → Bullet → CTA'
    })

    expect(prompt).toContain('Hook → Bullet → CTA')
    expect(prompt).toContain('Tuyệt đối không viết toàn bộ bài thành một khối văn dài')
    expect(prompt).toContain('Mỗi đoạn tối đa 3 câu')
    expect(prompt).toContain('CTA hoặc thông tin liên hệ, nếu có, phải tách thành đoạn riêng')
    expect(prompt).toContain('Không tự nhận đã trải nghiệm thực tế')
    expect(prompt).toContain('Không tự thêm các khẳng định như “hàng đầu”')
  })

  it('preselects different layout recipes for a mixed random batch', () => {
    const prompt = buildAgentBuilderPrompt({
      ...generationInput('agent'),
      action: 'random' as const,
      postCount: 6,
      subject: '',
      sourceInfo: '',
      randomSourcePosts: ['Nguồn hàng rõ ràng, giao nội thành.'],
      structure: 'Trộn bố cục'
    })

    expect(prompt).toContain('BỐ CỤC TỪNG BÀI — Page-Auto đã chọn trước, không tự đổi')
    const assignments = prompt
      .split('\n')
      .filter((line) => /^- Bài \d+: /.test(line))
    expect(assignments).toHaveLength(6)

    const names = assignments.map((line) => line
      .replace(/^- Bài \d+: /, '')
      .replace(/\.$/, ''))
    expect(new Set(names).size).toBe(6)
  })
})
