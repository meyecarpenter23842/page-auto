import { describe, expect, it } from 'vitest'
import { classifyFacebookAccessText, classifyFacebookUrl } from './pageState'

describe('classifyFacebookUrl', () => {
  it('detects login and verification routes without treating normal pages as blocked', () => {
    expect(classifyFacebookUrl('https://www.facebook.com/login/?next=%2Fgroups%2F1')).toBe('login_required')
    expect(classifyFacebookUrl('https://www.facebook.com/checkpoint/123')).toBe('verification_required')
    expect(classifyFacebookUrl('https://www.facebook.com/groups/123')).toBeNull()
  })
})

describe('classifyFacebookAccessText', () => {
  it('treats common locked and disabled account surfaces as verification blocks', () => {
    expect(classifyFacebookAccessText('Your account has been locked')).toBe('verification_required')
    expect(classifyFacebookAccessText('Tài khoản của bạn đã bị khóa')).toBe('verification_required')
    expect(classifyFacebookAccessText('Your account has been disabled')).toBe('verification_required')
    expect(classifyFacebookAccessText('Tài khoản của bạn đã bị vô hiệu hóa')).toBe('verification_required')
  })

  it('keeps explicit identity/account verification prompts as authentication blocks', () => {
    expect(classifyFacebookAccessText('Xác minh danh tính của bạn để tiếp tục')).toBe('verification_required')
    expect(classifyFacebookAccessText('Bạn cần xác minh tài khoản của bạn')).toBe('verification_required')
    expect(classifyFacebookAccessText('Confirm your identity to continue')).toBe('verification_required')
  })

  it('does not treat generic Page verification/admin copy as a checkpoint', () => {
    expect(classifyFacebookAccessText('Trạng thái xác minh Trang và Meta Verified')).toBeNull()
    expect(classifyFacebookAccessText('Xem thông tin xác minh doanh nghiệp')).toBeNull()
    expect(classifyFacebookAccessText('Friends · Reels · Groups')).toBeNull()
  })
})
