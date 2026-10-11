import type { AiApiConnectionView, AiApiModel } from './aiApiConnections'
import type { AiImageMode } from './aiImages'

/** NVIDIA's hosted image NIM APIs do not use the chat-completions image path.
 *  This registry is only for known documented hosted endpoints; no guessing paths. */
export const NVIDIA_IMAGE_MODELS = [
  { id: 'black-forest-labs/flux.1-schnell', title: 'FLUX.1 Schnell · Tạo ảnh', generation: true, editing: false },
  { id: 'black-forest-labs/flux.1-dev', title: 'FLUX.1 Dev · Tạo ảnh', generation: true, editing: false },
  { id: 'black-forest-labs/flux.2-klein-4b', title: 'FLUX.2 Klein 4B · Tạo ảnh', generation: true, editing: false },
  { id: 'black-forest-labs/flux.1-kontext-dev', title: 'FLUX.1 Kontext Dev · Chỉnh ảnh (preview hạn chế)', generation: false, editing: false }
] as const

export function isNvidiaNimBase(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl)
    return url.protocol === 'https:' &&
      ['integrate.api.nvidia.com','ai.api.nvidia.com'].includes(url.hostname.toLowerCase())
  } catch { return false }
}

export function nvidiaHostedImageEndpoint(modelId: string): string | null {
  const model = NVIDIA_IMAGE_MODELS.find(x => x.id === modelId)
  return model ? 'https://ai.api.nvidia.com/v1/genai/' + model.id : null
}

export function canGenerateImageOnConnection(connection: Pick<AiApiConnectionView,'provider'|'baseUrl'>,
  modelId: string, mode: AiImageMode): { ok: true } | { ok: false; reason: string } {
  if (isNvidiaNimBase(connection.baseUrl)) {
    const entry = NVIDIA_IMAGE_MODELS.find(x=>x.id===modelId)
    if (!entry) return {ok:false,reason:'Đây không phải model tạo ảnh NVIDIA đã được hỗ trợ. Chọn FLUX.1 Schnell, FLUX.1 Dev hoặc FLUX.2 Klein.'}
    if (mode !== 'new') return {ok:false,reason:'Endpoint NVIDIA NIM preview hiện không nhận ảnh tùy ý để chỉnh/ghép. Dùng kết nối ảnh OpenAI/Gemini hỗ trợ ảnh tham chiếu.'}
    if (!entry.generation) return {ok:false,reason:'Model NVIDIA này yêu cầu ảnh tham chiếu, còn endpoint preview không cho tải ảnh tùy ý.'}
    return {ok:true}
  }
  if (connection.provider === 'anthropic') return {ok:false,reason:'Kết nối Anthropic không cung cấp endpoint tạo ảnh.'}
  if (connection.provider === 'gemini' && !(/image/i.test(modelId) && !/^imagen-/i.test(modelId))) {
    return {ok:false,reason:'Chọn model Gemini hỗ trợ tạo ảnh (ví dụ Gemini Flash Image); Imagen cần endpoint riêng.'}
  }
  if (connection.provider === 'openai-compatible' &&
      /(llama|nemotron|gpt-oss|deepseek|qwen3-.*instruct|claude)/i.test(modelId)) {
    return {ok:false,reason:'Đây là model ngôn ngữ, không thể tạo ảnh. Hãy chọn model image generation.'}
  }
  return {ok:true}
}

export function imageModelOptionsForConnection(connection: AiApiConnectionView,
  discovered: readonly AiApiModel[]): AiApiModel[] {
  if (isNvidiaNimBase(connection.baseUrl)) return NVIDIA_IMAGE_MODELS.filter(x=>x.generation).map(x=>({id:x.id,label:x.title}))
  if (connection.provider==='gemini') return discovered.filter(x=>/image/i.test(x.id) && !/^imagen-/i.test(x.id))
  if (connection.provider==='anthropic') return []
  return discovered.filter(x=>/(image|dall-e|flux|stable-diffusion)/i.test(x.id))
}
