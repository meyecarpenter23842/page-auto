import { describe, expect, it } from 'vitest'
import { classifyFacebookUrl } from './pageState'

describe('classifyFacebookUrl', () => {
  it('detects login and verification routes without treating normal pages as blocked', () => {
    expect(classifyFacebookUrl('https://www.facebook.com/login/?next=%2Fgroups%2F1')).toBe('login_required')
    expect(classifyFacebookUrl('https://www.facebook.com/checkpoint/123')).toBe('verification_required')
    expect(classifyFacebookUrl('https://www.facebook.com/groups/123')).toBeNull()
  })
})
