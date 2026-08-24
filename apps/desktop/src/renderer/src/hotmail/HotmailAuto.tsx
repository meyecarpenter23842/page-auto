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

type SettingsTab = 'profile' | 'microsoft' | 'recovery' | 'proxy'
type ActionKey = 'oauth' | 'codes' | 'open' | 'check' | 'rotate' | 'test' | 'save' | 'pick-root' | 'pick-browser' | 'copy'

type ContextMenuState = {
  x: number
  y: number
  accountId: number
} | null

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

function statusLabel(value: string): string {
  return value.replaceAll('_', ' ')
}

function profileStatusLabel(value: HotmailDashboardRow['profileStatus']): string {
  if (value === 'missing') return 'Chưa có profile'
  if (value === 'not_configured') return 'Chưa cấu hình'
  if (value === 'available') return 'Sẵn sàng'
  if (value === 'running') return 'Đang mở'
  if (value === 'in_use') return 'Đang sử dụng'
  return statusLabel(value)
}

function resultSummary(result: HotmailBatchResult): string {
  const success = result.results.filter((item) => item.status === 'success').length
  const failed = result.results.length - success
  const detail = result.results.find((item) => item.status !== 'success')?.message
  return `Hoàn tất ${result.results.length} account · ${success} thành công · ${failed} lỗi${detail ? ` · ${detail}` : ''}.`
}

function Spinner() {
  return <span className="email-spinner" aria-hidden="true" />
}

