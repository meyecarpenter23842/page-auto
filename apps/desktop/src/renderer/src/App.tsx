import { useEffect, useMemo, useState } from 'react'
import type { AppInfo } from '../../ipc/channels'
import { AccountManager } from './accounts/AccountManager'
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
    description: 'Account Manager đã có nền dữ liệu; Phase 3 đang cấu hình Page Tabs độc lập trước Run Queue và posting core.'
  },
  accounts: {
    title: 'Account Manager',
    description: 'Quản lý account theo data-grid nhiều cột, import linh hoạt và persistent browser profile riêng.'
  },
  'page-tabs': {
    title: 'Page Tabs',
    description: 'Mỗi Page UID có account order, rotation, lịch chạy, Group Set, Content Set và Image Folder độc lập.'
  },
  logs: {
    title: 'Runtime Logs',
    description: 'Runtime execution log chi tiết sẽ được mở rộng ở phase recovery/run; logger nền vẫn nằm trong Main.'
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
          <PageTabsManager />
        ) : (
          <>
            <section className="hero-card">
              <div>
                <span className="phase-badge">PHASE {activeRoute === 'overview' ? '3' : 'NEXT'}</span>
                <h2>{active.title}</h2>
                <p>{active.description}</p>
              </div>
              <div className="architecture-grid">
                <div><strong>Renderer</strong><span>React UI only</span></div>
                <div><strong>Main</strong><span>DB + lifecycle</span></div>
                <div><strong>Storage</strong><span>SQLite + Drizzle</span></div>
                <div><strong>Page Config</strong><span>Independent per tab</span></div>
              </div>
            </section>

            <section className="content-card">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Architecture status</p>
                  <h2>Phase 3 giữ config tách khỏi runtime</h2>
                </div>
                <span className="healthy-chip">Page Tab config active</span>
              </div>

              <div className="check-list">
                <div><span>01</span><div><strong>Account references</strong><p>Page Tab chỉ reference account ID, không copy cookie/password/proxy.</p></div></div>
                <div><span>02</span><div><strong>Source sets</strong><p>Group Set và Content Set là nguồn gốc để Phase 4 clone run snapshot.</p></div></div>
                <div><span>03</span><div><strong>Schedule config</strong><p>Nhiều khung giờ/ngày được persist độc lập theo từng Page UID.</p></div></div>
                <div><span>04</span><div><strong>No posting yet</strong><p>Phase 3 chỉ lưu config; Run Queue và posting core chưa được kích hoạt.</p></div></div>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  )
}
