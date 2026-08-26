import { useEffect, useMemo, useState } from 'react'
import type { PageTabSummary } from '../../../shared/pageTabs'
import type { RotationRuntimeSnapshot, RotationRuntimeStatus } from '../../../shared/rotation'
import { PageTabsManager } from './PageTabsManagerV2'
import './pageBusinessWorkspace.css'
import './pageTabs3c.css'

type PageBusinessId = 'groups' | 'wall' | 'edit'
type RuntimeAction = (payload: { pageTabId: number }) => Promise<RotationRuntimeSnapshot>

interface PageBusinessDefinition {
  id: PageBusinessId
  label: string
  status: string
  title: string
  description: string
  items: Array<{ title: string; description: string }>
}

const businesses: PageBusinessDefinition[] = [
  {
    id: 'groups',
    label: 'Nhóm',
    status: 'Đang dùng',
    title: 'Đăng Nhóm',
    description: 'Nghiệp vụ hiện có tiếp tục dùng nguyên cấu hình, run snapshot và chống trùng theo phiên.',
    items: []
  },
  {
    id: 'wall',
    label: 'Đăng Tường',
    status: 'UI shell',
    title: 'Đăng Tường Page',
    description: 'Khung nghiệp vụ được dựng trước; runtime thật chỉ nối sau khi tầng Facebook dùng chung ổn định.',
    items: [
      { title: 'Dùng chung Page + tài khoản', description: 'Không tạo session/account riêng; sẽ dùng Page UID và danh sách account của Page Tab.' },
      { title: 'Cấu hình bài viết riêng', description: 'Content, ảnh, thứ tự/random, lịch và delay của Đăng Tường sẽ độc lập với Đăng Nhóm.' },
      { title: 'Runtime riêng', description: 'Start/Pause/Resume, preview và log sẽ tách theo nghiệp vụ nhưng dùng chung điều phối phiên.' }
    ]
  },
  {
    id: 'edit',
    label: 'Sửa Page',
    status: 'UI shell',
    title: 'Sửa Page',
    description: 'Khung nghiệp vụ được giữ chỗ đúng kiến trúc; phần thao tác Facebook sẽ làm sau Đăng Tường.',
    items: [
      { title: 'Dùng chung Facebook Common', description: 'Login, 2FA, checkpoint, profile và Page switch không được copy riêng vào Sửa Page.' },
      { title: 'Cấu hình thay đổi riêng', description: 'Các trường cần sửa và policy chạy sẽ thuộc nghiệp vụ Sửa Page, không chen vào cấu hình Nhóm.' },
      { title: 'Theo dõi kết quả', description: 'Trạng thái từng thao tác và log sẽ nối khi source common đã tách và regression Group xanh.' }
    ]
  }
]

const runtimeStatusLabels: Record<RotationRuntimeStatus, string> = {
  idle: 'Chưa chạy',
  starting: 'Đang khởi động',
  running: 'Đang chạy',
  paused: 'Tạm dừng',
  waiting_window: 'Chờ lịch',
  stopping: 'Đang dừng',
  stopped: 'Đã dừng',
  completed: 'Hoàn tất',
  error: 'Lỗi'
}

function canStart(status: RotationRuntimeStatus): boolean {
  return status === 'idle' || status === 'completed' || status === 'stopped' || status === 'error'
}

function canPause(status: RotationRuntimeStatus): boolean {
  return status === 'starting' || status === 'running' || status === 'waiting_window'
}

function canResume(status: RotationRuntimeStatus): boolean {
  return status === 'paused'
}

function canStop(status: RotationRuntimeStatus): boolean {
  return status === 'starting' || status === 'running' || status === 'paused' || status === 'waiting_window'
}

