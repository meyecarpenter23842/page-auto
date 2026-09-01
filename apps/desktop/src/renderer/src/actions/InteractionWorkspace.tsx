import { useMemo, useState } from 'react'
import {
  buildInteractionWorkspacePlan,
  DEFAULT_INTERACTION_WORKSPACE_DRAFT,
  INTERACTION_ACTION_OPTIONS,
  INTERACTION_TARGET_OPTIONS,
  interactionTargetNeedsText,
  type InteractionActionKey,
  type InteractionReactionKey,
  type InteractionWorkspaceDraft
} from './interactionWorkspaceModel'
import './interactionWorkspace.css'

interface InteractionWorkspaceProps {
  instanceLabel: string
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

export function InteractionWorkspace({ instanceLabel }: InteractionWorkspaceProps) {
  const [draft, setDraft] = useState<InteractionWorkspaceDraft>(() => ({
    ...DEFAULT_INTERACTION_WORKSPACE_DRAFT,
    actions: { ...DEFAULT_INTERACTION_WORKSPACE_DRAFT.actions },
    reactions: { ...DEFAULT_INTERACTION_WORKSPACE_DRAFT.reactions }
  }))
  const plan = useMemo(() => buildInteractionWorkspacePlan(draft), [draft])
  const targetOption = INTERACTION_TARGET_OPTIONS.find((option) => option.id === draft.targetMode)

  const setAction = (key: InteractionActionKey, checked: boolean) => {
    setDraft((current) => ({ ...current, actions: { ...current.actions, [key]: checked } }))
  }

  const setReaction = (key: InteractionReactionKey, checked: boolean) => {
    setDraft((current) => ({ ...current, reactions: { ...current.reactions, [key]: checked } }))
  }

  return (
    <section className="interaction-workspace" aria-label={instanceLabel}>
      <div className="interaction-workspace-head">
        <div>
          <p className="interaction-kicker">WORKSPACE NGHIỆP VỤ</p>
          <h2>{instanceLabel}</h2>
          <p>Chọn nguồn target và tích các hành động cần compose. Tab này hiện lưu config trong memory; chưa nối DB/runner.</p>
        </div>
        <div className="interaction-actor-switch" aria-label="Actor chạy">
          <span>Actor</span>
          <button type="button" className={draft.actor === 'profile' ? 'active' : ''} onClick={() => setDraft((current) => ({ ...current, actor: 'profile' }))}>Profile</button>
          <button type="button" className={draft.actor === 'page' ? 'active' : ''} onClick={() => setDraft((current) => ({ ...current, actor: 'page' }))}>Page</button>
        </div>
      </div>

      <div className="interaction-layout">
        <div className="interaction-main-column">
          <section className="interaction-card">
            <div className="interaction-card-head"><div><span>01</span><h3>Đối tượng tương tác</h3></div><small>{targetOption?.hint}</small></div>
            <div className="interaction-target-grid">
              {INTERACTION_TARGET_OPTIONS.map((option) => (
                <label className={draft.targetMode === option.id ? 'interaction-target-option active' : 'interaction-target-option'} key={option.id}>
                  <input type="radio" name={`${instanceLabel}-target`} checked={draft.targetMode === option.id} onChange={() => setDraft((current) => ({ ...current, targetMode: option.id }))} />
                  <span><strong>{option.label}</strong><small>{option.hint}</small></span>
                </label>
              ))}
            </div>
            {interactionTargetNeedsText(draft.targetMode) ? (
              <label className="interaction-field interaction-field-wide">
                <span>Danh sách target</span>
                <textarea value={draft.targetValues} onChange={(event) => setDraft((current) => ({ ...current, targetValues: event.target.value }))} rows={4} placeholder="Mỗi dòng hoặc dấu | là một UID / URL / Group..." />
              </label>
            ) : null}
            {draft.targetMode === 'uid_account_file' ? (
              <label className="interaction-field interaction-field-wide">
                <span>Đường dẫn file UID</span>
                <input value={draft.uidFilePath} onChange={(event) => setDraft((current) => ({ ...current, uidFilePath: event.target.value }))} placeholder="F:\\data\\uids\\acc-01.txt" />
                <small>File picker và mapping file → account sẽ nối ở lô persistence/runner.</small>
              </label>
            ) : null}
          </section>

          <section className="interaction-card">
            <div className="interaction-card-head"><div><span>02</span><h3>Hành động</h3></div><small>Tích nhiều mục để compose trong cùng workspace.</small></div>
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
              <div className="interaction-card-head"><div><span>03</span><h3>Cấu hình nội dung</h3></div><small>Chỉ hiện field của hành động đang được tích.</small></div>
              <div className="interaction-form-grid">
                {(draft.actions.replyComment || draft.actions.reactComment) ? (
                  <label className="interaction-field interaction-field-wide"><span>Nội dung comment cần tìm</span><input value={draft.commentMatch} onChange={(event) => setDraft((current) => ({ ...current, commentMatch: event.target.value }))} placeholder="Để trống = comment phù hợp đầu tiên" /></label>
                ) : null}
                {draft.actions.comment ? (
                  <label className="interaction-field interaction-field-wide"><span>Nội dung comment</span><textarea rows={4} value={draft.commentTemplates} onChange={(event) => setDraft((current) => ({ ...current, commentTemplates: event.target.value }))} placeholder="Mỗi dòng hoặc dấu | là một nội dung" /></label>
                ) : null}
                {draft.actions.replyComment ? (
                  <label className="interaction-field interaction-field-wide"><span>Nội dung reply</span><textarea rows={4} value={draft.replyTemplates} onChange={(event) => setDraft((current) => ({ ...current, replyTemplates: event.target.value }))} placeholder="Mỗi dòng hoặc dấu | là một nội dung trả lời" /></label>
                ) : null}
                {draft.actions.commentTag ? (
                  <label className="interaction-field interaction-field-wide"><span>Tên / UID cần tag</span><textarea rows={3} value={draft.tagTargets} onChange={(event) => setDraft((current) => ({ ...current, tagTargets: event.target.value }))} placeholder="Mỗi dòng hoặc dấu | là một target" /></label>
                ) : null}
              </div>
            </section>
          ) : null}

