import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AccountRecord } from '../../../shared/accounts'
import type { PageTabSummary } from '../../../shared/pageTabs'
import type { PostingResultStatus } from '../../../shared/posting'
import type { RotationAccountRuntimeStatus, RotationRuntimeSnapshot } from '../../../shared/rotation'
import './multiTabRuntime.css'

const runtimeStatusLabels: Record<RotationRuntimeSnapshot['status'], string> = {
  idle: 'Chưa chạy',
  starting: 'Đang khởi động',
  running: 'Đang chạy',
  paused: 'Tạm dừng',
  waiting_window: 'Chờ khung giờ',
  stopping: 'Đang Stop',
  stopped: 'Đã Stop',
  completed: 'Hoàn tất',
  error: 'Lỗi'
}

const postingStatusLabels: Record<PostingResultStatus, string> = {
  success: 'Thành công',
  failed: 'Lỗi',
  needs_login: 'Cần đăng nhập',
  skipped: 'Bỏ qua'
}

const accountRuntimeLabels: Record<RotationAccountRuntimeStatus, string> = {
  not_run: 'Chưa chạy',
  completed_turn: 'Đã chạy',
  running: 'Đang chạy',
  error: 'Lỗi/Checkpoint',
  waiting: 'Chờ'
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':')
}

function formatTime(timestamp: number | null): string {
  if (!timestamp) return '—'
  return new Date(timestamp).toLocaleString('vi-VN')
}

function canStart(status: RotationRuntimeSnapshot['status']): boolean {
  return status === 'idle' || status === 'completed' || status === 'stopped' || status === 'error'
}

function canPause(status: RotationRuntimeSnapshot['status']): boolean {
  return status === 'starting' || status === 'running' || status === 'waiting_window'
}

function canResume(status: RotationRuntimeSnapshot['status']): boolean {
  return status === 'paused'
}

function canStop(status: RotationRuntimeSnapshot['status']): boolean {
  return status === 'starting' || status === 'running' || status === 'paused' || status === 'waiting_window'
}

type RuntimeAction = (payload: { pageTabId: number }) => Promise<RotationRuntimeSnapshot>
type RuntimeEligibility = (status: RotationRuntimeSnapshot['status']) => boolean

interface MultiTabRuntimeDashboardProps {
  pageTabId?: number | null
  compact?: boolean
}

