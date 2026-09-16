import type { Locator, Page } from 'playwright-core'
import { normalizeZaloPhone, type ZaloActionResultCode } from '../../../shared/zalo'
import type { ZaloActionControl } from './zaloActionControl'

export interface ZaloTargetEvidenceSnapshot {
  candidatePhoneMatch: boolean
  identityInTargetPane: boolean
  composerVisible: boolean
}

export function assessZaloTargetEvidence(
  evidence: ZaloTargetEvidenceSnapshot,
  requireConversation: boolean
): boolean {
  return evidence.candidatePhoneMatch
    && evidence.identityInTargetPane
    && (!requireConversation || evidence.composerVisible)
}

export type ZaloResolvedTarget = {
  ok: true
  targetPhone: string
  displayName: string | null
  composer: Locator | null
} | {
  ok: false
  code: Extract<ZaloActionResultCode, 'target_not_found' | 'target_unverified' | 'composer_missing'>
  message: string
}

async function firstVisible(locators: Locator[]): Promise<Locator | null> {
  for (const locator of locators) {
    const candidate = locator.first()
    if (await candidate.isVisible().catch(() => false)) return candidate
  }
  return null
}

function phoneVariants(phone: string): string[] {
  const normalized = normalizeZaloPhone(phone)
  const variants = [normalized]
  if (normalized.startsWith('0') && normalized.length >= 9) {
    variants.push(`84${normalized.slice(1)}`, `+84${normalized.slice(1)}`)
  }
  return [...new Set(variants)]
}

function digitsMatch(text: string, targetPhone: string): boolean {
  const textDigits = text.replace(/\D/g, '')
  if (!textDigits) return false
  return phoneVariants(targetPhone).some((variant) => {
    const digits = variant.replace(/\D/g, '')
    return digits.length >= 8 && textDigits.includes(digits)
  })
}

function displayNameFromCandidate(text: string, targetPhone: string): string | null {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  for (const line of lines) {
    if (digitsMatch(line, targetPhone)) continue
    if (/^(kết bạn|nhắn tin|tìm kiếm|số điện thoại)$/i.test(line)) continue
    if (line.length <= 120) return line
  }
  return null
}

async function searchInput(page: Page): Promise<Locator | null> {
  return firstVisible([
    page.locator('input[type="search"]'),
    page.locator('input[placeholder*="Tìm kiếm" i]'),
    page.locator('input[placeholder*="Tìm bạn" i]'),
    page.locator('input[aria-label*="Tìm kiếm" i]')
  ])
}

async function phoneCandidate(page: Page, targetPhone: string): Promise<Locator | null> {
  for (const variant of phoneVariants(targetPhone)) {
    const texts = await page.getByText(variant, { exact: false }).all()
    for (const text of texts.slice(0, 12)) {
      if (!await text.isVisible().catch(() => false)) continue
      const clickable = text.locator('xpath=ancestor-or-self::*[self::button or self::a or self::li or @role="button"][1]')
      if (await clickable.isVisible().catch(() => false)) return clickable
      return text
    }
  }
  return null
}

async function messageComposer(page: Page): Promise<Locator | null> {
  return firstVisible([
    page.locator('[contenteditable="true"][role="textbox"]'),
    page.locator('[contenteditable="true"][data-placeholder*="tin nhắn" i]'),
    page.locator('textarea[placeholder*="tin nhắn" i]'),
    page.locator('[contenteditable="true"]')
  ])
}

async function hasIdentityInTargetPane(
  page: Page,
  search: Locator,
  composer: Locator | null,
  targetPhone: string,
  displayName: string | null
): Promise<boolean> {
  const searchBox = await search.boundingBox().catch(() => null)
  const composerBox = composer ? await composer.boundingBox().catch(() => null) : null
  const minimumX = composerBox?.x ?? (searchBox ? searchBox.x + searchBox.width + 16 : null)
  const identities = [...phoneVariants(targetPhone), ...(displayName ? [displayName] : [])]

  for (const identity of identities) {
    const matches = await page.getByText(identity, { exact: false }).all()
    for (const match of matches.slice(0, 24)) {
      if (!await match.isVisible().catch(() => false)) continue
      const text = (await match.innerText().catch(() => '')) || (await match.textContent().catch(() => '')) || ''
      const phoneIdentity = digitsMatch(text, targetPhone)
      const nameIdentity = Boolean(displayName && text.toLocaleLowerCase('vi-VN').includes(displayName.toLocaleLowerCase('vi-VN')))
      if (!phoneIdentity && !nameIdentity) continue
      if (minimumX === null) return true
      const box = await match.boundingBox().catch(() => null)
      if (box && box.x >= minimumX - 40) return true
    }
  }
  return false
}

export async function resolveZaloTarget(
  page: Page,
  targetPhone: string,
  control: ZaloActionControl,
  options: { requireConversation: boolean }
): Promise<ZaloResolvedTarget> {
  const normalized = normalizeZaloPhone(targetPhone)
  await control.checkpoint()
  const search = await searchInput(page)
  if (!search) {
    return { ok: false, code: 'target_not_found', message: 'Không tìm thấy ô tìm kiếm người dùng Zalo.' }
  }

  await search.fill(normalized)
  await control.sleep(700)
  const candidate = await phoneCandidate(page, normalized)
  if (!candidate) {
    return { ok: false, code: 'target_not_found', message: `Không tìm thấy target Zalo theo SĐT ${normalized}.` }
  }

  const candidateText = (await candidate.innerText().catch(() => '')) || (await candidate.textContent().catch(() => '')) || ''
  if (!digitsMatch(candidateText, normalized)) {
    return { ok: false, code: 'target_unverified', message: 'Kết quả tìm kiếm không có bằng chứng SĐT khớp target; action bị chặn.' }
  }
  const displayName = displayNameFromCandidate(candidateText, normalized)

  await control.checkpoint()
  await candidate.click({ timeout: 5_000 })
  await control.sleep(700)
  const composer = await messageComposer(page)
  const identityInTargetPane = await hasIdentityInTargetPane(page, search, composer, normalized, displayName)
  const evidence: ZaloTargetEvidenceSnapshot = {
    candidatePhoneMatch: true,
    identityInTargetPane,
    composerVisible: Boolean(composer)
  }

  if (!assessZaloTargetEvidence(evidence, options.requireConversation)) {
    if (options.requireConversation && !composer) {
      return { ok: false, code: 'composer_missing', message: 'Đã tìm thấy target nhưng chưa xác minh được khung chat/composer đúng target.' }
    }
    return { ok: false, code: 'target_unverified', message: 'Không đủ bằng chứng identity trong vùng target sau khi mở kết quả; action bị chặn.' }
  }

  return { ok: true, targetPhone: normalized, displayName, composer }
}
