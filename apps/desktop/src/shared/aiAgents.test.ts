import { describe, expect, it } from 'vitest'
import { assertGenerateAiPostsInput, joinAiPosts } from './aiAgents'

describe('AI Agent Builder contracts', () => {
  it('keeps pipe exclusively as the batch separator', () => {
    expect(joinAiPosts(['A | B', 'C'])).toBe('A ｜ B\n|\nC')
  })

  it('requires create source information', () => {
    expect(() => assertGenerateAiPostsInput({
      agentId: 'projects/p/locations/us-central1/reasoningEngines/1',
      action: 'create',
      postCount: 2,
      subject: '',
      sourceInfo: '',
      highlight: '',
      audience: '',
      randomSourcePosts: [],
      postType: 'Bán hàng',
      tone: 'Tự nhiên',
      structure: 'Hook → Nội dung → CTA',
      length: 'Ngắn',
      emoji: true,
      hashtag: false,
      extraFields: {}
    })).toThrow('sản phẩm / chủ đề')
  })

  it('requires at least one source post for random', () => {
    expect(() => assertGenerateAiPostsInput({
      agentId: 'projects/p/locations/us-central1/reasoningEngines/1',
      action: 'random',
      postCount: 3,
      subject: '',
      sourceInfo: '',
      highlight: '',
      audience: '',
      randomSourcePosts: [],
      postType: 'Review',
      tone: 'Tự nhiên',
      structure: 'Tự do',
      length: 'Trung bình',
      emoji: false,
      hashtag: false,
      extraFields: {}
    })).toThrow('Random')
  })
})
