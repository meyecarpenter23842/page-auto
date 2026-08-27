import { describe, expect, it } from 'vitest'
import {
  choosePublishCandidateStrategy,
  isComposerAncestorBoundary,
  isComposerContainerEvidence,
  waitForComposerStage
} from './robustComposerDetector'

function signals(overrides: Partial<Parameters<typeof isComposerContainerEvidence>[0]> = {}): Parameters<typeof isComposerContainerEvidence>[0] {
  return {
    textboxVisible: true,
    textboxLabelMatches: false,
    visibleTextboxCount: 1,
    titleVisible: false,
    triggerVisible: false,
    publishVisible: false,
    mediaVisible: false,
    fileInputCount: 0,
    inDialog: false,
    ...overrides
  }
}

describe('robust composer container ownership', () => {
  it('accepts the live OFF shape only when the inline editor itself is composer-labeled', () => {
    expect(isComposerContainerEvidence(signals({
      textboxLabelMatches: true,
      fileInputCount: 1
    }))).toBe(true)
  })

  it('accepts the dialog shape when the dialog owns editor + publish/media evidence', () => {
    expect(isComposerContainerEvidence(signals({
      inDialog: true,
      publishVisible: true,
      fileInputCount: 1
    }))).toBe(true)
  })

  it('rejects a comment textbox borrowing Create-post/media evidence from a shared ancestor', () => {
    expect(isComposerContainerEvidence(signals({
      triggerVisible: true,
      mediaVisible: true
    }))).toBe(false)
  })

  it('rejects a shared inline ancestor containing multiple visible textboxes', () => {
    expect(isComposerContainerEvidence(signals({
      textboxLabelMatches: true,
      visibleTextboxCount: 3,
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

  it('stops ancestor ownership at page-level semantic boundaries', () => {
    expect(isComposerAncestorBoundary('main', null)).toBe(true)
    expect(isComposerAncestorBoundary('div', 'feed')).toBe(true)
    expect(isComposerAncestorBoundary('div', 'dialog')).toBe(false)
  })
})

describe('composer delayed readiness polling', () => {
  it('keeps polling when group surface is ready before trigger and editor render', async () => {
    let triggerProbeCount = 0
    const trigger = await waitForComposerStage(async () => {
      triggerProbeCount += 1
      return triggerProbeCount >= 4 ? 'trigger-ready' : null
    }, 1_000, async () => undefined)

    expect(trigger).toBe('trigger-ready')
    expect(triggerProbeCount).toBe(4)

    let editorProbeCount = 0
    const editor = await waitForComposerStage(async () => {
      editorProbeCount += 1
      return editorProbeCount >= 3 ? 'editor-ready' : null
    }, 1_000, async () => undefined)

    expect(editor).toBe('editor-ready')
    expect(editorProbeCount).toBe(3)
  })

  it('allows DOM readiness after the old 18-second composer window when network timeout is larger', async () => {
    let probeCount = 0
    const ready = await waitForComposerStage(async () => {
      probeCount += 1
      return probeCount >= 80 ? 'late-editor-ready' : null
    }, 30_000, async () => undefined)

    expect(ready).toBe('late-editor-ready')
    expect(probeCount).toBe(80)
  })
})

describe('publish candidate ownership', () => {
  it('keeps composer-scoped publish ahead of any page-wide fallback', () => {
    expect(choosePublishCandidateStrategy(1, 0, 1, 1)).toBe('scoped-role')
  })

  it('prefers an exact aria-labeled Post inside the resolved composer before leaving scope', () => {
    expect(choosePublishCandidateStrategy(0, 1, 1, 1)).toBe('scoped-aria')
  })

  it('allows one unique page-wide semantic Post control for a portaled footer', () => {
    expect(choosePublishCandidateStrategy(0, 0, 1, 0)).toBe('page-unique-role')
    expect(choosePublishCandidateStrategy(0, 0, 0, 1)).toBe('page-unique-aria')
  })

  it('refuses ambiguous page-wide publish controls instead of guessing', () => {
    expect(choosePublishCandidateStrategy(0, 0, 2, 0)).toBe('none')
    expect(choosePublishCandidateStrategy(0, 0, 0, 2)).toBe('none')
  })
})
