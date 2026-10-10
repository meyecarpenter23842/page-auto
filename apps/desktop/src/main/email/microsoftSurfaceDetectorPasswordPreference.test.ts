import { describe, expect, it } from 'vitest'
import type { MicrosoftSurfaceDetection } from './microsoftSurfaceDetector'
import {
  shouldStabilizeMicrosoftPasswordPreference,
  stabilizeMicrosoftPasswordPreference
} from './microsoftSurfaceDetector'

function detection(usePasswordControlCount: number): MicrosoftSurfaceDetection {
  return {
    surface: usePasswordControlCount > 0 ? 'password_method_choice' : 'recovery_email_confirmation',
    snapshot: {
      url: 'https://login.live.com/oauth20_authorize.srf',
      text: 'Verify your email We will send a code. Use your password',
      emailInputCount: 1,
      usernameInputCount: 0,
      proofEmailInputCount: 1,
      verificationCodeInputCount: 0,
      passwordInputCount: 0,
      useAnotherAccountControlCount: 0,
      sendCodeControlCount: 1,
      usePasswordControlCount
    }
  }
}

describe('Microsoft surface password preference stabilization', () => {
  it('briefly re-probes Verify your email when password fallback has not hydrated yet', async () => {
    const initial = detection(0)
    expect(shouldStabilizeMicrosoftPasswordPreference(initial)).toBe(true)

    let reads = 0
    let waits = 0
    const stable = await stabilizeMicrosoftPasswordPreference(
      initial,
      async () => {
        reads += 1
        return detection(1)
      },
      async () => { waits += 1 },
      2
    )

    expect(stable.surface).toBe('password_method_choice')
    expect(stable.snapshot.usePasswordControlCount).toBe(1)
    expect(reads).toBe(1)
    expect(waits).toBe(1)
  })

  it('falls back to the audited recovery-email surface after a bounded probe window', async () => {
    const initial = detection(0)
    let reads = 0
    const stable = await stabilizeMicrosoftPasswordPreference(
      initial,
      async () => {
        reads += 1
        return detection(0)
      },
      async () => undefined,
      2
    )

    expect(stable.surface).toBe('recovery_email_confirmation')
    expect(reads).toBe(2)
  })

  it('does not delay a surface when Use your password is already visible', () => {
    expect(shouldStabilizeMicrosoftPasswordPreference(detection(1))).toBe(false)
  })
})
