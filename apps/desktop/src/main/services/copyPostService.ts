import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { access, mkdir, open, rename, rm } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type {
  CopyPostMedia,
  CopyPostSaveItem,
  CopyPostSaveItemResult,
  CopyPostSaveRequest,
  CopyPostSaveResult,
  CopyPostScanItem,
  CopyPostScanRequest,
  CopyPostType
} from '../../shared/copyPost'
import { CanonicalPostRepository } from '../database/canonicalPostRepository'

const GRAPH_ROOT = 'https://graph.facebook.com'
const MAX_GRAPH_PAGES_PER_SOURCE = 10
const MAX_MEDIA_BYTES = 1024 * 1024 * 1024
const GRAPH_FIELDS = 'id,message,created_time,permalink_url,attachments{media_type,type,url,target,media,subattachments{media_type,type,url,target,media}}'

type FetchLike = typeof fetch

interface GraphAttachment {
  media_type?: string
  type?: string
  url?: string
  target?: { id?: string; url?: string }
  media?: { image?: { src?: string }; source?: string }
  subattachments?: { data?: GraphAttachment[] }
}

interface GraphPost {
  id?: string
  message?: string
  created_time?: string
  permalink_url?: string
  attachments?: { data?: GraphAttachment[] }
}

interface GraphPostPage {
  data?: GraphPost[]
  paging?: { next?: string }
  error?: { message?: string }
}

interface GraphVideo {
  source?: string
  error?: { message?: string }
}

interface DownloadedMediaAsset {
  kind: CopyPostMedia['kind']
  filePath: string
  sortOrder: number
}

function cleanToken(value: string): string {
  const token = value.trim()
  if (!token) throw new Error('Token quét thông tin không được để trống.')
  if (token.length > 12_000) throw new Error('Token quét thông tin quá dài.')
  return token
}

