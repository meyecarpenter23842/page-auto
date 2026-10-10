import { describe, expect, it } from 'vitest'
import {
  ensureEditorVariants,
  insertTextAtSelection,
  replaceEditorVariant
} from './contentLibraryEditor'

describe('Content Library editor helpers', () => {
  it('keeps at least one visible editor variant without inventing canonical content', () => {
    expect(ensureEditorVariants([])).toEqual([''])
    expect(ensureEditorVariants(['A', 'B'])).toEqual(['A', 'B'])
  })

  it('updates only the active library variant', () => {
    expect(replaceEditorVariant(['A', 'B', 'C'], 1, 'B mới')).toEqual(['A', 'B mới', 'C'])
  })

  it('inserts a Spin token exactly at the textarea selection and returns the new cursor', () => {
    expect(insertTextAtSelection('Xin chào NAME!', '[u]', 9, 13)).toEqual({
      value: 'Xin chào [u]!',
      cursor: 12
    })
  })
})
