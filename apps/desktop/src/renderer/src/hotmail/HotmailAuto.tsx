import { useEffect, useMemo, useState, type ChangeEvent, type MouseEvent } from 'react'
import { EMAIL_RECOVERY_PROVIDERS, detectRecoveryMailProvider } from '../../../shared/emailRecoveryProviders'
import type {
  EmailProxyMode,
  HotmailBatchResult,
  HotmailDashboardRow,
  HotmailOAuthStartResult,
  HotmailPasswordBatchResult,
  HotmailProxyStatus,
  HotmailRecoveryBatchResult,
  HotmailRecoveryOperation,
  HotmailSettingsView,
  SaveHotmailSettingsInput
} from '../../../shared/hotmail'
import { filterHotmailRows, previewClientId, type EmailQuickFilter } from './hotmailUiModel'
import './hotmailAuto.css'

interface SettingsDraft {
  profileRoot: string
  browserExecutable: string
  oauthClientId: string
  oauthTenant: string
  proxyMode: EmailProxyMode
  proxyListText: string
}

type EmailPanel = 'network' | 'logs' | 'settings' | 'recovery' | 'password' | null
type ActionKey = 'oauth' | 'codes' | 'open' | 'check' | 'recovery' | 'password' | 'rotate' | 'test' | 'save' | 'pick-root' | 'pick-browser' | 'copy' | 'refresh'
type ContextMenuState = { x: number; y: number; accountId: number } | null

