import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { redactZaloSecretText } from '../../shared/zalo'
import { classifyZaloSessionEvidence, waitForZaloSessionState, type ZaloSessionEvidence } from './zaloSessionEvidence'

const loginEvidence: ZaloSessionEvidence = {
  authenticatedShell: false,
  loginSurface: true,
  qrSurface: false,
  attentionSurface: false
}
const qrEvidence: ZaloSessionEvidence = {
  authenticatedShell: false,
  loginSurface: true,
  qrSurface: true,
  attentionSurface: false
}
const readyEvidence: ZaloSessionEvidence = {
  authenticatedShell: true,
  loginSurface: false,
  qrSurface: false,
  attentionSurface: false
}

describe('Zalo Batch 2 login/session', () => {
  it('keeps QR waiting until authenticated evidence appears', async () => {
    const sequence = [qrEvidence, qrEvidence, readyEvidence]
    let index = 0
    const status = await waitForZaloSessionState(
      async () => sequence[Math.min(index++, sequence.length - 1)]!,
      { timeoutMs: 100, pollIntervalMs: 0, sleep: async () => undefined }
    )
    expect(status).toBe('ready')
  })

  it('does not fake ready when login evidence never becomes authenticated', async () => {
    const status = await waitForZaloSessionState(async () => loginEvidence, { timeoutMs: 0 })
    expect(status).toBe('login_required')
  })

  it('uses the live Zalo Web search/composer selectors as authenticated workspace evidence', () => {
    const loginFlow = readFileSync(join(process.cwd(), 'src/main/zalo/zaloLoginFlow.ts'), 'utf8')
    expect(loginFlow).toContain("'#contact-search-input'")
    expect(loginFlow).toContain("'input[data-id=\"txt_Main_Search\"]'")
    expect(loginFlow).toContain("'#richInput'")
    expect(loginFlow).toContain("'#chat-input-container-id'")
  })

  it('treats the visible authenticated chat workspace as ready even when stale login controls remain mounted', () => {
    expect(classifyZaloSessionEvidence({
      authenticatedShell: false,
      loginSurface: true,
      qrSurface: false,
      attentionSurface: false,
      chatSearchSurface: true,
      composerSurface: false
    })).toBe('ready')

    expect(classifyZaloSessionEvidence({
      authenticatedShell: false,
      loginSurface: true,
      qrSurface: false,
      attentionSurface: true,
      chatSearchSurface: true,
      composerSurface: false
    })).toBe('needs_attention')
  })

  it('stabilizes open-session evidence before declaring a persisted profile logged out', () => {
    const worker = readFileSync(join(process.cwd(), 'src/main/zalo/zalo-browser-worker.ts'), 'utf8')
    expect(worker).toContain('waitForZaloSessionState(() => inspectZaloSession(page)')
    expect(worker).toContain('timeoutMs: 8_000')
  })

  it('gracefully closes persistent contexts before app quit so profile state can flush', () => {
    const runtime = readFileSync(join(process.cwd(), 'src/main/zalo/zaloBrowserRuntime.ts'), 'utf8')
    const ipc = readFileSync(join(process.cwd(), 'src/main/zaloIpc.ts'), 'utf8')
    const main = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
    expect(runtime).toContain('await Promise.all(accountIds.map((accountId) => this.close(accountId)))')
    expect(ipc).toContain('await browser.closeAll()')
    expect(main).toContain('event.preventDefault()')
    expect(main).toContain('void runtime.dispose()')
  })

  it('stops on challenge/security evidence instead of bypassing it', async () => {
    expect(classifyZaloSessionEvidence({
      authenticatedShell: false,
      loginSurface: true,
      qrSurface: true,
      attentionSurface: true
    })).toBe('needs_attention')
  })

  it('redacts password values from runtime error text', () => {
    const output = redactZaloSecretText('login failed for password super-secret-value', ['super-secret-value'])
    expect(output).toContain('[REDACTED]')
    expect(output).not.toContain('super-secret-value')
  })

  it('does not expose stored Zalo password back through preload account views', () => {
    const preload = readFileSync(join(process.cwd(), 'src/preload/zaloBridge.ts'), 'utf8')
    const renderer = readFileSync(join(process.cwd(), 'src/renderer/src/zalo/ZaloWorkspace.tsx'), 'utf8')
    const shared = readFileSync(join(process.cwd(), 'src/shared/zalo.ts'), 'utf8')
    const accountView = shared.slice(
      shared.indexOf('export interface ZaloAccountView'),
      shared.indexOf('export interface ZaloAccountDraft')
    )

    expect(preload).toContain('ZaloAccountView')
    expect(preload).not.toContain('ZaloAccountRecord')
    expect(renderer).not.toMatch(/account\.password\b/)
    expect(renderer).toContain('account.hasPassword')
    expect(accountView).toContain('passwordMasked: string')
    expect(accountView).not.toMatch(/\n\s*password:\s/)
  })

  it('keeps business action implementation out of Batch 2 common login flow', () => {
    const loginFlow = readFileSync(join(process.cwd(), 'src/main/zalo/zaloLoginFlow.ts'), 'utf8')
    const worker = readFileSync(join(process.cwd(), 'src/main/zalo/zalo-browser-worker.ts'), 'utf8')
    expect(loginFlow).not.toMatch(/sendZaloMessage|sendZaloAttachment|addZaloFriend|articleManager/i)
    expect(worker).toContain("mode === 'phone_password'")
    expect(worker).toContain('runZaloQrLogin')
    expect(worker).toContain('runZaloAction')
  })
})