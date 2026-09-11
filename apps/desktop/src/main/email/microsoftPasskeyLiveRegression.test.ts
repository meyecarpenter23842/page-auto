import { describe, expect, it } from 'vitest'
import { classifyMicrosoftLoginSurface } from './emailLoginPolicy'
import {
  MicrosoftCommonAuthHandlers,
  type MicrosoftCommonAuthUi
} from './microsoftCommonAuthHandlers'

const livePasskeyUrl = 'https://login.microsoft.com/consumers/fido/create?mkt=en-US'
const livePasskeyText = 'Microsoft Setting up your passkey... Your device is opening a security window. Follow the instructions to finish setting up your passkey. Cancel Next'
const staySignedInUrl = 'https://login.live.com/oauth20_authorize.srf?client_id=test-client&state=dynamic-state'

function createLiveUi() {
  const state = {
    passkeyCancelCalls: 0,
    staySignedInCalls: 0
  }
  const ui: MicrosoftCommonAuthUi = {
    async fillUsername(value) { return value },
    async fillPassword(value) { return value },
    async clickPrimarySubmit() { return true },
    async chooseAccount() { return 'canonical' },
    async clickStaySignedIn() {
      state.staySignedInCalls += 1
      return true
    },
    async clickPasskeyCancel() {
      state.passkeyCancelCalls += 1
      return true
    }
  }
  return { ui, state }
}

function createHandlers() {
  return new MicrosoftCommonAuthHandlers({
    accountId: 42,
    profileDirectory: 'EmailProfileRoot/42',
    loginEmail: 'owner@example.com',
    loginPassword: 'PassEmail-value'
  })
}

describe('Microsoft live passkey -> Stay signed in regression', () => {
  it('classifies only the audited Microsoft FIDO create surface as passkey_prompt', () => {
    expect(classifyMicrosoftLoginSurface({
      url: livePasskeyUrl,
      text: livePasskeyText,
      emailInputCount: 0,
      passwordInputCount: 0
    })).toBe('passkey_prompt')

    expect(classifyMicrosoftLoginSurface({
      url: livePasskeyUrl,
      text: 'Loading...',
      emailInputCount: 0,
      passwordInputCount: 0
    })).toBe('login_transition')

    expect(classifyMicrosoftLoginSurface({
      url: 'https://example.test/consumers/fido/create',
      text: livePasskeyText,
      emailInputCount: 0,
      passwordInputCount: 0
    })).toBe('manual_login')
  })

  it('re-detects the observed next screen as Stay signed in instead of inventing a Sign in Continue surface', () => {
    expect(classifyMicrosoftLoginSurface({
      url: staySignedInUrl,
      text: 'Stay signed in? Yes No',
      emailInputCount: 0,
      passwordInputCount: 0
    })).toBe('stay_signed_in')
  })

  it('handles exactly one Passkey Cancel then exactly one Stay signed in Yes action', async () => {
    const handlers = createHandlers()
    const { ui, state } = createLiveUi()

    expect(await handlers.handle('passkey_prompt', ui)).toEqual({
      result: { kind: 'handled' },
      attempted: true
    })
    expect(state.passkeyCancelCalls).toBe(1)
    expect(state.staySignedInCalls).toBe(0)

    expect(await handlers.handle('stay_signed_in', ui)).toEqual({
      result: { kind: 'handled' },
      attempted: true
    })
    expect(state.passkeyCancelCalls).toBe(1)
    expect(state.staySignedInCalls).toBe(1)
  })

  it('bounds a repeatedly re-detected Passkey surface instead of looping forever', async () => {
    const handlers = createHandlers()
    const { ui, state } = createLiveUi()

    expect((await handlers.handle('passkey_prompt', ui))?.result).toEqual({ kind: 'handled' })
    expect((await handlers.handle('passkey_prompt', ui))?.result).toEqual({ kind: 'handled' })
    const exhausted = await handlers.handle('passkey_prompt', ui)

    expect(exhausted?.result).toEqual({
      kind: 'needs_attention',
      reason: 'passkey_cancel_retry_budget_exhausted'
    })
    expect(exhausted?.needsAttentionReason).toBe('needs_login')
    expect(state.passkeyCancelCalls).toBe(2)
  })
})
