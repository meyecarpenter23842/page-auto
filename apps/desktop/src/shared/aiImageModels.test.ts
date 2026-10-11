import { describe, expect, it } from 'vitest'
import { canGenerateImageOnConnection, imageModelOptionsForConnection, isNvidiaNimBase, nvidiaHostedImageEndpoint } from './aiImageModels'
import type { AiApiConnectionView } from './aiApiConnections'

const nvidia: AiApiConnectionView = {
  id:'00000000-0000-4000-8000-000000000000',name:'NVIDIA NIM',provider:'openai-compatible',
  baseUrl:'https://integrate.api.nvidia.com/v1',modelId:'meta/llama-3.2-11b-vision-instruct',isDefault:true,createdAt:0
}
describe('Image model capabilities are separate from post-writing models',()=>{
  it('does not treat 80 NVIDIA chat models as image generators',()=>{
    expect(isNvidiaNimBase(nvidia.baseUrl)).toBe(true)
    const list=imageModelOptionsForConnection(nvidia,[{id:nvidia.modelId,label:nvidia.modelId}])
    expect(list.map(item=>item.id)).toContain('black-forest-labs/flux.1-schnell')
    expect(list.every(item=>!item.id.startsWith('meta/'))).toBe(true)
    expect(canGenerateImageOnConnection(nvidia,nvidia.modelId,'new').ok).toBe(false)
    expect(nvidiaHostedImageEndpoint('black-forest-labs/flux.1-schnell'))
      .toBe('https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-schnell')
    expect(nvidiaHostedImageEndpoint('meta/llama-3.2-11b-vision-instruct')).toBe(null)
  })
  it('does not charge unsupported NVIDIA preview editing requests',()=>{
    expect(canGenerateImageOnConnection(nvidia,'black-forest-labs/flux.1-schnell','new').ok).toBe(true)
    expect(canGenerateImageOnConnection(nvidia,'black-forest-labs/flux.2-klein-4b','edit').ok).toBe(false)
    expect(canGenerateImageOnConnection(nvidia,'black-forest-labs/flux.1-kontext-dev','edit').ok).toBe(false)
  })
  it('distinguishes image-capable Gemini and general image models',()=>{
    const gemini={...nvidia,provider:'gemini' as const,baseUrl:'https://generativelanguage.googleapis.com/v1beta'}
    expect(canGenerateImageOnConnection(gemini,'gemini-2.5-flash','new').ok).toBe(false)
    expect(canGenerateImageOnConnection(gemini,'gemini-2.5-flash-image','new').ok).toBe(true)
    const openai={...nvidia,baseUrl:'https://api.openai.com/v1'}
    expect(canGenerateImageOnConnection(openai,'openai/gpt-oss-20b','new').ok).toBe(false)
    expect(canGenerateImageOnConnection(openai,'gpt-image-1','edit').ok).toBe(true)
  })
})
