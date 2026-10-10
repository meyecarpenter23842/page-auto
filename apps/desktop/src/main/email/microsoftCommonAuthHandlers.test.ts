import { describe, expect, it } from 'vitest'
import {
  MICROSOFT_COMMON_AUTH_SURFACES,
  MicrosoftCommonAuthHandlers,
  isMicrosoftCommonAuthSurface,
  type MicrosoftAccountPickerChoice,
  type MicrosoftCommonAuthUi
} from './microsoftCommonAuthHandlers'

interface FakeUiState {
  usernameFillCalls: string[]
  passwordFillCalls: string[]
  submitCalls: number
  accountPickerCalls: string[]
  staySignedInCalls: number
}

interface FakeUiOptions {
  usernameReadback?: string | null
  passwordReadback?: string | null
  submitReady?: boolean
  accountPickerChoice?: MicrosoftAccountPickerChoice
  staySignedInReady?: boolean
}

function createFakeUi(options: FakeUiOptions = {}): { ui: MicrosoftCommonAuthUi; state: FakeUiState } {
  const state: FakeUiState = {
    usernameFillCalls: [],
    passwordFillCalls: [],
    submitCalls: 0,
    accountPickerCalls: [],
    staySignedInCalls: 0
  }

  const ui: MicrosoftCommonAuthUi = {
    async fillUsername(value) {
      state.usernameFillCalls.push(value)
      return options.usernameReadback === undefined ? value : options.usernameReadback
    },
    async fillPassword(value) {
      state.passwordFillCalls.push(value)
      return options.passwordReadback === undefined ? value : options.passwordReadback
    },
    async clickPrimarySubmit() {
      state.submitCalls += 1
      return options.submitReady ?? true
    },
    async chooseAccount(canonicalEmail) {
      state.accountPickerCalls.push(canonicalEmail)
      return options.accountPickerChoice ?? 'canonical'
    },
    async clickStaySignedIn() {
      state.staySignedInCalls += 1
      return options.staySignedInReady ?? true
    }
  }

  return { ui, state }
}

function createHandlers(overrides: { loginEmail?: string; loginPassword?: string } = {}) {
  return new MicrosoftCommonAuthHandlers({
    accountId: 42,
    profileDirectory: 'EmailProfileRoot/42',
    loginEmail: overrides.loginEmail === undefined ? 'owner@example.com' : overrides.loginEmail,
    loginPassword: overrides.loginPassword === undefined ? 'PassEmail-value' : overrides.loginPassword
  })
}

