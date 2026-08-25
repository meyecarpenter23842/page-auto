import { describe, expect, it } from 'vitest'
import {
  COMPOSER_TITLE_PATTERN,
  COMPOSER_TRIGGER_PATTERN,
  formatComposerDiagnostics,
  safeComposerUrl
} from './composerSurface'

describe('Facebook composer surface helpers', () => {
  it('accepts current English and Vietnamese create-post wording', () => {
    for (const text of [
      'Create post',
      'Create a post',
      'Create a public post',
      'Write something...',
      "What's on your mind?",
      'Tạo bài viết',
      'Tạo một bài viết',
      'Bạn viết gì đi...',
      'Viết gì đó...'
    ]) {
      expect(COMPOSER_TRIGGER_PATTERN.test(text)).toBe(true)
    }

    expect(COMPOSER_TITLE_PATTERN.test('Create a post')).toBe(true)
    expect(COMPOSER_TITLE_PATTERN.test('Tạo một bài viết')).toBe(true)
  })

  it('keeps composer diagnostics useful without query/hash data', () => {
    expect(safeComposerUrl('https://www.facebook.com/groups/123?token=secret#composer')).toBe('https://www.facebook.com/groups/123')
    const message = formatComposerDiagnostics({
      dialogCount: 1,
      textboxCount: 2,
      triggerCount: 1,
      publishButtonCount: 1,
      fileInputCount: 1,
      url: 'https://www.facebook.com/groups/123?token=secret#composer'
    })

    expect(message).toContain('composer{dialogs=1,textboxes=2,triggers=1,publish=1,files=1}')
    expect(message).not.toContain('token=secret')
  })
})
