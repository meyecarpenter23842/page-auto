import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import type { HotmailSecurityAction, HotmailSecurityTarget, HotmailComboBatchResult } from '../../../shared/emailCombo'
import type { HotmailDashboardRow } from '../../../shared/hotmail'
import {
  HOTMAIL_SECURITY_RECOVERY_PROVIDERS,
  buildHotmailRecoveryAddress,
  hotmailSecurityPresetActions,
  type HotmailSecurityPreset
} from './hotmailSecurityUiModel'

interface HotmailComboPanelProps {
  selectedIds: number[]
  rows: HotmailDashboardRow[]
  preset: HotmailSecurityPreset
  onMessage: (message: string) => void
  onRefresh: () => Promise<void>
}

type PasswordMode = 'random' | 'fixed'

function comboSummary(result: HotmailComboBatchResult): string {
  const success = result.results.filter((item) => item.status === 'success').length
  const attention = result.results.filter((item) => item.status === 'needs_attention').length
  const failed = result.results.length - success - attention
  const detail = result.results.find((item) => item.status !== 'success')?.message
  return `Hotmail Security ${result.results.length} tài khoản · ${success} hoàn tất · ${attention} cần xử lý · ${failed} lỗi${detail ? ` · ${detail}` : ''}.`
}

function randomPassword(length: number): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*'
  const bytes = new Uint32Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (value) => alphabet[value % alphabet.length] ?? 'A').join('')
}

