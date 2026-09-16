import { useEffect, useMemo, useState } from 'react'
import {
  maskZaloPassword,
  type ZaloAccountDraft,
  type ZaloAccountRecord,
  type ZaloBrowserSettings
} from '../../../shared/zalo'

type TabId = 'accounts' | 'business'

const emptyDraft: ZaloAccountDraft = { phone: '', password: '', displayName: '', note: '' }

function statusLabel(status: ZaloAccountRecord['sessionStatus']): string {
  const labels: Record<ZaloAccountRecord['sessionStatus'], string> = {
    unknown: 'Chưa kiểm tra',
    ready: 'Sẵn sàng',
    login_required: 'Cần đăng nhập',
    qr_waiting: 'Chờ quét QR',
    needs_attention: 'Cần kiểm tra',
    browser_error: 'Lỗi Chrome',
    profile_error: 'Lỗi profile'
  }
  return labels[status]
}

export function ZaloWorkspace() {
  const [tab, setTab] = useState<TabId>('accounts')
  const [accounts, setAccounts] = useState<ZaloAccountRecord[]>([])
  const [draft, setDraft] = useState<ZaloAccountDraft>(emptyDraft)
  const [settings, setSettings] = useState<ZaloBrowserSettings | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [notice, setNotice] = useState('')

  const load = async () => {
    const [nextAccounts, nextSettings] = await Promise.all([
      window.pageAutoZalo.listAccounts(),
      window.pageAutoZalo.getSettings()
    ])
    setAccounts(nextAccounts)
    setSettings(nextSettings)
  }

  useEffect(() => { void load().catch((error) => setNotice(error instanceof Error ? error.message : String(error))) }, [])

  const readyCount = useMemo(() => accounts.filter((account) => account.sessionStatus === 'ready').length, [accounts])

  const create = async () => {
    if (!draft.phone.trim()) return
    try {
      await window.pageAutoZalo.createAccount(draft)
      setDraft(emptyDraft)
      setNotice('Đã lưu tài khoản Zalo.')
      await load()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    }
  }

  const open = async (id: number) => {
    setBusyId(id)
    try {
      const result = await window.pageAutoZalo.openAccount(id)
      setNotice(result.message)
      await load()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (id: number) => {
    setBusyId(id)
    try {
      await window.pageAutoZalo.deleteAccount(id)
      setNotice('Đã xóa tài khoản Zalo và đóng browser đang mở (nếu có).')
      await load()
    } finally {
      setBusyId(null)
    }
  }

  const saveSettings = async () => {
    if (!settings) return
    try {
      const saved = await window.pageAutoZalo.saveSettings(settings)
      setSettings(saved)
      setNotice('Đã lưu cấu hình Chrome Zalo riêng. Browser đang mở được apply lại layout; đổi whole-Chrome scale có hiệu lực đầy đủ ở lần mở kế tiếp.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <section className="panel-stack">
      <div className="tab-strip" role="tablist" aria-label="Zalo workspace">
        <button className={tab === 'accounts' ? 'button primary' : 'button secondary'} type="button" onClick={() => setTab('accounts')}>Tài khoản Zalo</button>
        <button className={tab === 'business' ? 'button primary' : 'button secondary'} type="button" onClick={() => setTab('business')}>Gửi tin / Kết bạn</button>
      </div>

      {notice ? <div className="notice-card">{notice}</div> : null}

      {tab === 'business' ? (
        <div className="panel">
          <h2>Gửi tin / Kết bạn</h2>
          <p>Batch 1 chỉ dựng shell. Automation gửi tin, gửi ảnh/file và kết bạn chưa được bật ở đây.</p>
        </div>
      ) : (
        <>
          <div className="stats-grid">
            <div className="stat-card"><span>Tổng tài khoản</span><strong>{accounts.length}</strong></div>
            <div className="stat-card"><span>Session sẵn sàng</span><strong>{readyCount}</strong></div>
          </div>

          <div className="panel">
            <h2>Thêm tài khoản Zalo</h2>
            <div className="form-grid">
              <label>Số điện thoại<input value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} placeholder="09..." /></label>
              <label>Mật khẩu<input type="password" autoComplete="new-password" value={draft.password ?? ''} onChange={(event) => setDraft({ ...draft, password: event.target.value })} placeholder="••••••••" /></label>
              <label>Tên hiển thị<input value={draft.displayName ?? ''} onChange={(event) => setDraft({ ...draft, displayName: event.target.value })} /></label>
              <label>Ghi chú<input value={draft.note ?? ''} onChange={(event) => setDraft({ ...draft, note: event.target.value })} /></label>
            </div>
            <button className="button primary" type="button" onClick={() => void create()}>Thêm tài khoản</button>
          </div>

          <div className="panel table-wrap">
            <h2>Danh sách tài khoản</h2>
            <table className="data-table">
              <thead><tr><th>ID</th><th>Số điện thoại</th><th>Tên</th><th>Mật khẩu</th><th>Session</th><th>Ghi chú</th><th>Thao tác</th></tr></thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.id}>
                    <td>{account.id}</td><td>{account.phone}</td><td>{account.displayName || '—'}</td>
                    <td>{maskZaloPassword(account.password) || '—'}</td><td>{statusLabel(account.sessionStatus)}</td><td>{account.note || '—'}</td>
                    <td>
                      <div className="inline-actions">
                        <button className="button secondary" disabled={busyId === account.id} type="button" onClick={() => void open(account.id)}>{busyId === account.id ? 'Đang mở…' : 'Mở / kiểm tra'}</button>
                        <button className="button secondary" disabled={busyId === account.id} type="button" onClick={() => void remove(account.id)}>Xóa</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {accounts.length === 0 ? <tr><td colSpan={7}>Chưa có tài khoản Zalo.</td></tr> : null}
              </tbody>
            </table>
          </div>

          {settings ? (
            <div className="panel">
              <h2>Chrome Zalo riêng</h2>
              <p>Cấu hình này chỉ áp dụng Zalo, không đổi Facebook/Email.</p>
              <div className="form-grid">
                <label>Chrome executable<input value={settings.executablePath ?? ''} onChange={(event) => setSettings({ ...settings, executablePath: event.target.value || null })} placeholder="Để trống = Chrome mặc định" /></label>
                <label>Profile Root Zalo<input value={settings.profileRoot ?? ''} onChange={(event) => setSettings({ ...settings, profileRoot: event.target.value || null })} placeholder="Để trống = app-managed Zalo root" /></label>
                <label>Rộng<input type="number" value={settings.windowWidth} onChange={(event) => setSettings({ ...settings, windowWidth: Number(event.target.value) })} /></label>
                <label>Cao<input type="number" value={settings.windowHeight} onChange={(event) => setSettings({ ...settings, windowHeight: Number(event.target.value) })} /></label>
                <label><input type="checkbox" checked={settings.layout.enabled} onChange={(event) => setSettings({ ...settings, layout: { ...settings.layout, enabled: event.target.checked } })} /> Bật layout Zalo</label>
                <label><input type="checkbox" checked={settings.layout.autoFit} onChange={(event) => setSettings({ ...settings, layout: { ...settings.layout, autoFit: event.target.checked } })} /> Auto Fit / whole-Chrome scale</label>
                <label>Số ô<input type="number" min={1} max={64} value={settings.layout.tileCount} onChange={(event) => setSettings({ ...settings, layout: { ...settings.layout, tileCount: Number(event.target.value) } })} /></label>
                <label>Số cột<input type="number" min={1} max={8} value={settings.layout.gridColumns} onChange={(event) => setSettings({ ...settings, layout: { ...settings.layout, gridColumns: Number(event.target.value) } })} /></label>
              </div>
              <button className="button primary" type="button" onClick={() => void saveSettings()}>Lưu cấu hình Zalo</button>
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}
