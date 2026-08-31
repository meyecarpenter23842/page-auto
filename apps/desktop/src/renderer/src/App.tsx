import { useEffect, useMemo, useState } from 'react'
import type { AppInfo } from '../../ipc/channels'
import { AccountManager } from './accounts/AccountManager'
import { ContentLibraryHub } from './content-library/ContentLibraryHub'
import { HotmailAuto } from './hotmail/HotmailAuto'
import { ExecutionLogs } from './logs/ExecutionLogs'
import { PageBusinessWorkspace } from './page-tabs/PageBusinessWorkspace'
import { RotationWindowStatusPanel } from './page-tabs/RotationWindowStatusPanel'
import { ScenarioWorkspace } from './scenarios/ScenarioWorkspace'
import { SettingsPanel } from './settings/SettingsPanel'
import './globalBrowserDock.css'

type RouteId = 'overview' | 'accounts' | 'hotmail' | 'content-library' | 'page-tabs' | 'scenarios' | 'logs' | 'settings'

interface Route { id: RouteId; label: string }

const routes: Route[] = [
  { id: 'overview', label: 'Tổng quan' },
  { id: 'accounts', label: 'Tài khoản' },
  { id: 'hotmail', label: 'Email' },
  { id: 'content-library', label: 'Bài viết' },
  { id: 'page-tabs', label: 'Page Tabs' },
  { id: 'scenarios', label: 'Kịch Bản' },
  { id: 'logs', label: 'Nhật ký' },
  { id: 'settings', label: 'Cài đặt' }
]

const routeDescriptions: Record<RouteId, { title: string; description: string }> = {
  overview: { title: 'Tổng quan', description: 'Phase 9 đóng gói PAGE-AUTO thành Windows portable folder/ZIP, giữ data cạnh executable và bổ sung backup/restore config không chứa plaintext secret.' },
  accounts: { title: 'Account Manager', description: 'Quản lý account theo data-grid nhiều cột, import linh hoạt và persistent browser profile riêng.' },
  hotmail: { title: 'Email', description: 'Dashboard Email theo UID từ Account Manager, Microsoft Mail.Read, external profile root trực tiếp, mail khôi phục và Proxy Email pool độc lập.' },
  'content-library': { title: 'Thư viện Bài viết', description: 'Quản lý kho bài viết dùng chung và tạo nội dung AI trước khi lưu vào cùng thư viện gốc.' },
  'page-tabs': { title: 'Page Tabs', description: 'Mỗi Page UID là một workspace đa nghiệp vụ: Nhóm, Đăng Tường, Sửa Page và các tác vụ mở rộng dùng chung tầng Facebook.' },
  scenarios: { title: 'Kịch Bản', description: 'Chọn tài khoản, chọn nhiều kịch bản và chuẩn bị cấu hình chạy; thư viện action vẫn được quản lý riêng, không gắn Page vào runner này.' },
  logs: { title: 'Runtime Logs', description: 'Execution log chi tiết, screenshot evidence, retry disposition và manual-review cho kết quả publish chưa chắc chắn.' },
  settings: { title: 'Cài đặt', description: 'Cấu hình trình duyệt, session, mạng, vận hành và chẩn đoán dùng chung cho PAGE-AUTO.' }
}

function RouteIcon({ id }: { id: RouteId }) {
  const common = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  if (id === 'hotmail') return <svg {...common}><path d="M3.5 6.5h17v11h-17z" /><path d="m4 7 8 6 8-6" /></svg>
  if (id === 'content-library') return <svg {...common}><path d="M6 3.5h9l3 3v14H6z" /><path d="M15 3.5v4h4" /><path d="M9 11h6" /><path d="M9 15h6" /></svg>
  if (id === 'page-tabs') return <svg {...common}><path d="M5 4.5h12.5v14H5z" /><path d="M8.5 7.5h12v12h-12" /><path d="M8 9h6" /></svg>
  if (id === 'scenarios') return <svg {...common}><rect x="4" y="4" width="6" height="5" rx="1" /><rect x="14" y="15" width="6" height="5" rx="1" /><path d="M10 6.5h4a3 3 0 0 1 3 3V15" /><path d="m14.5 12.5 2.5 2.5 2.5-2.5" /></svg>
  if (id === 'accounts') return <svg {...common}><circle cx="9" cy="8" r="3" /><path d="M3.5 18c.5-3 2.4-4.5 5.5-4.5s5 1.5 5.5 4.5" /><path d="M16 7.5a2.5 2.5 0 0 1 0 5" /><path d="M16.5 14c2.1.4 3.4 1.7 4 4" /></svg>
  if (id === 'overview') return <svg {...common}><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></svg>
  if (id === 'logs') return <svg {...common}><path d="M6 5h12" /><path d="M6 10h12" /><path d="M6 15h8" /><path d="M6 20h10" /></svg>
  return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M12 3.5v2" /><path d="M12 18.5v2" /><path d="m5.9 5.9 1.4 1.4" /><path d="m16.7 16.7 1.4 1.4" /><path d="M3.5 12h2" /><path d="M18.5 12h2" /><path d="m5.9 18.1 1.4-1.4" /><path d="m16.7 7.3 1.4-1.4" /></svg>
}