const QUICK_FILTERS: Array<{ id: EmailQuickFilter; label: string }> = [
  { id: 'all', label: 'Tất cả' },
  { id: 'ready', label: 'Sẵn sàng' },
  { id: 'needs_attention', label: 'Cần xử lý' },
  { id: 'oauth_missing', label: 'Thiếu OAuth' },
  { id: 'recovery', label: 'Có mail khôi phục' }
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
  if (value === 'acting') return 'Đang thao tác'
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

function recoverySummary(result: HotmailRecoveryBatchResult): string {
  const success = result.results.filter((item) => item.status === 'success').length
  const attention = result.results.filter((item) => item.status === 'needs_attention').length
  const failed = result.results.length - success - attention
  const detail = result.results.find((item) => item.status !== 'success')?.message
  return `Recovery ${result.results.length} tài khoản · ${success} thành công · ${attention} cần xử lý · ${failed} lỗi${detail ? ` · ${detail}` : ''}.`
}

function passwordSummary(result: HotmailPasswordBatchResult): string {
  const success = result.results.filter((item) => item.status === 'success').length
  const attention = result.results.filter((item) => item.status === 'needs_attention').length
  const failed = result.results.length - success - attention
  const detail = result.results.find((item) => item.status !== 'success')?.message
  return `Password ${result.results.length} tài khoản · ${success} thành công · ${attention} cần xử lý · ${failed} lỗi${detail ? ` · ${detail}` : ''}.`
}

function Spinner() {
  return <span className="email-spinner" aria-hidden="true" />
}

export function HotmailAuto() {
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
  const [panel, setPanel] = useState<EmailPanel>(null)
  const [query, setQuery] = useState('')
  const [quickFilter, setQuickFilter] = useState<EmailQuickFilter>('all')
  const [recoveryEmail, setRecoveryEmail] = useState('')
  const [recoveryOperation, setRecoveryOperation] = useState<HotmailRecoveryOperation>('add')
  const [recoveryAwaitingConfirmation, setRecoveryAwaitingConfirmation] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [passwordAwaitingConfirmation, setPasswordAwaitingConfirmation] = useState(false)

  const visibleRows = useMemo(() => filterHotmailRows(rows, query, quickFilter), [rows, query, quickFilter])
  const selectedIds = useMemo(() => [...selection], [selection])
  const selectedRows = useMemo(() => rows.filter((row) => selection.has(row.accountId)), [rows, selection])
  const rowsWithErrors = useMemo(() => rows.filter((row) => row.lastError), [rows])
  const rowsWithRecovery = useMemo(() => rows.filter((row) => row.backupEmail), [rows])
  const profilesReady = useMemo(() => rows.filter((row) => row.profileStatus === 'available' || row.profileStatus === 'running').length, [rows])
  const mailReady = useMemo(() => rows.filter((row) => row.mailStatus === 'ready').length, [rows])
  const oauthReady = useMemo(() => rows.filter((row) => row.oauthStatus === 'valid' && row.hasRefreshToken).length, [rows])
  const visibleSelected = useMemo(() => visibleRows.filter((row) => selection.has(row.accountId)).length, [visibleRows, selection])

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

  const toggleVisible = () => setSelection((current) => {
    const next = new Set(current)
    const allVisibleSelected = visibleRows.length > 0 && visibleRows.every((row) => next.has(row.accountId))
    visibleRows.forEach((row) => allVisibleSelected ? next.delete(row.accountId) : next.add(row.accountId))
    return next
  })

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
      const start = visibleRows.findIndex((row) => row.accountId === lastSelectedId)
      const end = visibleRows.findIndex((row) => row.accountId === accountId)
      if (start >= 0 && end >= 0) {
        const from = Math.min(start, end)
        const to = Math.max(start, end)
        setSelection((current) => {
          const next = new Set(event.ctrlKey || event.metaKey ? current : [])
          visibleRows.slice(from, to + 1).forEach((row) => next.add(row.accountId))
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
    const ids = accountId === undefined ? requireSelection() : [accountId]
    if (ids.length !== 1) throw new Error('OAuth chỉ thao tác một tài khoản mỗi lần.')
    const result = await window.pageAuto.startHotmailOAuth({ accountId: ids[0]! })
    setOauthPrompt(result)
    return result.message
  })

  const getCodes = (accountIds?: number[]) => runAction('codes', async () => resultSummary(await window.pageAuto.getHotmailCodes({ accountIds: accountIds ?? requireSelection() })))
  const checkMail = (accountIds?: number[]) => runAction('check', async () => resultSummary(await window.pageAuto.checkHotmail({ accountIds: accountIds ?? requireSelection() })))
  const openMail = (accountIds?: number[]) => runAction('open', async () => {
    const messages: string[] = []
    for (const accountId of accountIds ?? requireSelection()) messages.push((await window.pageAuto.openHotmail({ accountId })).message)
    return messages.join(' · ')
  })

  const runRecovery = (operation: HotmailRecoveryOperation, confirmCompleted = false) => runAction('recovery', async () => {
    const ids = requireSelection()
    if (!confirmCompleted && (operation === 'remove' || operation === 'replace')) {
      const label = operation === 'remove' ? 'xóa Mail khôi phục' : 'thay Mail khôi phục'
      if (!window.confirm(`Xác nhận mở flow ${label} cho ${ids.length} tài khoản đã chọn?`)) return 'Đã hủy thao tác Mail khôi phục.'
    }
    setRecoveryOperation(operation)
    const result = await window.pageAuto.updateHotmailRecovery({
      accountIds: ids,
      operation,
      ...(operation === 'remove' ? {} : { recoveryEmail }),
      confirmCompleted
    })
    const attention = result.results.some((item) => item.status === 'needs_attention')
    setRecoveryAwaitingConfirmation(attention)
    if (confirmCompleted && result.results.every((item) => item.status === 'success')) setRecoveryEmail('')
    return recoverySummary(result)
  })

  const runPassword = (confirmCompleted = false) => runAction('password', async () => {
    if (confirmCompleted) {
      const result = await window.pageAuto.updateHotmailPassword({ accountIds: [], confirmCompleted: true })
      const attention = result.results.some((item) => item.status === 'needs_attention')
      setPasswordAwaitingConfirmation(attention)
      if (!attention && result.results.every((item) => item.status === 'success')) {
        setNewPassword('')
        setConfirmNewPassword('')
      }
      return passwordSummary(result)
    }

    const ids = requireSelection()
    if (newPassword !== confirmNewPassword) throw new Error('Password Email mới và ô xác nhận chưa khớp.')
    if (!window.confirm(`Xác nhận đổi Password Email cho ${ids.length} tài khoản đã chọn? PassEmail chỉ cập nhật sau khi Microsoft xác nhận thành công.`)) {
      return 'Đã hủy thao tác đổi Password Email.'
    }
    const result = await window.pageAuto.updateHotmailPassword({
      accountIds: ids,
      newPassword,
      confirmCompleted: false
    })
    const attention = result.results.some((item) => item.status === 'needs_attention')
    setPasswordAwaitingConfirmation(attention)
    if (!attention && result.results.every((item) => item.status === 'success')) {
      setNewPassword('')
      setConfirmNewPassword('')
    }
    return passwordSummary(result)
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

  const copyEmails = (accountIds?: number[]) => runAction('copy', async () => {
    const ids = accountIds ?? requireSelection()
    const emails = rows.filter((row) => ids.includes(row.accountId)).map((row) => row.email).filter((email): email is string => Boolean(email))
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
  const panelRows = selectedRows.length > 0 ? selectedRows : rows
  const logRows = selectedRows.length > 0 ? selectedRows : rowsWithErrors
  const allVisibleSelected = visibleRows.length > 0 && visibleRows.every((row) => selection.has(row.accountId))

  return <section className="email-shell">
    <header className="email-commandbar">
      <div className="email-command-primary">
        <button className="email-button primary" disabled={isBusy('open')} onClick={() => void openMail()}>{isBusy('open') && <Spinner />}Mở mail</button>
        <button className="email-button success" disabled={isBusy('codes')} onClick={() => void getCodes()}>{isBusy('codes') && <Spinner />}Lấy mã</button>
        <button className="email-button primary" disabled={isBusy('check')} onClick={() => void checkMail()}>{isBusy('check') && <Spinner />}Check Live</button>
        <button className="email-button secondary" disabled={isBusy('oauth') || selectedRows.length !== 1} onClick={() => void connectMailbox()}>{isBusy('oauth') && <Spinner />}Lấy / cập nhật OAuth</button>
        <button className="email-button secondary" disabled={isBusy('copy')} onClick={() => void copyEmails()}>{isBusy('copy') && <Spinner />}Copy Email</button>
      </div>
      <div className="email-command-secondary">
        <button className="email-button ghost" onClick={() => setPanel('password')}>Đổi Password</button>
        <button className="email-button ghost" onClick={() => setPanel('recovery')}>Mail khôi phục</button>
        <button className="email-button ghost" onClick={() => setPanel('network')}>Proxy / IP</button>
        <button className="email-button ghost" onClick={() => setPanel('logs')}>Nhật ký</button>
        <button className="email-button ghost" onClick={() => setPanel('settings')}>Cài đặt</button>
        <button className="email-icon-button" title="Làm mới" disabled={isBusy('refresh')} onClick={() => void refreshEverything()}>{isBusy('refresh') ? <Spinner /> : '↻'}</button>
      </div>
    </header>

    <div className="email-grid-tools">
      <div className="email-search-box"><span>⌕</span><input value={query} onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)} placeholder="Tìm UID, Email, mail khôi phục, Client ID, lỗi..." />{query ? <button onClick={() => setQuery('')}>×</button> : null}</div>
      <div className="email-filter-pills">{QUICK_FILTERS.map((filter) => <button key={filter.id} className={quickFilter === filter.id ? 'active' : ''} onClick={() => setQuickFilter(filter.id)}>{filter.label}</button>)}</div>
      <div className="email-grid-meta"><strong>{selectedRows.length}</strong> đã chọn<span>{visibleRows.length}/{rows.length} đang hiện</span>{selectedRows.length ? <button onClick={() => setSelection(new Set())}>Bỏ chọn</button> : null}</div>
    </div>

    <div className="email-health-strip">
      <div><span>MAIL SẴN SÀNG</span><strong>{mailReady}/{rows.length}</strong></div>
      <div><span>OAUTH HỢP LỆ</span><strong>{oauthReady}/{rows.length}</strong></div>
      <div><span>PROFILE DÙNG ĐƯỢC</span><strong>{profilesReady}/{rows.length}</strong></div>
      <div><span>CÓ MAIL KHÔI PHỤC</span><strong>{rowsWithRecovery.length}/{rows.length}</strong></div>
      <div className="network-health"><span>MẠNG EMAIL</span><strong>{proxyStatus?.mode === 'random_ipv4' ? `IPv4 pool · ${proxyStatus.poolSize}` : 'Trực tiếp'}</strong></div>
    </div>

    {oauthPrompt ? <div className="email-connect-banner"><strong>Kết nối OAuth</strong><span>Mã: <b>{oauthPrompt.userCode ?? '—'}</b></span><span className="mono">{oauthPrompt.verificationUri ?? ''}</span><span>{oauthPrompt.expiresAt ? `Hết hạn ${formatTime(oauthPrompt.expiresAt)}` : ''}</span><button onClick={() => setOauthPrompt(null)}>×</button></div> : null}
    <div className="email-status-line"><span className="email-status-dot" />{message}</div>

    <div className="email-grid-wrap"><table className="email-grid"><thead><tr>
      <th className="check"><input type="checkbox" checked={allVisibleSelected} onChange={toggleVisible} /></th>
      <th>STT</th><th>UID</th><th>Email</th><th>Pass Email</th><th>Mail khôi phục</th><th>OAuth</th><th>Client ID</th><th>Refresh Token</th><th>Tình trạng mail</th><th>Profile Email</th><th>Đường dẫn profile</th><th>Mã mới nhất</th><th>Lấy mã gần nhất</th><th>Check gần nhất</th><th>Đang làm gì</th><th>Lỗi gần nhất</th>
    </tr></thead><tbody>
      {visibleRows.map((row, index) => {
        const recovery = detectRecoveryMailProvider(row.backupEmail)
        return <tr key={row.accountId} className={selection.has(row.accountId) ? 'selected' : ''} onClick={(event) => selectRow(event, row.accountId)} onDoubleClick={() => void openMail([row.accountId])} onContextMenu={(event) => openContextMenu(event, row.accountId)}>
          <td className="check" onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={selection.has(row.accountId)} onChange={() => toggleOne(row.accountId)} /></td>
          <td>{index + 1}</td><td className="mono uid-cell">{row.uid}</td><td>{row.email ?? '—'}</td><td className="secret">{row.emailPasswordMasked ?? '—'}</td>
          <td className="recovery-cell"><span>{row.backupEmail ?? '—'}</span>{row.backupEmail ? <span className={`recovery-chip ${recovery.kind}`}>{recovery.label}</span> : null}</td>
          <td><span className={`email-chip ${row.oauthStatus}`}>{connectionStatusLabel(row.oauthStatus)}</span></td><td className="mono">{previewClientId(row.oauthClientId)}</td>
          <td><div className="token-cell"><span className={`email-chip ${row.hasRefreshToken ? 'valid' : 'missing'}`}>{row.hasRefreshToken ? 'Có token' : 'Chưa có'}</span><small>{formatTime(row.oauthUpdatedAt)}</small></div></td>
          <td><span className={`email-chip ${row.mailStatus}`}>{mailStatusLabel(row.mailStatus)}</span></td><td><span className={`email-chip ${row.profileStatus}`}>{profileStatusLabel(row.profileStatus)}</span></td>
          <td className="path-cell" title={row.profileDirectory ?? ''}>{row.profileDirectory ?? '—'}</td><td className="code-cell">{row.latestCode ?? '—'}</td><td>{formatTime(row.lastCodeAt)}</td><td>{formatTime(row.lastCheckAt)}</td>
          <td><span className={`email-chip ${row.runtimeStatus}`}>{runtimeStatusLabel(row.runtimeStatus)}</span></td><td className="error-cell" title={row.lastError ?? ''}>{row.lastError ?? '—'}</td>
        </tr>
      })}
      {visibleRows.length === 0 ? <tr><td className="empty" colSpan={17}>{rows.length === 0 ? 'Chưa có tài khoản. Thêm tài khoản ở mục Tài khoản trước.' : 'Không có tài khoản phù hợp bộ lọc hiện tại.'}</td></tr> : null}
    </tbody></table></div>

    <footer className="email-selection-footer"><div><strong>{visibleSelected}</strong> dòng đang hiện được chọn · <strong>{selectedRows.length}</strong> tổng selection</div><span>Double-click: Mở mail · Ctrl/Shift: chọn nhiều · Chuột phải: thao tác trên selection</span></footer>

    {panel ? <div className="email-panel-backdrop" onMouseDown={() => setPanel(null)}><aside className="email-side-panel" onMouseDown={(event) => event.stopPropagation()}>
      <div className="email-panel-header"><div><span>EMAIL</span><h2>{panel === 'network' ? 'Proxy / IP' : panel === 'logs' ? 'Nhật ký gần nhất' : panel === 'recovery' ? 'Mail khôi phục' : panel === 'password' ? 'Đổi Password Email' : 'Cài đặt'}</h2></div><button className="email-panel-close" onClick={() => setPanel(null)}>×</button></div>

      {panel === 'network' ? <div className="email-panel-content">
        <div className="email-panel-summary"><div><span>Chế độ</span><strong>{proxyStatus?.mode === 'random_ipv4' ? 'IPv4 ngẫu nhiên' : 'Trực tiếp'}</strong></div><div><span>Proxy hiện tại</span><strong>{proxyStatus?.currentProxy ?? 'Chưa có'}</strong></div><div><span>Pool</span><strong>{proxyStatus?.poolSize ?? 0}</strong></div><div><span>Phiên đang dùng</span><strong>{proxyStatus?.activeSessions ?? 0}</strong></div></div>
        <p className="email-panel-note">Mạng Email tách hoàn toàn khỏi Facebook. Đổi IP chỉ áp dụng cho phiên Email mới.</p>
        <div className="email-panel-actions"><button className="email-button primary" disabled={isBusy('rotate')} onClick={() => void rotateProxy()}>Đổi IP</button><button className="email-button secondary" disabled={isBusy('test')} onClick={() => void testProxy()}>Kiểm tra IP</button><button className="email-button secondary" onClick={() => setPanel('settings')}>Cấu hình pool</button></div>
        <div className="email-info-card"><strong>Trạng thái</strong><p>{proxyStatus?.message ?? 'Chưa tải trạng thái mạng Email.'}</p></div>
      </div> : null}

      {panel === 'logs' ? <div className="email-panel-content"><p className="email-panel-note">{selectedRows.length ? `Đang xem ${selectedRows.length} tài khoản đã chọn.` : 'Không có selection; ưu tiên các tài khoản có lỗi.'}</p><div className="email-log-list">{logRows.length ? logRows.map((row) => <article key={row.accountId}><div><strong>{row.uid}</strong><span className={`email-chip ${row.runtimeStatus}`}>{runtimeStatusLabel(row.runtimeStatus)}</span></div><p>{row.email ?? 'Chưa có Email'}</p><small>Check: {formatTime(row.lastCheckAt)} · Code: {formatTime(row.lastCodeAt)}</small><div className={row.lastError ? 'log-error' : 'log-ok'}>{row.lastError ?? 'Không có lỗi gần nhất.'}</div></article>) : <div className="email-panel-empty">Chưa có lỗi hoặc tài khoản được chọn.</div>}</div></div> : null}

      {panel === 'password' ? <div className="email-panel-content">
        <p className="email-panel-note">E5.2 dùng đúng Email Profile Root/UID và mạng Email riêng. PAGE-AUTO chỉ tự điền khi nhận đúng surface Change Password/Password expired của Microsoft; login, identity/security review hoặc surface lạ sẽ giữ phiên `needs_attention`, không bypass.</p>
        <div className="email-recovery-selection">{panelRows.slice(0, 20).map((row) => <div key={row.accountId}><span className="mono">{row.uid}</span><strong>{row.email ?? 'Chưa có Email Microsoft'}</strong><span className={`email-chip ${row.profileStatus}`}>{profileStatusLabel(row.profileStatus)}</span></div>)}</div>
        <section className="email-settings-card"><div className="email-settings-heading"><div><span>E5.2 PASSWORD HOTMAIL</span><h3>Đổi Password Email</h3></div><span className="email-settings-badge">Canonical theo accountId</span></div><div className="email-settings-grid">
          <label className="wide"><span>Password Email mới</span><input type="password" autoComplete="new-password" value={newPassword} disabled={passwordAwaitingConfirmation} onChange={(event: ChangeEvent<HTMLInputElement>) => setNewPassword(event.target.value)} placeholder="Tối thiểu 8 ký tự" /><small>Không trim/mutate password, không log plaintext. Batch sẽ áp dụng cùng password mới cho selection đã chốt.</small></label>
          <label className="wide"><span>Xác nhận Password mới</span><input type="password" autoComplete="new-password" value={confirmNewPassword} disabled={passwordAwaitingConfirmation} onChange={(event: ChangeEvent<HTMLInputElement>) => setConfirmNewPassword(event.target.value)} placeholder="Nhập lại Password mới" /></label>
        </div><div className="email-panel-actions">
          <button className="email-button primary" disabled={isBusy('password') || selectedIds.length === 0 || passwordAwaitingConfirmation} onClick={() => void runPassword(false)}>{isBusy('password') && <Spinner />}Đổi Password</button>
          {passwordAwaitingConfirmation ? <button className="email-button success" disabled={isBusy('password')} onClick={() => void runPassword(true)}>{isBusy('password') && <Spinner />}Xác nhận hoàn tất</button> : null}
        </div></section>
        <div className="email-info-card"><strong>Cách chạy</strong><p>Form Microsoft chuẩn sẽ được điền current/new/re-enter bằng worker Email. Nếu flow chuyển thủ công, selection + Password mới được đóng băng ở Main; nút Xác nhận hoàn tất không đọc lại selection hoặc input đã thay đổi. Chỉ result success mới cập nhật accounts.PassEmail.</p></div>
      </div> : null}

      {panel === 'recovery' ? <div className="email-panel-content">
        <p className="email-panel-note">Recovery chạy trên đúng Email Profile Root/UID và mạng Email riêng. Microsoft yêu cầu login/xác minh bảo mật thì app giữ phiên và trả trạng thái cần xử lý; không bypass.</p>
        <div className="email-recovery-selection">{panelRows.slice(0, 20).map((row) => { const recovery = detectRecoveryMailProvider(row.backupEmail); return <div key={row.accountId}><span className="mono">{row.uid}</span><strong>{row.backupEmail ?? 'Chưa có mail khôi phục'}</strong>{row.backupEmail ? <span className={`recovery-chip ${recovery.kind}`}>{recovery.label}</span> : null}</div> })}</div>
        <section className="email-settings-card"><div className="email-settings-heading"><div><span>E5.1 RECOVERY MAIL</span><h3>Thêm / xóa / thay Mail khôi phục</h3></div><span className="email-settings-badge">Canonical theo accountId</span></div><div className="email-settings-grid">
          <label className="wide"><span>Email khôi phục mới</span><input value={recoveryEmail} onChange={(event: ChangeEvent<HTMLInputElement>) => setRecoveryEmail(event.target.value)} placeholder="recovery@example.com" /><small>Dùng cho Thêm/Thay. Xóa không dùng ô này.</small></label>
        </div><div className="email-panel-actions">
          <button className="email-button primary" disabled={isBusy('recovery') || selectedIds.length === 0} onClick={() => void runRecovery('add')}>Thêm</button>
          <button className="email-button secondary" disabled={isBusy('recovery') || selectedIds.length === 0} onClick={() => void runRecovery('replace')}>Thay</button>
          <button className="email-button secondary" disabled={isBusy('recovery') || selectedIds.length === 0} onClick={() => void runRecovery('remove')}>Xóa</button>
          {recoveryAwaitingConfirmation ? <button className="email-button success" disabled={isBusy('recovery')} onClick={() => void runRecovery(recoveryOperation, true)}>Xác nhận hoàn tất</button> : null}
        </div></section>
        <div className="email-info-card"><strong>Cách chạy</strong><p>Bước 1 mở flow. Bước 2 hoàn tất trang Microsoft trong browser Email đang giữ live. Bước 3 bấm Xác nhận hoàn tất; chỉ lúc đó PAGE-AUTO mới cập nhật accounts.BackupEmail.</p></div>
        <div className="email-provider-list">{EMAIL_RECOVERY_PROVIDERS.map((provider) => <article key={provider.id} className="email-provider-card"><div><strong>{provider.label}</strong><span className={`recovery-chip ${provider.kind}`}>{provider.kind === 'temporary' ? 'Mail dùng nhanh' : 'Mail thường'}</span></div><p>{provider.domains.join(' · ')}</p></article>)}</div>
      </div> : null}

      {panel === 'settings' ? <div className="email-panel-content settings-panel">{draft ? <>
        <section className="email-settings-card"><div className="email-settings-heading"><div><span>PROFILE EMAIL</span><h3>Profile và trình duyệt</h3></div><span className="email-settings-badge">Tách riêng Facebook</span></div><div className="email-settings-grid">
          <label className="wide"><span>Thư mục profile Email</span><div className="input-action"><input value={draft.profileRoot} onChange={(event: ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, profileRoot: event.target.value })} placeholder="F:\\...\\profiles" /><button className="email-button secondary" onClick={() => void pickProfileRoot()}>Chọn thư mục</button></div><small>Mỗi UID dùng đúng root\UID. Không fallback profile Facebook.</small></label>
          <label className="wide"><span>Trình duyệt Email</span><div className="input-action"><input value={draft.browserExecutable} onChange={(event: ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, browserExecutable: event.target.value })} placeholder="Để trống = Tự động" /><button className="email-button secondary" onClick={() => void pickBrowser()}>Chọn file</button></div></label>
        </div></section>
        <section className="email-settings-card"><div className="email-settings-heading"><div><span>MẠNG EMAIL</span><h3>IPv4 / Proxy riêng</h3></div><span className="email-settings-badge">Không dùng proxy Facebook</span></div><div className="email-settings-grid">
          <label><span>Chế độ</span><select value={draft.proxyMode} onChange={(event: ChangeEvent<HTMLSelectElement>) => setDraft({ ...draft, proxyMode: event.target.value as EmailProxyMode })}><option value="direct">Trực tiếp</option><option value="random_ipv4">IPv4 ngẫu nhiên</option></select></label><label><span>Pool hiện tại</span><input value={`${settings?.proxyCount ?? 0} proxy`} readOnly /></label>
          <label className="wide"><span>Danh sách proxy IPv4</span><textarea value={draft.proxyListText} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => { setDraft({ ...draft, proxyListText: event.target.value }); setProxyDirty(true) }} placeholder={'Mỗi dòng một proxy\nKhông sửa = giữ pool hiện tại'} /></label>
        </div></section>
        <details className="email-advanced-card"><summary>Cài đặt nâng cao — OAuth mặc định</summary><div className="email-settings-grid advanced-body"><label><span>Client ID mặc định</span><input value={draft.oauthClientId} onChange={(event: ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, oauthClientId: event.target.value })} /></label><label><span>Tenant</span><input value={draft.oauthTenant} onChange={(event: ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, oauthTenant: event.target.value })} placeholder="consumers" /></label></div></details>
        <div className="email-settings-footer"><span>{message}</span><button className="email-button primary" disabled={isBusy('save')} onClick={() => void saveSettings()}>{isBusy('save') && <Spinner />}Lưu cài đặt</button></div>
      </> : <div className="email-panel-empty">Đang tải cài đặt Email...</div>}</div> : null}
    </aside></div> : null}

    {contextMenu ? <div className="email-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onMouseDown={(event) => event.stopPropagation()}><div className="email-context-title">{contextIds.length} tài khoản trong selection</div><button onClick={() => { setContextMenu(null); void openMail(contextIds) }}>Mở mail</button><button onClick={() => { setContextMenu(null); void getCodes(contextIds) }}>Lấy mã</button><button onClick={() => { setContextMenu(null); void checkMail(contextIds) }}>Check Live Hotmail</button><button disabled={contextIds.length !== 1} onClick={() => { setContextMenu(null); void connectMailbox(contextIds[0]) }}>Lấy / cập nhật OAuth</button><div className="email-context-separator" /><button onClick={() => { setContextMenu(null); void copyEmails(contextIds) }}>Copy Email</button><button onClick={() => { setContextMenu(null); setPanel('password') }}>Đổi Password Email</button><button onClick={() => { setContextMenu(null); setPanel('recovery') }}>Thao tác Mail khôi phục</button><button onClick={() => { setContextMenu(null); setPanel('logs') }}>Xem trạng thái / lỗi</button></div> : null}
  </section>
}
