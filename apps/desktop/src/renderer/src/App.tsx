import { useEffect, useMemo, useState } from 'react'
import type { AppInfo } from '../../ipc/channels'
import { AccountManager } from './accounts/AccountManager'
import { ExecutionLogs } from './logs/ExecutionLogs'
import { PageTabsManager } from './page-tabs/PageTabsManagerV2'
import { SettingsPanel } from './settings/SettingsPanel'

type RouteId = 'overview' | 'accounts' | 'page-tabs' | 'logs' | 'settings'

interface Route { id: RouteId; label: string; shortLabel: string }

const routes: Route[] = [
  { id: 'overview', label: 'Tổng quan', shortLabel: 'OV' },
  { id: 'accounts', label: 'Tài khoản', shortLabel: 'AC' },
  { id: 'page-tabs', label: 'Page Tabs', shortLabel: 'PT' },
  { id: 'logs', label: 'Nhật ký', shortLabel: 'LG' },
  { id: 'settings', label: 'Cài đặt', shortLabel: 'ST' }
]

const routeDescriptions: Record<RouteId, { title: string; description: string }> = {
  overview: { title: 'Tổng quan', description: 'Phase 9 đóng gói PAGE-AUTO thành Windows portable folder/ZIP, giữ data cạnh executable và bổ sung backup/restore config không chứa plaintext secret.' },
  accounts: { title: 'Account Manager', description: 'Quản lý account theo data-grid nhiều cột, import linh hoạt và persistent browser profile riêng.' },
  'page-tabs': { title: 'Page Tabs', description: 'Mỗi Page UID có config, queue và runtime độc lập; restart giữ run history và có thể resume phiên đang pause.' },
  logs: { title: 'Runtime Logs', description: 'Execution log chi tiết, screenshot evidence, retry disposition và manual-review cho kết quả publish chưa chắc chắn.' },
  settings: { title: 'Cài đặt', description: 'Cấu hình trình duyệt, session, mạng, vận hành và chẩn đoán dùng chung cho PAGE-AUTO.' }
}

export function App() {
  const [activeRoute, setActiveRoute] = useState<RouteId>('page-tabs')
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const active = useMemo(() => routeDescriptions[activeRoute], [activeRoute])

  useEffect(() => { void window.pageAuto.getAppInfo().then(setAppInfo) }, [])

  const workspaceClass = activeRoute === 'page-tabs'
    ? 'workspace workspace-page-tabs'
    : activeRoute === 'settings'
      ? 'workspace workspace-settings'
      : 'workspace'

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <span className="sidebar-orbit sidebar-orbit-one" aria-hidden="true" />
        <span className="sidebar-orbit sidebar-orbit-two" aria-hidden="true" />

        <div className="brand sidebar-card">
          <div className="brand-mark">PA</div>
          <div><strong>PAGE-AUTO</strong><span>Desktop Control</span></div>
        </div>

        <div className="sidebar-menu-card sidebar-card">
          <p className="sidebar-kicker">MENU CHÍNH</p>
          <nav className="sidebar-nav" aria-label="Điều hướng chính">
            {routes.map((route) => (
              <button
                aria-current={route.id === activeRoute ? 'page' : undefined}
                className={route.id === activeRoute ? 'nav-item active' : 'nav-item'}
                key={route.id}
                type="button"
                onClick={() => setActiveRoute(route.id)}
              >
                <span className="nav-icon">{route.shortLabel}</span>
                <span className="nav-label">{route.label}</span>
              </button>
            ))}
          </nav>
        </div>

        <div className="sidebar-footer sidebar-card">
          <div className="sidebar-status-line"><span className="status-dot" /><strong>Local portable mode</strong></div>
          <span className="sidebar-version">{appInfo ? `v${appInfo.version}` : 'Đang tải phiên bản...'}</span>
        </div>
      </aside>

      <main key={activeRoute} className={`${workspaceClass} workspace-transition`}>
        <header className="topbar"><div><p className="eyebrow">PAGE-AUTO / {activeRoute.toUpperCase()}</p><h1>{active.title}</h1></div><div className="version-badge">{appInfo ? `v${appInfo.version}` : 'Loading...'}</div></header>

        {activeRoute === 'accounts' ? <AccountManager /> : activeRoute === 'page-tabs' ? <div className="page-tabs-route"><PageTabsManager /></div> : activeRoute === 'logs' ? <ExecutionLogs /> : activeRoute === 'settings' ? <SettingsPanel appInfo={appInfo} /> : (
          <>
            <section className="hero-card"><div><span className="phase-badge">PHASE 9</span><h2>{active.title}</h2><p>{active.description}</p></div><div className="architecture-grid"><div><strong>Portable</strong><span>Folder + ZIP</span></div><div><strong>Executable</strong><span>PageAuto.exe</span></div><div><strong>Data</strong><span>Beside executable</span></div><div><strong>Backup</strong><span>Config · no secrets</span></div></div></section>
            <section className="content-card"><div className="section-heading"><div><p className="eyebrow">MVP packaging status</p><h2>Phase 9 hoàn thiện mô hình Windows portable</h2></div><span className="healthy-chip">Portable-ready architecture</span></div><div className="check-list"><div><span>01</span><div><strong>No installer</strong><p>Artifact mục tiêu là folder/ZIP portable, không tạo Setup/NSIS trong MVP.</p></div></div><div><span>02</span><div><strong>Stable data path</strong><p>SQLite, browser profile, logs và screenshots nằm trong data cạnh PageAuto.exe.</p></div></div><div><span>03</span><div><strong>Versioned migration</strong><p>Database cũ tiếp tục chạy migration version khi mở bằng bản app mới.</p></div></div><div><span>04</span><div><strong>Safe config backup</strong><p>Backup cấu hình không xuất password, cookie, 2FA hoặc browser profile.</p></div></div></div></section>
          </>
        )}
      </main>
    </div>
  )
}
