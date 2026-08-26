import type { Locator, Page } from 'playwright-core'
import { describe, expect, it } from 'vitest'
import {
  FACEBOOK_CHECKPOINT_CLASSIFY_TIMEOUT_MS,
  detectFacebookCheckpointKind,
  facebookCheckpointKindFromText,
  facebookCheckpointKindFromUrl
} from './facebookCheckpoint'

function bodyLocator(text: string): Locator {
  return { innerText: async () => text } as unknown as Locator
}

function pageAt(url: string, text = ''): Page {
  return {
    url: () => url,
    locator: () => bodyLocator(text),
    waitForTimeout: async () => undefined
  } as unknown as Page
}

describe('Facebook checkpoint classifier', () => {
  it('recognizes the production-style checkpoint id ending in 282', () => {
    expect(facebookCheckpointKindFromUrl('https://www.facebook.com/checkpoint/1501092823525282/?next=%2F')).toBe('282')
  })

  it('recognizes checkpoint ids ending in 956 without treating unrelated checkpoint ids as known', () => {
    expect(facebookCheckpointKindFromUrl('https://www.facebook.com/checkpoint/1234567890956/')).toBe('956')
    expect(facebookCheckpointKindFromUrl('https://www.facebook.com/checkpoint/1234567890123/')).toBe('unknown')
    expect(facebookCheckpointKindFromUrl('https://www.facebook.com/two_step_verification/two_factor/')).toBeNull()
  })

  it('accepts explicit checkpoint labels from DOM text but not bare numbers', () => {
    expect(facebookCheckpointKindFromText('Checkpoint 282')).toBe('282')
    expect(facebookCheckpointKindFromText('CP: 956')).toBe('956')
    expect(facebookCheckpointKindFromText('reference 282')).toBeNull()
  })

  it('classifies a known checkpoint immediately and keeps the default observation window at 10 seconds', async () => {
    expect(FACEBOOK_CHECKPOINT_CLASSIFY_TIMEOUT_MS).toBe(10_000)
    await expect(detectFacebookCheckpointKind(pageAt('https://www.facebook.com/checkpoint/1501092823525282/'))).resolves.toBe('282')
  })

  it('returns unknown when the checkpoint is not identifiable instead of guessing from elapsed time', async () => {
    await expect(detectFacebookCheckpointKind(
      pageAt('https://www.facebook.com/checkpoint/1234567890123/', 'Confirm your identity'),
      0
    )).resolves.toBe('unknown')
  })
})
