import { describe, expect, it } from 'vitest'
import {
  normalizePageWallComposerText,
  shouldTreatPageWallComposerSuggestionAsOwned
} from './pageWallComposerSuggestion'

describe('Page Wall composer suggestion ownership', () => {
  it('owns a suggestion surface explicitly controlled by the composer textbox', () => {
    expect(shouldTreatPageWallComposerSuggestionAsOwned({
      controlledVisible: 1,
      ariaExpanded: false,
      textboxFocused: false,
      fallbackVisible: 0
    })).toBe(true)
  })

  it('owns fallback suggestion lists only while the textbox signals active input', () => {
    expect(shouldTreatPageWallComposerSuggestionAsOwned({
      controlledVisible: 0,
      ariaExpanded: true,
      textboxFocused: false,
      fallbackVisible: 1
    })).toBe(true)
    expect(shouldTreatPageWallComposerSuggestionAsOwned({
      controlledVisible: 0,
      ariaExpanded: false,
      textboxFocused: true,
      fallbackVisible: 1
    })).toBe(true)
    expect(shouldTreatPageWallComposerSuggestionAsOwned({
      controlledVisible: 0,
      ariaExpanded: false,
      textboxFocused: false,
      fallbackVisible: 1
    })).toBe(false)
  })

  it('normalizes invisible editor markers without rewriting user hashtag text', () => {
    expect(normalizePageWallComposerText('  Bài viết #khongdau\u200B  ')).toBe('Bài viết #khongdau')
    expect(normalizePageWallComposerText('Bài viết #khongdau')).toBe('Bài viết #khongdau')
  })
})
