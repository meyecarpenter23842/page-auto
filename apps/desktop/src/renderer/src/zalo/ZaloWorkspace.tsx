import { useEffect, useMemo, useState } from 'react'
import {
  type ZaloAccountDraft,
  type ZaloAccountView,
  type ZaloBrowserSettings,
  type ZaloLoginMode
} from '../../../shared/zalo'
import { ZaloBatchPanel } from './ZaloBatchPanel'
import './zaloWorkspace.css'

type BusyState = { id: number; label: string } | null

const emptyDraft: ZaloAccountDraft = { phone: '', password: '', displayName: '', note: '' }

function statusLabel(status: ZaloAccountView['sessionStatus']): string {
  const labels: Record<ZaloAccountView['sessionStatus'], string> = {
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
  const [accounts, setAccounts] = useState<ZaloAccountView[]>([])
  const [draft, setDraft] = useState<ZaloAccountDraft>(emptyDraft)
  const [settings, setSettings] = useState<ZaloBrowserSettings | null>(null)
  const [busy, setBusy] = useState<BusyState>(null)
  const [notice, setNotice] = useState('')

  const load = async () => {
    const [nextAccounts, nextSettings] = await Promise.all([
      window.pageAutoZalo.listAccounts(),
      window.pageAutoZalo.getSettings()
    ])
    setAccounts(nextAccounts)
    setSettings(nextSettings)
  }

  useEffect(() => {
    void load().catch((error) => setNotice(error instanceof Error ? error.message : String(error)))
  }, [])

  const readyCount = useMemo(() => accounts.filter((account) => account.sessionStatus === 'ready').length, [accounts])

  const create = async () => {
    if (!draft.phone.trim()) return
    try {
      const created = await window.pageAutoZalo.createAccount(draft)
      setDraft(emptyDraft)
      setNotice(`Đã lưu tài khoản Zalo ${created.phone}.`)
      await load()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    }
  }

  const open = async (id: number) => {
    setBusy({ id, label: 'Đang mở…' })
    try {
      const result = await window.pageAutoZalo.openAccount(id)
      setNotice(result.message)
      await load()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }

  const login = async (id: number, mode: ZaloLoginMode) => {
    setBusy({ id, label: mode === 'qr' ? 'Đang chờ QR…' : 'Đang đăng nhập…' })
    try {
      const result = await window.pageAutoZalo.loginAccount(id, mode)
      setNotice(result.message)
      await load()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }

  const close = async (id: number) => {
    setBusy({ id, label: 'Đang đóng…' })
    try {
      await window.pageAutoZalo.closeAccount(id)
      setNotice('Đã đóng Chrome Zalo. Profile/session vẫn được giữ.')
      await load()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }

  const remove = async (id: number) => {
    setBusy({ id, label: 'Đang xóa…' })
    try {
      await window.pageAutoZalo.deleteAccount(id)
      setNotice('Đã xóa tài khoản Zalo.')
      await load()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }

  const saveSettings = async () => {
    if (!settings) return
    try {
      const saved = await window.pageAutoZalo.saveSettings(settings)
      setSettings(saved)
      setNotice('Đã lưu cấu hình Chrome Zalo.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <section className="panel-stack zalo-tool-shell">
      <div className="zalo-workspace-titlebar">
        <div><span>Zalo Automation</span><strong>Gửi tin / Kết bạn</strong></div>
        <div className="zalo-tool-counters">
          <span><strong>{accounts.length}</strong> tài khoản</span>
          <span><strong>{readyCount}</strong> sẵn sàng</span>
        </div>
      </div>

      {notice ? <div className="notice-card zalo-notice">{notice}</div> : null}

      <ZaloBatchPanel accounts={accounts} />

      <details className="panel zalo-settings-panel zalo-account-admin">
        <summary>Quản lý tài khoản Zalo · {accounts.length} tài khoản · {readyCount} sẵn sàng</summary>
        <div className="table-wrap zalo-account-table-wrap">
          <table className="data-table zalo-account-table">
            <thead><tr><th>Số điện thoại</th><th>Tên</th><th>Session</th><th>Ghi chú</th><th>Thao tác</th></tr></thead>
            <tbody>
              {accounts.map((account) => {
                const accountBusy = busy?.id === account.id
                return (
                  <tr key={account.id}>
                    <td><strong>{account.phone}</strong></td>
                    <td>{account.displayName || '—'}</td>
                    <td><span className={`zalo-status zalo-status-${account.sessionStatus}`}>{statusLabel(account.sessionStatus)}</span></td>
                    <td>{account.note || '—'}</td>
                    <td>
                      <div className="zalo-account-actions zalo-account-actions-inline">
                        <button className="button primary" type="button" disabled={accountBusy} onClick={() => void open(account.id)}>{accountBusy ? busy?.label : 'Mở / kiểm tra'}</button>
                        <button className="button secondary" type="button" disabled={accountBusy || !account.hasPassword} onClick={() => void login(account.id, 'phone_password')}>Mật khẩu</button>
                        <button className="button secondary" type="button" disabled={accountBusy} onClick={() => void login(account.id, 'qr')}>QR</button>
                        <button className="button secondary" type="button" disabled={accountBusy} onClick={() => void close(account.id)}>Đóng</button>
                        <button className="button secondary" type="button" disabled={accountBusy} onClick={() => void remove(account.id)}>Xóa</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {accounts.length === 0 ? <tr><td colSpan={5}>Chưa có tài khoản Zalo.</td></tr> : null}
            </tbody>
          </table>
        </div>

        <details className="zalo-inline-details">
          <summary>+ Thêm tài khoản Zalo</summary>
          <div className="zalo-compact-form">
            <label>Số điện thoại<input value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} placeholder="09..." /></label>
            <label>Mật khẩu<input type="password" autoComplete="new-password" value={draft.password ?? ''} onChange={(event) => setDraft({ ...draft, password: event.target.value })} placeholder="••••••••" /></label>
            <label>Tên hiển thị<input value={draft.displayName ?? ''} onChange={(event) => setDraft({ ...draft, displayName: event.target.value })} /></label>
            <label>Ghi chú<input value={draft.note ?? ''} onChange={(event) => setDraft({ ...draft, note: event.target.value })} /></label>
          </div>
          <button className="button primary" type="button" onClick={() => void create()}>Lưu tài khoản</button>
        </details>
      </details>

      {settings ? (
        <details className="panel zalo-settings-panel">
          <summary>Cấu hình Chrome Zalo</summary>
          <div className="zalo-compact-form">
            <label>Chrome executable<input value={settings.executablePath ?? ''} onChange={(event) => setSettings({ ...settings, executablePath: event.target.value || null })} placeholder="Để trống = mặc định" /></label>
            <label>Profile Root<input value={settings.profileRoot ?? ''} onChange={(event) => setSettings({ ...settings, profileRoot: event.target.value || null })} placeholder="Để trống = data/zalo-browser-profiles" /></label>
            <label>Rộng<input type="number" min={640} max={7680} value={settings.windowWidth} onChange={(event) => setSettings({ ...settings, windowWidth: Number(event.target.value) })} /></label>
            <label>Cao<input type="number" min={480} max={4320} value={settings.windowHeight} onChange={(event) => setSettings({ ...settings, windowHeight: Number(event.target.value) })} /></label>
            <label className="zalo-check"><input type="checkbox" checked={settings.layout.enabled} onChange={(event) => setSettings({ ...settings, layout: { ...settings.layout, enabled: event.target.checked } })} /> Bật layout</label>
            <label className="zalo-check"><input type="checkbox" checked={settings.layout.autoFit} onChange={(event) => setSettings({ ...settings, layout: { ...settings.layout, autoFit: event.target.checked } })} /> Auto Fit</label>
          </div>
          <button className="button primary" type="button" onClick={() => void saveSettings()}>Lưu cấu hình Chrome</button>
        </details>
      ) : null}
    </section>
  )
}
