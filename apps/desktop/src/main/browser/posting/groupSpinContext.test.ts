import { describe, expect, it } from 'vitest'
import { groupTargetNameFromFacebookTitle } from './groupSpinContext'

describe('groupTargetNameFromFacebookTitle', () => {
  it('extracts the live Group name from normal Facebook titles', () => {
    expect(groupTargetNameFromFacebookTitle('Hội Mua Bán Mỹ Tho | Facebook')).toBe('Hội Mua Bán Mỹ Tho')
    expect(groupTargetNameFromFacebookTitle('(3) Hội Kinh Doanh Tiền Giang · Facebook Groups')).toBe('Hội Kinh Doanh Tiền Giang')
  })

  it('does not invent a Group name from generic login/Facebook titles', () => {
    expect(groupTargetNameFromFacebookTitle('Facebook')).toBeNull()
    expect(groupTargetNameFromFacebookTitle('Facebook - Log In or Sign Up')).toBeNull()
    expect(groupTargetNameFromFacebookTitle('Đăng nhập Facebook')).toBeNull()
    expect(groupTargetNameFromFacebookTitle('')).toBeNull()
  })
})