          <section className="interaction-card">
            <div className="interaction-card-head"><div><span>04</span><h3>Điều phối</h3></div><small>Đây là orchestration, không tạo thêm action Facebook giả.</small></div>
            <div className="interaction-form-grid compact">
              <label className="interaction-field"><span>Limit target / lượt</span><input type="number" min={1} value={draft.targetLimit} onChange={(event) => setDraft((current) => ({ ...current, targetLimit: Number(event.target.value) }))} /></label>
              <label className="interaction-field"><span>Số bài / target</span><input type="number" min={1} value={draft.postsPerTarget} onChange={(event) => setDraft((current) => ({ ...current, postsPerTarget: Number(event.target.value) }))} /></label>
              <label className="interaction-field"><span>Delay từ (giây)</span><input type="number" min={0} value={draft.delayMinSeconds} onChange={(event) => setDraft((current) => ({ ...current, delayMinSeconds: Number(event.target.value) }))} /></label>
              <label className="interaction-field"><span>Delay đến (giây)</span><input type="number" min={0} value={draft.delayMaxSeconds} onChange={(event) => setDraft((current) => ({ ...current, delayMaxSeconds: Number(event.target.value) }))} /></label>
              <label className="interaction-toggle"><input type="checkbox" checked={draft.repeat} onChange={(event) => setDraft((current) => ({ ...current, repeat: event.target.checked }))} /><span><strong>Repeat</strong><small>Lặp lại workflow sau khi hết lượt.</small></span></label>
            </div>
          </section>
        </div>

        <aside className="interaction-plan-card">
          <div className="interaction-plan-head"><div><p className="interaction-kicker">COMPOSITION</p><h3>Kế hoạch module</h3></div><span>{plan.modules.filter((module) => module.runtimeStatus === 'ready').length}/{plan.modules.length} ready</span></div>
          <p className="interaction-plan-copy">UI này không tạo executor mới. Nó compose các module nhỏ trong Action Registry theo target + checkbox đã chọn.</p>
          <div className="interaction-module-list">
            {plan.modules.length ? plan.modules.map((module) => (
              <div className="interaction-module-row" key={module.actionType}><span><strong>{module.label}</strong><code>{module.actionType}</code></span><small className={module.runtimeStatus === 'ready' ? 'ready' : ''}>{module.runtimeStatus === 'ready' ? 'Executor ready' : 'Chưa chạy'}</small></div>
            )) : <div className="interaction-plan-empty">Chưa có module nào trong composition.</div>}
          </div>
          {plan.errors.length ? <div className="interaction-plan-messages error"><strong>Cần chỉnh</strong>{plan.errors.map((message) => <p key={message}>{message}</p>)}</div> : null}
          {plan.warnings.length ? <div className="interaction-plan-messages warning"><strong>Lưu ý kiến trúc</strong>{plan.warnings.map((message) => <p key={message}>{message}</p>)}</div> : null}
          <div className="interaction-run-boundary"><button type="button" disabled>Runner chưa nối</button><small>Account binding + persistence DB + start/pause/resume sẽ làm ở lô tiếp theo sau khi chốt UX/model tab.</small></div>
        </aside>
      </div>
    </section>
  )
}
