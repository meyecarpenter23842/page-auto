import { useState, type FormEvent } from 'react'
import { ACCOUNT_STATUSES, type AccountDraft, type AccountRecord } from '../../../shared/accounts'
import { accountStatusLabels, accountToDraft } from './accountManagerModel'

export interface AccountEditorProps {
  account: AccountRecord | null
  onClose: () => void
  onSaved: (account: AccountRecord) => void
}

export function AccountEditor({ account, onClose, onSaved }: AccountEditorProps) {
  const [draft, setDraft] = useState<AccountDraft>(() => account ? accountToDraft(account) : { uid: '', status: 'unknown' })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const setField = <K extends keyof AccountDraft>(field: K, value: AccountDraft[K]) => {
    setDraft((current) => ({ ...current, [field]: value }))
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const saved = account
        ? await window.pageAuto.updateAccount({ id: account.id, patch: draft })
        : await window.pageAuto.createAccount(draft)
      onSaved(saved)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <form className="modal account-editor" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div><p className="eyebrow">Quản lý tài khoản</p><h2>{account ? `Sửa ${account.uid}` : 'Thêm tài khoản'}</h2></div>
          <button className="icon-button" type="button" onClick={onClose}>×</button>
        </div>

        <div className="form-grid">
          <label><span>UID / Tên đăng nhập *</span><input required value={draft.uid} onChange={(e) => setField('uid', e.target.value)} /></label>
          <label><span>Tên đăng nhập riêng</span><input value={draft.username ?? ''} onChange={(e) => setField('username', e.target.value)} /></label>
          <label><span>Tên tài khoản</span><input value={draft.name ?? ''} onChange={(e) => setField('name', e.target.value)} /></label>
          <label><span>Trạng thái</span><select value={draft.status ?? 'unknown'} onChange={(e) => setField('status', e.target.value as AccountDraft['status'])}>{ACCOUNT_STATUSES.map((status) => <option key={status} value={status}>{accountStatusLabels[status]}</option>)}</select></label>
          <label><span>Nhóm</span><input value={draft.category ?? ''} onChange={(e) => setField('category', e.target.value)} /></label>
          <label><span>Bạn bè</span><input type="number" min="0" value={draft.friendCount ?? ''} onChange={(e) => setField('friendCount', e.target.value === '' ? null : Number(e.target.value))} /></label>
        </div>

        <div className="form-section-title">Đăng nhập & phiên</div>
        <div className="form-grid">
          <label><span>Mật khẩu</span><input type="password" autoComplete="off" value={draft.password ?? ''} onChange={(e) => setField('password', e.target.value)} /></label>
          <label><span>2FA</span><input type="password" autoComplete="off" value={draft.twoFactorSecret ?? ''} onChange={(e) => setField('twoFactorSecret', e.target.value)} /></label>
          <label className="span-2"><span>Cookie</span><textarea rows={3} value={draft.cookie ?? ''} onChange={(e) => setField('cookie', e.target.value)} /></label>
          <label><span>Trạng thái cookie</span><input value={draft.cookieStatus ?? ''} onChange={(e) => setField('cookieStatus', e.target.value)} /></label>
          <label><span>User-Agent</span><input value={draft.userAgent ?? ''} onChange={(e) => setField('userAgent', e.target.value)} /></label>
        </div>

        <div className="form-section-title">Email & liên hệ</div>
        <div className="form-grid">
          <label><span>Email</span><input value={draft.email ?? ''} onChange={(e) => setField('email', e.target.value)} /></label>
          <label><span>Mật khẩu email</span><input type="password" autoComplete="off" value={draft.emailPassword ?? ''} onChange={(e) => setField('emailPassword', e.target.value)} /></label>
          <label><span>Email dự phòng</span><input value={draft.backupEmail ?? ''} onChange={(e) => setField('backupEmail', e.target.value)} /></label>
          <label><span>Điện thoại</span><input value={draft.phone ?? ''} onChange={(e) => setField('phone', e.target.value)} /></label>
        </div>

        <div className="form-section-title">Proxy & thông tin</div>
        <div className="form-grid">
          <label className="span-2"><span>Proxy gốc</span><input value={draft.proxy ?? ''} onChange={(e) => setField('proxy', e.target.value)} placeholder="host:port:user:pass hoặc định dạng riêng" /></label>
          <label><span>Loại proxy</span><input value={draft.proxyType ?? ''} onChange={(e) => setField('proxyType', e.target.value)} /></label>
          <label><span>Máy chủ proxy</span><input value={draft.proxyHost ?? ''} onChange={(e) => setField('proxyHost', e.target.value)} /></label>
          <label><span>Cổng proxy</span><input type="number" min="0" max="65535" value={draft.proxyPort ?? ''} onChange={(e) => setField('proxyPort', e.target.value === '' ? null : Number(e.target.value))} /></label>
          <label><span>Tài khoản proxy</span><input value={draft.proxyUsername ?? ''} onChange={(e) => setField('proxyUsername', e.target.value)} /></label>
          <label><span>Mật khẩu proxy</span><input type="password" autoComplete="off" value={draft.proxyPassword ?? ''} onChange={(e) => setField('proxyPassword', e.target.value)} /></label>
          <label><span>Ngày tạo</span><input value={draft.createdDate ?? ''} onChange={(e) => setField('createdDate', e.target.value)} placeholder="YYYY-MM-DD hoặc dữ liệu nguồn" /></label>
          <label className="span-2"><span>Ghi chú</span><textarea rows={3} value={draft.note ?? ''} onChange={(e) => setField('note', e.target.value)} /></label>
        </div>

        {error ? <div className="inline-error">{error}</div> : null}
        <div className="modal-actions">
          <button className="button secondary" type="button" onClick={onClose}>Hủy</button>
          <button className="button primary" type="submit" disabled={saving}>{saving ? 'Đang lưu…' : 'Lưu tài khoản'}</button>
        </div>
      </form>
    </div>
  )
}
