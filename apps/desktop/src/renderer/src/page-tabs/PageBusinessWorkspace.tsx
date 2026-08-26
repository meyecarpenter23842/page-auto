import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PageTabSummary } from '../../../shared/pageTabs'
import type { RotationRuntimeSnapshot, RotationRuntimeStatus } from '../../../shared/rotation'
import { PageTabsManager } from './PageTabsManagerV2'
import './pageBusinessWorkspace.css'
import './pageTabs3c.css'
import './pageTabs3d.css'
import './issue98CompactGroup.css'

type PageBusinessId = 'groups' | 'wall' | 'edit'
type RuntimeAction = (payload: { pageTabId: number }) => Promise<RotationRuntimeSnapshot>
type GroupConfigLauncherId = 'identity' | 'schedule' | 'groups' | 'posts'

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

function GroupConfigIcon({ id }: { id: GroupConfigLauncherId }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const
  }

  if (id === 'identity') return <svg {...common}><rect x="4" y="5" width="16" height="14" rx="2" /><circle cx="9" cy="11" r="2" /><path d="M7 16c.6-1.6 1.5-2.4 2.8-2.4S12 14.4 12.6 16" /><path d="M14.5 10h3" /><path d="M14.5 14h3" /></svg>
  if (id === 'schedule') return <svg {...common}><rect x="4" y="5.5" width="16" height="14.5" rx="2" /><path d="M8 3.5v4" /><path d="M16 3.5v4" /><path d="M4 9.5h16" /><path d="M8 13h3" /><path d="M13 13h3" /><path d="M8 16.5h3" /></svg>
  if (id === 'groups') return <svg {...common}><circle cx="9" cy="9" r="3" /><circle cx="17" cy="10" r="2.3" /><path d="M3.5 19c.6-3.2 2.5-4.8 5.5-4.8s4.9 1.6 5.5 4.8" /><path d="M14.5 15.2c2.8.2 4.6 1.5 5.2 3.8" /></svg>
  return <svg {...common}><path d="M6 3.5h8l4 4V20H6z" /><path d="M14 3.5V8h4" /><path d="M9 12h6" /><path d="M9 15.5h6" /></svg>
}

