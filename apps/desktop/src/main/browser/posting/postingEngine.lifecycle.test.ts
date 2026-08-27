import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cloneDefaultAppSettings } from '../../../shared/appSettings'
import type { PostingJobRequest, PostingJobResult } from '../../../shared/posting'

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  checkAccess: vi.fn(),
  finishEvidence: vi.fn(),
  startTrace: vi.fn()
}))

vi.mock('../../facebook/facebookCommonRuntime', () => ({
  FacebookCommonRuntime: { open: mocks.open },
  checkFacebookCommonAccess: mocks.checkAccess
}))

vi.mock('./postingEvidence', () => ({
  finishPostingEvidence: mocks.finishEvidence,
  startPostingTrace: mocks.startTrace
}))

import { executePostingJob } from './postingEngine'

function postingJob(): PostingJobRequest {
  const settings = cloneDefaultAppSettings()
  return {
    runId: 1,
    itemId: 2,
    accountId: 3,
    profileDirectory: 'C:\\Page-Auto\\data\\browser-profiles\\10001',
    pageUid: '90001',
    groupUid: '80001',
    content: 'hello',
    imagePaths: [],
    browser: settings.browser,
    session: settings.session,
    network: settings.network,
    logging: settings.logging,
    sessionAccount: {
      id: 3,
      uid: '10001',
      username: null,
      password: null,
      cookie: 'c_user=10001',
      twoFactorSecret: null,
      name: null
    }
  }
}

describe('posting evidence lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.startTrace.mockResolvedValue(false)
  })

  it('finishes screenshot/trace evidence before closing the browser runtime', async () => {
    const close = vi.fn(async () => undefined)
    const job = postingJob()
    const runtime = {
      page: {},
      context: {},
      browser: job.browser,
      metadata: () => ({ accountName: null, sessionCookie: null, sessionValidated: false }),
      prepareForPage: vi.fn(async () => ({
        status: 'failed' as const,
        code: 'page_identity_unconfirmed' as const,
        message: 'Page identity chưa sẵn sàng.'
      })),
      close
    }
    mocks.open.mockResolvedValue({ status: 'ready', runtime })

    let releaseEvidence!: (result: PostingJobResult) => void
    const evidencePromise = new Promise<PostingJobResult>((resolve) => {
      releaseEvidence = resolve
    })
    mocks.finishEvidence.mockReturnValue(evidencePromise)

    const expected: PostingJobResult = {
      status: 'failed',
      code: 'page_identity_unconfirmed',
      message: 'Evidence đã hoàn tất.'
    }
    const executing = executePostingJob(job)

    await vi.waitFor(() => expect(mocks.finishEvidence).toHaveBeenCalledTimes(1))
    expect(close).not.toHaveBeenCalled()

    releaseEvidence(expected)
    await expect(executing).resolves.toEqual(expected)
    expect(close).toHaveBeenCalledTimes(1)
  })
})
