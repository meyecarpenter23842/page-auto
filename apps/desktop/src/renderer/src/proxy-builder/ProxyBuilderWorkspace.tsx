import { useMemo, useState } from 'react'
import './proxyBuilder.css'

type ProxyBuilderTab = 'create' | 'checker'
type ProxyIpMode = 'ipv4' | 'ipv6' | 'both'
type SshAuthMode = 'password' | 'key'
type ProxyAuthMode = 'none' | 'basic'

const PROGRESS_STEPS = [
  'Kết nối VPS',
  'Kiểm tra IPv4 / IPv6',
  'Chuẩn bị proxy',
  'Tạo danh sách',
  'Hoàn tất'
] as const

function clampInteger(value: string, min: number, max: number, fallback: number): number {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

export function ProxyBuilderWorkspace() {
  const [activeTab, setActiveTab] = useState<ProxyBuilderTab>('create')
  const [host, setHost] = useState('')
  const [sshUser, setSshUser] = useState('root')
  const [sshAuthMode, setSshAuthMode] = useState<SshAuthMode>('password')
  const [sshPassword, setSshPassword] = useState('')
  const [sshKey, setSshKey] = useState('')
  const [proxyIpMode, setProxyIpMode] = useState<ProxyIpMode>('ipv6')
  const [proxyCount, setProxyCount] = useState(300)
  const [startPort, setStartPort] = useState(3128)
  const [proxyAuthMode, setProxyAuthMode] = useState<ProxyAuthMode>('basic')
  const [proxyUser, setProxyUser] = useState('proxy')
  const [proxyPassword, setProxyPassword] = useState('')
  const [checkerInput, setCheckerInput] = useState('')

  const checkerCount = useMemo(
    () => checkerInput.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).length,
    [checkerInput]
  )

  return (
    <section className="proxy-builder-shell" data-testid="proxy-builder-workspace">
      <nav className="proxy-builder-tabs" role="tablist" aria-label="Proxy Builder">
        <button type="button" role="tab" aria-selected={activeTab === 'create'} className={activeTab === 'create' ? 'active' : ''} onClick={() => setActiveTab('create')}>Tạo Proxy</button>
        <button type="button" role="tab" aria-selected={activeTab === 'checker'} className={activeTab === 'checker' ? 'active' : ''} onClick={() => setActiveTab('checker')}>Proxy Checker</button>
      </nav>

      {activeTab === 'create' ? (
        <>
          <div className="proxy-builder-config-layout">
            <section className="proxy-builder-panel proxy-builder-config-panel">
              <div className="proxy-builder-section">
                <div className="proxy-builder-section-heading">
                  <strong>VPS / SSH</strong>
                  <span>Thông tin kết nối máy chủ</span>
                </div>
                <div className="proxy-builder-fields proxy-builder-fields-vps">
                  <label>VPS IP / Host
                    <input value={host} onChange={(event) => setHost(event.currentTarget.value)} placeholder="103.x.x.x" autoComplete="off" />
                  </label>
                  <label>SSH User
                    <input value={sshUser} onChange={(event) => setSshUser(event.currentTarget.value)} placeholder="root" autoComplete="off" />
                  </label>
                  <label>SSH Auth
                    <select value={sshAuthMode} onChange={(event) => setSshAuthMode(event.currentTarget.value as SshAuthMode)}>
                      <option value="password">Mật khẩu</option>
                      <option value="key">SSH Key</option>
                    </select>
                  </label>
                  {sshAuthMode === 'password' ? (
                    <label>SSH Password
                      <input type="password" value={sshPassword} onChange={(event) => setSshPassword(event.currentTarget.value)} placeholder="••••••••" autoComplete="off" />
                    </label>
                  ) : (
                    <label className="proxy-builder-field-wide">SSH Private Key
                      <textarea value={sshKey} onChange={(event) => setSshKey(event.currentTarget.value)} placeholder="Paste private key..." rows={3} spellCheck={false} />
                    </label>
                  )}
                </div>
                <div className="proxy-builder-inline-actions">
                  <button className="button secondary" type="button" disabled title="SSH discovery được triển khai ở Batch 2.">Kiểm tra SSH</button>
                  <span className="proxy-builder-muted">Chưa kết nối</span>
                </div>
              </div>

              <div className="proxy-builder-section">
                <div className="proxy-builder-section-heading">
                  <strong>Proxy</strong>
                  <span>Chọn loại IP và dải port</span>
                </div>
                <div className="proxy-builder-fields proxy-builder-fields-proxy">
                  <label>Loại Proxy
                    <select value={proxyIpMode} onChange={(event) => setProxyIpMode(event.currentTarget.value as ProxyIpMode)}>
                      <option value="ipv4">IPv4</option>
                      <option value="ipv6">IPv6</option>
                      <option value="both">IPv4 + IPv6</option>
                    </select>
                  </label>
                  <label>Số lượng
                    <input type="number" min={1} max={10000} value={proxyCount} onChange={(event) => setProxyCount(clampInteger(event.currentTarget.value, 1, 10000, 1))} />
                  </label>
                  <label>Start Port
                    <input type="number" min={1} max={65535} value={startPort} onChange={(event) => setStartPort(clampInteger(event.currentTarget.value, 1, 65535, 3128))} />
                  </label>
                </div>
              </div>

              <div className="proxy-builder-section">
                <div className="proxy-builder-section-heading">
                  <strong>Authentication</strong>
                  <span>Xác thực client dùng proxy</span>
                </div>
                <div className="proxy-builder-fields proxy-builder-fields-auth">
                  <label>Chế độ
                    <select value={proxyAuthMode} onChange={(event) => setProxyAuthMode(event.currentTarget.value as ProxyAuthMode)}>
                      <option value="basic">User / Password</option>
                      <option value="none">Không xác thực</option>
                    </select>
                  </label>
                  {proxyAuthMode === 'basic' ? (
                    <>
                      <label>Proxy User
                        <input value={proxyUser} onChange={(event) => setProxyUser(event.currentTarget.value)} autoComplete="off" />
                      </label>
                      <label>Proxy Password
                        <input type="password" value={proxyPassword} onChange={(event) => setProxyPassword(event.currentTarget.value)} placeholder="••••••••" autoComplete="off" />
                      </label>
                    </>
                  ) : null}
                </div>
              </div>

              <div className="proxy-builder-create-actions">
                <button className="button primary" type="button" disabled title="Provision engine được triển khai ở Batch 3.">Tạo Proxy</button>
                <button className="button secondary" type="button" disabled>Dừng</button>
                <span>IPv4 / IPv6 sẽ được auto-detect từ VPS; thông số network chi tiết không lộ ra màn chính.</span>
              </div>
            </section>

            <aside className="proxy-builder-panel proxy-builder-progress-panel" aria-label="Tiến trình tạo proxy">
              <div className="proxy-builder-progress-heading">
                <div><strong>Tiến trình</strong><span>Chưa chạy</span></div>
                <span className="proxy-builder-progress-percent">0%</span>
              </div>
              <div className="proxy-builder-progress-track"><span /></div>
              <ol className="proxy-builder-progress-list">
                {PROGRESS_STEPS.map((step, index) => (
                  <li key={step}>
                    <span className="proxy-builder-step-index">{index + 1}</span>
                    <div><strong>{step}</strong><small>Chờ</small></div>
                  </li>
                ))}
              </ol>
              <div className="proxy-builder-capability-summary">
                <span>IPv4</span><strong>Chưa kiểm tra</strong>
                <span>IPv6</span><strong>Chưa kiểm tra</strong>
                <span>Interface</span><strong>Auto</strong>
              </div>
            </aside>
          </div>

          <section className="proxy-builder-panel proxy-builder-results-panel">
            <div className="proxy-builder-result-toolbar">
              <div><strong>Danh sách Proxy</strong><span>0 proxy</span></div>
              <div className="proxy-builder-inline-actions">
                <button className="button secondary" type="button" disabled>Test tất cả</button>
                <button className="button secondary" type="button" disabled>Copy</button>
                <button className="button secondary" type="button" disabled>Export TXT</button>
              </div>
            </div>
            <div className="proxy-builder-table-wrap">
              <table className="data-table proxy-builder-table">
                <thead><tr><th className="proxy-builder-check-column"><input type="checkbox" disabled aria-label="Chọn tất cả proxy" /></th><th>STT</th><th>Proxy</th><th>Type</th><th>Outbound IP</th><th>Status</th></tr></thead>
                <tbody><tr><td colSpan={6} className="proxy-builder-empty">Chưa có proxy. Danh sách sẽ xuất hiện tại đây sau khi VPS được provision.</td></tr></tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <section className="proxy-builder-checker-layout">
          <div className="proxy-builder-panel proxy-builder-checker-input">
            <div className="proxy-builder-result-toolbar">
              <div><strong>Proxy Checker</strong><span>{checkerCount} proxy đã nhập</span></div>
              <div className="proxy-builder-inline-actions">
                <button className="button primary" type="button" disabled title="Proxy Checker network runtime được triển khai ở Batch 4.">Test</button>
                <button className="button secondary" type="button" disabled>Dừng</button>
              </div>
            </div>
            <label>Danh sách proxy
              <textarea value={checkerInput} onChange={(event) => setCheckerInput(event.currentTarget.value)} placeholder="host:port:user:pass&#10;host:port" rows={7} spellCheck={false} />
            </label>
          </div>

          <section className="proxy-builder-panel proxy-builder-results-panel">
            <div className="proxy-builder-result-toolbar">
              <div><strong>Kết quả kiểm tra</strong><span>LIVE / DEAD · outbound IP · latency</span></div>
              <div className="proxy-builder-inline-actions">
                <button className="button secondary" type="button" disabled>Copy LIVE</button>
                <button className="button secondary" type="button" disabled>Export TXT</button>
              </div>
            </div>
            <div className="proxy-builder-table-wrap">
              <table className="data-table proxy-builder-table">
                <thead><tr><th className="proxy-builder-check-column"><input type="checkbox" disabled aria-label="Chọn tất cả kết quả proxy" /></th><th>Proxy</th><th>Live</th><th>Type</th><th>Outbound IP</th><th>Latency</th></tr></thead>
                <tbody><tr><td colSpan={6} className="proxy-builder-empty">Chưa có kết quả kiểm tra.</td></tr></tbody>
              </table>
            </div>
          </section>
        </section>
      )}
    </section>
  )
}
