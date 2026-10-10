import { useEffect, useMemo, useState } from 'react'
import type { ProxyCenterAccountBinding, ProxyCenterInventoryRecord } from '../../../shared/proxyBuilder'

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function ProxyAccountBindingPanel() {
  const [inventory, setInventory] = useState<ProxyCenterInventoryRecord[]>([])
  const [accounts, setAccounts] = useState<ProxyCenterAccountBinding[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [proxyId, setProxyId] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const load = async () => {
    const [nextInventory, nextAccounts] = await Promise.all([
      window.pageAutoProxyBuilder.listInventory(),
      window.pageAutoProxyBuilder.listAccountBindings()
    ])
    setInventory(nextInventory)
    setAccounts(nextAccounts)
    setSelected((current) => new Set([...current].filter((id) => nextAccounts.some((item) => item.accountId === id))))
    setProxyId((current) => current && nextInventory.some((item) => item.id === current)
      ? current
      : nextInventory[0]?.id ?? null)
  }

  useEffect(() => {
    void load().catch((error) => setNotice(message(error)))
  }, [])

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return accounts
    return accounts.filter((item) => [
      item.uid,
      item.name ?? '',
      item.category ?? '',
      item.maskedProxy ?? '',
      item.accountStatus
    ].some((value) => value.toLowerCase().includes(needle)))
  }, [accounts, search])

  const duplicateAccounts = accounts.filter((item) => item.duplicateBindingCount > 1).length

  const assign = async () => {
    if (!selected.size || proxyId === null || busy) return
    setBusy(true)
    setNotice(null)
    try {
      const next = await window.pageAutoProxyBuilder.assignInventoryProxy({
        proxyId,
        accountIds: [...selected]
      })
      setAccounts(next)
      setInventory(await window.pageAutoProxyBuilder.listInventory())
      setNotice('Đã gán proxy cho ' + selected.size + ' account.')
    } catch (error) {
      setNotice(message(error))
    } finally {
      setBusy(false)
    }
  }

  const clear = async () => {
    if (!selected.size || busy) return
    setBusy(true)
    setNotice(null)
    try {
      const next = await window.pageAutoProxyBuilder.clearAccountProxy({ accountIds: [...selected] })
      setAccounts(next)
      setInventory(await window.pageAutoProxyBuilder.listInventory())
      setNotice('Đã bỏ proxy khỏi ' + selected.size + ' account.')
    } catch (error) {
      setNotice(message(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="proxy-center-layout" data-testid="proxy-account-binding-panel">
      <div className="proxy-builder-panel proxy-center-binding-toolbar">
        <div>
          <strong>Gán Account</strong>
          <span>{accounts.length} account · {duplicateAccounts} account đang dùng proxy trùng</span>
        </div>
        <div className="proxy-builder-inline-actions proxy-center-binding-actions">
          <input className="proxy-center-search" value={search} onChange={(event) => setSearch(event.currentTarget.value)} placeholder="Tìm UID / tên / nhóm / proxy…" />
          <select value={proxyId ?? ''} disabled={!inventory.length || busy} onChange={(event) => setProxyId(event.currentTarget.value ? Number(event.currentTarget.value) : null)}>
            {!inventory.length ? <option value="">Kho Proxy đang trống</option> : null}
            {inventory.map((item) => <option key={item.id} value={item.id}>{item.maskedProxy} · {item.status.toUpperCase()}</option>)}
          </select>
          <button className="button primary" type="button" disabled={!selected.size || proxyId === null || busy} onClick={() => void assign()}>Gán Proxy</button>
          <button className="button secondary" type="button" disabled={!selected.size || busy} onClick={() => void clear()}>Bỏ Proxy</button>
        </div>
      </div>

      <section className="proxy-builder-panel proxy-builder-results-panel">
        <div className="proxy-builder-result-toolbar">
          <div><strong>Account → Proxy canonical</strong><span>Đang chọn {selected.size} · hiển thị {filtered.length}/{accounts.length}</span></div>
          <span className="proxy-builder-muted">Gán tại đây ghi thẳng vào proxy fields của Account Manager.</span>
        </div>
        <div className="proxy-builder-table-wrap">
          <table className="data-table proxy-builder-table proxy-center-table">
            <thead><tr>
              <th className="proxy-builder-check-column">
                <input
                  type="checkbox"
                  aria-label="Chọn tất cả account để gán proxy"
                  disabled={!filtered.length}
                  checked={Boolean(filtered.length) && filtered.every((item) => selected.has(item.accountId))}
                  onChange={(event) => {
                    setSelected((current) => {
                      const next = new Set(current)
                      for (const item of filtered) {
                        if (event.currentTarget.checked) next.add(item.accountId)
                        else next.delete(item.accountId)
                      }
                      return next
                    })
                  }}
                />
              </th>
              <th>UID</th><th>Tên</th><th>Nhóm</th><th>Status</th><th>Proxy đang gán</th><th>Kho Proxy</th><th>Cảnh báo</th>
            </tr></thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.accountId}>
                  <td className="proxy-builder-check-column"><input type="checkbox" checked={selected.has(item.accountId)} onChange={() => setSelected((current) => {
                    const next = new Set(current)
                    if (next.has(item.accountId)) next.delete(item.accountId)
                    else next.add(item.accountId)
                    return next
                  })} aria-label={'Chọn account ' + item.uid} /></td>
                  <td>{item.uid}</td>
                  <td>{item.name ?? '-'}</td>
                  <td>{item.category ?? '-'}</td>
                  <td>{item.accountStatus}</td>
                  <td>{item.maskedProxy ?? '-'}</td>
                  <td>{item.inventoryId ? '#' + item.inventoryId : item.maskedProxy ? 'Ngoài kho' : '-'}</td>
                  <td>{item.duplicateBindingCount > 1 ? <span className="proxy-center-warning-badge">Trùng ×{item.duplicateBindingCount}</span> : '-'}</td>
                </tr>
              ))}
              {!filtered.length ? <tr><td colSpan={8} className="proxy-builder-empty">Không có account phù hợp.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
      {notice ? <div className="proxy-builder-notice">{notice}</div> : null}
    </section>
  )
}
