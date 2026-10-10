import { describe, expect, it } from 'vitest'
import { validateAiApiDraft, validateAiApiEndpoint, validateAiApiModelId, aiApiChoice } from './aiApiConnections'
describe('AI open provider input validation', () => {
  it('permits public HTTPS provider endpoints and IDs', () => {
    expect(validateAiApiEndpoint('https://integrate.api.nvidia.com/v1/')).toBe('https://integrate.api.nvidia.com/v1')
    expect(validateAiApiModelId('meta/llama-3.1-8b-instruct')).toBe('meta/llama-3.1-8b-instruct')
    expect(aiApiChoice('some-id')).toBe('api:some-id')
  })
  it('rejects insecure/loopback endpoints and credentials embedded in URLs', () => {
    for (const url of ['http://example.com/v1','https://localhost/v1','https://127.0.0.1/v1',
      'https://alice:pass@example.com/v1','https://example.com/v1?secret=yes','file:///etc/hosts']) {
      expect(()=>validateAiApiEndpoint(url)).toThrow()
    }
  })
  it('keeps required key, name and model validation', () => {
    expect(()=>validateAiApiDraft({name:'NVIDIA',provider:'openai-compatible',baseUrl:'https://api.nvidia.com/v1',apiKey:'',modelId:'sample'})).toThrow('API Key')
    expect(()=>validateAiApiModelId('model id with spaces')).toThrow('Model ID')
  })
})
