import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ActionWorkspaceRecord } from '../../../shared/actionWorkspaces'
import {
  pageBusinessPageIdOf,
  pageBusinessTypeOf,
  parsePageWallBusinessSchedule,
  serializePageWallBusinessSchedule
} from '../../../shared/pageBusinessBindings'
import {
  CANONICAL_CONTENT_LIBRARY_SET_ID,
  type ContentLibraryItem
} from '../../../shared/contentLibrary'
import type { PageTabConfig, PageTabSchedule, PageTabSummary } from '../../../shared/pageTabs'
import type {
  PageWallCanonicalPostSelection,
  PageWallRunNowResult
} from '../../../shared/pageWall'
import type { PageWallJobRecord, PageWallJobStatus } from '../../../shared/pageWallJobs'
import {
  collapseEveryDaySchedules,
  EVERY_DAY_SCHEDULE,
  expandEveryDaySchedules
} from './scheduleEditor'
import './pageWallWorkspace.css'
import './pageWallCommonFrame.css'

interface WallLogEntry {
  id: number
  at: string
  tone: 'info' | 'success' | 'error' | 'attention'
  message: string
}

type WallMode = 'now' | 'once' | 'recurring'

export interface PageWallWorkspaceProps {
  activePageId?: number
  scoped?: boolean
}

const DAY_LABELS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']

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

function minuteToTime(value: number): string {
  const safe = Math.max(0, Math.min(1439, Math.round(value)))
  const hours = Math.floor(safe / 60)
  const minutes = safe % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function timeToMinute(value: string, fallback: number): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value)
  if (!match) return fallback
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return fallback
  return hours * 60 + minutes
}

function editorSchedules(binding: ActionWorkspaceRecord | null): PageTabSchedule[] {
  const schedule = binding ? parsePageWallBusinessSchedule(binding.configJson) : null
  if (!schedule || schedule.schedules.length === 0) {
    return [{ id: -1, dayOfWeek: EVERY_DAY_SCHEDULE, startMinute: 8 * 60, endMinute: 18 * 60, enabled: true, sortOrder: 0 }]
  }
  return collapseEveryDaySchedules(schedule.schedules.map((item, index) => ({ id: -(index + 1), ...item })))
}

function ModalShell({ label, title, subtitle, onClose, children }: {
  label: string
  title: string
  subtitle?: string
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <div className="page-wall-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="page-wall-modal" role="dialog" aria-modal="true" aria-label={label} onMouseDown={(event) => event.stopPropagation()}>
        <header className="page-wall-modal-head">
          <div><h3>{title}</h3>{subtitle ? <p>{subtitle}</p> : null}</div>
          <button type="button" aria-label="Đóng" onClick={onClose}>×</button>
        </header>
        {children}
      </section>
    </div>
  )
}

