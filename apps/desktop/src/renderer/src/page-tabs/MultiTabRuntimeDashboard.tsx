import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AccountRecord } from '../../../shared/accounts'
import type { PageTabSummary } from '../../../shared/pageTabs'
import type { PostingResultStatus } from '../../../shared/posting'
import type { RotationRuntimeSnapshot } from '../../../shared/rotation'
import './multiTabRuntime.css'

const runtimeStatusLabels: Record<RotationRuntimeSnapshot['status'], string> = {
  idle: 'Chưa chạy',
  starting: 'Đang khởi động',
  running: 'Đang chạy',
  paused: 'Tạm dừng',
  waiting_window: 'Chờ khung giờ',
  completed: 'Hoàn tất',
  error: 'Lỗi'
}

const postingStatusLabels: Record<PostingResultStatus, string> = {
  success: 'Thành công',
  failed: 'Lỗi',
  needs_login: 'Cần đăng nhập',
  skipped: 'Bỏ qua'
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
  return status === 'idle' || status === 'completed' || status === 'error'
}

function canPause(status: RotationRuntimeSnapshot['status']): boolean {
  return status === 'starting' || status === 'running' || status === 'waiting_window'
}

function canResume(status: RotationRuntimeSnapshot['status']): boolean {
  return status === 'paused'
}

interface MultiTabRuntimeDashboardProps {
  pageTabId?: number | null
  compact?: boolean
}

export function MultiTabRuntimeDashboard({ pageTabId = null, compact = false }: MultiTabRuntimeDashboardProps) {
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

  const visibleTabs = useMemo(
    () => pageTabId === null ? tabs : tabs.filter((tab) => tab.id === pageTabId),
    [pageTabId, tabs]
  )

  const activeCount = visibleTabs.filter((tab) => {
    const status = runtimeByTab[tab.id]?.status
    return status === 'starting' || status === 'running' || status === 'waiting_window'
  }).length

  const runAction = async (
    currentPageTabId: number,
    action: (payload: { pageTabId: number }) => Promise<RotationRuntimeSnapshot>
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

  return (
    <section className={compact ? 'multi-runtime-shell compact' : 'multi-runtime-shell'}>
      <div className="multi-runtime-heading">
        <div>
          <p className="eyebrow">Điều phối Page Tab</p>
          <h2>{compact ? 'Trạng thái Page hiện tại' : 'Trạng thái nhiều Page'}</h2>
          {!compact ? <p>Mỗi Page Tab có trạng thái riêng; nhiều tab chạy song song, tài khoản trong từng tab vẫn chạy tuần tự.</p> : null}
        </div>
        <div className="multi-runtime-summary">
          {!compact ? <span><strong>{activeCount}</strong> đang chạy</span> : null}
          {!compact ? <span><strong>{visibleTabs.length}</strong> tab</span> : null}
          <button type="button" onClick={() => { void refreshStatic(); void refreshRuntime() }}>Làm mới</button>
        </div>
      </div>

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
                </div>
              </header>

              <div className="multi-runtime-metrics">
                <div><span>Đã đăng</span><strong>{metrics?.success ?? 0}</strong></div>
                <div><span>Còn lại</span><strong>{metrics?.remaining ?? 0}</strong></div>
                <div><span>Lỗi</span><strong>{metrics?.failed ?? 0}</strong></div>
                <div><span>Tiến độ</span><strong>{metrics?.progressPercent ?? 0}%</strong></div>
              </div>

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
      {!compact ? <p className="multi-runtime-note">Trạng thái chạy dùng cấu hình đã lưu trong cơ sở dữ liệu. Group, nội dung, ảnh và nhật ký chi tiết nằm trong cấu hình từng Page Tab.</p> : null}
    </section>
  )
}
