import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PageTabConfig, PageTabSummary } from '../../../shared/pageTabs'
import {
  normalizePageScenarioScheduleMinutes,
  pageScenarioScheduleRuntimeState,
  type PageScenarioPlanStatus,
  type PageScenarioPlanView
} from '../../../shared/pageScenarioSchedule'
import type { ScenarioSummary } from '../../../shared/scenarios'
import { ScenarioManager } from '../scenarios/ScenarioManager'
import './pageWallWorkspace.css'

interface PageScenarioWorkspaceProps {
  page: PageTabSummary
}

type ScenarioAccount = PageTabConfig['accounts'][number]

interface ScheduleDraft {
  planIds: number[]
  scheduleKind: 'specific_date' | 'daily'
  localDate: string
  times: string[]
  accountIds: number[]
  accountConcurrency: number
  scenarioId: number | null
  enabled: boolean
  hasHistory: boolean
}

interface ScheduleGroup {
  key: string
  plans: PageScenarioPlanView[]
  planIds: number[]
  scheduleKind: 'specific_date' | 'daily'
  localDate: string | null
  minutes: number[]
  accountIds: number[]
  accountConcurrency: number
  scenarioId: number
  status: PageScenarioPlanStatus
  editable: boolean
}

function timeToMinute(value: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value)
  return match ? Number(match[1]) * 60 + Number(match[2]) : -1
}

function minuteToTime(value: number): string {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
}

function localDateInput(): string {
  const now = new Date()
  const shifted = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
  return shifted.toISOString().slice(0, 10)
}

function isScenarioAccountSelectable(account: ScenarioAccount): boolean {
  return account.status !== 'disabled'
}

function groupSignature(plan: PageScenarioPlanView): string {
  return JSON.stringify({
    scheduleKind: plan.scheduleKind,
    localDate: plan.localDate,
    accountConcurrency: plan.accountConcurrency,
    accountIds: plan.accountIds,
    scenarioId: plan.scenarioId
  })
}

function groupStatus(plans: PageScenarioPlanView[]): PageScenarioPlanStatus {
  if (plans.some((plan) => plan.status === 'needs_attention')) return 'needs_attention'
  if (plans.some((plan) => plan.status === 'active')) return 'active'
  if (plans.some((plan) => plan.status === 'disabled')) return 'disabled'
  if (plans.every((plan) => plan.status === 'completed')) return 'completed'
  return plans[0]?.status ?? 'active'
}

function groupSchedulePlans(plans: PageScenarioPlanView[]): ScheduleGroup[] {
  const grouped = new Map<string, PageScenarioPlanView[]>()
  for (const plan of plans) {
    const key = groupSignature(plan)
    const list = grouped.get(key) ?? []
    list.push(plan)
    grouped.set(key, list)
  }
  return [...grouped.entries()].map(([key, list]) => {
    const sorted = [...list].sort((left, right) => left.minuteOfDay - right.minuteOfDay || left.id - right.id)
    const first = sorted[0]!
    return {
      key,
      plans: sorted,
      planIds: sorted.map((plan) => plan.id),
      scheduleKind: first.scheduleKind,
      localDate: first.localDate,
      minutes: sorted.map((plan) => plan.minuteOfDay),
      accountIds: [...first.accountIds],
      accountConcurrency: first.accountConcurrency,
      scenarioId: first.scenarioId,
      status: groupStatus(sorted),
      editable: !sorted.some((plan) => plan.latestOccurrence?.status === 'pending' || plan.latestOccurrence?.status === 'running')
    }
  }).sort((left, right) => {
    const leftDate = left.scheduleKind === 'daily' ? '9999-12-31' : left.localDate ?? ''
    const rightDate = right.scheduleKind === 'daily' ? '9999-12-31' : right.localDate ?? ''
    return leftDate.localeCompare(rightDate) || (left.minutes[0] ?? 0) - (right.minutes[0] ?? 0)
  })
}