export function normalizeCopyPostSource(value: string): string | null {
  const raw = value.trim()
  if (!raw) return null
  if (!/^https?:\/\//i.test(raw)) return raw.replace(/^@/, '').trim() || null
  try {
    const url = new URL(raw)
    if (!/(^|\.)facebook\.com$/i.test(url.hostname)) return null
    const profileId = url.searchParams.get('id')
    if (profileId?.trim()) return profileId.trim()
    const parts = url.pathname.split('/').map((part) => part.trim()).filter(Boolean)
    if (!parts.length) return null
    const numeric = [...parts].reverse().find((part) => /^\d+$/.test(part))
    if (numeric) return numeric
    if (parts[0] === 'pages' && parts[1]) return parts[1]
    return parts[0] ?? null
  } catch {
    return null
  }
}

function sourceList(value: string): string[] {
  return [...new Set(value.split(/\r?\n|,/).map(normalizeCopyPostSource).filter((item): item is string => Boolean(item)))]
}

function selectedTypes(request: CopyPostScanRequest): Set<CopyPostType> {
  const result = new Set<CopyPostType>()
  if (request.includeStatus) result.add('status')
  if (request.includePhoto) result.add('photo')
  if (request.includeVideo) result.add('video')
  if (request.includeReel) result.add('reel')
  if (request.includeLink) result.add('link')
  if (!result.size) throw new Error('Cần chọn ít nhất một loại bài để quét.')
  return result
}

function parseDate(value: string, endOfDay: boolean): number | null {
  const raw = value.trim()
  if (!raw) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error('Ngày quét phải có định dạng YYYY-MM-DD.')
  const time = Date.parse(`${raw}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`)
  if (!Number.isFinite(time)) throw new Error('Ngày quét không hợp lệ.')
  return time
}

function flattenAttachments(items: readonly GraphAttachment[] | undefined): GraphAttachment[] {
  const result: GraphAttachment[] = []
  for (const item of items ?? []) {
    result.push(item)
    result.push(...flattenAttachments(item.subattachments?.data))
  }
  return result
}

function attachmentText(item: GraphAttachment): string {
  return `${item.media_type ?? ''} ${item.type ?? ''}`.toLowerCase()
}

function postType(post: GraphPost, attachments: GraphAttachment[]): CopyPostType {
  const permalink = String(post.permalink_url ?? '').toLowerCase()
  if (permalink.includes('/reel/') || attachments.some((item) => attachmentText(item).includes('reel'))) return 'reel'
  if (attachments.some((item) => attachmentText(item).includes('video'))) return 'video'
  if (attachments.some((item) => attachmentText(item).includes('photo') || attachmentText(item).includes('album'))) return 'photo'
  if (attachments.some((item) => attachmentText(item).includes('link'))) return 'link'
  return 'status'
}

function buildMedia(postId: string, attachments: GraphAttachment[]): CopyPostMedia[] {
  const result: CopyPostMedia[] = []
  for (const [index, item] of attachments.entries()) {
    const descriptor = attachmentText(item)
    const preview = item.media?.image?.src?.trim() || null
    if (descriptor.includes('video') || descriptor.includes('reel')) {
      result.push({
        key: `${postId}-video-${index + 1}`,
        kind: 'video',
        previewUrl: preview,
        remoteUrl: item.media?.source?.trim() || null,
        objectId: item.target?.id?.trim() || null
      })
      continue
    }
    if (descriptor.includes('photo') || descriptor.includes('album') || preview) {
      result.push({
        key: `${postId}-image-${index + 1}`,
        kind: 'image',
        previewUrl: preview,
        remoteUrl: preview,
        objectId: item.target?.id?.trim() || null
      })
    }
  }
  const seen = new Set<string>()
  return result.filter((item) => {
    const identity = `${item.kind}:${item.remoteUrl ?? ''}:${item.objectId ?? ''}`
    if (seen.has(identity)) return false
    seen.add(identity)
    return true
  })
}

export function transformCopyPostContent(input: string, request: Pick<CopyPostScanRequest, 'stripLinks' | 'stripHashtags' | 'ignoreContent' | 'prefixText' | 'suffixText'>): string {
  let content = request.ignoreContent ? '' : input
  if (request.stripLinks) content = content.replace(/https?:\/\/\S+/giu, ' ')
  if (request.stripHashtags) content = content.replace(/(^|\s)#[\p{L}\p{N}_]+/gu, '$1')
  content = content.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return [request.prefixText.trim(), content, request.suffixText.trim()].filter(Boolean).join('\n\n').trim()
}

function graphUrl(source: string, request: CopyPostScanRequest): string {
  const url = new URL(`${GRAPH_ROOT}/${encodeURIComponent(source)}/posts`)
  url.searchParams.set('fields', GRAPH_FIELDS)
  url.searchParams.set('limit', '100')
  const from = parseDate(request.fromDate, false)
  const to = parseDate(request.toDate, true)
  if (from !== null) url.searchParams.set('since', String(Math.floor(from / 1000)))
  if (to !== null) url.searchParams.set('until', String(Math.floor(to / 1000)))
  return url.toString()
}

function safeGraphNext(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'graph.facebook.com' ? url.toString() : null
  } catch {
    return null
  }
}

function safeError(error: unknown, token: string): string {
  const raw = error instanceof Error ? error.message : String(error)
  return token ? raw.split(token).join('***') : raw
}

async function readGraphJson<T extends { error?: { message?: string } }>(fetcher: FetchLike, url: string, token: string): Promise<T> {
  const response = await fetcher(url, { headers: { Authorization: `Bearer ${token}` } })
  let payload: T
  try { payload = await response.json() as T } catch { throw new Error(`Facebook Graph trả dữ liệu không hợp lệ (HTTP ${response.status}).`) }
  if (!response.ok || payload.error) throw new Error(payload.error?.message || `Facebook Graph lỗi HTTP ${response.status}.`)
  return payload
}

function randomSubset<T>(items: readonly T[], count: number): T[] {
  const copy = [...items]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1))
    const current = copy[index]
    copy[index] = copy[target]!
    copy[target] = current!
  }
  return count > 0 ? copy.slice(0, count) : copy
}

function clampInteger(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.floor(value)))
}

function isTrustedFacebookMediaUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return false
    const host = url.hostname.toLowerCase()
    return host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'fbcdn.net' || host.endsWith('.fbcdn.net') || host === 'fbsbx.com' || host.endsWith('.fbsbx.com')
  } catch {
    return false
  }
}

function safeSegment(value: string): string {
  const normalized = value.replace(/[^a-z0-9._-]+/giu, '-').replace(/^-+|-+$/g, '')
  return normalized.slice(0, 100) || 'post'
}

async function pathExists(path: string): Promise<boolean> {
  try { await access(path); return true } catch { return false }
}

async function uniqueFinalFolder(root: string, sourcePostId: string): Promise<string> {
  const base = safeSegment(sourcePostId)
  let candidate = join(root, base)
  if (!await pathExists(candidate)) return candidate
  candidate = join(root, `${base}-${Date.now()}`)
  if (!await pathExists(candidate)) return candidate
  return join(root, `${base}-${randomUUID().slice(0, 8)}`)
}

function extensionFor(contentType: string, media: CopyPostMedia): string {
  const normalized = contentType.split(';')[0]?.trim().toLowerCase() ?? ''
  const map: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'video/mp4': '.mp4',
    'video/quicktime': '.mov',
    'video/webm': '.webm'
  }
  if (map[normalized]) return map[normalized]
  if (media.remoteUrl) {
    try {
      const candidate = extname(new URL(media.remoteUrl).pathname).toLowerCase()
      if (/^\.[a-z0-9]{2,5}$/.test(candidate)) return candidate
    } catch { /* use fallback */ }
  }
  return media.kind === 'video' ? '.mp4' : '.jpg'
}

