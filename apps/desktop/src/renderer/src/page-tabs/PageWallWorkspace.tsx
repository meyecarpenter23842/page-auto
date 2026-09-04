import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CANONICAL_CONTENT_LIBRARY_SET_ID,
  type ContentLibraryItem
} from '../../../shared/contentLibrary'
import type { PageTabConfig, PageTabSummary } from '../../../shared/pageTabs'
import type {
  PageWallCanonicalPostSelection,
  PageWallRunNowResult
} from '../../../shared/pageWall'
import type { PageWallJobRecord, PageWallJobStatus } from '../../../shared/pageWallJobs'
import './pageWallWorkspace.css'

interface WallLogEntry {
  id: number
  at: string
  tone: 'info' | 'success' | 'error' | 'attention'
  message: string
}

export interface PageWallWorkspaceProps {
  activePageId?: number
  scoped?: boolean
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

function jobStatusLabel(status: PageWallJobStatus): string {
  if (status === 'pending') return 'Chờ chạy'
  if (status === 'running') return 'Đang chạy'
  if (status === 'success') return 'Thành công'
  if (status === 'cancelled') return 'Đã hủy'
  return 'Thất bại'
}

function logTone(result: PageWallRunNowResult): WallLogEntry['tone'] {
  if (result.status === 'success') return 'success'
  if (result.status === 'needs_login' || result.code === 'publish_unconfirmed') return 'attention'
  if (result.status === 'failed') return 'error'
  return 'info'
}

function localDateTimeInput(timestamp: number): string {
  const date = new Date(timestamp)
  const shifted = new Date(timestamp - (date.getTimezoneOffset() * 60_000))
  return shifted.toISOString().slice(0, 16)
}

function formatDateTime(timestamp: number | null): string {
  if (!timestamp) return '—'
  return new Date(timestamp).toLocaleString('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  })
}

function contentPreview(job: PageWallJobRecord): string {
  const normalized = job.content.trim().replace(/\s+/g, ' ')
  if (!normalized) return `[Chỉ ảnh · ${job.imagePaths.length} file]`
  return normalized.length > 150 ? `${normalized.slice(0, 150)}…` : normalized
}

function canonicalPostId(item: ContentLibraryItem): number | null {
  if (item.contentSetId !== CANONICAL_CONTENT_LIBRARY_SET_ID) return null
  if (!Number.isSafeInteger(item.id) || item.id >= 0) return null
  return Math.abs(item.id)
}

function canonicalPreview(item: ContentLibraryItem, variantIndex: number): string {
  const value = item.variants[variantIndex]?.trim() ?? ''
  if (value) {
    const normalized = value.replace(/\s+/g, ' ')
    return normalized.length > 180 ? `${normalized.slice(0, 180)}…` : normalized
  }
  return item.image.folderPath.trim() ? 'Bài chỉ dùng ảnh.' : 'Chưa có nội dung.'
}

function imageModeLabel(mode: ContentLibraryItem['image']['mode']): string {
  if (mode === 'random') return 'Ngẫu nhiên'
  if (mode === 'filename_match') return 'Khớp Group UID'
  return 'Lần lượt'
}

function CanonicalPostPicker({
  items,
  loading,
  error,
  onClose,
  onPick
}: {
  items: ContentLibraryItem[]
  loading: boolean
  error: string | null
  onClose: () => void
  onPick: (item: ContentLibraryItem, variantIndex: number) => void
}) {
  const [search, setSearch] = useState('')
  const [variantByItem, setVariantByItem] = useState<Record<number, number>>({})
  const rows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('vi')
    if (!query) return items
    return items.filter((item) => [item.name, ...item.variants]
      .some((value) => value.toLocaleLowerCase('vi').includes(query)))
  }, [items, search])

