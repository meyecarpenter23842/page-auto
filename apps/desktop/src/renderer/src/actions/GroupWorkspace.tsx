import { useEffect, useMemo, useState } from 'react'
import type { AccountRecord } from '../../../shared/accounts'
import type { ActionWorkspaceAccountInput, ActionWorkspaceRecord } from '../../../shared/actionWorkspaces'
import {
  MAX_GROUP_ACCOUNT_CONCURRENCY,
  groupSourceRequiresClaimForParallel,
  parseGroupWorkspaceDraft,
  resolveGroupAccountConcurrency,
  serializeGroupWorkspaceDraft,
  splitGroupTargets,
  validateGroupWorkspaceDraft,
  type GroupJoinSourceMode,
  type GroupWorkspaceDraft
} from '../../../shared/groupWorkspaceConfig'
import type { InteractionWorkspaceRunSnapshot } from '../../../shared/interactionWorkspaceRunner'
import { AccountBindingPickerModal } from './AccountBindingPickerModal'
import './groupWorkspace.css'

interface GroupWorkspaceProps {
  workspace: ActionWorkspaceRecord
  availableAccounts: AccountRecord[]
  onWorkspaceSaved: (workspace: ActionWorkspaceRecord) => void
}

const SOURCE_OPTIONS: Array<{ id: GroupJoinSourceMode; label: string }> = [
  { id: 'keyword', label: 'Tham gia nhóm theo từ khóa / Graph Search' },
  { id: 'suggestions', label: 'Tham gia nhóm theo gợi ý' },
  { id: 'id_distribute', label: 'Tham gia theo ID (chia đều)' },
  { id: 'id_limit', label: 'Tham gia theo ID (limit / account)' },
  { id: 'id_shared', label: 'Tham gia chung ID' },
  { id: 'file', label: 'Tham gia theo file ID' },
  { id: 'account_file', label: '1 account / 1 file ID' }
]

function bindingInputs(workspace: ActionWorkspaceRecord): ActionWorkspaceAccountInput[] {
  return [...workspace.accounts]
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((binding) => ({ accountId: binding.accountId, enabled: binding.enabled }))
}

function signature(draft: GroupWorkspaceDraft, accounts: ActionWorkspaceAccountInput[]): string {
  return JSON.stringify({ configJson: serializeGroupWorkspaceDraft(draft), accounts })
}

function runtimeStateLabel(state: string | undefined): string {
  if (!state) return 'Sẵn sàng'
  const labels: Record<string, string> = {
    idle: 'Chưa chạy',
    stopping: 'Đang dừng',
    stopped: 'Đã dừng',
    queued: 'Chờ chạy',
    running: 'Đang chạy',
    paused: 'Tạm dừng',
    completed: 'Hoàn tất',
    failed: 'Lỗi',
    needs_attention: 'Cần xử lý'
  }
  return labels[state] ?? state
}

function sourceUsesInlineTargets(mode: GroupJoinSourceMode): boolean {
  return mode === 'id_distribute' || mode === 'id_limit' || mode === 'id_shared' || mode === 'file'
}

