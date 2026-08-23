import { useEffect, useMemo, useState } from 'react'
import type { AppInfo } from '../../ipc/channels'
import { AccountManager } from './accounts/AccountManager'
import { ExecutionLogs } from './logs/ExecutionLogs'
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
    description: 'Phase 8 bổ sung crash recovery, retry policy an toàn, screenshot lỗi và execution log có thể audit theo từng Page/Account/Group.'
  },
  accounts: {
    title: 'Account Manager',
    description: 'Quản lý account theo data-grid nhiều cột, import linh hoạt và persistent browser profile riêng.'
  },
  'page-tabs': {
    title: 'Page Tabs',
    description: 'Mỗi Page UID có config, queue và runtime độc lập; restart giữ run history và có thể resume phiên đang pause.'
  },
  logs: {
    title: 'Runtime Logs',
    description: 'Execution log chi tiết, screenshot evidence, retry disposition và manual-review cho kết quả publish chưa chắc chắn.'
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
        ) : activeRoute === 'logs' ? (
          <ExecutionLogs />
        ) : (
          <>
            <section className="hero-card">
              <div>
                <span className="phase-badge">PHASE {activeRoute === 'overview' ? '8' : 'NEXT'}</span>
                <h2>{active.title}</h2>
                <p>{active.description}</p>
              </div>
              <div className="architecture-grid">
                <div><strong>Recovery</strong><span>Crash-safe run state</span></div>
                <div><strong>Retry</strong><span>Transient only · max 3</span></div>
                <div><strong>Evidence</strong><span>Error screenshots</span></div>
                <div><strong>Audit</strong><span>Execution logs</span></div>
              </div>
            </section>

            <section className="content-card">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Architecture status</p>
                  <h2>Phase 8 bảo toàn queue khi worker/app bị gián đoạn</h2>
                </div>
                <span className="healthy-chip">Recovery + logs active</span>
              </div>

              <div className="check-list">
                <div><span>01</span><div><strong>No blind success</strong><p>Item processing bị gián đoạn không bao giờ tự chuyển success.</p></div></div>
                <div><span>02</span><div><strong>No blind duplicate</strong><p>Publish chưa xác nhận hoặc crash giữa job được đưa vào manual review thay vì tự đăng lại.</p></div></div>
                <div><span>03</span><div><strong>Bounded retry</strong><p>Chỉ lỗi transient được retry, tối đa ba attempt cho mỗi run item.</p></div></div>
                <div><span>04</span><div><strong>Traceable evidence</strong><p>Log lưu Page/Account/Group/error/screenshot path mà không ghi credential plaintext.</p></div></div>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  )
}