export function App() {
  const [activeRoute, setActiveRoute] = useState<RouteId>('page-tabs')
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [browserDockOpening, setBrowserDockOpening] = useState(false)
  const active = useMemo(() => routeDescriptions[activeRoute], [activeRoute])

  useEffect(() => { void window.pageAuto.getAppInfo().then(setAppInfo) }, [])

  const openBrowserDock = async () => {
    if (browserDockOpening) return
    setBrowserDockOpening(true)
    try {
      await window.pageAuto.openAccountBrowserDock()
    } catch (cause) {
      console.error('[PAGE-AUTO browser-dock] open failed', cause)
    } finally {
      setBrowserDockOpening(false)
    }
  }

  const workspaceClass = activeRoute === 'page-tabs'
    ? 'workspace workspace-page-tabs'
    : activeRoute === 'settings'
      ? 'workspace workspace-settings'
      : activeRoute === 'content-library'
        ? 'workspace workspace-content-library'
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
                <span className="nav-icon"><RouteIcon id={route.id} /></span>
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

      {activeRoute === 'page-tabs' ? <RotationWindowStatusPanel /> : null}

      <main key={activeRoute} className={`${workspaceClass} workspace-transition`}>
        <header className="topbar">
          <div><p className="eyebrow">PAGE-AUTO / {activeRoute === 'hotmail' ? 'EMAIL' : activeRoute === 'scenarios' ? 'KỊCH BẢN' : activeRoute === 'content-library' ? 'BÀI VIẾT' : activeRoute.toUpperCase()}</p><h1>{active.title}</h1></div>
          <div className="topbar-actions">
            <button className="button secondary global-browser-dock-button" type="button" disabled={browserDockOpening} onClick={() => void openBrowserDock()}>{browserDockOpening ? 'Đang mở…' : 'Cửa sổ Chrome'}</button>
            <div className="version-badge">{appInfo ? `v${appInfo.version}` : 'Loading...'}</div>
          </div>
        </header>

        {activeRoute === 'accounts' ? <AccountManager /> : activeRoute === 'hotmail' ? <HotmailAuto /> : activeRoute === 'content-library' ? <ContentLibraryHub /> : activeRoute === 'page-tabs' ? <PageBusinessWorkspace /> : activeRoute === 'scenarios' ? <ScenarioWorkspace /> : activeRoute === 'logs' ? <ExecutionLogs /> : activeRoute === 'settings' ? <SettingsPanel appInfo={appInfo} /> : (
          <>
            <section className="hero-card"><div><span className="phase-badge">PHASE 9</span><h2>{active.title}</h2><p>{active.description}</p></div><div className="architecture-grid"><div><strong>Portable</strong><span>Folder + ZIP</span></div><div><strong>Executable</strong><span>PageAuto.exe</span></div><div><strong>Data</strong><span>Beside executable</span></div><div><strong>Backup</strong><span>Config · no secrets</span></div></div></section>
            <section className="content-card"><div className="section-heading"><div><p className="eyebrow">MVP packaging status</p><h2>Phase 9 hoàn thiện mô hình Windows portable</h2></div><span className="healthy-chip">Portable-ready architecture</span></div><div className="check-list"><div><span>01</span><div><strong>No installer</strong><p>Artifact mục tiêu là folder/ZIP portable, không tạo Setup/NSIS trong MVP.</p></div></div><div><span>02</span><div><strong>Stable data path</strong><p>SQLite, browser profile, logs và screenshots nằm trong data cạnh PageAuto.exe.</p></div></div><div><span>03</span><div><strong>Versioned migration</strong><p>Database cũ tiếp tục chạy migration version khi mở bằng bản app mới.</p></div></div><div><span>04</span><div><strong>Safe config backup</strong><p>Backup cấu hình không xuất password, cookie, 2FA hoặc browser profile.</p></div></div></div></section>
          </>
        )}
      </main>
    </div>
  )
}
