import type { Page } from 'playwright-core'
import type { EmailAuthV2Surface } from './emailAuthV2Contracts'
import {
  classifyMicrosoftLoginSurface,
  type MicrosoftLoginSnapshot,
  type MicrosoftLoginSurface
} from './emailLoginPolicy'

export interface MicrosoftSurfaceDetection {
  surface: EmailAuthV2Surface
  snapshot: MicrosoftLoginSnapshot
}

export function toEmailAuthV2Surface(surface: MicrosoftLoginSurface): EmailAuthV2Surface {
  return surface
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
      page.locator('button:visible, a:visible, [role="button"]:visible, [role="link"]:visible').filter({ hasText: /use\s+your\s+password|sử dụng\s+mật khẩu|dùng\s+mật khẩu/i }).count()
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

export async function detectMicrosoftSurface(page: Page): Promise<MicrosoftSurfaceDetection | null> {
  const snapshot = await readMicrosoftSurfaceSnapshot(page)
  if (!snapshot) return null
  return {
    snapshot,
    surface: toEmailAuthV2Surface(classifyMicrosoftLoginSurface(snapshot))
  }
}