describe('MicrosoftCommonAuthHandlers', () => {
  it('locks Batch 2 to the audited common surfaces only', () => {
    expect(MICROSOFT_COMMON_AUTH_SURFACES).toEqual([
      'authenticated',
      'username',
      'password',
      'account_picker',
      'stay_signed_in',
      'passkey_prompt',
      'sign_in_continue'
    ])
    expect(isMicrosoftCommonAuthSurface('username')).toBe(true)
    expect(isMicrosoftCommonAuthSurface('recovery_code')).toBe(false)
  })

  it('Username uses only canonical Email, verifies the readback, then submits', async () => {
    const handlers = createHandlers({ loginPassword: '' })
    const { ui, state } = createFakeUi()

    const outcome = await handlers.handle('username', ui)

    expect(outcome).toEqual({
      result: { kind: 'handled' },
      attempted: true
    })
    expect(state.usernameFillCalls).toEqual(['owner@example.com'])
    expect(state.submitCalls).toBe(1)
    expect(state.passwordFillCalls).toEqual([])
  })

  it('Username never submits when the DOM readback differs from canonical Email', async () => {
    const handlers = createHandlers()
    const { ui, state } = createFakeUi({ usernameReadback: 'other@example.com' })

    const outcome = await handlers.handle('username', ui)

    expect(outcome?.result).toEqual({ kind: 'needs_attention', reason: 'username_fill_mismatch' })
    expect(outcome?.needsAttentionReason).toBe('needs_login')
    expect(state.submitCalls).toBe(0)
  })

  it('Username fails closed when canonical Email is missing', async () => {
    const handlers = createHandlers({ loginEmail: '' })
    const { ui, state } = createFakeUi()

    const outcome = await handlers.handle('username', ui)

    expect(outcome?.result).toEqual({ kind: 'needs_attention', reason: 'missing_canonical_email' })
    expect(state.usernameFillCalls).toEqual([])
    expect(state.submitCalls).toBe(0)
  })

  it('bounds repeated Username submissions across re-detection', async () => {
    const handlers = createHandlers()
    const { ui, state } = createFakeUi()

    expect((await handlers.handle('username', ui))?.result).toEqual({ kind: 'handled' })
    expect((await handlers.handle('username', ui))?.result).toEqual({ kind: 'handled' })
    const exhausted = await handlers.handle('username', ui)

    expect(exhausted?.result).toEqual({
      kind: 'needs_attention',
      reason: 'username_retry_budget_exhausted'
    })
    expect(state.submitCalls).toBe(2)
    expect(state.usernameFillCalls).toHaveLength(2)
  })

  it('Username returns retryable when its input or submit control is not ready', async () => {
    const missingInput = createFakeUi({ usernameReadback: null })
    const first = await createHandlers().handle('username', missingInput.ui)
    expect(first?.result).toEqual({ kind: 'retryable', reason: 'username_input_not_ready' })
    expect(missingInput.state.submitCalls).toBe(0)

    const missingSubmit = createFakeUi({ submitReady: false })
    const second = await createHandlers().handle('username', missingSubmit.ui)
    expect(second?.result).toEqual({ kind: 'retryable', reason: 'username_submit_not_ready' })
    expect(missingSubmit.state.submitCalls).toBe(1)
  })

  it('does not charge Username submit budget when the Submit control is transiently missing', async () => {
    const handlers = createHandlers()
    const options: FakeUiOptions = { submitReady: false }
    const { ui, state } = createFakeUi(options)

    expect((await handlers.handle('username', ui))?.result).toEqual({
      kind: 'retryable',
      reason: 'username_submit_not_ready'
    })
    expect((await handlers.handle('username', ui))?.result).toEqual({
      kind: 'retryable',
      reason: 'username_submit_not_ready'
    })

    options.submitReady = true
    expect((await handlers.handle('username', ui))?.result).toEqual({ kind: 'handled' })
    expect((await handlers.handle('username', ui))?.result).toEqual({ kind: 'handled' })
    expect((await handlers.handle('username', ui))?.result).toEqual({
      kind: 'needs_attention',
      reason: 'username_retry_budget_exhausted'
    })

    expect(state.submitCalls).toBe(4)
  })

  it('Password uses only canonical PassEmail and verifies DOM value before submit', async () => {
    const handlers = createHandlers({ loginEmail: '' })
    const { ui, state } = createFakeUi()

    const outcome = await handlers.handle('password', ui)

    expect(outcome).toEqual({
      result: { kind: 'handled' },
      attempted: true
    })
    expect(state.passwordFillCalls).toEqual(['PassEmail-value'])
    expect(state.submitCalls).toBe(1)
    expect(state.usernameFillCalls).toEqual([])
  })

  it('Password never submits when the DOM readback does not match PassEmail', async () => {
    const handlers = createHandlers()
    const { ui, state } = createFakeUi({ passwordReadback: 'wrong-value' })

    const outcome = await handlers.handle('password', ui)

    expect(outcome?.result).toEqual({ kind: 'needs_attention', reason: 'password_fill_mismatch' })
    expect(outcome?.needsAttentionReason).toBe('needs_login')
    expect(state.submitCalls).toBe(0)
    expect(JSON.stringify(outcome)).not.toContain('PassEmail-value')
  })

  it('Password fails closed when canonical PassEmail is missing', async () => {
    const handlers = createHandlers({ loginPassword: '' })
    const { ui, state } = createFakeUi()

    const outcome = await handlers.handle('password', ui)

    expect(outcome?.result).toEqual({ kind: 'needs_attention', reason: 'missing_canonical_password' })
    expect(state.passwordFillCalls).toEqual([])
    expect(state.submitCalls).toBe(0)
  })

  it('Password returns retryable when its input or submit control is not ready', async () => {
    const missingInput = createFakeUi({ passwordReadback: null })
    expect((await createHandlers().handle('password', missingInput.ui))?.result).toEqual({
      kind: 'retryable',
      reason: 'password_input_not_ready'
    })
    expect(missingInput.state.submitCalls).toBe(0)

    const missingSubmit = createFakeUi({ submitReady: false })
    expect((await createHandlers().handle('password', missingSubmit.ui))?.result).toEqual({
      kind: 'retryable',
      reason: 'password_submit_not_ready'
    })
    expect(missingSubmit.state.submitCalls).toBe(1)
  })

  it('Account Picker passes only canonical Email to the UI adapter', async () => {
    const handlers = createHandlers()
    const canonical = createFakeUi({ accountPickerChoice: 'canonical' })

    expect((await handlers.handle('account_picker', canonical.ui))?.result).toEqual({ kind: 'handled' })
    expect(canonical.state.accountPickerCalls).toEqual(['owner@example.com'])
  })

  it('Account Picker may choose Use another account, but never guesses without canonical Email', async () => {
    const another = createFakeUi({ accountPickerChoice: 'another' })
    expect((await createHandlers().handle('account_picker', another.ui))?.result).toEqual({ kind: 'handled' })

    const missingEmail = createFakeUi({ accountPickerChoice: 'another' })
    const outcome = await createHandlers({ loginEmail: '' }).handle('account_picker', missingEmail.ui)
    expect(outcome?.result).toEqual({ kind: 'needs_attention', reason: 'missing_canonical_email' })
    expect(missingEmail.state.accountPickerCalls).toEqual([])
  })

  it('Account Picker retries instead of guessing when no audited choice is ready', async () => {
    const { ui } = createFakeUi({ accountPickerChoice: 'unavailable' })
    expect((await createHandlers().handle('account_picker', ui))?.result).toEqual({
      kind: 'retryable',
      reason: 'account_picker_not_ready'
    })
  })

  it('Stay Signed In performs exactly one audited click and then hands control back for re-detect', async () => {
    const ready = createFakeUi()
    expect(await createHandlers().handle('stay_signed_in', ready.ui)).toEqual({
      result: { kind: 'handled' },
      attempted: true
    })
    expect(ready.state.staySignedInCalls).toBe(1)

    const notReady = createFakeUi({ staySignedInReady: false })
    expect((await createHandlers().handle('stay_signed_in', notReady.ui))?.result).toEqual({
      kind: 'retryable',
      reason: 'stay_signed_in_not_ready'
    })
  })

  it('Authenticated is terminal only when the dispatcher/detector supplied that surface', async () => {
    const { ui, state } = createFakeUi()
    expect(await createHandlers().handle('authenticated', ui)).toEqual({
      result: { kind: 'authenticated' },
      attempted: false
    })
    expect(state.submitCalls).toBe(0)
    expect(state.accountPickerCalls).toEqual([])
  })

  it('Passkey and Sign in Continue remain explicit fail-closed blockers until live ownership is audited', async () => {
    const { ui, state } = createFakeUi()
    const handlers = createHandlers()

    const passkey = await handlers.handle('passkey_prompt', ui)
    expect(passkey?.result).toEqual({
      kind: 'needs_attention',
      reason: 'passkey_live_evidence_required'
    })
    expect(passkey?.needsAttentionReason).toBe('needs_login')

    const continuation = await handlers.handle('sign_in_continue', ui)
    expect(continuation?.result).toEqual({
      kind: 'needs_attention',
      reason: 'sign_in_continue_live_evidence_required'
    })
    expect(continuation?.needsAttentionReason).toBe('needs_login')

    expect(state.submitCalls).toBe(0)
    expect(state.staySignedInCalls).toBe(0)
  })

  it('does not claim recovery surfaces that belong to later batches', async () => {
    const { ui } = createFakeUi()
    expect(await createHandlers().handle('recovery_code', ui)).toBeNull()
    expect(await createHandlers().handle('recovery_email_confirmation', ui)).toBeNull()
  })
})
