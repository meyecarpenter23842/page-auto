import type { Locator, Page } from 'playwright-core'
import { describe, expect, it } from 'vitest'
import type { PostingJobRequest } from '../../../shared/posting'
import { finishPostingEvidence } from './postingEvidence'

function pageAt(url: string): Page {
  const body = { innerText: async () => '' } as unknown as Locator
  return {
    url: () => url,
    locator: () => body,
    waitForTimeout: async () => undefined
  } as unknown as Page
}

function job(): PostingJobRequest {
  return {
    runId: 1,
    itemId: 1,
    profileDirectory: 'C:/page-auto/data/browser-profiles/1',
    logging: {
      playwrightTrace: false,
      saveCurrentUrlOnFailure: false,
      screenshotOnFailure: false
    }
  } as unknown as PostingJobRequest
}

describe('posting checkpoint result enrichment', () => {
  it('attaches checkpoint 282 classification before the result leaves the posting worker', async () => {
    const result = await finishPostingEvidence(
      pageAt('https://www.facebook.com/checkpoint/1501092823525282/?next=%2F'),
      job(),
      { status: 'needs_login', code: 'verification_required', message: 'checkpoint' },
      false
    )

    expect(result.sessionValidation).toEqual({
      phase: 'before_run',
      state: 'verification_required',
      message: 'checkpoint',
      checkpointKind: '282'
    })
  })
})
