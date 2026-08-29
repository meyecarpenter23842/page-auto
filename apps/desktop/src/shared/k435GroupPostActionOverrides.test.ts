import { describe, expect, it } from 'vitest'
import { getActionDefinition, validateActionConfig } from './actionRegistry'
import {
  applyK435GroupPostActionOverrides,
  getK435FieldUiMeta,
  getK435ValidationErrors
} from './k435GroupPostActionOverrides'

applyK435GroupPostActionOverrides()

describe('K4.3.5 group_post action overrides', () => {
  it('marks group_post ready with snapshot/posting config', () => {
    const definition = getActionDefinition('group_post')
    expect(definition?.runtimeStatus).toBe('ready')
    expect(definition?.configSchema.fields.map((field) => field.key)).toEqual([
      'sourceTargets',
      'content',
      'postMode',
      'postsPerAccount',
      'postDelayMinSeconds',
      'postDelayMaxSeconds',
      'imageFolderPath',
      'imageMode',
      'imagesPerPost',
      'missingPolicy'
    ])
    expect(getK435FieldUiMeta('group_post', 'sourceTargets')?.textFilePickerLabel).toBe('Mở file ID')
    expect(getK435FieldUiMeta('group_post', 'imageFolderPath')?.folderPickerLabel).toBe('Chọn folder')
  })

  it('accepts a valid profile group-post config', () => {
    const base = validateActionConfig('group_post', {
      sourceTargets: '123\nhttps://www.facebook.com/groups/456/',
      content: 'Bài A\n|\nBài B',
      postMode: 'random',
      postsPerAccount: 2,
      postDelayMinSeconds: 10,
      postDelayMaxSeconds: 20,
      imageFolderPath: '',
      imageMode: 'sequential',
      imagesPerPost: 1,
      missingPolicy: 'text_only'
    })
    expect(base.valid).toBe(true)
    expect(getK435ValidationErrors('group_post', base.value)).toEqual([])
  })

  it('rejects empty targets/content and inverted post delay', () => {
    const base = validateActionConfig('group_post', {
      sourceTargets: '   ',
      content: '  ',
      postDelayMinSeconds: 30,
      postDelayMaxSeconds: 10
    })
    expect(base.valid).toBe(true)
    expect(getK435ValidationErrors('group_post', base.value)).toEqual([
      'Group ID / URL: cần nhập ít nhất một Group.',
      'Nội dung bài viết: cần ít nhất một nội dung hợp lệ.',
      'Delay bài: giá trị từ phải nhỏ hơn hoặc bằng giá trị đến.'
    ])
  })
})