async function resolveMediaUrl(fetcher: FetchLike, media: CopyPostMedia, token: string): Promise<string> {
  if (media.remoteUrl && isTrustedFacebookMediaUrl(media.remoteUrl)) return media.remoteUrl
  if (media.kind !== 'video' || !media.objectId) throw new Error('Media nguồn không có URL tải hợp lệ.')
  const url = new URL(`${GRAPH_ROOT}/${encodeURIComponent(media.objectId)}`)
  url.searchParams.set('fields', 'source')
  const payload = await readGraphJson<GraphVideo>(fetcher, url.toString(), token)
  const source = payload.source?.trim()
  if (!source || !isTrustedFacebookMediaUrl(source)) throw new Error('Facebook không trả URL video có thể tải.')
  return source
}

async function downloadMedia(fetcher: FetchLike, media: CopyPostMedia, token: string, folder: string, index: number): Promise<string> {
  const url = await resolveMediaUrl(fetcher, media, token)
  const response = await fetcher(url, { redirect: 'follow' })
  if (!response.ok || !response.body) throw new Error(`Tải media thất bại (HTTP ${response.status}).`)
  if (!isTrustedFacebookMediaUrl(response.url || url)) throw new Error('Media bị chuyển hướng sang host không được hỗ trợ.')
  const length = Number(response.headers.get('content-length') ?? 0)
  if (Number.isFinite(length) && length > MAX_MEDIA_BYTES) throw new Error('Media lớn hơn giới hạn 1 GB.')
  const contentType = response.headers.get('content-type') ?? ''
  if (media.kind === 'image' && contentType && !contentType.toLowerCase().startsWith('image/')) throw new Error('Nguồn ảnh trả về file không phải ảnh.')
  if (media.kind === 'video' && contentType && !contentType.toLowerCase().startsWith('video/')) throw new Error('Nguồn video trả về file không phải video.')

  const path = join(folder, `media-${String(index + 1).padStart(2, '0')}${extensionFor(contentType, media)}`)
  const file = await open(path, 'wx')
  let total = 0
  try {
    const reader = response.body.getReader()
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      total += chunk.value.byteLength
      if (total > MAX_MEDIA_BYTES) throw new Error('Media lớn hơn giới hạn 1 GB.')
      await file.write(chunk.value)
    }
  } finally {
    await file.close()
  }
  return path
}

export class CopyPostService {
  private readonly canonical: CanonicalPostRepository

  constructor(
    private readonly database: Database.Database,
    private readonly fetcher: FetchLike = fetch
  ) {
    this.canonical = new CanonicalPostRepository(database)
  }

  async scan(input: CopyPostScanRequest): Promise<CopyPostScanItem[]> {
    const token = cleanToken(input.token)
    const sources = sourceList(input.sourcesText)
    if (!sources.length) throw new Error('Cần ít nhất một UID hoặc URL Facebook nguồn hợp lệ.')
    const types = selectedTypes(input)
    const limit = clampInteger(input.limit, 1, 500, 50)
    const randomCount = clampInteger(input.randomCount, 0, 500, 0)
    const from = parseDate(input.fromDate, false)
    const to = parseDate(input.toDate, true)
    if (from !== null && to !== null && from > to) throw new Error('Từ ngày phải nhỏ hơn hoặc bằng Đến ngày.')

    const copiedRows = this.database.prepare('SELECT source_post_id AS sourcePostId FROM copy_post_history').all() as Array<{ sourcePostId: string }>
    const copied = new Set(copiedRows.map((row) => row.sourcePostId))
    const results: CopyPostScanItem[] = []

    for (const source of sources) {
      let next: string | null = graphUrl(source, input)
      let pages = 0
      let acceptedForSource = 0
      while (next && pages < MAX_GRAPH_PAGES_PER_SOURCE && acceptedForSource < limit) {
        pages += 1
        let payload: GraphPostPage
        try { payload = await readGraphJson<GraphPostPage>(this.fetcher, next, token) } catch (error) { throw new Error(`${source}: ${safeError(error, token)}`) }
        for (const post of payload.data ?? []) {
          if (acceptedForSource >= limit) break
          const sourcePostId = post.id?.trim()
          if (!sourcePostId) continue
          const createdAt = post.created_time?.trim() || ''
          const timestamp = createdAt ? Date.parse(createdAt) : 0
          if (from !== null && timestamp && timestamp < from) continue
          if (to !== null && timestamp && timestamp > to) continue
          const attachments = flattenAttachments(post.attachments?.data)
          const type = postType(post, attachments)
          if (!types.has(type)) continue
          const alreadyCopied = copied.has(sourcePostId)
          if (input.skipCopied && alreadyCopied) continue
          results.push({
            key: sourcePostId,
            source,
            sourcePostId,
            permalink: post.permalink_url?.trim() || '',
            createdAt,
            type,
            content: transformCopyPostContent(post.message ?? '', input),
            media: buildMedia(sourcePostId, attachments),
            alreadyCopied
          })
          acceptedForSource += 1
        }
        next = payload.paging?.next ? safeGraphNext(payload.paging.next) : null
      }
    }

    results.sort((a, b) => Date.parse(b.createdAt || '1970-01-01') - Date.parse(a.createdAt || '1970-01-01'))
    const limited = results.slice(0, limit)
    return randomCount > 0 ? randomSubset(limited, Math.min(randomCount, limited.length)) : limited
  }

