import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PageTabConfig, PageTabSummary } from '../../../shared/pageTabs'
import type { RotationRuntimeSnapshot, RotationRuntimeStatus } from '../../../shared/rotation'
import { indexRotationRuntimes, rotationRuntimeLabel } from './pageRuntimePresentation'
import { nextSavedWindow, savedWindowCount } from './pageScheduleOverview'
import { EVERY_DAY_SCHEDULE } from './scheduleEditor'
import { readOverviewSelectedPageId, saveOverviewSelectedPageId } from './pageOverviewSelection'
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
  const [selectedPageId, setSelectedPageId] = useState<number | null>(readOverviewSelectedPageId)
  const [compactDetailOpen, setCompactDetailOpen] = useState(false)
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

  // A deleted/filtered-out stored ID falls back to a visible Page, without mutating Main state.
  const selectedPage = filtered.find((page) => page.id === selectedPageId) ?? filtered[0]
  const selectPage = (pageId: number) => {
    setSelectedPageId(pageId)
    saveOverviewSelectedPageId(pageId)
    if (window.innerWidth <= 900) setCompactDetailOpen(true)
  }
  const selectedConfig = selectedPage ? configs[selectedPage.id] : null
  const selectedRuntime = selectedPage ? runtimeById[selectedPage.id] : null
  const selectedStatus = selectedRuntime?.status ?? 'idle'
  const nextSelected = selectedConfig ? nextSavedWindow(selectedConfig.schedules, now) : null
  const selectedSchedules = (selectedConfig?.schedules ?? [])
    .filter((schedule) => schedule.enabled)
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startMinute - b.startMinute)
  const weekdays = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']
  const clock = (minutes: number) => String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0')

  return <section className="page-business-pane page-overview" role="tabpanel" aria-label="Tổng quan Page">
    <header className="page-overview-head">
      <div><p className="eyebrow">PAGE TABS / ĐIỀU PHỐI</p><h2>Quản lý Page & lịch chạy</h2><p>Chọn một Page để xem lịch, trạng thái và điều khiển. Dữ liệu lấy từ Main và cấu hình đã lưu.</p></div>
      <button type="button" className="page-overview-refresh" onClick={() => { void refreshPages(); void refreshRuntime() }}>Làm mới</button>
    </header>
    <div className="page-overview-stats" aria-label="Tình trạng các Page">
      <div><span>Tổng Page</span><strong>{pages.length}</strong><small>Đã thiết lập</small></div>
      <div><span>Hoạt động</span><strong>{activeCount}</strong><small>Đang chạy / chờ / tạm dừng</small></div>
      <div><span>Chờ lịch</span><strong>{waitingCount}</strong><small>Runtime chờ khung giờ</small></div>
      <div><span>Cần kiểm tra</span><strong>{errorCount}</strong><small>Runtime báo lỗi</small></div>
    </div>
    <div className="page-overview-filters">
      <label><span>Tìm Page/UID</span><input type="search" value={search} placeholder="Tên hoặc Page UID" onChange={(event) => setSearch(event.target.value)} /></label>
      <label><span>Trạng thái</span><select value={filter} onChange={(event) => setFilter(event.target.value as FilterMode)}><option value="all">Tất cả</option><option value="active">Hoạt động</option><option value="waiting">Chờ lịch</option><option value="error">Lỗi</option><option value="idle">Chưa chạy / kết thúc</option></select></label>
      <label><span>Sắp xếp</span><select value={sort} onChange={(event) => setSort(event.target.value as SortMode)}><option value="name">Tên Page</option><option value="next">Khung lịch gần nhất</option><option value="status">Trạng thái</option><option value="updated">Cập nhật gần nhất</option></select></label>
      <span className="page-overview-match">{filtered.length}/{pages.length} Page</span>
      <button type="button" className="page-overview-detail-toggle" aria-expanded={compactDetailOpen} onClick={() => setCompactDetailOpen((current) => !current)}>{compactDetailOpen ? "← Danh sách Page" : "Chi tiết Page →"}</button>
    </div>
    {error ? <div role="alert" className="page-tab-error">{error}</div> : null}
    <div className={compactDetailOpen ? "page-overview-main detail-mode" : "page-overview-main"}>
      <div className="page-overview-table-wrap">
        <table className="page-overview-table">
          <thead><tr><th>Page</th><th>Trạng thái</th><th>Lịch chạy</th><th>TK</th><th>Group</th><th>Bài</th><th>Khung kế tiếp</th></tr></thead>
          <tbody>
          {filtered.map((page) => {
            const runtime = runtimeById[page.id]
            const status = runtime?.status ?? 'idle'
            const config = configs[page.id]
            const next = config ? nextSavedWindow(config.schedules, now) : null
            const windows = config ? savedWindowCount(config.schedules) : page.scheduleCount
            const stateLabel = runtime ? rotationRuntimeLabel(status) : page.status === 'scheduled' ? 'Đã lên lịch' : page.status === 'error' ? 'Lỗi' : rotationRuntimeLabel(status)
            return <tr key={page.id} className={selectedPage?.id === page.id ? 'selected' : undefined}>
              <td><button type="button" className="page-overview-page-select" aria-current={selectedPage?.id === page.id ? 'true' : undefined} onClick={() => selectPage(page.id)}><strong title={page.name}>{page.name}</strong><small title={page.pageUid}>UID {page.pageUid}</small></button></td>
              <td><span className={'page-overview-state state-' + (runtime?.status ?? page.status)}>{stateLabel}</span></td>
              <td>{windows} khung bật</td><td>{page.accountCount}</td><td>{page.groupCount}</td><td>{posts[page.id] ?? '—'}</td>
              <td title="Khung giờ cấu hình, không bảo đảm thời điểm chạy">{formatWindow(next)}</td>
            </tr>
          })}
          {loading && pages.length === 0 ? <tr><td colSpan={7} className="page-overview-empty">Đang tải Page…</td></tr> : null}
          {!loading && filtered.length === 0 ? <tr><td colSpan={7} className="page-overview-empty">{pages.length ? 'Không có Page phù hợp bộ lọc.' : 'Chưa có Page. Dùng Quản lý Page để tạo mới.'}</td></tr> : null}
          </tbody>
        </table>
      </div>
      <aside className="page-overview-detail" aria-label="Chi tiết Page đang chọn">
        {selectedPage ? <>
          <div className="page-overview-detail-head">
            <div><span className="eyebrow">PAGE ĐANG CHỌN</span><h3>{selectedPage.name}</h3><small>UID: {selectedPage.pageUid}</small></div>
            <span className={'page-overview-state state-' + (selectedRuntime?.status ?? selectedPage.status)}>{selectedRuntime ? rotationRuntimeLabel(selectedStatus) : selectedPage.status === 'scheduled' ? 'Đã lên lịch' : selectedPage.status === 'error' ? 'Lỗi' : rotationRuntimeLabel(selectedStatus)}</span>
          </div>
          <section className="page-overview-detail-section">
            <div className="page-overview-section-head"><h4>Lịch chạy đã lưu</h4><span>{selectedConfig ? savedWindowCount(selectedConfig.schedules) : selectedPage.scheduleCount} khung bật</span></div>
            {selectedSchedules.length ? <div className="page-overview-schedule-list">
              {selectedSchedules.slice(0, 5).map((schedule) => <div key={schedule.id}><b>{schedule.dayOfWeek === EVERY_DAY_SCHEDULE ? 'Mỗi ngày' : weekdays[schedule.dayOfWeek] ?? '—'}</b><span>{clock(schedule.startMinute)}–{clock(schedule.endMinute)}</span></div>)}
              {selectedSchedules.length > 5 ? <small>Và {selectedSchedules.length - 5} khung khác; mở Nhóm để chỉnh lịch.</small> : null}
            </div> : <p className="page-overview-muted">Chưa có khung chạy được bật.</p>}
            <div className="page-overview-next"><span>Khung kế tiếp (theo lịch đã lưu)</span><strong>{formatWindow(nextSelected)}</strong></div>
          </section>
          <section className="page-overview-detail-section">
            <div className="page-overview-section-head"><h4>Cấu hình Page</h4><span>Đã lưu</span></div>
            <div className="page-overview-detail-metrics">
              <div><strong>{selectedPage.accountCount}</strong><span>Tài khoản</span></div>
              <div><strong>{selectedPage.groupCount}</strong><span>Group</span></div>
              <div><strong>{posts[selectedPage.id] ?? '—'}</strong><span>Bài bật</span></div>
            </div>
          </section>
          <section className="page-overview-detail-section">
            <div className="page-overview-section-head"><h4>Điều khiển Đăng Nhóm</h4><span>{rotationRuntimeLabel(selectedStatus)}</span></div>
            {selectedRuntime?.message ? <p className="page-overview-muted" title={selectedRuntime.message}>{selectedRuntime.message}</p> : null}
            <div className="page-overview-actions">
              <button type="button" className="primary" onClick={() => { saveOverviewSelectedPageId(selectedPage.id); onOpenGroup(selectedPage.id) }}>Mở cấu hình Nhóm</button>
              <button type="button" disabled={busy.has(selectedPage.id) || !canStart(selectedStatus)} onClick={() => void performAction(selectedPage.id, window.pageAuto.startPageTabRotation)}>Start</button>
              <button type="button" disabled={busy.has(selectedPage.id) || !canPause(selectedStatus)} onClick={() => void performAction(selectedPage.id, window.pageAuto.pausePageTabRotation)}>Pause</button>
              <button type="button" disabled={busy.has(selectedPage.id) || !canResume(selectedStatus)} onClick={() => void performAction(selectedPage.id, window.pageAuto.resumePageTabRotation)}>Resume</button>
              <button type="button" className="danger" disabled={busy.has(selectedPage.id) || !canStop(selectedStatus)} onClick={() => void performAction(selectedPage.id, window.pageAuto.stopPageTabRotation)}>Stop</button>
            </div>
          </section>
        </> : <p className="page-overview-muted">Chọn Page trong bảng để xem chi tiết.</p>}
      </aside>
    </div>
    <footer className="page-overview-foot">Lịch hiển thị là lịch đã lưu; chuyển Page hoặc nghiệp vụ không Start/Stop scheduler. Đăng Tường và các nghiệp vụ khác vẫn ở các tab riêng.</footer>
  </section>
}
