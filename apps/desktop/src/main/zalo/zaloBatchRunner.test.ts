import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizeZaloBatchStartPayload } from '../../shared/zalo'

describe('Zalo Batch 4 contracts', () => {
  it('normalizes multi-account targets, immutable content input and runtime limits', () => {
    const normalized = normalizeZaloBatchStartPayload({
      accountIds: [2, 2, 5],
      targets: ['+84 912 345 678', '0912345678', '0987654321'],
      actions: { sendMessage: true, sendAttachment: false, addFriend: true },
      contentItems: [{ sourceItemId: -7, name: ' Bài A ', variants: [' {Xin chào|Chào bạn} ', ''] }],
      contentMode: 'random',
      attachmentPaths: [],
      friendMessage: ' kết bạn nhé ',
      concurrency: 99,
      delayMinMs: 2_000,
      delayMaxMs: 1_000,
      failurePolicy: 'continue'
    })

    expect(normalized.accountIds).toEqual([2, 5])
    expect(normalized.targets).toEqual(['0912345678', '0987654321'])
    expect(normalized.contentItems).toEqual([{ sourceItemId: -7, name: 'Bài A', variants: ['{Xin chào|Chào bạn}'] }])
    expect(normalized.concurrency).toBe(2)
    expect(normalized.delayMinMs).toBe(2_000)
    expect(normalized.delayMaxMs).toBe(2_000)
    expect(normalized.friendMessage).toBe('kết bạn nhé')
  })

  it('rejects missing batch business inputs', () => {
    expect(() => normalizeZaloBatchStartPayload({
      accountIds: [], targets: ['0912345678'],
      actions: { sendMessage: true, sendAttachment: false, addFriend: false },
      contentItems: [{ sourceItemId: null, name: 'A', variants: ['x'] }],
      contentMode: 'sequential', attachmentPaths: [], friendMessage: null,
      concurrency: 1, delayMinMs: 0, delayMaxMs: 0, failurePolicy: 'continue'
    })).toThrow(/tài khoản/i)

    expect(() => normalizeZaloBatchStartPayload({
      accountIds: [1], targets: ['0912345678'],
      actions: { sendMessage: false, sendAttachment: false, addFriend: false },
      contentItems: [], contentMode: 'sequential', attachmentPaths: [], friendMessage: null,
      concurrency: 1, delayMinMs: 0, delayMaxMs: 0, failurePolicy: 'continue'
    })).toThrow(/action/i)
  })

  it('reuses production action runtime, rolling pool and canonical library surface', () => {
    const root = process.cwd()
    const runner = readFileSync(join(root, 'src/main/zalo/zaloBatchRunner.ts'), 'utf8')
    const ipc = readFileSync(join(root, 'src/main/zaloIpc.ts'), 'utf8')
    const preload = readFileSync(join(root, 'src/preload/zaloBridge.ts'), 'utf8')
    const panel = readFileSync(join(root, 'src/renderer/src/zalo/ZaloBatchPanel.tsx'), 'utf8')

    expect(runner).toContain('runRollingAccountPool')
    expect(runner).toContain('spinContent')
    expect(runner).toContain('browser.executeAction')
    expect(runner).not.toMatch(/playwright|chromium\.launch|better-sqlite3/)
    expect(ipc).toContain('ZaloBatchRunner')
    expect(preload).toContain('startBatch')
    expect(preload).toContain('pauseBatch')
    expect(preload).toContain('resumeBatch')
    expect(preload).toContain('stopBatch')
    expect(panel).toContain('getContentLibrary')
    expect(panel).toContain('CANONICAL_CONTENT_LIBRARY_SET_ID')
    expect(panel).toContain('Tóm tắt lượt chạy')
    expect(panel).toContain('Danh sách chạy')
    expect(panel).toContain('Progress từng target')
    expect(panel).toContain("account.sessionStatus === 'ready'")
    expect(panel).toContain('assignedAccountId')
    expect(panel).not.toContain('Batch 4 ·')
  })
})
