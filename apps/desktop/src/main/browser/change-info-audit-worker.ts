import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from 'playwright-core'
import type {
  ChangeInfoAuditControlEvidence,
  ChangeInfoAuditRegionEvidence,
  ChangeInfoBioAuditEvidence,
  ChangeInfoBioAuditResult
} from '../../shared/changeInfoAudit'
import type { ScenarioActionWorkerJob } from '../../shared/scenarioActionWorker'
import { inspectFacebookAccountIdentity } from './facebookAccountIdentity'
import { ensureFacebookProfileIdentity } from './facebookProfileIdentity'
import { validateFacebookSession } from './facebookSession'
import {
  closeManagedPostingBrowser,
  installManagedBrowserReuse,
  managedCdpEndpointFromArgs
} from './managedBrowserBridge'
import { FacebookCommonRuntime } from '../facebook/facebookCommonRuntime'
import { withoutFacebookInteractionPacing } from '../facebook/facebookInteractionPacing'

const parentPort = process.parentPort
if (!parentPort) throw new Error('Change Info audit worker phải chạy dưới Electron utilityProcess.')

const attachedToManagedBrowser = Boolean(managedCdpEndpointFromArgs())
installManagedBrowserReuse()

interface AuditBioCommand {
  type: 'audit-bio'
  job: ScenarioActionWorkerJob
  evidenceFolder: string
}

interface ShutdownCommand {
  type: 'shutdown'
}

function messagePayload(event: unknown): unknown {
  return event && typeof event === 'object' && 'data' in event
    ? (event as { data?: unknown }).data
    : event
}

function auditBioCommand(event: unknown): AuditBioCommand | null {
  const payload = messagePayload(event)
  if (!payload || typeof payload !== 'object') return null
  const candidate = payload as Partial<AuditBioCommand>
  if (candidate.type !== 'audit-bio' || !candidate.job || typeof candidate.evidenceFolder !== 'string') return null
  return { type: 'audit-bio', job: candidate.job, evidenceFolder: candidate.evidenceFolder }
}

function isShutdownCommand(event: unknown): event is ShutdownCommand {
  const payload = messagePayload(event)
  return Boolean(payload && typeof payload === 'object' && (payload as Partial<ShutdownCommand>).type === 'shutdown')
}

function failed(job: ScenarioActionWorkerJob, code: string, message: string): ChangeInfoBioAuditResult {
  return {
    status: 'failed',
    accountId: job.accountId,
    uid: job.sessionAccount.uid,
    code,
    message
  }
}

function needsAttention(job: ScenarioActionWorkerJob, code: string, message: string): ChangeInfoBioAuditResult {
  return {
    status: 'needs_attention',
    accountId: job.accountId,
    uid: job.sessionAccount.uid,
    code,
    message
  }
}

