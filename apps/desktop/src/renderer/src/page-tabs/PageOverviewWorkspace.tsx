import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PageTabConfig, PageTabSummary } from '../../../shared/pageTabs'
import type { RotationRuntimeSnapshot, RotationRuntimeStatus } from '../../../shared/rotation'
import { indexRotationRuntimes, rotationRuntimeLabel } from './pageRuntimePresentation'
import { nextSavedWindow, savedWindowCount } from './pageScheduleOverview'
import './pageOverview.css'

type FilterMode = 'all' | 'active' | 'waiting' | 'error' | 'idle'
type SortMode = 'name' | 'next' | 'status' | 'updated'
type RuntimeAction = (payload: { pageTabId: number }) => Promise<RotationRuntimeSnapshot>
interface PageOverviewProps { onOpenGroup: (pageTabId: number) => void }

const canStart = (status: RotationRuntimeStatus) => ['idle', 'completed', 'stopped', 'error'].includes(status)
const canPause = (status: RotationRuntimeStatus) => ['starting', 'running', 'waiting_window'].includes(status)
const canResume = (status: RotationRuntimeStatus) => status === 'paused'
const canStop = (status: RotationRuntimeStatus) => ['starting', 'running', 'paused', 'waiting_window'].includes(status)
const isActive = (status: RotationRuntimeStatus) => ['starting', 'running', 'paused', 'waiting_window', 'stopping'].includes(status)
const formatWindow = (time: Date | null) => time
  ? time.toLocaleString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  : '—'

