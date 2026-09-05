import { useEffect, useMemo, useState } from 'react'
import type { PageTabConfig, PageTabSummary } from '../../../shared/pageTabs'
import type { ScenarioRunnerAccountRuntime, ScenarioRunnerSnapshot } from '../../../shared/scenarioRunnerRuntime'
import type { ScenarioSummary } from '../../../shared/scenarios'
import { ScenarioManager } from '../scenarios/ScenarioManager'
import { DEFAULT_SCENARIO_RUNNER_SETTINGS, type ScenarioRunnerSettings } from '../scenarios/scenarioRunnerState'
import '../scenarios/scenarioRunnerDashboard.css'

interface PageScenarioWorkspaceProps {
  page: PageTabSummary
}

function runtimeLabel(runtime: ScenarioRunnerAccountRuntime | undefined): string {
  if (!runtime) return 'Chờ chạy'
  if (runtime.state === 'running') return 'Đang chạy'
  if (runtime.state === 'completed') return 'Hoàn tất'
  if (runtime.state === 'needs_attention') return 'Cần đăng nhập/xác minh'
  if (runtime.state === 'failed') return 'Có lỗi'
  if (runtime.state === 'stopped') return 'Đã dừng'
  return 'Chờ chạy'
}

export function PageScenarioWorkspace({ page }: PageScenarioWorkspaceProps) {
  const [mode, setMode] = useState<'runner' | 'manager'>('runner')
  const [config, setConfig] = useState<PageTabConfig | null>(null)
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([])
  const [selectedAccountIds, setSelectedAccountIds] = useState<number[]>([])
  const [selectedScenarioIds, setSelectedScenarioIds] = useState<number[]>([])
  const [settings, setSettings] = useState<ScenarioRunnerSettings>({ ...DEFAULT_SCENARIO_RUNNER_SETTINGS })
  const [runtime, setRuntime] = useState<ScenarioRunnerSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let active = true
    setLoaded(false)
    setError(null)
    void Promise.all([
      window.pageAuto.getPageTab({ id: page.id }),
      window.pageAuto.listScenarios(),
      window.pageAuto.getScenarioRunnerStatus()
    ]).then(([nextConfig, nextScenarios, nextRuntime]) => {
      if (!active) return
      if (!nextConfig) throw new Error(`Không tìm thấy Page canonical #${page.id}.`)
      setConfig(nextConfig)
      setScenarios(nextScenarios)
      setSelectedAccountIds(nextConfig.accounts.filter((item) => item.enabled).map((item) => item.accountId))
      setSelectedScenarioIds((current) => current.filter((id) => nextScenarios.some((item) => item.id === id)))
      setRuntime(nextRuntime)
      setLoaded(true)
    }).catch((cause) => {
      if (!active) return
      setError(cause instanceof Error ? cause.message : String(cause))
      setLoaded(true)
    })
    return () => { active = false }
  }, [page.id])

  const runtimeActive = runtime?.state === 'running' || runtime?.state === 'stopping'
  const runtimeBelongsToPage = runtime?.executionContext?.kind === 'page'
    && runtime.executionContext.pageTabId === page.id

  useEffect(() => {
    if (!runtimeActive) return
    let disposed = false
    const timer = window.setInterval(() => {
      void window.pageAuto.getScenarioRunnerStatus().then((next) => {
        if (!disposed) setRuntime(next)
      }).catch((cause) => {
        if (!disposed) setError(cause instanceof Error ? cause.message : String(cause))
      })
    }, 500)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [runtimeActive, runtime?.runId])

  const accountRuntime = useMemo(
    () => new Map((runtimeBelongsToPage ? runtime?.accountRuntimes ?? [] : []).map((item) => [item.accountId, item] as const)),
    [runtime, runtimeBelongsToPage]
  )
  const enabledAccounts = config?.accounts.filter((item) => item.enabled) ?? []
  const selectedScenarios = scenarios.filter((item) => selectedScenarioIds.includes(item.id))
  const commonRunnerBusyElsewhere = Boolean(runtimeActive && !runtimeBelongsToPage)
  const canStart = loaded
    && !runtimeActive
    && selectedAccountIds.length > 0
    && selectedScenarioIds.length > 0
    && Boolean(config)

  const toggleAccount = (accountId: number, checked: boolean) => {
    setSelectedAccountIds((current) => checked
      ? [...current.filter((id) => id !== accountId), accountId]
      : current.filter((id) => id !== accountId))
  }

  const start = async () => {
    if (!canStart || !config) return
    setError(null)
    try {
      const snapshot = await window.pageAuto.startScenarioRunner({
        accountIds: selectedAccountIds,
        scenarioIds: selectedScenarioIds,
        settings: { ...settings },
        executionContext: { kind: 'page', pageTabId: config.id, pageUid: config.pageUid }
      })
      setRuntime(snapshot)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const stop = async () => {
    if (!runtimeActive || !runtimeBelongsToPage) return
    setError(null)
    try {
      setRuntime(await window.pageAuto.stopScenarioRunner())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  if (mode === 'manager') {
    return (
      <section className="scenario-manager-mode">
        <div className="scenario-manager-mode-bar">
          <button type="button" onClick={() => setMode('runner')}>← Chạy Kịch Bản Page</button>
          <span>Đang dùng cùng thư viện Kịch bản/Action Registry với màn tài khoản.</span>
        </div>
        <ScenarioManager />
      </section>
    )
  }

  return (
    <section className="scenario-runner-page" aria-label={`Chạy Kịch Bản Page ${page.name}`}>
      <div className="scenario-runner-runtime-note">
        <strong>Page context: {page.name}</strong> · UID {page.pageUid}. Common Runtime luôn chuẩn bị session rồi switch + verify đúng Page trước mỗi action.
      </div>
      {error ? <div className="scenario-runner-error">{error}</div> : null}
      {commonRunnerBusyElsewhere ? <div className="scenario-runner-error">Common Scenario Runner đang bận ở Profile hoặc Page khác. Hãy chờ/dừng phiên đó trước.</div> : null}

      <div className="scenario-runner-grid">
        <section className="scenario-runner-panel runner-accounts-panel">
          <div className="scenario-runner-panel-head">
            <div><p>TÀI KHOẢN CANONICAL CỦA PAGE</p><h2>Danh sách tài khoản</h2></div>
            <span>{enabledAccounts.length}</span>
          </div>
          <div className="scenario-runner-toolbar">
            <button className="scenario-runner-button" type="button" disabled={runtimeActive || !enabledAccounts.length} onClick={() => setSelectedAccountIds(enabledAccounts.map((item) => item.accountId))}>Tất cả</button>
            <button className="scenario-runner-button" type="button" disabled={runtimeActive || !selectedAccountIds.length} onClick={() => setSelectedAccountIds([])}>Bỏ chọn</button>
          </div>
          <div className="scenario-runner-account-table-wrap">
            <table className="scenario-runner-account-table">
              <thead><tr><th aria-label="Chọn" /><th>Account</th><th>Name</th><th>Total</th><th>Success</th><th>Trạng thái</th></tr></thead>
              <tbody>
                {(config?.accounts ?? []).map((account) => {
                  const live = accountRuntime.get(account.accountId)
                  const checked = selectedAccountIds.includes(account.accountId)
                  return (
                    <tr key={account.accountId}>
                      <td><input type="checkbox" disabled={runtimeActive || !account.enabled} checked={checked} onChange={(event) => toggleAccount(account.accountId, event.target.checked)} /></td>
                      <td><strong>{account.uid}</strong></td>
                      <td>{account.name ?? '—'}</td>
                      <td>{live?.total ?? 0}</td>
                      <td>{live?.success ?? 0}</td>
                      <td><span className={`scenario-runner-status ${live?.state === 'failed' || live?.state === 'needs_attention' ? 'danger' : account.enabled ? 'ready' : 'muted'}`}><i />{account.enabled ? runtimeLabel(live) : 'Đã tắt trong Page'}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {loaded && !(config?.accounts.length) ? <div className="scenario-runner-empty">Page chưa có tài khoản canonical.</div> : null}
          </div>
          <div className="scenario-runner-panel-foot">
            <span>Đã chọn {selectedAccountIds.length} / {enabledAccounts.length} tài khoản đang bật</span>
            <span>Không dùng Account Picker riêng</span>
          </div>
        </section>

        <section className="scenario-runner-panel runner-settings-panel">
          <div className="scenario-runner-panel-head">
            <div><p>KỊCH BẢN DÙNG CHUNG</p><h2>Chọn kịch bản</h2></div>
            <button className="scenario-runner-link-button" type="button" disabled={runtimeActive} onClick={() => setMode('manager')}>Quản lý</button>
          </div>
          <div className="scenario-runner-settings-scroll">
            <div className="scenario-runner-section">
              <div className="scenario-runner-selected-list">
                {scenarios.map((scenario) => (
                  <label className="scenario-runner-picker-row scenario-picker-row" key={scenario.id}>
                    <input type="checkbox" disabled={runtimeActive} checked={selectedScenarioIds.includes(scenario.id)} onChange={(event) => setSelectedScenarioIds((current) => event.target.checked ? [...current, scenario.id] : current.filter((id) => id !== scenario.id))} />
                    <strong>{scenario.name}</strong>
                    <span>{scenario.actionCount} action</span>
                    <small>{scenario.randomActionOrder ? 'Action random' : 'Action tuần tự'}</small>
                  </label>
                ))}
                {!scenarios.length ? <div className="scenario-runner-empty compact">Chưa có kịch bản dùng chung.</div> : null}
              </div>
            </div>
            <div className="scenario-runner-section runner-parallel-row">
              <span>Số acc chạy song song</span>
              <input className="scenario-runner-number" type="number" min={1} max={100} disabled={runtimeActive} value={settings.parallelAccounts} onChange={(event) => setSettings((current) => ({ ...current, parallelAccounts: Math.max(1, Number(event.target.value) || 1) }))} />
            </div>
            <div className="scenario-runner-section scenario-runner-flow-box">
              <strong>Delay giữa action</strong>
              <div className="scenario-runner-form-row">
                <span>Thời gian</span>
                <small>từ (s)</small><input className="scenario-runner-number" type="number" min={0} max={3600} disabled={runtimeActive} value={settings.actionDelayMinSeconds} onChange={(event) => setSettings((current) => ({ ...current, actionDelayMinSeconds: Math.max(0, Number(event.target.value) || 0) }))} />
                <small>đến (s)</small><input className="scenario-runner-number" type="number" min={0} max={3600} disabled={runtimeActive} value={settings.actionDelayMaxSeconds} onChange={(event) => setSettings((current) => ({ ...current, actionDelayMaxSeconds: Math.max(current.actionDelayMinSeconds, Number(event.target.value) || 0) }))} />
              </div>
            </div>
          </div>
        </section>

        <section className="scenario-runner-panel runner-log-panel">
          <div className="scenario-runner-panel-head"><div><p>KHU VỰC CHẠY / LOG</p><h2>Runtime</h2></div></div>
          <div className="scenario-runner-log-box">
            {runtimeBelongsToPage && runtime?.logs.length ? runtime.logs.map((entry) => <p key={entry.id}>[{new Date(entry.at).toLocaleTimeString('vi-VN')}] {entry.accountId ? `ACC#${entry.accountId} · ` : ''}{entry.message}</p>) : <span>Chọn tài khoản + kịch bản rồi bấm Bắt đầu.</span>}
          </div>
          <div className="scenario-runner-actions-zone">
            <div className="scenario-runner-runtime-note">
              {runtimeBelongsToPage ? (runtime?.message ?? (runtimeActive ? `Đang chạy · ${runtime?.runId}` : 'Sẵn sàng')) : 'Sẵn sàng chạy bằng actor Page.'}
            </div>
            <div className="scenario-runner-main-actions">
              <button className="scenario-runner-start" type="button" disabled={!canStart} onClick={() => void start()}>▶ Bắt đầu</button>
              <button className="scenario-runner-stop" type="button" disabled={!runtimeActive || !runtimeBelongsToPage} onClick={() => void stop()}>■ Kết thúc</button>
            </div>
            <div className="scenario-runner-bottom-fields">
              <label><span>Kịch bản đã chọn</span><strong>{selectedScenarios.length}</strong></label>
              <label><span>Actor</span><strong>Page</strong></label>
            </div>
          </div>
        </section>
      </div>
    </section>
  )
}
