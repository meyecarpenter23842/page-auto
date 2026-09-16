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

export async function inspectZaloSession(page: Page): Promise<ZaloSessionEvidence> {
  return page.evaluate(() => {
    const text = (document.body?.innerText ?? '').toLocaleLowerCase('vi-VN')
    const hasPhoneInput = Boolean(document.querySelector('input[type="tel"], input[placeholder*="số điện thoại" i]'))
    const hasPasswordInput = Boolean(document.querySelector('input[type="password"], input[placeholder*="mật khẩu" i]'))
    const authenticatedShell = Boolean(
      document.querySelector('#app-page')
      && !hasPhoneInput
      && !hasPasswordInput
      && (text.includes('tin nhắn') || text.includes('danh bạ'))
    )
    const qrSurface = Boolean(
      document.querySelector('canvas, img[src*="qr" i]')
      && (text.includes('quét mã qr') || text.includes('mã qr'))
    )
    const loginSurface = hasPhoneInput || hasPasswordInput || text.includes('đăng nhập') || text.includes('số điện thoại')
    const attentionSurface = [
      'xác minh',
      'captcha',
      'bất thường',
      'kiểm tra bảo mật',
      'thử lại sau',
      'quá nhiều lần'
    ].some((needle) => text.includes(needle))
    return { authenticatedShell, loginSurface, qrSurface, attentionSurface }
  }).catch(() => ({ authenticatedShell: false, loginSurface: false, qrSurface: false, attentionSurface: true }))
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
  if (evidence.authenticatedShell || evidence.qrSurface || evidence.attentionSurface) return
  const tab = await firstVisible([
    page.getByText(/VỚI MÃ QR/i),
    page.getByText(/MÃ QR/i)
  ])
  if (tab) await tab.click({ timeout: 5_000 }).catch(() => undefined)
}

export async function runZaloPhonePasswordLogin(
  page: Page,
  phone: string,
  password: string,
  timeoutMs = 45_000
): Promise<ZaloLoginFlowResult> {
  const initial = classifyZaloSessionEvidence(await inspectZaloSession(page))
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
  const initial = classifyZaloSessionEvidence(await inspectZaloSession(page))
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
