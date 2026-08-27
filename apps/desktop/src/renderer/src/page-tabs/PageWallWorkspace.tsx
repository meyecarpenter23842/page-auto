import { useEffect, useMemo, useRef, useState } from 'react'
import type { PageTabConfig, PageTabSummary } from '../../../shared/pageTabs'
import type { PageWallRunNowResult } from '../../../shared/pageWall'
import './pageWallWorkspace.css'

interface WallLogEntry {
  id: number
  at: string
  tone: 'info' | 'success' | 'error' | 'attention'
  message: string
}

function fileName(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

function statusLabel(status: PageWallRunNowResult['status']): string {
  if (status === 'success') return 'Thành công'
  if (status === 'needs_login') return 'Cần đăng nhập / xử lý'
  if (status === 'skipped') return 'Đã bỏ qua'
  return 'Thất bại'
}

function logTone(result: PageWallRunNowResult): WallLogEntry['tone'] {
  if (result.status === 'success') return 'success'
  if (result.status === 'needs_login' || result.code === 'publish_unconfirmed') return 'attention'
  if (result.status === 'failed') return 'error'
  return 'info'
}

export function PageWallWorkspace() {
  const [tabs, setTabs] = useState<PageTabSummary[]>([])
  const [pageTabId, setPageTabId] = useState<number | null>(null)
  const [config, setConfig] = useState<PageTabConfig | null>(null)
  const [accountId, setAccountId] = useState<number | null>(null)
  const [content, setContent] = useState('')
  const [imagePaths, setImagePaths] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<PageWallRunNowResult | null>(null)
  const [logs, setLogs] = useState<WallLogEntry[]>([])
  const logSequence = useRef(0)

  const addLog = (tone: WallLogEntry['tone'], message: string) => {
    logSequence.current += 1
    const id = logSequence.current
    setLogs((entries) => [{
      id,
      at: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      tone,
      message
    }, ...entries].slice(0, 20))
  }

  useEffect(() => {
    let cancelled = false
    void window.pageAuto.listPageTabs()
      .then((nextTabs) => {
        if (cancelled) return
        setTabs(nextTabs)
        setPageTabId((current) => current && nextTabs.some((tab) => tab.id === current)
          ? current
          : nextTabs[0]?.id ?? null)
        setError(null)
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (pageTabId === null) {
      setConfig(null)
      setAccountId(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setConfig(null)
    setAccountId(null)
    setResult(null)
    void window.pageAuto.getPageTab({ id: pageTabId })
      .then((nextConfig) => {
        if (cancelled) return
        if (!nextConfig) throw new Error('Page Tab không còn tồn tại.')
        setConfig(nextConfig)
        const runnableAccounts = nextConfig.accounts
          .filter((account) => account.enabled && account.status !== 'disabled')
          .sort((a, b) => a.sortOrder - b.sortOrder)
        setAccountId(runnableAccounts[0]?.accountId ?? null)
        setError(null)
      })
      .catch((cause) => {
        if (!cancelled) {
          setConfig(null)
          setAccountId(null)
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [pageTabId])

  const runnableAccounts = useMemo(
    () => (config?.accounts ?? [])
      .filter((account) => account.enabled && account.status !== 'disabled')
      .sort((a, b) => a.sortOrder - b.sortOrder),
    [config]
  )
  const selectedAccount = runnableAccounts.find((account) => account.accountId === accountId) ?? null
  const canRun = !busy
    && !loading
    && pageTabId !== null
    && accountId !== null
    && Boolean(config?.pageUid.trim())
    && (content.trim().length > 0 || imagePaths.length > 0)

  const pickImages = async () => {
    try {
      const picked = await window.pageAuto.pickPageWallImages()
      if (picked.length === 0) return
      setImagePaths(picked)
      addLog('info', `Đã chọn ${picked.length} ảnh cho bài Tường.`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const refreshSelectedPage = async () => {
    if (pageTabId === null) return
    const next = await window.pageAuto.getPageTab({ id: pageTabId })
    if (next) setConfig(next)
  }

  const runNow = async () => {
    if (!canRun || pageTabId === null || accountId === null) return
    setBusy(true)
    setError(null)
    setResult(null)
    addLog('info', `Bắt đầu Đăng ngay · Page ${config?.pageUid ?? '—'} · account ${selectedAccount?.uid ?? accountId}.`)
    try {
      const next = await window.pageAuto.runPageWallNow({
        pageTabId,
        accountId,
        content,
        imagePaths
      })
      setResult(next)
      addLog(logTone(next), `${statusLabel(next.status)}${next.code ? ` · ${next.code}` : ''}: ${next.message}`)
      await refreshSelectedPage().catch(() => undefined)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message)
      addLog('error', `IPC Đăng ngay lỗi: ${message}`)
    } finally {
      setBusy(false)
    }
  }

  if (loading && tabs.length === 0) {
    return <section className="page-wall-workspace page-wall-empty"><strong>Đang tải Đăng Tường…</strong></section>
  }

  if (tabs.length === 0) {
    return (
      <section className="page-wall-workspace page-wall-empty">
        <strong>Chưa có Page Tab</strong>
        <span>Tạo Page ở tab Nhóm trước; Đăng Tường dùng chung Page UID và danh sách tài khoản đó.</span>
      </section>
    )
  }

  return (
    <section className="page-business-pane page-wall-workspace" role="tabpanel" aria-label="Đăng Tường Page">
      <header className="page-wall-head">
        <div>
          <p className="eyebrow">Đăng Tường</p>
          <h2>Đăng Tường Page</h2>
          <p>Đăng trực tiếp bằng production runtime 5C. Login/2FA/checkpoint/Page switch vẫn đi qua Facebook Common.</p>
        </div>
        <span className="page-wall-live-badge">Đăng ngay đã nối</span>
      </header>

      {error ? <div className="page-tab-error page-wall-error">{error}</div> : null}

      <div className="page-wall-grid">
        <section className="page-wall-card page-wall-target-card">
          <div className="page-wall-card-head"><strong>Page + tài khoản</strong><small>Dùng chung dữ liệu Page Tab</small></div>
          <label className="page-wall-field">
            <span>Page</span>
            <select value={pageTabId ?? ''} disabled={busy} onChange={(event) => setPageTabId(Number(event.target.value))}>
              {tabs.map((tab) => <option key={tab.id} value={tab.id}>{tab.name} · {tab.pageUid}</option>)}
            </select>
          </label>
          <label className="page-wall-field">
            <span>Tài khoản chạy</span>
            <select value={accountId ?? ''} disabled={busy || loading || runnableAccounts.length === 0} onChange={(event) => setAccountId(Number(event.target.value))}>
              {runnableAccounts.length === 0 ? <option value="">Không có tài khoản bật</option> : null}
              {runnableAccounts.map((account) => (
                <option key={account.accountId} value={account.accountId}>
                  {account.uid}{account.name ? ` · ${account.name}` : ''} · {account.status}
                </option>
              ))}
            </select>
          </label>
          <div className="page-wall-target-summary">
            <span>Page UID</span><b>{config?.pageUid ?? (loading ? 'Đang tải…' : '—')}</b>
            <span>Account</span><b>{selectedAccount?.uid ?? '—'}</b>
            <span>Trạng thái</span><b className={`wall-account-${selectedAccount?.status ?? 'unknown'}`}>{selectedAccount?.status ?? '—'}</b>
          </div>
          {config && runnableAccounts.length === 0 ? <p className="page-wall-inline-warning">Page này chưa có tài khoản khả dụng đang bật. Qua tab Nhóm → Danh sách chạy để cấu hình.</p> : null}
        </section>

        <section className="page-wall-card page-wall-compose-card">
          <div className="page-wall-card-head"><strong>Nội dung bài</strong><small>{content.length.toLocaleString('vi-VN')} ký tự</small></div>
          <textarea
            className="page-wall-content"
            value={content}
            disabled={busy}
            onChange={(event) => setContent(event.target.value)}
            placeholder="Nhập nội dung cần đăng lên Tường Page…"
          />
        </section>

        <section className="page-wall-card page-wall-media-card">
          <div className="page-wall-card-head"><strong>Ảnh</strong><small>{imagePaths.length} file</small></div>
          <div className="page-wall-media-actions">
            <button className="pt-button secondary" type="button" disabled={busy} onClick={() => void pickImages()}>Chọn ảnh</button>
            <button className="pt-button secondary" type="button" disabled={busy || imagePaths.length === 0} onClick={() => setImagePaths([])}>Bỏ ảnh</button>
          </div>
          <div className="page-wall-media-list">
            {imagePaths.map((path, index) => (
              <div key={`${path}-${index}`} title={path}><span>{index + 1}</span><b>{fileName(path)}</b></div>
            ))}
            {imagePaths.length === 0 ? <p>Không chọn ảnh thì bài sẽ đăng text-only.</p> : null}
          </div>
        </section>
      </div>

      <div className="page-wall-runbar">
        <div>
          <strong>Đăng ngay</strong>
          <span>One-shot bằng 1 account. Không tự retry nếu Facebook đã nhận click nhưng chưa xác minh được bài.</span>
        </div>
        <button className="pt-button primary page-wall-run-button" type="button" disabled={!canRun} onClick={() => void runNow()}>
          {busy ? 'Đang chạy…' : loading ? 'Đang tải Page…' : '▶ Đăng ngay'}
        </button>
      </div>

      <div className="page-wall-bottom-grid">
        <section className="page-wall-card page-wall-result-card">
          <div className="page-wall-card-head"><strong>Kết quả gần nhất</strong><small>{result ? statusLabel(result.status) : 'Chưa chạy'}</small></div>
          {!result ? <p className="page-wall-muted">Kết quả publish, session và evidence sẽ hiện ở đây.</p> : (
            <div className={`page-wall-result result-${result.status}`}>
              <div><span>{statusLabel(result.status)}</span>{result.code ? <code>{result.code}</code> : null}</div>
              <p>{result.message}</p>
              {result.accountName ? <small>Account: {result.accountName}</small> : null}
              {result.publishedUrl ? <small>Published: {result.publishedUrl}</small> : null}
              {result.screenshotPath ? <small>Screenshot: {result.screenshotPath}</small> : null}
              {result.sessionValidation ? <small>Session: {result.sessionValidation.state} · {result.sessionValidation.phase}</small> : null}
              {result.code === 'publish_unconfirmed' ? (
                <strong className="page-wall-no-retry">Kiểm tra Tường Page trước khi bấm đăng lại để tránh bài trùng.</strong>
              ) : null}
            </div>
          )}
        </section>

        <section className="page-wall-card page-wall-log-card">
          <div className="page-wall-card-head"><strong>Log phiên Đăng ngay</strong><small>{logs.length}/20</small></div>
          <div className="page-wall-log">
            {logs.map((entry) => <div key={entry.id} className={`log-${entry.tone}`}><time>{entry.at}</time><span>{entry.message}</span></div>)}
            {logs.length === 0 ? <p className="page-wall-muted">Chưa có thao tác.</p> : null}
          </div>
        </section>
      </div>

      <footer className="page-wall-scope-note">
        <strong>Phạm vi hiện tại</strong>
        <span>Đăng ngay đã chạy thật qua Main → utility worker → Facebook Common → Page Wall. Hẹn giờ, danh sách bài đã hẹn và rotation nhiều account sẽ nối ở lô tiếp theo.</span>
      </footer>
    </section>
  )
}
