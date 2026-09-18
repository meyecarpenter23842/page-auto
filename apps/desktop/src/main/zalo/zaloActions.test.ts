import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizeZaloActionInput } from '../../shared/zalo'
import { ZaloActionControl, ZaloActionStoppedError } from './actions/zaloActionControl'
import { assessZaloTargetEvidence, digitsMatch, displayNameFromCandidateText, zaloDisplayNameMatches } from './actions/zaloTargetResolver'

describe('Zalo Batch 3 action modules', () => {
  it('normalizes single-target action input and rejects empty business payloads', () => {
    expect(normalizeZaloActionInput({
      type: 'send_message',
      targetPhone: '+84 912 345 678',
      content: '  Xin chào  '
    })).toEqual({ type: 'send_message', targetPhone: '0912345678', content: 'Xin chào' })

    expect(() => normalizeZaloActionInput({
      type: 'send_message',
      targetPhone: '0912345678',
      content: '   '
    })).toThrow(/không được để trống/i)

    expect(() => normalizeZaloActionInput({
      type: 'send_attachment',
      targetPhone: '0912345678',
      paths: []
    })).toThrow(/ít nhất một/i)
  })

  it('pins production actions to the live Zalo Web search/composer DOM', () => {
    const root = join(process.cwd(), 'src/main/zalo')
    const resolver = readFileSync(join(root, 'actions/zaloTargetResolver.ts'), 'utf8')
    const sendMessage = readFileSync(join(root, 'actions/sendMessage.ts'), 'utf8')
    const sendAttachment = readFileSync(join(root, 'actions/sendAttachment.ts'), 'utf8')
    expect(resolver).toContain("page.locator('#contact-search-input')")
    expect(resolver).toContain("input[data-id=\"txt_Main_Search\"]")
    expect(resolver).toContain("page.locator('#richInput')")
    expect(sendMessage).toContain("page.locator('#chat-input-container-id')")
    expect(sendMessage).toContain("composer.getAttribute('contenteditable')")
    expect(sendMessage).toContain('page.keyboard.insertText(content)')
    expect(sendMessage).toContain('#richInput chưa chuyển sang trạng thái nhập được')
    expect(sendMessage.indexOf("page.locator('#chat-input-container-id').click")).toBeLessThan(sendMessage.indexOf("composer.click"))
    expect(sendAttachment).toContain("page.waitForEvent('filechooser'")
    expect(sendAttachment).toContain('fileChooser.setFiles(path)')
  })

  it('matches formatted phone evidence without weakening target verification', () => {
    expect(digitsMatch('Nguyễn A · 0912 345 678', '0912345678')).toBe(true)
    expect(digitsMatch('Nguyễn A · +84 912-345-678', '0912345678')).toBe(true)
    expect(digitsMatch('Nguyễn A · 0987 654 321', '0912345678')).toBe(false)
  })

  it('extracts the live result name nearest the phone instead of generic search labels', () => {
    const liveResultText = [
      'Tất cả',
      'Liên hệ',
      'Tin nhắn',
      'File',
      'Tìm bạn qua số điện thoại:',
      'BINH TT-',
      'Số điện thoại: 0902964685'
    ].join('\n')

    expect(displayNameFromCandidateText(liveResultText, '0902964685')).toBe('BINH TT-')
    expect(displayNameFromCandidateText('BINH TT-\nSố điện thoại: 0902964685', '0902964685')).toBe('BINH TT-')
  })

  it('uses live composer metadata as target-pane identity after phone-verified search result', () => {
    expect(zaloDisplayNameMatches('BINH TT-', 'BINH TT-')).toBe(true)
    expect(zaloDisplayNameMatches('Nhập @, tin nhắn tới BINH TT-', 'BINH TT-')).toBe(true)
    expect(zaloDisplayNameMatches('Nhập @, tin nhắn tới NGƯỜI KHÁC', 'BINH TT-')).toBe(false)

    const resolver = readFileSync(join(process.cwd(), 'src/main/zalo/actions/zaloTargetResolver.ts'), 'utf8')
    expect(resolver).toContain("getAttribute('data-trailer')")
    expect(resolver).toContain("getAttribute('placeholder')")
    expect(resolver).toContain('candidateEvidenceText(candidate, normalized)')
    expect(resolver).toContain('composerIdentityMatches(composer, displayName)')
    expect(resolver).toContain('for (let attempt = 0; attempt < 24; attempt += 1)')
    expect(resolver).toContain('không lấy được tên từ result để xác minh conversation')
  })

  it('requires target phone + target-pane identity and conversation evidence before sending', () => {
    expect(assessZaloTargetEvidence({
      candidatePhoneMatch: true,
      identityInTargetPane: true,
      composerVisible: true
    }, true)).toBe(true)

    expect(assessZaloTargetEvidence({
      candidatePhoneMatch: false,
      identityInTargetPane: true,
      composerVisible: true
    }, true)).toBe(false)

    expect(assessZaloTargetEvidence({
      candidatePhoneMatch: true,
      identityInTargetPane: false,
      composerVisible: true
    }, true)).toBe(false)

    expect(assessZaloTargetEvidence({
      candidatePhoneMatch: true,
      identityInTargetPane: true,
      composerVisible: false
    }, true)).toBe(false)

    expect(assessZaloTargetEvidence({
      candidatePhoneMatch: true,
      identityInTargetPane: true,
      composerVisible: false
    }, false)).toBe(true)
  })

  it('supports cooperative pause/resume and stop', async () => {
    const control = new ZaloActionControl()
    control.pause()
    let resumed = false
    const pending = control.waitIfPaused().then(() => { resumed = true })
    await Promise.resolve()
    expect(resumed).toBe(false)
    control.resume()
    await pending
    expect(resumed).toBe(true)

    control.stop()
    await expect(control.checkpoint()).rejects.toBeInstanceOf(ZaloActionStoppedError)
    control.reset()
    await expect(control.checkpoint()).resolves.toBeUndefined()
  })

  it('keeps three business actions in separate modules and outside login common flow', () => {
    const root = join(process.cwd(), 'src/main/zalo')
    const sendMessage = readFileSync(join(root, 'actions/sendMessage.ts'), 'utf8')
    const sendAttachment = readFileSync(join(root, 'actions/sendAttachment.ts'), 'utf8')
    const addFriend = readFileSync(join(root, 'actions/addFriend.ts'), 'utf8')
    const loginFlow = readFileSync(join(root, 'zaloLoginFlow.ts'), 'utf8')

    expect(sendMessage).toContain('sendZaloMessage')
    expect(sendAttachment).toContain('sendZaloAttachment')
    expect(addFriend).toContain('addZaloFriend')
    expect(loginFlow).not.toMatch(/sendZaloMessage|sendZaloAttachment|addZaloFriend|articleManager/i)
    expect(`${sendMessage}\n${sendAttachment}\n${addFriend}`).not.toMatch(/runZaloPhonePasswordLogin|runZaloQrLogin|articleManager/i)
  })

  it('pins actions to the prepared account worker and reuses the existing Zalo tab', () => {
    const worker = readFileSync(join(process.cwd(), 'src/main/zalo/zalo-browser-worker.ts'), 'utf8')
    const runtime = readFileSync(join(process.cwd(), 'src/main/zalo/zaloBrowserRuntime.ts'), 'utf8')
    const batch = readFileSync(join(process.cwd(), 'src/main/zalo/zaloBatchRunner.ts'), 'utf8')
    const controlBranch = worker.indexOf("if (command.type === 'action-control')")
    const queuedBranch = worker.indexOf('queue = queue')
    expect(controlBranch).toBeGreaterThan(0)
    expect(queuedBranch).toBeGreaterThan(0)
    expect(controlBranch).toBeLessThan(queuedBranch)
    expect(worker).toContain("find((page) => page.url().startsWith('https://chat.zalo.me'))")
    expect(worker).toContain("sessionStatus !== 'ready'")
    expect(runtime).toContain('prepareActionSession')
    expect(runtime).toContain('executePreparedAction')
    expect(batch).toContain('prepareActionSession(account)')
    expect(batch).toContain('executePreparedAction(account.id, action)')
    expect(batch).not.toContain('this.browser.executeAction(account, action)')
  })

  it('keeps Batch 3 action runtime behind typed IPC while bulk automation is the primary renderer surface', () => {
    const renderer = readFileSync(join(process.cwd(), 'src/renderer/src/zalo/ZaloWorkspace.tsx'), 'utf8')
    const batchPanel = readFileSync(join(process.cwd(), 'src/renderer/src/zalo/ZaloBatchPanel.tsx'), 'utf8')
    const preload = readFileSync(join(process.cwd(), 'src/preload/zaloBridge.ts'), 'utf8')
    const combined = `${renderer}\n${batchPanel}\n${preload}`

    expect(preload).toContain('executeAction')
    expect(batchPanel).toContain('startBatch')
    expect(batchPanel).toContain('getBatchStatus')
    expect(renderer).toContain('<ZaloBatchPanel')
    expect(renderer).toContain('accounts={accounts}')
    expect(renderer).toContain('onAccountsChanged={loadAccounts}')
    expect(renderer).not.toContain("const [targetPhone, setTargetPhone] = useState('')")
    expect(combined).not.toMatch(/playwright|better-sqlite3|node:fs|node:path|articleManager|zalo.*post.*store/i)
  })
})