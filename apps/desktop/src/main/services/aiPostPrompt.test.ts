import { describe, expect, it } from 'vitest'
import { aiPostLengthProfile, buildAiPostPrompt, planAiPostRequests } from './aiPostPrompt'
import type { GenerateAiPostsInput } from '../../shared/aiAgents'

const sample: GenerateAiPostsInput = {
  agentId:'api:fixture',action:'create',postCount:1,
  subject:'Đào đóng hộp',sourceInfo:'Đào vàng cam, cắt lát; dùng làm topping và đồ uống.',
  highlight:'',audience:'quán trà sữa',randomSourcePosts:[],
  postType:'Bán hàng',tone:'Chuyên nghiệp',structure:'Trộn bố cục',
  length:'Dài',emoji:true,hashtag:true,extraFields:{}
}

describe('AI post length is a real output contract',()=>{
  it('gives concrete character ranges and enough output budget for one long Vietnamese article',()=>{
    expect(aiPostLengthProfile('Dài')).toMatchObject({minChars:1200,maxChars:2000})
    const prompt = buildAiPostPrompt(sample)
    expect(prompt).toContain('1200–2000 ký tự')
    expect(prompt).toContain('không bịa')
    expect(planAiPostRequests(1,'Dài')).toEqual([{postCount:1,maxTokens:3856}])
    expect(planAiPostRequests(1,'Trung bình')[0]!.maxTokens).toBeGreaterThan(512)
  })
  it('batches many articles instead of shrinking per-post tokens or overflowing 8192',()=>{
    const batches=planAiPostRequests(7,'Dài')
    expect(batches.map(x=>x.postCount)).toEqual([2,2,2,1])
    expect(batches.every(x=>x.maxTokens<=8192 && x.maxTokens>=3856)).toBe(true)
    expect(planAiPostRequests(50,'Ngắn').reduce((sum,x)=>sum+x.postCount,0)).toBe(50)
  })
  it('explains the requested length for all three options without fabricating facts',()=>{
    for(const [length,min,max] of [['Ngắn',300,500],['Trung bình',650,1000],['Dài',1200,2000]] as const){
      const content=buildAiPostPrompt({...sample,length,structure:'Hook → Ý chính → CTA'})
      expect(content).toContain(String(min)+'–'+String(max)+' ký tự')
      expect(content).toContain('Chỉ dùng fact đã được cung cấp')
    }
  })
})