function CompactGroupConfigControls() {
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null)
  const [identityPanel, setIdentityPanel] = useState<HTMLElement | null>(null)
  const [identityOpen, setIdentityOpen] = useState(false)

  useEffect(() => {
    const syncTargets = () => {
      setPortalTarget(document.querySelector<HTMLElement>('.page-business-group-pane .page-tab-left-pane'))
      setIdentityPanel(document.querySelector<HTMLElement>('.page-business-group-pane .pt-identity-panel'))
    }
    syncTargets()
    const timer = window.setInterval(syncTargets, 500)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!identityPanel) return
    identityPanel.classList.toggle('issue98-identity-modal', identityOpen)
    if (identityOpen) {
      identityPanel.setAttribute('role', 'dialog')
      identityPanel.setAttribute('aria-modal', 'true')
      identityPanel.setAttribute('aria-label', 'Nhận diện Page')
    } else {
      identityPanel.removeAttribute('role')
      identityPanel.removeAttribute('aria-modal')
      identityPanel.removeAttribute('aria-label')
    }

    return () => {
      identityPanel.classList.remove('issue98-identity-modal')
      identityPanel.removeAttribute('role')
      identityPanel.removeAttribute('aria-modal')
      identityPanel.removeAttribute('aria-label')
    }
  }, [identityOpen, identityPanel])

  useEffect(() => {
    if (!identityOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIdentityOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [identityOpen])

  const openExistingEditor = (rowIndex: 1 | 2 | 3) => {
    document.querySelector<HTMLButtonElement>(`.page-business-group-pane .pt-business-row:nth-child(${rowIndex}) button`)?.click()
  }

  if (!portalTarget) return null

  const closeButtonTarget = identityPanel?.querySelector<HTMLElement>('.pt-panel-heading') ?? null

  return (
    <>
      {createPortal(
        <section className="pt-panel pt-compact-config-launchers" aria-label="Cấu hình nhanh Đăng Nhóm">
          <div className="pt-compact-config-title"><span>Cấu hình</span><small>Mở khi cần</small></div>
          <div className="pt-compact-config-actions">
            <button type="button" title="Nhận diện Page" onClick={() => setIdentityOpen(true)}><GroupConfigIcon id="identity" /><span>Nhận diện</span></button>
            <button type="button" title="Lịch chạy" onClick={() => openExistingEditor(1)}><GroupConfigIcon id="schedule" /><span>Lịch chạy</span></button>
            <button type="button" title="Danh sách Group" onClick={() => openExistingEditor(2)}><GroupConfigIcon id="groups" /><span>Group</span></button>
            <button type="button" title="Thư viện bài viết" onClick={() => openExistingEditor(3)}><GroupConfigIcon id="posts" /><span>Bài viết</span></button>
          </div>
        </section>,
        portalTarget
      )}
      {identityOpen ? createPortal(<div className="pt-identity-compact-backdrop" role="presentation" onMouseDown={() => setIdentityOpen(false)} />, document.body) : null}
      {identityOpen && closeButtonTarget ? createPortal(<button className="pt-identity-compact-close" type="button" aria-label="Đóng Nhận diện" onClick={() => setIdentityOpen(false)}>×</button>, closeButtonTarget) : null}
    </>
  )
}

function CurrentPageRuntimeActions() {
  const [runtimeByTab, setRuntimeByTab] = useState<Record<number, RotationRuntimeSnapshot>>({})
  const [activePageId, setActivePageId] = useState<number | null>(null)
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = async () => {
    try {
      const [tabs, runtimes] = await Promise.all([
        window.pageAuto.listPageTabs(),
        window.pageAuto.listPageTabRotations()
      ])
      const pageButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.page-business-group-pane .page-tab-chip'))
      const activeIndex = pageButtons.findIndex((button) => button.classList.contains('active'))
      setActivePageId(activeIndex >= 0 ? tabs[activeIndex]?.id ?? null : null)
      setRuntimeByTab(Object.fromEntries(runtimes.map((runtime) => [runtime.pageTabId, runtime])))
      setPortalTarget(document.querySelector<HTMLElement>('.page-business-group-pane .page-tab-header-actions'))
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

  const status = activePageId === null ? 'idle' : runtimeByTab[activePageId]?.status ?? 'idle'

  const run = async (
    action: RuntimeAction,
    eligibility: (runtimeStatus: RotationRuntimeStatus) => boolean
  ) => {
    if (activePageId === null || !eligibility(status)) return
    setBusy(true)
    setError(null)
    try {
      const next = await action({ pageTabId: activePageId })
      setRuntimeByTab((current) => ({ ...current, [activePageId]: next }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  if (!portalTarget || activePageId === null) return null

  return createPortal(
    <div className="page-tab-runtime-actions" title={error ?? `Runtime: ${runtimeStatusLabels[status]}`}>
      <span className={`page-tab-runtime-state runtime-${status}`}>{runtimeStatusLabels[status]}</span>
      <button className="pt-button runtime-start" type="button" disabled={busy || !canStart(status)} onClick={() => void run(window.pageAuto.startPageTabRotation, canStart)}>▶ Start</button>
      <button className="pt-button runtime-pause" type="button" disabled={busy || !canPause(status)} onClick={() => void run(window.pageAuto.pausePageTabRotation, canPause)}>Ⅱ Tạm dừng</button>
      <button className="pt-button runtime-resume" type="button" disabled={busy || !canResume(status)} onClick={() => void run(window.pageAuto.resumePageTabRotation, canResume)}>▶ Tiếp tục</button>
      <button className="pt-button runtime-stop" type="button" disabled={busy || !canStop(status)} onClick={() => void run(window.pageAuto.stopPageTabRotation, canStop)}>■ Stop</button>
    </div>,
    portalTarget
  )
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

      {activeBusiness === 'groups' ? <CompactGroupConfigControls /> : null}
      <CurrentPageRuntimeActions />
      {runtimeControlsOpen ? <PageRuntimeQuickControls onClose={() => setRuntimeControlsOpen(false)} /> : null}
    </div>
  )
}
