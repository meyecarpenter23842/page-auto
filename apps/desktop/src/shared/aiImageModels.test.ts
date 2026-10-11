import { describe, expect, it } from 'vitest'
import { isNvidiaNimBase, nvidiaHostedImageEndpoint } from './aiImageModels'

describe('Image API routing preserves exactly the selected model ID',()=>{
  it('identifies NVIDIA gateway without choosing a model',()=>{
    expect(isNvidiaNimBase('https://integrate.api.nvidia.com/v1')).toBe(true)
    expect(isNvidiaNimBase('https://ai.api.nvidia.com/v1')).toBe(true)
    expect(isNvidiaNimBase('https://api.openai.com/v1')).toBe(false)
    expect(nvidiaHostedImageEndpoint('black-forest-labs/flux.1-schnell'))
      .toBe('https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-schnell')
    expect(nvidiaHostedImageEndpoint('meta/llama-3.2-11b-vision-instruct'))
      .toBe('https://ai.api.nvidia.com/v1/genai/meta/llama-3.2-11b-vision-instruct')
    expect(nvidiaHostedImageEndpoint('custom/any-model-id'))
      .toBe('https://ai.api.nvidia.com/v1/genai/custom/any-model-id')
  })
  it('rejects malformed model paths for URL safety only',()=>{
    expect(()=>nvidiaHostedImageEndpoint('../image')).toThrow('đường dẫn')
    expect(()=>nvidiaHostedImageEndpoint('bad?query')).toThrow('Model ID')
  })
})
