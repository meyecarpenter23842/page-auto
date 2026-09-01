import { useEffect, useMemo, useState } from 'react'
import type { AccountRecord } from '../../../shared/accounts'
import type { ActionWorkspaceAccountInput, ActionWorkspaceRecord } from '../../../shared/actionWorkspaces'
import type { InteractionWorkspaceRunSnapshot } from '../../../shared/interactionWorkspaceRunner'
import {
  buildInteractionWorkspacePlan,
  INTERACTION_ACTION_OPTIONS,
  INTERACTION_TARGET_OPTIONS,
  interactionTargetNeedsText,
  parseInteractionWorkspaceDraft,
  serializeInteractionWorkspaceDraft,
  type InteractionActionKey,
  type InteractionReactionKey,
  type InteractionWorkspaceDraft
} from './interactionWorkspaceModel'
import './interactionWorkspace.css'
import './interactionWorkspacePersistence.css'
import './interactionWorkspaceRunner.css'

interface InteractionWorkspaceProps {
  workspace: ActionWorkspaceRecord
  availableAccounts: AccountRecord[]
  onWorkspaceSaved: (workspace: ActionWorkspaceRecord) => void
}

const REACTIONS: Array<{ key: InteractionReactionKey; label: string; emoji: string }> = [
  { key: 'like', label: 'Like', emoji: '👍' },
  { key: 'love', label: 'Love', emoji: '❤️' },
  { key: 'care', label: 'Care', emoji: '🤗' },
  { key: 'haha', label: 'Haha', emoji: '😆' },
  { key: 'wow', label: 'Wow', emoji: '😮' },
  { key: 'sad', label: 'Sad', emoji: '😢' },
  { key: 'angry', label: 'Angry', emoji: '😡' }
]

function bindingInputs(workspace: ActionWorkspaceRecord): ActionWorkspaceAccountInput[] {
  return [...workspace.accounts]
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((binding) => ({ accountId: binding.accountId, enabled: binding.enabled }))
}

function persistenceSignature(draft: InteractionWorkspaceDraft, accounts: ActionWorkspaceAccountInput[]): string {
  return JSON.stringify({ configJson: serializeInteractionWorkspaceDraft(draft), accounts })
}

function runStateLabel(snapshot: InteractionWorkspaceRunSnapshot | null): string {
  if (!snapshot) return 'Chưa chạy'
  const labels: Record<InteractionWorkspaceRunSnapshot['state'], string> = {
    running: 'Đang chạy',
    paused: 'Đã Pause',
    stopping: 'Đang dừng',
    completed: 'Hoàn tất',
    stopped: 'Đã dừng',
    failed: 'Lỗi'
  }
  return labels[snapshot.state]
}

