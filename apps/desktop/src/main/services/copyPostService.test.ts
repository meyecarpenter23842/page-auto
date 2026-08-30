import { mkdtempSync, rmSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CopyPostMedia, CopyPostScanRequest } from '../../shared/copyPost'
import { initializeDatabase } from '../database'
import { CopyPostService, normalizeCopyPostSource, transformCopyPostContent } from './copyPostService'

const directories: string[] = []
const runtimes: ReturnType<typeof initializeDatabase>[] = []

afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function setup(fetcher: typeof fetch) {
  const directory = mkdtempSync(join(tmpdir(), 'page-auto-copy-post-'))
  directories.push(directory)
  const runtime = initializeDatabase(join(directory, 'page-auto.sqlite'))
  runtimes.push(runtime)
  return { directory, runtime, service: new CopyPostService(runtime.client, fetcher) }
}

function request(): CopyPostScanRequest {
  return {
    token: 'test-token',
    sourcesText: 'https://www.facebook.com/profile.php?id=123456',
    fromDate: '',
    toDate: '',
    limit: 50,
    randomCount: 0,
    includeStatus: true,
    includePhoto: true,
    includeVideo: true,
    includeReel: true,
    includeLink: true,
    stripLinks: true,
    stripHashtags: true,
    ignoreContent: false,
    prefixText: 'Mở đầu',
    suffixText: 'Kết bài',
    skipCopied: true
  }
}

function graphResponse(source = '123456', postId = '999') {
  return {
    data: [{
      id: `${source}_${postId}`,
      message: 'Nội dung https://example.com #tag',
      created_time: '2026-08-30T08:00:00+0000',
      permalink_url: `https://www.facebook.com/${source}/posts/${postId}`,
      attachments: { data: [{ media_type: 'photo', media: { image: { src: 'https://scontent.xx.fbcdn.net/photo.jpg' } } }] }
    }]
  }
}

