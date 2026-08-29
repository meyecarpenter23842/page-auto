import { useState, type FormEvent } from 'react'
import type { AccountGroupOverview, AccountGroupRecord } from '../../../shared/accountGroups'

interface AccountGroupPickerProps {
  overview: AccountGroupOverview
  selectedCount: number
  currentGroupName: string | null
  onClose: () => void
  onAssigned: (groupId: number | null, groupName: string | null) => Promise<void>
}

export function AccountGroupPicker({ overview, selectedCount, currentGroupName, onClose, onAssigned }: AccountGroupPickerProps) {
  const [savingId, setSavingId] = useState<number | 'none' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const assign = async (group: AccountGroupRecord | null) => {
    setSavingId(group?.id ?? 'none')
    setError(null)
    try {
      await onAssigned(group?.id ?? null, group?.name ?? null)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="modal" style={{ width: 'min(560px, calc(100vw - 28px))' }} onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">Nhóm tài khoản</p>
            <h2>Gán nhóm cho {selectedCount} tài khoản</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose}>×</button>
        </div>

        <div style={{ marginBottom: 8, color: '#667085', fontSize: 11 }}>
          Nhóm hiện tại: <strong>{currentGroupName ?? 'Chưa gán / nhiều nhóm khác nhau'}</strong>
        </div>

        <div style={{ display: 'grid', gap: 5, maxHeight: 380, overflow: 'auto', padding: '1px 1px 6px' }}>
          <button className="button secondary" type="button" disabled={savingId !== null} onClick={() => void assign(null)} style={{ justifyContent: 'space-between', display: 'flex' }}>
            <span>Bỏ nhóm</span><span>{savingId === 'none' ? 'Đang lưu…' : `${overview.ungroupedCount} tài khoản`}</span>
          </button>
          {overview.groups.map((group) => (
            <button
              className="button secondary"
              key={group.id}
              type="button"
              disabled={savingId !== null}
              onClick={() => void assign(group)}
              style={{ justifyContent: 'space-between', display: 'flex' }}
            >
              <span>{group.name}</span>
              <span>{savingId === group.id ? 'Đang lưu…' : `${group.accountCount} tài khoản`}</span>
            </button>
          ))}
          {overview.groups.length === 0 ? <div style={{ padding: 10, color: '#667085', fontSize: 11 }}>Chưa có nhóm. Hãy tạo nhóm trong “Quản lý nhóm”.</div> : null}
        </div>

        {error ? <div className="inline-error">{error}</div> : null}
        <div className="modal-actions">
          <button className="button secondary" type="button" onClick={onClose}>Đóng</button>
        </div>
      </div>
    </div>
  )
}

interface AccountGroupManagerDialogProps {
  overview: AccountGroupOverview
  onClose: () => void
  onChanged: () => Promise<void>
}

export function AccountGroupManagerDialog({ overview, onClose, onChanged }: AccountGroupManagerDialogProps) {
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingName, setEditingName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const createGroup = async (event: FormEvent) => {
    event.preventDefault()
    if (!newName.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await window.pageAuto.createAccountGroup({ name: newName })
      setNewName('')
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const saveRename = async (group: AccountGroupRecord) => {
    if (!editingName.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await window.pageAuto.renameAccountGroup({ id: group.id, name: editingName })
      setEditingId(null)
      setEditingName('')
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const deleteGroup = async (group: AccountGroupRecord) => {
    const message = group.accountCount > 0
      ? `Xóa nhóm “${group.name}”? ${group.accountCount} tài khoản trong nhóm sẽ chuyển thành chưa gán nhóm.`
      : `Xóa nhóm “${group.name}”?`
    if (!window.confirm(message)) return

    setBusy(true)
    setError(null)
    try {
      await window.pageAuto.deleteAccountGroup({ id: group.id })
      if (editingId === group.id) setEditingId(null)
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="modal" style={{ width: 'min(680px, calc(100vw - 28px))' }} onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">Account Group Manager</p>
            <h2>Quản lý nhóm tài khoản</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose}>×</button>
        </div>

        <div style={{ marginBottom: 10, color: '#667085', fontSize: 11 }}>
          {overview.groups.length} nhóm · {overview.totalAccounts} tài khoản · {overview.ungroupedCount} chưa gán nhóm
        </div>

        <form onSubmit={createGroup} style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="Tên nhóm mới"
            maxLength={120}
            style={{ flex: 1, minWidth: 0, padding: '6px 7px', border: '1px solid #c7d0db', borderRadius: 3 }}
          />
          <button className="button primary" type="submit" disabled={busy || !newName.trim()}>+ Tạo nhóm</button>
        </form>

        <div style={{ border: '1px solid #e2e7ee', borderRadius: 4, maxHeight: 420, overflow: 'auto' }}>
          {overview.groups.map((group) => (
            <div key={group.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 110px 150px', gap: 6, alignItems: 'center', minHeight: 38, padding: '5px 7px', borderBottom: '1px solid #edf0f5' }}>
              {editingId === group.id ? (
                <input
                  autoFocus
                  value={editingName}
                  onChange={(event) => setEditingName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') { event.preventDefault(); void saveRename(group) }
                    if (event.key === 'Escape') { setEditingId(null); setEditingName('') }
                  }}
                  maxLength={120}
                  style={{ width: '100%', minWidth: 0, padding: '5px 6px', border: '1px solid #6f9ee8', borderRadius: 3 }}
                />
              ) : <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{group.name}</strong>}
              <span style={{ color: '#667085', fontSize: 10.5 }}>{group.accountCount} tài khoản</span>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4 }}>
                {editingId === group.id ? (
                  <>
                    <button className="button primary compact" type="button" disabled={busy || !editingName.trim()} onClick={() => void saveRename(group)}>Lưu</button>
                    <button className="button secondary compact" type="button" disabled={busy} onClick={() => { setEditingId(null); setEditingName('') }}>Hủy</button>
                  </>
                ) : (
                  <>
                    <button className="button secondary compact" type="button" disabled={busy} onClick={() => { setEditingId(group.id); setEditingName(group.name) }}>Đổi tên</button>
                    <button className="button danger compact" type="button" disabled={busy} onClick={() => void deleteGroup(group)}>Xóa</button>
                  </>
                )}
              </div>
            </div>
          ))}
          {overview.groups.length === 0 ? <div style={{ padding: 12, color: '#667085', fontSize: 11 }}>Chưa có nhóm tài khoản.</div> : null}
        </div>

        {error ? <div className="inline-error">{error}</div> : null}
        <div className="modal-actions">
          <button className="button secondary" type="button" onClick={onClose}>Đóng</button>
        </div>
      </div>
    </div>
  )
}