/** Read-only overview: Main owns scheduler and storage, even when this component unmounts. */
export function PageOverviewWorkspace({ onOpenGroup }: PageOverviewProps) {
  const [pages, setPages] = useState<PageTabSummary[]>([])
  const [configs, setConfigs] = useState<Record<number, PageTabConfig>>({})
  const [posts, setPosts] = useState<Record<number, number>>({})
  const [runtimeById, setRuntimeById] = useState<Record<number, RotationRuntimeSnapshot>>({})
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FilterMode>('all')
  const [sort, setSort] = useState<SortMode>('name')
  const [busy, setBusy] = useState<Set<number>>(() => new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date())

  const refreshPages = useCallback(async () => {
    try {
      const nextPages = await window.pageAuto.listPageTabs()
      setPages(nextPages)
      const nextConfigs: Record<number, PageTabConfig> = {}
      const nextPosts: Record<number, number> = {}
      // Bounded batches keep large Page inventories from flooding Electron Main with IPC calls.
      for (let index = 0; index < nextPages.length; index += 6) {
        await Promise.all(nextPages.slice(index, index + 6).map(async (page) => {
          const [config, library] = await Promise.all([
            window.pageAuto.getPageTab({ id: page.id }).catch(() => null),
            window.pageAuto.getPageTabPostLibrary({ id: page.id }).catch(() => null)
          ])
          if (config) nextConfigs[page.id] = config
          if (library) nextPosts[page.id] = library.posts.filter((post) => post.enabled).length
        }))
      }
      setConfigs(nextConfigs)
      setPosts(nextPosts)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setLoading(false) }
  }, [])

  const refreshRuntime = useCallback(async () => {
    try {
      setRuntimeById(indexRotationRuntimes(await window.pageAuto.listPageTabRotations()))
      setNow(new Date())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  useEffect(() => {
    void refreshPages()
    void refreshRuntime()
    const runtimeTimer = window.setInterval(() => void refreshRuntime(), 2000)
    const pageTimer = window.setInterval(() => void refreshPages(), 60000)
    return () => { window.clearInterval(runtimeTimer); window.clearInterval(pageTimer) }
  }, [refreshPages, refreshRuntime])

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('vi')
    return pages.filter((page) => {
      if (query && !(page.name + ' ' + page.pageUid).toLocaleLowerCase('vi').includes(query)) return false
      const state = runtimeById[page.id]?.status ?? 'idle'
      if (filter === 'active') return isActive(state)
      if (filter === 'waiting') return state === 'waiting_window' || (!runtimeById[page.id] && page.status === 'scheduled')
      if (filter === 'error') return state === 'error' || (!runtimeById[page.id] && page.status === 'error')
      if (filter === 'idle') return !isActive(state) && state !== 'error'
      return true
    }).sort((a, b) => {
      if (sort === 'updated') return b.updatedAt - a.updatedAt || a.id - b.id
      if (sort === 'status') return (runtimeById[a.id]?.status ?? a.status).localeCompare(runtimeById[b.id]?.status ?? b.status) || a.id - b.id
      if (sort === 'next') {
        const left = nextSavedWindow(configs[a.id]?.schedules ?? [], now)?.getTime() ?? Number.POSITIVE_INFINITY
        const right = nextSavedWindow(configs[b.id]?.schedules ?? [], now)?.getTime() ?? Number.POSITIVE_INFINITY
        return left - right || a.name.localeCompare(b.name, 'vi')
      }
      return a.name.localeCompare(b.name, 'vi') || a.id - b.id
    })
  }, [pages, configs, runtimeById, search, filter, sort, now])

  const performAction = async (pageTabId: number, action: RuntimeAction) => {
    setBusy((current) => new Set(current).add(pageTabId))
    try {
      const snapshot = await action({ pageTabId })
      setRuntimeById((current) => ({ ...current, [pageTabId]: snapshot }))
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy((current) => { const next = new Set(current); next.delete(pageTabId); return next })
    }
  }

  const activeCount = pages.filter((page) => isActive(runtimeById[page.id]?.status ?? 'idle')).length
  const waitingCount = pages.filter((page) => runtimeById[page.id]?.status === 'waiting_window').length
  const errorCount = pages.filter((page) => runtimeById[page.id]?.status === 'error').length

  return <section className="page-business-pane page-overview" role="tabpanel" aria-label="Tổng quan Page">
    <header className="page-overview-head">
      <div><p className="eyebrow">Điều phối Page</p><h2>Tổng quan Page & lịch</h2><p>Trạng thái từ Main; khung giờ lấy từ cấu hình đã lưu trên máy.</p></div>
      <div className="page-overview-stats">
        <span><strong>{pages.length}</strong> Page</span><span><strong>{activeCount}</strong> hoạt động</span>
        <span><strong>{waitingCount}</strong> chờ lịch</span><span><strong>{errorCount}</strong> lỗi</span>
        <button type="button" onClick={() => { void refreshPages(); void refreshRuntime() }}>Làm mới</button>
      </div>
    </header>
    <div className="page-overview-filters">
      <label><span>Tìm Page/UID</span><input type="search" value={search} placeholder="Tên hoặc Page UID" onChange={(event) => setSearch(event.target.value)} /></label>
      <label><span>Trạng thái</span><select value={filter} onChange={(event) => setFilter(event.target.value as FilterMode)}><option value="all">Tất cả</option><option value="active">Hoạt động</option><option value="waiting">Chờ lịch</option><option value="error">Lỗi</option><option value="idle">Chưa chạy / kết thúc</option></select></label>
      <label><span>Sắp xếp</span><select value={sort} onChange={(event) => setSort(event.target.value as SortMode)}><option value="name">Tên Page</option><option value="next">Khung lịch gần nhất</option><option value="status">Trạng thái</option><option value="updated">Cập nhật gần nhất</option></select></label>
      <span className="page-overview-match">{filtered.length}/{pages.length} Page</span>
    </div>
    {error ? <div role="alert" className="page-tab-error">{error}</div> : null}
    <div className="page-overview-table-wrap"><table className="page-overview-table">
      <thead><tr><th>Page</th><th>Runtime Nhóm</th><th>Lịch đã lưu</th><th>Khung kế tiếp</th><th>TK</th><th>Group</th><th>Bài bật</th><th>Còn lại</th><th>Điều khiển / cấu hình</th></tr></thead>
      <tbody>
      {filtered.map((page) => {
        const runtime = runtimeById[page.id]
        const status = runtime?.status ?? 'idle'
        const config = configs[page.id]
        const next = config ? nextSavedWindow(config.schedules, now) : null
        const windows = config ? savedWindowCount(config.schedules) : page.scheduleCount
        const isBusy = busy.has(page.id)
        const stateLabel = runtime ? rotationRuntimeLabel(status) : page.status === 'scheduled' ? 'Đã lên lịch' : page.status === 'error' ? 'Lỗi' : rotationRuntimeLabel(status)
        return <tr key={page.id}>
          <td><strong title={page.name}>{page.name}</strong><small title={page.pageUid}>UID {page.pageUid}</small></td>
          <td><span className={'page-overview-state state-' + (runtime?.status ?? page.status)}>{stateLabel}</span><small title={runtime?.message ?? undefined}>{runtime?.message ?? '—'}</small></td>
          <td>{windows} khung bật</td><td title="Khung giờ lưu, không phải thời điểm được bảo đảm chạy">{formatWindow(next)}</td>
          <td>{page.accountCount}</td><td>{page.groupCount}</td><td>{posts[page.id] ?? '—'}</td><td>{runtime?.run?.metrics.remaining ?? '—'}</td>
          <td><div className="page-overview-actions">
            <button type="button" onClick={() => onOpenGroup(page.id)}>Mở Nhóm</button>
            <button type="button" disabled={isBusy || !canStart(status)} onClick={() => void performAction(page.id, window.pageAuto.startPageTabRotation)}>Start</button>
            <button type="button" disabled={isBusy || !canPause(status)} onClick={() => void performAction(page.id, window.pageAuto.pausePageTabRotation)}>Pause</button>
            <button type="button" disabled={isBusy || !canResume(status)} onClick={() => void performAction(page.id, window.pageAuto.resumePageTabRotation)}>Resume</button>
            <button type="button" disabled={isBusy || !canStop(status)} onClick={() => void performAction(page.id, window.pageAuto.stopPageTabRotation)}>Stop</button>
          </div></td>
        </tr>
      })}
      {loading && pages.length === 0 ? <tr><td colSpan={9} className="page-overview-empty">Đang tải Page…</td></tr> : null}
      {!loading && filtered.length === 0 ? <tr><td colSpan={9} className="page-overview-empty">{pages.length ? 'Không có Page phù hợp bộ lọc.' : 'Chưa có Page. Dùng Quản lý Page để tạo mới.'}</td></tr> : null}
      </tbody>
    </table></div>
    <footer className="page-overview-foot">Lịch và số bài lấy từ dữ liệu đã lưu; việc chuyển tab không điều khiển scheduler. Log chi tiết nằm trong từng nghiệp vụ.</footer>
  </section>
}
