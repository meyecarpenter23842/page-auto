import { useEffect, useMemo, useState } from 'react'
import type {
  ProxyBuilderAuditResult,
  ProxyBuilderCapability,
  ProxyBuilderProvisionSnapshot,
  ProxyBuilderRuntimeAction
} from '../../../shared/proxyBuilder'
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

function ipv4Summary(capability: ProxyBuilderCapability | null): string {
  if (!capability) return 'Chưa kiểm tra'
  if (!capability.ipv4Addresses.length) return 'Không có'
  return `${capability.ipv4Addresses.length} IP · ${capability.supportsIpv4 ? 'Outbound OK' : 'Chưa đạt probe'}`
}

function ipv6Summary(capability: ProxyBuilderCapability | null): string {
  if (!capability) return 'Chưa kiểm tra'
  if (!capability.ipv6Addresses.length) return 'Không có'
  const prefixLength = capability.ipv6Prefix?.split('/')[1]
  return `${prefixLength ? `/${prefixLength}` : 'Global'} · ${capability.supportsIpv6 ? 'Outbound OK' : 'Chưa đạt probe'}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function phaseStep(snapshot: ProxyBuilderProvisionSnapshot | null, index: number): string {
  if (!snapshot) return index >= 2 ? 'Chờ' : 'Xong'
  const rank = { connecting: 0, preflight: 1, provisioning: 2, service: 3, self_test: 3, complete: 4, rollback: 3 }[snapshot.phase]
  if (snapshot.status === 'failed' || snapshot.status === 'cancelled') return index === rank ? snapshot.status === 'cancelled' ? 'Đã dừng' : 'Lỗi' : index < rank ? 'Xong' : 'Chờ'
  if (index < rank) return 'Xong'
  if (index === rank) return snapshot.status === 'completed' ? 'Xong' : 'Đang chạy'
  return 'Chờ'
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
  const [sshChecking, setSshChecking] = useState(false)
  const [sshAudit, setSshAudit] = useState<ProxyBuilderAuditResult | null>(null)
  const [provision, setProvision] = useState<ProxyBuilderProvisionSnapshot | null>(null)
  const [runtimeBusy, setRuntimeBusy] = useState(false)
  const [runtimeActive, setRuntimeActive] = useState<boolean | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const checkerCount = useMemo(
    () => checkerInput.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).length,
    [checkerInput]
  )
  const capability = sshAudit?.ok ? sshAudit.capability : null
  const provisionRunning = provision?.status === 'running'
  const sshStatus = sshChecking ? 'Đang kiểm tra…' : sshAudit?.ok ? 'SSH OK · capability đã cập nhật' : sshAudit ? sshAudit.message : 'Chưa kết nối'
  const progressPercent = provision?.percent ?? (sshChecking ? 20 : capability ? 40 : 0)
  const progressLabel = provision?.message ?? (sshChecking ? 'Đang audit VPS' : capability ? 'SSH + capability OK' : sshAudit ? 'Audit lỗi' : 'Chưa chạy')
  const results = provision?.results ?? []
  const selectedModeReady = proxyIpMode === 'ipv4'
    ? Boolean(capability?.supportsIpv4)
    : proxyIpMode === 'ipv6'
      ? Boolean(capability?.supportsIpv6)
      : Boolean(capability?.supportsIpv4 && capability?.supportsIpv6)

  useEffect(() => {
    if (!provisionRunning || !provision) return
    const timer = window.setInterval(() => {
      void window.pageAutoProxyBuilder.getProvisionStatus(provision.runId)
        .then((next) => {
          if (!next) return
          setProvision(next)
          if (next.status === 'completed') setRuntimeActive(true)
          if (next.status === 'failed' || next.status === 'cancelled') setNotice(next.message)
        })
        .catch((error) => setNotice(errorMessage(error)))
    }, 500)
    return () => window.clearInterval(timer)
  }, [provision?.runId, provisionRunning])

  const sshAuth = () => sshAuthMode === 'password'
    ? { type: 'password' as const, password: sshPassword }
    : { type: 'key' as const, privateKey: sshKey }

  const checkSsh = async () => {
    if (sshChecking || provisionRunning) return
    setSshChecking(true)
    setSshAudit(null)
    setNotice(null)
    try {
      const result = await window.pageAutoProxyBuilder.auditVps({ host, username: sshUser, auth: sshAuth(), startPort })
      setSshAudit(result)
      if (!result.ok) setNotice(result.message)
    } catch (error) {
      const message = errorMessage(error)
      setSshAudit({ ok: false, code: 'unknown', message })
      setNotice(message)
    } finally {
      setSshChecking(false)
    }
  }

  const createProxy = async () => {
    if (!capability || provisionRunning) return
    setNotice(null)
    try {
      const proxyAuth = proxyAuthMode === 'basic'
        ? { type: 'basic' as const, username: proxyUser, password: proxyPassword }
        : { type: 'none' as const }
      const next = await window.pageAutoProxyBuilder.startProvision({
        host,
        username: sshUser,
        auth: sshAuth(),
        startPort,
        ipMode: proxyIpMode,
        count: proxyCount,
        proxyAuth
      })
      setProvision(next)
      setRuntimeActive(null)
    } catch (error) {
      setNotice(errorMessage(error))
    }
  }

  const cancelProvision = async () => {
    if (!provisionRunning || !provision) return
    try {
      const next = await window.pageAutoProxyBuilder.cancelProvision(provision.runId)
      if (next) setProvision(next)
    } catch (error) {
      setNotice(errorMessage(error))
    }
  }

  const controlRuntime = async (action: ProxyBuilderRuntimeAction) => {
    if (runtimeBusy || provisionRunning) return
    setRuntimeBusy(true)
    setNotice(null)
    try {
      const result = await window.pageAutoProxyBuilder.controlRuntime({ host, username: sshUser, auth: sshAuth(), startPort, action })
      setRuntimeActive(result.active)
      setNotice(result.message)
    } catch (error) {
      setNotice(errorMessage(error))
    } finally {
      setRuntimeBusy(false)
    }
  }

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
                <div className="proxy-builder-section-heading"><strong>VPS / SSH</strong><span>Thông tin kết nối máy chủ</span></div>
                <div className="proxy-builder-fields proxy-builder-fields-vps">
                  <label>VPS IP / Host<input value={host} onChange={(event) => setHost(event.currentTarget.value)} placeholder="103.x.x.x" autoComplete="off" /></label>
                  <label>SSH User<input value={sshUser} onChange={(event) => setSshUser(event.currentTarget.value)} placeholder="root" autoComplete="off" /></label>
                  <label>SSH Auth<select value={sshAuthMode} onChange={(event) => setSshAuthMode(event.currentTarget.value as SshAuthMode)}><option value="password">Mật khẩu</option><option value="key">SSH Key</option></select></label>
                  {sshAuthMode === 'password' ? (
                    <label>SSH Password<input type="password" value={sshPassword} onChange={(event) => setSshPassword(event.currentTarget.value)} placeholder="••••••••" autoComplete="off" /></label>
                  ) : (
                    <label className="proxy-builder-field-wide">SSH Private Key<textarea value={sshKey} onChange={(event) => setSshKey(event.currentTarget.value)} placeholder="Paste private key..." rows={3} spellCheck={false} /></label>
                  )}
                </div>
                <div className="proxy-builder-inline-actions">
                  <button className="button secondary" type="button" disabled={sshChecking || provisionRunning} onClick={() => void checkSsh()}>Kiểm tra SSH</button>
                  <span className="proxy-builder-muted">{sshStatus}</span>
                </div>
              </div>

              <div className="proxy-builder-section">
                <div className="proxy-builder-section-heading"><strong>Proxy</strong><span>Chọn loại IP và dải port</span></div>
                <div className="proxy-builder-fields proxy-builder-fields-proxy">
                  <label>Loại Proxy<select value={proxyIpMode} onChange={(event) => setProxyIpMode(event.currentTarget.value as ProxyIpMode)}><option value="ipv4">IPv4</option><option value="ipv6">IPv6</option><option value="both">IPv4 + IPv6</option></select></label>
                  <label>Số lượng<input type="number" min={1} max={10000} value={proxyCount} onChange={(event) => setProxyCount(clampInteger(event.currentTarget.value, 1, 10000, 1))} /></label>
                  <label>Start Port<input type="number" min={1} max={65535} value={startPort} onChange={(event) => setStartPort(clampInteger(event.currentTarget.value, 1, 65535, 3128))} /></label>
                </div>
              </div>

              <div className="proxy-builder-section">
                <div className="proxy-builder-section-heading"><strong>Authentication</strong><span>Xác thực client dùng proxy</span></div>
                <div className="proxy-builder-fields proxy-builder-fields-auth">
                  <label>Chế độ<select value={proxyAuthMode} onChange={(event) => setProxyAuthMode(event.currentTarget.value as ProxyAuthMode)}><option value="basic">User / Password</option><option value="none">Không xác thực</option></select></label>
                  {proxyAuthMode === 'basic' ? <><label>Proxy User<input value={proxyUser} onChange={(event) => setProxyUser(event.currentTarget.value)} autoComplete="off" /></label><label>Proxy Password<input type="password" value={proxyPassword} onChange={(event) => setProxyPassword(event.currentTarget.value)} placeholder="••••••••" autoComplete="off" /></label></> : null}
                </div>
              </div>

              <div className="proxy-builder-create-actions">
                <button className="button primary" type="button" disabled={!capability || !selectedModeReady || provisionRunning || sshChecking} onClick={() => void createProxy()}>Tạo Proxy</button>
                <button className="button secondary" type="button" disabled={!provisionRunning} onClick={() => void cancelProvision()}>Dừng</button>
                <span>{capability ? selectedModeReady ? 'Capability hợp lệ; engine sẽ probe từng source IP và self-test mapping trước khi hoàn tất.' : 'VPS chưa đạt capability cho loại proxy đang chọn.' : 'Kiểm tra SSH trước khi tạo proxy.'}</span>
              </div>
            </section>

            <aside className="proxy-builder-panel proxy-builder-progress-panel" aria-label="Tiến trình tạo proxy">
              <div className="proxy-builder-progress-heading"><div><strong>Tiến trình</strong><span>{progressLabel}</span></div><span className="proxy-builder-progress-percent">{progressPercent}%</span></div>
              <div className="proxy-builder-progress-track"><span style={{ width: `${progressPercent}%` }} /></div>
              <ol className="proxy-builder-progress-list">
                {PROGRESS_STEPS.map((step, index) => <li key={step}><span className="proxy-builder-step-index">{index + 1}</span><div><strong>{step}</strong><small>{provision ? phaseStep(provision, index) : capability && index < 2 ? 'Xong' : sshChecking && index === 0 ? 'Đang chạy' : 'Chờ'}</small></div></li>)}
              </ol>
              <div className="proxy-builder-capability-summary">
                <span>IPv4</span><strong>{ipv4Summary(capability)}</strong>
                <span>IPv6</span><strong>{ipv6Summary(capability)}</strong>
                <span>Interface</span><strong>{capability?.defaultInterface ?? 'Auto'}</strong>
                {capability ? <><span>Public IPv4</span><strong>{capability.publicIpv4 ?? 'Không xác định'}</strong><span>OS</span><strong>{capability.os}</strong><span>Start Port</span><strong>{capability.startPortAvailable ? 'Trống' : 'Đang dùng'}</strong></> : null}
              </div>
            </aside>
          </div>

          <section className="proxy-builder-panel proxy-builder-results-panel">
            <div className="proxy-builder-result-toolbar">
              <div><strong>Danh sách Proxy</strong><span>{results.length} proxy</span></div>
              <div className="proxy-builder-inline-actions">
                {results.length ? <><button className="button secondary" type="button" disabled={runtimeBusy || provisionRunning} onClick={() => void controlRuntime('start')}>Start service</button><button className="button secondary" type="button" disabled={runtimeBusy || provisionRunning} onClick={() => void controlRuntime('stop')}>Stop service</button><button className="button secondary" type="button" disabled={runtimeBusy || provisionRunning} onClick={() => void controlRuntime('restart')}>Restart</button></> : null}
                <button className="button secondary" type="button" disabled>Test tất cả</button><button className="button secondary" type="button" disabled>Copy</button><button className="button secondary" type="button" disabled>Export TXT</button>
              </div>
            </div>
            <div className="proxy-builder-table-wrap">
              <table className="data-table proxy-builder-table">
                <thead><tr><th className="proxy-builder-check-column"><input type="checkbox" disabled aria-label="Chọn tất cả proxy" /></th><th>STT</th><th>Proxy</th><th>Type</th><th>Outbound IP</th><th>Status</th></tr></thead>
                <tbody>
                  {results.map((item, index) => <tr key={item.id}><td className="proxy-builder-check-column"><input type="checkbox" disabled aria-label={`Chọn proxy ${index + 1}`} /></td><td>{index + 1}</td><td>{item.authMode === 'basic' ? `${item.listenHost}:${item.port}:${item.username}:••••` : `${item.listenHost}:${item.port}`}</td><td>{item.type === 'ipv4' ? 'IPv4' : 'IPv6'}</td><td>{item.outboundIp}</td><td>{runtimeActive === false ? 'Đã dừng' : 'Sẵn sàng'}</td></tr>)}
                  {!results.length ? <tr><td colSpan={6} className="proxy-builder-empty">Chưa có proxy. Danh sách sẽ xuất hiện tại đây sau khi VPS được provision.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>
          {notice ? <div className="proxy-builder-notice">{notice}</div> : null}
        </>
      ) : (
        <section className="proxy-builder-checker-layout">
          <div className="proxy-builder-panel proxy-builder-checker-input">
            <div className="proxy-builder-result-toolbar"><div><strong>Proxy Checker</strong><span>{checkerCount} proxy đã nhập</span></div><div className="proxy-builder-inline-actions"><button className="button primary" type="button" disabled title="Proxy Checker network runtime được triển khai ở Batch 4.">Test</button><button className="button secondary" type="button" disabled>Dừng</button></div></div>
            <label>Danh sách proxy<textarea value={checkerInput} onChange={(event) => setCheckerInput(event.currentTarget.value)} placeholder="host:port:user:pass&#10;host:port" rows={7} spellCheck={false} /></label>
          </div>
          <section className="proxy-builder-panel proxy-builder-results-panel">
            <div className="proxy-builder-result-toolbar"><div><strong>Kết quả kiểm tra</strong><span>LIVE / DEAD · outbound IP · latency</span></div><div className="proxy-builder-inline-actions"><button className="button secondary" type="button" disabled>Copy LIVE</button><button className="button secondary" type="button" disabled>Export TXT</button></div></div>
            <div className="proxy-builder-table-wrap"><table className="data-table proxy-builder-table"><thead><tr><th className="proxy-builder-check-column"><input type="checkbox" disabled aria-label="Chọn tất cả kết quả proxy" /></th><th>Proxy</th><th>Live</th><th>Type</th><th>Outbound IP</th><th>Latency</th></tr></thead><tbody><tr><td colSpan={6} className="proxy-builder-empty">Chưa có kết quả kiểm tra.</td></tr></tbody></table></div>
          </section>
        </section>
      )}
    </section>
  )
}