describe('CopyPostService', () => {
  it('normalizes Facebook sources and transforms copied content', () => {
    expect(normalizeCopyPostSource('https://facebook.com/profile.php?id=123')).toBe('123')
    expect(normalizeCopyPostSource('https://facebook.com/people/Test/456')).toBe('456')
    expect(transformCopyPostContent('A https://example.com #tag', {
      stripLinks: true,
      stripHashtags: true,
      ignoreContent: false,
      prefixText: 'Đầu',
      suffixText: 'Cuối'
    })).toBe('Đầu\n\nA\n\nCuối')
  })

  it('scans Graph posts without exposing token and marks media', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify(graphResponse()), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }))
    const { service } = setup(fetchMock as unknown as typeof fetch)

    const items = await service.scan(request())
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      source: '123456',
      sourcePostId: '123456_999',
      type: 'photo',
      content: 'Mở đầu\n\nNội dung\n\nKết bài',
      alreadyCopied: false
    })
    expect(items[0]!.media).toHaveLength(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('test-token')
  })

  it('queries every requested source before applying the global result limit', async () => {
    const seenSources: string[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      const source = decodeURIComponent(url.pathname.split('/').filter(Boolean)[0] ?? '')
      seenSources.push(source)
      return new Response(JSON.stringify(graphResponse(source, source === '111' ? '1' : '2')), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    })
    const { service } = setup(fetchMock as unknown as typeof fetch)
    const items = await service.scan({ ...request(), sourcesText: '111\n222', limit: 1 })

    expect(items).toHaveLength(1)
    expect(seenSources).toEqual(['111', '222'])
  })

  it('requires a local folder for selected media and then saves image media + canonical history', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('graph.facebook.com')) {
        return new Response(JSON.stringify(graphResponse()), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { 'content-type': 'image/jpeg' } })
    })
    const { directory, runtime, service } = setup(fetchMock as unknown as typeof fetch)
    const [item] = await service.scan(request())
    expect(item).toBeTruthy()

    await expect(service.saveSelected({
      token: 'test-token',
      destinationFolder: '',
      items: [{ source: item!.source, sourcePostId: item!.sourcePostId, permalink: item!.permalink, name: 'Bài copy', content: item!.content, media: item!.media }]
    })).rejects.toThrow(/phải chọn thư mục/i)

    const mediaRoot = join(directory, 'copied-media')
    const saved = await service.saveSelected({
      token: 'test-token',
      destinationFolder: mediaRoot,
      items: [{ source: item!.source, sourcePostId: item!.sourcePostId, permalink: item!.permalink, name: 'Bài copy', content: item!.content, media: item!.media }]
    })
    expect(saved).toMatchObject({ savedCount: 1, failedCount: 0 })
    const postRow = runtime.client.prepare(`
      SELECT name, image_folder_path AS imageFolderPath, images_per_post AS imagesPerPost
      FROM posts
    `).get() as { name: string; imageFolderPath: string; imagesPerPost: number }
    expect(postRow.name).toBe('Bài copy')
    expect(postRow.imageFolderPath).toContain('123456_999')
    expect(postRow.imagesPerPost).toBe(1)
    expect(await readdir(postRow.imageFolderPath)).toEqual(['media-01.jpg'])
    const history = runtime.client.prepare(`
      SELECT source_post_id AS sourcePostId, media_folder_path AS mediaFolderPath
      FROM copy_post_history
    `).get() as { sourcePostId: string; mediaFolderPath: string }
    expect(history.sourcePostId).toBe('123456_999')
    expect(history.mediaFolderPath).toBe(postRow.imageFolderPath)
    const assets = runtime.client.prepare('SELECT kind, file_path AS filePath FROM post_media_assets ORDER BY sort_order').all() as Array<{ kind: string; filePath: string }>
    expect(assets).toEqual([{ kind: 'image', filePath: join(postRow.imageFolderPath, 'media-01.jpg') }])

    const secondScan = await service.scan(request())
    expect(secondScan).toHaveLength(0)
  })

  it('preserves video-only media as canonical media assets without pretending the folder is an image source', async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4]), {
      status: 200,
      headers: { 'content-type': 'video/mp4' }
    }))
    const { directory, runtime, service } = setup(fetchMock as unknown as typeof fetch)
    const video: CopyPostMedia = {
      key: 'video-1',
      kind: 'video',
      previewUrl: null,
      remoteUrl: 'https://video.xx.fbcdn.net/clip.mp4',
      objectId: null
    }
    const saved = await service.saveSelected({
      token: 'test-token',
      destinationFolder: join(directory, 'copied-media'),
      items: [{ source: '777', sourcePostId: '777_1', permalink: '', name: 'Video copy', content: 'Caption', media: [video] }]
    })
    expect(saved).toMatchObject({ savedCount: 1, failedCount: 0 })

    const post = runtime.client.prepare(`
      SELECT id, image_folder_path AS imageFolderPath, images_per_post AS imagesPerPost, missing_policy AS missingPolicy
      FROM posts
    `).get() as { id: number; imageFolderPath: string; imagesPerPost: number; missingPolicy: string }
    expect(post.imageFolderPath).toBe('')
    expect(post.imagesPerPost).toBe(1)
    expect(post.missingPolicy).toBe('text_only')
    const asset = runtime.client.prepare('SELECT kind, file_path AS filePath FROM post_media_assets WHERE post_id = ?').get(post.id) as { kind: string; filePath: string }
    expect(asset.kind).toBe('video')
    expect(asset.filePath).toMatch(/media-01\.mp4$/)
    const history = runtime.client.prepare('SELECT media_folder_path AS mediaFolderPath FROM copy_post_history WHERE source_post_id = ?').get('777_1') as { mediaFolderPath: string }
    expect(history.mediaFolderPath).toBeTruthy()
    expect(await readdir(history.mediaFolderPath)).toEqual(['media-01.mp4'])
  })

  it('counts only images for mixed image/video canonical image selection', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const isVideo = String(input).includes('video')
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': isVideo ? 'video/mp4' : 'image/jpeg' }
      })
    })
    const { directory, runtime, service } = setup(fetchMock as unknown as typeof fetch)
    const media: CopyPostMedia[] = [
      { key: 'image-1', kind: 'image', previewUrl: null, remoteUrl: 'https://scontent.xx.fbcdn.net/photo.jpg', objectId: null },
      { key: 'video-1', kind: 'video', previewUrl: null, remoteUrl: 'https://video.xx.fbcdn.net/video.mp4', objectId: null }
    ]
    const saved = await service.saveSelected({
      token: 'test-token',
      destinationFolder: join(directory, 'copied-media'),
      items: [{ source: '888', sourcePostId: '888_1', permalink: '', name: 'Mixed copy', content: 'Caption', media }]
    })
    expect(saved.savedCount).toBe(1)
    const post = runtime.client.prepare('SELECT image_folder_path AS imageFolderPath, images_per_post AS imagesPerPost FROM posts').get() as { imageFolderPath: string; imagesPerPost: number }
    expect(post.imageFolderPath).toContain('888_1')
    expect(post.imagesPerPost).toBe(1)
    expect(runtime.client.prepare('SELECT COUNT(*) AS count FROM post_media_assets').get()).toEqual({ count: 2 })
  })
})
