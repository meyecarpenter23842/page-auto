import { useEffect, useMemo, useState } from 'react'
import {
  type ZaloAccountDraft,
  type ZaloAccountView,
  type ZaloActionInput,
  type ZaloActionResult,
  type ZaloActionType,
  type ZaloBrowserSettings,
  type ZaloLoginMode
} from '../../../shared/zalo'

type TabId = 'accounts' | 'business'
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

function actionLabel(type: ZaloActionType): string {
  if (type === 'send_message') return 'Gửi tin'
  if (type === 'send_attachment') return 'Gửi ảnh/file'
  return 'Kết bạn'
}

export function ZaloWorkspace() {
  const [tab, setTab] = useState<TabId>('accounts')
  const [accounts, setAccounts] = useState<ZaloAccountView[]>([])
  const [draft, setDraft] = useState<ZaloAccountDraft>(emptyDraft)
  const [settings, setSettings] = useState<ZaloBrowserSettings | null>(null)
  const [busy, setBusy] = useState<BusyState>(null)
  const [notice, setNotice] = useState('')
  const [businessAccountId, setBusinessAccountId] = useState<number | null>(null)
  const [targetPhone, setTargetPhone] = useState('')
  const [messageContent, setMessageContent] = useState('')
  const [attachmentPaths, setAttachmentPaths] = useState('')
  const [friendMessage, setFriendMessage] = useState('')
  const [actionBusy, setActionBusy] = useState<ZaloActionType | null>(null)
  const [actionPaused, setActionPaused] = useState(false)
  const [lastActionResult, setLastActionResult] = useState<ZaloActionResult | null>(null)

  const load = async () => {
    const [nextAccounts, nextSettings] = await Promise.all([
      window.pageAutoZalo.listAccounts(),
      window.pageAutoZalo.getSettings()
    ])
    setAccounts(nextAccounts)
    setSettings(nextSettings)
    setBusinessAccountId((current) => current ?? nextAccounts.find((account) => account.sessionStatus === 'ready')?.id ?? nextAccounts[0]?.id ?? null)
  }

  useEffect(() => { void load().catch((error) => setNotice(error instanceof Error ? error.message : String(error))) }, [])

  const readyCount = useMemo(() => accounts.filter((account) => account.sessionStatus === 'ready').length, [accounts])
  const selectedBusinessAccount = useMemo(
    () => accounts.find((account) => account.id === businessAccountId) ?? null,
    [accounts, businessAccountId]
  )

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
      setNotice('Đã đóng Chrome Zalo. Profile/session vẫn được giữ để mở lại lần sau.')
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
      setNotice('Đã xóa tài khoản Zalo và đóng browser đang mở (nếu có).')
      await load()
    } finally {
      setBusy(null)
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

  const runBusinessAction = async (type: ZaloActionType) => {
    if (!businessAccountId || !targetPhone.trim()) {
      setNotice('Chọn tài khoản Zalo và nhập SĐT target trước khi chạy action.')
      return
    }
    let action: ZaloActionInput
    if (type === 'send_message') {
      action = { type, targetPhone, content: messageContent }
    } else if (type === 'send_attachment') {
      action = { type, targetPhone, paths: attachmentPaths.split(/\r?\n/).map((path) => path.trim()).filter(Boolean) }
    } else {
      action = { type, targetPhone, message: friendMessage || null }
    }

    setActionBusy(type)
    setActionPaused(false)
    setLastActionResult(null)
    try {
      const result = await window.pageAutoZalo.executeAction(businessAccountId, action)
      setLastActionResult(result)
      setNotice(result.message)
      await load()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setActionBusy(null)
      setActionPaused(false)
    }
  }

  const pauseAction = async () => {
    if (!businessAccountId || !actionBusy) return
    if (await window.pageAutoZalo.pauseAction(businessAccountId)) setActionPaused(true)
  }

  const resumeAction = async () => {
    if (!businessAccountId || !actionBusy) return
    if (await window.pageAutoZalo.resumeAction(businessAccountId)) setActionPaused(false)
  }

  const stopAction = async () => {
    if (!businessAccountId || !actionBusy) return
    await window.pageAutoZalo.stopAction(businessAccountId)
  }

  return (
    <section className="panel-stack">
      <div className="tab-strip" role="tablist" aria-label="Zalo workspace">
        <button className={tab === 'accounts' ? 'button primary' : 'button secondary'} type="button" onClick={() => setTab('accounts')}>Tài khoản Zalo</button>
        <button className={tab === 'business' ? 'button primary' : 'button secondary'} type="button" onClick={() => setTab('business')}>Gửi tin / Kết bạn</button>
      </div>

      {notice ? <div className="notice-card">{notice}</div> : null}

      {tab === 'business' ? (
        <>
          <div className="panel">
            <h2>Action Zalo — một target</h2>
            <p>Batch 3 chạy từng action production độc lập. Runtime luôn kiểm tra session và xác minh đúng target/conversation trước thao tác. Bulk target + Thư viện bài viết chung thuộc Batch 4.</p>
            <div className="form-grid">
              <label>Tài khoản
                <select value={businessAccountId ?? ''} onChange={(event) => setBusinessAccountId(event.target.value ? Number(event.target.value) : null)} disabled={Boolean(actionBusy)}>
                  <option value="">Chọn tài khoản</option>
                  {accounts.map((account) => <option key={account.id} value={account.id}>{account.phone} — {statusLabel(account.sessionStatus)}</option>)}
                </select>
              </label>
              <label>SĐT target<input value={targetPhone} onChange={(event) => setTargetPhone(event.target.value)} placeholder="09..." disabled={Boolean(actionBusy)} /></label>
              <label>Nội dung tin nhắn<textarea value={messageContent} onChange={(event) => setMessageContent(event.target.value)} placeholder="Nội dung gửi cho một target đã xác minh" disabled={Boolean(actionBusy)} /></label>
              <label>Ảnh/file — mỗi dòng một đường dẫn tuyệt đối<textarea value={attachmentPaths} onChange={(event) => setAttachmentPaths(event.target.value)} placeholder={'F:\\media\\anh-1.jpg\nF:\\media\\tailieu.pdf'} disabled={Boolean(actionBusy)} /></label>
              <label>Lời nhắn kết bạn (nếu Zalo hiện ô lời nhắn)<textarea value={friendMessage} onChange={(event) => setFriendMessage(event.target.value)} disabled={Boolean(actionBusy)} /></label>
            </div>
            <div className="inline-actions">
              <button className="button primary" type="button" disabled={Boolean(actionBusy)} onClick={() => void runBusinessAction('send_message')}>Gửi tin</button>
              <button className="button primary" type="button" disabled={Boolean(actionBusy)} onClick={() => void runBusinessAction('send_attachment')}>Gửi ảnh/file</button>
              <button className="button primary" type="button" disabled={Boolean(actionBusy)} onClick={() => void runBusinessAction('add_friend')}>Kết bạn</button>
              {actionBusy ? (
                <>
                  <button className="button secondary" type="button" disabled={actionPaused} onClick={() => void pauseAction()}>Tạm dừng</button>
                  <button className="button secondary" type="button" disabled={!actionPaused} onClick={() => void resumeAction()}>Tiếp tục</button>
                  <button className="button secondary" type="button" onClick={() => void stopAction()}>Dừng</button>
                </>
              ) : null}
            </div>
            <p>Account: {selectedBusinessAccount ? `${selectedBusinessAccount.phone} / ${statusLabel(selectedBusinessAccount.sessionStatus)}` : 'chưa chọn'}{actionBusy ? ` • Đang chạy: ${actionLabel(actionBusy)}${actionPaused ? ' (đã pause)' : ''}` : ''}</p>
          </div>

          {lastActionResult ? (
            <div className="panel">
              <h2>Kết quả action gần nhất</h2>
              <p><strong>{actionLabel(lastActionResult.action)}</strong> — {lastActionResult.status} / {lastActionResult.code}</p>
              <p>{lastActionResult.message}</p>
              <p>Target: {lastActionResult.targetPhone} • Identity verified: {lastActionResult.verifiedTarget ? 'Có' : 'Không'}{lastActionResult.targetDisplayName ? ` • ${lastActionResult.targetDisplayName}` : ''}</p>
            </div>
          ) : null}
        </>
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
            <p>Mở/kiểm tra chỉ đọc trạng thái session. Đăng nhập mật khẩu dùng credential đã lưu trong Main; QR chờ operator tự quét và xác nhận trên thiết bị của mình.</p>
            <table className="data-table">
              <thead><tr><th>ID</th><th>Số điện thoại</th><th>Tên</th><th>Mật khẩu</th><th>Session</th><th>Ghi chú</th><th>Thao tác</th></tr></thead>
              <tbody>
                {accounts.map((account) => {
                  const isBusy = busy?.id === account.id
                  return (
                    <tr key={account.id}>
                      <td>{account.id}</td><td>{account.phone}</td><td>{account.displayName || '—'}</td>
                      <td>{account.passwordMasked || '—'}</td><td>{statusLabel(account.sessionStatus)}</td><td>{account.note || '—'}</td>
                      <td>
                        <div className="inline-actions">
                          <button className="button secondary" disabled={isBusy} type="button" onClick={() => void open(account.id)}>{isBusy ? busy?.label : 'Mở / kiểm tra'}</button>
                          <button className="button secondary" disabled={isBusy || !account.hasPassword} type="button" onClick={() => void login(account.id, 'phone_password')}>Đăng nhập mật khẩu</button>
                          <button className="button secondary" disabled={isBusy} type="button" onClick={() => void login(account.id, 'qr')}>QR đăng nhập</button>
                          <button className="button secondary" disabled={isBusy} type="button" onClick={() => void close(account.id)}>Đóng</button>
                          <button className="button secondary" disabled={isBusy} type="button" onClick={() => void remove(account.id)}>Xóa</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
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
