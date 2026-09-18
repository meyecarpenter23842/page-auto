import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizeZaloBatchStartPayload } from '../../shared/zalo'

describe('Zalo structural automation contracts', () => {
  it('normalizes multi-account targets and snapshots media inside each Zalo post', () => {
    const normalized = normalizeZaloBatchStartPayload({
      accountIds: [2, 2, 5],
      targets: ['+84 912 345 678', '0912345678', '0987654321'],
      actions: { sendMessage: true, sendAttachment: true, addFriend: true },
      contentItems: [{
        sourceItemId: 7,
        name: ' Bài A ',
        variants: [' {Xin chào|Chào bạn} ', ''],
        media: { folderPath: 'D:/zalo/a', mode: 'random', imagesPerTarget: 2, missingPolicy: 'skip' }
      }],
      contentMode: 'random',
      friendMessage: ' kết bạn nhé ',
      concurrency: 99,
      delayMinMs: 2_000,
      delayMaxMs: 1_000,
      failurePolicy: 'continue'
    })

    expect(normalized.accountIds).toEqual([2, 5])
    expect(normalized.targets).toEqual(['0912345678', '0987654321'])
    expect(normalized.contentItems).toEqual([{
      sourceItemId: 7,
      name: 'Bài A',
      variants: ['{Xin chào|Chào bạn}'],
      media: { folderPath: 'D:/zalo/a', mode: 'random', imagesPerTarget: 2, missingPolicy: 'skip' }
    }])
    expect(normalized.concurrency).toBe(2)
    expect(normalized.delayMinMs).toBe(2_000)
    expect(normalized.delayMaxMs).toBe(2_000)
    expect(normalized.friendMessage).toBe('kết bạn nhé')
    expect(normalized).not.toHaveProperty('attachmentPaths')
  })

  it('rejects missing batch business inputs and media when attachment action has no usable post media', () => {
    expect(() => normalizeZaloBatchStartPayload({
      accountIds: [], targets: ['0912345678'],
      actions: { sendMessage: true, sendAttachment: false, addFriend: false },
      contentItems: [{ sourceItemId: 1, name: 'A', variants: ['x'], media: { folderPath: '', mode: 'sequential', imagesPerTarget: 1, missingPolicy: 'text_only' } }],
      contentMode: 'sequential', friendMessage: null,
      concurrency: 1, delayMinMs: 0, delayMaxMs: 0, failurePolicy: 'continue'
    })).toThrow(/tài khoản/i)

    expect(() => normalizeZaloBatchStartPayload({
      accountIds: [1], targets: ['0912345678'],
      actions: { sendMessage: false, sendAttachment: true, addFriend: false },
      contentItems: [{ sourceItemId: 1, name: 'A', variants: ['x'], media: { folderPath: '', mode: 'sequential', imagesPerTarget: 1, missingPolicy: 'text_only' } }],
      contentMode: 'sequential', friendMessage: null,
      concurrency: 1, delayMinMs: 0, delayMaxMs: 0, failurePolicy: 'continue'
    })).toThrow(/media/i)
  })

  it('reuses production action runtime while Zalo posts own their binding/media UX', () => {
    const root = process.cwd()
    const runner = readFileSync(join(root, 'src/main/zalo/zaloBatchRunner.ts'), 'utf8')
    const ipc = readFileSync(join(root, 'src/main/zaloIpc.ts'), 'utf8')
    const preload = readFileSync(join(root, 'src/preload/zaloBridge.ts'), 'utf8')
    const panel = readFileSync(join(root, 'src/renderer/src/zalo/ZaloBatchPanel.tsx'), 'utf8')

    expect(runner).toContain('runRollingAccountPool')
    expect(runner).toContain('spinContent')
    expect(runner).toContain('selectZaloMedia')
    expect(runner).toContain('browser.executePreparedAction')
    expect(runner).not.toMatch(/playwright|chromium\.launch|better-sqlite3/)
    expect(runner).not.toContain('attachmentPaths')
    expect(ipc).toContain('ZaloPostRepository')
    expect(preload).toContain('getPostLibrary')
    expect(preload).toContain('savePostLibrary')
    expect(panel).toContain('getPostLibrary')
    expect(panel).toContain('+ Nhập SĐT')
    expect(panel).toContain('Bài Zalo đang dùng')
    expect(panel).toContain('+ Chọn từ Thư viện bài viết')
    expect(panel).toContain('pickContentLibraryImageFolder')
    expect(panel).toContain('Gửi ảnh/file')
    expect(panel).toContain('Tiến độ từng SĐT')
    expect(panel).toContain('currentProgress?.postName')
    expect(panel).toContain('currentProgress?.variantIndex')
    expect(panel).toContain('currentProgress?.mediaPaths')
    expect(panel).not.toContain('attachmentPaths')
  })
})
