import type { Page } from 'playwright-core'
import type { EmailAuthV2Surface } from './emailAuthV2Contracts'
import {
  classifyMicrosoftLoginSurface,
  classifyMicrosoftRoute,
  type MicrosoftLoginSnapshot,
  type MicrosoftLoginSurface
} from './emailLoginPolicy'
import { emailDiagnostic } from './emailRuntimeDiagnostic'

export interface MicrosoftSurfaceDetection {
  surface: EmailAuthV2Surface
  snapshot: MicrosoftLoginSnapshot
}

export function toEmailAuthV2Surface(surface: MicrosoftLoginSurface): EmailAuthV2Surface {
  return surface
}

async function visibleTextCount(page: Page, pattern: RegExp): Promise<number> {
  const matches = page.getByText(pattern)
  const count = Math.min(await matches.count(), 12)
  let visibleCount = 0
  for (let index = 0; index < count; index += 1) {
    if (await matches.nth(index).isVisible().catch(() => false)) visibleCount += 1
  }
  return visibleCount
}

async function readUsePasswordControlCount(page: Page): Promise<number> {
  const structured = await page
    .locator('button:visible, a:visible, [role="button"]:visible, [role="link"]:visible')
    .filter({ hasText: /use\s+your\s+password|sử dụng\s+mật khẩu|dùng\s+mật khẩu/i })
    .count()
  if (structured > 0) return structured
  return await visibleTextCount(page, /use\s+your\s+password|sử dụng\s+mật khẩu|dùng\s+mật khẩu/i)
}

export async function readMicrosoftSurfaceSnapshot(page: Page): Promise<MicrosoftLoginSnapshot | null> {
  try {
    const [
      text,
      emailInputCount,
      usernameInputCount,
      proofEmailInputCount,
      verificationCodeInputCount,
      passwordInputCount,
      useAnotherAccountControlCount,
      sendCodeControlCount,
      usePasswordControlCount
    ] = await Promise.all([
      page.locator('body').innerText({ timeout: 3_000 }),
      page.locator('input[name="loginfmt"]:visible, input[type="email"]:visible').count(),
      page.locator('input[name="loginfmt"]:visible, input[autocomplete="username"]:visible').count(),
      page.locator('input[type="email"]:visible:not([name="loginfmt"]):not([autocomplete="username"]), input[autocomplete="email"]:visible:not([name="loginfmt"]):not([autocomplete="username"]), input[name*="proof" i]:visible:not([name="loginfmt"]), input[id*="proof" i]:visible, input[name*="recovery" i]:visible, input[id*="recovery" i]:visible').count(),
      page.locator('input[autocomplete="one-time-code"]:visible, input[name*="otc" i]:visible, input[name*="code" i]:visible').count(),
      page.locator('input[type="password"]:visible').count(),
      page.getByText(/^(use another account|sign in with another account|sử dụng tài khoản khác|đăng nhập bằng tài khoản khác)$/i).count(),
      page.locator('button:visible, a:visible, [role="button"]:visible, [role="link"]:visible').filter({ hasText: /send\s+code|gửi\s+mã/i }).count(),
      readUsePasswordControlCount(page)
    ])

    return {
      url: page.url(),
      text,
      emailInputCount,
      usernameInputCount,
      proofEmailInputCount,
      verificationCodeInputCount,
      passwordInputCount,
      useAnotherAccountControlCount,
      sendCodeControlCount,
      usePasswordControlCount
    }
  } catch {
    return null
  }
}

export function shouldStabilizeMicrosoftPasswordPreference(detection: MicrosoftSurfaceDetection): boolean {
  if (detection.surface !== 'recovery_email_confirmation') return false
  const route = classifyMicrosoftRoute(detection.snapshot.url)
  if (route !== 'login' && route !== 'login_oauth') return false

  const snapshot = detection.snapshot
  const text = snapshot.text.toLowerCase()
  return /verify\s+your\s+email/.test(text)
    && (snapshot.proofEmailInputCount ?? 0) > 0
    && (snapshot.sendCodeControlCount ?? 0) > 0
    && (snapshot.usePasswordControlCount ?? 0) === 0
}

/**
 * Microsoft can hydrate the "Use your password" fallback slightly after the
 * recovery-email input/Send code controls. Give that higher-priority canonical
 * password path a tiny bounded window before dispatching recovery.
 */
export async function stabilizeMicrosoftPasswordPreference(
  initial: MicrosoftSurfaceDetection,
  reread: () => Promise<MicrosoftSurfaceDetection | null>,
  wait: () => Promise<void>,
  maxProbes = 2
): Promise<MicrosoftSurfaceDetection> {
  let current = initial
  for (let probe = 0; probe < maxProbes && shouldStabilizeMicrosoftPasswordPreference(current); probe += 1) {
    await wait()
    const next = await reread()
    if (next) current = next
  }
  return current
}

function logDetection(event: string, detection: MicrosoftSurfaceDetection, extra: Record<string, string | number | boolean | null> = {}): void {
  const snapshot = detection.snapshot
  emailDiagnostic('microsoft', event, {
    route: classifyMicrosoftRoute(snapshot.url),
    state: detection.surface,
    usernameInputs: snapshot.usernameInputCount ?? snapshot.emailInputCount,
    proofEmailInputs: snapshot.proofEmailInputCount ?? 0,
    codeInputs: snapshot.verificationCodeInputCount ?? 0,
    passwordInputs: snapshot.passwordInputCount,
    sendCodeControls: snapshot.sendCodeControlCount ?? 0,
    usePasswordControls: snapshot.usePasswordControlCount ?? 0,
    ...extra
  })
}

async function readDetection(page: Page): Promise<MicrosoftSurfaceDetection | null> {
  const snapshot = await readMicrosoftSurfaceSnapshot(page)
  if (!snapshot) return null
  return {
    snapshot,
    surface: toEmailAuthV2Surface(classifyMicrosoftLoginSurface(snapshot))
  }
}

export async function detectMicrosoftSurface(page: Page): Promise<MicrosoftSurfaceDetection | null> {
  const initial = await readDetection(page)
  if (!initial) {
    emailDiagnostic('microsoft', 'snapshot-unreadable', {
      route: classifyMicrosoftRoute(page.url())
    })
    return null
  }

  logDetection('surface', initial)
  if (!shouldStabilizeMicrosoftPasswordPreference(initial)) return initial

  emailDiagnostic('microsoft', 'password-fallback-stabilize', {
    route: classifyMicrosoftRoute(initial.snapshot.url),
    reason: 'verify-email-visible-before-use-password'
  })

  const stabilized = await stabilizeMicrosoftPasswordPreference(
    initial,
    async () => await readDetection(page),
    async () => { await page.waitForTimeout(200) },
    2
  )

  logDetection('surface-stabilized', stabilized, {
    changed: stabilized.surface !== initial.surface
      || (stabilized.snapshot.usePasswordControlCount ?? 0) !== (initial.snapshot.usePasswordControlCount ?? 0)
  })
  return stabilized
}