async function collectBioEvidence(
  page: Page,
  evidenceFolder: string,
  uid: string
): Promise<ChangeInfoBioAuditEvidence> {
  const snapshot = await page.evaluate(() => {
    const normalize = (value: string | null | undefined): string => (value ?? '').replace(/\s+/g, ' ').trim()
    const visible = (element: Element): boolean => {
      const node = element as HTMLElement
      const style = window.getComputedStyle(node)
      const rect = node.getBoundingClientRect()
      return rect.width > 0
        && rect.height > 0
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number.parseFloat(style.opacity || '1') > 0
    }
    const control = (element: Element): ChangeInfoAuditControlEvidence => {
      const node = element as HTMLElement
      const input = element instanceof HTMLInputElement ? element : null
      return {
        tag: element.tagName.toLowerCase(),
        role: element.getAttribute('role'),
        ariaLabel: element.getAttribute('aria-label'),
        title: element.getAttribute('title'),
        text: normalize(node.innerText || element.textContent).slice(0, 240),
        inputType: input?.type ?? null,
        contentEditable: node.isContentEditable
      }
    }

    const interactiveSelector = 'button,[role="button"],a,[role="link"],input,textarea,[role="textbox"],[contenteditable="true"]'
    const auditPattern = /(bio|tiểu sử|edit|sửa|details|chi tiết|pencil|bút chì|save|lưu|cancel|hủy|about yourself|yourself)/i
    const targetPattern = /(bio|tiểu sử|details about you|about yourself|yourself)/i

    const relevantControls = Array.from(document.querySelectorAll(interactiveSelector))
      .filter(visible)
      .map(control)
      .filter((item) => {
        const editorInput = item.tag === 'textarea' || item.role === 'textbox' || item.contentEditable
        return editorInput || auditPattern.test(`${item.ariaLabel ?? ''} ${item.title ?? ''} ${item.text}`)
      })
      .slice(0, 100)

    const regions: ChangeInfoAuditRegionEvidence[] = []
    const seen = new Set<string>()
    const addRegion = (region: Element): void => {
      const text = normalize((region as HTMLElement).innerText || region.textContent).slice(0, 1600)
      const controls = Array.from(region.querySelectorAll(interactiveSelector))
        .filter(visible)
        .map(control)
        .slice(0, 40)
      if (!text && !controls.length) return
      const key = `${text}|${controls.map((item) => `${item.ariaLabel ?? ''}:${item.text}:${item.tag}:${item.role ?? ''}`).join('|')}`
      if (seen.has(key)) return
      seen.add(key)
      regions.push({ text, controls })
    }

    for (const dialog of Array.from(document.querySelectorAll('[role="dialog"]')).filter(visible).slice(0, 8)) {
      addRegion(dialog)
    }

    const textCandidates = Array.from(document.querySelectorAll('div,span,p,h1,h2,h3,h4'))
      .filter(visible)
      .filter((element) => targetPattern.test(normalize((element as HTMLElement).innerText || element.textContent)))
      .slice(0, 50)

    for (const candidate of textCandidates) {
      let region: Element | null = candidate
      for (let depth = 0; depth < 5 && region?.parentElement; depth += 1) {
        const parentElement: HTMLElement = region.parentElement
        const text = normalize(parentElement.innerText || parentElement.textContent)
        const hasControl = parentElement.querySelector(interactiveSelector) !== null
        if (hasControl && text.length > 0 && text.length <= 1600) region = parentElement
        else break
      }
      if (!region) continue
      const text = normalize((region as HTMLElement).innerText || region.textContent).slice(0, 1600)
      if (!targetPattern.test(text)) continue
      addRegion(region)
      if (regions.length >= 16) break
    }

    return {
      url: window.location.href,
      title: document.title,
      locale: document.documentElement.lang || null,
      relevantControls,
      relevantRegions: regions
    }
  })

  let screenshotPath: string | null = null
  const folder = evidenceFolder.trim()
  if (folder) {
    await mkdir(folder, { recursive: true })
    const safeUid = uid.replace(/[^a-zA-Z0-9._-]/g, '_') || 'account'
    screenshotPath = join(folder, `${Date.now()}-${safeUid}-bio-editor-audit.png`)
    await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => { screenshotPath = null })
  }

  return { ...snapshot, screenshotPath }
}

async function openAuditedBioEditor(page: Page): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const detailsTab = page.getByRole('tab', { name: 'Details about you', exact: true })
  const detailsTabCount = await detailsTab.count()
  if (detailsTabCount !== 1 || !await detailsTab.isVisible().catch(() => false)) {
    return {
      ok: false,
      code: 'bio_details_tab_unconfirmed',
      message: `Không xác nhận được đúng tab “Details about you” từ live evidence (count=${detailsTabCount}).`
    }
  }

  const trigger = page.getByRole('button', { name: 'Write some details about yourself', exact: true })
  const triggerCount = await trigger.count()
  if (triggerCount !== 1 || !await trigger.isVisible().catch(() => false)) {
    return {
      ok: false,
      code: 'bio_editor_trigger_unconfirmed',
      message: `Không xác nhận được đúng trigger Bio “Write some details about yourself” từ live evidence (count=${triggerCount}).`
    }
  }

  await trigger.click()
  return { ok: true }
}

