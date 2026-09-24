import { describe, expect, it } from 'vitest'
import {
  HOTMAIL_SECURITY_RECOVERY_PROVIDERS,
  buildHotmailRecoveryAddress,
  hotmailSecurityPresetActions
} from './hotmailSecurityUiModel'

describe('hotmailSecurityUiModel', () => {
  it('uses the exact Inboxes and Fvia domain registries exposed by Email providers', () => {
    const inboxes = HOTMAIL_SECURITY_RECOVERY_PROVIDERS.find((item) => item.id === 'inboxes')
    const fvia = HOTMAIL_SECURITY_RECOVERY_PROVIDERS.find((item) => item.id === 'fviainboxes')

    expect(inboxes?.domains).toEqual([
      'getnada.com', 'getmule.com', 'tupmail.com', 'blondmail.com', 'spicysoda.com', 'replyloop.com',
      'chapsmail.com', 'guysmail.com', 'fivermail.com', 'clowmail.com', 'gimpmail.com', 'dropjar.com',
      'getairmail.com', 'givmail.com', 'inboxbear.com', 'robot-mail.com', 'tafmail.com', 'temptami.com', 'vomoto.com'
    ])
    expect(fvia?.domains).toEqual([
      'fviainboxes.com', 'fviadropinbox.com', 'fviamail.work', 'dropinboxes.com', 'titanads.email'
    ])
  })

  it('builds the recovery mailbox from primary local-part plus suffix and selected domain', () => {
    expect(buildHotmailRecoveryAddress('adagasilknurp@hotmail.com', 'b2401', 'fivermail.com'))
      .toBe('adagasilknurpb2401@fivermail.com')
    expect(buildHotmailRecoveryAddress('Demo.User@outlook.com', '_kp', 'fviainboxes.com'))
      .toBe('demo.user_kp@fviainboxes.com')
  })

  it('maps right-click presets to the intended security actions', () => {
    expect(hotmailSecurityPresetActions('add')).toEqual(['add_recovery'])
    expect(hotmailSecurityPresetActions('remove')).toEqual(['remove_recovery'])
    expect(hotmailSecurityPresetActions('password')).toEqual(['password'])
    expect(hotmailSecurityPresetActions('combo')).toEqual(['add_recovery', 'remove_recovery', 'password'])
  })
})