  async saveSelected(input: CopyPostSaveRequest): Promise<CopyPostSaveResult> {
    const token = cleanToken(input.token)
    if (!Array.isArray(input.items) || !input.items.length) return { savedCount: 0, failedCount: 0, items: [] }
    const destination = input.destinationFolder.trim()
    const hasMedia = input.items.some((item) => item.media.length > 0)
    if (hasMedia && !destination) throw new Error('Bài có ảnh/video: phải chọn thư mục trên ổ đĩa trước khi lưu.')
    if (destination) await mkdir(destination, { recursive: true })

    const results: CopyPostSaveItemResult[] = []
    for (const item of input.items) {
      const result = await this.saveOne(item, token, destination)
      results.push(result)
    }
    return {
      savedCount: results.filter((item) => item.status === 'saved').length,
      failedCount: results.filter((item) => item.status === 'error').length,
      items: results
    }
  }

  private async saveOne(item: CopyPostSaveItem, token: string, destination: string): Promise<CopyPostSaveItemResult> {
    let partialFolder: string | null = null
    let finalFolder: string | null = null
    let downloadedAssets: DownloadedMediaAsset[] = []
    try {
      const name = item.name.trim() || `Copy ${item.sourcePostId}`
      const content = item.content.trim()
      if (!content && !item.media.length) throw new Error('Bài không còn nội dung hoặc media để lưu.')

      if (item.media.length) {
        if (!destination) throw new Error('Bài có ảnh/video: phải chọn thư mục trên ổ đĩa trước khi lưu.')
        const targetFolder = await uniqueFinalFolder(destination, item.sourcePostId)
        finalFolder = targetFolder
        partialFolder = `${targetFolder}.partial-${randomUUID().slice(0, 8)}`
        await mkdir(partialFolder, { recursive: true })
        for (const [index, media] of item.media.entries()) {
          const filePath = await downloadMedia(this.fetcher, media, token, partialFolder, index)
          downloadedAssets.push({ kind: media.kind, filePath, sortOrder: index })
        }
        await rename(partialFolder, targetFolder)
        partialFolder = null
        downloadedAssets = downloadedAssets.map((asset) => ({
          ...asset,
          filePath: join(targetFolder, basename(asset.filePath))
        }))
      }

      const imageCount = downloadedAssets.filter((asset) => asset.kind === 'image').length
      const now = Date.now()
      const saveTransaction = this.database.transaction(() => {
        const post = this.canonical.create({
          name,
          variants: content ? [content] : [],
          image: {
            folderPath: imageCount > 0 ? finalFolder ?? '' : '',
            mode: 'sequential',
            imagesPerPost: Math.max(1, imageCount),
            missingPolicy: imageCount > 0 ? 'skip' : 'text_only'
          }
        }, now)
        const insertAsset = this.database.prepare(`
          INSERT INTO post_media_assets (post_id, kind, file_path, sort_order)
          VALUES (?, ?, ?, ?)
        `)
        downloadedAssets.forEach((asset) => insertAsset.run(post.id, asset.kind, asset.filePath, asset.sortOrder))
        this.database.prepare(`
          INSERT INTO copy_post_history (source_post_id, source, permalink, canonical_post_id, media_folder_path, saved_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(source_post_id) DO UPDATE SET
            source = excluded.source,
            permalink = excluded.permalink,
            canonical_post_id = excluded.canonical_post_id,
            media_folder_path = excluded.media_folder_path,
            saved_at = excluded.saved_at
        `).run(item.sourcePostId, item.source, item.permalink, post.id, finalFolder ?? '', now)
        return post.id
      })
      const postId = saveTransaction()
      return { sourcePostId: item.sourcePostId, status: 'saved', canonicalPostId: postId, mediaFolder: finalFolder, error: null }
    } catch (error) {
      if (partialFolder) await rm(partialFolder, { recursive: true, force: true }).catch(() => undefined)
      if (finalFolder) await rm(finalFolder, { recursive: true, force: true }).catch(() => undefined)
      return { sourcePostId: item.sourcePostId, status: 'error', canonicalPostId: null, mediaFolder: null, error: safeError(error, token) }
    }
  }
}
