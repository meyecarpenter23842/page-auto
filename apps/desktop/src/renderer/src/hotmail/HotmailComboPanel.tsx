import { useState, type ChangeEvent } from 'react'
import type { HotmailDashboardRow } from '../../../shared/hotmail'
import type {
  HotmailComboBatchResult,
  HotmailComboOperation,
  HotmailComboRecoveryOperation
} from '../../../shared/emailCombo'

interface HotmailComboPanelProps {
  selectedIds: number[]
  rows: HotmailDashboardRow[]
  onMessage: (message: string) => void
  onRefresh: () => Promise<void>
}

function comboSummary(result: HotmailComboBatchResult): string {
  const success = result.results.filter((item) => item.status === 'success').length
  const attention = result.results.filter((item) => item.status === 'needs_attention').length
  const failed = result.results.length - success - attention
  const detail = result.results.find((item) => item.status !== 'success')?.message
  return `Combo ${result.results.length} tài khoản · ${success} hoàn tất · ${attention} cần xử lý · ${failed} lỗi${detail ? ` · ${detail}` : ''}.`
}

export function HotmailComboPanel({ selectedIds, rows, onMessage, onRefresh }: HotmailComboPanelProps) {
  const [operation, setOperation] = useState<HotmailComboOperation>('password_then_recovery')
  const [recoveryOperation, setRecoveryOperation] = useState<HotmailComboRecoveryOperation>('replace')
  const [recoveryEmail, setRecoveryEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false)
  const [busy, setBusy] = useState(false)

  const run = async (confirmCompleted: boolean) => {
    setBusy(true)
    try {
      let result: HotmailComboBatchResult
      if (confirmCompleted) {
        result = await window.pageAuto.runHotmailCombo({ accountIds: [], confirmCompleted: true })
      } else {
        if (selectedIds.length === 0) throw new Error('Chọn ít nhất một tài khoản trước.')
        if (newPassword !== confirmPassword) throw new Error('Password Email mới và ô xác nhận chưa khớp.')
        const label = operation === 'password_then_recovery'
          ? 'Đổi Password → thêm/thay Recovery Email'
          : 'Xóa Recovery → thêm Recovery mới → đổi Password'
        if (!window.confirm(`Xác nhận chạy “${label}” cho ${selectedIds.length} tài khoản? Mỗi stage chỉ cập nhật canonical khi stage đó thành công.`)) return
        result = await window.pageAuto.runHotmailCombo({
          accountIds: selectedIds,
          operation,
          recoveryOperation,
          recoveryEmail,
          newPassword,
          confirmCompleted: false
        })
      }

      const attention = result.results.some((item) => item.status === 'needs_attention')
      setAwaitingConfirmation(attention)
      onMessage(comboSummary(result))
      await onRefresh()
      if (!attention && result.results.every((item) => item.status === 'success')) {
        setNewPassword('')
        setConfirmPassword('')
        setRecoveryEmail('')
      }
    } catch (error) {
      onMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return <div className="email-panel-content">
    <p className="email-panel-note">E5.3 chạy tuần tự trong cùng Email Profile Root/UID, cùng browser worker và network/proxy của phiên đó. Stage đã thành công được giữ nguyên nếu stage sau cần login/xác minh; PAGE-AUTO không rollback giả và không bypass Microsoft.</p>
    <div className="email-recovery-selection">{rows.slice(0, 20).map((row) => <div key={row.accountId}><span className="mono">{row.uid}</span><strong>{row.email ?? 'Chưa có Email Microsoft'}</strong><span>{row.backupEmail ?? 'Chưa có Recovery Email'}</span></div>)}</div>
    <section className="email-settings-card">
      <div className="email-settings-heading"><div><span>E5.3 COMBO EMAIL</span><h3>Chuỗi thao tác Email</h3></div><span className="email-settings-badge">Partial success</span></div>
      <div className="email-settings-grid">
        <label className="wide"><span>Combo</span><select value={operation} disabled={awaitingConfirmation} onChange={(event: ChangeEvent<HTMLSelectElement>) => setOperation(event.target.value as HotmailComboOperation)}><option value="password_then_recovery">Đổi Password → thêm/thay Recovery Email</option><option value="reset_recovery_then_password">Xóa Recovery → thêm Recovery mới → đổi Password</option></select></label>
        {operation === 'password_then_recovery' ? <label><span>Recovery action</span><select value={recoveryOperation} disabled={awaitingConfirmation} onChange={(event: ChangeEvent<HTMLSelectElement>) => setRecoveryOperation(event.target.value as HotmailComboRecoveryOperation)}><option value="add">Thêm</option><option value="replace">Thay</option></select></label> : null}
        <label className="wide"><span>Recovery Email mới</span><input value={recoveryEmail} disabled={awaitingConfirmation} onChange={(event: ChangeEvent<HTMLInputElement>) => setRecoveryEmail(event.target.value)} placeholder="recovery@example.com" /></label>
        <label className="wide"><span>Password Email mới</span><input type="password" autoComplete="new-password" value={newPassword} disabled={awaitingConfirmation} onChange={(event: ChangeEvent<HTMLInputElement>) => setNewPassword(event.target.value)} placeholder="Tối thiểu 8 ký tự" /><small>Password được giữ trong Main cho manual continuation và không xuất hiện trong result/log.</small></label>
        <label className="wide"><span>Xác nhận Password mới</span><input type="password" autoComplete="new-password" value={confirmPassword} disabled={awaitingConfirmation} onChange={(event: ChangeEvent<HTMLInputElement>) => setConfirmPassword(event.target.value)} /></label>
      </div>
      <div className="email-panel-actions">
        <button className="email-button primary" disabled={busy || awaitingConfirmation || selectedIds.length === 0} onClick={() => void run(false)}>{busy ? 'Đang chạy…' : 'Chạy Combo'}</button>
        {awaitingConfirmation ? <button className="email-button success" disabled={busy} onClick={() => void run(true)}>{busy ? 'Đang kiểm tra…' : 'Xác nhận stage hiện tại'}</button> : null}
      </div>
    </section>
    <div className="email-info-card"><strong>Nguyên tắc cập nhật</strong><p>Recovery success mới cập nhật accounts.BackupEmail; Password success mới cập nhật accounts.PassEmail. Nếu stage sau trả needs_attention, kết quả stage trước vẫn giữ và nút xác nhận tiếp tục đúng stage đang dừng trong cùng live Email session.</p></div>
  </div>
}
