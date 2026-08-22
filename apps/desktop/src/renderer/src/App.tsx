import { useEffect, useMemo, useState } from 'react'
import type { AppInfo } from '../../ipc/channels'
import { AccountManager } from './accounts/AccountManager'

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
    description: 'Desktop foundation đã hoàn tất; Account Manager đang là phase hoạt động hiện tại.'
  },
  accounts: {
    title: 'Account Manager',
    description: 'Quản lý account theo data-grid nhiều cột, import linh hoạt và persistent browser profile riêng.'
  },
  'page-tabs': {
    title: 'Page Tabs',
    description: 'Mỗi Page UID sẽ có cấu hình account, lịch chạy, group, content và image folder độc lập.'
  },
  logs: {
    title: 'Runtime Logs',
    description: 'Main process đã có file logger cơ bản; runtime log chi tiết sẽ được mở rộng theo từng phase.'
  },
  settings: {
    title: 'Settings',
    description: 'Thiết lập global sẽ được thêm dần mà không cho renderer truy cập trực tiếp database hoặc browser.'
  }
}

export function App() {
  const [activeRoute, setActiveRoute] = useState<RouteId>('accounts')
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
        ) : (
          <>
            <section className="hero-card">
              <div>
                <span className="phase-badge">PHASE {activeRoute === 'overview' ? '1' : 'NEXT'}</span>
                <h2>{active.title}</h2>
                <p>{active.description}</p>
              </div>
              <div className="architecture-grid">
                <div><strong>Renderer</strong><span>React UI only</span></div>
                <div><strong>Main</strong><span>DB + lifecycle</span></div>
                <div><strong>Storage</strong><span>SQLite + Drizzle</span></div>
                <div><strong>Browser</strong><span>Playwright worker</span></div>
              </div>
            </section>

            <section className="content-card">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Architecture status</p>
                  <h2>Nền tảng giữ đúng ranh giới process</h2>
                </div>
                <span className="healthy-chip">Phase 1 active</span>
              </div>

              <div className="check-list">
                <div><span>01</span><div><strong>Electron lifecycle</strong><p>Main process khởi tạo database trước khi mở UI.</p></div></div>
                <div><span>02</span><div><strong>Account DB</strong><p>Credentials và metadata chỉ đi qua typed IPC, renderer không chạm DB.</p></div></div>
                <div><span>03</span><div><strong>Persistent profile</strong><p>Mỗi account có folder browser-profile riêng, worker Playwright chạy tách UI.</p></div></div>
                <div><span>04</span><div><strong>Portable baseline</strong><p>Phân phối theo folder/ZIP portable; không dùng installer trong MVP.</p></div></div>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  )
}
