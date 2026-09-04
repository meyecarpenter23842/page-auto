import { readdir } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { PageWallCanonicalPostSelection } from '../../shared/pageWall'
import type { PostingErrorCode } from '../../shared/posting'

const supportedImageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp'])

export interface PageWallResolvedMaterial {
  content: string
  imagePaths: string[]
  warnings: string[]
}

export type PageWallMaterialResolution =
  | { ok: true; material: PageWallResolvedMaterial }
  | { ok: false; code: PostingErrorCode; message: string }

export interface PageWallImageFileSource {
  list(folderPath: string): Promise<string[]>
}

class NodePageWallImageFileSource implements PageWallImageFileSource {
  async list(folderPath: string): Promise<string[]> {
    const entries = await readdir(folderPath, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile() && supportedImageExtensions.has(extname(entry.name).toLowerCase()))
      .map((entry) => join(folderPath, entry.name))
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' }))
  }
}

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}

function randomStart(random: () => number, length: number): number {
  if (length <= 1) return 0
  const normalized = Math.max(0, Math.min(0.999999999, random()))
  return Math.floor(normalized * length)
}

function selectSequential(paths: string[], count: number): string[] {
  return paths.slice(0, Math.min(count, paths.length))
}

function selectRandom(paths: string[], count: number, random: () => number): string[] {
  if (!paths.length) return []
  const start = randomStart(random, paths.length)
  const selected: string[] = []
  for (let offset = 0; offset < Math.min(count, paths.length); offset += 1) {
    const path = paths[(start + offset) % paths.length]
    if (path) selected.push(path)
  }
  return selected
}

export class PageWallMaterialResolver {
  constructor(
    private readonly files: PageWallImageFileSource = new NodePageWallImageFileSource(),
    private readonly random: () => number = Math.random
  ) {}

  async resolve(selection: PageWallCanonicalPostSelection): Promise<PageWallMaterialResolution> {
    if (!positiveInteger(selection.postId)) {
      return { ok: false, code: 'no_content', message: 'Bài viết canonical không có Post ID hợp lệ.' }
    }
    if (!Number.isSafeInteger(selection.variantIndex) || selection.variantIndex < 0) {
      return { ok: false, code: 'no_content', message: 'Biến thể bài viết canonical không hợp lệ.' }
    }

    const content = selection.content.trim()
    const folderPath = selection.image.folderPath.trim()
    const imagesPerPost = selection.image.imagesPerPost
    if (!positiveInteger(imagesPerPost) || imagesPerPost > 50) {
      return { ok: false, code: 'media_failed', message: 'Số ảnh của bài canonical phải từ 1 đến 50.' }
    }

    if (!folderPath) {
      if (!content) return { ok: false, code: 'no_content', message: 'Bài canonical chưa có nội dung hoặc folder ảnh.' }
      return { ok: true, material: { content, imagePaths: [], warnings: [] } }
    }

    if (selection.image.mode === 'filename_match') {
      return {
        ok: false,
        code: 'media_failed',
        message: 'Ảnh chế độ “Khớp Group UID” không áp dụng cho Đăng Tường. Hãy đổi bài sang ảnh Lần lượt/Ngẫu nhiên hoặc chọn ảnh tay.'
      }
    }

    let available: string[]
    try {
      available = await this.files.list(folderPath)
    } catch {
      if (selection.image.missingPolicy === 'text_only' && content) {
        return {
          ok: true,
          material: {
            content,
            imagePaths: [],
            warnings: ['Không đọc được folder ảnh canonical; bài sẽ dùng nội dung chữ.']
          }
        }
      }
      return { ok: false, code: 'media_failed', message: 'Không đọc được folder ảnh của bài canonical.' }
    }

    const imagePaths = selection.image.mode === 'random'
      ? selectRandom(available, imagesPerPost, this.random)
      : selectSequential(available, imagesPerPost)
    const missing = imagePaths.length < imagesPerPost

    if (missing && selection.image.missingPolicy === 'skip') {
      return {
        ok: false,
        code: 'missing_media',
        message: `Bài canonical cần ${imagesPerPost} ảnh nhưng chỉ tìm thấy ${imagePaths.length}; policy hiện tại là Bỏ qua khi thiếu ảnh.`
      }
    }
    if (!content && imagePaths.length === 0) {
      return { ok: false, code: 'no_content', message: 'Bài canonical không còn nội dung hoặc ảnh hợp lệ để Đăng Tường.' }
    }

    return {
      ok: true,
      material: {
        content,
        imagePaths,
        warnings: missing
          ? [`Bài canonical chỉ tìm thấy ${imagePaths.length}/${imagesPerPost} ảnh; tiếp tục theo policy text-only.`]
          : []
      }
    }
  }
}
