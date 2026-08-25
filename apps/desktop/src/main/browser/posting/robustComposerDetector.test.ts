import { describe, expect, it } from 'vitest'
import { isComposerContainerEvidence } from './robustComposerDetector'

function signals(overrides: Partial<Parameters<typeof isComposerContainerEvidence>[0]> = {}): Parameters<typeof isComposerContainerEvidence>[0] {
  return {
    textboxVisible: true,
    textboxLabelMatches: false,
    titleVisible: false,
    triggerVisible: false,
    publishVisible: false,
    mediaVisible: false,
    fileInputCount: 0,
    inDialog: false,
    ...overrides
  }
}

describe('robust composer container evidence', () => {
  it('accepts the live OFF shape: labeled editor + file input without role=dialog or visible Post button', () => {
    expect(isComposerContainerEvidence(signals({
      textboxLabelMatches: true,
      fileInputCount: 1
    }))).toBe(true)
  })

  it('accepts the live ON shape when the editor is in the dialog that owns Post/media evidence', () => {
    expect(isComposerContainerEvidence(signals({
      inDialog: true,
      publishVisible: true,
      fileInputCount: 1
    }))).toBe(true)
  })

  it('accepts ancestor-scoped Create Post text + file/media evidence', () => {
    expect(isComposerContainerEvidence(signals({
      triggerVisible: true,
      mediaVisible: true
    }))).toBe(true)
  })

  it('rejects a generic comment textbox with only a file input and no composer label/title/trigger', () => {
    expect(isComposerContainerEvidence(signals({
      fileInputCount: 1
    }))).toBe(false)
  })

  it('rejects hidden textboxes even when surrounding controls look composer-like', () => {
    expect(isComposerContainerEvidence(signals({
      textboxVisible: false,
      textboxLabelMatches: true,
      publishVisible: true
    }))).toBe(false)
  })
})
