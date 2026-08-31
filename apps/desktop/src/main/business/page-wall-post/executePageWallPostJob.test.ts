import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cloneDefaultAppSettings } from '../../../shared/appSettings'
import { pageWallPostTaskFromBase, type FacebookTaskJobBase } from '../../../shared/facebookTasks'
import type { FacebookCommonStepResult } from '../../facebook/facebookCommonRuntime'

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  startTrace: vi.fn(),
  finishEvidence: vi.fn(),
  taskConstructed: vi.fn(),
  taskExecute: vi.fn()
}))

vi.mock('../../facebook/facebookCommonRuntime', () => ({
  FacebookCommonRuntime: { open: mocks.open }
}))

vi.mock('../../browser/posting/postingEvidence', () => ({
  startPostingTrace: mocks.startTrace,
  finishPostingEvidence: mocks.finishEvidence
}))

vi.mock('./pageWallTask', () => ({
  PageWallTask: class {
    constructor(runtime: unknown, task: unknown) {
      mocks.taskConstructed(runtime, task)
    }

    execute(input: unknown) {
      return mocks.taskExecute(input)
    }
  }
}))

import { executePageWallPostJob } from './executePageWallPostJob'

function job() {
  const settings = cloneDefaultAppSettings()
  const base: FacebookTaskJobBase = {
    runId: 41,
    itemId: 51,
    accountId: 61,
    profileDirectory: 'C:\\Page-Auto\\data\\browser-profiles\\61',
    pageUid: '90001',
    content: 'hello wall',
    imagePaths: ['C:\\media\\one.jpg'],
    browser: settings.browser,
    session: { ...settings.session, validateAfterRun: true },
    network: settings.network,
    logging: settings.logging,
    sessionAccount: {
      id: 61,
      uid: '10001',
      username: null,
      password: null,
      cookie: 'c_user=10001',
      twoFactorSecret: null,
      name: null
    }
  }
  return pageWallPostTaskFromBase(base)
}

function readyRuntime(
  prepareResult: FacebookCommonStepResult = { status: 'success', message: 'ready' }
) {
  return {
    context: {},
    page: {},
    browser: { navigationTimeoutMs: 45_000, pageSettleDelayMs: 700 },
    prepareForPage: vi.fn(async (): Promise<FacebookCommonStepResult> => prepareResult),
    pace: vi.fn(async () => undefined),
    checkAccessBlock: vi.fn(async (): Promise<FacebookCommonStepResult> => ({ status: 'success', message: 'ok' })),
    validateAfterTask: vi.fn(async () => ({
      messageSuffix: null,
      sessionValidation: { phase: 'after_run' as const, state: 'valid' as const, message: 'valid' }
    })),
    metadata: vi.fn(() => ({ accountName: 'Page Operator', sessionCookie: 'c_user=10001; xs=fresh', sessionValidated: true })),
    close: vi.fn(async () => undefined)
  }
}

describe('executePageWallPostJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.startTrace.mockResolvedValue(false)
    mocks.finishEvidence.mockImplementation(async (_page, _job, result) => result)
    mocks.taskExecute.mockResolvedValue({ status: 'success', message: 'published', publishedUrl: 'https://www.facebook.com/Page/posts/pfbidNew' })
  })

  it('prepares common Facebook account/Page runtime before invoking the Page Wall business task', async () => {
    const runtime = readyRuntime()
    mocks.open.mockResolvedValue({ status: 'ready', runtime })
    const request = job()

    const result = await executePageWallPostJob(request)

    expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({
      profileDirectory: request.profileDirectory,
      pageUid: request.pageUid,
      sessionAccount: request.sessionAccount,
      browser: request.browser,
      session: request.session,
      network: request.network
    }))
    expect(runtime.prepareForPage).toHaveBeenCalledTimes(1)
    expect(runtime.prepareForPage.mock.invocationCallOrder[0]!).toBeLessThan(mocks.taskExecute.mock.invocationCallOrder[0]!)
    expect(mocks.taskConstructed).toHaveBeenCalledWith(
      expect.objectContaining({ page: runtime.page, browser: runtime.browser }),
      request.task
    )
    expect(mocks.taskExecute).toHaveBeenCalledWith({
      content: request.content,
      imagePaths: request.imagePaths,
      networkTimeoutMs: request.network.networkTimeoutMs
    })
    expect(runtime.validateAfterTask).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      status: 'success',
      accountName: 'Page Operator',
      sessionCookie: 'c_user=10001; xs=fresh',
      sessionValidation: { phase: 'after_run', state: 'valid' }
    })
    expect(runtime.close).toHaveBeenCalledTimes(1)
  })

  it('stops at a common checkpoint before the Page Wall task can execute', async () => {
    const runtime = readyRuntime({
      status: 'needs_login',
      code: 'verification_required',
      message: 'checkpoint',
      sessionValidation: {
        phase: 'before_run',
        state: 'verification_required',
        accountStatus: 'checkpoint_unknown',
        message: 'checkpoint'
      }
    })
    mocks.open.mockResolvedValue({ status: 'ready', runtime })

    const result = await executePageWallPostJob(job())

    expect(result).toMatchObject({ status: 'needs_login', code: 'verification_required' })
    expect(mocks.taskConstructed).not.toHaveBeenCalled()
    expect(mocks.taskExecute).not.toHaveBeenCalled()
    expect(runtime.close).toHaveBeenCalledTimes(1)
  })
})