export function InteractionWorkspace({ workspace, availableAccounts, onWorkspaceSaved }: InteractionWorkspaceProps) {
  const initialDraft = useMemo(() => parseInteractionWorkspaceDraft(workspace.configJson), [workspace.id])
  const initialBindings = useMemo(() => bindingInputs(workspace), [workspace.id])
  const [draft, setDraft] = useState<InteractionWorkspaceDraft>(initialDraft)
  const [accountBindings, setAccountBindings] = useState<ActionWorkspaceAccountInput[]>(initialBindings)
  const [accountSearch, setAccountSearch] = useState('')
  const [savedSignature, setSavedSignature] = useState(() => persistenceSignature(initialDraft, initialBindings))
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [runSnapshot, setRunSnapshot] = useState<InteractionWorkspaceRunSnapshot | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const [runBusy, setRunBusy] = useState(false)

  const plan = useMemo(() => buildInteractionWorkspacePlan(draft), [draft])
  const targetOption = INTERACTION_TARGET_OPTIONS.find((option) => option.id === draft.targetMode)
  const currentSignature = useMemo(() => persistenceSignature(draft, accountBindings), [draft, accountBindings])
  const isDirty = currentSignature !== savedSignature
  const selectedIds = useMemo(() => new Set(accountBindings.map((item) => item.accountId)), [accountBindings])
  const accountById = useMemo(() => new Map(availableAccounts.map((account) => [account.id, account])), [availableAccounts])
  const filteredAccounts = useMemo(() => {
    const query = accountSearch.trim().toLowerCase()
    if (!query) return availableAccounts
    return availableAccounts.filter((account) => [account.uid, account.name, account.status, account.category]
      .some((value) => value?.toLowerCase().includes(query)))
  }, [accountSearch, availableAccounts])
  const enabledAccountCount = accountBindings.filter((item) => item.enabled).length
  const activeRun = runSnapshot && ['running', 'paused', 'stopping'].includes(runSnapshot.state)
  const allModulesReady = plan.modules.length > 0 && plan.modules.every((module) => module.runtimeStatus === 'ready')
  const canStart = !activeRun && !isDirty && plan.errors.length === 0 && enabledAccountCount > 0 && allModulesReady && !runBusy

  useEffect(() => {
    let disposed = false
    const refresh = async () => {
      try {
        const next = await window.pageAuto.getInteractionWorkspaceRunnerStatus({ workspaceId: workspace.id })
        if (!disposed) setRunSnapshot(next)
      } catch {
        // Start/control handlers show actionable errors; background polling stays quiet.
      }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 750)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [workspace.id])

  const setAction = (key: InteractionActionKey, checked: boolean) => {
    setDraft((current) => ({ ...current, actions: { ...current.actions, [key]: checked } }))
    setSaveStatus('idle')
  }

  const setReaction = (key: InteractionReactionKey, checked: boolean) => {
    setDraft((current) => ({ ...current, reactions: { ...current.reactions, [key]: checked } }))
    setSaveStatus('idle')
  }

  const toggleAccount = (accountId: number, checked: boolean) => {
    setAccountBindings((current) => checked
      ? (current.some((item) => item.accountId === accountId) ? current : [...current, { accountId, enabled: true }])
      : current.filter((item) => item.accountId !== accountId))
    setSaveStatus('idle')
  }

  const setAccountEnabled = (accountId: number, enabled: boolean) => {
    setAccountBindings((current) => current.map((item) => item.accountId === accountId ? { ...item, enabled } : item))
    setSaveStatus('idle')
  }

  const moveAccount = (accountId: number, direction: -1 | 1) => {
    setAccountBindings((current) => {
      const index = current.findIndex((item) => item.accountId === accountId)
      const targetIndex = index + direction
      if (index < 0 || targetIndex < 0 || targetIndex >= current.length) return current
      const next = [...current]
      const [item] = next.splice(index, 1)
      if (!item) return current
      next.splice(targetIndex, 0, item)
      return next
    })
    setSaveStatus('idle')
  }

  const saveWorkspace = async () => {
    if (saveStatus === 'saving') return
    setSaveStatus('saving')
    setSaveError(null)
    try {
      const saved = await window.pageAuto.updateActionWorkspace({
        id: workspace.id,
        patch: {
          configJson: serializeInteractionWorkspaceDraft(draft),
          accounts: accountBindings
        }
      })
      const savedDraft = parseInteractionWorkspaceDraft(saved.configJson)
      const savedAccounts = bindingInputs(saved)
      setDraft(savedDraft)
      setAccountBindings(savedAccounts)
      setSavedSignature(persistenceSignature(savedDraft, savedAccounts))
      setSaveStatus('saved')
      onWorkspaceSaved(saved)
    } catch (error) {
      setSaveStatus('error')
      setSaveError(error instanceof Error ? error.message : String(error))
    }
  }

  const runCommand = async (
    command: 'start' | 'pause' | 'resume' | 'stop'
  ) => {
    if (runBusy) return
    setRunBusy(true)
    setRunError(null)
    try {
      const payload = { workspaceId: workspace.id }
      const next = command === 'start'
        ? await window.pageAuto.startInteractionWorkspaceRunner(payload)
        : command === 'pause'
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

  return (
    <section className="interaction-workspace" aria-label={workspace.label}>
      <div className="interaction-workspace-head">
        <div>
          <p className="interaction-kicker">WORKSPACE NGHIỆP VỤ</p>
          <h2>{workspace.label}</h2>
          <p>Start tạo snapshot bất biến từ config + account binding đã lưu. Sửa cấu hình sau đó không làm đổi phiên đang chạy.</p>
        </div>
        <div className="interaction-head-actions">
          <div className="interaction-save-state" data-state={saveStatus}>{saveStatus === 'saving' ? 'Đang lưu…' : isDirty ? 'Chưa lưu' : saveStatus === 'saved' ? 'Đã lưu' : 'Đã đồng bộ'}</div>
          <button className="interaction-save-button" type="button" disabled={!isDirty || saveStatus === 'saving'} onClick={() => void saveWorkspace()}>Lưu cấu hình</button>
          <div className="interaction-actor-switch" aria-label="Actor chạy">
            <span>Actor</span>
            <button type="button" className={draft.actor === 'profile' ? 'active' : ''} onClick={() => { setDraft((current) => ({ ...current, actor: 'profile' })); setSaveStatus('idle') }}>Profile</button>
            <button type="button" className={draft.actor === 'page' ? 'active' : ''} onClick={() => { setDraft((current) => ({ ...current, actor: 'page' })); setSaveStatus('idle') }}>Page</button>
          </div>
        </div>
      </div>
      {saveError ? <div className="interaction-save-error">{saveError}</div> : null}
      {runError ? <div className="interaction-save-error interaction-run-error">{runError}</div> : null}

      <div className="interaction-layout">
        <div className="interaction-main-column">
          <section className="interaction-card interaction-account-card">
            <div className="interaction-card-head"><div><span>01</span><h3>Tài khoản chạy</h3></div><small>{enabledAccountCount}/{accountBindings.length} account đang bật · runner chạy tuần tự theo thứ tự này.</small></div>
            <div className="interaction-account-binding-layout">
              <div className="interaction-account-picker">
                <div className="interaction-account-picker-toolbar">
                  <input value={accountSearch} onChange={(event) => setAccountSearch(event.target.value)} placeholder="Tìm UID, tên, trạng thái, nhóm…" />
                  <span>{filteredAccounts.length}/{availableAccounts.length}</span>
                </div>
                <div className="interaction-account-table" role="list" aria-label="Account Manager">
                  {filteredAccounts.map((account) => (
                    <label className={selectedIds.has(account.id) ? 'interaction-account-row selected' : 'interaction-account-row'} key={account.id}>
                      <input type="checkbox" checked={selectedIds.has(account.id)} onChange={(event) => toggleAccount(account.id, event.target.checked)} />
                      <span className="interaction-account-identity"><strong>{account.uid}</strong><small>{account.name || 'Chưa có tên'}</small></span>
                      <span className="interaction-account-meta"><b>{account.status}</b><small>{account.category || 'Không nhóm'}</small></span>
                    </label>
                  ))}
                  {!filteredAccounts.length ? <div className="interaction-account-empty">Không có account phù hợp.</div> : null}
                </div>
              </div>

              <div className="interaction-account-order">
                <div className="interaction-account-order-head"><strong>Thứ tự chạy</strong><small>Mỗi phiên lấy snapshot thứ tự khi Start.</small></div>
                <div className="interaction-account-order-list">
                  {accountBindings.map((binding, index) => {
                    const account = accountById.get(binding.accountId)
                    const runtime = runSnapshot?.accountRuntimes.find((item) => item.accountId === binding.accountId)
                    return (
                      <div className="interaction-account-order-row" key={binding.accountId}>
                        <span className="interaction-account-order-index">{index + 1}</span>
                        <span className="interaction-account-order-name"><strong>{account?.uid ?? `#${binding.accountId}`}</strong><small>{runtime ? `${runtime.state} · ${runtime.success}/${runtime.attempted}` : account?.name || account?.status || 'Account đã bị xóa'}</small></span>
                        <label className="interaction-account-enabled"><input type="checkbox" checked={binding.enabled} onChange={(event) => setAccountEnabled(binding.accountId, event.target.checked)} /><span>Bật</span></label>
                        <span className="interaction-account-order-controls"><button type="button" disabled={index === 0} onClick={() => moveAccount(binding.accountId, -1)}>↑</button><button type="button" disabled={index === accountBindings.length - 1} onClick={() => moveAccount(binding.accountId, 1)}>↓</button></span>
                      </div>
                    )
                  })}
                  {!accountBindings.length ? <div className="interaction-account-empty">Tích account ở danh sách bên trái để binding vào tab này.</div> : null}
                </div>
              </div>
            </div>
          </section>

          <section className="interaction-card">
            <div className="interaction-card-head"><div><span>02</span><h3>Đối tượng tương tác</h3></div><small>{targetOption?.hint}</small></div>
            {draft.actor === 'page' ? (
              <label className="interaction-field interaction-field-wide interaction-page-uid">
                <span>Page UID</span>
                <input value={draft.pageUid} onChange={(event) => { setDraft((current) => ({ ...current, pageUid: event.target.value })); setSaveStatus('idle') }} placeholder="UID Page dùng làm actor" />
                <small>Common Runtime sẽ switch và xác minh Page identity; không bypass checkpoint.</small>
              </label>
            ) : null}
            <div className="interaction-target-grid">
              {INTERACTION_TARGET_OPTIONS.map((option) => (
                <label className={draft.targetMode === option.id ? 'interaction-target-option active' : 'interaction-target-option'} key={option.id}>
                  <input type="radio" name={`${workspace.id}-target`} checked={draft.targetMode === option.id} onChange={() => { setDraft((current) => ({ ...current, targetMode: option.id })); setSaveStatus('idle') }} />
                  <span><strong>{option.label}</strong><small>{option.hint}</small></span>
                </label>
              ))}
            </div>
            {interactionTargetNeedsText(draft.targetMode) ? (
              <label className="interaction-field interaction-field-wide">
                <span>Danh sách target</span>
                <textarea value={draft.targetValues} onChange={(event) => { setDraft((current) => ({ ...current, targetValues: event.target.value })); setSaveStatus('idle') }} rows={4} placeholder="Mỗi dòng hoặc dấu | là một UID / URL / Group..." />
              </label>
            ) : null}
            {draft.targetMode === 'uid_account_file' ? (
              <label className="interaction-field interaction-field-wide">
                <span>Folder / mẫu đường dẫn UID</span>
                <input value={draft.uidFilePath} onChange={(event) => { setDraft((current) => ({ ...current, uidFilePath: event.target.value })); setSaveStatus('idle') }} placeholder={'F:\\data\\uids  hoặc  F:\\data\\{uid}.txt'} />
                <small>Runner snapshot nội dung file lúc Start. Với nhiều account: dùng folder chứa &lt;UID&gt;.txt hoặc token {'{uid}'}.</small>
              </label>
            ) : null}
          </section>

          <section className="interaction-card">
            <div className="interaction-card-head"><div><span>03</span><h3>Hành động</h3></div><small>Tích nhiều mục để compose trong cùng workspace.</small></div>
            <div className="interaction-action-grid">
              {INTERACTION_ACTION_OPTIONS.map((option) => (
                <label className={draft.actions[option.key] ? 'interaction-action-option active' : 'interaction-action-option'} key={option.key}>
                  <input type="checkbox" checked={draft.actions[option.key]} onChange={(event) => setAction(option.key, event.target.checked)} />
                  <strong>{option.label}</strong>
                </label>
              ))}
            </div>
            {draft.actions.reaction ? (
              <div className="interaction-reactions" aria-label="Cảm xúc">
                <span>Cảm xúc</span>
                <div>{REACTIONS.map((reaction) => (
                  <label className={draft.reactions[reaction.key] ? 'active' : ''} key={reaction.key} title={reaction.label}>
                    <input type="checkbox" checked={draft.reactions[reaction.key]} onChange={(event) => setReaction(reaction.key, event.target.checked)} />
                    <span aria-hidden="true">{reaction.emoji}</span><small>{reaction.label}</small>
                  </label>
                ))}</div>
              </div>
            ) : null}
          </section>

          {(draft.actions.comment || draft.actions.replyComment || draft.actions.reactComment || draft.actions.commentTag) ? (
            <section className="interaction-card">
              <div className="interaction-card-head"><div><span>04</span><h3>Cấu hình nội dung</h3></div><small>Chỉ hiện field của hành động đang được tích.</small></div>
              <div className="interaction-form-grid">
                {(draft.actions.replyComment || draft.actions.reactComment) ? (
                  <label className="interaction-field interaction-field-wide"><span>Nội dung comment cần tìm</span><input value={draft.commentMatch} onChange={(event) => { setDraft((current) => ({ ...current, commentMatch: event.target.value })); setSaveStatus('idle') }} placeholder="Để trống = comment phù hợp đầu tiên" /></label>
                ) : null}
                {draft.actions.comment ? (
                  <label className="interaction-field interaction-field-wide"><span>Nội dung comment</span><textarea rows={4} value={draft.commentTemplates} onChange={(event) => { setDraft((current) => ({ ...current, commentTemplates: event.target.value })); setSaveStatus('idle') }} placeholder="Mỗi dòng hoặc dấu | là một nội dung" /></label>
                ) : null}
                {draft.actions.replyComment ? (
                  <label className="interaction-field interaction-field-wide"><span>Nội dung reply</span><textarea rows={4} value={draft.replyTemplates} onChange={(event) => { setDraft((current) => ({ ...current, replyTemplates: event.target.value })); setSaveStatus('idle') }} placeholder="Mỗi dòng hoặc dấu | là một nội dung trả lời" /></label>
                ) : null}
                {draft.actions.commentTag ? (
                  <label className="interaction-field interaction-field-wide"><span>Tên / UID cần tag</span><textarea rows={3} value={draft.tagTargets} onChange={(event) => { setDraft((current) => ({ ...current, tagTargets: event.target.value })); setSaveStatus('idle') }} placeholder="Mỗi dòng hoặc dấu | là một target" /></label>
                ) : null}
              </div>
            </section>
          ) : null}

          <section className="interaction-card">
            <div className="interaction-card-head"><div><span>05</span><h3>Điều phối</h3></div><small>Orchestration giữ account tuần tự; Pause/Resume dùng cooperative control.</small></div>
            <div className="interaction-form-grid compact">
              <label className="interaction-field"><span>Limit target / lượt</span><input type="number" min={1} value={draft.targetLimit} onChange={(event) => { setDraft((current) => ({ ...current, targetLimit: Number(event.target.value) })); setSaveStatus('idle') }} /></label>
              <label className="interaction-field"><span>Số bài / target</span><input type="number" min={1} value={draft.postsPerTarget} onChange={(event) => { setDraft((current) => ({ ...current, postsPerTarget: Number(event.target.value) })); setSaveStatus('idle') }} /></label>
              <label className="interaction-field"><span>Delay từ (giây)</span><input type="number" min={0} value={draft.delayMinSeconds} onChange={(event) => { setDraft((current) => ({ ...current, delayMinSeconds: Number(event.target.value) })); setSaveStatus('idle') }} /></label>
              <label className="interaction-field"><span>Delay đến (giây)</span><input type="number" min={0} value={draft.delayMaxSeconds} onChange={(event) => { setDraft((current) => ({ ...current, delayMaxSeconds: Number(event.target.value) })); setSaveStatus('idle') }} /></label>
              <label className="interaction-toggle"><input type="checkbox" checked={draft.repeat} onChange={(event) => { setDraft((current) => ({ ...current, repeat: event.target.checked })); setSaveStatus('idle') }} /><span><strong>Repeat</strong><small>Lặp workflow cho account hiện tại đến khi Stop.</small></span></label>
            </div>
          </section>
        </div>

        <aside className="interaction-plan-card">
          <div className="interaction-plan-head"><div><p className="interaction-kicker">COMPOSITION</p><h3>Kế hoạch module</h3></div><span>{plan.modules.filter((module) => module.runtimeStatus === 'ready').length}/{plan.modules.length} ready</span></div>
          <p className="interaction-plan-copy">Start dùng config/account đã lưu để tạo snapshot. Mỗi module vẫn chạy qua Action Registry + worker/Common Runtime dùng chung.</p>
          <div className="interaction-module-list">
            {plan.modules.length ? plan.modules.map((module) => (
              <div className="interaction-module-row" key={module.actionType}><span><strong>{module.label}</strong><code>{module.actionType}</code></span><small className={module.runtimeStatus === 'ready' ? 'ready' : ''}>{module.runtimeStatus === 'ready' ? 'Executor ready' : 'Chưa chạy'}</small></div>
            )) : <div className="interaction-plan-empty">Chưa có module nào trong composition.</div>}
          </div>
          {plan.errors.length ? <div className="interaction-plan-messages error"><strong>Cần chỉnh trước khi chạy</strong>{plan.errors.map((message) => <p key={message}>{message}</p>)}</div> : null}
          {plan.warnings.length ? <div className="interaction-plan-messages warning"><strong>Lưu ý kiến trúc</strong>{plan.warnings.map((message) => <p key={message}>{message}</p>)}</div> : null}
          <div className="interaction-binding-summary"><strong>Account binding</strong><span>{accountBindings.length} đã chọn</span><span>{enabledAccountCount} đang bật</span></div>

          <section className="interaction-runtime-card" data-state={runSnapshot?.state ?? 'idle'}>
            <div className="interaction-runtime-head">
              <span><strong>Runtime</strong><small>{runSnapshot?.runId ?? 'Chưa có phiên'}</small></span>
              <b>{runStateLabel(runSnapshot)}</b>
            </div>
            {runSnapshot ? (
              <>
                <div className="interaction-runtime-summary">
                  <span>{runSnapshot.frozen.accountIds.length} account snapshot</span>
                  <span>{runSnapshot.frozen.actionTypes.length} module</span>
                  <span>{runSnapshot.accountRuntimes.reduce((sum, item) => sum + item.success, 0)} success</span>
                </div>
                <div className="interaction-runtime-accounts">
                  {runSnapshot.accountRuntimes.map((item) => (
                    <div key={item.accountId} data-state={item.state}>
                      <span><strong>{item.accountUid}</strong><small>{item.currentActionLabel ?? item.message ?? item.state}</small></span>
                      <b>{item.success}/{item.attempted}</b>
                    </div>
                  ))}
                </div>
                <div className="interaction-runtime-logs">
                  {runSnapshot.logs.slice(-12).map((entry) => (
                    <p key={entry.id} data-level={entry.level}><time>{new Date(entry.at).toLocaleTimeString()}</time><span>{entry.message}</span></p>
                  ))}
                </div>
              </>
            ) : <p className="interaction-runtime-empty">Bấm Start để tạo snapshot và bắt đầu account đầu tiên.</p>}
          </section>

          <div className="interaction-run-controls">
            <button type="button" className="primary" disabled={!canStart} onClick={() => void runCommand('start')}>Start</button>
            <button type="button" disabled={runBusy || runSnapshot?.state !== 'running'} onClick={() => void runCommand('pause')}>Pause</button>
            <button type="button" disabled={runBusy || runSnapshot?.state !== 'paused'} onClick={() => void runCommand('resume')}>Resume</button>
            <button type="button" className="danger" disabled={runBusy || !activeRun || runSnapshot?.state === 'stopping'} onClick={() => void runCommand('stop')}>Stop</button>
          </div>
          {isDirty ? <small className="interaction-run-hint">Lưu cấu hình trước khi Start để snapshot đúng dữ liệu.</small> : null}
          {!allModulesReady && plan.modules.length ? <small className="interaction-run-hint">Module “Chưa chạy” vẫn hiện nhưng Start bị khóa.</small> : null}
        </aside>
      </div>
    </section>
  )
}
