import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initializeDatabase } from '../database'
import { AiApiConnectionService, getAiApiHttpError, parseApiModels, withAiApiDeadline } from './aiApiConnectionService'

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from('encrypted:' + value),
    decryptString: (value: Buffer) => value.toString('utf8').replace(/^encrypted:/, '')
  }
}))

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir,{recursive:true,force:true}) })
function setup(fake: typeof fetch) {
  const directory = mkdtempSync(join(tmpdir(),'page-auto-ai-api-test-'))
  dirs.push(directory)
  const runtime = initializeDatabase(join(directory,'page-auto.sqlite'))
  return { runtime, service: new AiApiConnectionService(runtime.client,fake) }
}
const draft = {
  provider: 'openai-compatible' as const,
  name: 'NVIDIA Model',
  baseUrl: 'https://integrate.api.nvidia.com/v1',
  apiKey: 'sensitive-test-key',
  modelId: 'example/test-model'
}
function postInput(agentId: string) {
  return {
    agentId, action:'create' as const, postCount:2,
    subject:'Chủ đề',sourceInfo:'Thông tin gốc',highlight:'',audience:'',
    randomSourcePosts:[],postType:'Chia sẻ',tone:'Tự nhiên',structure:'Trộn bố cục',
    length:'Trung bình',emoji:true,hashtag:false,extraFields:{}
  }
}

