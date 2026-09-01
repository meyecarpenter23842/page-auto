import { useMemo, useState } from 'react'
import type { AccountRecord } from '../../../shared/accounts'
import './accountBindingPickerModal.css'

interface AccountBindingPickerModalProps {
  accounts: AccountRecord[]
  selectedIds: ReadonlySet<number>
  onApply: (accountIds: number[]) => void
  onClose: () => void
}

export function AccountBindingPickerModal({ accounts, selectedIds, onApply, onClose }: AccountBindingPickerModalProps) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<number>>(() => new Set(selectedIds))
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('vi')
    if (!normalized) return accounts
    return accounts.filter((account) => [account.uid, account.name, account.status, account.category]
      .some((value) => value?.toLocaleLowerCase('vi').includes(normalized)))
  }, [accounts, query])

  const toggle = (accountId: number, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(accountId)
      else next.delete(accountId)
      return next
    })
  }

  return (
    <div className="account-binding-modal-backdrop" role="presentation">
      <section className="account-binding-modal" role="dialog" aria-modal="true" aria-label="Thêm tài khoản từ Account Manager">
        <header>
          <div><small>ACCOUNT MANAGER</small><h3>Thêm tài khoản</h3><p>Chọn account đã có trong trang Tài khoản để binding vào workflow này.</p></div>
          <button type="button" aria-label="Đóng" onClick={onClose}>×</button>
        </header>
        <div className="account-binding-modal-search">
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm UID, tên, trạng thái, nhóm…" />
          <span>{filtered.length}/{accounts.length}</span>
        </div>
        <div className="account-binding-modal-list" role="list">
          {filtered.map((account) => (
            <label className={selected.has(account.id) ? 'selected' : ''} key={account.id}>
              <input type="checkbox" checked={selected.has(account.id)} onChange={(event) => toggle(account.id, event.target.checked)} />
              <span><strong>{account.uid}</strong><small>{account.name || 'Chưa có tên'}</small></span>
              <span className="meta"><b>{account.status}</b><small>{account.category || 'Không nhóm'}</small></span>
            </label>
          ))}
          {!filtered.length ? <div className="account-binding-modal-empty">Không có account phù hợp.</div> : null}
        </div>
        <footer>
          <span>{selected.size} account được chọn</span>
          <button type="button" onClick={onClose}>Hủy</button>
          <button type="button" className="primary" onClick={() => onApply(accounts.filter((account) => selected.has(account.id)).map((account) => account.id))}>Áp dụng</button>
        </footer>
      </section>
    </div>
  )
}
