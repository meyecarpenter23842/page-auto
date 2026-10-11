import { writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import {
  MAX_IMAGE_OUTPUT_BYTES, MAX_IMAGE_SOURCE_BYTES, type AiImageOutput,
  type GenerateAiImagesInput, type SaveAiImagesInput, validateAiImageDataUrl, validateAiImageInput
} from '../../shared/aiImages'
import type { AiApiProvider } from '../../shared/aiApiConnections'
import { isNvidiaNimBase, nvidiaHostedImageEndpoint } from '../../shared/aiImageModels'

type Credentials = { provider: AiApiProvider; baseUrl: string; apiKey: string }
const MAX_RESPONSE_BYTES = 24 * 1024 * 1024
const DEADLINE_MS = 120_000
const extensions = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' } as const

export function decodeAiImage(dataUrl: string, maxBytes = MAX_IMAGE_OUTPUT_BYTES): { mimeType: keyof typeof extensions; bytes: Buffer } {
  const parsed = validateAiImageDataUrl(dataUrl, maxBytes)
  const bytes = Buffer.from(parsed.base64, 'base64')
  if (!bytes.length || bytes.length > maxBytes) throw new Error('Dữ liệu ảnh không hợp lệ hoặc quá lớn.')
  const png = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
  const jpeg = bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  const webp = bytes.length >= 12 && bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP'
  if (!(parsed.mimeType === 'image/png' && png || parsed.mimeType === 'image/jpeg' && jpeg || parsed.mimeType === 'image/webp' && webp)) {
    throw new Error('File ảnh không khớp định dạng khai báo.')
  }
  return { mimeType: parsed.mimeType, bytes }
}

async function limitedResponse(response: Response): Promise<Record<string, unknown>> {
  const length = Number(response.headers.get('content-length'))
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) throw new Error('Phản hồi ảnh vượt giới hạn 24 MB.')
  const reader = response.body?.getReader()
  if (!reader) throw new Error('API không trả dữ liệu ảnh.')
  let total = 0
  const parts: Buffer[] = []
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      total += next.value.byteLength
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw new Error('Phản hồi ảnh vượt giới hạn 24 MB.')
      }
      parts.push(Buffer.from(next.value))
    }
  } finally {
    reader.releaseLock()
  }
  try {
    const result: unknown = JSON.parse(Buffer.concat(parts).toString('utf8'))
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error()
    return result as Record<string, unknown>
  } catch { throw new Error('API ảnh trả JSON không hợp lệ.') }
}

/** NVIDIA image NIM artifacts are base64 blobs, not OpenAI b64_json responses. */
export function outputFromNvidiaArtifact(json: Record<string, unknown>): AiImageOutput {
  const artifact = Array.isArray(json.artifacts) ? json.artifacts[0] as Record<string, unknown> | undefined : undefined
  const b64 = typeof artifact?.base64 === 'string' ? artifact.base64 : null
  if (!b64) throw new Error('NVIDIA không trả ảnh trong artifacts[0].base64. Kiểm tra quyền model và hạn mức API.')
  const raw = b64.startsWith('data:') ? b64.slice(b64.indexOf(',') + 1) : b64
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw) || raw.length > Math.ceil(MAX_IMAGE_OUTPUT_BYTES * 4 / 3) + 100) {
    throw new Error('NVIDIA trả dữ liệu ảnh không hợp lệ hoặc quá lớn.')
  }
  const bytes = Buffer.from(raw, 'base64')
  const mime = bytes.length >= 8 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    ? 'image/png' : bytes.length >= 3 && bytes[0]===255 && bytes[1]===216 && bytes[2]===255
      ? 'image/jpeg' : bytes.length >= 12 && bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP'
        ? 'image/webp' : null
  if (!mime || bytes.length > MAX_IMAGE_OUTPUT_BYTES) throw new Error('NVIDIA không trả ảnh PNG, JPG hoặc WEBP hợp lệ.')
  const dataUrl = 'data:'+mime+';base64,'+raw
  decodeAiImage(dataUrl)
  return {dataUrl,mimeType:mime}
}