function ScenarioPicker({ scenarios, onClose, onPick }: {
  scenarios: ScenarioSummary[]
  onClose: () => void
  onPick: (scenario: ScenarioSummary) => void
}) {
  const [query, setQuery] = useState('')
  const normalized = query.trim().toLocaleLowerCase('vi')
  const filtered = scenarios.filter((scenario) => !normalized || scenario.name.toLocaleLowerCase('vi').includes(normalized))
  return <div className="page-wall-modal-backdrop picker" role="presentation" onMouseDown={onClose}>
    <section className="page-wall-library" role="dialog" aria-modal="true" aria-label="Chọn hành động Kịch bản" onMouseDown={(event) => event.stopPropagation()}>
      <header><div><small>THƯ VIỆN KỊCH BẢN DÙNG CHUNG</small><h3>Chọn hành động cần chạy</h3></div><button type="button" onClick={onClose}>×</button></header>
      <input className="page-wall-library-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm theo tên kịch bản…" autoFocus />
      <div className="page-wall-library-list">
        {filtered.map((scenario) => <article key={scenario.id} className="page-wall-library-item">
          <div><strong>{scenario.name}</strong><p>{scenario.actionCount} hành động · {scenario.randomActionOrder ? 'thứ tự random' : 'thứ tự tuần tự'}</p><small>Kịch bản #{scenario.id} · dùng Action Registry chung</small></div>
          <div><button className="pt-button primary" type="button" disabled={scenario.actionCount < 1} onClick={() => onPick(scenario)}>Chọn kịch bản này</button></div>
        </article>)}
        {!filtered.length ? <p className="page-wall-empty-copy">Không có kịch bản phù hợp.</p> : null}
      </div>
    </section>
  </div>
}

