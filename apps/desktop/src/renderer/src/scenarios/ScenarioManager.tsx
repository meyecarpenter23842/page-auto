import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  SCENARIO_ACTION_CATEGORIES,
  scenarioCategoryLabels,
  type ScenarioActionCategory,
  type ScenarioActionRecord,
  type ScenarioDetails,
  type ScenarioSummary
} from '../../../shared/scenarios'
import './scenarioManager.css'

type ActionDraft = {
  id: number | null
  label: string
  actionType: string
  category: ScenarioActionCategory
  enabled: boolean
}

const emptyActionDraft: ActionDraft = {
  id: null,
  label: '',
  actionType: '',
  category: 'other',
  enabled: true
}

function formatTime(value: number): string {
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(value)
}

export function ScenarioManager() {
  const [items, setItems] = useState<ScenarioSummary[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [details, setDetails] = useState<ScenarioDetails | null>(null)
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scenarioDialog, setScenarioDialog] = useState<{ id: number | null; name: string } | null>(null)
  const [actionDialog, setActionDialog] = useState<ActionDraft | null>(null)
  const [randomOrder, setRandomOrder] = useState(false)
  const [runtimeLimit, setRuntimeLimit] = useState('')

  const loadList = useCallback(async (preferredId?: number | null) => {
    const next = await window.pageAuto.listScenarios()
    setItems(next)
    const targetId = preferredId ?? selectedId ?? next[0]?.id ?? null
    setSelectedId(targetId)
    if (targetId === null) {
      setDetails(null)
      return
    }
    const selected = await window.pageAuto.getScenario({ id: targetId })
    setDetails(selected)
  }, [selectedId])

  const selectScenario = useCallback(async (id: number) => {
    setSelectedId(id)
    setError(null)
    try {
      setDetails(await window.pageAuto.getScenario({ id }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  useEffect(() => {
    void loadList().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
  }, [])

  useEffect(() => {
    setRandomOrder(details?.randomActionOrder ?? false)
    setRuntimeLimit(details?.runtimeLimitMinutes ? String(details.runtimeLimitMinutes) : '')
  }, [details?.id, details?.randomActionOrder, details?.runtimeLimitMinutes])

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('vi')
    return query ? items.filter((item) => item.name.toLocaleLowerCase('vi').includes(query)) : items
  }, [items, search])

  const mutate = useCallback(async (operation: () => Promise<ScenarioDetails | boolean>, preferredId?: number | null) => {
    setBusy(true)
    setError(null)
    try {
      const result = await operation()
      const targetId = typeof result === 'boolean' ? preferredId ?? null : result.id
      await loadList(targetId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [loadList])

  const saveScenarioDialog = async () => {
    if (!scenarioDialog) return
    const name = scenarioDialog.name.trim()
    if (!name) return setError('Tên kịch bản không được để trống.')
    const editingId = scenarioDialog.id
    setScenarioDialog(null)
    await mutate(
      () => editingId === null
        ? window.pageAuto.createScenario({ name })
        : window.pageAuto.updateScenario({ id: editingId, patch: { name } }),
      editingId
    )
  }

  const deleteScenario = async () => {
    if (!details || !window.confirm(`Xóa kịch bản “${details.name}” và toàn bộ action bên trong?`)) return
    const remaining = items.filter((item) => item.id !== details.id)
    await mutate(() => window.pageAuto.deleteScenario({ id: details.id }), remaining[0]?.id ?? null)
  }

  const saveScenarioSettings = async () => {
    if (!details) return
    const parsedLimit = runtimeLimit.trim() ? Number(runtimeLimit) : null
    await mutate(() => window.pageAuto.updateScenario({
      id: details.id,
      patch: {
        randomActionOrder: randomOrder,
        runtimeLimitMinutes: parsedLimit
      }
    }), details.id)
  }

  const openEditAction = (action: ScenarioActionRecord) => {
    setActionDialog({
      id: action.id,
      label: action.label,
      actionType: action.actionType,
      category: action.category,
      enabled: action.enabled
    })
  }

  const saveActionDialog = async () => {
    if (!details || !actionDialog) return
    const draft = actionDialog
    if (!draft.label.trim() || !draft.actionType.trim()) return setError('Tên hành động và mã action không được để trống.')
    setActionDialog(null)
    await mutate(() => draft.id === null
      ? window.pageAuto.createScenarioAction({
          scenarioId: details.id,
          label: draft.label,
          actionType: draft.actionType,
          category: draft.category,
          enabled: draft.enabled,
          configJson: '{}'
        })
      : window.pageAuto.updateScenarioAction({
          id: draft.id,
          patch: {
            label: draft.label,
            actionType: draft.actionType,
            category: draft.category,
            enabled: draft.enabled
          }
        }), details.id)
  }

  const deleteAction = async (action: ScenarioActionRecord) => {
    if (!details || !window.confirm(`Xóa hành động “${action.label}”?`)) return
    await mutate(() => window.pageAuto.deleteScenarioAction({ id: action.id }), details.id)
  }

  const moveAction = async (action: ScenarioActionRecord, direction: 'up' | 'down') => {
    if (!details) return
    await mutate(() => window.pageAuto.moveScenarioAction({ scenarioId: details.id, actionId: action.id, direction }), details.id)
  }

  return (
    <section className="scenario-page" aria-label="Quản lý Kịch Bản">
      {error ? <div className="scenario-error">{error}<button type="button" onClick={() => setError(null)}>×</button></div> : null}

      <div className="scenario-layout">
        <section className="scenario-panel scenario-list-panel">
          <div className="scenario-panel-heading">
            <div><p className="scenario-kicker">THƯ VIỆN</p><h2>Danh sách kịch bản</h2></div>
            <span className="scenario-count">{items.length}</span>
          </div>
          <div className="scenario-toolbar scenario-list-toolbar">
            <label className="scenario-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm kịch bản..." /></label>
            <button className="scenario-button primary" type="button" disabled={busy} onClick={() => setScenarioDialog({ id: null, name: '' })}>+ Thêm</button>
          </div>
          <div className="scenario-list" role="listbox" aria-label="Danh sách kịch bản">
            {filtered.map((item, index) => (
              <button
                className={item.id === selectedId ? 'scenario-list-row active' : 'scenario-list-row'}
                key={item.id}
                type="button"
                onClick={() => void selectScenario(item.id)}
              >
                <span className="scenario-index">{String(index + 1).padStart(2, '0')}</span>
                <span className="scenario-list-copy"><strong>{item.name}</strong><small>{item.actionCount} hành động</small></span>
              </button>
            ))}
            {!filtered.length ? <div className="scenario-empty">Chưa có kịch bản phù hợp.</div> : null}
          </div>
          {details ? (
            <div className="scenario-list-actions">
              <button className="scenario-button" type="button" disabled={busy} onClick={() => setScenarioDialog({ id: details.id, name: details.name })}>Sửa tên</button>
              <button className="scenario-button danger" type="button" disabled={busy} onClick={() => void deleteScenario()}>Xóa</button>
            </div>
          ) : null}
        </section>

        <section className="scenario-panel scenario-actions-panel">
          <div className="scenario-panel-heading">
            <div><p className="scenario-kicker">KỊCH BẢN ĐANG CHỌN</p><h2>{details?.name ?? 'Chưa chọn kịch bản'}</h2></div>
            {details ? <span className="scenario-status-chip">Chưa gắn runtime</span> : null}
          </div>

          <div className="scenario-toolbar">
            <button className="scenario-button primary" type="button" disabled={!details || busy} onClick={() => setActionDialog({ ...emptyActionDraft })}>+ Thêm hành động</button>
            <span className="scenario-toolbar-note">K1 lưu action dạng khung; executor sẽ làm ở K2/K3.</span>
          </div>

          <div className="scenario-table-wrap">
            <table className="scenario-table">
              <thead><tr><th>STT</th><th>Hành động</th><th>Nhóm</th><th>Trạng thái</th><th aria-label="Thao tác" /></tr></thead>
              <tbody>
                {details?.actions.map((action, index) => (
                  <tr key={action.id}>
                    <td className="scenario-order">{index + 1}</td>
                    <td><button className="scenario-action-name" type="button" onClick={() => openEditAction(action)}><strong>{action.label}</strong><small>{action.actionType}</small></button></td>
                    <td><span className={`scenario-category category-${action.category}`}>{scenarioCategoryLabels[action.category]}</span></td>
                    <td><span className={action.enabled ? 'scenario-enabled' : 'scenario-disabled'}><i />{action.enabled ? 'Bật' : 'Tắt'}</span></td>
                    <td className="scenario-row-actions">
                      <button type="button" title="Lên" disabled={busy || index === 0} onClick={() => void moveAction(action, 'up')}>↑</button>
                      <button type="button" title="Xuống" disabled={busy || index === details.actions.length - 1} onClick={() => void moveAction(action, 'down')}>↓</button>
                      <button type="button" title="Sửa" disabled={busy} onClick={() => openEditAction(action)}>✎</button>
                      <button className="row-danger" type="button" title="Xóa" disabled={busy} onClick={() => void deleteAction(action)}>×</button>
                    </td>
                  </tr>
                ))}
                {details && details.actions.length === 0 ? <tr><td colSpan={5}><div className="scenario-empty table-empty">Kịch bản chưa có hành động.</div></td></tr> : null}
              </tbody>
            </table>
          </div>

          {details ? (
            <div className="scenario-settings-strip">
              <label className="scenario-check"><input type="checkbox" checked={randomOrder} onChange={(event) => setRandomOrder(event.target.checked)} /><span>Random thứ tự hành động</span></label>
              <label className="scenario-limit"><span>Giới hạn chạy</span><input type="number" min={1} max={1440} value={runtimeLimit} onChange={(event) => setRuntimeLimit(event.target.value)} placeholder="Không giới hạn" /><small>phút</small></label>
              <button className="scenario-button" type="button" disabled={busy} onClick={() => void saveScenarioSettings()}>Lưu thiết lập</button>
            </div>
          ) : null}
        </section>

        <aside className="scenario-panel scenario-inspector">
          <div className="scenario-panel-heading"><div><p className="scenario-kicker">THÔNG TIN</p><h2>Kịch bản</h2></div></div>
          {details ? (
            <div className="scenario-inspector-body">
              <div className="scenario-inspector-name"><strong>{details.name}</strong><span>ID #{details.id}</span></div>
              <dl>
                <div><dt>Số hành động</dt><dd>{details.actionCount}</dd></div>
                <div><dt>Thứ tự</dt><dd>{details.randomActionOrder ? 'Random' : 'Tuần tự'}</dd></div>
                <div><dt>Giới hạn</dt><dd>{details.runtimeLimitMinutes ? `${details.runtimeLimitMinutes} phút` : 'Không'}</dd></div>
                <div><dt>Cập nhật</dt><dd>{formatTime(details.updatedAt)}</dd></div>
              </dl>
              <div className="scenario-info-card"><strong>Module dùng chung</strong><p>K1 chỉ quản lý kịch bản và action khung. Chưa gắn vào Page hoặc Tài khoản.</p></div>
              <div className="scenario-safe-note"><span>✓</span><p>Config kịch bản không nhận password, cookie, 2FA hay token.</p></div>
            </div>
          ) : <div className="scenario-empty inspector-empty">Chọn hoặc tạo một kịch bản để bắt đầu.</div>}
        </aside>
      </div>

      {scenarioDialog ? (
        <div className="scenario-modal-backdrop" role="presentation" onMouseDown={() => setScenarioDialog(null)}>
          <form className="scenario-modal compact-modal" onSubmit={(event) => { event.preventDefault(); void saveScenarioDialog() }} onMouseDown={(event) => event.stopPropagation()}>
            <div className="scenario-modal-head"><div><p className="scenario-kicker">KỊCH BẢN</p><h3>{scenarioDialog.id === null ? 'Tạo kịch bản' : 'Đổi tên kịch bản'}</h3></div><button type="button" onClick={() => setScenarioDialog(null)}>×</button></div>
            <label className="scenario-field"><span>Tên kịch bản</span><input autoFocus value={scenarioDialog.name} maxLength={120} onChange={(event) => setScenarioDialog({ ...scenarioDialog, name: event.target.value })} placeholder="Ví dụ: Nuôi tài khoản" /></label>
            <div className="scenario-modal-actions"><button className="scenario-button" type="button" onClick={() => setScenarioDialog(null)}>Hủy</button><button className="scenario-button primary" type="submit">Lưu</button></div>
          </form>
        </div>
      ) : null}

      {actionDialog ? (
        <div className="scenario-modal-backdrop" role="presentation" onMouseDown={() => setActionDialog(null)}>
          <form className="scenario-modal action-modal" onSubmit={(event) => { event.preventDefault(); void saveActionDialog() }} onMouseDown={(event) => event.stopPropagation()}>
            <div className="scenario-modal-head"><div><p className="scenario-kicker">ACTION KHUNG · K1</p><h3>{actionDialog.id === null ? 'Thêm hành động' : 'Sửa hành động'}</h3></div><button type="button" onClick={() => setActionDialog(null)}>×</button></div>
            <div className="scenario-form-grid">
              <label className="scenario-field wide"><span>Tên hiển thị</span><input autoFocus value={actionDialog.label} maxLength={120} onChange={(event) => setActionDialog({ ...actionDialog, label: event.target.value })} placeholder="Ví dụ: View newsfeed" /></label>
              <label className="scenario-field"><span>Mã action</span><input value={actionDialog.actionType} maxLength={80} onChange={(event) => setActionDialog({ ...actionDialog, actionType: event.target.value })} placeholder="view_newsfeed" /></label>
              <label className="scenario-field"><span>Nhóm</span><select value={actionDialog.category} onChange={(event) => setActionDialog({ ...actionDialog, category: event.target.value as ScenarioActionCategory })}>{SCENARIO_ACTION_CATEGORIES.map((category) => <option key={category} value={category}>{scenarioCategoryLabels[category]}</option>)}</select></label>
            </div>
            <label className="scenario-check modal-check"><input type="checkbox" checked={actionDialog.enabled} onChange={(event) => setActionDialog({ ...actionDialog, enabled: event.target.checked })} /><span>Bật action trong kịch bản</span></label>
            <div className="scenario-placeholder-note">K1 chỉ lưu metadata + thứ tự. Cấu hình nghiệp vụ và executor riêng của từng action sẽ được nối ở K2/K3.</div>
            <div className="scenario-modal-actions"><button className="scenario-button" type="button" onClick={() => setActionDialog(null)}>Hủy</button><button className="scenario-button primary" type="submit">{actionDialog.id === null ? 'Thêm hành động' : 'Lưu thay đổi'}</button></div>
          </form>
        </div>
      ) : null}
    </section>
  )
}