function outputFromResponse(provider: AiApiProvider, json: Record<string, unknown>): AiImageOutput {
  let base64: string | undefined
  let mimeType = 'image/png'
  if (provider === 'gemini') {
    const candidate = Array.isArray(json.candidates) ? json.candidates[0] as Record<string, unknown> | undefined : undefined
    const content = candidate?.content as Record<string, unknown> | undefined
    const parts = Array.isArray(content?.parts) ? content.parts as Record<string, unknown>[] : []
    const image = parts.map(part => part.inlineData ?? part.inline_data).find(value => value && typeof value === 'object') as Record<string,unknown> | undefined
    base64 = typeof image?.data === 'string' ? image.data : undefined
    mimeType = typeof image?.mimeType === 'string' ? image.mimeType : typeof image?.mime_type === 'string' ? image.mime_type : mimeType
  } else {
    const item = Array.isArray(json.data) ? json.data[0] as Record<string, unknown> | undefined : undefined
    base64 = typeof item?.b64_json === 'string' ? item.b64_json : undefined
  }
  if (!base64) throw new Error('Model chỉ trả văn bản/URL hoặc không trả ảnh Base64. Hãy chọn model hỗ trợ tạo ảnh thực tế.')
  const dataUrl = 'data:' + mimeType + ';base64,' + base64
  const decoded = decodeAiImage(dataUrl)
  return { dataUrl, mimeType: decoded.mimeType }
}

function promptForMode(input: GenerateAiImagesInput): string {
  if (input.mode === 'product') return 'Use first supplied image as scene/background and second supplied image as product reference. Compose the product into the scene while respecting its recognizable shape and colors. ' + input.prompt.trim()
  if (input.mode === 'background') return 'Use the supplied image as a visual background reference for the newly created image. ' + input.prompt.trim()
  if (input.mode === 'edit') return 'Edit the supplied source image following these instructions; preserve its intended subject unless explicitly asked to change it. ' + input.prompt.trim()
  return input.prompt.trim()
}

