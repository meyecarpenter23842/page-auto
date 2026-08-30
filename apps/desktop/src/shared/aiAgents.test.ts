import { describe, expect, it } from 'vitest'
import { joinAiPosts, parseAiAgentJson } from './aiAgents'

describe('AI Agent JSON parser', () => {
  it('parses a normal Agent pack and normalizes Gemini model names', () => {
    const result = parseAiAgentJson('facebook-pack.json', JSON.stringify({
      agents: [{
        id: 'fb-sales',
        name: 'Facebook Bán hàng',
        description: 'Viết bài bán hàng',
        instructions: 'Chỉ dùng fact được cung cấp.',
        model: 'Gemini 3.5 Flash'
      }]
    }))

    expect(result.sourceFormat).toBe('agent-pack')
    expect(result.agents).toHaveLength(1)
    expect(result.agents[0]).toMatchObject({
      providerId: 'fb-sales',
      name: 'Facebook Bán hàng',
      instructions: 'Chỉ dùng fact được cung cấp.',
      model: 'gemini-3.5-flash'
    })
  })

  it('finds an Agent nested in a graph-style export', () => {
    const result = parseAiAgentJson('graph.json', JSON.stringify({
      nodes: [{
        type: 'agent',
        data: {
          displayName: 'Support Agent',
          config: {
            systemInstruction: 'Trả lời ngắn gọn.',
            modelName: 'models/gemini-3.5-flash',
            tools: [{ name: 'search_catalog' }]
          }
        }
      }]
    }))

    expect(result.sourceFormat).toBe('google-agent-builder-graph')
    expect(result.agents[0]?.name).toBe('Support Agent')
    expect(result.agents[0]?.model).toBe('gemini-3.5-flash')
    expect(result.agents[0]?.tools).toEqual(['search_catalog'])
    expect(result.warnings.join(' ')).toContain('tool')
  })

  it('rejects JSON that does not expose any Agent instructions or model', () => {
    expect(() => parseAiAgentJson('empty.json', JSON.stringify({ projectId: 'x', metadata: { version: 1 } })))
      .toThrow('Không tìm thấy Agent')
  })

  it('keeps pipe exclusively as the batch separator', () => {
    expect(joinAiPosts(['A | B', 'C'])).toBe('A ｜ B\n|\nC')
  })
})