export function HotmailComboPanel({
  selectedIds,
  rows,
  preset,
  onMessage,
  onRefresh
}: HotmailComboPanelProps) {
  const [actions, setActions] = useState<HotmailSecurityAction[]>(() => hotmailSecurityPresetActions(preset))
  const [providerId, setProviderId] = useState<'inboxes' | 'fviainboxes'>('inboxes')
  const [domain, setDomain] = useState('fivermail.com')
  const [suffix, setSuffix] = useState('')
  const [passwordMode, setPasswordMode] = useState<PasswordMode>('random')
  const [passwordLength, setPasswordLength] = useState(12)
  const [fixedPassword, setFixedPassword] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setActions(hotmailSecurityPresetActions(preset))
  }, [preset])

  const provider = HOTMAIL_SECURITY_RECOVERY_PROVIDERS.find((item) => item.id === providerId)
    ?? HOTMAIL_SECURITY_RECOVERY_PROVIDERS[0]
  const domains: readonly string[] = provider.domains

  useEffect(() => {
    if (!domains.includes(domain)) setDomain(domains[0] ?? '')
  }, [domain, domains])

  const selectedRows = useMemo(
    () => rows.filter((row) => selectedIds.includes(row.accountId)),
    [rows, selectedIds]
  )

  const wantsAdd = actions.includes('add_recovery')
  const wantsRemove = actions.includes('remove_recovery')
  const wantsPassword = actions.includes('password')

  const previews = useMemo(() => selectedRows.slice(0, 12).map((row) => ({
    accountId: row.accountId,
    primary: row.email,
    currentRecovery: row.backupEmail,
    nextRecovery: wantsAdd ? buildHotmailRecoveryAddress(row.email, suffix, domain) : null
  })), [selectedRows, wantsAdd, suffix, domain])

  const toggleAction = (action: HotmailSecurityAction) => {
    setActions((current) => current.includes(action)
      ? current.filter((item) => item !== action)
      : [...current, action]
    )
  }

  const run = async () => {
    setBusy(true)
    try {
      if (selectedIds.length === 0) throw new Error('Chọn ít nhất một tài khoản trước.')
      if (actions.length === 0) throw new Error('Chọn ít nhất một hành động Hotmail Security.')
      if (wantsAdd && !suffix.trim()) throw new Error('Nhập ký tự thêm để sinh Mail KP mới.')
      if (wantsAdd && !domain) throw new Error('Chọn domain Mail KP.')
      if (wantsPassword && passwordMode === 'fixed' && fixedPassword.length < 8) {
        throw new Error('Password cố định phải có tối thiểu 8 ký tự.')
      }

      const targets: HotmailSecurityTarget[] = selectedRows.map((row) => {
        const item: HotmailSecurityTarget = { accountId: row.accountId }
        if (wantsAdd) {
          const recoveryEmail = buildHotmailRecoveryAddress(row.email, suffix, domain)
          if (!recoveryEmail) throw new Error(`Không sinh được Mail KP cho ${row.email ?? row.uid}.`)
          item.recoveryEmail = recoveryEmail
        }
        if (wantsPassword) {
          item.newPassword = passwordMode === 'random'
            ? randomPassword(Math.max(8, Math.min(64, passwordLength)))
            : fixedPassword
        }
        return item
      })

      const result = await window.pageAuto.runHotmailCombo({
        accountIds: selectedIds,
        actions,
        targets,
        confirmCompleted: false
      })
      onMessage(comboSummary(result))
      await onRefresh()
    } catch (error) {
      onMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return <div className="email-panel-content">
    <div className="email-info-card">
      <strong>1. Login / session luôn chạy trước</strong>
      <p>PAGE-AUTO kiểm tra đúng Email profile của UID. Profile đã đăng nhập thì đi tiếp ngay; chưa đăng nhập thì Auth V2 xử lý login/xác minh trước. Chỉ khi Microsoft session đã authenticated mới chạy các hành động bên dưới.</p>
    </div>

    <section className="email-settings-card">
      <div className="email-settings-heading">
        <div><span>HOTMAIL SECURITY</span><h3>Chọn hành động</h3></div>
        <span className="email-settings-badge">{selectedIds.length} tài khoản</span>
      </div>
      <div className="email-security-action-grid">
        <label><input type="checkbox" checked={wantsAdd} onChange={() => toggleAction('add_recovery')} /> Thêm Mail KP mới</label>
        <label><input type="checkbox" checked={wantsRemove} onChange={() => toggleAction('remove_recovery')} /> Xóa Mail KP cũ</label>
        <label><input type="checkbox" checked={wantsPassword} onChange={() => toggleAction('password')} /> Đổi Password</label>
      </div>
    </section>

    {wantsAdd ? <section className="email-settings-card">
      <div className="email-settings-heading"><div><span>MAIL KP MỚI</span><h3>Tự sinh theo mail chính</h3></div></div>
      <div className="email-settings-grid">
        <label><span>Nguồn mail</span><select value={providerId} onChange={(event: ChangeEvent<HTMLSelectElement>) => setProviderId(event.target.value as 'inboxes' | 'fviainboxes')}><option value="inboxes">Inboxes</option><option value="fviainboxes">Fvia</option></select></label>
        <label><span>Domain</span><select value={domain} onChange={(event: ChangeEvent<HTMLSelectElement>) => setDomain(event.target.value)}>{domains.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <label className="wide"><span>Ký tự thêm</span><input value={suffix} onChange={(event: ChangeEvent<HTMLInputElement>) => setSuffix(event.target.value)} placeholder="b2401" /><small>Ví dụ adagasilknurp@hotmail.com + b2401 + fivermail.com → adagasilknurpb2401@fivermail.com</small></label>
      </div>
    </section> : null}

    {wantsRemove ? <section className="email-settings-card">
      <div className="email-settings-heading"><div><span>MAIL KP CŨ</span><h3>Xóa đúng mail đang lưu trước khi chạy</h3></div></div>
      <p className="email-panel-note">Mail KP cũ được freeze từ dữ liệu account trước khi Add. Nếu Add thành công, BackupEmail mới được cập nhật; stage Xóa vẫn nhắm đúng mail KP cũ đã freeze.</p>
    </section> : null}

    {wantsPassword ? <section className="email-settings-card">
      <div className="email-settings-heading"><div><span>PASSWORD</span><h3>Password mới</h3></div></div>
      <div className="email-settings-grid">
        <label><span>Kiểu</span><select value={passwordMode} onChange={(event: ChangeEvent<HTMLSelectElement>) => setPasswordMode(event.target.value as PasswordMode)}><option value="random">Random từng account</option><option value="fixed">Cố định</option></select></label>
        {passwordMode === 'random'
          ? <label><span>Độ dài</span><input type="number" min={8} max={64} value={passwordLength} onChange={(event: ChangeEvent<HTMLInputElement>) => setPasswordLength(Number(event.target.value) || 12)} /></label>
          : <label><span>Password mới</span><input type="password" autoComplete="new-password" value={fixedPassword} onChange={(event: ChangeEvent<HTMLInputElement>) => setFixedPassword(event.target.value)} /></label>}
      </div>
    </section> : null}

    <section className="email-settings-card">
      <div className="email-settings-heading"><div><span>PREVIEW</span><h3>Target theo từng account</h3></div></div>
      <div className="email-security-preview-list">
        {previews.map((item) => <div key={item.accountId}>
          <strong>{item.primary ?? `#${item.accountId}`}</strong>
          {wantsAdd ? <span>→ {item.nextRecovery ?? 'Chưa hợp lệ'}</span> : null}
          {wantsRemove ? <small>KP cũ: {item.currentRecovery ?? 'Không có — sẽ bỏ qua'}</small> : null}
        </div>)}
      </div>
    </section>

    <div className="email-info-card">
      <strong>Thứ tự cố định</strong>
      <p>Login/session → Thêm KP mới → Xóa KP cũ → Đổi Password. Action nào không chọn thì bỏ qua. Mỗi canonical field chỉ cập nhật sau khi Microsoft xác nhận stage tương ứng thành công.</p>
    </div>

    <div className="email-panel-actions">
      <button className="email-button primary" disabled={busy || selectedIds.length === 0 || actions.length === 0} onClick={() => void run()}>{busy ? 'Đang chạy…' : 'OK, chạy luôn'}</button>
    </div>
  </div>
