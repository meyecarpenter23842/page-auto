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

function actionLabel(type: ZaloActionType): string {
  if (type === 'send_message') return 'Gửi tin'
  if (type === 'send_attachment') return 'Gửi ảnh/file'
  return 'Kết bạn'
}

export function ZaloWorkspace() {
  const [accounts, setAccounts] = useState<ZaloAccountView[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null)
  const [draft, setDraft] = useState<ZaloAccountDraft>(emptyDraft)
  const [settings, setSettings] = useState<ZaloBrowserSettings | null>(null)
  const [busy, setBusy] = useState<BusyState>(null)
  const [notice, setNotice] = useState('')
  const [targetPhone, setTargetPhone] = useState('')
  const [messageContent, setMessageContent] = useState('')
  const [attachmentPaths, setAttachmentPaths] = useState('')
  const [friendMessage, setFriendMessage] = useState('')
  const [actionBusy, setActionBusy] = useState<ZaloActionType | null>(null)
  const [actionPaused, setActionPaused] = useState(false)
  const [actionHistory, setActionHistory] = useState<ZaloActionResult[]>([])

  const load = async () => {
    const [nextAccounts, nextSettings] = await Promise.all([
      window.pageAutoZalo.listAccounts(),
      window.pageAutoZalo.getSettings()
    ])
    setAccounts(nextAccounts)
    setSettings(nextSettings)
    setSelectedAccountId((current) => {
      if (current !== null && nextAccounts.some((account) => account.id === current)) return current
      return nextAccounts.find((account) => account.sessionStatus === 'ready')?.id ?? nextAccounts[0]?.id ?? null
    })
  }

  useEffect(() => {
    void load().catch((error) => setNotice(error instanceof Error ? error.message : String(error)))
  }, [])

  const readyCount = useMemo(() => accounts.filter((account) => account.sessionStatus === 'ready').length, [accounts])
  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === selectedAccountId) ?? null,
    [accounts, selectedAccountId]
  )
  const lastActionResult = actionHistory[0] ?? null

  const create = async () => {
    if (!draft.phone.trim()) return
    try {
      const created = await window.pageAutoZalo.createAccount(draft)
      setDraft(emptyDraft)
      setSelectedAccountId(created.id)
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

  const runBusinessAction = async (type: ZaloActionType) => {
    if (!selectedAccountId || !targetPhone.trim()) {
      setNotice('Chọn một tài khoản trong bảng và nhập SĐT target trước khi chạy.')
      return
    }

    let action: ZaloActionInput
    if (type === 'send_message') {
      action = { type, targetPhone, content: messageContent }
    } else if (type === 'send_attachment') {
      action = {
        type,
        targetPhone,
        paths: attachmentPaths.split(/\r?\n/).map((path) => path.trim()).filter(Boolean)
      }
    } else {
      action = { type, targetPhone, message: friendMessage || null }
    }

    setActionBusy(type)
    setActionPaused(false)
    try {
      const result = await window.pageAutoZalo.executeAction(selectedAccountId, action)
      setActionHistory((current) => [result, ...current].slice(0, 20))
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
    if (!selectedAccountId || !actionBusy) return
    if (await window.pageAutoZalo.pauseAction(selectedAccountId)) setActionPaused(true)
  }

  const resumeAction = async () => {
    if (!selectedAccountId || !actionBusy) return
    if (await window.pageAutoZalo.resumeAction(selectedAccountId)) setActionPaused(false)
  }

  const stopAction = async () => {
    if (!selectedAccountId || !actionBusy) return
    await window.pageAutoZalo.stopAction(selectedAccountId)
  }

  const selectedBusy = selectedAccount ? busy?.id === selectedAccount.id : false

  return (
    <section className="panel-stack zalo-tool-shell">
      <div className="panel zalo-tool-header">
        <div>
          <h2>Zalo Automation</h2>
          <p>Một màn thao tác: chọn tài khoản trong bảng → nhập target → chạy nghiệp vụ → xem kết quả ngay bên dưới.</p>
        </div>
        <div className="zalo-tool-counters">
          <span><strong>{accounts.length}</strong> tài khoản</span>
          <span><strong>{readyCount}</strong> sẵn sàng</span>
        </div>
      </div>

      {notice ? <div className="notice-card zalo-notice">{notice}</div> : null}

      <div className="zalo-workbench-grid">
        <div className="panel zalo-account-pane">
          <div className="zalo-pane-title">
            <div>
              <h2>Tài khoản chạy</h2>
              <p>Chọn trực tiếp một dòng; không dùng dropdown.</p>
            </div>
            <span className="zalo-selection-chip">
              {selectedAccount ? `${selectedAccount.phone} · ${statusLabel(selectedAccount.sessionStatus)}` : 'Chưa chọn'}
            </span>
          </div>

          <div className="table-wrap zalo-account-table-wrap">
            <table className="data-table zalo-account-table">
              <thead>
                <tr>
                  <th>Chạy</th>
                  <th>Số điện thoại</th>
                  <th>Tên</th>
                  <th>Session</th>
                  <th>Ghi chú</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => {
                  const selected = account.id === selectedAccountId
                  return (
                    <tr
                      key={account.id}
                      className={selected ? 'is-selected' : ''}
                      onClick={() => !actionBusy && setSelectedAccountId(account.id)}
                    >
                      <td>
                        <input
                          type="radio"
                          name="zalo-run-account"
                          aria-label={`Chọn ${account.phone}`}
                          checked={selected}
                          disabled={Boolean(actionBusy)}
                          onChange={() => setSelectedAccountId(account.id)}
                        />
                      </td>
                      <td><strong>{account.phone}</strong></td>
                      <td>{account.displayName || '—'}</td>
                      <td><span className={`zalo-status zalo-status-${account.sessionStatus}`}>{statusLabel(account.sessionStatus)}</span></td>
                      <td>{account.note || '—'}</td>
                    </tr>
                  )
                })}
                {accounts.length === 0 ? <tr><td colSpan={5}>Chưa có tài khoản Zalo.</td></tr> : null}
              </tbody>
            </table>
          </div>

          <div className="zalo-account-actions">
            <button className="button primary" type="button" disabled={!selectedAccount || selectedBusy || Boolean(actionBusy)} onClick={() => selectedAccount && void open(selectedAccount.id)}>
              {selectedBusy ? busy?.label : 'Mở / kiểm tra'}
            </button>
            <button className="button secondary" type="button" disabled={!selectedAccount || selectedBusy || !selectedAccount.hasPassword || Boolean(actionBusy)} onClick={() => selectedAccount && void login(selectedAccount.id, 'phone_password')}>Đăng nhập mật khẩu</button>
            <button className="button secondary" type="button" disabled={!selectedAccount || selectedBusy || Boolean(actionBusy)} onClick={() => selectedAccount && void login(selectedAccount.id, 'qr')}>QR đăng nhập</button>
            <button className="button secondary" type="button" disabled={!selectedAccount || selectedBusy || Boolean(actionBusy)} onClick={() => selectedAccount && void close(selectedAccount.id)}>Đóng</button>
            <button className="button secondary" type="button" disabled={!selectedAccount || selectedBusy || Boolean(actionBusy)} onClick={() => selectedAccount && void remove(selectedAccount.id)}>Xóa</button>
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
        </div>

        <div className="panel zalo-action-pane">
          <div className="zalo-pane-title">
            <div>
              <h2>Gửi tin / Kết bạn</h2>
              <p>Batch hiện tại chạy một account + một target; target phải được xác minh trước khi ghi.</p>
            </div>
            {actionBusy ? <span className="zalo-running-chip">{actionLabel(actionBusy)}{actionPaused ? ' · Đã pause' : ' · Đang chạy'}</span> : null}
          </div>

          <div className="zalo-action-form">
            <label className="zalo-target-field">SĐT target<input value={targetPhone} onChange={(event) => setTargetPhone(event.target.value)} placeholder="09..." disabled={Boolean(actionBusy)} /></label>
            <label>Nội dung tin nhắn<textarea value={messageContent} onChange={(event) => setMessageContent(event.target.value)} placeholder="Nhập nội dung gửi" disabled={Boolean(actionBusy)} /></label>
            <label>Ảnh/file — mỗi dòng một đường dẫn tuyệt đối<textarea value={attachmentPaths} onChange={(event) => setAttachmentPaths(event.target.value)} placeholder={'F:\\media\\anh-1.jpg\nF:\\media\\tailieu.pdf'} disabled={Boolean(actionBusy)} /></label>
            <label>Lời nhắn kết bạn<textarea value={friendMessage} onChange={(event) => setFriendMessage(event.target.value)} placeholder="Có thể để trống" disabled={Boolean(actionBusy)} /></label>
          </div>

          <div className="zalo-run-actions">
            <button className="button primary" type="button" disabled={Boolean(actionBusy)} onClick={() => void runBusinessAction('send_message')}>Gửi tin</button>
            <button className="button primary" type="button" disabled={Boolean(actionBusy)} onClick={() => void runBusinessAction('send_attachment')}>Gửi ảnh/file</button>
            <button className="button primary" type="button" disabled={Boolean(actionBusy)} onClick={() => void runBusinessAction('add_friend')}>Kết bạn</button>
            {actionBusy ? (
              <>
                <span className="zalo-run-separator" />
                <button className="button secondary" type="button" disabled={actionPaused} onClick={() => void pauseAction()}>Tạm dừng</button>
                <button className="button secondary" type="button" disabled={!actionPaused} onClick={() => void resumeAction()}>Tiếp tục</button>
                <button className="button secondary" type="button" onClick={() => void stopAction()}>Dừng</button>
              </>
            ) : null}
          </div>

          <div className="zalo-result-area">
            <h3>Kết quả gần nhất</h3>
            {lastActionResult ? (
              <div className={`zalo-result-card zalo-result-${lastActionResult.status}`}>
                <strong>{actionLabel(lastActionResult.action)} · {lastActionResult.status} / {lastActionResult.code}</strong>
                <span>{lastActionResult.message}</span>
                <small>Target {lastActionResult.targetPhone} · Identity {lastActionResult.verifiedTarget ? 'đã xác minh' : 'chưa xác minh'}{lastActionResult.targetDisplayName ? ` · ${lastActionResult.targetDisplayName}` : ''}</small>
              </div>
            ) : <p className="zalo-empty-result">Chưa có action nào trong phiên UI này.</p>}

            {actionHistory.length > 1 ? (
              <details className="zalo-history">
                <summary>Lịch sử gần đây ({actionHistory.length})</summary>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead><tr><th>Action</th><th>Target</th><th>Kết quả</th></tr></thead>
                    <tbody>
                      {actionHistory.map((result, index) => (
                        <tr key={`${result.completedAt}-${index}`}>
                          <td>{actionLabel(result.action)}</td>
                          <td>{result.targetPhone}</td>
                          <td>{result.status} / {result.code}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            ) : null}
          </div>
        </div>
      </div>

      {settings ? (
        <details className="panel zalo-settings-panel">
          <summary>Cấu hình Chrome Zalo</summary>
          <p>Cấu hình riêng của Zalo; không đổi Facebook/Email.</p>
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
