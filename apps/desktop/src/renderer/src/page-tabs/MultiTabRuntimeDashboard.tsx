import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AccountRecord } from '../../../shared/accounts'
import type { PageTabSummary } from '../../../shared/pageTabs'
import type { RotationRuntimeSnapshot } from '../../../shared/rotation'
import './multiTabRuntime.css'

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':')
}

function formatTime(timestamp: number | null): string {
  if (!timestamp) return '—'
  return new Date(timestamp).toLocaleString()
}

function canStart(status: RotationRuntimeSnapshot['status']): boolean {
  return status === 'idle' || status === 'completed' || status === 'error'
}

function canPause(status: RotationRuntimeSnapshot['status']): boolean {
  return status === 'starting' || status === 'running' || status === 'waiting_window'
}

function canResume(status: RotationRuntimeSnapshot['status']): boolean {
  return status === 'paused'
}

export function MultiTabRuntimeDashboard() {
  const [tabs, setTabs] = useState<PageTabSummary[]>([])
  const [accounts, setAccounts] = useState<AccountRecord[]>([])
  const [runtimeByTab, setRuntimeByTab] = useState<Record<number, RotationRuntimeSnapshot>>({})
  const [busyTabs, setBusyTabs] = useState<Set<number>>(() => new Set())
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())

  const refreshStatic = useCallback(async () => {
    try {
      const [nextTabs, nextAccounts] = await Promise.all([
        window.pageAuto.listPageTabs(),
        window.pageAuto.listAccounts()
      ])
      setTabs(nextTabs)
      setAccounts(nextAccounts)
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

  const activeCount = tabs.filter((tab) => {
    const status = runtimeByTab[tab.id]?.status
    return status === 'starting' || status === 'running' || status === 'waiting_window'
  }).length

  const runAction = async (
    pageTabId: number,
    action: (payload: { pageTabId: number }) => Promise<RotationRuntimeSnapshot>
  ) => {
    setBusyTabs((current) => new Set(current).add(pageTabId))
    setError(null)
    try {
      const snapshot = await action({ pageTabId })
      setRuntimeByTab((current) => ({ ...current, [pageTabId]: snapshot }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusyTabs((current) => {
        const next = new Set(current)
        next.delete(pageTabId)
        return next
      })
    }
  }

  return (
    <section className="multi-runtime-shell">
      <div className="multi-runtime-heading">
        <div>
          <p className="eyebrow">Phase 7 · Worker Manager</p>
          <h2>Multi Page Runtime</h2>
          <p>Mỗi Page Tab có runtime riêng; nhiều tab chạy song song, account trong từng tab vẫn tuần tự.</p>
        </div>
        <div className="multi-runtime-summary">
          <span><strong>{activeCount}</strong> active</span>
          <span><strong>{tabs.length}</strong> tabs</span>
          <button type="button" onClick={() => { void refreshStatic(); void refreshRuntime() }}>Refresh</button>
        </div>
      </div>

      {error ? <div className="multi-runtime-error">{error}</div> : null}

      <div className="multi-runtime-grid">
        {tabs.map((tab) => {
          const runtime = runtimeByTab[tab.id]
          const status = runtime?.status ?? 'idle'
          const run = runtime?.run
          const metrics = run?.metrics
          const startedAt = run?.run.startedAt ?? null
          const currentAccount = runtime?.currentAccountId
            ? accountLabels.get(runtime.currentAccountId) ?? `#${runtime.currentAccountId}`
            : '—'
          const busy = busyTabs.has(tab.id)
          const elapsed = startedAt ? formatDuration(now - startedAt) : '00:00:00'

          return (
            <article className={`multi-runtime-card runtime-${status}`} key={tab.id}>
              <header>
                <div>
                  <span className="multi-runtime-status">{status}</span>
                  <h3>{tab.name}</h3>
                  <small>Page UID {tab.pageUid}</small>
                </div>
                <div className="multi-runtime-actions">
                  <button
                    type="button"
                    disabled={busy || !canStart(status)}
                    onClick={() => void runAction(tab.id, window.pageAuto.startPageTabRotation)}
                  >Start</button>
                  <button
                    type="button"
                    disabled={busy || !canPause(status)}
                    onClick={() => void runAction(tab.id, window.pageAuto.pausePageTabRotation)}
                  >Pause</button>
                  <button
                    type="button"
                    disabled={busy || !canResume(status)}
                    onClick={() => void runAction(tab.id, window.pageAuto.resumePageTabRotation)}
                  >Resume</button>
                </div>
              </header>

              <div className="multi-runtime-metrics">
                <div><span>Đã đăng</span><strong>{metrics?.success ?? 0}</strong></div>
                <div><span>Còn lại</span><strong>{metrics?.remaining ?? 0}</strong></div>
                <div><span>Failed</span><strong>{metrics?.failed ?? 0}</strong></div>
                <div><span>Progress</span><strong>{metrics?.progressPercent ?? 0}%</strong></div>
              </div>

              <dl className="multi-runtime-details">
                <div><dt>Account hiện tại</dt><dd>{currentAccount}</dd></div>
                <div><dt>Lượt account</dt><dd>{runtime ? `${runtime.slotsCompletedThisTurn}/${runtime.targetSlotsThisTurn}` : '—'}</dd></div>
                <div><dt>Vòng account</dt><dd>{runtime?.cycle ?? 0}</dd></div>
                <div><dt>Run ID</dt><dd>{runtime?.runId ?? '—'}</dd></div>
                <div><dt>Started at</dt><dd>{formatTime(startedAt)}</dd></div>
                <div><dt>Runtime</dt><dd>{elapsed}</dd></div>
                <div><dt>Next action</dt><dd>{formatTime(runtime?.nextActionAt ?? null)}</dd></div>
                <div><dt>Last result</dt><dd>{runtime?.lastResult?.status ?? '—'}</dd></div>
              </dl>

              <footer>
                <span>{runtime?.message ?? 'Chưa có runtime active.'}</span>
                <strong>{metrics ? `${metrics.success}/${metrics.total}` : '0/0'}</strong>
              </footer>
            </article>
          )
        })}
        {tabs.length === 0 ? <div className="multi-runtime-empty">Chưa có Page Tab để chạy.</div> : null}
      </div>
      <p className="multi-runtime-note">Runtime đọc cấu hình đã Save trong DB. Chi tiết group/content/image và recovery log sâu được mở rộng ở Phase 8.</p>
    </section>
  )
}