function PageRuntimeQuickControls({ onClose }: { onClose: () => void }) {
  const [tabs, setTabs] = useState<PageTabSummary[]>([])
  const [runtimeByTab, setRuntimeByTab] = useState<Record<number, RotationRuntimeSnapshot>>({})
  const [selected, setSelected] = useState<Set<number>>(() => new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = async () => {
    try {
      const [nextTabs, runtimes] = await Promise.all([
        window.pageAuto.listPageTabs(),
        window.pageAuto.listPageTabRotations()
      ])
      setTabs(nextTabs)
      setRuntimeByTab(Object.fromEntries(runtimes.map((runtime) => [runtime.pageTabId, runtime])))
      setSelected((current) => new Set([...current].filter((id) => nextTabs.some((tab) => tab.id === id))))
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const run = async (
    action: RuntimeAction,
    eligibility: (status: RotationRuntimeStatus) => boolean
  ) => {
    const targets = [...selected].filter((id) => eligibility(runtimeByTab[id]?.status ?? 'idle'))
    if (targets.length === 0) return
    setBusy(true)
    setError(null)
    try {
      await Promise.all(targets.map((pageTabId) => action({ pageTabId })))
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page-runtime-quick-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="page-runtime-quick-modal" role="dialog" aria-modal="true" aria-label="Điều khiển nhanh Page" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div><span>Điều khiển nhanh</span><strong>Page đang chạy</strong></div>
          <button type="button" onClick={onClose}>×</button>
        </header>
        <div className="page-runtime-quick-list">
          {tabs.map((tab) => {
            const runtime = runtimeByTab[tab.id]
            const status = runtime?.status ?? 'idle'
            return (
              <label key={tab.id} className={`quick-page-row quick-${status}`}>
                <input
                  type="checkbox"
                  checked={selected.has(tab.id)}
                  onChange={(event) => setSelected((current) => {
                    const next = new Set(current)
                    if (event.target.checked) next.add(tab.id)
                    else next.delete(tab.id)
                    return next
                  })}
                />
                <b>{tab.name}</b>
                <small>{tab.pageUid}</small>
                <span>{runtimeStatusLabels[status]}</span>
              </label>
            )
          })}
        </div>
        <div className="page-runtime-quick-actions">
          <span>{selected.size}/{tabs.length} Page</span>
          <button type="button" disabled={busy} onClick={() => setSelected(new Set(tabs.map((tab) => tab.id)))}>Chọn tất cả</button>
          <button type="button" className="primary" disabled={busy} onClick={() => void run(window.pageAuto.startPageTabRotation, canStart)}>Start</button>
          <button type="button" disabled={busy} onClick={() => void run(window.pageAuto.pausePageTabRotation, canPause)}>Pause</button>
          <button type="button" disabled={busy} onClick={() => void run(window.pageAuto.resumePageTabRotation, canResume)}>Tiếp tục</button>
          <button type="button" className="danger" disabled={busy} onClick={() => void run(window.pageAuto.stopPageTabRotation, canStop)}>Stop</button>
          <button type="button" disabled={busy || selected.size === 0} onClick={() => setSelected(new Set())}>Bỏ chọn</button>
        </div>
        {error ? <div className="page-runtime-quick-error">{error}</div> : null}
      </section>
    </div>
  )
}

export function PageBusinessWorkspace() {
  const [activeBusiness, setActiveBusiness] = useState<PageBusinessId>('groups')
  const [runtimeControlsOpen, setRuntimeControlsOpen] = useState(false)
  const active = useMemo(
    () => businesses.find((business) => business.id === activeBusiness) ?? businesses[0],
    [activeBusiness]
  )

  return (
    <div className="page-tabs-route page-business-workspace">
      <nav className="page-business-tabs" role="tablist" aria-label="Nghiệp vụ của Page">
        <div className="page-business-tab-buttons">
          {businesses.map((business) => (
            <button
              key={business.id}
              type="button"
              role="tab"
              aria-selected={activeBusiness === business.id}
              className={activeBusiness === business.id ? 'page-business-tab active' : 'page-business-tab'}
              onClick={() => setActiveBusiness(business.id)}
            >
              <strong>{business.label}</strong>
              <span>{business.status}</span>
            </button>
          ))}
        </div>
        <button className="page-runtime-quick-trigger" type="button" onClick={() => setRuntimeControlsOpen(true)}>
          Điều khiển Page
          <small>Start · Pause · Stop</small>
        </button>
      </nav>

      <div
        className={activeBusiness === 'groups' ? 'page-business-pane page-business-group-pane active' : 'page-business-pane page-business-group-pane inactive'}
        role="tabpanel"
        aria-hidden={activeBusiness !== 'groups'}
      >
        <PageTabsManager />
      </div>

      {activeBusiness !== 'groups' && active ? (
        <section className="page-business-pane page-business-placeholder" role="tabpanel">
          <header className="page-business-placeholder-head">
            <div>
              <p className="eyebrow">{active.label}</p>
              <h2>{active.title}</h2>
              <p>{active.description}</p>
            </div>
            <span className="page-business-shell-badge">Chưa bật runtime</span>
          </header>

          <div className="page-business-placeholder-grid">
            {active.items.map((item, index) => (
              <article key={item.title}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <div><strong>{item.title}</strong><p>{item.description}</p></div>
              </article>
            ))}
          </div>

          <div className="page-business-foundation-note">
            <strong>Thứ tự #77 được giữ nguyên</strong>
            <span>UI có trước để chốt thao tác. Không gọi Facebook, không tạo config giả và không nhân bản login/2FA/Page switch ở batch này.</span>
          </div>
        </section>
      ) : null}

      {runtimeControlsOpen ? <PageRuntimeQuickControls onClose={() => setRuntimeControlsOpen(false)} /> : null}
    </div>
  )
}