  return (
    <div className="page-wall-library-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="page-wall-library-modal" role="dialog" aria-modal="true" aria-label="Chọn bài từ Thư viện bài viết" onMouseDown={(event) => event.stopPropagation()}>
        <header className="page-wall-library-head">
          <div>
            <p className="eyebrow">Thư viện bài viết chung</p>
            <h3>Chọn bài cho Đăng Tường</h3>
            <p>Chỉ lấy snapshot để đăng. Bài gốc không bị copy, bind hay chỉnh sửa.</p>
          </div>
          <button type="button" aria-label="Đóng" onClick={onClose}>×</button>
        </header>
        <div className="page-wall-library-toolbar">
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm tên hoặc nội dung…" />
          <span>{rows.length} bài</span>
        </div>
        {error ? <div className="page-tab-error page-wall-library-error">{error}</div> : null}
        <div className="page-wall-library-list">
          {loading ? <p className="page-wall-muted">Đang tải thư viện canonical…</p> : null}
          {!loading && rows.map((item) => {
            const postId = canonicalPostId(item)
            const variantIndex = Math.min(
              Math.max(0, variantByItem[item.id] ?? 0),
              Math.max(0, item.variants.length - 1)
            )
            const filenameMatchBlocked = Boolean(item.image.folderPath.trim()) && item.image.mode === 'filename_match'
            return (
              <article key={item.id} className={filenameMatchBlocked ? 'page-wall-library-row blocked' : 'page-wall-library-row'}>
                <div className="page-wall-library-copy">
                  <div className="page-wall-library-title"><strong>{item.name}</strong><span>{postId ? `#${postId}` : '—'}</span></div>
                  <p>{canonicalPreview(item, variantIndex)}</p>
                  <div className="page-wall-library-meta">
                    <span>{item.variants.length} biến thể</span>
                    <span>{item.image.folderPath.trim() ? `${item.image.imagesPerPost} ảnh · ${imageModeLabel(item.image.mode)}` : 'Không ảnh'}</span>
                    {filenameMatchBlocked ? <b>Ảnh Khớp Group UID không dùng cho Tường</b> : null}
                  </div>
                </div>
                <div className="page-wall-library-actions">
                  {item.variants.length > 1 ? (
                    <select
                      aria-label={`Biến thể của ${item.name}`}
                      value={variantIndex}
                      onChange={(event) => setVariantByItem((current) => ({ ...current, [item.id]: Number(event.target.value) }))}
                    >
                      {item.variants.map((_variant, index) => <option key={index} value={index}>Biến thể {index + 1}</option>)}
                    </select>
                  ) : <span>{item.variants.length === 1 ? 'Biến thể 1' : 'Chỉ ảnh'}</span>}
                  <button
                    className="pt-button primary"
                    type="button"
                    disabled={!postId || filenameMatchBlocked}
                    onClick={() => onPick(item, variantIndex)}
                  >Chọn bài</button>
                </div>
              </article>
            )
          })}
          {!loading && rows.length === 0 ? <p className="page-wall-muted">Không có bài phù hợp.</p> : null}
        </div>
        <footer><span>Run/Hẹn sẽ materialize lại source này trước khi gửi sang production runtime.</span><button className="pt-button secondary" type="button" onClick={onClose}>Đóng</button></footer>
      </section>
    </div>
  )
}

