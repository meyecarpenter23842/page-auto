import { describe, expect, it } from 'vitest'
import type { ExecutionLogRecord } from '../../shared/executionLogs'
import type { PageTabConfig, PageTabSummary } from '../../shared/pageTabs'
import type { RotationRuntimeSnapshot } from '../../shared/rotation'
import { PwaBridgeService } from './pwaBridgeService'

const pageSummary: PageTabSummary = {
  id: 7,
  name: 'Page bán hàng',
  pageUid: '112233',
  status: 'running',
  accountCount: 2,
  scheduleCount: 1,
  groupCount: 25,
  contentCount: 3,
  imageFolder: 'D:/images',
  updatedAt: 1
}

const avatarDataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='

const pageConfig = {
  id: 7,
  name: pageSummary.name,
  pageUid: pageSummary.pageUid,
  avatarDataUrl,
  status: 'running',
  createdAt: 1,
  updatedAt: 1,
  rotation: {
    postsPerAccount: 2,
    postDelayMinSeconds: 60,
    postDelayMaxSeconds: 90,
    accountDelayMinSeconds: 180,
    accountDelayMaxSeconds: 240,
    accountConcurrency: 2,
    accountOrderMode: 'sequential'
  },
  accounts: [
    { accountId: 10, enabled: true, sortOrder: 0, postsPerTurn: null, uid: 'acc-10', name: 'Account 10', status: 'live', category: null },
    { accountId: 20, enabled: true, sortOrder: 1, postsPerTurn: null, uid: 'acc-20', name: null, status: 'live', category: null }
  ],
  schedules: [{ id: 1, dayOfWeek: 2, startMinute: 480, endMinute: 600, enabled: true, sortOrder: 0 }],
  groupUids: ['g1', 'g2'],
  groupOrderMode: 'sequential',
  contentMode: 'sequential',
  contents: [],
  image: { folderPath: '', mode: 'sequential', imagesPerPost: 1, missingPolicy: 'text_only' }
} as PageTabConfig

const runtime = {
  pageTabId: 7,
  runId: 99,
  status: 'running',
  currentAccountId: 10,
  currentAccountIndex: 0,
  slotsCompletedThisTurn: 1,
  targetSlotsThisTurn: 2,
  cycle: 3,
  nextActionAt: 1_789_000_020_000,
  message: 'Đang chạy.',
  lastResult: null,
  run: {
    run: { id: 99, status: 'running' },
    metrics: { total: 25, pending: 15, processing: 1, success: 8, failed: 1, skipped: 0, remaining: 16, progressPercent: 36 }
  },
  accountStates: [
    { accountId: 10, status: 'running', message: 'Đang đăng.' },
    { accountId: 20, status: 'not_run', message: null }
  ],
  currentPostPreview: {
    groupUid: 'group-current',
    contentPreview: 'Nội dung hiện tại',
    contentLength: 17,
    imageCount: 2,
    postIndex: 1,
    variantIndex: 0
  },
  windowStates: [{
    key: '2026-09-08:2:480-600',
    dateKey: '2026-09-08',
    dayOfWeek: 2,
    startMinute: 480,
    endMinute: 600,
    sortOrder: 0,
    status: 'running',
    currentAccountId: 10,
    slotsCompletedThisTurn: 1,
    targetSlotsThisTurn: 2,
    groupRemaining: 16,
    closedAt: null
  }]
} as unknown as RotationRuntimeSnapshot

function log(overrides: Partial<ExecutionLogRecord>): ExecutionLogRecord {
  return {
    id: 1,
    timestamp: 1_789_000_000_100,
    runId: 99,
    runItemId: 1,
    pageTabId: 7,
    accountId: 10,
    pageUid: '112233',
    groupUid: 'group-current',
    contentIndex: 0,
    imagePaths: ['D:/secret/image.jpg'],
    action: 'group_post',
    result: 'success',
    errorCode: null,
    errorMessage: null,
    screenshotPath: 'D:/secret/shot.png',
    publishedUrl: 'https://facebook.example/post',
    attemptCount: 1,
    retryDisposition: 'not_applicable',
    ...overrides
  }
}

describe('PwaBridgeService', () => {
  it('projects safe live Group runtime data and the compact Page avatar for the mobile dashboard', () => {
    const logs = [
      log({ id: 2, errorMessage: 'token=super-secret', errorCode: 'unexpected_error', result: 'failed' }),
      log({ id: 1 })
    ]
    const service = new PwaBridgeService(
      { list: () => [pageSummary], get: () => pageConfig },
      { status: () => runtime },
      { list: () => logs },
      () => 1_789_000_000_000
    )

    const snapshot = service.getSnapshot()

    expect(snapshot.schemaVersion).toBe(1)
    expect(snapshot.summary).toMatchObject({ totalPages: 1, activePages: 1, successToday: 1, failedToday: 1 })
    expect(snapshot.pages[0]).toMatchObject({
      pageTabId: 7,
      avatarDataUrl,
      runtimeStatus: 'running',
      currentAccountId: 10,
      currentGroupUid: 'group-current',
      accountConcurrency: 2,
      postsPerAccount: 2,
      today: { success: 1, failed: 1 }
    })
    expect(snapshot.pages[0]?.progress?.percent).toBe(36)
    expect(snapshot.pages[0]?.accounts[0]).toMatchObject({ accountId: 10, uid: 'acc-10', status: 'running' })
    expect(snapshot.pages[0]?.schedules[0]).toMatchObject({ status: 'running', groupRemaining: 16 })
    expect(snapshot.recentLogs[0]?.errorMessage).toBe('token=[REDACTED]')
    expect(snapshot.recentLogs[0]).not.toHaveProperty('imagePaths')
    expect(snapshot.recentLogs[0]).not.toHaveProperty('screenshotPath')
  })

  it('keeps one broken Page from breaking the whole dashboard snapshot', () => {
    const service = new PwaBridgeService(
      { list: () => [pageSummary], get: () => pageConfig },
      { status: () => { throw new Error('password=plain-text') } },
      { list: () => [] },
      () => 1_789_000_000_000
    )

    const page = service.getSnapshot().pages[0]
    expect(page?.runtimeStatus).toBe('error')
    expect(page?.message).toBe('password=[REDACTED]')
    expect(page?.avatarDataUrl).toBe(avatarDataUrl)
  })
})