export async function generateAiImagesFromProvider(
  credentials: Credentials, input: GenerateAiImagesInput, fetchImpl: typeof fetch = fetch
): Promise<AiImageOutput[]> {
  validateAiImageInput(input)
  if (credentials.provider === 'anthropic') {
    throw new Error('Kết nối Anthropic hiện không có endpoint tạo ảnh; API này chỉ hỗ trợ đọc/hiểu ảnh. Chọn một kết nối có API tạo ảnh.')
  }
  const nvidia = isNvidiaNimBase(credentials.baseUrl)
  // Route by provider protocol and exact user-selected model, not guessed capabilities.
  const nvidiaEndpoint = nvidia ? nvidiaHostedImageEndpoint(input.modelId) : null
  const output: AiImageOutput[] = []
  for (let i=0; i<input.count; i++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), DEADLINE_MS)
    try {
      let path: string
      let body: BodyInit
      const headers: Record<string,string> = {}
      if (nvidia && nvidiaEndpoint) {
        path = ''
        headers.Authorization = 'Bearer ' + credentials.apiKey
        headers.Accept = 'application/json'
        headers['Content-Type'] = 'application/json'
        const [width,height] = input.size.split('x').map(Number)
        const inputImages = [input.source,input.product].filter((asset): asset is NonNullable<typeof asset> => Boolean(asset))
        // Include every image selected by the user. A provider rejecting a mode or
        // parameter reports HTTP 4xx, not a speculative application-side block.
        const imageInputs = inputImages.map(asset=>{
          const decoded = decodeAiImage(asset.dataUrl, MAX_IMAGE_SOURCE_BYTES)
          return 'data:'+decoded.mimeType+';base64,'+decoded.bytes.toString('base64')
        })
        const flux1 = /flux\.1-(?:dev|schnell)$/i.test(input.modelId)
        const schnell = /flux\.1-schnell$/i.test(input.modelId)
        const payload: Record<string, unknown> = {
          prompt:promptForMode(input),width,height,seed:0,samples:1,
          ...(flux1
            ? {mode:'base',cfg_scale:schnell ? 0 : 5,steps:schnell ? 4 : 50}
            : {mode:inputImages.length ? 'Image Editing' : 'Image Generation',cfg_scale:0,steps:4}),
          image:imageInputs[0] ?? null
        }
        if (imageInputs.length > 1) payload.reference_images = imageInputs
        body = JSON.stringify(payload)
      } else if (credentials.provider === 'gemini') {
        path = 'models/' + encodeURIComponent(input.modelId) + ':generateContent'
        headers['x-goog-api-key'] = credentials.apiKey
        headers['Content-Type'] = 'application/json'
        const parts: Record<string, unknown>[] = [{text:promptForMode(input)}]
        for (const source of [input.source, input.product]) {
          if (!source) continue
          const decoded = decodeAiImage(source.dataUrl, MAX_IMAGE_SOURCE_BYTES)
          parts.push({inlineData:{mimeType:decoded.mimeType,data:decoded.bytes.toString('base64')}})
        }
        const aspectRatio = input.size === '1024x1024' ? '1:1' : input.size === '1536x1024' ? '3:2' : '2:3'
        body = JSON.stringify({
          contents:[{role:'user',parts}],
          generationConfig:{responseModalities:['IMAGE'],imageConfig:{aspectRatio}}
        })
      } else {
        headers.Authorization = 'Bearer ' + credentials.apiKey
        const sources = [input.source,input.product].filter((x): x is NonNullable<typeof x> => Boolean(x))
        if (!sources.length) {
          path = 'images/generations'
          const payload: Record<string,unknown> = {model:input.modelId,prompt:promptForMode(input),n:1,size:input.size}
          if (!input.modelId.startsWith('gpt-image-')) payload.response_format = 'b64_json'
          body = JSON.stringify(payload)
          headers['Content-Type'] = 'application/json'
        } else {
          path = 'images/edits'
          const form = new FormData()
          form.append('model',input.modelId)
          form.append('prompt',promptForMode(input))
          form.append('size',input.size)
          form.append('n','1')
          for(const source of sources) {
            const decoded = decodeAiImage(source.dataUrl,MAX_IMAGE_SOURCE_BYTES)
            form.append(sources.length > 1 ? 'image[]' : 'image',
              new Blob([new Uint8Array(decoded.bytes)],{type:decoded.mimeType}),
              basename(source.name || 'source') + extensions[decoded.mimeType])
          }
          body = form
        }
      }
      const endpoint = nvidiaEndpoint ?? (credentials.baseUrl.replace(/\/+$/,'') + '/' + path)
      let response: Response
      try { response = await fetchImpl(endpoint,{method:'POST',headers,body,redirect:'error',signal:controller.signal}) }
      catch { throw new Error(controller.signal.aborted ? 'Tạo ảnh quá thời gian 120 giây.' : 'Không kết nối được endpoint tạo ảnh HTTPS.') }
      if (!response.ok) {
        const reason = response.status === 401 ? 'API key không hợp lệ.'
          : response.status === 403 ? 'API key không có quyền gọi endpoint/model này.'
          : response.status === 404 ? 'Endpoint hoặc Model ID không tồn tại trên API đã chọn.'
          : response.status === 422 || response.status === 400 ? 'Model không chấp nhận chế độ, ảnh đầu vào hoặc tham số đã chọn.'
          : response.status === 429 ? 'Hết lượt hoặc vượt giới hạn tốc độ/tín dụng.'
          : response.status >= 500 ? 'Máy chủ AI đang lỗi.' : 'Kiểm tra API và khả năng của model.'
        throw new Error('API tạo ảnh trả HTTP ' + response.status + ': ' + reason)
      }
      const parsed = await limitedResponse(response)
      output.push(nvidiaEndpoint ? outputFromNvidiaArtifact(parsed) : outputFromResponse(credentials.provider,parsed))
    } finally { clearTimeout(timer) }
  }
  return output
}

export async function saveAiImageFiles(folder: string, payload: SaveAiImagesInput): Promise<string[]> {
  if (!folder || !payload || !Array.isArray(payload.images) || payload.images.length < 1 || payload.images.length > 40) {
    throw new Error('Chọn từ 1 đến 40 ảnh để lưu vào thư mục đã chọn.')
  }
  const saved: string[] = []
  for (const item of payload.images) {
    const data = decodeAiImage(item?.dataUrl)
    const sanitized = (typeof item.name === 'string' ? item.name : 'anh-ai')
      .replace(/\.[a-z0-9]{1,5}$/i,'').replace(/[^a-zA-Z0-9_-]/g,'-').replace(/-+/g,'-').replace(/^-+|-+$/g,'').slice(0,72) || 'anh-ai'
    let destination = ''
    for (let n = 0; n < 1000; n++) {
      const name = sanitized + (n ? '-' + n : '') + extensions[data.mimeType]
      const candidate = join(folder,name)
      try {
        await writeFile(candidate,data.bytes,{flag:'wx'})
        destination = candidate
        break
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    }
    if (!destination) throw new Error('Không tạo được tên file ảnh không trùng.')
    saved.push(destination)
  }
  return saved
}
