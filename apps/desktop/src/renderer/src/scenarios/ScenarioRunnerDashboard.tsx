import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AccountRecord, AccountStatus } from '../../../shared/accounts'
import type { ScenarioSummary } from '../../../shared/scenarios'
import {
  DEFAULT_SCENARIO_RUNNER_STATE,
  moveId,
  normalizeScenarioRunnerState,
  type ScenarioRunnerPersistedState,
  type ScenarioRunnerSettings
} from './scenarioRunnerState'
import './scenarioRunnerDashboard.css'

const STORAGE_KEY = 'page-auto.scenario-runner.v1'

interface ScenarioRunnerDashboardProps {
  onOpenManager: () => void
}

interface StatusMeta {
  label: string
  tone: 'ready' | 'waiting' | 'danger' | 'muted'
}

function loadPersistedState(): ScenarioRunnerPersistedState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? normalizeScenarioRunnerState(JSON.parse(raw)) : normalizeScenarioRunnerState(DEFAULT_SCENARIO_RUNNER_STATE)
  } catch {
    return normalizeScenarioRunnerState(DEFAULT_SCENARIO_RUNNER_STATE)
  }
}

function statusMeta(status: AccountStatus): StatusMeta {
  if (status === 'valid') return { label: 'Sẵn sàng', tone: 'ready' }
  if (status === 'needs_login') return { label: 'Cần đăng nhập', tone: 'danger' }
  if (status === 'disabled') return { label: 'Đã tắt', tone: 'muted' }
  return { label: 'Chưa kiểm tra', tone: 'waiting' }
}

function NumberField({ value, min, max, disabled, onChange }: {
  value: number
  min?: number
  max?: number
  disabled?: boolean
  onChange: (value: number) => void
}) {
  return (
    <input
      className="scenario-runner-number"
      type="number"
      min={min}
      max={max}
      disabled={disabled}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  )
}

function PickerModal({ title, subtitle, query, setQuery, count, onClose, onApply, children }: {
  title: string
  subtitle: string
  query: string
  setQuery: (value: string) => void
  count: number
  onClose: () => void
  onApply: () => void
  children: ReactNode
}) {
  return (
    <div className="scenario-runner-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="scenario-runner-modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <div className="scenario-runner-modal-head">
          <div><p>{subtitle}</p><h3>{title}</h3></div>
          <button type="button" onClick={onClose}>×</button>
        </div>
        <label className="scenario-runner-picker-search">
          <span>⌕</span>
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm nhanh..." />
        </label>
        <div className="scenario-runner-picker-body">{children}</div>
        <div className="scenario-runner-modal-actions">
          <span>Đã chọn {count}</span>
          <button className="scenario-runner-button" type="button" onClick={onClose}>Hủy</button>
          <button className="scenario-runner-button primary" type="button" onClick={onApply}>Áp dụng</button>
        </div>
      </section>
    </div>
  )
}

