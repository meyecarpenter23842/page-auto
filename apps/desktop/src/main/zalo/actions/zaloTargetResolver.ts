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

export function digitsMatch(text: string, targetPhone: string): boolean {
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
    if (/^(kết bạn|nhắn tin|tìm kiếm|kết quả tìm kiếm|số điện thoại)$/i.test(line)) continue
    if (line.length <= 120) return line
  }
  return null
}

function normalizeIdentityText(value: string): string {
  return value.toLocaleLowerCase('vi-VN').replace(/\s+/g, ' ').trim()
}

export function zaloDisplayNameMatches(value: string, displayName: string): boolean {
  const haystack = normalizeIdentityText(value)
  const needle = normalizeIdentityText(displayName)
  return needle.length > 0 && haystack.includes(needle)
}

async function candidateEvidenceText(candidate: Locator, targetPhone: string): Promise<string> {
  const direct = [
    (await candidate.innerText().catch(() => '')) || (await candidate.textContent().catch(() => '')) || '',
    (await candidate.getAttribute('aria-label').catch(() => null)) || '',
    (await candidate.getAttribute('title').catch(() => null)) || ''
  ].join('\n')
  if (displayNameFromCandidate(direct, targetPhone)) return direct

  let current = candidate
  for (let depth = 0; depth < 4; depth += 1) {
    current = current.locator('xpath=..')
    const text = (await current.innerText().catch(() => '')) || (await current.textContent().catch(() => '')) || ''
    if (!text || text.length > 600 || !digitsMatch(text, targetPhone)) continue
    if (displayNameFromCandidate(text, targetPhone)) return text
  }
  return direct
}

async function composerIdentityMatches(composer: Locator, displayName: string | null): Promise<boolean> {
  if (!displayName) return false
  const nodes = [composer, ...(await composer.locator('[data-trailer], [placeholder]').all())]
  for (const node of nodes.slice(0, 16)) {
    const metadata = [
      (await node.getAttribute('data-trailer').catch(() => null)) || '',
      (await node.getAttribute('placeholder').catch(() => null)) || '',
      (await node.getAttribute('aria-label').catch(() => null)) || ''
    ].join('\n')
    if (zaloDisplayNameMatches(metadata, displayName)) return true
  }
  return false
}

async function searchInput(page: Page): Promise<Locator | null> {
  return firstVisible([
    page.locator('#contact-search-input'),
    page.locator('input[data-id="txt_Main_Search"]'),
    page.locator('input[type="search"]'),
    page.locator('input[placeholder*="Tìm kiếm" i]'),
    page.locator('input[placeholder*="Tìm bạn" i]'),
    page.locator('input[aria-label*="Tìm kiếm" i]'),
    page.locator('[contenteditable="true"][data-placeholder*="Tìm" i]'),
    page.locator('[contenteditable="true"][aria-label*="Tìm" i]')
  ])
}

async function phoneCandidate(page: Page, targetPhone: string): Promise<Locator | null> {
  const candidates = await page.locator('button, a, li, [role="button"], [role="listitem"]').all()
  for (const candidate of candidates.slice(0, 160)) {
    if (!await candidate.isVisible().catch(() => false)) continue
    const text = [
      (await candidate.innerText().catch(() => '')) || '',
      (await candidate.getAttribute('aria-label').catch(() => null)) || '',
      (await candidate.getAttribute('title').catch(() => null)) || ''
    ].join('\n')
    if (digitsMatch(text, targetPhone)) return candidate
  }

  for (const variant of phoneVariants(targetPhone)) {
    const texts = await page.getByText(variant, { exact: false }).all()
    for (const text of texts.slice(0, 12)) {
      if (!await text.isVisible().catch(() => false)) continue
      const clickable = text.locator('xpath=ancestor-or-self::*[self::button or self::a or self::li or @role="button" or @role="listitem"][1]')
      if (await clickable.isVisible().catch(() => false)) return clickable
      return text
    }
  }
  return null
}

async function messageComposer(page: Page): Promise<Locator | null> {
  return firstVisible([
    page.locator('#richInput'),
    page.locator('[data-keybinding-context^="mainChatInputFocus"]'),
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
  // Live Zalo exposes the active conversation name directly on the composer
  // (for example data-trailer / placeholder "Nhập @, tin nhắn tới <name>").
  // This is stronger target-pane evidence than requiring the phone number to
  // remain visible after the search result has opened the conversation.
  if (composer && await composerIdentityMatches(composer, displayName)) return true

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

  const candidateText = await candidateEvidenceText(candidate, normalized)
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
