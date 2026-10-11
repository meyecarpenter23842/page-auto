import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { decodeAiImage, generateAiImagesFromProvider, saveAiImageFiles } from './aiImageService'

const imageB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/qT8AAAAASUVORK5CYII='
const image = 'data:image/png;base64,' + imageB64
const asset = {name:'source.png',dataUrl:image}
const request = {
  connectionId:'00000000-0000-4000-8000-000000000000',
  modelId:'gpt-image-1',mode:'new' as const,
  prompt:'A clean studio photo',count:2,size:'1024x1024' as const
}
const credentials = {provider:'openai-compatible' as const,baseUrl:'https://api.openai.com/v1',apiKey:'secret-not-for-logs'}
const dirs: string[] = []
afterEach(()=>{vi.restoreAllMocks();for(const d of dirs.splice(0)) rmSync(d,{recursive:true,force:true})})

describe('real AI image provider transport', () => {
  it('sends text-only generation to images/generations with stored key, accepts binary PNG', async () => {
    const calls: {url:string;init:RequestInit}[]=[]
    const mockFetch = vi.fn(async (url: string,init: RequestInit) => {
      calls.push({url,init})
      return new Response(JSON.stringify({data:[{b64_json:imageB64}]}),{status:200})
    }) as unknown as typeof fetch
    const results = await generateAiImagesFromProvider(credentials,request,mockFetch)
    expect(results).toEqual([{dataUrl:image,mimeType:'image/png'},{dataUrl:image,mimeType:'image/png'}])
    expect(calls).toHaveLength(2)
    const firstCall = calls[0]
    if (!firstCall) throw new Error('Missing first provider request')
    expect(firstCall.url).toBe('https://api.openai.com/v1/images/generations')
    expect(firstCall.init.headers).toMatchObject({Authorization:'Bearer secret-not-for-logs'})
    expect(JSON.parse(String(firstCall.init.body))).toMatchObject({model:'gpt-image-1',n:1})
  })
  it('sends editing reference as multipart, never as a fake text-only request', async () => {
    const calls: RequestInit[]=[]
    const mockFetch = vi.fn(async (_url: string,init: RequestInit) => {
      calls.push(init)
      return new Response(JSON.stringify({data:[{b64_json:imageB64}]}))
    }) as unknown as typeof fetch
    await generateAiImagesFromProvider(credentials,{...request,count:1,mode:'edit',source:asset},mockFetch)
    const body = calls[0]?.body
    if (!(body instanceof FormData)) throw new Error('Expected multipart request')
    expect(body).toBeInstanceOf(FormData)
    expect(body.getAll('image')).toHaveLength(1)
    expect(body.get('prompt')).toContain('Edit the supplied source image')
    await generateAiImagesFromProvider(credentials,{...request,count:1,mode:'product',source:asset,product:asset},mockFetch)
    const composite = calls[1]?.body
    if (!(composite instanceof FormData)) throw new Error('Expected composite multipart request')
    expect(composite.getAll('image[]')).toHaveLength(2)
  })
  it('reads Gemini image inlineData and rejects text-only or unsupported providers', async () => {
    const mockFetch = vi.fn(async (_url:string,init:RequestInit) => {
      expect(init.headers).toMatchObject({'x-goog-api-key':'test-key'})
      const body=JSON.parse(String(init.body))
      expect(body.generationConfig.responseModalities).toContain('IMAGE')
      return new Response(JSON.stringify({candidates:[{content:{parts:[{inlineData:{mimeType:'image/png',data:imageB64}}]}}]}))
    }) as unknown as typeof fetch
    const results=await generateAiImagesFromProvider({provider:'gemini',baseUrl:'https://generativelanguage.googleapis.com/v1beta',apiKey:'test-key'},
      {...request,modelId:'gemini-2.5-flash-image',count:1},mockFetch)
    expect(results.at(0)?.dataUrl).toBe(image)
    await expect(generateAiImagesFromProvider({...credentials,provider:'anthropic'},request,mockFetch)).rejects.toThrow('Anthropic')
    const textOnly = vi.fn(async()=>new Response(JSON.stringify({choices:[{message:{content:'hello'}}]}))) as unknown as typeof fetch
    await expect(generateAiImagesFromProvider(credentials,{...request,count:1},textOnly)).rejects.toThrow('không trả ảnh')
  })
  it('rejects false MIME declarations and remote URLs instead of downloading unknown hosts',async()=>{
    expect(()=>decodeAiImage('data:image/jpeg;base64,'+imageB64)).toThrow('không khớp')
    const remote=vi.fn(async()=>new Response(JSON.stringify({data:[{url:'https://example.com/image.png'}]}))) as unknown as typeof fetch
    await expect(generateAiImagesFromProvider(credentials,{...request,count:1},remote)).rejects.toThrow('URL')
  })
})

describe('Windows image export safety', () => {
  it('writes real unique files and does not allow renderer supplied path traversal',async()=>{
    const dir=mkdtempSync(join(tmpdir(),'page-auto-image-'));dirs.push(dir)
    const first=await saveAiImageFiles(dir,{images:[{dataUrl:image,name:'product-01'},{dataUrl:image,name:'product-01'}]})
    const second=await saveAiImageFiles(dir,{images:[{dataUrl:image,name:'../product-01.png'}]})
    expect(readdirSync(dir).sort()).toEqual(['product-01-1.png','product-01.png','product-01-2.png'].sort())
    expect(first).toHaveLength(2)
    expect(second[0]).toContain(dir)
    const firstFile = first[0]
    if (!firstFile) throw new Error('First file missing')
    expect(readFileSync(firstFile).subarray(0,8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]))
    await expect(saveAiImageFiles(dir,{images:[]})).rejects.toThrow('1 đến 40')
  })
})
