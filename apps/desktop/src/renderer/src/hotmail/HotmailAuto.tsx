import { useEffect, useMemo, useState, type ChangeEvent, type MouseEvent } from 'react'
import { EMAIL_RECOVERY_PROVIDERS, detectRecoveryMailProvider } from '../../../shared/emailRecoveryProviders'
import type {
  EmailProxyMode,
  HotmailBatchResult,
  HotmailDashboardRow,
  HotmailOAuthStartResult,
  HotmailProxyStatus,
  HotmailSettingsView,
  SaveHotmailSettingsInput
} from '../../../shared/hotmail'
import './hotmailAuto.css'

interface SettingsDraft {
  profileRoot: string
  browserExecutable: string
  oauthClientId: string
  oauthTenant: string
  proxyMode: EmailProxyMode
  proxyListText: string
}

type EmailTab = 'accounts' | 'mail' | 'profiles' | 'recovery' | 'network' | 'logs' | 'settings'
type ActionKey = 'oauth' | 'codes' | 'open' | 'check' | 'rotate' | 'test' | 'save' | 'pick-root' | 'pick-browser' | 'copy' | 'refresh'

type ContextMenuState = {
  x: number
  y: number
  accountId: number
} | null

const EMAIL_TABS: Array<{ id: EmailTab; label: string }> = [
  { id: 'accounts', label: 'Danh sách mail' },
  { id: 'mail', label: 'Lấy mã / Kiểm tra mail' },
  { id: 'profiles', label: 'Mở mail' },
  { id: 'recovery', label: 'Mail khôi phục' },
  { id: 'network', label: 'Đổi IP / Proxy' },
  { id: 'logs', label: 'Nhật ký' },
  { id: 'settings', label: 'Cài đặt' }
]

function settingsDraft(settings: HotmailSettingsView): SettingsDraft {
  return {
    profileRoot: settings.profileRoot,
    browserExecutable: settings.browserExecutable,
    oauthClientId: settings.oauthClientId,
    oauthTenant: settings.oauthTenant,
    proxyMode: settings.proxyMode,
    proxyListText: ''
  }
}

function formatTime(value: number | null): string {
  return value ? new Date(value).toLocaleString('vi-VN') : '—'
}

function profileStatusLabel(value: HotmailDashboardRow['profileStatus']): string {
  if (value === 'missing') return 'Chưa có profile'
  if (value === 'not_configured') return 'Chưa cấu hình'
  if (value === 'available') return 'Có profile'
  if (value === 'running') return 'Đang mở'
  if (value === 'in_use') return 'Đang sử dụng'
  return value
}

function mailStatusLabel(value: HotmailDashboardRow['mailStatus']): string {
  if (value === 'ready') return 'Sẵn sàng'
  if (value === 'needs_login') return 'Cần đăng nhập'
  if (value === 'error') return 'Lỗi'
  return 'Chưa kiểm tra'
}

function runtimeStatusLabel(value: HotmailDashboardRow['runtimeStatus']): string {
  if (value === 'connecting') return 'Đang kết nối'
  if (value === 'reading') return 'Đang đọc mail'
  if (value === 'opening') return 'Đang mở'
  if (value === 'error') return 'Lỗi'
  return 'Đang chờ'
}

function connectionStatusLabel(value: HotmailDashboardRow['oauthStatus']): string {
  if (value === 'valid') return 'Đã kết nối'
  if (value === 'pending') return 'Đang kết nối'
  if (value === 'expired') return 'Cần kết nối lại'
  if (value === 'error') return 'Lỗi kết nối'
  return 'Chưa kết nối'
}

function resultSummary(result: HotmailBatchResult): string {
  const success = result.results.filter((item) => item.status === 'success').length
  const failed = result.results.length - success
  const detail = result.results.find((item) => item.status !== 'success')?.message
  return `Hoàn tất ${result.results.length} tài khoản · ${success} thành công · ${failed} lỗi${detail ? ` · ${detail}` : ''}.`
}

function Spinner() {
  return <span className="email-spinner" aria-hidden="true" />
}

