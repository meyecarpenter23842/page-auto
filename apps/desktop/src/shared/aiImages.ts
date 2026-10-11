export const AI_IMAGE_IPC = {
  pickSource: 'ai-image:pick-source',
  chooseFolder: 'ai-image:choose-folder',
  generate: 'ai-image:generate',
  save: 'ai-image:save'
} as const

export type AiImageMode = 'new' | 'background' | 'product' | 'edit'
export type AiImageSize = '1024x1024' | '1536x1024' | '1024x1536'
export interface AiImageAsset { name: string; dataUrl: string }
export interface GenerateAiImagesInput {
  connectionId: string
  modelId: string
  mode: AiImageMode
  prompt: string
  count: number
  size: AiImageSize
  source?: AiImageAsset | null
  product?: AiImageAsset | null
}
export interface AiImageOutput { dataUrl: string; mimeType: string }
export interface SaveAiImagesInput {
  images: { dataUrl: string; name: string }[]
}
export const MAX_IMAGE_SOURCE_BYTES = 10 * 1024 * 1024
export const MAX_IMAGE_OUTPUT_BYTES = 16 * 1024 * 1024

export function validateAiImageInput(input: GenerateAiImagesInput): GenerateAiImagesInput {
  if (!input || typeof input.connectionId !== 'string' || !/^[a-f0-9-]{20,80}$/i.test(input.connectionId)) {
    throw new Error('Chưa chọn kết nối AI đã lưu.')
  }
  if (typeof input.modelId !== 'string' || !/^[\w.\-/:+@]{1,180}$/.test(input.modelId)) {
    throw new Error('Hãy chọn Model ảnh hợp lệ.')
  }
  if (!['new','background','product','edit'].includes(input.mode)) {
    throw new Error('Chế độ tạo ảnh không hợp lệ.')
  }
  if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 4000) {
    throw new Error('Mô tả ảnh phải từ 1 đến 4000 ký tự.')
  }
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > 4) {
    throw new Error('Mỗi lượt chỉ được tạo từ 1 đến 4 ảnh.')
  }
  if (!['1024x1024','1536x1024','1024x1536'].includes(input.size)) {
    throw new Error('Kích thước ảnh không hỗ trợ.')
  }
  if (input.mode === 'background' || input.mode === 'edit' || input.mode === 'product') {
    if (!input.source) throw new Error(input.mode === 'edit' ? 'Chưa chọn ảnh gốc.' : 'Chưa chọn ảnh nền.')
  }
  if (input.mode === 'product' && !input.product) throw new Error('Chưa chọn ảnh sản phẩm.')
  if (input.source) validateAiImageDataUrl(input.source.dataUrl, MAX_IMAGE_SOURCE_BYTES)
  if (input.product) validateAiImageDataUrl(input.product.dataUrl, MAX_IMAGE_SOURCE_BYTES)
  return input
}

export function validateAiImageDataUrl(value: unknown, maxBytes = MAX_IMAGE_OUTPUT_BYTES):
{ mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; base64: string } {
  if (typeof value !== 'string' || value.length > Math.ceil(maxBytes * 4 / 3) + 100) {
    throw new Error('Dữ liệu ảnh vượt giới hạn dung lượng.')
  }
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)
  const mimeType = match?.[1]
  const base64 = match?.[2]
  if (!mimeType || !base64 || Math.floor(base64.length * 3 / 4) > maxBytes) {
    throw new Error('Ảnh phải là PNG, JPEG hoặc WEBP hợp lệ.')
  }
  return { mimeType: mimeType as 'image/png' | 'image/jpeg' | 'image/webp', base64 }
}
