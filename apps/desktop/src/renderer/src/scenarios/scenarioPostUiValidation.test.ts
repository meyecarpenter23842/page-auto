import { describe, expect, it } from 'vitest'
import type { ScenarioActionPostInput } from '../../../shared/scenarios'
import {
  canDisableScenarioPost,
  clampScenarioImagesPerPost,
  ensureScenarioHasEnabledPost
} from './scenarioPostUiValidation'

function post(enabled: boolean, sortOrder: number): ScenarioActionPostInput {
  return {
    postId: sortOrder + 1,
    name: `Bài ${sortOrder + 1}`,
    enabled,
    sortOrder,
    variants: ['Nội dung'],
    image: { folderPath: '', mode: 'random', imagesPerPost: 1, missingPolicy: 'text_only' }
  }
}

describe('Scenario post UI validation', () => {
  it('clamps images per post to the repository limit', () => {
    expect(clampScenarioImagesPerPost(0)).toBe(1)
    expect(clampScenarioImagesPerPost(12.9)).toBe(12)
    expect(clampScenarioImagesPerPost(999)).toBe(50)
  })

  it('does not allow disabling the last enabled post', () => {
    expect(canDisableScenarioPost([post(true, 0), post(false, 1)], 0)).toBe(false)
    expect(canDisableScenarioPost([post(true, 0), post(true, 1)], 0)).toBe(true)
  })

  it('repairs legacy drafts that contain posts but none are enabled', () => {
    const repaired = ensureScenarioHasEnabledPost([post(false, 0), post(false, 1)])
    expect(repaired.map((item) => item.enabled)).toEqual([true, false])
  })
})