function ScheduleModal({ draft, accounts, scenarios, busy, onChange, onChooseScenario, onClose, onSave }: {
  draft: ScheduleDraft
  accounts: ScenarioAccount[]
  scenarios: ScenarioSummary[]
  busy: boolean
  onChange: (next: ScheduleDraft) => void
  onChooseScenario: () => void
  onClose: () => void
  onSave: () => void
}) {
  const runnable = accounts.filter(isScenarioAccountSelectable)
  const scenario = draft.scenarioId ? scenarios.find((item) => item.id === draft.scenarioId) ?? null : null
  const toggle = (accountId: number) => onChange({ ...draft, accountIds: draft.accountIds.includes(accountId) ? draft.accountIds.filter((id) => id !== accountId) : [...draft.accountIds, accountId] })
  const setTime = (index: number, value: string) => onChange({ ...draft, times: draft.times.map((time, current) => current === index ? value : time) })
  const rawMinutes = draft.times.map(timeToMinute)
  const uniqueMinutes = (() => { try { return normalizePageScenarioScheduleMinutes(rawMinutes) } catch { return [] } })()
  const timesValid = rawMinutes.every((minute) => minute >= 0) && uniqueMinutes.length === draft.times.length
  const canSave = Boolean(draft.scenarioId && draft.accountIds.length && timesValid && uniqueMinutes.length && (draft.scheduleKind === 'daily' || draft.localDate) && !busy)
  const scenarioSummary = scenario ? `#${scenario.id} · ${scenario.name} · ${scenario.actionCount} hành động` : draft.scenarioId ? `Kịch bản #${draft.scenarioId}` : 'Chưa chọn hành động'

  return <div className="page-wall-modal-backdrop schedule" role="presentation" onMouseDown={onClose}>
    <section className="page-wall-schedule-dialog" role="dialog" aria-modal="true" aria-label="Thiết lập lịch Kịch bản Page" onMouseDown={(event) => event.stopPropagation()}>
      <header><div><small>LỊCH KỊCH BẢN PAGE</small><h3>{draft.planIds.length ? 'Sửa lịch chạy' : 'Hẹn giờ chạy kịch bản'}</h3></div><button type="button" onClick={onClose}>×</button></header>
      <div className="page-wall-schedule-step"><b>1. Chọn hành động</b><div className={`page-wall-selected-post compact ${draft.scenarioId ? 'ready' : 'empty'}`}><div><small>HÀNH ĐỘNG ĐANG CHỌN</small><strong>{scenarioSummary}</strong><span>{scenario ? 'Khi tới giờ: session/login → switch + verify Page → chạy action trong kịch bản.' : 'Chọn kịch bản trước khi lưu lịch.'}</span></div><div><button className="pt-button secondary" type="button" onClick={onChooseScenario}>Chọn</button><button type="button" disabled={!draft.scenarioId} onClick={() => onChange({ ...draft, scenarioId: null })}>Bỏ chọn</button></div></div></div>
      <div className="page-wall-schedule-step"><b>2. Thời gian chạy</b><div className="page-wall-plan-kind"><label><input type="radio" checked={draft.scheduleKind === 'specific_date'} onChange={() => onChange({ ...draft, scheduleKind: 'specific_date' })} /> Ngày cụ thể</label><label><input type="radio" checked={draft.scheduleKind === 'daily'} onChange={() => onChange({ ...draft, scheduleKind: 'daily' })} /> Mỗi ngày</label></div>{draft.scheduleKind === 'specific_date' ? <label className="page-wall-date-field"><span>Ngày chạy</span><input type="date" value={draft.localDate} onChange={(event) => onChange({ ...draft, localDate: event.target.value })} /></label> : null}<div className="page-wall-time-list">{draft.times.map((time, index) => <div className="page-wall-time-chip" key={`${index}-${time}`}><input type="time" value={time} onChange={(event) => setTime(index, event.target.value)} /><button type="button" aria-label={`Xóa giờ ${time}`} disabled={draft.times.length === 1} onClick={() => onChange({ ...draft, times: draft.times.filter((_value, current) => current !== index) })}>×</button></div>)}<button className="page-wall-add-time" type="button" disabled={draft.times.length >= 12} onClick={() => onChange({ ...draft, times: [...draft.times, '12:00'] })}>+ Thêm giờ</button></div>{!timesValid ? <small className="page-wall-time-error">Giờ chạy phải hợp lệ và không được trùng nhau.</small> : null}</div>
      <div className="page-wall-schedule-step accounts"><div className="page-wall-step-title"><b>3. Chọn tài khoản muốn chạy</b><span>{draft.accountIds.length}/{runnable.length} TK</span></div><div className="page-wall-mini-account-tools"><button type="button" onClick={() => onChange({ ...draft, accountIds: runnable.map((account) => account.accountId) })}>Chọn tất cả</button><button type="button" onClick={() => onChange({ ...draft, accountIds: [] })}>Bỏ chọn</button><label><span>TK song song</span><input type="number" min={1} max={20} value={draft.accountConcurrency} onChange={(event) => onChange({ ...draft, accountConcurrency: Math.max(1, Math.min(20, Number(event.target.value) || 1)) })} /></label></div><div className="page-wall-schedule-account-table"><table><thead><tr><th></th><th>UID</th><th>Tên</th><th>Trạng thái</th></tr></thead><tbody>{accounts.map((account) => { const canUse = isScenarioAccountSelectable(account); const selected = draft.accountIds.includes(account.accountId); return <tr key={account.accountId} className={`${selected ? 'selected' : ''} ${!canUse ? 'disabled' : ''}`} onClick={() => { if (canUse && !busy) toggle(account.accountId) }}><td><input type="checkbox" checked={selected} disabled={!canUse || busy} onClick={(event) => event.stopPropagation()} onChange={() => toggle(account.accountId)} /></td><td><b>{account.uid}</b></td><td>{account.name || '—'}</td><td>{account.enabled ? account.status : 'Tắt trong Page'}</td></tr> })}</tbody></table></div></div>
      {draft.hasHistory ? <small className="page-wall-history-note">Lịch đã có lượt chạy. Thay đổi chỉ áp dụng cho lượt kế tiếp; lịch sử cũ được giữ nguyên.</small> : null}
      <div className="page-wall-schedule-review"><strong>{draft.scheduleKind === 'daily' ? 'Mỗi ngày' : draft.localDate || 'Chưa chọn ngày'} · {uniqueMinutes.map(minuteToTime).join(', ') || 'Chưa có giờ'}</strong><span>{scenarioSummary} · {draft.accountIds.length} TK · song song {draft.accountConcurrency}</span></div>
      <footer><button type="button" onClick={onClose}>Hủy</button><button className="pt-button primary" type="button" disabled={!canSave} onClick={onSave}>{busy ? 'Đang lưu…' : 'Lưu lịch'}</button></footer>
    </section>
  </div>
}

