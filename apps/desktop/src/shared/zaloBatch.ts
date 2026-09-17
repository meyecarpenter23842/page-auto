import {
  CONTENT_LIBRARY_IMAGE_MODES,
  CONTENT_LIBRARY_MISSING_POLICIES,
  type ContentLibraryImageConfig
} from './contentLibrary'
import {
  normalizeZaloBatchStartPayload,
  type ZaloBatchContentItemSnapshot,
  type ZaloBatchStartPayload
} from './zalo'

export interface ZaloBatchContentBindingSnapshot extends ZaloBatchContentItemSnapshot {
  image: ContentLibraryImageConfig
}

export interface ZaloBatchStartRequest extends Omit<ZaloBatchStartPayload, 'contentItems'> {
  contentItems: ZaloBatchContentBindingSnapshot[]
}

function normalizeImage(input: ContentLibraryImageConfig): ContentLibraryImageConfig {
  const mode = CONTENT_LIBRARY_IMAGE_MODES.includes(input.mode) ? input.mode : 'sequential'
  const missingPolicy = CONTENT_LIBRARY_MISSING_POLICIES.includes(input.missingPolicy) ? input.missingPolicy : 'text_only'
  const imagesPerPost = Math.max(1, Math.min(Math.floor(input.imagesPerPost || 1), 50))
  return {
    folderPath: input.folderPath.trim(),
    mode,
    imagesPerPost,
    missingPolicy
  }
}

export function normalizeZaloBatchStartRequest(input: ZaloBatchStartRequest): ZaloBatchStartRequest {
  const base = normalizeZaloBatchStartPayload({
    ...input,
    contentItems: input.contentItems.map((item) => ({
      sourceItemId: item.sourceItemId,
      name: item.name,
      variants: item.variants
    }))
  })

  const bindings = base.contentItems.map((item) => {
    const source = input.contentItems.find((candidate) => (
      candidate.sourceItemId === item.sourceItemId
      && candidate.name.trim() === item.name
    )) ?? input.contentItems.find((candidate) => candidate.sourceItemId === item.sourceItemId)
    const image = normalizeImage(source?.image ?? {
      folderPath: '',
      mode: 'sequential',
      imagesPerPost: 1,
      missingPolicy: 'text_only'
    })
    if (base.actions.sendAttachment && image.folderPath && image.imagesPerPost > 20) {
      throw new Error(`Zalo chỉ gửi tối đa 20 file/target; bài "${item.name}" đang cấu hình ${image.imagesPerPost} ảnh.`)
    }
    return { ...item, image }
  })

  return { ...base, contentItems: bindings }
}