export function HotmailAuto() {
  const [rows, setRows] = useState<HotmailDashboardRow[]>([])
  const [settings, setSettings] = useState<HotmailSettingsView | null>(null)
  const [draft, setDraft] = useState<SettingsDraft | null>(null)
  const [selection, setSelection] = useState<Set<number>>(new Set())
  const [proxyDirty, setProxyDirty] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('profile')
  const [busyActions, setBusyActions] = useState<Set<ActionKey>>(new Set())
  const [message, setMessage] = useState('Email lấy account trực tiếp từ Account Manager theo UID.')
  const [oauthPrompt, setOauthPrompt] = useState<HotmailOAuthStartResult | null>(null)
  const [proxyStatus, setProxyStatus] = useState<HotmailProxyStatus | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null)

  const selectedIds = useMemo(() => [...selection], [selection])
  const selectedRows = useMemo(() => rows.filter((row) => selection.has(row.accountId)), [rows, selection])
  const openMailLabel = selectedRows.some((row) => row.profileStatus === 'missing') ? 'Tạo / mở profile' : 'Mở mail'

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
  const runAction = async (key: ActionKey, task: () => Promise<string>, refresh: 'none' | 'rows' | 'settings' = 'rows') => {
    setBusyActions((current) => new Set(current).add(key))
    try {
      setMessage(await task())
      if (refresh === 'rows') await refreshRows()
      if (refresh === 'settings') await refreshSettings()
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
    setSelection((current) => {
      const next = new Set(current)
      if (next.has(accountId)) next.delete(accountId)
      else next.add(accountId)
      return next
    })
  }

  const requireSelection = (): number[] => {
    if (selectedIds.length === 0) throw new Error('Anh chọn ít nhất một account trước.')
    return selectedIds
  }

  const connectOAuth = (accountId?: number) => runAction('oauth', async () => {
    const id = accountId ?? requireSelection()[0]
    if (!id) throw new Error('Chưa chọn account.')
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
      messages.push(`${accountId}: ${result.message}`)
    }
    return messages.join(' · ')
  })

  const rotateProxy = () => runAction('rotate', async () => {
    const status = await window.pageAuto.rotateHotmailProxy()
    setProxyStatus(status)
    return status.message
  }, 'none')

  const testProxy = () => runAction('test', async () => (await window.pageAuto.testHotmailProxy()).message, 'none')

  const pickProfileRoot = () => runAction('pick-root', async () => {
    const path = await window.pageAuto.pickHotmailProfileRoot()
    if (!path) return 'Đã hủy chọn Email Profile Root.'
    setDraft((current) => current ? { ...current, profileRoot: path } : current)
    return `Đã chọn Email Profile Root: ${path}.`
  }, 'none')

  const pickBrowser = () => runAction('pick-browser', async () => {
    const path = await window.pageAuto.pickHotmailBrowserExecutable()
    if (!path) return 'Đã hủy chọn browser executable.'
    setDraft((current) => current ? { ...current, browserExecutable: path } : current)
    return `Đã chọn browser: ${path}.`
  }, 'none')

  const saveSettings = () => runAction('save', async () => {
    if (!draft) throw new Error('Cấu hình Email chưa tải xong.')
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
    setSettingsOpen(false)
    return 'Đã lưu Thiết lập Email.'
  }, 'settings')

  const copyEmail = (accountId: number) => runAction('copy', async () => {
    const email = rows.find((row) => row.accountId === accountId)?.email
    if (!email) throw new Error('Account chưa có Email.')
    await navigator.clipboard.writeText(email)
    return `Đã copy ${email}.`
  }, 'none')

  const openContextMenu = (event: MouseEvent<HTMLTableRowElement>, accountId: number) => {
    event.preventDefault()
    if (!selection.has(accountId)) setSelection(new Set([accountId]))
    setContextMenu({ x: event.clientX, y: event.clientY, accountId })
  }

  return (
    <section className="hotmail-shell email-shell">
      <div className="hotmail-toolbar email-toolbar">
        <div className="hotmail-toolbar-actions">
          <button className="email-button primary" disabled={isBusy('oauth')} onClick={() => void connectOAuth()}>{isBusy('oauth') && <Spinner />}Kết nối Microsoft</button>
          <button className="email-button success" disabled={isBusy('codes')} onClick={() => void getCodes()}>{isBusy('codes') && <Spinner />}Lấy code</button>
          <button className="email-button primary" disabled={isBusy('open')} onClick={() => void openMail()}>{isBusy('open') && <Spinner />}{openMailLabel}</button>
          <button className="email-button secondary" disabled={isBusy('check')} onClick={() => void checkMail()}>{isBusy('check') && <Spinner />}Kiểm tra mail</button>
          <button className="email-button settings" onClick={() => { setSettingsTab('profile'); setSettingsOpen(true) }}>Thiết lập Email</button>
          <button className="email-button secondary" disabled={isBusy('rotate')} onClick={() => void rotateProxy()}>{isBusy('rotate') && <Spinner />}Đổi IP</button>
          <button className="email-button secondary" disabled={isBusy('test')} onClick={() => void testProxy()}>{isBusy('test') && <Spinner />}Test Proxy</button>
        </div>
        <div className="hotmail-toolbar-meta">
          <strong>{selectedRows.length}/{rows.length}</strong> đã chọn
          <span>{proxyStatus?.mode === 'random_ipv4' ? `Random IPv4 · ${proxyStatus.poolSize} proxy` : 'Direct'}</span>
          <span>{proxyStatus?.currentProxy ?? 'Không có proxy hiện tại'}</span>
        </div>
      </div>

      {oauthPrompt ? (
        <div className="hotmail-oauth-banner">
          <strong>Microsoft OAuth:</strong>
          <span>Mã <b>{oauthPrompt.userCode ?? '—'}</b></span>
          <span>{oauthPrompt.verificationUri ?? ''}</span>
          <span>{oauthPrompt.expiresAt ? `hết hạn ${formatTime(oauthPrompt.expiresAt)}` : ''}</span>
        </div>
      ) : null}

      <div className="hotmail-status-line"><span className="email-status-dot" />{message}</div>

      <div className="hotmail-grid-wrap">
        <table className="hotmail-grid">
          <thead><tr>
            <th className="check"><input type="checkbox" checked={rows.length > 0 && selection.size === rows.length} onChange={toggleAll} /></th>
            <th>UID</th><th>Email</th><th>Pass Email</th><th>Mail khôi phục</th><th>Loại khôi phục</th><th>OAuth</th><th>Mail</th><th>Profile</th><th>Code mới nhất</th><th>Lấy code gần nhất</th><th>Runtime</th><th>Lỗi gần nhất</th>
          </tr></thead>
          <tbody>
            {rows.map((row) => {
              const recovery = detectRecoveryMailProvider(row.backupEmail)
              return (
                <tr key={row.accountId} className={selection.has(row.accountId) ? 'selected' : ''} onClick={() => toggleOne(row.accountId)} onContextMenu={(event) => openContextMenu(event, row.accountId)}>
                  <td className="check" onClick={(event: MouseEvent<HTMLTableCellElement>) => event.stopPropagation()}><input type="checkbox" checked={selection.has(row.accountId)} onChange={() => toggleOne(row.accountId)} /></td>
                  <td className="mono">{row.uid}</td>
                  <td>{row.email ?? '—'}</td>
                  <td className="secret">{row.emailPasswordMasked ?? '—'}</td>
                  <td>{row.backupEmail ?? '—'}</td>
                  <td title={recovery.domain ?? ''}><span className={`recovery-chip ${recovery.kind}`}>{recovery.label}</span></td>
                  <td><span className={`hotmail-chip ${row.oauthStatus}`}>{statusLabel(row.oauthStatus)}</span></td>
                  <td><span className={`hotmail-chip ${row.mailStatus}`}>{statusLabel(row.mailStatus)}</span></td>
                  <td title={row.profileDirectory ?? ''}><span className={`hotmail-chip ${row.profileStatus}`}>{profileStatusLabel(row.profileStatus)}</span></td>
                  <td className="code-cell">{row.latestCode ?? '—'}</td>
                  <td>{formatTime(row.lastCodeAt)}</td>
                  <td><span className={`hotmail-chip ${row.runtimeStatus}`}>{statusLabel(row.runtimeStatus)}</span></td>
                  <td className="error-cell" title={row.lastError ?? ''}>{row.lastError ?? '—'}</td>
                </tr>
              )
            })}
            {rows.length === 0 ? <tr><td className="empty" colSpan={13}>Account Manager chưa có account để hiển thị.</td></tr> : null}
          </tbody>
        </table>
      </div>

      {contextMenu ? (
        <div className="email-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onMouseDown={(event) => event.stopPropagation()}>
          <button onClick={() => { setContextMenu(null); void openMail([contextMenu.accountId]) }}>{rows.find((row) => row.accountId === contextMenu.accountId)?.profileStatus === 'missing' ? 'Tạo / mở profile' : 'Mở mail / profile'}</button>
          <button onClick={() => { setContextMenu(null); void getCodes([contextMenu.accountId]) }}>Lấy code</button>
          <button onClick={() => { setContextMenu(null); void checkMail([contextMenu.accountId]) }}>Kiểm tra mail</button>
          <button onClick={() => { setContextMenu(null); void connectOAuth(contextMenu.accountId) }}>Kết nối lại Microsoft</button>
          <div className="email-context-separator" />
          <button onClick={() => { setContextMenu(null); void copyEmail(contextMenu.accountId) }}>Copy Email</button>
        </div>
      ) : null}

      {settingsOpen && draft ? (
        <div className="email-modal-backdrop" role="presentation" onMouseDown={() => setSettingsOpen(false)}>
          <div className="email-settings-modal" role="dialog" aria-modal="true" aria-label="Thiết lập Email" onMouseDown={(event) => event.stopPropagation()}>
            <div className="email-modal-header">
              <div><p className="eyebrow">EMAIL</p><h2>Thiết lập Email</h2></div>
              <button className="email-icon-button" onClick={() => setSettingsOpen(false)}>×</button>
            </div>
            <div className="email-settings-tabs">
              <button className={settingsTab === 'profile' ? 'active' : ''} onClick={() => setSettingsTab('profile')}>Profile</button>
              <button className={settingsTab === 'microsoft' ? 'active' : ''} onClick={() => setSettingsTab('microsoft')}>Microsoft</button>
              <button className={settingsTab === 'recovery' ? 'active' : ''} onClick={() => setSettingsTab('recovery')}>Mail khôi phục</button>
              <button className={settingsTab === 'proxy' ? 'active' : ''} onClick={() => setSettingsTab('proxy')}>Proxy Email</button>
            </div>

            <div className="email-settings-body">
              {settingsTab === 'profile' ? (
                <div className="email-settings-grid">
                  <label className="wide"><span>Email Profile Root (MaxHotmail)</span><div className="input-action"><input value={draft.profileRoot} onChange={(event: ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, profileRoot: event.target.value })} placeholder="F:\\...\\MaxHotmail\\profiles" /><button className="email-button secondary" disabled={isBusy('pick-root')} onClick={() => void pickProfileRoot()}>{isBusy('pick-root') && <Spinner />}Chọn folder</button></div></label>
                  <label className="wide"><span>Browser executable</span><div className="input-action"><input value={draft.browserExecutable} onChange={(event: ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, browserExecutable: event.target.value })} placeholder="Để trống = tự tìm Browser Email chạy được" /><button className="email-button secondary" disabled={isBusy('pick-browser')} onClick={() => void pickBrowser()}>{isBusy('pick-browser') && <Spinner />}Chọn file</button></div></label>
                  <p className="email-help wide">Profile luôn resolve đúng <code>root\UID</code>. Account chưa có profile chỉ được tạo khi bấm Tạo / mở profile. Browser được kiểm tra khả năng khởi động trước khi lưu hoặc dùng.</p>
                </div>
              ) : null}

              {settingsTab === 'microsoft' ? (
                <div className="email-settings-grid">
                  <label><span>Microsoft OAuth Client ID</span><input value={draft.oauthClientId} onChange={(event: ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, oauthClientId: event.target.value })} placeholder="Public client / desktop app ID" /></label>
                  <label><span>OAuth tenant</span><input value={draft.oauthTenant} onChange={(event: ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, oauthTenant: event.target.value })} placeholder="consumers" /></label>
                  <p className="email-help wide">Microsoft/Hotmail là provider chính hiện tại. Quyền đọc mail vẫn dùng Mail.Read; token không đưa ra renderer.</p>
                </div>
              ) : null}

              {settingsTab === 'recovery' ? (
                <div className="recovery-provider-list">
                  {EMAIL_RECOVERY_PROVIDERS.map((provider) => (
                    <article key={provider.id} className="recovery-provider-card">
                      <div className="recovery-provider-heading"><strong>{provider.label}</strong><span className={`recovery-chip ${provider.kind}`}>{provider.kind === 'temporary' ? 'Mail dùng nhanh' : 'Mail thường'}</span></div>
                      <div className="recovery-domain-list">{provider.domains.map((domain) => <code key={domain}>{domain}</code>)}</div>
                      <p>{provider.note}</p>
                    </article>
                  ))}
                  <p className="email-help">Domain chưa biết vẫn hiển thị bình thường. Catalog được tách riêng để bổ sung thêm provider/domain về sau mà không đổi Account Manager.</p>
                </div>
              ) : null}

              {settingsTab === 'proxy' ? (
                <div className="email-settings-grid">
                  <label><span>Proxy mode</span><select value={draft.proxyMode} onChange={(event: ChangeEvent<HTMLSelectElement>) => setDraft({ ...draft, proxyMode: event.target.value as EmailProxyMode })}><option value="direct">Direct</option><option value="random_ipv4">Random IPv4</option></select></label>
                  <label><span>Pool hiện tại</span><input value={`${settings?.proxyCount ?? 0} proxy`} readOnly /></label>
                  <label className="wide"><span>Proxy pool IPv4</span><textarea value={draft.proxyListText} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => { setDraft({ ...draft, proxyListText: event.target.value }); setProxyDirty(true) }} placeholder={'Mỗi dòng: 1.2.3.4:8080\nhoặc 1.2.3.4:8080:user:pass\nĐể nguyên không sửa = giữ pool hiện tại'} /></label>
                  <div className="proxy-preview wide">{settings?.proxyPreview.length ? settings.proxyPreview.map((proxy) => <code key={proxy}>{proxy}</code>) : <span>Chưa có proxy lưu.</span>}</div>
                  <button className="email-button danger compact" onClick={() => { setDraft({ ...draft, proxyListText: '' }); setProxyDirty(true) }}>Xóa pool khi lưu</button>
                </div>
              ) : null}
            </div>

            <div className="email-modal-footer">
              <span>{message}</span>
              <div><button className="email-button secondary" onClick={() => setSettingsOpen(false)}>Hủy</button><button className="email-button primary" disabled={isBusy('save')} onClick={() => void saveSettings()}>{isBusy('save') && <Spinner />}Lưu thiết lập</button></div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