export function HotmailAuto() {
  const [activeTab, setActiveTab] = useState<EmailTab>('accounts')
  const [rows, setRows] = useState<HotmailDashboardRow[]>([])
  const [settings, setSettings] = useState<HotmailSettingsView | null>(null)
  const [draft, setDraft] = useState<SettingsDraft | null>(null)
  const [selection, setSelection] = useState<Set<number>>(new Set())
  const [lastSelectedId, setLastSelectedId] = useState<number | null>(null)
  const [proxyDirty, setProxyDirty] = useState(false)
  const [busyActions, setBusyActions] = useState<Set<ActionKey>>(new Set())
  const [message, setMessage] = useState('Email lấy dữ liệu trực tiếp từ Tài khoản theo UID.')
  const [oauthPrompt, setOauthPrompt] = useState<HotmailOAuthStartResult | null>(null)
  const [proxyStatus, setProxyStatus] = useState<HotmailProxyStatus | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null)

  const selectedIds = useMemo(() => [...selection], [selection])
  const selectedRows = useMemo(() => rows.filter((row) => selection.has(row.accountId)), [rows, selection])
  const rowsWithErrors = useMemo(() => rows.filter((row) => row.lastError), [rows])
  const rowsWithRecovery = useMemo(() => rows.filter((row) => row.backupEmail), [rows])
  const profilesReady = useMemo(() => rows.filter((row) => row.profileStatus === 'available' || row.profileStatus === 'running').length, [rows])
  const mailReady = useMemo(() => rows.filter((row) => row.mailStatus === 'ready').length, [rows])

  const refreshRows = async () => setRows(await window.pageAuto.listHotmailDashboard())
  const refreshSettings = async () => {
    const [nextSettings, nextProxy] = await Promise.all([
      window.pageAuto.getHotmailSettings(),
      window.pageAuto.getHotmailProxyStatus()
    ])
    setSettings(nextSettings)
    setProxyStatus(nextProxy)
    setDraft((current) => current ?? settingsDraft(nextSettings))
  }
  const refreshAll = async () => await Promise.all([refreshRows(), refreshSettings()])

  useEffect(() => { void refreshAll().catch((error) => setMessage(error instanceof Error ? error.message : String(error))) }, [])
  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [contextMenu])

  const isBusy = (key: ActionKey) => busyActions.has(key)
  const runAction = async (key: ActionKey, task: () => Promise<string>, refresh: 'none' | 'rows' | 'settings' | 'all' = 'rows') => {
    setBusyActions((current) => new Set(current).add(key))
    try {
      setMessage(await task())
      if (refresh === 'rows') await refreshRows()
      if (refresh === 'settings') await refreshSettings()
      if (refresh === 'all') await refreshAll()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusyActions((current) => {
        const next = new Set(current)
        next.delete(key)
        return next
      })
    }
  }

  const toggleAll = () => {
    setSelection((current) => current.size === rows.length && rows.length > 0 ? new Set() : new Set(rows.map((row) => row.accountId)))
  }

  const toggleOne = (accountId: number) => {
    setLastSelectedId(accountId)
    setSelection((current) => {
      const next = new Set(current)
      if (next.has(accountId)) next.delete(accountId)
      else next.add(accountId)
      return next
    })
  }

  const selectRow = (event: MouseEvent<HTMLTableRowElement>, accountId: number) => {
    if (event.shiftKey && lastSelectedId !== null) {
      const start = rows.findIndex((row) => row.accountId === lastSelectedId)
      const end = rows.findIndex((row) => row.accountId === accountId)
      if (start >= 0 && end >= 0) {
        const from = Math.min(start, end)
        const to = Math.max(start, end)
        setSelection((current) => {
          const next = new Set(event.ctrlKey || event.metaKey ? current : [])
          rows.slice(from, to + 1).forEach((row) => next.add(row.accountId))
          return next
        })
      }
    } else if (event.ctrlKey || event.metaKey) {
      toggleOne(accountId)
    } else {
      setSelection(new Set([accountId]))
      setLastSelectedId(accountId)
    }
  }

  const requireSelection = (): number[] => {
    if (selectedIds.length === 0) throw new Error('Chọn ít nhất một tài khoản trước.')
    return selectedIds
  }

  const connectMailbox = (accountId?: number) => runAction('oauth', async () => {
    const id = accountId ?? requireSelection()[0]
    if (!id) throw new Error('Chưa chọn tài khoản.')
    const result = await window.pageAuto.startHotmailOAuth({ accountId: id })
    setOauthPrompt(result)
    return result.message
  })

  const getCodes = (accountIds?: number[]) => runAction('codes', async () => resultSummary(await window.pageAuto.getHotmailCodes({ accountIds: accountIds ?? requireSelection() })))
  const checkMail = (accountIds?: number[]) => runAction('check', async () => resultSummary(await window.pageAuto.checkHotmail({ accountIds: accountIds ?? requireSelection() })))

  const openMail = (accountIds?: number[]) => runAction('open', async () => {
    const ids = accountIds ?? requireSelection()
    const messages: string[] = []
    for (const accountId of ids) {
      const result = await window.pageAuto.openHotmail({ accountId })
      messages.push(result.message)
    }
    return messages.join(' · ')
  })

  const rotateProxy = () => runAction('rotate', async () => {
    const status = await window.pageAuto.rotateHotmailProxy()
    setProxyStatus(status)
    return status.message
  }, 'none')

  const testProxy = () => runAction('test', async () => {
    const result = await window.pageAuto.testHotmailProxy()
    return result.publicIp ? `${result.message} · IP hiện tại: ${result.publicIp}` : result.message
  }, 'none')

  const refreshEverything = () => runAction('refresh', async () => 'Đã làm mới dữ liệu Email.', 'all')

  const pickProfileRoot = () => runAction('pick-root', async () => {
    const path = await window.pageAuto.pickHotmailProfileRoot()
    if (!path) return 'Đã hủy chọn thư mục profile Email.'
    setDraft((current) => current ? { ...current, profileRoot: path } : current)
    return `Đã chọn thư mục profile Email: ${path}.`
  }, 'none')

  const pickBrowser = () => runAction('pick-browser', async () => {
    const path = await window.pageAuto.pickHotmailBrowserExecutable()
    if (!path) return 'Đã hủy chọn trình duyệt.'
    setDraft((current) => current ? { ...current, browserExecutable: path } : current)
    return `Đã chọn trình duyệt: ${path}.`
  }, 'none')

  const saveSettings = () => runAction('save', async () => {
    if (!draft) throw new Error('Cài đặt Email chưa tải xong.')
    const input: SaveHotmailSettingsInput = {
      profileRoot: draft.profileRoot,
      browserExecutable: draft.browserExecutable,
      oauthClientId: draft.oauthClientId,
      oauthTenant: draft.oauthTenant,
      proxyMode: draft.proxyMode,
      ...(proxyDirty ? { proxyListText: draft.proxyListText } : {})
    }
    const saved = await window.pageAuto.saveHotmailSettings(input)
    setSettings(saved)
    setDraft(settingsDraft(saved))
    setProxyDirty(false)
    return 'Đã lưu cài đặt Email.'
  }, 'settings')

  const copyEmails = (accountIds: number[]) => runAction('copy', async () => {
    const emails = rows.filter((row) => accountIds.includes(row.accountId)).map((row) => row.email).filter((email): email is string => Boolean(email))
    if (emails.length === 0) throw new Error('Tài khoản đã chọn chưa có Email.')
    await navigator.clipboard.writeText(emails.join('\n'))
    return `Đã copy ${emails.length} Email.`
  }, 'none')

  const openContextMenu = (event: MouseEvent<HTMLTableRowElement>, accountId: number) => {
    event.preventDefault()
    if (!selection.has(accountId)) {
      setSelection(new Set([accountId]))
      setLastSelectedId(accountId)
    }
    setContextMenu({ x: event.clientX, y: event.clientY, accountId })
  }

  const contextIds = contextMenu && selection.has(contextMenu.accountId) ? selectedIds : contextMenu ? [contextMenu.accountId] : []

  const renderRows = (mode: 'full' | 'mail' | 'profiles' | 'recovery' | 'logs') => (
    <div className="email-grid-wrap">
      <table className="email-grid">
        <thead>
          <tr>
            <th className="check"><input type="checkbox" checked={rows.length > 0 && selection.size === rows.length} onChange={toggleAll} /></th>
            <th>STT</th><th>UID</th><th>Email</th>
            {mode === 'full' ? <><th>Pass Email</th><th>Mail khôi phục</th><th>Kết nối đọc mail</th><th>Tình trạng mail</th><th>Tình trạng profile</th><th>Đường dẫn profile</th><th>Mã mới nhất</th><th>Lấy mã gần nhất</th><th>Đang làm gì</th><th>Lỗi gần nhất</th></> : null}
            {mode === 'mail' ? <><th>Kết nối đọc mail</th><th>Tình trạng mail</th><th>Mã mới nhất</th><th>Thời gian nhận</th><th>Kiểm tra gần nhất</th><th>Lỗi</th></> : null}
            {mode === 'profiles' ? <><th>Tình trạng profile</th><th>Đường dẫn profile</th><th>Tình trạng chạy</th><th>Lỗi</th></> : null}
            {mode === 'recovery' ? <><th>Mail khôi phục</th><th>Loại mail</th><th>Tình trạng mail</th></> : null}
            {mode === 'logs' ? <><th>Đang làm gì</th><th>Kiểm tra gần nhất</th><th>Lấy mã gần nhất</th><th>Lỗi gần nhất</th></> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const recovery = detectRecoveryMailProvider(row.backupEmail)
            return (
              <tr
                key={row.accountId}
                className={selection.has(row.accountId) ? 'selected' : ''}
                onClick={(event) => selectRow(event, row.accountId)}
                onDoubleClick={() => void openMail([row.accountId])}
                onContextMenu={(event) => openContextMenu(event, row.accountId)}
              >
                <td className="check" onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={selection.has(row.accountId)} onChange={() => toggleOne(row.accountId)} /></td>
                <td>{index + 1}</td>
                <td className="mono">{row.uid}</td>
                <td>{row.email ?? '—'}</td>
                {mode === 'full' ? <>
                  <td className="secret">{row.emailPasswordMasked ?? '—'}</td>
                  <td>{row.backupEmail ?? '—'}</td>
                  <td><span className={`email-chip ${row.oauthStatus}`}>{connectionStatusLabel(row.oauthStatus)}</span></td>
                  <td><span className={`email-chip ${row.mailStatus}`}>{mailStatusLabel(row.mailStatus)}</span></td>
                  <td><span className={`email-chip ${row.profileStatus}`}>{profileStatusLabel(row.profileStatus)}</span></td>
                  <td className="path-cell" title={row.profileDirectory ?? ''}>{row.profileDirectory ?? '—'}</td>
                  <td className="code-cell">{row.latestCode ?? '—'}</td>
                  <td>{formatTime(row.lastCodeAt)}</td>
                  <td><span className={`email-chip ${row.runtimeStatus}`}>{runtimeStatusLabel(row.runtimeStatus)}</span></td>
                  <td className="error-cell" title={row.lastError ?? ''}>{row.lastError ?? '—'}</td>
                </> : null}
                {mode === 'mail' ? <>
                  <td><span className={`email-chip ${row.oauthStatus}`}>{connectionStatusLabel(row.oauthStatus)}</span></td>
                  <td><span className={`email-chip ${row.mailStatus}`}>{mailStatusLabel(row.mailStatus)}</span></td>
                  <td className="code-cell">{row.latestCode ?? '—'}</td>
                  <td>{formatTime(row.lastCodeAt)}</td>
                  <td>{formatTime(row.lastCheckAt)}</td>
                  <td className="error-cell">{row.lastError ?? '—'}</td>
                </> : null}
                {mode === 'profiles' ? <>
                  <td><span className={`email-chip ${row.profileStatus}`}>{profileStatusLabel(row.profileStatus)}</span></td>
                  <td className="path-cell" title={row.profileDirectory ?? ''}>{row.profileDirectory ?? '—'}</td>
                  <td><span className={`email-chip ${row.runtimeStatus}`}>{runtimeStatusLabel(row.runtimeStatus)}</span></td>
                  <td className="error-cell">{row.lastError ?? '—'}</td>
                </> : null}
                {mode === 'recovery' ? <>
                  <td>{row.backupEmail ?? '—'}</td>
                  <td><span className={`recovery-chip ${recovery.kind}`}>{recovery.label}</span></td>
                  <td><span className={`email-chip ${row.mailStatus}`}>{mailStatusLabel(row.mailStatus)}</span></td>
                </> : null}
                {mode === 'logs' ? <>
                  <td><span className={`email-chip ${row.runtimeStatus}`}>{runtimeStatusLabel(row.runtimeStatus)}</span></td>
                  <td>{formatTime(row.lastCheckAt)}</td>
                  <td>{formatTime(row.lastCodeAt)}</td>
                  <td className="error-cell" title={row.lastError ?? ''}>{row.lastError ?? '—'}</td>
                </> : null}
              </tr>
            )
          })}
          {rows.length === 0 ? <tr><td className="empty" colSpan={18}>Chưa có tài khoản để hiển thị. Thêm tài khoản ở mục Tài khoản trước.</td></tr> : null}
        </tbody>
      </table>
    </div>
  )

  return (
    <section className="email-shell">
      <div className="email-tabs" role="tablist" aria-label="Nghiệp vụ Email">
        {EMAIL_TABS.map((tab) => (
          <button key={tab.id} type="button" role="tab" aria-selected={activeTab === tab.id} className={activeTab === tab.id ? 'active' : ''} onClick={() => setActiveTab(tab.id)}>{tab.label}</button>
        ))}
      </div>

      <div className="email-toolbar">
        <div className="email-toolbar-actions">
          <button className="email-button primary" disabled={isBusy('open')} onClick={() => void openMail()}>{isBusy('open') && <Spinner />}Mở mail</button>
          <button className="email-button success" disabled={isBusy('codes')} onClick={() => void getCodes()}>{isBusy('codes') && <Spinner />}Lấy mã</button>
          <button className="email-button primary" disabled={isBusy('check')} onClick={() => void checkMail()}>{isBusy('check') && <Spinner />}Kiểm tra mail</button>
          <button className="email-button secondary" disabled={isBusy('refresh')} onClick={() => void refreshEverything()}>{isBusy('refresh') && <Spinner />}Làm mới</button>
          <button className="email-button secondary" disabled={isBusy('rotate')} onClick={() => void rotateProxy()}>{isBusy('rotate') && <Spinner />}Đổi IP</button>
          <button className="email-button secondary" onClick={() => setActiveTab('settings')}>Cài đặt</button>
        </div>
        <div className="email-toolbar-meta">
          <strong>{selectedRows.length}/{rows.length}</strong> đã chọn
          <span>{mailReady} mail sẵn sàng</span>
          <span>{profilesReady} profile dùng được</span>
          <span>{proxyStatus?.mode === 'random_ipv4' ? `IPv4 pool · ${proxyStatus.poolSize}` : 'Mạng trực tiếp'}</span>
        </div>
      </div>

      {oauthPrompt ? (
        <div className="email-connect-banner">
          <strong>Kết nối đọc mail</strong>
          <span>Mã: <b>{oauthPrompt.userCode ?? '—'}</b></span>
          <span className="mono">{oauthPrompt.verificationUri ?? ''}</span>
          <span>{oauthPrompt.expiresAt ? `Hết hạn ${formatTime(oauthPrompt.expiresAt)}` : ''}</span>
        </div>
      ) : null}

      <div className="email-status-line"><span className="email-status-dot" />{message}</div>

      <div className="email-tab-body">
        {activeTab === 'accounts' ? renderRows('full') : null}

        {activeTab === 'mail' ? <div className="email-section-stack">
          <div className="email-section-head"><div><h2>Lấy mã / Kiểm tra mail</h2><p>Chọn tài khoản trong bảng rồi thao tác hàng loạt. Phần kết nối kỹ thuật được giấu khỏi màn chính.</p></div><div className="email-section-actions"><button className="email-button success" disabled={isBusy('codes')} onClick={() => void getCodes()}>Lấy mã</button><button className="email-button primary" disabled={isBusy('check')} onClick={() => void checkMail()}>Kiểm tra mail</button><button className="email-button secondary" disabled={isBusy('oauth')} onClick={() => void connectMailbox()}>Kết nối đọc mail</button></div></div>
          {renderRows('mail')}
        </div> : null}

        {activeTab === 'profiles' ? <div className="email-section-stack">
          <div className="email-summary-strip"><div><span>Thư mục profile Email</span><strong title={settings?.profileRoot}>{settings?.profileRoot || 'Chưa chọn'}</strong></div><div><span>Profile dùng được</span><strong>{profilesReady}/{rows.length}</strong></div><div><span>Trình duyệt</span><strong>{settings?.browserExecutable ? 'Đã chọn thủ công' : 'Tự động'}</strong></div></div>
          <div className="email-section-head"><div><h2>Mở mail</h2><p>Mỗi UID dùng đúng profile Email riêng. Không dùng chung profile hoặc proxy Facebook.</p></div><div className="email-section-actions"><button className="email-button primary" disabled={isBusy('open')} onClick={() => void openMail()}>Mở mail</button><button className="email-button secondary" onClick={() => setActiveTab('settings')}>Cài đặt profile</button></div></div>
          {renderRows('profiles')}
        </div> : null}

        {activeTab === 'recovery' ? <div className="email-section-stack">
          <div className="email-section-head"><div><h2>Mail khôi phục</h2><p>{rowsWithRecovery.length}/{rows.length} tài khoản đang có mail khôi phục.</p></div></div>
          {renderRows('recovery')}
          <div className="email-provider-list">
            {EMAIL_RECOVERY_PROVIDERS.map((provider) => <article key={provider.id} className="email-provider-card"><div><strong>{provider.label}</strong><span className={`recovery-chip ${provider.kind}`}>{provider.kind === 'temporary' ? 'Mail dùng nhanh' : 'Mail thường'}</span></div><p>{provider.domains.join(' · ')}</p></article>)}
          </div>
        </div> : null}

        {activeTab === 'network' ? <div className="email-section-stack">
          <div className="email-summary-strip"><div><span>Chế độ mạng Email</span><strong>{proxyStatus?.mode === 'random_ipv4' ? 'IPv4 ngẫu nhiên' : 'Trực tiếp'}</strong></div><div><span>IP / Proxy hiện tại</span><strong>{proxyStatus?.currentProxy ?? 'Chưa có'}</strong></div><div><span>Pool</span><strong>{proxyStatus?.poolSize ?? 0} proxy</strong></div><div><span>Phiên đang dùng</span><strong>{proxyStatus?.activeSessions ?? 0}</strong></div></div>
          <div className="email-section-head"><div><h2>Đổi IP / Proxy</h2><p>Mạng Email tách hoàn toàn khỏi Facebook và ưu tiên IPv4.</p></div><div className="email-section-actions"><button className="email-button primary" disabled={isBusy('rotate')} onClick={() => void rotateProxy()}>Đổi IP</button><button className="email-button secondary" disabled={isBusy('test')} onClick={() => void testProxy()}>Kiểm tra IP</button><button className="email-button secondary" onClick={() => setActiveTab('settings')}>Cài đặt proxy</button></div></div>
          <div className="email-info-card"><strong>Trạng thái</strong><p>{proxyStatus?.message ?? 'Chưa tải trạng thái mạng Email.'}</p></div>
        </div> : null}

        {activeTab === 'logs' ? <div className="email-section-stack">
          <div className="email-section-head"><div><h2>Nhật ký</h2><p>Hiện hiển thị trạng thái và lỗi gần nhất theo từng tài khoản. Nhật ký chi tiết sẽ hoàn thiện ở batch sau.</p></div><span className="email-count-chip">{rowsWithErrors.length} tài khoản có lỗi</span></div>
          {renderRows('logs')}
        </div> : null}

        {activeTab === 'settings' && draft ? <div className="email-settings-page">
          <section className="email-settings-card">
            <div className="email-settings-heading"><div><span>PROFILE EMAIL</span><h2>Profile và trình duyệt</h2></div><span className="email-settings-badge">Tách riêng Facebook</span></div>
            <div className="email-settings-grid">
              <label className="wide"><span>Thư mục profile Email</span><div className="input-action"><input value={draft.profileRoot} onChange={(event: ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, profileRoot: event.target.value })} placeholder="F:\\...\\MaxHotmail\\profiles" /><button className="email-button secondary" disabled={isBusy('pick-root')} onClick={() => void pickProfileRoot()}>Chọn thư mục</button></div><small>Mỗi UID dùng đúng thư mục <code>root\UID</code>. Không fallback sang profile Facebook.</small></label>
              <label className="wide"><span>Trình duyệt Email</span><div className="input-action"><input value={draft.browserExecutable} onChange={(event: ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, browserExecutable: event.target.value })} placeholder="Để trống = Tự động" /><button className="email-button secondary" disabled={isBusy('pick-browser')} onClick={() => void pickBrowser()}>Chọn file</button></div><small>Nên để trống để app tự chọn trình duyệt phù hợp. Chọn file thủ công chỉ dùng khi cần.</small></label>
            </div>
          </section>

          <section className="email-settings-card">
            <div className="email-settings-heading"><div><span>MẠNG EMAIL</span><h2>IPv4 / Proxy riêng</h2></div><span className="email-settings-badge">Không dùng proxy Facebook</span></div>
            <div className="email-settings-grid">
              <label><span>Chế độ</span><select value={draft.proxyMode} onChange={(event: ChangeEvent<HTMLSelectElement>) => setDraft({ ...draft, proxyMode: event.target.value as EmailProxyMode })}><option value="direct">Trực tiếp</option><option value="random_ipv4">IPv4 ngẫu nhiên</option></select></label>
              <label><span>Pool hiện tại</span><input value={`${settings?.proxyCount ?? 0} proxy`} readOnly /></label>
              <label className="wide"><span>Danh sách proxy IPv4</span><textarea value={draft.proxyListText} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => { setDraft({ ...draft, proxyListText: event.target.value }); setProxyDirty(true) }} placeholder={'Mỗi dòng một proxy\n1.2.3.4:8080\nhoặc 1.2.3.4:8080:user:pass\nKhông sửa = giữ pool hiện tại'} /></label>
              <div className="proxy-preview wide">{settings?.proxyPreview.length ? settings.proxyPreview.map((proxy) => <code key={proxy}>{proxy}</code>) : <span>Chưa có proxy lưu.</span>}</div>
            </div>
          </section>

          <details className="email-advanced-card">
            <summary>Cài đặt nâng cao — kết nối đọc mail</summary>
            <div className="email-settings-grid advanced-body">
              <label><span>Mã ứng dụng</span><input value={draft.oauthClientId} onChange={(event: ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, oauthClientId: event.target.value })} /></label>
              <label><span>Tenant</span><input value={draft.oauthTenant} onChange={(event: ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, oauthTenant: event.target.value })} placeholder="consumers" /></label>
              <p className="email-help wide">Đây là phần kỹ thuật phía sau chức năng Lấy mã / Kiểm tra mail. Người dùng bình thường không cần mở mục này.</p>
            </div>
          </details>

          <div className="email-settings-footer"><span>{message}</span><button className="email-button primary" disabled={isBusy('save')} onClick={() => void saveSettings()}>{isBusy('save') && <Spinner />}Lưu cài đặt</button></div>
        </div> : null}
      </div>

      {contextMenu ? (
        <div className="email-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onMouseDown={(event) => event.stopPropagation()}>
          <button onClick={() => { setContextMenu(null); void openMail(contextIds) }}>Mở mail</button>
          <button onClick={() => { setContextMenu(null); void getCodes(contextIds) }}>Lấy mã</button>
          <button onClick={() => { setContextMenu(null); void checkMail(contextIds) }}>Kiểm tra mail</button>
          <div className="email-context-separator" />
          <button onClick={() => { setContextMenu(null); void copyEmails(contextIds) }}>Copy Email</button>
          <button onClick={() => { setContextMenu(null); void connectMailbox(contextMenu.accountId) }}>Kết nối đọc mail</button>
        </div>
      ) : null}
    </section>
  )
}