async function runBioAudit(command: AuditBioCommand): Promise<ChangeInfoBioAuditResult> {
  const job = command.job
  const opened = await FacebookCommonRuntime.open({
    profileDirectory: job.profileDirectory,
    pageUid: '',
    browser: job.browser,
    session: job.session,
    network: job.network,
    sessionAccount: job.sessionAccount,
    ...(job.userAgent ? { userAgent: job.userAgent } : {}),
    ...(job.proxy ? { proxy: job.proxy } : {}),
    diagnostic: (message) => console.info(`[PAGE-AUTO change-info-audit] ${message}`)
  })
  if (opened.status === 'failed') {
    return failed(job, opened.result.code ?? 'browser_unavailable', opened.result.message)
  }

  const runtime = opened.runtime
  try {
    await runtime.page.goto('https://www.facebook.com/', {
      waitUntil: 'domcontentloaded',
      timeout: runtime.browser.navigationTimeoutMs
    })
    if (runtime.browser.pageSettleDelayMs > 0) {
      await runtime.page.waitForTimeout(runtime.browser.pageSettleDelayMs)
    }

    const session = await withoutFacebookInteractionPacing(runtime.page, () => (
      validateFacebookSession(runtime.context, runtime.page)
    ))
    if (session.state !== 'valid') {
      return needsAttention(
        job,
        session.state === 'verification_required' ? 'checkpoint_required' : 'session_needs_login',
        session.message
      )
    }

    const identity = await inspectFacebookAccountIdentity(runtime.context, job.sessionAccount.uid)
    if (identity.state === 'mismatch' || identity.state === 'missing') {
      return needsAttention(job, 'session_needs_login', identity.message)
    }

    const profile = await ensureFacebookProfileIdentity(
      runtime.context,
      runtime.page,
      runtime.browser,
      job.sessionAccount.uid
    )
    if (profile.status !== 'success') {
      if (profile.code === 'verification_required' || profile.status === 'needs_login') {
        return needsAttention(
          job,
          profile.code === 'verification_required' ? 'checkpoint_required' : 'session_needs_login',
          profile.message
        )
      }
      return failed(job, profile.code ?? 'profile_identity_unconfirmed', profile.message)
    }

    await runtime.page.goto('https://www.facebook.com/me?sk=about_details', {
      waitUntil: 'domcontentloaded',
      timeout: runtime.browser.navigationTimeoutMs
    })
    if (runtime.browser.pageSettleDelayMs > 0) {
      await runtime.page.waitForTimeout(runtime.browser.pageSettleDelayMs)
    }

    const access = await runtime.checkAccessBlock('khi audit live Tiểu sử')
    if (access.status !== 'success') {
      return needsAttention(
        job,
        access.code === 'verification_required' ? 'checkpoint_required' : 'session_needs_login',
        access.message
      )
    }

    const editor = await openAuditedBioEditor(runtime.page)
    if (!editor.ok) return failed(job, editor.code, editor.message)
    if (runtime.browser.pageSettleDelayMs > 0) {
      await runtime.page.waitForTimeout(runtime.browser.pageSettleDelayMs)
    }

    const afterOpenAccess = await runtime.checkAccessBlock('sau khi mở editor Tiểu sử để audit')
    if (afterOpenAccess.status !== 'success') {
      return needsAttention(
        job,
        afterOpenAccess.code === 'verification_required' ? 'checkpoint_required' : 'session_needs_login',
        afterOpenAccess.message
      )
    }

    const evidence = await collectBioEvidence(runtime.page, command.evidenceFolder, job.sessionAccount.uid)
    return {
      status: 'success',
      accountId: job.accountId,
      uid: job.sessionAccount.uid,
      message: evidence.relevantRegions.length || evidence.relevantControls.length
        ? 'Đã mở đúng editor Tiểu sử bằng trigger đã audit và thu semantic evidence; chưa fill/Save và chưa thay đổi Facebook.'
        : 'Đã click đúng trigger Tiểu sử nhưng chưa thu được semantic evidence của editor; cần xem screenshot/live surface.',
      evidence
    }
  } catch (error) {
    return failed(job, 'audit_failed', error instanceof Error ? error.message : String(error))
  } finally {
    await runtime.close().catch(() => undefined)
    if (!attachedToManagedBrowser) await closeManagedPostingBrowser().catch(() => undefined)
  }
}

let running = false
let shuttingDown = false

async function shutdown(): Promise<void> {
  if (!attachedToManagedBrowser) await closeManagedPostingBrowser().catch(() => undefined)
  setTimeout(() => process.exit(0), 25)
}

parentPort.on('message', (event) => {
  if (isShutdownCommand(event)) {
    if (shuttingDown) return
    shuttingDown = true
    void shutdown()
    return
  }

  const command = auditBioCommand(event)
  if (!command || running || shuttingDown) return
  running = true
  void runBioAudit(command).then((result) => {
    parentPort.postMessage({ type: 'result', result })
  }).catch((error) => {
    parentPort.postMessage({ type: 'result', result: failed(command.job, 'audit_failed', error instanceof Error ? error.message : String(error)) })
  }).finally(() => {
    setTimeout(() => process.exit(0), 25)
  })
})

parentPort.postMessage({ type: 'ready' })