function CanonicalPostPicker({ items, loading, error, onClose, onPick }: {
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
    return items.filter((item) => [item.name, ...item.variants].some((value) => value.toLocaleLowerCase('vi').includes(query)))
  }, [items, search])

  return (
    <div className="page-wall-library-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="page-wall-library-modal" role="dialog" aria-modal="true" aria-label="Chọn bài từ Thư viện bài viết" onMouseDown={(event) => event.stopPropagation()}>
        <header className="page-wall-library-head">
          <div><p className="eyebrow">Thư viện bài viết chung</p><h3>Chọn bài cho Đăng Tường</h3><p>Chỉ lấy source canonical; Main materialize trước mỗi lần chạy/hẹn.</p></div>
          <button type="button" aria-label="Đóng" onClick={onClose}>×</button>
        </header>
        <div className="page-wall-library-toolbar"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm tên hoặc nội dung…" /><span>{rows.length} bài</span></div>
        {error ? <div className="page-tab-error page-wall-library-error">{error}</div> : null}
        <div className="page-wall-library-list">
          {loading ? <p className="page-wall-muted">Đang tải thư viện canonical…</p> : null}
          {!loading && rows.map((item) => {
            const postId = canonicalPostId(item)
            const variantIndex = Math.min(Math.max(0, variantByItem[item.id] ?? 0), Math.max(0, item.variants.length - 1))
            const filenameMatchBlocked = Boolean(item.image.folderPath.trim()) && item.image.mode === 'filename_match'
            return (
              <article key={item.id} className={filenameMatchBlocked ? 'page-wall-library-row blocked' : 'page-wall-library-row'}>
                <div className="page-wall-library-copy">
                  <div className="page-wall-library-title"><strong>{item.name}</strong><span>{postId ? `#${postId}` : '—'}</span></div>
                  <p>{canonicalPreview(item, variantIndex)}</p>
                  <div className="page-wall-library-meta"><span>{item.variants.length} biến thể</span><span>{item.image.folderPath.trim() ? `${item.image.imagesPerPost} ảnh · ${imageModeLabel(item.image.mode)}` : 'Không ảnh'}</span>{filenameMatchBlocked ? <b>Ảnh Khớp Group UID không dùng cho Tường</b> : null}</div>
                </div>
                <div className="page-wall-library-actions">
                  {item.variants.length > 1 ? <select aria-label={`Biến thể của ${item.name}`} value={variantIndex} onChange={(event) => setVariantByItem((current) => ({ ...current, [item.id]: Number(event.target.value) }))}>{item.variants.map((_variant, index) => <option key={index} value={index}>Biến thể {index + 1}</option>)}</select> : <span>{item.variants.length === 1 ? 'Biến thể 1' : 'Chỉ ảnh'}</span>}
                  <button className="pt-button primary" type="button" disabled={!postId || filenameMatchBlocked} onClick={() => onPick(item, variantIndex)}>Chọn bài</button>
                </div>
              </article>
            )
          })}
          {!loading && rows.length === 0 ? <p className="page-wall-muted">Không có bài phù hợp.</p> : null}
        </div>
        <footer><span>Không tạo post store/binding mới.</span><button className="pt-button secondary" type="button" onClick={onClose}>Đóng</button></footer>
      </section>
    </div>
  )
}