export function MultiTabRuntimeDashboard({ pageTabId = null, compact = false }: MultiTabRuntimeDashboardProps) {
  const [tabs, setTabs] = useState<PageTabSummary[]>([])
  const [accounts, setAccounts] = useState<AccountRecord[]>([])
  const [runtimeByTab, setRuntimeByTab] = useState<Record<number, RotationRuntimeSnapshot>>({})
  const [busyTabs, setBusyTabs] = useState<Set<number>>(() => new Set())
  const [selectedTabIds, setSelectedTabIds] = useState<Set<number>>(() => new Set())
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())

  const refreshStatic = useCallback(async () => {
    try {
      const [nextTabs, nextAccounts] = await Promise.all([
        window.pageAuto.listPageTabs(),
        window.pageAuto.listAccounts()
      ])
      const validIds = new Set(nextTabs.map((tab) => tab.id))
      setTabs(nextTabs)
      setAccounts(nextAccounts)
      setSelectedTabIds((current) => new Set([...current].filter((id) => validIds.has(id))))
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  const refreshRuntime = useCallback(async () => {
    try {
      const runtimes = await window.pageAuto.listPageTabRotations()
      setRuntimeByTab(Object.fromEntries(runtimes.map((runtime) => [runtime.pageTabId, runtime])))
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  useEffect(() => {
    void refreshStatic()
    void refreshRuntime()
    const runtimeTimer = window.setInterval(() => {
      setNow(Date.now())
      void refreshRuntime()
    }, 1000)
    const staticTimer = window.setInterval(() => void refreshStatic(), 15_000)
    return () => {
      window.clearInterval(runtimeTimer)
      window.clearInterval(staticTimer)
    }
  }, [refreshRuntime, refreshStatic])

  const accountLabels = useMemo(() => new Map(accounts.map((account) => [
    account.id,
    `${account.uid}${account.name ? ` · ${account.name}` : ''}`
  ])), [accounts])

  const visibleTabs = useMemo(
    () => pageTabId === null ? tabs : tabs.filter((tab) => tab.id === pageTabId),
    [pageTabId, tabs]
  )

  const selectedIds = useMemo(() => [...selectedTabIds], [selectedTabIds])
  const statusFor = useCallback((id: number): RotationRuntimeSnapshot['status'] => runtimeByTab[id]?.status ?? 'idle', [runtimeByTab])
  const anySelectedCan = useCallback((eligibility: RuntimeEligibility): boolean => (
    selectedIds.some((id) => !busyTabs.has(id) && eligibility(statusFor(id)))
  ), [busyTabs, selectedIds, statusFor])

  const activeCount = visibleTabs.filter((tab) => {
    const status = runtimeByTab[tab.id]?.status
    return status === 'starting' || status === 'running' || status === 'waiting_window' || status === 'stopping'
  }).length

  const runAction = async (
    currentPageTabId: number,
    action: RuntimeAction
  ) => {
    setBusyTabs((current) => new Set(current).add(currentPageTabId))
    setError(null)
    try {
      const snapshot = await action({ pageTabId: currentPageTabId })
      setRuntimeByTab((current) => ({ ...current, [currentPageTabId]: snapshot }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusyTabs((current) => {
        const next = new Set(current)
        next.delete(currentPageTabId)
        return next
      })
    }
  }

  const runBulkAction = async (
    action: RuntimeAction,
    eligibility: RuntimeEligibility,
    label: string
  ) => {
    const targetIds = selectedIds.filter((id) => !busyTabs.has(id) && eligibility(statusFor(id)))
    if (targetIds.length === 0) return

    setBusyTabs((current) => new Set([...current, ...targetIds]))
    setError(null)
    try {
      // Fire every selected Page Tab request in the same turn. Main/worker owns the
      // actual concurrency limit and browserLaunchSpacingMs staggers first Chrome
      // launches; renderer must not serialize Page Tabs by awaiting one before next.
      const results = await Promise.allSettled(targetIds.map(async (id) => {
        const snapshot = await action({ pageTabId: id })
        setRuntimeByTab((current) => ({ ...current, [id]: snapshot }))
        return snapshot
      }))
      const failed = results.filter((result) => result.status === 'rejected')
      if (failed.length > 0) {
        const first = failed[0]
        const detail = first?.status === 'rejected'
          ? (first.reason instanceof Error ? first.reason.message : String(first.reason))
          : ''
        setError(`${label}: ${failed.length}/${targetIds.length} Page Tab lỗi.${detail ? ` ${detail}` : ''}`)
      }
    } finally {
      setBusyTabs((current) => {
        const next = new Set(current)
        for (const id of targetIds) next.delete(id)
        return next
      })
      void refreshRuntime()
    }
  }

  const toggleSelectedTab = (id: number, checked: boolean) => {
    setSelectedTabIds((current) => {
      const next = new Set(current)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  return (
    <section className={compact ? 'multi-runtime-shell compact' : 'multi-runtime-shell'}>
      <div className="multi-runtime-heading">
        <div>
          <p className="eyebrow">Điều phối Page Tab</p>
          <h2>{compact ? 'Trạng thái Page hiện tại' : 'Trạng thái nhiều Page'}</h2>
          {!compact ? <p>Mỗi Page Tab có trạng thái riêng; Pause giữ tiến độ, Stop kết thúc run và Start sau sẽ chạy lại từ Group gốc.</p> : null}
        </div>
        <div className="multi-runtime-summary">
          {!compact ? <span><strong>{activeCount}</strong> đang chạy</span> : null}
          {!compact ? <span><strong>{visibleTabs.length}</strong> tab</span> : null}
          <button type="button" onClick={() => { void refreshStatic(); void refreshRuntime() }}>Làm mới</button>
        </div>
      </div>

      {compact && tabs.length > 0 ? (
        <div className="multi-runtime-bulk">
          <div className="multi-runtime-bulk-tabs" aria-label="Chọn nhiều Page Tab để điều khiển cùng lúc">
            {tabs.map((tab) => (
              <label className={tab.id === pageTabId ? 'multi-runtime-bulk-tab current' : 'multi-runtime-bulk-tab'} key={tab.id}>
                <input
                  type="checkbox"
                  checked={selectedTabIds.has(tab.id)}
                  onChange={(event) => toggleSelectedTab(tab.id, event.target.checked)}
                />
                <span title={`${tab.name} · ${tab.pageUid}`}>{tab.name}</span>
              </label>
            ))}
          </div>
          <div className="multi-runtime-bulk-actions">
            <span className="multi-runtime-bulk-count">Đã chọn {selectedIds.length}/{tabs.length}</span>
            <button type="button" onClick={() => setSelectedTabIds(new Set(tabs.map((tab) => tab.id)))}>Chọn tất cả</button>
            <button type="button" disabled={!anySelectedCan(canStart)} onClick={() => void runBulkAction(window.pageAuto.startPageTabRotation, canStart, 'Start nhiều Page Tab')}>Start đã chọn</button>
            <button type="button" disabled={!anySelectedCan(canPause)} onClick={() => void runBulkAction(window.pageAuto.pausePageTabRotation, canPause, 'Pause nhiều Page Tab')}>Pause</button>
            <button type="button" disabled={!anySelectedCan(canResume)} onClick={() => void runBulkAction(window.pageAuto.resumePageTabRotation, canResume, 'Resume nhiều Page Tab')}>Tiếp tục</button>
            <button type="button" disabled={!anySelectedCan(canStop)} onClick={() => void runBulkAction(window.pageAuto.stopPageTabRotation, canStop, 'Stop nhiều Page Tab')}>Stop</button>
            <button type="button" disabled={selectedIds.length === 0} onClick={() => setSelectedTabIds(new Set())}>Bỏ chọn</button>
          </div>
        </div>
      ) : null}

      {error ? <div className="multi-runtime-error">{error}</div> : null}

      <div className="multi-runtime-grid">
        {visibleTabs.map((tab) => {
          const runtime = runtimeByTab[tab.id]
          const status = runtime?.status ?? 'idle'
          const run = runtime?.run
          const metrics = run?.metrics
          const startedAt = run?.run.startedAt ?? null
          const currentAccount = runtime?.currentAccountId
            ? accountLabels.get(runtime.currentAccountId) ?? `#${runtime.currentAccountId}`
            : '—'
          const accountStates = runtime?.accountStates ?? []
          const preview = runtime?.currentPostPreview ?? null
          const busy = busyTabs.has(tab.id)
          const elapsed = startedAt ? formatDuration(now - startedAt) : '00:00:00'
          const lastStatus = runtime?.lastResult?.status

          return (
            <article className={`multi-runtime-card runtime-${status}`} key={tab.id}>
              <header>
                <div>
                  <span className="multi-runtime-status">{runtimeStatusLabels[status]}</span>
                  <h3>{tab.name}</h3>
                  <small>UID Page {tab.pageUid}</small>
                </div>
                <div className="multi-runtime-actions">
                  <button
                    type="button"
                    disabled={busy || !canStart(status)}
                    onClick={() => void runAction(tab.id, window.pageAuto.startPageTabRotation)}
                  >Bắt đầu</button>
                  <button
                    type="button"
                    disabled={busy || !canPause(status)}
                    onClick={() => void runAction(tab.id, window.pageAuto.pausePageTabRotation)}
                  >Tạm dừng</button>
                  <button
                    type="button"
                    disabled={busy || !canResume(status)}
                    onClick={() => void runAction(tab.id, window.pageAuto.resumePageTabRotation)}
                  >Tiếp tục</button>
                  <button
                    type="button"
                    disabled={busy || !canStop(status)}
                    onClick={() => void runAction(tab.id, window.pageAuto.stopPageTabRotation)}
                  >Stop</button>
                </div>
              </header>

              <div className="multi-runtime-metrics">
                <div><span>Đã đăng</span><strong>{metrics?.success ?? 0}</strong></div>
                <div><span>Còn lại</span><strong>{metrics?.remaining ?? 0}</strong></div>
                <div><span>Lỗi</span><strong>{metrics?.failed ?? 0}</strong></div>
                <div><span>Tiến độ</span><strong>{metrics?.progressPercent ?? 0}%</strong></div>
              </div>

              {accountStates.length > 0 ? (
                <section className="multi-runtime-accounts" aria-label="Trạng thái tài khoản trong phiên">
                  <div className="multi-runtime-section-title">
                    <strong>Tài khoản trong phiên</strong>
                    <span>Trạng thái này độc lập với Status gốc của account.</span>
                  </div>
                  <div className="multi-runtime-account-list">
                    {accountStates.map((accountState) => (
                      <span
                        className={`multi-runtime-account account-${accountState.status}`}
                        key={accountState.accountId}
                        title={accountState.message ?? accountRuntimeLabels[accountState.status]}
                      >
                        <i aria-hidden="true" />
                        <b>{accountLabels.get(accountState.accountId) ?? `#${accountState.accountId}`}</b>
                        <em>{accountRuntimeLabels[accountState.status]}</em>
                      </span>
                    ))}
                  </div>
                  <div className="multi-runtime-account-legend" aria-label="Chú thích màu trạng thái tài khoản">
                    {(Object.entries(accountRuntimeLabels) as Array<[RotationAccountRuntimeStatus, string]>).map(([state, label]) => (
                      <span className={`legend-${state}`} key={state}><i aria-hidden="true" />{label}</span>
                    ))}
                  </div>
                </section>
              ) : null}

              {preview ? (
                <section className="multi-runtime-preview" aria-label="Bài đang đăng">
                  <div className="multi-runtime-section-title">
                    <strong>Bài đang đăng</strong>
                    <span>Preview runtime thật, không chứa đường dẫn ảnh/credential.</span>
                  </div>
                  <div className="multi-runtime-preview-meta">
                    <span>Group <b>{preview.groupUid}</b></span>
                    <span>Bài <b>#{preview.postIndex + 1}</b></span>
                    <span>Biến thể <b>#{preview.variantIndex + 1}</b></span>
                    <span>Ảnh <b>{preview.imageCount}</b></span>
                    <span>Ký tự <b>{preview.contentLength}</b></span>
                  </div>
                  <p>{preview.contentPreview || '(Bài không có nội dung text)'}</p>
                </section>
              ) : null}

              <dl className="multi-runtime-details">
                <div><dt>Tài khoản hiện tại</dt><dd>{currentAccount}</dd></div>
                <div><dt>Lượt tài khoản</dt><dd>{runtime ? `${runtime.slotsCompletedThisTurn}/${runtime.targetSlotsThisTurn}` : '—'}</dd></div>
                <div><dt>Vòng tài khoản</dt><dd>{runtime?.cycle ?? 0}</dd></div>
                <div><dt>Mã phiên</dt><dd>{runtime?.runId ?? '—'}</dd></div>
                <div><dt>Bắt đầu lúc</dt><dd>{formatTime(startedAt)}</dd></div>
                <div><dt>Thời gian chạy</dt><dd>{elapsed}</dd></div>
                <div><dt>Tác vụ kế tiếp</dt><dd>{formatTime(runtime?.nextActionAt ?? null)}</dd></div>
                <div><dt>Kết quả gần nhất</dt><dd>{lastStatus ? postingStatusLabels[lastStatus] : '—'}</dd></div>
              </dl>

              <footer>
                <span>{runtime?.message ?? 'Chưa có phiên chạy đang hoạt động.'}</span>
                <strong>{metrics ? `${metrics.success}/${metrics.total}` : '0/0'}</strong>
              </footer>
            </article>
          )
        })}
        {visibleTabs.length === 0 ? <div className="multi-runtime-empty">Chưa có Page Tab để chạy.</div> : null}
      </div>
      {!compact ? <p className="multi-runtime-note">Pause giữ nguyên run hiện tại. Stop kết thúc run. Sang ngày chạy mới, Group Set gốc được clone thành run mới.</p> : null}
    </section>
  )
}
