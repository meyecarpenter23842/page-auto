import { useEffect, useMemo, useState } from 'react'
import type { AppInfo } from '../../ipc/channels'
import { AccountManager } from './accounts/AccountManager'
import { MultiTabRuntimeDashboard } from './page-tabs/MultiTabRuntimeDashboard'
import { PageTabsManager } from './page-tabs/PageTabsManager'

type RouteId = 'overview' | 'accounts' | 'page-tabs' | 'logs' | 'settings'

interface Route {
  id: RouteId
  label: string
  shortLabel: string
}

const routes: Route[] = [
  { id: 'overview', label: 'Tổng quan', shortLabel: 'OV' },
  { id: 'accounts', label: 'Tài khoản', shortLabel: 'AC' },
  { id: 'page-tabs', label: 'Page Tabs', shortLabel: 'PT' },
  { id: 'logs', label: 'Nhật ký', shortLabel: 'LG' },
  { id: 'settings', label: 'Cài đặt', shortLabel: 'ST' }
]

const routeDescriptions: Record<RouteId, { title: string; description: string }> = {
  overview: {
    title: 'Tổng quan',
    description: 'Phase 7 tách runtime theo từng Page Tab để nhiều Page chạy song song mà account trong mỗi tab vẫn tuần tự.'
  },
  accounts: {
    title: 'Account Manager',
    description: 'Quản lý account theo data-grid nhiều cột, import linh hoạt và persistent browser profile riêng.'
  },
  'page-tabs': {
    title: 'Page Tabs',
    description: 'Mỗi Page UID có config, queue và runtime độc lập; Worker Manager điều phối nhiều tab song song.'
  },
  logs: {
    title: 'Runtime Logs',
    description: 'Runtime execution log chi tiết và recovery sâu được mở rộng ở Phase 8.'
  },
  settings: {
    title: 'Settings',
    description: 'Thiết lập global vẫn đi qua Main/IPC, renderer không truy cập database hoặc browser trực tiếp.'
  }
}

export function App() {
  const [activeRoute, setActiveRoute] = useState<RouteId>('page-tabs')
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const active = useMemo(() => routeDescriptions[activeRoute], [activeRoute])

  useEffect(() => {
    void window.pageAuto.getAppInfo().then(setAppInfo)
  }, [])

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">PA</div>
          <div>
            <strong>PAGE-AUTO</strong>
            <span>Desktop Control</span>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Điều hướng chính">
          {routes.map((route) => (
            <button
              className={route.id === activeRoute ? 'nav-item active' : 'nav-item'}
              key={route.id}
              type="button"
              onClick={() => setActiveRoute(route.id)}
            >
              <span className="nav-icon">{route.shortLabel}</span>
              <span>{route.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <span className="status-dot" />
          Local portable mode
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">PAGE-AUTO / {activeRoute.toUpperCase()}</p>
            <h1>{active.title}</h1>
          </div>
          <div className="version-badge">{appInfo ? `v${appInfo.version}` : 'Loading...'}</div>
        </header>

        {activeRoute === 'accounts' ? (
          <AccountManager />
        ) : activeRoute === 'page-tabs' ? (
          <>
            <MultiTabRuntimeDashboard />
            <PageTabsManager />
          </>
        ) : (
          <>
            <section className="hero-card">
              <div>
                <span className="phase-badge">PHASE {activeRoute === 'overview' ? '7' : 'NEXT'}</span>
                <h2>{active.title}</h2>
                <p>{active.description}</p>
              </div>
              <div className="architecture-grid">
                <div><strong>Renderer</strong><span>React UI only</span></div>
                <div><strong>Main</strong><span>DB + Worker Manager</span></div>
                <div><strong>Workers</strong><span>Parallel per Page Tab</span></div>
                <div><strong>Tab runtime</strong><span>Sequential accounts</span></div>
              </div>
            </section>

            <section className="content-card">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Architecture status</p>
                  <h2>Phase 7 tách runtime theo từng Page Tab</h2>
                </div>
                <span className="healthy-chip">Multi-tab runtime active</span>
              </div>

              <div className="check-list">
                <div><span>01</span><div><strong>Independent queue</strong><p>Mỗi Page Tab giữ run/run_items riêng nên không trộn Group UID giữa các tab.</p></div></div>
                <div><span>02</span><div><strong>Parallel tabs</strong><p>Worker Manager cho nhiều Page Tab active cùng lúc.</p></div></div>
                <div><span>03</span><div><strong>Sequential inside tab</strong><p>Mỗi tab vẫn chạy account theo đúng thứ tự và quota Phase 6.</p></div></div>
                <div><span>04</span><div><strong>Realtime UI</strong><p>Renderer cập nhật runtime theo IPC từ Main, không chạy automation trong React.</p></div></div>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  )
}