export function GroupWorkspace({ workspace, availableAccounts, onWorkspaceSaved }: GroupWorkspaceProps) {
  const initialDraft = useMemo(() => parseGroupWorkspaceDraft(workspace.configJson), [workspace.id])
  const initialBindings = useMemo(() => bindingInputs(workspace), [workspace.id])
  const [draft, setDraft] = useState<GroupWorkspaceDraft>(initialDraft)
  const [accountBindings, setAccountBindings] = useState<ActionWorkspaceAccountInput[]>(initialBindings)
  const [savedSignature, setSavedSignature] = useState(() => signature(initialDraft, initialBindings))
  const [showAccountPicker, setShowAccountPicker] = useState(false)
  const [saveBusy, setSaveBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [runBusy, setRunBusy] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const [runSnapshot, setRunSnapshot] = useState<InteractionWorkspaceRunSnapshot | null>(null)

  const currentSignature = useMemo(() => signature(draft, accountBindings), [draft, accountBindings])
  const isDirty = currentSignature !== savedSignature
  const selectedIds = useMemo(() => new Set(accountBindings.map((item) => item.accountId)), [accountBindings])
  const accountById = useMemo(() => new Map(availableAccounts.map((account) => [account.id, account])), [availableAccounts])
  const enabledCount = accountBindings.filter((item) => item.enabled).length
  const validationErrors = useMemo(() => validateGroupWorkspaceDraft(draft, enabledCount), [draft, enabledCount])
  const activeRun = Boolean(runSnapshot && ['running', 'paused', 'stopping'].includes(runSnapshot.state))
  const paused = runSnapshot?.state === 'paused'
  const targetCount = useMemo(() => splitGroupTargets(draft.sourceTargets).length, [draft.sourceTargets])
  const attemptedTotal = runSnapshot?.accountRuntimes.reduce((sum, item) => sum + item.attempted, 0) ?? 0
  const successTotal = runSnapshot?.accountRuntimes.reduce((sum, item) => sum + item.success, 0) ?? 0
  const sharedSourceSerial = groupSourceRequiresClaimForParallel(draft.sourceMode)
  const effectiveConcurrency = resolveGroupAccountConcurrency(draft, enabledCount)

  useEffect(() => {
    let disposed = false
    const refresh = async () => {
      try {
        const next = await window.pageAuto.getInteractionWorkspaceRunnerStatus({ workspaceId: workspace.id })
        if (!disposed) setRunSnapshot(next)
      } catch {
        // Command handlers surface errors; background polling stays quiet.
      }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 750)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [workspace.id])

  const setField = <K extends keyof GroupWorkspaceDraft>(key: K, value: GroupWorkspaceDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  const applyAccounts = (accountIds: number[]) => {
    const selected = new Set(accountIds)
    setAccountBindings((current) => {
      const kept = current.filter((item) => selected.has(item.accountId))
      const existing = new Set(kept.map((item) => item.accountId))
      const added = accountIds.filter((id) => !existing.has(id)).map((accountId) => ({ accountId, enabled: true }))
      return [...kept, ...added]
    })
    setShowAccountPicker(false)
  }

  const saveWorkspace = async (): Promise<boolean> => {
    if (saveBusy) return false
    setSaveBusy(true)
    setSaveError(null)
    try {
      const saved = await window.pageAuto.updateActionWorkspace({
        id: workspace.id,
        patch: {
          configJson: serializeGroupWorkspaceDraft(draft),
          accounts: accountBindings
        }
      })
      const savedDraft = parseGroupWorkspaceDraft(saved.configJson)
      const savedAccounts = bindingInputs(saved)
      setDraft(savedDraft)
      setAccountBindings(savedAccounts)
      setSavedSignature(signature(savedDraft, savedAccounts))
      onWorkspaceSaved(saved)
      return true
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
      return false
    } finally {
      setSaveBusy(false)
    }
  }

  const startRun = async () => {
    if (runBusy || activeRun || validationErrors.length) return
    setRunBusy(true)
    setRunError(null)
    try {
      if (isDirty && !await saveWorkspace()) return
      const next = await window.pageAuto.startInteractionWorkspaceRunner({ workspaceId: workspace.id })
      setRunSnapshot(next)
    } catch (error) {
      setRunError(error instanceof Error ? error.message : String(error))
    } finally {
      setRunBusy(false)
    }
  }

  const controlRun = async (command: 'pause' | 'resume' | 'stop') => {
    if (runBusy) return
    setRunBusy(true)
    setRunError(null)
    try {
      const payload = { workspaceId: workspace.id }
      const next = command === 'pause'
        ? await window.pageAuto.pauseInteractionWorkspaceRunner(payload)
        : command === 'resume'
          ? await window.pageAuto.resumeInteractionWorkspaceRunner(payload)
          : await window.pageAuto.stopInteractionWorkspaceRunner(payload)
      setRunSnapshot(next)
    } catch (error) {
      setRunError(error instanceof Error ? error.message : String(error))
    } finally {
      setRunBusy(false)
    }
  }

  const loadIdFile = async () => {
    const picked = await window.pageAuto.pickPageTabTextFile()
    if (!picked) return
    setDraft((current) => ({
      ...current,
      sourceTargets: picked.content,
      sourceFileLabel: `${splitGroupTargets(picked.content).length} Group ID đã nạp`
    }))
  }

  const pickAccountFileFolder = async () => {
    const folder = await window.pageAuto.pickPageTabImageFolder()
    if (!folder) return
    setDraft((current) => ({ ...current, sourceMode: 'account_file', accountFilePath: folder }))
  }

  return (
    <section className="group-workspace" aria-label={workspace.label}>
      <div className="group-workspace-toolbar">
        <div className="group-workspace-title">
          <span className="group-workspace-kicker">NHÓM</span>
          <strong>Tham gia nhóm</strong>
          <small>Action thật · verify Đã tham gia / Đang chờ · Global Browser Action Delay luôn áp dụng.</small>
        </div>
        <div className="group-workspace-save">
          <span className={isDirty ? 'dirty' : ''}>{saveBusy ? 'Đang lưu…' : isDirty ? 'Có thay đổi chưa lưu' : 'Đã đồng bộ'}</span>
          <button type="button" disabled={!isDirty || saveBusy || activeRun} onClick={() => void saveWorkspace()}>Lưu cấu hình</button>
        </div>
      </div>

      {saveError ? <div className="group-workspace-error">{saveError}</div> : null}
      {runError ? <div className="group-workspace-error">{runError}</div> : null}
      {validationErrors.length ? <div className="group-workspace-warning">{validationErrors.join(' · ')}</div> : null}

      <div className="group-workspace-grid">
        <section className="group-account-panel group-box">
          <div className="group-account-toolbar">
            <strong>Danh sách tài khoản ({accountBindings.length})</strong>
            <div>
              <button type="button" onClick={() => applyAccounts(availableAccounts.map((account) => account.id))}>Tất cả</button>
              <button type="button" onClick={() => setShowAccountPicker(true)}>Chọn tài khoản</button>
              <button type="button" onClick={() => setAccountBindings([])}>Clear</button>
            </div>
          </div>

          <div className="group-account-table-wrap">
            <table className="group-account-table">
              <thead><tr><th className="check"><input type="checkbox" aria-label="Bật tất cả account đã chọn" checked={accountBindings.length > 0 && accountBindings.every((item) => item.enabled)} onChange={(event) => setAccountBindings((current) => current.map((item) => ({ ...item, enabled: event.target.checked })))} /></th><th>UID / UserName</th><th>Trạng thái</th><th>Tham gia</th><th>Thành công</th></tr></thead>
              <tbody>
                {accountBindings.map((binding) => {
                  const account = accountById.get(binding.accountId)
                  const runtime = runSnapshot?.accountRuntimes.find((item) => item.accountId === binding.accountId)
                  return <tr key={binding.accountId} className={binding.enabled ? '' : 'disabled'}>
                    <td className="check"><input type="checkbox" checked={binding.enabled} onChange={(event) => setAccountBindings((current) => current.map((item) => item.accountId === binding.accountId ? { ...item, enabled: event.target.checked } : item))} /></td>
                    <td><strong>{account?.uid ?? `#${binding.accountId}`}</strong><small>{account?.username ?? account?.name ?? '—'}</small></td>
                    <td><span className={`group-runtime-state state-${runtime?.state ?? 'idle'}`}>{runtimeStateLabel(runtime?.state)}</span></td>
                    <td className="number">{runtime?.attempted ?? 0}</td>
                    <td className="number">{runtime?.success ?? 0}</td>
                  </tr>
                })}
                {!accountBindings.length ? <tr><td colSpan={5} className="empty">Chưa chọn tài khoản.</td></tr> : null}
              </tbody>
            </table>
          </div>

          <div className="group-account-summary">
            <span>Đã chọn: <strong>{enabledCount}</strong></span>
            <span>Tổng: <strong>{accountBindings.length}</strong></span>
            <span>Tham gia: <strong>{attemptedTotal}</strong></span>
            <span>Thành công: <strong>{successTotal}</strong></span>
          </div>
        </section>

        <section className="group-source-panel group-box">
          <fieldset className="group-fieldset">
            <legend>1. Nguồn nhóm</legend>
            <div className="group-source-options">
              {SOURCE_OPTIONS.map((option) => (
                <div className={`group-source-row ${draft.sourceMode === option.id ? 'active' : ''}`} key={option.id}>
                  <label><input type="radio" name={`group-source-${workspace.id}`} checked={draft.sourceMode === option.id} onChange={() => setField('sourceMode', option.id)} /><span>{option.label}</span></label>
                  {option.id === 'keyword' && draft.sourceMode === option.id ? <input className="group-inline-input" value={draft.keyword} onChange={(event) => setField('keyword', event.target.value)} placeholder="Thời Trang Hàng Hiệu, Thời Trang Nữ" /> : null}
                  {option.id === 'suggestions' && draft.sourceMode === option.id ? <div className="group-inline-note">Dùng nguồn Gợi ý nhóm hiện tại của Facebook. Không đoán selector danh mục phụ.</div> : null}
                  {option.id === 'id_limit' && draft.sourceMode === option.id ? <label className="group-limit-inline"><span>Limit / 1 account</span><input type="number" min={1} max={100000} value={draft.limitPerAccount} onChange={(event) => setField('limitPerAccount', Number(event.target.value))} /></label> : null}
                  {option.id === 'file' && draft.sourceMode === option.id ? <div className="group-file-inline"><span>{draft.sourceFileLabel || `${targetCount} Group ID`}</span><button type="button" onClick={() => void loadIdFile()}>Chọn file</button></div> : null}
                  {option.id === 'account_file' && draft.sourceMode === option.id ? <div className="group-file-inline"><input value={draft.accountFilePath} onChange={(event) => setField('accountFilePath', event.target.value)} placeholder={'D:\\Data\\GROUP_ID hoặc D:\\Data\\{uid}.txt'} /><button type="button" onClick={() => void pickAccountFileFolder()}>Chọn folder</button></div> : null}
                </div>
              ))}
            </div>

            {sourceUsesInlineTargets(draft.sourceMode) ? <label className="group-textarea-field"><span>Group ID / URL <small>{targetCount} mục</small></span><textarea rows={7} value={draft.sourceTargets} onChange={(event) => setField('sourceTargets', event.target.value)} placeholder="Mỗi dòng một Group UID hoặc URL Facebook" />{draft.sourceMode !== 'file' ? <button type="button" className="group-load-file-button" onClick={() => void loadIdFile()}>Nạp file ID</button> : null}</label> : null}

            <label className="group-check-row group-answer-toggle"><input type="checkbox" checked={draft.answerQuestionsEnabled} onChange={(event) => setField('answerQuestionsEnabled', event.target.checked)} /><span>Trả lời câu hỏi của nhóm (nếu có)</span></label>
            <label className="group-textarea-field"><span>Câu trả lời khi tham gia nhóm <small>mỗi dòng một câu trả lời text</small></span><textarea disabled={!draft.answerQuestionsEnabled} rows={5} value={draft.answerQuestions} onChange={(event) => setField('answerQuestions', event.target.value)} placeholder={'ok\nyes\nvâng'} /></label>

            <div className="group-range-row"><span>Số lượng nhóm muốn tham gia / account</span><label>Từ <input type="number" min={1} max={5000} value={draft.joinMin} onChange={(event) => setField('joinMin', Number(event.target.value))} /></label><label>đến <input type="number" min={1} max={5000} value={draft.joinMax} onChange={(event) => setField('joinMax', Number(event.target.value))} /></label></div>
          </fieldset>
        </section>

        <section className="group-options-panel">
          <fieldset className="group-fieldset group-box">
            <legend>2. Điều kiện lọc nhóm</legend>
            <div className="group-check-row range-check"><label><input type="checkbox" checked={draft.memberFilterEnabled} onChange={(event) => setField('memberFilterEnabled', event.target.checked)} /><span>Thành viên</span></label><span>Từ</span><input disabled={!draft.memberFilterEnabled} type="number" min={0} value={draft.memberMin} onChange={(event) => setField('memberMin', Number(event.target.value))} /><span>đến</span><input disabled={!draft.memberFilterEnabled} type="number" min={0} value={draft.memberMax} onChange={(event) => setField('memberMax', Number(event.target.value))} /><small>0 = không giới hạn trên</small></div>
            <div className="group-check-row"><span className="row-label">Privacy</span><label><input type="checkbox" checked={draft.privacyOpen} onChange={(event) => setField('privacyOpen', event.target.checked)} /><span>OPEN</span></label><label><input type="checkbox" checked={draft.privacyClosed} onChange={(event) => setField('privacyClosed', event.target.checked)} /><span>CLOSE</span></label></div>
            <label className="group-check-row"><input type="checkbox" checked={draft.skipApprovalRequired} onChange={(event) => setField('skipApprovalRequired', event.target.checked)} /><span>Bỏ qua nhóm phải duyệt khi không có câu trả lời</span></label>
            <div className="group-check-row"><label><input type="checkbox" checked={draft.localeEnabled} onChange={(event) => setField('localeEnabled', event.target.checked)} /><span>Gia nhập nhóm có locale</span></label><select disabled={!draft.localeEnabled} value={draft.locale} onChange={(event) => setField('locale', event.target.value)}><option value="vi_VN">Vietnam (Tiếng Việt)</option><option value="en_US">English (US)</option></select></div>
            <div className="group-check-row"><label><input type="checkbox" checked={draft.locationEnabled} onChange={(event) => setField('locationEnabled', event.target.checked)} /><span>Gia nhập nhóm có location</span></label><input disabled={!draft.locationEnabled} value={draft.locationKeyword} onChange={(event) => setField('locationKeyword', event.target.value)} placeholder="Viet Nam" /></div>
            <p className="group-filter-note">Locale/location chỉ lọc khi Facebook hiển thị dữ liệu đó trên surface đang audit; không coi dữ liệu không đọc được là đạt điều kiện.</p>
          </fieldset>

          <fieldset className="group-fieldset group-box group-request-box">
            <legend>3. Xử lý yêu cầu tham gia</legend>
            <div className="group-request-summary"><strong>Câu hỏi nhóm</strong><span>Action hiện xử lý ô trả lời dạng text và chỉ báo success sau khi verify “Đã tham gia” hoặc “Đang chờ”.</span></div>
            <label className="group-check-row"><input type="checkbox" checked={draft.skipApprovalRequired} onChange={(event) => setField('skipApprovalRequired', event.target.checked)} /><span>Bỏ qua nhóm cần duyệt nếu không có nội dung trả lời</span></label>
            <div className="group-check-row"><span className="row-label">Tạm nghỉ khi lượt join lỗi</span><input className="short" type="number" min={0} max={1440} value={draft.errorPauseMinutes} onChange={(event) => setField('errorPauseMinutes', Number(event.target.value))} /><span>phút</span></div>
          </fieldset>
        </section>
      </div>

      <fieldset className="group-fieldset group-box group-pacing-box">
        <legend>4. Nhịp chạy</legend>
        <div className="group-pacing-grid">
          <div className="group-range-row"><span>Delay nghiệp vụ</span><label>Từ <input type="number" min={0} max={3600} value={draft.itemDelayMinSeconds} onChange={(event) => setField('itemDelayMinSeconds', Number(event.target.value))} /></label><label>đến <input type="number" min={0} max={3600} value={draft.itemDelayMaxSeconds} onChange={(event) => setField('itemDelayMaxSeconds', Number(event.target.value))} /></label><small>giây · cộng thêm Global Browser Action Delay</small></div>
          <div className="group-range-row"><span>Tạm dừng sau khi xử lý</span><input type="number" min={0} max={10000} value={draft.pauseAfterCount} onChange={(event) => setField('pauseAfterCount', Number(event.target.value))} /><span>nhóm</span><span>Thời gian</span><input type="number" min={0} max={1440} value={draft.pauseMinutes} onChange={(event) => setField('pauseMinutes', Number(event.target.value))} /><span>phút</span></div>
          <div className="group-check-row"><span className="row-label">TK song song</span><input className="short" type="number" min={1} max={MAX_GROUP_ACCOUNT_CONCURRENCY} disabled={sharedSourceSerial} value={sharedSourceSerial ? 1 : draft.accountConcurrency} onChange={(event) => setField('accountConcurrency', Number(event.target.value))} /><span>{sharedSourceSerial ? 'tạm 1 TK · nguồn dùng chung chờ Group claim' : `tối đa ${effectiveConcurrency} TK · cuốn chiếu`}</span></div>
          <div className="group-check-row"><label><input type="checkbox" checked={draft.repeatEnabled} onChange={(event) => setField('repeatEnabled', event.target.checked)} /><span>Repeat</span></label><input className="short" disabled={!draft.repeatEnabled} type="number" min={1} max={999} value={draft.repeatCount} onChange={(event) => setField('repeatCount', Number(event.target.value))} /><span>lần / account</span></div>
        </div>

        <div className="group-run-controls">
          <div className="group-run-state"><span className={`run-dot state-${runSnapshot?.state ?? 'idle'}`} /><strong>{runSnapshot ? runtimeStateLabel(runSnapshot.state) : 'Chưa chạy'}</strong><small>{runSnapshot?.message ?? (sharedSourceSerial ? 'Nguồn Group dùng chung đang giữ 1 account cho tới Batch 4 atomic claim; Browser Launch Spacing vẫn áp dụng.' : `Tối đa ${effectiveConcurrency} account chạy song song kiểu cuốn chiếu; Browser Launch Spacing vẫn áp dụng.`)}</small></div>
          <div className="group-run-buttons">
            {activeRun && paused ? <button className="resume" type="button" disabled={runBusy} onClick={() => void controlRun('resume')}>Tiếp tục</button> : activeRun ? <button className="pause" type="button" disabled={runBusy || runSnapshot?.state === 'stopping'} onClick={() => void controlRun('pause')}>Tạm dừng</button> : null}
            <button className="start" type="button" disabled={activeRun || runBusy || validationErrors.length > 0} onClick={() => void startRun()}>Bắt đầu</button>
            <button className="stop" type="button" disabled={!activeRun || runBusy} onClick={() => void controlRun('stop')}>Kết thúc</button>
          </div>
        </div>
      </fieldset>

      <section className="group-runtime-log group-box">
        <div className="group-runtime-log-head"><strong>Log runtime</strong><span>{runSnapshot?.logs.length ?? 0} dòng</span></div>
        <div className="group-runtime-log-body">
          {(runSnapshot?.logs ?? []).slice(-80).map((entry) => <div key={entry.id} data-level={entry.level}><time>{new Date(entry.at).toLocaleTimeString('vi-VN')}</time><span>{entry.message}</span></div>)}
          {!runSnapshot?.logs.length ? <p>Chưa có log phiên Nhóm.</p> : null}
        </div>
      </section>

      {showAccountPicker ? <AccountBindingPickerModal accounts={availableAccounts} selectedIds={selectedIds} onApply={applyAccounts} onClose={() => setShowAccountPicker(false)} contextLabel="Nhóm" /> : null}
    </section>
  )
}
