import { useEffect, useMemo, useState, type ChangeEvent, type MouseEvent } from 'react'
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

function resultSummary(result: HotmailBatchResult): string {
  const success = result.results.filter((item) => item.status === 'success').length
  const failed = result.results.length - success
  return `Hoàn tất ${result.results.length} account · ${success} thành công · ${failed} lỗi.`
}

export function HotmailAuto() {
  const [rows, setRows] = useState<HotmailDashboardRow[]>([])
  const [settings, setSettings] = useState<HotmailSettingsView | null>(null)
  const [draft, setDraft] = useState<SettingsDraft | null>(null)
  const [selection, setSelection] = useState<Set<number>>(new Set())
  const [proxyDirty, setProxyDirty] = useState(false)
  const [showConfig, setShowConfig] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('Hotmail Auto lấy account trực tiếp từ Account Manager theo UID.')
  const [oauthPrompt, setOauthPrompt] = useState<HotmailOAuthStartResult | null>(null)
  const [proxyStatus, setProxyStatus] = useState<HotmailProxyStatus | null>(null)

  const selectedIds = useMemo(() => [...selection], [selection])
  const selectedRows = useMemo(() => rows.filter((row) => selection.has(row.accountId)), [rows, selection])

  const refresh = async () => {
    const [nextRows, nextSettings, nextProxy] = await Promise.all([
      window.pageAuto.listHotmailDashboard(),
      window.pageAuto.getHotmailSettings(),
      window.pageAuto.getHotmailProxyStatus()
    ])
    setRows(nextRows)
    setSettings(nextSettings)
    setProxyStatus(nextProxy)
    setDraft((current) => current ?? settingsDraft(nextSettings))
  }

  useEffect(() => { void refresh().catch((error) => setMessage(error instanceof Error ? error.message : String(error))) }, [])

  const run = async (task: () => Promise<string>) => {
    setBusy(true)
    try {
      setMessage(await task())
      await refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
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

  const connectOAuth = () => run(async () => {
    const accountId = requireSelection()[0]
    if (!accountId) throw new Error('Chưa chọn account.')
    const result = await window.pageAuto.startHotmailOAuth({ accountId })
    setOauthPrompt(result)
    return result.message
  })

  const getCodes = () => run(async () => resultSummary(await window.pageAuto.getHotmailCodes({ accountIds: requireSelection() })))
  const checkMail = () => run(async () => resultSummary(await window.pageAuto.checkHotmail({ accountIds: requireSelection() })))

  const openMail = () => run(async () => {
    const ids = requireSelection()
    const messages: string[] = []
    for (const accountId of ids) {
      const result = await window.pageAuto.openHotmail({ accountId })
      messages.push(`${accountId}: ${result.message}`)
    }
    return messages.join(' · ')
  })

  const saveSettings = () => run(async () => {
    if (!draft) throw new Error('Cấu hình Hotmail chưa tải xong.')
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
    return 'Đã lưu cấu hình Hotmail Auto. Proxy Email vẫn độc lập với proxy Facebook.'
  })

  const pickProfileRoot = () => run(async () => {
    const path = await window.pageAuto.pickHotmailProfileRoot()
    if (!path) return 'Đã hủy chọn Email Profile Root.'
    setDraft((current) => current ? { ...current, profileRoot: path } : current)
    return `Đã chọn Email Profile Root: ${path}. Bấm Lưu cấu hình để áp dụng.`
  })

  const pickBrowser = () => run(async () => {
    const path = await window.pageAuto.pickHotmailBrowserExecutable()
    if (!path) return 'Đã hủy chọn browser executable.'
    setDraft((current) => current ? { ...current, browserExecutable: path } : current)
    return `Đã chọn browser: ${path}. Bấm Lưu cấu hình để áp dụng.`
  })

  const rotateProxy = () => run(async () => {
    const status = await window.pageAuto.rotateHotmailProxy()
    setProxyStatus(status)
    return status.message
  })

  const testProxy = () => run(async () => {
    const result = await window.pageAuto.testHotmailProxy()
    return result.message
  })

  return (
    <section className="hotmail-shell">
      <div className="hotmail-toolbar">
        <div className="hotmail-toolbar-actions">
          <button disabled={busy} onClick={() => void connectOAuth()}>Kết nối / Lấy OAuth</button>
          <button disabled={busy} onClick={() => void getCodes()}>Lấy code</button>
          <button disabled={busy} onClick={() => void openMail()}>Mở mail</button>
          <button disabled={busy} onClick={() => void checkMail()}>Kiểm tra mail</button>
          <button disabled={busy} onClick={() => setShowConfig((value) => !value)}>Config Proxy / Profile</button>
          <button disabled={busy} onClick={() => void rotateProxy()}>Đổi IP</button>
          <button disabled={busy} onClick={() => void testProxy()}>Test Proxy</button>
        </div>
        <div className="hotmail-toolbar-meta">
          <strong>{selectedRows.length}/{rows.length}</strong> đã chọn
          <span>{proxyStatus?.mode === 'random_ipv4' ? `Random IPv4 · ${proxyStatus.poolSize} proxy` : 'Direct'}</span>
          <span>{proxyStatus?.currentProxy ?? 'Không có proxy hiện tại'}</span>
        </div>
      </div>

      {showConfig && draft ? (
        <div className="hotmail-config-panel">
          <label className="wide"><span>Email Profile Root (MaxHotmail)</span><div className="input-action"><input value={draft.profileRoot} onChange={(event: ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, profileRoot: event.target.value })} placeholder="D:\\...\\MaxHotmail\\profiles" /><button onClick={() => void pickProfileRoot()}>Chọn folder</button></div></label>
          <label className="wide"><span>Browser executable</span><div className="input-action"><input value={draft.browserExecutable} onChange={(event: ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, browserExecutable: event.target.value })} placeholder="Để trống = dùng browser PAGE-AUTO" /><button onClick={() => void pickBrowser()}>Chọn file</button></div></label>
          <label><span>Microsoft OAuth Client ID</span><input value={draft.oauthClientId} onChange={(event: ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, oauthClientId: event.target.value })} placeholder="Public client / desktop app ID" /></label>
          <label><span>OAuth tenant</span><input value={draft.oauthTenant} onChange={(event: ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, oauthTenant: event.target.value })} placeholder="consumers" /></label>
          <label><span>Proxy mode</span><select value={draft.proxyMode} onChange={(event: ChangeEvent<HTMLSelectElement>) => setDraft({ ...draft, proxyMode: event.target.value as EmailProxyMode })}><option value="direct">Direct</option><option value="random_ipv4">Random IPv4</option></select></label>
          <label className="proxy-list"><span>Proxy pool IPv4 {settings ? `(đang lưu ${settings.proxyCount})` : ''}</span><textarea value={draft.proxyListText} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => { setDraft({ ...draft, proxyListText: event.target.value }); setProxyDirty(true) }} placeholder={'Mỗi dòng: 1.2.3.4:8080\nhoặc 1.2.3.4:8080:user:pass\nĐể nguyên không sửa = giữ pool hiện tại'} /></label>
          <div className="hotmail-config-actions"><button className="primary" disabled={busy} onClick={() => void saveSettings()}>Lưu cấu hình</button><button disabled={busy} onClick={() => { setDraft((current) => current ? { ...current, proxyListText: '' } : current); setProxyDirty(true) }}>Xóa pool khi lưu</button></div>
          <p className="hotmail-config-note">Profile chỉ resolve <code>root\UID</code>; PAGE-AUTO không scan account, không clone profile và không tạo fallback sang ổ C. Proxy Email là pool chung, không đọc/ghi proxy Facebook.</p>
        </div>
      ) : null}

      {oauthPrompt ? (
        <div className="hotmail-oauth-banner">
          <strong>Microsoft OAuth:</strong>
          <span>Mã <b>{oauthPrompt.userCode ?? '—'}</b></span>
          <span>{oauthPrompt.verificationUri ?? ''}</span>
          <span>{oauthPrompt.expiresAt ? `hết hạn ${formatTime(oauthPrompt.expiresAt)}` : ''}</span>
        </div>
      ) : null}

      <div className="hotmail-status-line">{busy ? 'Đang xử lý… ' : ''}{message}</div>

      <div className="hotmail-grid-wrap">
        <table className="hotmail-grid">
          <thead><tr>
            <th className="check"><input type="checkbox" checked={rows.length > 0 && selection.size === rows.length} onChange={toggleAll} /></th>
            <th>UID</th><th>Email</th><th>Pass Email</th><th>Mail khôi phục</th><th>OAuth</th><th>Mail</th><th>Profile</th><th>Code mới nhất</th><th>Lấy code gần nhất</th><th>Runtime</th><th>Lỗi gần nhất</th>
          </tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.accountId} className={selection.has(row.accountId) ? 'selected' : ''} onClick={() => toggleOne(row.accountId)}>
                <td className="check" onClick={(event: MouseEvent<HTMLTableCellElement>) => event.stopPropagation()}><input type="checkbox" checked={selection.has(row.accountId)} onChange={() => toggleOne(row.accountId)} /></td>
                <td className="mono">{row.uid}</td>
                <td>{row.email ?? '—'}</td>
                <td className="secret">{row.emailPasswordMasked ?? '—'}</td>
                <td>{row.backupEmail ?? '—'}</td>
                <td><span className={`hotmail-chip ${row.oauthStatus}`}>{statusLabel(row.oauthStatus)}</span></td>
                <td><span className={`hotmail-chip ${row.mailStatus}`}>{statusLabel(row.mailStatus)}</span></td>
                <td title={row.profileDirectory ?? ''}><span className={`hotmail-chip ${row.profileStatus}`}>{statusLabel(row.profileStatus)}</span></td>
                <td className="code-cell">{row.latestCode ?? '—'}</td>
                <td>{formatTime(row.lastCodeAt)}</td>
                <td><span className={`hotmail-chip ${row.runtimeStatus}`}>{statusLabel(row.runtimeStatus)}</span></td>
                <td className="error-cell" title={row.lastError ?? ''}>{row.lastError ?? '—'}</td>
              </tr>
            ))}
            {rows.length === 0 ? <tr><td className="empty" colSpan={12}>Account Manager chưa có account để hiển thị.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  )
}
