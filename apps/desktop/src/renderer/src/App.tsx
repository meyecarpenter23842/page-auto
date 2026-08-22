import { useEffect, useMemo, useState } from 'react'
import type { AppInfo } from '../../ipc/channels'

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
    description: 'Nền desktop đã sẵn sàng cho các phase Account Manager, Session Engine và Page Tabs.'
  },
  accounts: {
    title: 'Account Manager',
    description: 'Phase 1 sẽ triển khai data-grid nhiều cột, custom import, preset và quản lý browser profile.'
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
  const [activeRoute, setActiveRoute] = useState<RouteId>('overview')
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
          Local mode
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

        <section className="hero-card">
          <div>
            <span className="phase-badge">PHASE 0</span>
            <h2>Desktop foundation</h2>
            <p>{active.description}</p>
          </div>
          <div className="architecture-grid">
            <div><strong>Renderer</strong><span>React UI only</span></div>
            <div><strong>Main</strong><span>DB + lifecycle</span></div>
            <div><strong>Storage</strong><span>SQLite + Drizzle</span></div>
            <div><strong>Automation</strong><span>Worker in later phase</span></div>
          </div>
        </section>

        <section className="content-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Bootstrap status</p>
              <h2>Nền tảng đang giữ đúng ranh giới process</h2>
            </div>
            <span className="healthy-chip">Ready for Phase 1</span>
          </div>

          <div className="check-list">
            <div><span>01</span><div><strong>Electron lifecycle</strong><p>Main process khởi tạo database trước khi mở UI.</p></div></div>
            <div><span>02</span><div><strong>Isolated renderer</strong><p>Context isolation bật, nodeIntegration tắt, IPC bridge tối thiểu.</p></div></div>
            <div><span>03</span><div><strong>Versioned database</strong><p>Migration được ghi lại và chạy idempotent khi app mở lại.</p></div></div>
            <div><span>04</span><div><strong>Safe logging</strong><p>Logger có cơ chế redaction theo tên field nhạy cảm.</p></div></div>
          </div>
        </section>
      </main>
    </div>
  )
}