export function PageScenarioWorkspace({ page }: PageScenarioWorkspaceProps) {
  const [mode, setMode] = useState<'schedule' | 'manager'>('schedule')
  const [config, setConfig] = useState<PageTabConfig | null>(null)
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([])
  const [selectedAccountIds, setSelectedAccountIds] = useState<number[]>([])
  const [selectedScenarioId, setSelectedScenarioId] = useState<number | null>(null)
  const [accountConcurrency, setAccountConcurrency] = useState(1)
  const [dashboard, setDashboard] = useState<{ plans: PageScenarioPlanView[] }>({ plans: [] })
  const [pickerOpen, setPickerOpen] = useState(false)
  const [scheduleDraft, setScheduleDraft] = useState<ScheduleDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshDashboard = useCallback(async (silent = false) => {
    try {
      setDashboard(await window.pageScenarioSchedule.getDashboard({ pageTabId: page.id }))
      if (!silent) setError(null)
    } catch (cause) {
      if (!silent) setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [page.id])

  const refreshScenarios = useCallback(async () => {
    const next = await window.pageAuto.listScenarios()
    setScenarios(next)
    setSelectedScenarioId((current) => current && next.some((scenario) => scenario.id === current) ? current : null)
    return next
  }, [])

  useEffect(() => {
    let cancelled = false
    setConfig(null)
    setError(null)
    void Promise.all([
      window.pageAuto.getPageTab({ id: page.id }),
      window.pageAuto.listScenarios(),
      window.pageScenarioSchedule.getDashboard({ pageTabId: page.id })
    ]).then(([nextConfig, nextScenarios, nextDashboard]) => {
      if (cancelled) return
      if (!nextConfig) throw new Error(`Không tìm thấy Page canonical #${page.id}.`)
      setConfig(nextConfig)
      setScenarios(nextScenarios)
      const runnable = nextConfig.accounts.filter(isScenarioAccountSelectable).sort((left, right) => left.sortOrder - right.sortOrder)
      setSelectedAccountIds(runnable.map((account) => account.accountId))
      setDashboard(nextDashboard)
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
    })
    const timer = window.setInterval(() => void refreshDashboard(true), 3_000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [page.id, refreshDashboard])

  const accounts = useMemo(() => [...(config?.accounts ?? [])].sort((left, right) => left.sortOrder - right.sortOrder), [config])
  const runnableIds = useMemo(() => accounts.filter(isScenarioAccountSelectable).map((account) => account.accountId), [accounts])
  const selectedRunnable = selectedAccountIds.filter((id) => runnableIds.includes(id))
  const selectedScenario = selectedScenarioId ? scenarios.find((scenario) => scenario.id === selectedScenarioId) ?? null : null
  const scheduleGroups = useMemo(() => groupSchedulePlans(dashboard.plans), [dashboard.plans])

  const toggleAccount = (accountId: number) => setSelectedAccountIds((current) => current.includes(accountId) ? current.filter((id) => id !== accountId) : [...current, accountId])
  const pickScenario = (scenario: ScenarioSummary) => {
    setSelectedScenarioId(scenario.id)
    setScheduleDraft((current) => current ? { ...current, scenarioId: scenario.id } : current)
    setPickerOpen(false)
  }

  const openAddSchedule = () => setScheduleDraft({
    planIds: [],
    scheduleKind: 'daily',
    localDate: localDateInput(),
    times: ['08:00'],
    accountIds: [...selectedRunnable],
    accountConcurrency,
    scenarioId: selectedScenarioId,
    enabled: true,
    hasHistory: false
  })

  const openEditSchedule = (group: ScheduleGroup) => {
    if (!group.editable) return
    setScheduleDraft({
      planIds: group.planIds,
      scheduleKind: group.scheduleKind,
      localDate: group.localDate ?? localDateInput(),
      times: group.minutes.map(minuteToTime),
      accountIds: [...group.accountIds],
      accountConcurrency: group.accountConcurrency,
      scenarioId: group.scenarioId,
      enabled: group.status !== 'disabled',
      hasHistory: group.plans.some((plan) => Boolean(plan.latestOccurrence))
    })
  }

  const saveSchedule = async () => {
    if (!scheduleDraft?.scenarioId || !scheduleDraft.accountIds.length) return
    setBusy(true)
    setError(null)
    try {
      const minuteOfDays = normalizePageScenarioScheduleMinutes(scheduleDraft.times.map(timeToMinute))
      await window.pageScenarioSchedule.saveSchedule({
        planIds: scheduleDraft.planIds,
        input: {
          pageTabId: page.id,
          scheduleKind: scheduleDraft.scheduleKind,
          localDate: scheduleDraft.scheduleKind === 'specific_date' ? scheduleDraft.localDate : null,
          minuteOfDays,
          accountConcurrency: scheduleDraft.accountConcurrency,
          accountIds: [...scheduleDraft.accountIds],
          scenarioId: scheduleDraft.scenarioId,
          enabled: scheduleDraft.enabled
        }
      })
      setScheduleDraft(null)
      await refreshDashboard()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const setScheduleEnabled = async (group: ScheduleGroup, enabled: boolean) => {
    setBusy(true)
    setError(null)
    try {
      await window.pageScenarioSchedule.setScheduleEnabled({ pageTabId: page.id, planIds: group.planIds, enabled })
      await refreshDashboard()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const deleteSchedule = async (group: ScheduleGroup) => {
    if (!window.confirm(`Xóa lịch ${group.minutes.map(minuteToTime).join(', ')}?`)) return
    setBusy(true)
    setError(null)
    try {
      await window.pageScenarioSchedule.deleteSchedule({ planIds: group.planIds })
      await refreshDashboard()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  if (mode === 'manager') {
    return <section className="scenario-manager-mode">
      <div className="scenario-manager-mode-bar"><button type="button" onClick={() => { setMode('schedule'); void refreshScenarios() }}>← Lịch Kịch bản Page</button><span>Quản lý thư viện Kịch bản dùng chung.</span></div>
      <ScenarioManager />
    </section>
  }

  if (!config) return <section className="page-wall-workspace page-wall-empty"><strong>{error ?? 'Đang tải Kịch bản Page…'}</strong></section>

  return <section className="page-wall-workspace page-wall-finite page-scenario-workspace" role="tabpanel" aria-label={`Kịch bản Page ${page.name}`} data-testid="page-scenario-workspace">
    {error ? <div className="page-tab-error page-wall-error">{error}</div> : null}
    <header className="page-wall-finite-head"><div><p className="eyebrow">Kịch bản Page</p><h2>{config.name}</h2><span>Page UID: {config.pageUid}</span></div><div className="page-wall-head-state"><b>{selectedRunnable.length}</b><span>TK đã chọn</span></div></header>

    <div className="page-wall-three-regions" data-testid="page-scenario-three-regions">
      <section className="pt-panel page-wall-region accounts" data-testid="page-scenario-region-accounts">
        <div className="page-wall-region-head"><div><p className="eyebrow">1 · TÀI KHOẢN</p><h3>Chọn tài khoản chạy</h3></div><span>{selectedRunnable.length}/{runnableIds.length}</span></div>
        <div className="page-wall-account-table-wrap"><table className="page-wall-account-table"><thead><tr><th></th><th>#</th><th>UID</th><th>Tên</th><th>Trạng thái</th></tr></thead><tbody>{accounts.map((account, index) => { const runnable = isScenarioAccountSelectable(account); const selected = selectedAccountIds.includes(account.accountId); return <tr key={account.accountId} className={`${selected ? 'selected' : ''} ${!runnable ? 'disabled' : ''}`} onClick={() => { if (runnable && !busy) toggleAccount(account.accountId) }}><td><input type="checkbox" aria-label={`Chọn ${account.uid}`} disabled={!runnable || busy} checked={selected} onClick={(event) => event.stopPropagation()} onChange={() => toggleAccount(account.accountId)} /></td><td>{index + 1}</td><td><b>{account.uid}</b></td><td>{account.name || '—'}</td><td><span className={`status-${account.status}`}>{account.enabled ? account.status : 'Tắt trong Page'}</span></td></tr> })}</tbody></table></div>
        <div className="page-wall-account-controls"><div><button type="button" disabled={busy} onClick={() => setSelectedAccountIds(runnableIds)}>Chọn tất cả</button><button type="button" disabled={busy} onClick={() => setSelectedAccountIds([])}>Bỏ chọn</button></div><label><span>TK chạy song song</span><input type="number" min={1} max={20} value={accountConcurrency} disabled={busy} onChange={(event) => setAccountConcurrency(Math.max(1, Math.min(20, Number(event.target.value) || 1)))} /></label></div>
      </section>

      <section className="pt-panel page-wall-region content" data-testid="page-scenario-region-actions">
        <div className="page-wall-region-head"><div><p className="eyebrow">2 · HÀNH ĐỘNG</p><h3>Kịch bản đang chọn</h3></div></div>
        <div className={`page-wall-selected-post ${selectedScenario ? 'ready' : 'empty'}`} data-testid="page-scenario-selected-action"><div><small>{selectedScenario ? 'ĐÃ CHỌN' : 'CHƯA CHỌN HÀNH ĐỘNG'}</small><strong>{selectedScenario ? `#${selectedScenario.id} · ${selectedScenario.name}` : 'Chọn kịch bản/hành động cho lịch'}</strong><span>{selectedScenario ? `${selectedScenario.actionCount} hành động · ${selectedScenario.randomActionOrder ? 'random' : 'tuần tự'}` : 'Kịch bản lấy từ thư viện chung; lịch sẽ snapshot Page + TK + kịch bản khi tới giờ.'}</span></div><div className="page-wall-post-actions"><button className="pt-button secondary" type="button" disabled={busy} onClick={() => setPickerOpen(true)}>Chọn Kịch bản</button><button type="button" disabled={busy} onClick={() => setMode('manager')}>Quản lý</button><button type="button" disabled={busy || !selectedScenarioId} onClick={() => setSelectedScenarioId(null)}>Bỏ chọn</button></div></div>
        {selectedScenario ? <div className="page-wall-post-preview"><p><strong>{selectedScenario.name}</strong> sẽ chạy bằng actor Page. Common Runtime tự đảm bảo session rồi switch + verify đúng Page trước từng action.</p><small>{selectedScenario.actionCount} action · dùng Action Registry chung</small></div> : <div className="page-wall-post-empty"><b>1.</b><span>Bấm <strong>Chọn Kịch bản</strong>. Tab này chỉ tạo lịch, không chạy hành động ngay.</span></div>}
      </section>

      <section className="pt-panel page-wall-region control" data-testid="page-scenario-region-control">
        <div className="page-wall-mode-tabs"><button type="button" className="active">Lịch chạy</button></div>
        <div className="page-wall-schedule-panel"><div className="page-wall-schedule-toolbar"><div><strong>Lịch đã lưu</strong><span>Mỗi lịch tự giữ hành động + tài khoản + ngày/giờ + concurrency.</span></div><button className="pt-button primary" type="button" disabled={busy} onClick={openAddSchedule}>+ Thêm lịch</button></div><div className="page-wall-plan-list" data-testid="page-scenario-plan-list">{scheduleGroups.map((group) => {
          const runtime = pageScenarioScheduleRuntimeState(group.plans, localDateInput())
          const pausable = group.plans.some((plan) => plan.status === 'active' || plan.status === 'needs_attention')
          const resumable = !pausable && group.plans.some((plan) => plan.status === 'disabled')
          const scenario = scenarios.find((item) => item.id === group.scenarioId)
          return <div key={group.key} className={`page-wall-plan-row runtime-${runtime.tone}`}><i></i><div className="page-wall-plan-copy"><strong>{group.scheduleKind === 'daily' ? 'Mỗi ngày' : group.localDate} · {group.minutes.map(minuteToTime).join(', ')}</strong><span>{scenario ? `${scenario.name} · ${scenario.actionCount} hành động` : `Kịch bản #${group.scenarioId}`} · {group.accountIds.length} TK · SS {group.accountConcurrency}</span></div><b>{runtime.label}</b>{pausable || resumable ? <button className={`page-wall-plan-toggle ${resumable ? 'resume' : 'pause'}`} type="button" disabled={busy} onClick={() => void setScheduleEnabled(group, resumable)}>{resumable ? 'Bắt đầu' : 'Tạm dừng'}</button> : <span className="page-wall-plan-toggle-spacer"></span>}<button type="button" disabled={!group.editable || busy} title={group.editable ? 'Sửa lịch' : 'Lịch đang chạy; chờ kết thúc rồi sửa.'} onClick={() => openEditSchedule(group)}>Sửa</button><button type="button" aria-label={`Xóa lịch ${group.planIds.join('-')}`} disabled={busy} onClick={() => void deleteSchedule(group)}>×</button></div>
        })}{!scheduleGroups.length ? <div className="page-wall-no-plans"><b>Chưa có lịch Kịch bản Page</b><span>Bấm “+ Thêm lịch”, chọn hành động, tài khoản và một hoặc nhiều giờ chạy.</span></div> : null}</div></div>
      </section>
    </div>
    <footer className="page-wall-finite-footer"><span><b>Scheduled Page Scenario:</b> mỗi giờ đã chọn chạy đúng một lượt; không có Chạy ngay.</span><span>Page actor được verify trước action; occurrence đã tạo không tự retry trong cùng ngày.</span></footer>

    {pickerOpen ? <ScenarioPicker scenarios={scenarios} onClose={() => setPickerOpen(false)} onPick={pickScenario} /> : null}
    {scheduleDraft ? <ScheduleModal draft={scheduleDraft} accounts={accounts} scenarios={scenarios} busy={busy} onChange={setScheduleDraft} onChooseScenario={() => setPickerOpen(true)} onClose={() => setScheduleDraft(null)} onSave={() => void saveSchedule()} /> : null}
  </section>
}
