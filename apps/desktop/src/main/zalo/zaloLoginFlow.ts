import type { Locator, Page } from 'playwright-core'
import type { ZaloSessionStatus } from '../../shared/zalo'
import {
  classifyZaloSessionEvidence,
  waitForZaloSessionState,
  type ZaloSessionEvidence
} from './zaloSessionEvidence'

export interface ZaloLoginFlowResult {
  status: ZaloSessionStatus
  message: string
}

async function inspectZaloSessionOnce(page: Page): Promise<ZaloSessionEvidence> {
  return page.evaluate(() => {
    const bodyText = (document.body?.innerText ?? '').toLocaleLowerCase('vi-VN')

    const isVisible = (element: Element | null): boolean => {
      if (!(element instanceof HTMLElement)) return false
      const style = window.getComputedStyle(element)
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false
      const rect = element.getBoundingClientRect()
      return rect.width > 1 && rect.height > 1
    }

    const hasVisible = (selectors: string): boolean =>
      Array.from(document.querySelectorAll(selectors)).some((element) => isVisible(element))

    const visibleText = (selectors: string): string =>
      Array.from(document.querySelectorAll(selectors))
        .filter((element) => isVisible(element))
        .map((element) => (element.textContent ?? '').toLocaleLowerCase('vi-VN'))
        .join('\n')

    const hasPhoneInput = hasVisible('input[type="tel"], input[placeholder*="số điện thoại" i]')
    const hasPasswordInput = hasVisible('input[type="password"], input[placeholder*="mật khẩu" i]')
    const chatSearchSurface = hasVisible([
      '#contact-search-input',
      'input[data-id="txt_Main_Search"]',
      'input[type="search"]',
      'input[placeholder*="Tìm kiếm" i]',
      'input[placeholder*="Tìm bạn" i]',
      'input[aria-label*="Tìm kiếm" i]',
      '[contenteditable="true"][data-placeholder*="Tìm" i]',
      '[contenteditable="true"][aria-label*="Tìm" i]'
    ].join(','))
    const composerSurface = hasVisible([
      '#richInput',
      '#chat-input-container-id',
      '[contenteditable="true"][role="textbox"]',
      '[contenteditable="true"][data-placeholder*="tin nhắn" i]',
      'textarea[placeholder*="tin nhắn" i]'
    ].join(','))
    const appRootVisible = hasVisible('#app-page, #app, [data-id*="chat" i], [class*="chat" i]')

    const qrElementVisible = hasVisible('canvas, img[src*="qr" i], [class*="qr" i] canvas, [class*="qr" i] img')
    const qrSurface = qrElementVisible && (bodyText.includes('quét mã qr') || bodyText.includes('mã qr'))

    const likelyAuthenticatedWorkspace = chatSearchSurface || composerSurface
    const loginSurface = hasPhoneInput
      || hasPasswordInput
      || (!likelyAuthenticatedWorkspace && (bodyText.includes('đăng nhập') || bodyText.includes('số điện thoại')))

    const blockerText = visibleText([
      '[role="dialog"]',
      '[aria-modal="true"]',
      '[class*="modal" i]',
      '[class*="dialog" i]',
      '[class*="captcha" i]',
      '[class*="verify" i]',
      '[class*="challenge" i]'
    ].join(','))
    const attentionNeedles = [
      'xác minh',
      'captcha',
      'bất thường',
      'kiểm tra bảo mật',
      'thử lại sau',
      'quá nhiều lần'
    ]
    const blockingAttention = attentionNeedles.some((needle) => blockerText.includes(needle))
    const nonWorkspaceAttention = !likelyAuthenticatedWorkspace
      && attentionNeedles.some((needle) => bodyText.includes(needle))
    const attentionSurface = blockingAttention || nonWorkspaceAttention

    const authenticatedShell = !loginSurface
      && !qrSurface
      && !attentionSurface
      && (
        likelyAuthenticatedWorkspace
        || (appRootVisible && (bodyText.includes('tin nhắn') || bodyText.includes('danh bạ')))
      )

    return {
      authenticatedShell,
      loginSurface,
      qrSurface,
      attentionSurface,
      chatSearchSurface,
      composerSurface
    }
  }).catch(() => ({
    authenticatedShell: false,
    loginSurface: false,
    qrSurface: false,
    attentionSurface: true,
    chatSearchSurface: false,
    composerSurface: false
  }))
}

/**
 * Zalo Web is a SPA and can briefly expose neither login nor chat shell after DOMContentLoaded.
 * Retry only that transient unknown state; explicit login/QR/challenge surfaces return immediately.
 */
export async function inspectZaloSession(page: Page): Promise<ZaloSessionEvidence> {
  let evidence = await inspectZaloSessionOnce(page)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const status = classifyZaloSessionEvidence(evidence)
    const transientUnknown = status === 'needs_attention' && !evidence.attentionSurface
    if (!transientUnknown) return evidence
    await page.waitForTimeout(250)
    evidence = await inspectZaloSessionOnce(page)
  }
  return evidence
}