export function PageWallWorkspace({ activePageId: controlledPageId, scoped = false }: PageWallWorkspaceProps = {}) {
  const [tabs, setTabs] = useState<PageTabSummary[]>([])
  const [pageTabId, setPageTabId] = useState<number | null>(controlledPageId ?? null)
  const [config, setConfig] = useState<PageTabConfig | null>(null)
  const [binding, setBinding] = useState<ActionWorkspaceRecord | null>(null)
  const [mode, setMode] = useState<WallMode>('now')
  const [content, setContent] = useState('')
  const [imagePaths, setImagePaths] = useState<string[]>([])
  const [canonicalSelection, setCanonicalSelection] = useState<PageWallCanonicalPostSelection | null>(null)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [libraryItems, setLibraryItems] = useState<ContentLibraryItem[]>([])
  const [libraryLoading, setLibraryLoading] = useState(false)
  const [libraryError, setLibraryError] = useState<string | null>(null)
  const [scheduleAt, setScheduleAt] = useState(() => localDateTimeInput(Date.now() + (10 * 60_000)))
  const [recurringEnabled, setRecurringEnabled] = useState(false)
  const [scheduleDrafts, setScheduleDrafts] = useState<PageTabSchedule[]>(() => editorSchedules(null))
  const [jobsOpen, setJobsOpen] = useState(false)
  const [logsOpen, setLogsOpen] = useState(false)
  const [jobs, setJobs] = useState<PageWallJobRecord[]>([])
  const [busy, setBusy] = useState(false)
  const [scheduling, setScheduling] = useState(false)
  const [savingRecurring, setSavingRecurring] = useState(false)
  const [cancellingJobId, setCancellingJobId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [jobsLoading, setJobsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<PageWallRunNowResult | null>(null)
  const [logs, setLogs] = useState<WallLogEntry[]>([])
  const logSequence = useRef(0)
  const draftSequence = useRef(-10_000)

  const addLog = (tone: WallLogEntry['tone'], message: string) => {
    logSequence.current += 1
    const id = logSequence.current
    setLogs((entries) => [{ id, at: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }), tone, message }, ...entries].slice(0, 50))
  }

  const refreshJobs = useCallback(async (silent = false) => {
    try {
      setJobs(await window.pageAuto.listPageWallJobs())
      if (!silent) setError(null)
    } catch (cause) {
      if (!silent) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (!silent) setJobsLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void window.pageAuto.listPageTabs().then((nextTabs) => {
      if (cancelled) return
      setTabs(nextTabs)
      setPageTabId((current) => {
        const requested = controlledPageId ?? current
        if (requested && nextTabs.some((tab) => tab.id === requested)) return requested
        return scoped ? null : nextTabs[0]?.id ?? null
      })
      setError(null)
    }).catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause)) }).finally(() => { if (!cancelled) setLoading(false) })
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
      setBinding(null)
      setRecurringEnabled(false)
      setScheduleDrafts(editorSchedules(null))
      return
    }
    let cancelled = false
    setLoading(true)
    setConfig(null)
    setBinding(null)
    setResult(null)
    setMode('now')
    setJobsOpen(false)
    setLogsOpen(false)
    void Promise.all([window.pageAuto.getPageTab({ id: pageTabId }), window.pageAuto.listActionWorkspaces()])
      .then(([nextConfig, workspaces]) => {
        if (cancelled) return
        if (!nextConfig) throw new Error('Page Tab không còn tồn tại.')
        const nextBinding = workspaces.find((workspace) => pageBusinessTypeOf(workspace) === 'page_wall_post' && pageBusinessPageIdOf(workspace) === pageTabId) ?? null
        if (!nextBinding) throw new Error('Không tìm thấy binding Đăng Tường của Page hiện tại.')
        const savedSchedule = parsePageWallBusinessSchedule(nextBinding.configJson)
        setConfig(nextConfig)
        setBinding(nextBinding)
        setRecurringEnabled(savedSchedule?.enabled ?? false)
        setScheduleDrafts(editorSchedules(nextBinding))
        setError(null)
      }).catch((cause) => {
        if (!cancelled) {
          setConfig(null)
          setBinding(null)
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [pageTabId])

  const allAccounts = useMemo(() => [...(config?.accounts ?? [])].sort((a, b) => a.sortOrder - b.sortOrder), [config])
  const runnableAccounts = useMemo(() => allAccounts.filter((account) => account.enabled && account.status !== 'disabled'), [allAccounts])
  const primaryAccount = runnableAccounts[0] ?? null
  const currentJobs = useMemo(() => jobs.filter((job) => job.pageTabId === pageTabId), [jobs, pageTabId])
  const savedRecurring = useMemo(() => binding ? parsePageWallBusinessSchedule(binding.configJson) : null, [binding])
  const canonicalReady = Boolean(canonicalSelection?.content.trim() || canonicalSelection?.image.folderPath.trim())
  const materialReady = !loading && pageTabId !== null && primaryAccount !== null && Boolean(config?.pageUid.trim()) && (canonicalReady || content.trim().length > 0 || imagePaths.length > 0)
  const operationBusy = busy || scheduling || savingRecurring
  const canRun = materialReady && !operationBusy
  const scheduledTimestamp = scheduleAt ? new Date(scheduleAt).getTime() : Number.NaN
  const canSchedule = materialReady && !operationBusy && Number.isFinite(scheduledTimestamp) && scheduledTimestamp > Date.now()

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
    } finally { setLibraryLoading(false) }
  }

  const chooseCanonicalPost = (item: ContentLibraryItem, variantIndex: number) => {
    const postId = canonicalPostId(item)
    if (!postId) { setLibraryError('Bài được chọn không có Post ID canonical hợp lệ.'); return }
    if (item.image.folderPath.trim() && item.image.mode === 'filename_match') {
      setLibraryError('Ảnh Khớp Group UID không áp dụng cho Đăng Tường. Hãy đổi mode ảnh của bài hoặc dùng ảnh tay.')
      return
    }
    const source: PageWallCanonicalPostSelection = {
      postId,
      postName: item.name,
      variantIndex,
      content: item.variants[variantIndex]?.trim() ?? '',
      image: { folderPath: item.image.folderPath, mode: item.image.mode, imagesPerPost: item.image.imagesPerPost, missingPolicy: item.image.missingPolicy }
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
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }

  const refreshSelectedPage = async () => {
    if (pageTabId === null) return
    const next = await window.pageAuto.getPageTab({ id: pageTabId })
    if (next) setConfig(next)
  }

  const runNow = async () => {
    if (!canRun || pageTabId === null) return
    setBusy(true)
    setError(null)
    setResult(null)
    addLog('info', `Bắt đầu Đăng ngay · Page ${config?.pageUid ?? '—'} · account canonical ${primaryAccount?.uid ?? '—'}${canonicalSelection ? ` · canonical #${canonicalSelection.postId}` : ''}.`)
    try {
      const next = await window.pageAuto.runPageWallNow({ pageTabId, content, imagePaths, ...(canonicalSelection ? { canonicalPost: canonicalSelection } : {}) })
      setResult(next)
      addLog(logTone(next), `${statusLabel(next.status)}${next.code ? ` · ${next.code}` : ''}: ${next.message}`)
      await refreshSelectedPage().catch(() => undefined)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message)
      addLog('error', `IPC Đăng ngay lỗi: ${message}`)
    } finally { setBusy(false) }
  }

  const schedulePost = async () => {
    if (!canSchedule || pageTabId === null) return
    setScheduling(true)
    setError(null)
    try {
      const job = await window.pageAuto.schedulePageWall({ pageTabId, content, imagePaths, ...(canonicalSelection ? { canonicalPost: canonicalSelection } : {}), scheduledAt: scheduledTimestamp })
      addLog('success', `Đã hẹn job #${job.id} lúc ${formatDateTime(job.scheduledAt)} · account snapshot ${job.accountUid} · ${job.imagePaths.length} ảnh.`)
      await refreshJobs(true)
      setScheduleAt(localDateTimeInput(Math.max(Date.now(), job.scheduledAt) + (10 * 60_000)))
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message)
      addLog('error', `Hẹn đăng lỗi: ${message}`)
    } finally { setScheduling(false) }
  }

  const saveRecurring = async () => {
    if (!materialReady || pageTabId === null || !binding) return
    setSavingRecurring(true)
    setError(null)
    try {
      const configJson = serializePageWallBusinessSchedule(binding.configJson, {
        enabled: recurringEnabled,
        content,
        imagePaths,
        ...(canonicalSelection ? { canonicalPost: canonicalSelection } : {}),
        schedules: expandEveryDaySchedules(scheduleDrafts)
      })
      const updated = await window.pageAuto.updateActionWorkspace({ id: binding.id, patch: { configJson } })
      setBinding(updated)
      setScheduleDrafts(editorSchedules(updated))
      addLog('success', `Đã lưu Lịch chạy Tường trong binding page_wall_post · ${recurringEnabled ? 'Bật' : 'Tắt'}.`)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message)
      addLog('error', `Lưu Lịch chạy lỗi: ${message}`)
    } finally { setSavingRecurring(false) }
  }

  const clearRecurring = async () => {
    if (!binding || savingRecurring) return
    setSavingRecurring(true)
    setError(null)
    try {
      const updated = await window.pageAuto.updateActionWorkspace({ id: binding.id, patch: { configJson: serializePageWallBusinessSchedule(binding.configJson, null) } })
      setBinding(updated)
      setRecurringEnabled(false)
      setScheduleDrafts(editorSchedules(null))
      addLog('info', 'Đã xóa config Lịch chạy Tường khỏi binding. Concrete jobs đã tạo vẫn giữ nguyên để audit/no-duplicate.')
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message)
      addLog('error', `Xóa Lịch chạy lỗi: ${message}`)
    } finally { setSavingRecurring(false) }
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
    } finally { setCancellingJobId(null) }
  }

  const updateScheduleDraft = (id: number, patch: Partial<PageTabSchedule>) => {
    setScheduleDrafts((current) => current.map((schedule) => schedule.id === id ? { ...schedule, ...patch } : schedule))
  }

  const addScheduleDraft = () => {
    draftSequence.current -= 1
    setScheduleDrafts((current) => [...current, { id: draftSequence.current, dayOfWeek: EVERY_DAY_SCHEDULE, startMinute: 8 * 60, endMinute: 18 * 60, enabled: true, sortOrder: current.length }])
  }

  const removeScheduleDraft = (id: number) => {
    setScheduleDrafts((current) => current.filter((schedule) => schedule.id !== id).map((schedule, sortOrder) => ({ ...schedule, sortOrder })))
  }

  if (loading && tabs.length === 0) return <section className="page-wall-workspace page-wall-empty"><strong>Đang tải Đăng Tường…</strong></section>
  if (tabs.length === 0) return <section className="page-wall-workspace page-wall-empty"><strong>Chưa có Page Tab</strong><span>Tạo Page trong Quản lý Page trước; Đăng Tường dùng chung Page UID và account canonical.</span></section>

  return (
    <section className="page-business-pane page-wall-workspace page-wall-common-frame" role="tabpanel" aria-label="Đăng Tường Page">
      <header className="page-wall-head">
        <div><p className="eyebrow">Đăng Tường</p><h2>Đăng Tường Page</h2><p>Account lấy từ khung Page chung; Wall chỉ giữ bài, ảnh và chế độ chạy.</p></div>
        <span className={`page-wall-live-badge ${savedRecurring?.enabled ? 'active' : ''}`}>{savedRecurring?.enabled ? 'Lịch chạy đang bật' : 'Page common frame'}</span>
      </header>

      {error ? <div className="page-tab-error page-wall-error">{error}</div> : null}
      {!scoped ? <label className="page-wall-field page-wall-standalone-page"><span>Page</span><select value={pageTabId ?? ''} disabled={operationBusy} onChange={(event) => setPageTabId(Number(event.target.value))}>{tabs.map((tab) => <option key={tab.id} value={tab.id}>{tab.name} · {tab.pageUid}</option>)}</select></label> : null}
      {config && !primaryAccount ? <p className="page-wall-inline-warning">Page này chưa có tài khoản canonical khả dụng đang bật. Hãy chỉnh trong khung tài khoản Page chung.</p> : null}

      <div className="page-wall-grid page-wall-content-grid">
        <section className="page-wall-card page-wall-compose-card">
          <div className="page-wall-card-head page-wall-compose-head"><div><strong>Nội dung bài</strong><small>{content.length.toLocaleString('vi-VN')} ký tự</small></div><button className="pt-button secondary" type="button" disabled={operationBusy} onClick={() => void openCanonicalLibrary()}>Chọn từ thư viện</button></div>
          {canonicalSelection ? <div className="page-wall-canonical-source"><div><span>CANONICAL</span><strong>#{canonicalSelection.postId} · {canonicalSelection.postName}</strong><small>Biến thể {canonicalSelection.variantIndex + 1}</small></div><button type="button" disabled={operationBusy} onClick={() => setCanonicalSelection(null)}>Chuyển nhập tay</button></div> : null}
          <textarea className="page-wall-content" value={content} disabled={operationBusy} onChange={(event) => { if (canonicalSelection) setCanonicalSelection(null); setContent(event.target.value) }} placeholder="Nhập nội dung cần đăng lên Tường Page…" />
        </section>

        <section className="page-wall-card page-wall-media-card">
          <div className="page-wall-card-head"><strong>Ảnh</strong><small>{canonicalSelection?.image.folderPath.trim() ? 'Canonical' : `${imagePaths.length} file`}</small></div>
          <div className="page-wall-media-actions"><button className="pt-button secondary" type="button" disabled={operationBusy} onClick={() => void pickImages()}>Chọn ảnh tay</button><button className="pt-button secondary" type="button" disabled={operationBusy || (!canonicalSelection?.image.folderPath.trim() && imagePaths.length === 0)} onClick={() => { setCanonicalSelection(null); setImagePaths([]) }}>Bỏ ảnh</button></div>
          {canonicalSelection?.image.folderPath.trim() ? <div className="page-wall-canonical-media"><span>Folder canonical</span><b title={canonicalSelection.image.folderPath}>{canonicalSelection.image.folderPath}</b><small>{canonicalSelection.image.imagesPerPost} ảnh · {imageModeLabel(canonicalSelection.image.mode)} · concrete snapshot trước job</small></div> : <div className="page-wall-media-list">{imagePaths.map((path, index) => <div key={`${path}-${index}`} title={path}><span>{index + 1}</span><b>{fileName(path)}</b></div>)}{imagePaths.length === 0 ? <p>Không ảnh = text-only.</p> : null}</div>}
        </section>
      </div>

      <section className="page-wall-mode-shell" aria-label="Chế độ Đăng Tường">
        <div className="page-wall-mode-selector" role="tablist" aria-label="Chọn chế độ chạy">
          <button type="button" role="tab" aria-selected={mode === 'now'} className={mode === 'now' ? 'active' : ''} onClick={() => setMode('now')}>Đăng ngay</button>
          <button type="button" role="tab" aria-selected={mode === 'once'} className={mode === 'once' ? 'active' : ''} onClick={() => setMode('once')}>Hẹn 1 lần</button>
          <button type="button" role="tab" aria-selected={mode === 'recurring'} className={mode === 'recurring' ? 'active' : ''} onClick={() => setMode('recurring')}>Lịch chạy{savedRecurring?.enabled ? ' · Bật' : ''}</button>
        </div>

        {mode === 'now' ? <div className="page-wall-mode-panel mode-now"><div><strong>Đăng ngay</strong><span>Dùng bài hiện tại và account canonical đầu tiên đang bật của Page.</span></div><div className="page-wall-mode-account"><span>Account runtime</span><b>{primaryAccount?.uid ?? 'Chưa có'}</b></div><button className="pt-button primary" type="button" disabled={!canRun} onClick={() => void runNow()}>{busy ? 'Đang chạy…' : '▶ Bắt đầu đăng'}</button></div> : null}

        {mode === 'once' ? <div className="page-wall-mode-panel mode-once"><div className="page-wall-mode-copy"><strong>Hẹn 1 lần</strong><span>Concrete snapshot được tạo ngay khi xác nhận hẹn.</span></div><label><span>Ngày giờ chạy</span><input type="datetime-local" value={scheduleAt} min={localDateTimeInput(Date.now() + 60_000)} disabled={operationBusy} onChange={(event) => setScheduleAt(event.target.value)} aria-label="Ngày giờ hẹn đăng" /></label><div className="page-wall-mode-account"><span>Account snapshot</span><b>{primaryAccount?.uid ?? 'Chưa có'}</b></div><button className="pt-button primary" type="button" disabled={!canSchedule} onClick={() => void schedulePost()}>{scheduling ? 'Đang lưu…' : 'Xác nhận hẹn'}</button></div> : null}

        {mode === 'recurring' ? <div className="page-wall-mode-panel mode-recurring">
          <div className="page-wall-recurring-top"><label className="page-wall-switch"><input type="checkbox" checked={recurringEnabled} onChange={(event) => setRecurringEnabled(event.target.checked)} /><span>Bật Lịch chạy</span></label><span>{savedRecurring ? `Binding lưu ${formatDateTime(binding?.updatedAt ?? null)}` : 'Chưa có lịch Wall'}</span></div>
          <div className="page-wall-schedule-table"><div className="page-wall-schedule-head"><span>Bật</span><span>Ngày</span><span>Từ</span><span>Đến</span><span></span></div>{scheduleDrafts.map((schedule) => <div className="page-wall-schedule-row" key={schedule.id}><input type="checkbox" checked={schedule.enabled} onChange={(event) => updateScheduleDraft(schedule.id, { enabled: event.target.checked })} aria-label={`Bật khung ${schedule.sortOrder + 1}`} /><select value={schedule.dayOfWeek} onChange={(event) => updateScheduleDraft(schedule.id, { dayOfWeek: Number(event.target.value) })} aria-label={`Ngày khung ${schedule.sortOrder + 1}`}><option value={EVERY_DAY_SCHEDULE}>Mỗi ngày</option>{DAY_LABELS.map((label, day) => <option key={day} value={day}>{label}</option>)}</select><input type="time" value={minuteToTime(schedule.startMinute)} onChange={(event) => updateScheduleDraft(schedule.id, { startMinute: timeToMinute(event.target.value, schedule.startMinute) })} aria-label={`Giờ bắt đầu khung ${schedule.sortOrder + 1}`} /><input type="time" value={minuteToTime(schedule.endMinute)} onChange={(event) => updateScheduleDraft(schedule.id, { endMinute: timeToMinute(event.target.value, schedule.endMinute) })} aria-label={`Giờ kết thúc khung ${schedule.sortOrder + 1}`} /><button type="button" aria-label={`Xóa khung ${schedule.sortOrder + 1}`} disabled={scheduleDrafts.length <= 1} onClick={() => removeScheduleDraft(schedule.id)}>×</button></div>)}</div>
          <div className="page-wall-recurring-actions"><button className="pt-button secondary page-wall-add-window" type="button" onClick={addScheduleDraft}>+ Khung giờ</button><span>Account được resolve lại từ Page canonical khi occurrence materialize; concrete job sau đó bất biến.</span>{savedRecurring ? <button className="pt-button danger" type="button" disabled={savingRecurring} onClick={() => void clearRecurring()}>Xóa lịch Wall</button> : null}<button className="pt-button primary" type="button" disabled={!materialReady || savingRecurring} onClick={() => void saveRecurring()}>{savingRecurring ? 'Đang lưu…' : 'Lưu Lịch chạy'}</button></div>
        </div> : null}
      </section>

      <div className="page-wall-secondary-tools" aria-label="Công cụ quản lý Đăng Tường"><button className="pt-button secondary" type="button" onClick={() => { setJobsOpen(true); void refreshJobs() }}>Lịch đã hẹn <span className="page-wall-count">{currentJobs.filter((job) => job.status === 'pending' || job.status === 'running').length}</span></button><button className="pt-button secondary" type="button" onClick={() => setLogsOpen(true)}>Log <span className="page-wall-count">{logs.length}</span></button><div><span>Page <b>{config?.pageUid || '—'}</b></span><span>Account chung <b>{primaryAccount?.uid || '—'}</b></span></div></div>

      <div className={`page-wall-result-strip${result ? ` result-${result.status}` : ''}`}><strong>{result ? statusLabel(result.status) : 'Sẵn sàng'}</strong><span>{result ? result.message : 'Post chỉ gửi một lần; publish chưa chắc chắn sẽ không auto-retry.'}</span>{result?.code ? <code>{result.code}</code> : null}{result?.code === 'publish_unconfirmed' ? <b>Kiểm tra Tường trước khi đăng lại.</b> : null}</div>
      <footer className="page-wall-scope-note"><strong>Common Page frame</strong><span>Group và Wall giữ schedule config riêng theo business. Wall reuse schedule editor/window logic và cùng concrete scheduler; v21 recurring subsystem không còn materialize runtime.</span></footer>

      {libraryOpen ? <CanonicalPostPicker items={libraryItems} loading={libraryLoading} error={libraryError} onClose={() => setLibraryOpen(false)} onPick={chooseCanonicalPost} /> : null}

      {jobsOpen ? <ModalShell label="Lịch đã hẹn Đăng Tường" title="Lịch đã hẹn" subtitle="Concrete jobs của Page hiện tại — gồm hẹn một lần và occurrence từ Lịch chạy." onClose={() => setJobsOpen(false)}><div className="page-wall-modal-body page-wall-jobs-list"><div className="page-wall-jobs-toolbar"><span>{jobsLoading ? 'Đang tải…' : `${currentJobs.length} job`}</span><button className="pt-button secondary" type="button" onClick={() => void refreshJobs()}>Làm mới</button></div>{currentJobs.map((job) => <article key={job.id} className={`page-wall-job job-${job.status}`}><div className="page-wall-job-main"><div className="page-wall-job-title"><span className={`page-wall-job-status status-${job.status}`}>{jobStatusLabel(job.status)}</span><b>#{job.id}</b><time>{formatDateTime(job.scheduledAt)}</time></div><p>{contentPreview(job)}</p><div className="page-wall-job-meta"><span>Account <b>{job.accountUid}</b>{job.accountName ? ` · ${job.accountName}` : ''}</span><span>Ảnh <b>{job.imagePaths.length}</b></span>{job.occurrenceKey ? <span>Lịch chạy</span> : <span>Hẹn 1 lần</span>}</div></div><div className="page-wall-job-result">{job.resultMessage ? <span>{job.resultMessage}</span> : <span className="page-wall-muted">Chưa có result.</span>}{job.resultCode ? <code>{job.resultCode}</code> : null}{job.publishedUrl ? <small>Published: {job.publishedUrl}</small> : null}</div><div className="page-wall-job-actions">{job.status === 'pending' ? <button className="pt-button secondary" type="button" disabled={cancellingJobId === job.id} onClick={() => void cancelJob(job.id)}>{cancellingJobId === job.id ? 'Đang hủy…' : 'Hủy job'}</button> : <small>{job.finishedAt ? `Kết thúc ${formatDateTime(job.finishedAt)}` : job.startedAt ? `Bắt đầu ${formatDateTime(job.startedAt)}` : '—'}</small>}</div></article>)}{!jobsLoading && currentJobs.length === 0 ? <p className="page-wall-muted">Page này chưa có concrete job.</p> : null}</div><footer className="page-wall-modal-actions"><span></span><button className="pt-button secondary" type="button" onClick={() => setJobsOpen(false)}>Đóng</button></footer></ModalShell> : null}

      {logsOpen ? <ModalShell label="Log Đăng Tường" title="Log thao tác" subtitle="Log UI gần nhất của Page Wall hiện tại." onClose={() => setLogsOpen(false)}><div className="page-wall-modal-body page-wall-log">{logs.map((entry) => <div key={entry.id} className={`log-${entry.tone}`}><time>{entry.at}</time><span>{entry.message}</span></div>)}{logs.length === 0 ? <p className="page-wall-muted">Chưa có thao tác.</p> : null}</div><footer className="page-wall-modal-actions"><button className="pt-button secondary" type="button" onClick={() => setLogs([])}>Xóa log UI</button><button className="pt-button secondary" type="button" onClick={() => setLogsOpen(false)}>Đóng</button></footer></ModalShell> : null}
    </section>
  )
}