describe('AI API connections and model discovery', () => {
  it('limits slow model checks, aborts network operations and gives a useful error', async () => {
    vi.useFakeTimers()
    try {
      let signal: AbortSignal | undefined
      const hanging = withAiApiDeadline(async (s) => {
        signal = s
        return new Promise<string>(() => undefined)
      }, 60_000)
      const expected = expect(hanging).rejects.toThrow('60 giây')
      await vi.advanceTimersByTimeAsync(60_000)
      await expected
      expect(signal?.aborted).toBe(true)
      const successful = await withAiApiDeadline(async () => 'OK', 60_000)
      expect(successful).toBe('OK')
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
  it('stops when HTTP headers arrive but the response body never finishes', async () => {
    vi.useFakeTimers()
    const stalledFetch = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"choices":['))
        // Simulate a provider that never closes its response stream.
      }
    }), { status: 200 })) as unknown as typeof fetch
    const { runtime, service } = setup(stalledFetch)
    try {
      const pending = service.test({...draft, modelId: 'slow-model'})
      const expected = expect(pending).rejects.toThrow('60 giây')
      await vi.advanceTimersByTimeAsync(60_000)
      await expected
      expect(stalledFetch).toHaveBeenCalledTimes(1)
    } finally {
      runtime.close()
      vi.useRealTimers()
    }
  })
  it('aborts a slow model test on user cancellation instead of waiting for its deadline', async () => {
    const pendingNetwork = vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('network aborted')), { once: true })
      })
    ) as unknown as typeof fetch
    const { runtime, service } = setup(pendingNetwork)
    const cancel = new AbortController()
    try {
      const pending = service.test({ ...draft, timeoutMs: 120_000 }, cancel.signal)
      cancel.abort()
      await expect(pending).rejects.toThrow('Đã hủy kiểm tra')
      expect(pendingNetwork).toHaveBeenCalledTimes(1)
    } finally {
      runtime.close()
    }
  })
  it('rejects unsupported test timeouts instead of accepting arbitrary remote deadlines', async () => {
    const fake = vi.fn() as unknown as typeof fetch
    const { runtime, service } = setup(fake)
    try {
      await expect(service.test({ ...draft, timeoutMs: 999_999 })).rejects.toThrow('60 hoặc 120')
      expect(fake).not.toHaveBeenCalled()
    } finally {
      runtime.close()
    }
  })
  it('shows only a safe provider code, never echoed free-text errors or API credentials', async () => {
    const fake = vi.fn(async () => new Response(JSON.stringify({
      error: { code: 'model_not_found', message: 'Never display sensitive-test-key' }
    }), { status: 404, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch
    const { runtime, service } = setup(fake)
    try {
      const pending = service.test(draft)
      await expect(pending).rejects.toThrow('model_not_found')
      await expect(service.test(draft)).rejects.not.toThrow('sensitive-test-key')
    } finally {
      runtime.close()
    }
  })
  it('distinguishes provider access, unsupported model and quota responses', () => {
    expect(getAiApiHttpError(401)).toContain('API Key')
    expect(getAiApiHttpError(403)).toContain('quyền')
    expect(getAiApiHttpError(404)).toContain('endpoint')
    expect(getAiApiHttpError(429)).toContain('hạn mức')
  })
  it('parses provider catalogs without inventing models', () => {
    expect(parseApiModels('openai-compatible',{data:[{id:'a/model'},{id:'b-model'},{id:'a/model'}]}))
      .toEqual([{id:'a/model',label:'a/model'},{id:'b-model',label:'b-model'}])
    expect(parseApiModels('gemini',{models:[
      {name:'models/gemini-test',supportedGenerationMethods:['generateContent']},
      {name:'models/embedding-only',supportedGenerationMethods:['embedContent']}
    ]})).toEqual([{id:'gemini-test',label:'gemini-test'}])
    expect(parseApiModels('anthropic',{data:[{id:'claude-test',display_name:'Claude'}]}))
      .toEqual([{id:'claude-test',label:'claude-test'}])
    expect(()=>parseApiModels('openai-compatible',{items:[]})).toThrow('danh sách model')
  })
  it('loads via NVIDIA-compatible /models and tests /chat/completions', async () => {
    const requests: {url:string,authorization:string|undefined,method:string}[] = []
    const fetchMock = vi.fn(async (url: string|URL|Request, init?:RequestInit) => {
      const href=String(url)
      const headers=init?.headers as Record<string,string>
      requests.push({url:href,authorization:headers.Authorization,method:init?.method??'GET'})
      return new Response(JSON.stringify(href.endsWith('/models')
        ? {data:[{id:'nvidia/test-text'}]}
        : {choices:[{message:{content:['Bài 1','Bài 2'].join('\n|\n')}}]}),{status:200})
    }) as unknown as typeof fetch
    const {runtime,service}=setup(fetchMock)
    expect(await service.discover(draft)).toEqual([{id:'nvidia/test-text',label:'nvidia/test-text'}])
    expect(await service.test({...draft,modelId:'nvidia/test-text'})).toBe(true)
    const saved=service.save({...draft,modelId:'nvidia/test-text'})
    expect(saved).toHaveLength(1)
    expect(saved[0]?.modelId).toBe('nvidia/test-text')
    expect(JSON.stringify(saved)).not.toContain(draft.apiKey)
    const row=runtime.client.prepare("SELECT value FROM app_settings WHERE key='ai.api.connections.encrypted.v1'").get() as {value:string}
    expect(row.value).not.toContain(draft.apiKey)
    const id=saved[0]!.id
    const generated=await service.generate(postInput('api:'+id))
    expect(generated.model).toBe('nvidia/test-text')
    expect(generated.posts).toHaveLength(2)
    expect(requests.map(x=>x.url)).toContain('https://integrate.api.nvidia.com/v1/models')
    expect(requests.map(x=>x.url)).toContain('https://integrate.api.nvidia.com/v1/chat/completions')
    expect(requests.every(x=>x.authorization==='Bearer sensitive-test-key')).toBe(true)
    expect(service.updateModel(id, 'example/second-model')[0]?.modelId).toBe('example/second-model')
    expect(new AiApiConnectionService(runtime.client,fetchMock).list()[0]?.modelId).toBe('example/second-model')
    expect(()=>service.updateModel(id,'bad model')).toThrow('Model ID')
    expect(service.remove(id)).toEqual([])
    runtime.close()
  })
  it('uses native Gemini and Anthropic authentication and routes', async () => {
    const seen:{url:string,headers:Record<string,string>}[]=[]
    const fake=vi.fn(async (url:string|URL|Request,init?:RequestInit)=>{
      const href=String(url);const headers=init?.headers as Record<string,string>
      seen.push({url:href,headers})
      const data=href.includes('generativelanguage')
        ? {models:[{name:'models/gemini-demo',supportedGenerationMethods:['generateContent']}]}
        : {data:[{id:'claude-demo'}]}
      return new Response(JSON.stringify(data),{status:200})
    }) as unknown as typeof fetch
    const {runtime,service}=setup(fake)
    expect((await service.discover({provider:'gemini',apiKey:'key-a',baseUrl:'https://generativelanguage.googleapis.com/v1beta'}))[0]?.id).toBe('gemini-demo')
    expect((await service.discover({provider:'anthropic',apiKey:'key-b',baseUrl:'https://api.anthropic.com/v1'}))[0]?.id).toBe('claude-demo')
    expect(seen[0]?.headers['x-goog-api-key']).toBe('key-a')
    expect(seen[1]?.headers['x-api-key']).toBe('key-b')
    expect(seen[1]?.headers['anthropic-version']).toBe('2023-06-01')
    runtime.close()
  })
  it('rejects unsafe URLs and never exposes remote HTTP response bodies', async () => {
    const fake=vi.fn(async()=>new Response(JSON.stringify({error:{message:'secret-echo'}}),{status:401})) as unknown as typeof fetch
    const {runtime,service}=setup(fake)
    await expect(service.discover({...draft,baseUrl:'http://localhost:9000/v1'})).rejects.toThrow('HTTPS')
    await expect(service.discover({...draft,baseUrl:'https://127.0.0.1/v1'})).rejects.toThrow('HTTPS')
    await expect(service.discover(draft)).rejects.toThrow('HTTP 401')
    await expect(service.discover(draft)).rejects.not.toThrow('secret-echo')
    expect(fake).toHaveBeenCalledTimes(2)
    runtime.close()
  })
})
