import { describe, expect, it } from 'vitest'
import { inspectContentVariants, inspectSpinSyntax, normalizePostForComparison } from './contentQuality'

describe('contentQuality', () => {
  it('normalizes text while retaining Vietnamese words', () => {
    expect(normalizePostForComparison('  Căn Hộ, giá TỐT! ')).toBe('căn hộ giá tốt')
  })

  it('warns about invalid brackets and numeric tokens without rejecting valid nested spin', () => {
    expect(inspectSpinSyntax('{A|B{X|Y}} [r3]')).toEqual([])
    expect(inspectSpinSyntax('{A|B [r12]')).toHaveLength(2)
    expect(inspectSpinSyntax('A } B')).toHaveLength(1)
  })

  it('warns on exact and near duplicates but does not alter source', () => {
    const post = 'Căn hộ mới tại trung tâm có thiết kế rộng rãi gần trường học công viên tiện ích và siêu thị'
    const variants = [post, post.toUpperCase(), post + ' hôm nay']
    const warnings = inspectContentVariants(variants)
    expect(warnings.some((value) => value.includes('trùng nội dung'))).toBe(true)
    expect(warnings.some((value) => value.includes('rất giống'))).toBe(true)
    expect(variants[0]).toBe(post)
  })

  it('does not flag distinct short posts as near-duplicates', () => {
    expect(inspectContentVariants(['Mẫu A mới', 'Mẫu B mới', 'Bài {A|B}'])).toEqual([])
  })
})