export function PageWallWorkspace({ activePageId: controlledPageId, scoped = false }: PageWallWorkspaceProps = {}) {
  const [tabs, setTabs] = useState<PageTabSummary[]>([])
  const [pageTabId, setPageTabId] = useState<number | null>(controlledPageId ?? null)
  const [config, setConfig] = useState<PageTabConfig | null>(null)
  const [accountId, setAccountId] = useState<number | null>(null)
  const [content, setContent] = useState('')
  const [imagePaths, setImagePaths] = useState<string[]>([])
  const [canonicalSelection, setCanonicalSelection] = useState<PageWallCanonicalPostSelection | null>(null)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [libraryItems, setLibraryItems] = useState<ContentLibraryItem[]>([])
  const [libraryLoading, setLibraryLoading] = useState(false)
  const [libraryError, setLibraryError] = useState<string | null>(null)
  const [scheduleAt, setScheduleAt] = useState(() => localDateTimeInput(Date.now() + (10 * 60_000)))
  const [jobs, setJobs] = useState<PageWallJobRecord[]>([])
  const [busy, setBusy] = useState(false)
  const [scheduling, setScheduling] = useState(false)
  const [cancellingJobId, setCancellingJobId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [jobsLoading, setJobsLoading] = useState(true)
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

  const refreshJobs = useCallback(async (silent = false) => {
    try {
      const next = await window.pageAuto.listPageWallJobs()
      setJobs(next)
      if (!silent) setError(null)
    } catch (cause) {
      if (!silent) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (!silent) setJobsLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void window.pageAuto.listPageTabs()
      .then((nextTabs) => {
        if (cancelled) return
        setTabs(nextTabs)
        setPageTabId((current) => {
          const requested = controlledPageId ?? current
          if (requested && nextTabs.some((tab) => tab.id === requested)) return requested
          return scoped ? null : nextTabs[0]?.id ?? null
        })
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
    if (controlledPageId === undefined) return
    setPageTabId(tabs.some((tab) => tab.id === controlledPageId) ? controlledPageId : null)
  }, [controlledPageId, tabs])

  useEffect(() => {
    void refreshJobs()
    const timer = setInterval(() => void refreshJobs(true), 3_000)
    return () => clearInterval(timer)
  }, [refreshJobs])

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
  const canonicalReady = Boolean(canonicalSelection?.content.trim() || canonicalSelection?.image.folderPath.trim())
  const materialReady = !loading
    && pageTabId !== null
    && accountId !== null
    && Boolean(config?.pageUid.trim())
    && (canonicalReady || content.trim().length > 0 || imagePaths.length > 0)
  const canRun = materialReady && !busy && !scheduling
  const scheduledTimestamp = scheduleAt ? new Date(scheduleAt).getTime() : Number.NaN
  const canSchedule = materialReady
    && !busy
    && !scheduling
    && Number.isFinite(scheduledTimestamp)
    && scheduledTimestamp > Date.now()

  const openCanonicalLibrary = async () => {
    setLibraryOpen(true)
    setLibraryLoading(true)
    setLibraryError(null)
    try {
      const library = await window.pageAuto.getContentLibrary({ id: CANONICAL_CONTENT_LIBRARY_SET_ID })
      if (!library) throw new Error('Không đọc được Thư viện bài viết chung.')
      setLibraryItems(library.items)
    } catch (cause) {
      setLibraryItems([])
      setLibraryError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLibraryLoading(false)
    }
  }

  const chooseCanonicalPost = (item: ContentLibraryItem, variantIndex: number) => {
    const postId = canonicalPostId(item)
    if (!postId) {
      setLibraryError('Bài được chọn không có Post ID canonical hợp lệ.')
      return
    }
    if (item.image.folderPath.trim() && item.image.mode === 'filename_match') {
      setLibraryError('Ảnh Khớp Group UID không áp dụng cho Đăng Tường. Hãy đổi mode ảnh của bài hoặc dùng ảnh tay.')
      return
    }
    const source: PageWallCanonicalPostSelection = {
      postId,
      postName: item.name,
      variantIndex,
      content: item.variants[variantIndex]?.trim() ?? '',
      image: {
        folderPath: item.image.folderPath,
        mode: item.image.mode,
        imagesPerPost: item.image.imagesPerPost,
        missingPolicy: item.image.missingPolicy
      }
    }
    setCanonicalSelection(source)
    setContent(source.content)
    setImagePaths([])
    setLibraryOpen(false)
    setLibraryError(null)
    addLog('info', `Đã chọn bài canonical #${postId} · ${item.name}${item.variants.length > 1 ? ` · biến thể ${variantIndex + 1}/${item.variants.length}` : ''}.`)
  }

  const pickImages = async () => {
    try {
      const picked = await window.pageAuto.pickPageWallImages()
      if (picked.length === 0) return
      setCanonicalSelection(null)
      setImagePaths(picked)
      addLog('info', `Đã chọn ${picked.length} ảnh tay cho bài Tường; nguồn canonical đã được tách thành bản nháp.`)
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
    addLog('info', `Bắt đầu Đăng ngay · Page ${config?.pageUid ?? '—'} · account ${selectedAccount?.uid ?? accountId}${canonicalSelection ? ` · canonical #${canonicalSelection.postId}` : ''}.`)
    try {
      const next = await window.pageAuto.runPageWallNow({
        pageTabId,
        accountId,
        content,
        imagePaths,
        ...(canonicalSelection ? { canonicalPost: canonicalSelection } : {})
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

  const schedulePost = async () => {
    if (!canSchedule || pageTabId === null || accountId === null) return
    setScheduling(true)
    setError(null)
    try {
      const job = await window.pageAuto.schedulePageWall({
        pageTabId,
        accountId,
        content,
        imagePaths,
        ...(canonicalSelection ? { canonicalPost: canonicalSelection } : {}),
        scheduledAt: scheduledTimestamp
      })
      addLog('success', `Đã hẹn job #${job.id} lúc ${formatDateTime(job.scheduledAt)} · Page ${job.pageUid} · account ${job.accountUid} · snapshot ${job.imagePaths.length} ảnh.`)
      await refreshJobs(true)
      setScheduleAt(localDateTimeInput(Math.max(Date.now(), job.scheduledAt) + (10 * 60_000)))
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message)
      addLog('error', `Hẹn đăng lỗi: ${message}`)
    } finally {
      setScheduling(false)
    }
  }

  const cancelJob = async (jobId: number) => {
    setCancellingJobId(jobId)
    setError(null)
    try {
      const cancelled = await window.pageAuto.cancelPageWallJob({ jobId })
      addLog('info', `Đã hủy job #${cancelled.id} trước khi chạy.`)
      await refreshJobs(true)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message)
      addLog('error', `Hủy job #${jobId} lỗi: ${message}`)
    } finally {
      setCancellingJobId(null)
    }
  }

  if (loading && tabs.length === 0) {
    return <section className="page-wall-workspace page-wall-empty"><strong>Đang tải Đăng Tường…</strong></section>
  }

  if (tabs.length === 0) {
    return (
      <section className="page-wall-workspace page-wall-empty">
        <strong>Chưa có Page Tab</strong>
        <span>Tạo Page trong Quản lý Page trước; Đăng Tường dùng chung Page UID và danh sách tài khoản canonical.</span>
      </section>
    )
  }

  return (
    <section className="page-business-pane page-wall-workspace" role="tabpanel" aria-label="Đăng Tường Page">
      <header className="page-wall-head">
        <div>
          <p className="eyebrow">Đăng Tường</p>
          <h2>Đăng Tường Page</h2>
          <p>Đăng ngay hoặc hẹn giờ bằng cùng production runtime. Login/2FA/checkpoint/Page switch vẫn đi qua Facebook Common.</p>
        </div>
        <span className="page-wall-live-badge">Đăng ngay + Hẹn giờ</span>
      </header>

      {error ? <div className="page-tab-error page-wall-error">{error}</div> : null}

      <div className="page-wall-grid">
        <section className="page-wall-card page-wall-target-card">
          <div className="page-wall-card-head"><strong>Page + tài khoản</strong><small>Dùng chung dữ liệu Page canonical</small></div>
          <label className="page-wall-field">
            <span>Page</span>
            <select value={pageTabId ?? ''} disabled={scoped || busy || scheduling} onChange={(event) => setPageTabId(Number(event.target.value))}>
              {tabs.map((tab) => <option key={tab.id} value={tab.id}>{tab.name} · {tab.pageUid}</option>)}
            </select>
          </label>
          <label className="page-wall-field">
            <span>Tài khoản chạy</span>
            <select value={accountId ?? ''} disabled={busy || scheduling || loading || runnableAccounts.length === 0} onChange={(event) => setAccountId(Number(event.target.value))}>
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
          {config && runnableAccounts.length === 0 ? <p className="page-wall-inline-warning">Page này chưa có tài khoản khả dụng đang bật. Cập nhật danh sách account canonical của Page để chạy.</p> : null}
        </section>

        <section className="page-wall-card page-wall-compose-card">
          <div className="page-wall-card-head page-wall-compose-head">
            <div><strong>Nội dung bài</strong><small>{content.length.toLocaleString('vi-VN')} ký tự</small></div>
            <button className="pt-button secondary" type="button" disabled={busy || scheduling} onClick={() => void openCanonicalLibrary()}>Chọn từ thư viện</button>
          </div>
          {canonicalSelection ? (
            <div className="page-wall-canonical-source">
              <div><span>CANONICAL</span><strong>#{canonicalSelection.postId} · {canonicalSelection.postName}</strong><small>Biến thể {canonicalSelection.variantIndex + 1}</small></div>
              <button type="button" disabled={busy || scheduling} onClick={() => setCanonicalSelection(null)}>Chuyển nhập tay</button>
            </div>
          ) : null}
          <textarea
            className="page-wall-content"
            value={content}
            disabled={busy || scheduling}
            onChange={(event) => {
              if (canonicalSelection) setCanonicalSelection(null)
              setContent(event.target.value)
            }}
            placeholder="Nhập nội dung cần đăng lên Tường Page…"
          />
        </section>

        <section className="page-wall-card page-wall-media-card">
          <div className="page-wall-card-head"><strong>Ảnh</strong><small>{canonicalSelection?.image.folderPath.trim() ? 'Từ bài canonical' : `${imagePaths.length} file`}</small></div>
          <div className="page-wall-media-actions">
            <button className="pt-button secondary" type="button" disabled={busy || scheduling} onClick={() => void pickImages()}>Chọn ảnh tay</button>
            <button
              className="pt-button secondary"
              type="button"
              disabled={busy || scheduling || (!canonicalSelection?.image.folderPath.trim() && imagePaths.length === 0)}
              onClick={() => { setCanonicalSelection(null); setImagePaths([]) }}
            >Bỏ ảnh</button>
          </div>
          {canonicalSelection?.image.folderPath.trim() ? (
            <div className="page-wall-canonical-media">
              <span>Folder canonical</span>
              <b title={canonicalSelection.image.folderPath}>{canonicalSelection.image.folderPath}</b>
              <small>{canonicalSelection.image.imagesPerPost} ảnh · {imageModeLabel(canonicalSelection.image.mode)} · snapshot khi Đăng/Hẹn</small>
            </div>
          ) : (
            <div className="page-wall-media-list">
              {imagePaths.map((path, index) => (
                <div key={`${path}-${index}`} title={path}><span>{index + 1}</span><b>{fileName(path)}</b></div>
              ))}
              {imagePaths.length === 0 ? <p>Không chọn ảnh thì bài sẽ đăng text-only.</p> : null}
            </div>
          )}
        </section>
      </div>

      <div className="page-wall-action-grid">
        <div className="page-wall-runbar">
          <div>
            <strong>Đăng ngay</strong>
            <span>One-shot bằng 1 account. Không tự retry khi publish chưa xác minh để tránh bài trùng.</span>
          </div>
          <button className="pt-button primary page-wall-run-button" type="button" disabled={!canRun} onClick={() => void runNow()}>
            {busy ? 'Đang chạy…' : loading ? 'Đang tải Page…' : '▶ Đăng ngay'}
          </button>
        </div>

        <div className="page-wall-runbar page-wall-schedulebar">
          <div>
            <strong>Hẹn đăng</strong>
            <span>Persist SQLite; material được snapshot trước khi lưu job, không đọc lại thư viện lúc đến giờ.</span>
          </div>
          <div className="page-wall-schedule-controls">
            <input
              type="datetime-local"
              value={scheduleAt}
              min={localDateTimeInput(Date.now() + 60_000)}
              disabled={busy || scheduling}
              onChange={(event) => setScheduleAt(event.target.value)}
              aria-label="Ngày giờ hẹn đăng"
            />
            <button className="pt-button primary page-wall-run-button" type="button" disabled={!canSchedule} onClick={() => void schedulePost()}>
              {scheduling ? 'Đang lưu…' : '⏱ Hẹn đăng'}
            </button>
          </div>
        </div>
      </div>

      <div className="page-wall-bottom-grid">
        <section className="page-wall-card page-wall-result-card">
          <div className="page-wall-card-head"><strong>Kết quả Đăng ngay gần nhất</strong><small>{result ? statusLabel(result.status) : 'Chưa chạy'}</small></div>
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
          <div className="page-wall-card-head"><strong>Log thao tác</strong><small>{logs.length}/20</small></div>
          <div className="page-wall-log">
            {logs.map((entry) => <div key={entry.id} className={`log-${entry.tone}`}><time>{entry.at}</time><span>{entry.message}</span></div>)}
            {logs.length === 0 ? <p className="page-wall-muted">Chưa có thao tác.</p> : null}
          </div>
        </section>
      </div>

      <section className="page-wall-card page-wall-jobs-card">
        <div className="page-wall-card-head">
          <strong>Danh sách bài đã hẹn</strong>
          <div className="page-wall-jobs-head-actions">
            <small>{jobsLoading ? 'Đang tải…' : `${jobs.length} job`}</small>
            <button className="pt-button secondary" type="button" disabled={jobsLoading} onClick={() => void refreshJobs()}>Làm mới</button>
          </div>
        </div>
        <div className="page-wall-jobs-list">
          {jobs.map((job) => (
            <article key={job.id} className={`page-wall-job job-${job.status}`}>
              <div className="page-wall-job-main">
                <div className="page-wall-job-title">
                  <span className={`page-wall-job-status status-${job.status}`}>{jobStatusLabel(job.status)}</span>
                  <b>#{job.id}</b>
                  <time>{formatDateTime(job.scheduledAt)}</time>
                </div>
                <p>{contentPreview(job)}</p>
                <div className="page-wall-job-meta">
                  <span>Page <b>{job.pageTabName}</b> · {job.pageUid}</span>
                  <span>Account <b>{job.accountUid}</b>{job.accountName ? ` · ${job.accountName}` : ''}</span>
                  <span>Ảnh <b>{job.imagePaths.length}</b></span>
                </div>
              </div>
              <div className="page-wall-job-result">
                {job.resultMessage ? <span className="job-result-message">{job.resultMessage}</span> : <span className="page-wall-muted">Chưa có result.</span>}
                {job.resultCode ? <code>{job.resultCode}</code> : null}
                {job.publishedUrl ? <small>Published: {job.publishedUrl}</small> : null}
                {job.screenshotPath ? <small>Screenshot: {job.screenshotPath}</small> : null}
                {job.tracePath ? <small>Trace: {job.tracePath}</small> : null}
                {job.sessionValidation ? <small>Session: {job.sessionValidation.state} · {job.sessionValidation.phase}</small> : null}
                <details>
                  <summary>Log job ({job.logs.length})</summary>
                  <div className="page-wall-job-logs">
                    {job.logs.slice(-5).reverse().map((entry) => (
                      <div key={`${entry.at}-${entry.message}`}><time>{formatDateTime(entry.at)}</time><span>{entry.message}</span></div>
                    ))}
                  </div>
                </details>
              </div>
              <div className="page-wall-job-actions">
                {job.status === 'pending' ? (
                  <button className="pt-button secondary" type="button" disabled={cancellingJobId === job.id} onClick={() => void cancelJob(job.id)}>
                    {cancellingJobId === job.id ? 'Đang hủy…' : 'Hủy job'}
                  </button>
                ) : <small>{job.finishedAt ? `Kết thúc ${formatDateTime(job.finishedAt)}` : job.startedAt ? `Bắt đầu ${formatDateTime(job.startedAt)}` : '—'}</small>}
              </div>
            </article>
          ))}
          {!jobsLoading && jobs.length === 0 ? <p className="page-wall-muted">Chưa có bài hẹn. Chọn ngày/giờ rồi bấm Hẹn đăng.</p> : null}
        </div>
      </section>

      <footer className="page-wall-scope-note">
        <strong>Lifecycle</strong>
        <span>Đăng ngay và Hẹn giờ đều là one-shot rõ ràng; Chrome đóng sau kết quả bình thường. Login/checkpoint cần thao tác tay vẫn giữ browser. Group rotation giữ nguyên lifecycle riêng.</span>
      </footer>

      {libraryOpen ? (
        <CanonicalPostPicker
          items={libraryItems}
          loading={libraryLoading}
          error={libraryError}
          onClose={() => setLibraryOpen(false)}
          onPick={chooseCanonicalPost}
        />
      ) : null}
    </section>
  )
}
