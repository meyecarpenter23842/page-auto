import { describe, expect, it } from 'vitest'
import { validateAiImageInput, validateAiImageDataUrl } from './aiImages'

const connectionId = '00000000-0000-4000-8000-000000000000'
const fakeImage = {name:'photo.png',dataUrl:'data:image/png;base64,iVBORw0KGgo='}
const valid = () => ({connectionId,modelId:'gpt-image-1',mode:'new' as const,prompt:'Studio product photo',count:2,size:'1024x1024' as const})

describe('AI image input guardrails', () => {
  it('allows typed image generation without affecting article generation', () => {
    expect(validateAiImageInput(valid()).count).toBe(2)
    expect(validateAiImageInput({...valid(),mode:'product',source:fakeImage,product:fakeImage}).mode).toBe('product')
    expect(validateAiImageDataUrl(fakeImage.dataUrl).mimeType).toBe('image/png')
  })
  it('requires source files per mode, validates quantity and public-safe image input', () => {
    expect(()=>validateAiImageInput({...valid(),mode:'background'})).toThrow('ảnh nền')
    expect(()=>validateAiImageInput({...valid(),mode:'edit'})).toThrow('ảnh gốc')
    expect(()=>validateAiImageInput({...valid(),mode:'product',source:fakeImage})).toThrow('ảnh sản phẩm')
    expect(()=>validateAiImageInput({...valid(),count:5})).toThrow('1 đến 4')
    expect(()=>validateAiImageInput({...valid(),prompt:''})).toThrow('Mô tả')
    expect(()=>validateAiImageDataUrl('data:text/html;base64,YWJj')).toThrow()
    expect(()=>validateAiImageDataUrl('data:image/png;base64,AA$%')).toThrow()
    expect(()=>validateAiImageDataUrl(fakeImage.dataUrl,4)).toThrow()
  })
})
