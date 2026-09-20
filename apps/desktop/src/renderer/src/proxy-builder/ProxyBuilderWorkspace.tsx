import { useEffect, useMemo, useState } from 'react'
import type {
  ProxyBuilderAuditResult,
  ProxyBuilderCapability,
  ProxyBuilderCheckerSnapshot,
  ProxyBuilderProvisionSnapshot,
  ProxyBuilderProxyAuth,
  ProxyBuilderProxyResult,
  ProxyBuilderRuntimeAction,
  ProxyBuilderSshDiagnostic
} from '../../../shared/proxyBuilder'
import { ProxyAccountBindingPanel } from './ProxyAccountBindingPanel'
import { ProxyInventoryPanel } from './ProxyInventoryPanel'
import './proxyBuilder.css'

type ProxyBuilderTab = 'create' | 'inventory' | 'accounts' | 'checker'
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

function ipv6CidrCapacity(cidr: string): number {
  const prefix = Number(cidr.split('/')[1])
  if (!Number.isInteger(prefix) || prefix < 0 || prefix >= 128) return 0
  const hostBits = 128 - prefix
  return hostBits >= 53 ? Number.MAX_SAFE_INTEGER : Math.max(0, (2 ** hostBits) - 1)
}

function ipv6Summary(capability: ProxyBuilderCapability | null): string {
  if (!capability) return 'Chưa kiểm tra'
  const assignedOciCidr = capability.ociIpv6Cidrs?.[0] ?? null
  const prefixLength = (assignedOciCidr ?? capability.ipv6Prefix)?.split('/')[1]
  if (assignedOciCidr) return `${prefixLength ? `/${prefixLength}` : 'Global'} · OCI CIDR sẵn`
  if (!capability.ipv6Addresses.length) return 'Không có'
  if (!capability.supportsIpv6 && capability.cloudProvider === 'oci') {
    return `${prefixLength ? `/${prefixLength}` : 'Global'} · OCI CIDR bootstrap`
  }
  return `${prefixLength ? `/${prefixLength}` : 'Global'} · ${capability.supportsIpv6 ? 'Outbound OK' : 'Chưa đạt probe'}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const RANDOM_AUTH_ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function randomAuthToken(length: number): string {
  const bytes = new Uint8Array(length)
  window.crypto.getRandomValues(bytes)
  return Array.from(bytes, (value) => RANDOM_AUTH_ALPHABET[value % RANDOM_AUTH_ALPHABET.length]).join('')
}

function quoteDiagnosticArg(value: string): string {
  return /\s/.test(value) ? JSON.stringify(value) : value
}

function formatSshDiagnostic(diagnostic: ProxyBuilderSshDiagnostic): string {
  const lines = [
    '=== Page-Auto SSH Diagnostic ===',
    `OpenSSH: ${diagnostic.version}`,
    `Binary: ${diagnostic.executable}`,
    `Key path: ${diagnostic.keyPath}`,
    `Key exists: ${diagnostic.keyExists ? 'yes' : 'no'}`,
    `Key size: ${diagnostic.keySize ?? 'unknown'}`,
    `Key fingerprint: ${diagnostic.keyFingerprint ?? 'unknown'}`,
    '',
    'Environment:',
    `SystemRoot=${diagnostic.environment.SystemRoot ?? ''}`,
    `WINDIR=${diagnostic.environment.WINDIR ?? ''}`,
    `PATH=${diagnostic.environment.PATH ?? ''}`,
    `USERPROFILE=${diagnostic.environment.USERPROFILE ?? ''}`,
    `HOME=${diagnostic.environment.HOME ?? ''}`
  ]

  for (const probe of diagnostic.probes) {
    lines.push(
      '',
      `--- ${probe.name} ---`,
      `Command: ${[diagnostic.executable, ...probe.args].map(quoteDiagnosticArg).join(' ')}`,
      `Exit code: ${probe.exitCode}`,
      `Offering: ${probe.offeredFingerprints.join(', ') || 'none'}`,
      `Server accepts: ${probe.acceptedFingerprints.join(', ') || 'none'}`,
      `Authenticated: ${probe.authenticated ? 'yes' : 'no'}`,
      'stderr:',
      probe.stderr || '(empty)'
    )
  }

  return lines.join('\n')
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
  const [sshKeyPath, setSshKeyPath] = useState('')
  const [sshKeyFileName, setSshKeyFileName] = useState('')
  const [sshKeyPassphrase, setSshKeyPassphrase] = useState('')
  const [proxyIpMode, setProxyIpMode] = useState<ProxyIpMode>('ipv6')
  const [proxyCount, setProxyCount] = useState(300)
  const [startPort, setStartPort] = useState(3128)
  const [proxyAuthMode, setProxyAuthMode] = useState<ProxyAuthMode>('basic')
  const [proxyUser, setProxyUser] = useState('proxy')
  const [proxyPassword, setProxyPassword] = useState('')
  const [checkerInput, setCheckerInput] = useState('')
  const [sshChecking, setSshChecking] = useState(false)
  const [sshAudit, setSshAudit] = useState<ProxyBuilderAuditResult | null>(null)
  const [sshDiagnosticOpen, setSshDiagnosticOpen] = useState(false)
  const [provision, setProvision] = useState<ProxyBuilderProvisionSnapshot | null>(null)
  const [runtimeBusy, setRuntimeBusy] = useState(false)
  const [runtimeActive, setRuntimeActive] = useState<boolean | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [createdExportAuth, setCreatedExportAuth] = useState<ProxyBuilderProxyAuth | null>(null)
  const [createdSelected, setCreatedSelected] = useState<Set<string>>(new Set())
  const [checker, setChecker] = useState<ProxyBuilderCheckerSnapshot | null>(null)
  const [checkerSubmitted, setCheckerSubmitted] = useState<string[]>([])
  const [checkerSelected, setCheckerSelected] = useState<Set<number>>(new Set())
  const [textBusy, setTextBusy] = useState(false)

  const checkerCount = useMemo(
    () => checkerInput.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).length,
    [checkerInput]
  )
  const capability = sshAudit?.ok ? sshAudit.capability : null
  const sshDiagnostic = sshAudit?.diagnostic ?? null
  const provisionRunning = provision?.status === 'running'
  const sshStatus = sshChecking ? 'Đang kiểm tra…' : sshAudit?.ok ? 'SSH OK · capability đã cập nhật' : sshAudit ? sshAudit.message : 'Chưa kết nối'
  const progressPercent = provision?.percent ?? (sshChecking ? 20 : capability ? 40 : 0)
  const progressLabel = provision?.message ?? (sshChecking ? 'Đang audit VPS' : capability ? 'SSH + capability OK' : sshAudit ? 'Audit lỗi' : 'Chưa chạy')
  const results = provision?.results ?? []
  const checkerResults = checker?.results ?? []
  const checkerRunning = checker?.status === 'running'
  const requiredIpv6Count = proxyIpMode === 'both' ? Math.max(1, proxyCount - 1) : proxyCount
  const assignedOciIpv6Cidr = capability?.cloudProvider === 'oci'
    ? (capability.ociIpv6Cidrs ?? []).find((cidr) => ipv6CidrCapacity(cidr) >= requiredIpv6Count) ?? null
    : null
  const needsOciIpv6Bootstrap = Boolean(
    capability?.cloudProvider === 'oci'
    && capability.ipv6Addresses.length > 0
    && !assignedOciIpv6Cidr
    && proxyIpMode !== 'ipv4'
  )
  const ipv6ModeReady = Boolean(capability?.supportsIpv6 || assignedOciIpv6Cidr || needsOciIpv6Bootstrap)
  const selectedModeReady = proxyIpMode === 'ipv4'
    ? Boolean(capability?.supportsIpv4)
    : proxyIpMode === 'ipv6'
      ? ipv6ModeReady
      : Boolean(capability?.supportsIpv4 && ipv6ModeReady)
  const cloudFirewallAction = provision?.cloudFirewallAction ?? null

  useEffect(() => {
    if (!provisionRunning || !provision) return
    const timer = window.setInterval(() => {
      void window.pageAutoProxyBuilder.getProvisionStatus(provision.runId)
        .then((next) => {
          if (!next) return
          setProvision(next)
          if (next.status === 'completed') {
            setRuntimeActive(true)
            setCreatedSelected(new Set(next.results.map((item) => item.id)))
          }
          if (next.status === 'failed' || next.status === 'cancelled') setNotice(next.message)
        })
        .catch((error) => setNotice(errorMessage(error)))
    }, 500)
    return () => window.clearInterval(timer)
  }, [provision?.runId, provisionRunning])

  useEffect(() => {
    if (!checkerRunning || !checker) return
    const timer = window.setInterval(() => {
      void window.pageAutoProxyBuilder.getCheckerStatus(checker.runId)
        .then((next) => {
          if (!next) return
          setChecker(next)
          if (next.status !== 'running') {
            const liveIndexes = next.results.filter((item) => item.status === 'live').map((item) => item.index)
            setCheckerSelected(new Set(liveIndexes))
          }
        })
        .catch((error) => setNotice(errorMessage(error)))
    }, 350)
    return () => window.clearInterval(timer)
  }, [checker?.runId, checkerRunning])

  const sshAuth = () => sshAuthMode === 'password'
    ? { type: 'password' as const, password: sshPassword }
    : {
        type: 'key' as const,
        privateKey: sshKey,
        ...(sshKeyPath ? { privateKeyPath: sshKeyPath } : {}),
        ...(sshKeyPassphrase ? { passphrase: sshKeyPassphrase } : {})
      }

  const randomizeProxyAuth = () => {
    setProxyUser('pa_' + randomAuthToken(8))
    setProxyPassword(randomAuthToken(20))
  }

  const startProvisionRequest = async () => {
    if (!capability || provisionRunning) return
    setNotice(null)
    try {
      const proxyAuth: ProxyBuilderProxyAuth = proxyAuthMode === 'basic'
        ? { type: 'basic', username: proxyUser, password: proxyPassword }
        : { type: 'none' }
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
      setCreatedExportAuth(proxyAuth)
      setCreatedSelected(new Set())
      setRuntimeActive(null)
    } catch (error) {
      setNotice(errorMessage(error))
    }
  }

  const pickSshKeyFile = async () => {
    if (sshChecking || provisionRunning) return
    setNotice(null)
    try {
      const result = await window.pageAutoProxyBuilder.pickPrivateKey()
      if (result.cancelled || !result.path) return
      setSshKeyPath(result.path)
      setSshKeyFileName(result.fileName ?? 'SSH key')
      setSshKey('')
      setSshAudit(null)
      setSshDiagnosticOpen(false)
    } catch (error) {
      setNotice(errorMessage(error))
    }
  }

  const checkSsh = async () => {
    if (sshChecking || provisionRunning) return
    setSshChecking(true)
    setSshAudit(null)
    setNotice(null)
    try {
      const result = await window.pageAutoProxyBuilder.auditVps({ host, username: sshUser, auth: sshAuth(), startPort })
      setSshAudit(result)
      setSshDiagnosticOpen(Boolean(result.diagnostic && !result.ok))
      if (!result.ok) setNotice(result.message)
    } catch (error) {
      const message = errorMessage(error)
      setSshAudit({ ok: false, code: 'unknown', message })
      setSshDiagnosticOpen(false)
      setNotice(message)
    } finally {
      setSshChecking(false)
    }
  }

  const createProxy = async () => startProvisionRequest()

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

  const formatCreatedProxy = (item: ProxyBuilderProxyResult): string => {
    if (item.authMode !== 'basic') return `${item.listenHost}:${item.port}`
    if (createdExportAuth?.type !== 'basic') return ''
    return `${item.listenHost}:${item.port}:${createdExportAuth.username}:${createdExportAuth.password}`
  }

  const normalizeCheckerInput = (): string[] =>
    checkerInput.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)

  const startChecker = async (lines: string[]) => {
    const proxies = lines.map((line) => line.trim()).filter(Boolean)
    if (!proxies.length || checkerRunning) return
    setNotice(null)
    setActiveTab('checker')
    try {
      const next = await window.pageAutoProxyBuilder.startChecker({ proxies, concurrency: 20, timeoutMs: 12_000, retries: 1 })
      setCheckerSubmitted(proxies)
      setChecker(next)
      setCheckerSelected(new Set(next.results.map((item) => item.index)))
    } catch (error) {
      setNotice(errorMessage(error))
    }
  }

  const cancelChecker = async () => {
    if (!checkerRunning || !checker) return
    try {
      const next = await window.pageAutoProxyBuilder.cancelChecker(checker.runId)
      if (next) setChecker(next)
    } catch (error) {
      setNotice(errorMessage(error))
    }
  }

  const createdLines = (selectedOnly: boolean): string[] =>
    results
      .filter((item) => !selectedOnly || createdSelected.has(item.id))
      .map(formatCreatedProxy)
      .filter(Boolean)

  const saveCreatedToInventory = async () => {
    const items = results.flatMap((item) => {
      const rawProxy = formatCreatedProxy(item)
      if (!rawProxy) return []
      return [{
        rawProxy,
        ipFamily: item.type,
        outboundIp: item.outboundIp,
        status: item.status === 'ready' ? 'live' as const : item.status === 'error' ? 'dead' as const : 'unknown' as const,
        sourceKind: 'builder' as const,
        sourceLabel: host.trim() || null,
        lastCheckedAt: item.status === 'ready' || item.status === 'error' ? Date.now() : null
      }]
    })
    if (!items.length) {
      setNotice('Không có proxy hợp lệ để lưu vào Kho Proxy.')
      return
    }
    try {
      const saved = await window.pageAutoProxyBuilder.upsertInventory({ items })
      setNotice(`Đã lưu ${saved.inserted + saved.updated} proxy vào Kho Proxy.`)
      setActiveTab('inventory')
    } catch (error) {
      setNotice(errorMessage(error))
    }
  }

  const checkerLines = (onlyLive: boolean, selectedOnly: boolean): string[] =>
    checkerResults
      .filter((item) => (!onlyLive || item.status === 'live') && (!selectedOnly || checkerSelected.has(item.index)))
      .map((item) => checkerSubmitted[item.index] ?? '')
      .filter(Boolean)

  const copyLines = async (lines: string[]) => {
    if (!lines.length || textBusy) return
    setTextBusy(true)
    try {
      await window.pageAutoProxyBuilderText.copy(lines.join('\n'))
      setNotice(`Đã copy ${lines.length} proxy.`)
    } catch (error) {
      setNotice(errorMessage(error))
    } finally {
      setTextBusy(false)
    }
  }

  const copySshDiagnostic = async () => {
    if (!sshDiagnostic || textBusy) return
    setTextBusy(true)
    try {
      await window.pageAutoProxyBuilderText.copy(formatSshDiagnostic(sshDiagnostic))
      setNotice('Đã copy log SSH.')
    } catch (error) {
      setNotice(errorMessage(error))
    } finally {
      setTextBusy(false)
    }
  }

  const exportLines = async (lines: string[], suggestedName: string) => {
    if (!lines.length || textBusy) return
    setTextBusy(true)
    try {
      const result = await window.pageAutoProxyBuilderText.export(lines.join('\n'), suggestedName)
      if (!result.cancelled) setNotice(`Đã xuất ${lines.length} proxy.`)
    } catch (error) {
      setNotice(errorMessage(error))
    } finally {
      setTextBusy(false)
    }
  }

  const toggleCreated = (id: string) => {
    setCreatedSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleChecker = (index: number) => {
    setCheckerSelected((current) => {
      const next = new Set(current)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  return (
    <section className="proxy-builder-shell" data-testid="proxy-builder-workspace">
      <nav className="proxy-builder-tabs" role="tablist" aria-label="Proxy Center">
        <button type="button" role="tab" aria-selected={activeTab === 'create'} className={activeTab === 'create' ? 'active' : ''} onClick={() => setActiveTab('create')}>Tạo Proxy</button>
        <button type="button" role="tab" aria-selected={activeTab === 'inventory'} className={activeTab === 'inventory' ? 'active' : ''} onClick={() => setActiveTab('inventory')}>Kho Proxy</button>
        <button type="button" role="tab" aria-selected={activeTab === 'accounts'} className={activeTab === 'accounts' ? 'active' : ''} onClick={() => setActiveTab('accounts')}>Gán Account</button>
        <button type="button" role="tab" aria-selected={activeTab === 'checker'} className={activeTab === 'checker' ? 'active' : ''} onClick={() => setActiveTab('checker')}>Proxy Checker</button>
      </nav>

      {activeTab === 'inventory' ? (
        <ProxyInventoryPanel />
      ) : activeTab === 'accounts' ? (
        <ProxyAccountBindingPanel />
      ) : activeTab === 'create' ? (
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
                    <>
                      <label className="proxy-builder-field-wide">SSH Private Key<textarea value={sshKey} onChange={(event) => { setSshKey(event.currentTarget.value); setSshKeyPath(''); setSshKeyFileName('') }} placeholder={sshKeyFileName ? 'Đang dùng file key đã chọn trong Electron Main.' : 'Paste private key...'} rows={3} spellCheck={false} /></label>
                      <div className="proxy-builder-field-wide proxy-builder-inline-actions">
                        <button className="button secondary" type="button" disabled={sshChecking || provisionRunning} onClick={() => void pickSshKeyFile()}>Chọn file key</button>
                        <span className="proxy-builder-muted">{sshKeyFileName ? `Đã chọn: ${sshKeyFileName}` : 'Có thể paste key hoặc chọn file trực tiếp.'}</span>
                      </div>
                      <label className="proxy-builder-field-wide">Key Passphrase (nếu có)<input type="password" value={sshKeyPassphrase} onChange={(event) => setSshKeyPassphrase(event.currentTarget.value)} placeholder="Để trống nếu key không mã hóa" autoComplete="off" /></label>
                    </>
                  )}
                </div>
                <div className="proxy-builder-inline-actions">
                  <button className="button secondary" type="button" disabled={sshChecking || provisionRunning} onClick={() => void checkSsh()}>Kiểm tra SSH</button>
                  <span className="proxy-builder-muted">{sshStatus}</span>
                </div>
                {sshDiagnostic ? (
                  <div className="proxy-builder-ssh-diagnostic">
                    <div className="proxy-builder-inline-actions">
                      <button className="button secondary" type="button" onClick={() => setSshDiagnosticOpen((value) => !value)}>
                        {sshDiagnosticOpen ? 'Ẩn chi tiết SSH' : 'Chi tiết SSH'}
                      </button>
                      <button className="button secondary" type="button" disabled={textBusy} onClick={() => void copySshDiagnostic()}>Copy log SSH</button>
                      <span className="proxy-builder-muted">Fingerprint: {sshDiagnostic.keyFingerprint ?? 'không đọc được'}</span>
                    </div>
                    {sshDiagnosticOpen ? <pre>{formatSshDiagnostic(sshDiagnostic)}</pre> : null}
                  </div>
                ) : null}
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
                  {proxyAuthMode === 'basic' ? <><label>Proxy User<input value={proxyUser} onChange={(event) => setProxyUser(event.currentTarget.value)} autoComplete="off" /></label><label>Proxy Password<input type="password" value={proxyPassword} onChange={(event) => setProxyPassword(event.currentTarget.value)} placeholder="••••••••" autoComplete="off" /></label><div className="proxy-builder-inline-actions"><button className="button secondary" type="button" onClick={randomizeProxyAuth}>Random User/Pass</button></div></> : null}
                </div>
              </div>

              <div className="proxy-builder-create-actions">
                <button className="button primary" type="button" disabled={!capability || !selectedModeReady || provisionRunning || sshChecking} onClick={() => void createProxy()}>Tạo Proxy</button>
                <button className="button secondary" type="button" disabled={!provisionRunning} onClick={() => void cancelProvision()}>Dừng</button>
                <span>{capability
                  ? selectedModeReady
                    ? needsOciIpv6Bootstrap
                      ? 'OCI đang có IPv6 /128; Page-Auto sẽ tự kiểm tra route và tự cấp dải khi thật sự cần.'
                      : 'Capability hợp lệ; app tự tạo proxy, xử lý host firewall và test từ Windows.'
                    : 'VPS chưa đạt capability cho loại proxy đang chọn.'
                  : 'Kiểm tra SSH trước khi tạo proxy.'}</span>
              </div>
              {needsOciIpv6Bootstrap ? (
                <div className="proxy-builder-inline-actions">
                  <span className="proxy-builder-muted">Không cần chọn file OCI. App ưu tiên dải đã route/gán sẵn, sau đó mới dùng OCI API tự động.</span>
                </div>
              ) : cloudFirewallAction?.provider === 'oci' ? (
                <div className="proxy-builder-inline-actions">
                  <span className="proxy-builder-muted">{cloudFirewallAction.message}</span>
                </div>
              ) : null}
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
                <button className="button secondary" type="button" disabled={!results.length || provisionRunning} onClick={() => void saveCreatedToInventory()}>Lưu vào Kho</button>
                <button className="button secondary" type="button" disabled={!createdSelected.size || checkerRunning} onClick={() => void startChecker(createdLines(true))}>Test đã chọn</button>
                <button className="button secondary" type="button" disabled={!results.length || checkerRunning} onClick={() => void startChecker(createdLines(false))}>Test tất cả</button>
                <button className="button secondary" type="button" disabled={!results.length || textBusy} onClick={() => void copyLines(createdLines(Boolean(createdSelected.size)))}>Copy</button>
                <button className="button secondary" type="button" disabled={!results.length || textBusy} onClick={() => void exportLines(createdLines(Boolean(createdSelected.size)), 'page-auto-proxies.txt')}>Export TXT</button>
              </div>
            </div>
            <div className="proxy-builder-table-wrap">
              <table className="data-table proxy-builder-table">
                <thead><tr><th className="proxy-builder-check-column"><input type="checkbox" disabled={!results.length} checked={Boolean(results.length) && createdSelected.size === results.length} onChange={(event) => setCreatedSelected(event.currentTarget.checked ? new Set(results.map((item) => item.id)) : new Set())} aria-label="Chọn tất cả proxy" /></th><th>STT</th><th>Proxy</th><th>Type</th><th>Outbound IP</th><th>Status</th></tr></thead>
                <tbody>
                  {results.map((item, index) => <tr key={item.id}><td className="proxy-builder-check-column"><input type="checkbox" checked={createdSelected.has(item.id)} onChange={() => toggleCreated(item.id)} aria-label={`Chọn proxy ${index + 1}`} /></td><td>{index + 1}</td><td>{item.authMode === 'basic' ? `${item.listenHost}:${item.port}:${item.username}:••••` : `${item.listenHost}:${item.port}`}</td><td>{item.type === 'ipv4' ? 'IPv4' : 'IPv6'}</td><td>{item.outboundIp}</td><td>{runtimeActive === false ? 'Đã dừng' : item.status === 'ready' ? 'LIVE' : item.status === 'error' ? 'Không truy cập được' : 'Đã dừng'}</td></tr>)}
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
            <div className="proxy-builder-result-toolbar">
              <div><strong>Proxy Checker</strong><span>{checkerCount} proxy đã nhập · 20 luồng · timeout 12s · retry 1</span></div>
              <div className="proxy-builder-inline-actions">
                <button className="button primary" type="button" disabled={!checkerCount || checkerRunning} onClick={() => void startChecker(normalizeCheckerInput())}>Test tất cả</button>
                <button className="button secondary" type="button" disabled={!checkerSelected.size || checkerRunning} onClick={() => void startChecker(checkerLines(false, true))}>Test đã chọn</button>
                <button className="button secondary" type="button" disabled={!checkerRunning} onClick={() => void cancelChecker()}>Dừng</button>
              </div>
            </div>
            <label>Danh sách proxy<textarea value={checkerInput} onChange={(event) => setCheckerInput(event.currentTarget.value)} disabled={checkerRunning} placeholder="host:port:user:pass&#10;host:port&#10;http://user:pass@host:port" rows={7} spellCheck={false} /></label>
          </div>
          <section className="proxy-builder-panel proxy-builder-results-panel">
            <div className="proxy-builder-result-toolbar">
              <div><strong>Kết quả kiểm tra</strong><span>{checker ? `${checker.live} LIVE · ${checker.dead} DEAD · ${checker.completed}/${checker.total}` : 'LIVE / DEAD · outbound IP · latency'}</span></div>
              <div className="proxy-builder-inline-actions">
                <button className="button secondary" type="button" disabled={!checkerResults.some((item) => item.status === 'live') || textBusy} onClick={() => void copyLines(checkerLines(true, false))}>Copy LIVE</button>
                <button className="button secondary" type="button" disabled={!checkerResults.some((item) => item.status === 'live') || textBusy} onClick={() => void exportLines(checkerLines(true, false), 'page-auto-live-proxies.txt')}>Export LIVE</button>
              </div>
            </div>
            <div className="proxy-builder-table-wrap">
              <table className="data-table proxy-builder-table">
                <thead><tr><th className="proxy-builder-check-column"><input type="checkbox" disabled={!checkerResults.length} checked={Boolean(checkerResults.length) && checkerSelected.size === checkerResults.length} onChange={(event) => setCheckerSelected(event.currentTarget.checked ? new Set(checkerResults.map((item) => item.index)) : new Set())} aria-label="Chọn tất cả kết quả proxy" /></th><th>Proxy</th><th>Live</th><th>Type</th><th>Outbound IP</th><th>Latency / lỗi</th></tr></thead>
                <tbody>
                  {checkerResults.map((item) => <tr key={item.index}><td className="proxy-builder-check-column"><input type="checkbox" checked={checkerSelected.has(item.index)} onChange={() => toggleChecker(item.index)} aria-label={`Chọn kết quả ${item.index + 1}`} /></td><td>{item.maskedProxy}</td><td><span className={`proxy-builder-live-badge ${item.status}`}>{item.status === 'live' ? 'LIVE' : item.status === 'dead' ? 'DEAD' : 'WAIT'}</span></td><td>{item.type ? item.type.toUpperCase() : '-'}</td><td>{item.outboundIp ?? '-'}</td><td>{item.latencyMs !== null ? `${item.latencyMs} ms` : item.error ?? '-'}</td></tr>)}
                  {!checkerResults.length ? <tr><td colSpan={6} className="proxy-builder-empty">Paste proxy rồi bấm Test tất cả. Checker sẽ request HTTPS thật xuyên proxy.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>
          {notice ? <div className="proxy-builder-notice">{notice}</div> : null}
        </section>
      )}
    </section>
  )
}