async function firstVisible(locators: Locator[]): Promise<Locator | null> {
  for (const locator of locators) {
    const candidate = locator.first()
    if (await candidate.isVisible().catch(() => false)) return candidate
  }
  return null
}

async function selectPhonePasswordMode(page: Page): Promise<void> {
  const password = await firstVisible([
    page.locator('input[type="password"]'),
    page.locator('input[placeholder*="Mật khẩu" i]')
  ])
  if (password) return
  const tab = await firstVisible([
    page.getByText(/VỚI SỐ ĐIỆN THOẠI/i),
    page.getByText(/SỐ ĐIỆN THOẠI/i)
  ])
  if (tab) await tab.click({ timeout: 5_000 }).catch(() => undefined)
}

async function selectQrMode(page: Page): Promise<void> {
  const evidence = await inspectZaloSession(page)
  const state = classifyZaloSessionEvidence(evidence)
  if (state === 'ready' || evidence.qrSurface || evidence.attentionSurface) return
  const tab = await firstVisible([
    page.getByText(/VỚI MÃ QR/i),
    page.getByText(/MÃ QR/i)
  ])
  if (tab) await tab.click({ timeout: 5_000 }).catch(() => undefined)
}

async function stableInitialSession(page: Page): Promise<ZaloSessionStatus> {
  return waitForZaloSessionState(() => inspectZaloSession(page), {
    timeoutMs: 1_500,
    pollIntervalMs: 200
  })
}

export async function runZaloPhonePasswordLogin(
  page: Page,
  phone: string,
  password: string,
  timeoutMs = 45_000
): Promise<ZaloLoginFlowResult> {
  const initial = await stableInitialSession(page)
  if (initial === 'ready') return { status: 'ready', message: 'Zalo session đã xác thực; không cần đăng nhập lại.' }
  if (initial === 'needs_attention') return { status: 'needs_attention', message: 'Zalo đang yêu cầu kiểm tra/challenge thủ công.' }

  await selectPhonePasswordMode(page)

  const phoneInput = await firstVisible([
    page.locator('input[type="tel"]'),
    page.locator('input[placeholder*="Số điện thoại" i]')
  ])
  const passwordInput = await firstVisible([
    page.locator('input[type="password"]'),
    page.locator('input[placeholder*="Mật khẩu" i]')
  ])
  if (!phoneInput || !passwordInput) {
    return { status: 'needs_attention', message: 'Không xác định được form đăng nhập SĐT/mật khẩu hiện tại của Zalo Web.' }
  }

  await phoneInput.fill(phone)
  await passwordInput.fill(password)

  const submit = await firstVisible([
    page.getByRole('button', { name: /Đăng nhập với mật khẩu/i }),
    page.getByRole('button', { name: /^Đăng nhập$/i }),
    page.getByText(/Đăng nhập với mật khẩu/i)
  ])
  if (submit) await submit.click({ timeout: 5_000 })
  else await passwordInput.press('Enter')

  const status = await waitForZaloSessionState(() => inspectZaloSession(page), { timeoutMs, pollIntervalMs: 500 })
  if (status === 'ready') return { status, message: 'Đăng nhập Zalo bằng SĐT/mật khẩu thành công và session đã được xác thực.' }
  if (status === 'needs_attention') return { status, message: 'Zalo yêu cầu operator xử lý challenge/xác minh thủ công.' }
  return { status: 'login_required', message: 'Zalo chưa xác thực session sau đăng nhập; kiểm tra thông tin đăng nhập hoặc trạng thái tài khoản.' }
}

export async function runZaloQrLogin(page: Page, timeoutMs = 180_000): Promise<ZaloLoginFlowResult> {
  const initial = await stableInitialSession(page)
  if (initial === 'ready') return { status: 'ready', message: 'Zalo session đã xác thực; không cần quét QR lại.' }
  if (initial === 'needs_attention') return { status: 'needs_attention', message: 'Zalo đang yêu cầu kiểm tra/challenge thủ công.' }

  await selectQrMode(page)
  const evidence = await inspectZaloSession(page)
  const afterSelect = classifyZaloSessionEvidence(evidence)
  if (afterSelect === 'ready') return { status: 'ready', message: 'Zalo session đã xác thực.' }
  if (afterSelect === 'needs_attention') return { status: 'needs_attention', message: 'Zalo đang yêu cầu kiểm tra/challenge thủ công.' }
  if (!evidence.qrSurface) return { status: 'needs_attention', message: 'Không xác định được mã QR đăng nhập hiện tại của Zalo Web.' }

  const status = await waitForZaloSessionState(() => inspectZaloSession(page), { timeoutMs, pollIntervalMs: 500 })
  if (status === 'ready') return { status, message: 'QR đã được xác nhận và Zalo session đã sẵn sàng.' }
  if (status === 'needs_attention') return { status, message: 'Zalo yêu cầu operator xử lý challenge/xác minh sau QR.' }
  return { status: 'qr_waiting', message: 'Hết thời gian chờ QR; profile vẫn được giữ để operator có thể thử lại.' }
}