export function ScenarioRunnerDashboard({ onOpenManager }: ScenarioRunnerDashboardProps) {
  const [initial] = useState(loadPersistedState)
  const [accounts, setAccounts] = useState<AccountRecord[]>([])
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([])
  const [selectedAccountIds, setSelectedAccountIds] = useState(initial.selectedAccountIds)
  const [enabledAccountIds, setEnabledAccountIds] = useState(initial.enabledAccountIds)
  const [selectedScenarioIds, setSelectedScenarioIds] = useState(initial.selectedScenarioIds)
  const [settings, setSettings] = useState<ScenarioRunnerSettings>(initial.settings)
  const [proxyText, setProxyText] = useState('')
  const [inventoryLoaded, setInventoryLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [accountPickerOpen, setAccountPickerOpen] = useState(false)
  const [scenarioPickerOpen, setScenarioPickerOpen] = useState(false)
  const [accountPickerQuery, setAccountPickerQuery] = useState('')
  const [scenarioPickerQuery, setScenarioPickerQuery] = useState('')
  const [accountPickerDraft, setAccountPickerDraft] = useState<number[]>([])
  const [scenarioPickerDraft, setScenarioPickerDraft] = useState<number[]>([])
  const [runtimeLog, setRuntimeLog] = useState<string[]>([])

  useEffect(() => {
    let active = true
    void Promise.all([window.pageAuto.listAccounts(), window.pageAuto.listScenarios()])
      .then(([nextAccounts, nextScenarios]) => {
        if (!active) return
        setAccounts(nextAccounts)
        setScenarios(nextScenarios)
        setInventoryLoaded(true)
      })
      .catch((cause) => {
        if (!active) return
        setLoadError(cause instanceof Error ? cause.message : String(cause))
        setInventoryLoaded(true)
      })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!inventoryLoaded) return
    const accountIds = new Set(accounts.map((item) => item.id))
    const scenarioIds = new Set(scenarios.map((item) => item.id))
    setSelectedAccountIds((current) => current.filter((id) => accountIds.has(id)))
    setEnabledAccountIds((current) => current.filter((id) => accountIds.has(id)))
    setSelectedScenarioIds((current) => current.filter((id) => scenarioIds.has(id)))
  }, [accounts, inventoryLoaded, scenarios])

  useEffect(() => {
    const persisted: ScenarioRunnerPersistedState = {
      selectedAccountIds,
      enabledAccountIds: enabledAccountIds.filter((id) => selectedAccountIds.includes(id)),
      selectedScenarioIds,
      settings
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted))
    } catch {
      // Renderer preferences are best effort. Raw proxy text is intentionally never persisted.
    }
  }, [enabledAccountIds, selectedAccountIds, selectedScenarioIds, settings])

  const selectedAccounts = useMemo(() => {
    const byId = new Map(accounts.map((item) => [item.id, item] as const))
    return selectedAccountIds.map((id) => byId.get(id)).filter((item): item is AccountRecord => Boolean(item))
  }, [accounts, selectedAccountIds])

  const selectedScenarios = useMemo(() => {
    const byId = new Map(scenarios.map((item) => [item.id, item] as const))
    return selectedScenarioIds.map((id) => byId.get(id)).filter((item): item is ScenarioSummary => Boolean(item))
  }, [scenarios, selectedScenarioIds])

  const filteredPickerAccounts = useMemo(() => {
    const query = accountPickerQuery.trim().toLocaleLowerCase('vi')
    if (!query) return accounts
    return accounts.filter((account) => [account.uid, account.username, account.name, account.category]
      .some((value) => value?.toLocaleLowerCase('vi').includes(query)))
  }, [accountPickerQuery, accounts])

  const filteredPickerScenarios = useMemo(() => {
    const query = scenarioPickerQuery.trim().toLocaleLowerCase('vi')
    if (!query) return scenarios
    return scenarios.filter((scenario) => scenario.name.toLocaleLowerCase('vi').includes(query))
  }, [scenarioPickerQuery, scenarios])

  const updateSetting = <K extends keyof ScenarioRunnerSettings>(key: K, value: ScenarioRunnerSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }))
  }

  const openAccountPicker = () => {
    setAccountPickerDraft(selectedAccountIds)
    setAccountPickerQuery('')
    setAccountPickerOpen(true)
  }

  const applyAccountPicker = () => {
    const desired = new Set(accountPickerDraft)
    const kept = selectedAccountIds.filter((id) => desired.has(id))
    const appended = accounts.map((item) => item.id).filter((id) => desired.has(id) && !kept.includes(id))
    const next = [...kept, ...appended]
    const previousSelected = new Set(selectedAccountIds)
    const previousEnabled = new Set(enabledAccountIds)
    setSelectedAccountIds(next)
    setEnabledAccountIds(next.filter((id) => previousEnabled.has(id) || !previousSelected.has(id)))
    setAccountPickerOpen(false)
  }

  const openScenarioPicker = () => {
    setScenarioPickerDraft(selectedScenarioIds)
    setScenarioPickerQuery('')
    setScenarioPickerOpen(true)
  }

  const applyScenarioPicker = () => {
    const desired = new Set(scenarioPickerDraft)
    const kept = selectedScenarioIds.filter((id) => desired.has(id))
    const appended = scenarios.map((item) => item.id).filter((id) => desired.has(id) && !kept.includes(id))
    setSelectedScenarioIds([...kept, ...appended])
    setScenarioPickerOpen(false)
  }

  const allEnabled = selectedAccountIds.length > 0 && selectedAccountIds.every((id) => enabledAccountIds.includes(id))
  const toggleAllEnabled = () => setEnabledAccountIds(allEnabled ? [] : [...selectedAccountIds])

  return (
    <section className="scenario-runner-page" aria-label="Chạy Kịch Bản">
      {loadError ? <div className="scenario-runner-error">Không tải được dữ liệu: {loadError}</div> : null}

      <div className="scenario-runner-grid">
        <section className="scenario-runner-panel runner-accounts-panel">
          <div className="scenario-runner-panel-head">
            <div><p>TÀI KHOẢN CHẠY</p><h2>Danh sách tài khoản</h2></div>
            <span>{selectedAccounts.length}</span>
          </div>
          <div className="scenario-runner-toolbar">
            <button className="scenario-runner-button" type="button" disabled={!selectedAccountIds.length} onClick={toggleAllEnabled}>{allEnabled ? 'Bỏ chọn' : 'Tất cả'}</button>
            <button className="scenario-runner-button" type="button" onClick={openAccountPicker}>Chọn tài khoản</button>
            <button className="scenario-runner-button subtle-danger" type="button" disabled={!selectedAccountIds.length} onClick={() => { setSelectedAccountIds([]); setEnabledAccountIds([]) }}>Clear</button>
          </div>

          <div className="scenario-runner-account-table-wrap">
            <table className="scenario-runner-account-table">
              <thead><tr><th aria-label="Chọn" /><th>Account</th><th>Name</th><th>Total</th><th>Success</th><th>Trạng thái</th></tr></thead>
              <tbody>
                {selectedAccounts.map((account) => {
                  const status = statusMeta(account.status)
                  const enabled = enabledAccountIds.includes(account.id)
                  return (
                    <tr key={account.id}>
                      <td><input type="checkbox" checked={enabled} onChange={(event) => setEnabledAccountIds((current) => event.target.checked ? [...current.filter((id) => id !== account.id), account.id] : current.filter((id) => id !== account.id))} /></td>
                      <td><strong>{account.uid}</strong></td>
                      <td title={account.name ?? account.username ?? ''}>{account.name ?? account.username ?? '—'}</td>
                      <td>0</td>
                      <td>0</td>
                      <td><span className={`scenario-runner-status ${status.tone}`}><i />{status.label}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {!selectedAccounts.length ? <div className="scenario-runner-empty">Chọn tài khoản từ Account Manager để đưa vào phiên chạy.</div> : null}
          </div>

          <div className="scenario-runner-panel-foot">
            <span>Đã bật {enabledAccountIds.filter((id) => selectedAccountIds.includes(id)).length} / {selectedAccounts.length} tài khoản</span>
            <span>Kho: {accounts.length}</span>
          </div>
        </section>

        <section className="scenario-runner-panel runner-settings-panel">
          <div className="scenario-runner-panel-head">
            <div><p>THIẾT LẬP CHẠY</p><h2>Kịch bản & nhịp chạy</h2></div>
            <button className="scenario-runner-link-button" type="button" onClick={onOpenManager}>Quản lý</button>
          </div>

          <div className="scenario-runner-settings-scroll">
            <div className="scenario-runner-section">
              <div className="scenario-runner-section-title"><strong>Danh sách kịch bản muốn chạy</strong><button className="scenario-runner-button" type="button" onClick={openScenarioPicker}>Chọn</button></div>
              <label className="scenario-runner-inline-option">
                <input type="checkbox" checked={settings.randomScenarios} onChange={(event) => updateSetting('randomScenarios', event.target.checked)} />
                <span>Random kịch bản</span>
                <NumberField min={1} max={Math.max(1, selectedScenarioIds.length)} disabled={!settings.randomScenarios} value={settings.randomScenarioCount} onChange={(value) => updateSetting('randomScenarioCount', Math.max(1, value || 1))} />
              </label>
              <label className="scenario-runner-inline-option">
                <input type="checkbox" checked={settings.secondaryProfile} onChange={(event) => updateSetting('secondaryProfile', event.target.checked)} />
                <span>Chạy bằng Profile phụ (www)</span>
                <NumberField min={1} max={1000} disabled={!settings.secondaryProfile} value={settings.secondaryProfileCount} onChange={(value) => updateSetting('secondaryProfileCount', Math.max(1, value || 1))} />
              </label>

              <div className="scenario-runner-selected-scenarios">
                <div className="scenario-runner-selected-head"><strong>Kịch bản đã chọn</strong><span>{selectedScenarios.length}</span></div>
                <div className="scenario-runner-selected-list">
                  {selectedScenarios.map((scenario, index) => (
                    <div className="scenario-runner-selected-row" key={scenario.id}>
                      <span className="scenario-runner-drag">⠿</span>
                      <span className="scenario-runner-order">{index + 1}</span>
                      <span className="scenario-runner-selected-name"><strong>{scenario.name}</strong><small>{scenario.actionCount} action</small></span>
                      <button type="button" title="Lên" disabled={index === 0} onClick={() => setSelectedScenarioIds((current) => moveId(current, scenario.id, 'up'))}>↑</button>
                      <button type="button" title="Xuống" disabled={index === selectedScenarios.length - 1} onClick={() => setSelectedScenarioIds((current) => moveId(current, scenario.id, 'down'))}>↓</button>
                      <button className="remove" type="button" title="Bỏ khỏi phiên" onClick={() => setSelectedScenarioIds((current) => current.filter((id) => id !== scenario.id))}>×</button>
                    </div>
                  ))}
                  {!selectedScenarios.length ? <div className="scenario-runner-empty compact">Chưa chọn kịch bản.</div> : null}
                </div>
                <div className="scenario-runner-selected-foot">Tổng {selectedScenarios.length} kịch bản</div>
              </div>
            </div>

            <div className="scenario-runner-section runner-parallel-row">
              <span>Số acc muốn chạy song song</span>
              <NumberField min={1} max={100} value={settings.parallelAccounts} onChange={(value) => updateSetting('parallelAccounts', Math.max(1, value || 1))} />
            </div>

            <div className="scenario-runner-section scenario-runner-flow-box">
              <strong>Chạy theo kịch bản</strong>
              <div className="scenario-runner-form-row">
                <span>Thời gian delay</span>
                <small>từ (s)</small><NumberField min={0} max={3600} value={settings.actionDelayMinSeconds} onChange={(value) => updateSetting('actionDelayMinSeconds', Math.max(0, value || 0))} />
                <small>đến (s)</small><NumberField min={0} max={3600} value={settings.actionDelayMaxSeconds} onChange={(value) => updateSetting('actionDelayMaxSeconds', Math.max(settings.actionDelayMinSeconds, value || 0))} />
              </div>
              <div className="scenario-runner-form-row two-pair">
                <span>Tạm dừng sau khi xử lí được</span><NumberField min={1} max={100000} value={settings.pauseAfterActions} onChange={(value) => updateSetting('pauseAfterActions', Math.max(1, value || 1))} />
                <small>Thời gian tạm dừng (phút)</small><NumberField min={0} max={1440} value={settings.pauseMinutes} onChange={(value) => updateSetting('pauseMinutes', Math.max(0, value || 0))} />
              </div>
              <div className="scenario-runner-form-row">
                <span>Tạm dừng khi gặp lỗi (phút)</span><NumberField min={0} max={1440} value={settings.pauseOnErrorMinutes} onChange={(value) => updateSetting('pauseOnErrorMinutes', Math.max(0, value || 0))} />
              </div>
              <label className="scenario-runner-inline-option repeat-row">
                <input type="checkbox" checked={settings.repeat} onChange={(event) => updateSetting('repeat', event.target.checked)} />
                <span>Repeat</span>
                <NumberField min={1} max={10000} disabled={!settings.repeat} value={settings.repeatCount} onChange={(value) => updateSetting('repeatCount', Math.max(1, value || 1))} />
              </label>
            </div>
          </div>
        </section>

        <section className="scenario-runner-panel runner-log-panel">
          <div className="scenario-runner-panel-head">
            <div><p>KHU VỰC CHẠY / LOG</p><h2>Runtime</h2></div>
            <button className="scenario-runner-button" type="button" disabled={!runtimeLog.length} onClick={() => setRuntimeLog([])}>Xóa log</button>
          </div>

          <div className="scenario-runner-log-box">
            {runtimeLog.length ? runtimeLog.map((line, index) => <p key={`${index}-${line}`}>{line}</p>) : <span>Log runtime sẽ hiển thị tại đây khi dashboard được nối với Common Action Runner.</span>}
          </div>

          <div className="scenario-runner-runtime-controls">
            <div className="scenario-runner-control-row four">
              <span>Tạm dừng sau khi chạy số acc</span><NumberField min={1} max={100000} value={settings.pauseAfterAccounts} onChange={(value) => updateSetting('pauseAfterAccounts', Math.max(1, value || 1))} />
              <span>Thời gian (phút)</span><NumberField min={0} max={1440} value={settings.pauseAfterAccountsMinutes} onChange={(value) => updateSetting('pauseAfterAccountsMinutes', Math.max(0, value || 0))} />
            </div>

            <label className="scenario-runner-inline-option wide-runtime-option">
              <input type="checkbox" checked={settings.proxyResetEnabled} onChange={(event) => updateSetting('proxyResetEnabled', event.target.checked)} />
              <span>Chạy luồng theo Proxy Reset (Số luồng / 1 proxy)</span>
              <NumberField min={1} max={100} disabled={!settings.proxyResetEnabled} value={settings.proxyThreadsPerProxy} onChange={(value) => updateSetting('proxyThreadsPerProxy', Math.max(1, value || 1))} />
            </label>
            <textarea
              className="scenario-runner-proxy-input"
              value={proxyText}
              disabled={!settings.proxyResetEnabled}
              onChange={(event) => setProxyText(event.target.value)}
              placeholder="Nhập proxy (mỗi dòng 1 proxy) hoặc để trống để tắt..."
            />
            <p className="scenario-runner-secret-note">Danh sách proxy chỉ giữ trong phiên UI hiện tại, không lưu localStorage.</p>

            <label className="scenario-runner-inline-option wide-runtime-option">
              <input type="checkbox" checked={settings.dcomResetEnabled} onChange={(event) => updateSetting('dcomResetEnabled', event.target.checked)} />
              <span>Reset DCom khi chạy được (tài khoản)</span>
              <NumberField min={1} max={100000} disabled={!settings.dcomResetEnabled} value={settings.dcomEveryAccounts} onChange={(value) => updateSetting('dcomEveryAccounts', Math.max(1, value || 1))} />
            </label>
          </div>

          <div className="scenario-runner-actions-zone">
            <div className="scenario-runner-runtime-note">Shell runner đã sẵn sàng · Start/Stop sẽ nối K3 runtime ở lô tiếp theo.</div>
            <div className="scenario-runner-main-actions">
              <button className="scenario-runner-start" type="button" disabled title="Chưa nối runtime">▶ Bắt đầu</button>
              <button className="scenario-runner-stop" type="button" disabled title="Chưa nối runtime">■ Kết thúc</button>
            </div>
            <div className="scenario-runner-bottom-fields">
              <label><span>Start index</span><NumberField min={0} max={1000000} value={settings.startIndex} onChange={(value) => updateSetting('startIndex', Math.max(0, value || 0))} /></label>
              <label><span>Limit/1 account</span><NumberField min={1} max={1000000} value={settings.limitPerAccount} onChange={(value) => updateSetting('limitPerAccount', Math.max(1, value || 1))} /></label>
            </div>
          </div>
        </section>
      </div>

      {accountPickerOpen ? (
        <PickerModal title="Chọn tài khoản chạy" subtitle="ACCOUNT MANAGER" query={accountPickerQuery} setQuery={setAccountPickerQuery} count={accountPickerDraft.length} onClose={() => setAccountPickerOpen(false)} onApply={applyAccountPicker}>
          <div className="scenario-runner-picker-list">
            {filteredPickerAccounts.map((account) => {
              const checked = accountPickerDraft.includes(account.id)
              const status = statusMeta(account.status)
              return (
                <label className="scenario-runner-picker-row" key={account.id}>
                  <input type="checkbox" checked={checked} onChange={(event) => setAccountPickerDraft((current) => event.target.checked ? [...current, account.id] : current.filter((id) => id !== account.id))} />
                  <strong>{account.uid}</strong>
                  <span>{account.name ?? account.username ?? '—'}</span>
                  <small>{account.category ?? 'Không nhóm'}</small>
                  <em className={status.tone}>{status.label}</em>
                </label>
              )
            })}
            {!filteredPickerAccounts.length ? <div className="scenario-runner-empty">Không tìm thấy tài khoản.</div> : null}
          </div>
        </PickerModal>
      ) : null}

      {scenarioPickerOpen ? (
        <PickerModal title="Chọn kịch bản muốn chạy" subtitle="THƯ VIỆN KỊCH BẢN" query={scenarioPickerQuery} setQuery={setScenarioPickerQuery} count={scenarioPickerDraft.length} onClose={() => setScenarioPickerOpen(false)} onApply={applyScenarioPicker}>
          <div className="scenario-runner-picker-list scenario-picker-list">
            {filteredPickerScenarios.map((scenario) => {
              const checked = scenarioPickerDraft.includes(scenario.id)
              return (
                <label className="scenario-runner-picker-row scenario-picker-row" key={scenario.id}>
                  <input type="checkbox" checked={checked} onChange={(event) => setScenarioPickerDraft((current) => event.target.checked ? [...current, scenario.id] : current.filter((id) => id !== scenario.id))} />
                  <strong>{scenario.name}</strong>
                  <span>{scenario.actionCount} action</span>
                  <small>{scenario.randomActionOrder ? 'Action random' : 'Action tuần tự'}</small>
                </label>
              )
            })}
            {!filteredPickerScenarios.length ? <div className="scenario-runner-empty">Chưa có kịch bản phù hợp.</div> : null}
          </div>
        </PickerModal>
      ) : null}
    </section>
  )
}
