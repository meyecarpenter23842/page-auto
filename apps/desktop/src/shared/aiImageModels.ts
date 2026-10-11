import { validateAiApiModelId } from './aiApiConnections'

/** Identify NVIDIA NIM's gateway for image-API transport, never for model selection. */
export function isNvidiaNimBase(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl)
    return url.protocol === 'https:' &&
      ['integrate.api.nvidia.com','ai.api.nvidia.com'].includes(url.hostname.toLowerCase())
  } catch { return false }
}

/** Route exactly the model ID chosen by the user; no local model allowlist. */
export function nvidiaHostedImageEndpoint(modelId: string): string {
  const id = validateAiApiModelId(modelId)
  const segments = id.split('/')
  if (segments.some(segment=>segment === '.' || segment === '..' || !segment)) {
    throw new Error('Model ID có đường dẫn không hợp lệ.')
  }
  return 'https://ai.api.nvidia.com/v1/genai/' + segments.map(encodeURIComponent).join('/')
}
