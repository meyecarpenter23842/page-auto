import { useEffect, useMemo, useState } from 'react'
import type { ProxyCenterInventoryRecord, ProxyCenterInventoryStatus } from '../../../shared/proxyBuilder'

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function statusLabel(status: ProxyCenterInventoryStatus): string {
  if (status === 'live') return 'LIVE'
  if (status === 'dead') return 'DEAD'
  return 'CHƯA TEST'
}

function formatCheckedAt(value: number | null): string {
  return value ? new Date(value).toLocaleString('vi-VN') : '-'
}

export function ProxyInventoryPanel() {
  const [rows, setRows] = useState<ProxyCenterInventoryRecord[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'all' | ProxyCenterInventoryStatus>('all')
  const [importText, setImportText] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const load = async () => {
    const next = await window.pageAutoProxyBuilder.listInventory()
    setRows(next)
    setSelected((current) => new Set([...current].filter((id) => next.some((item) => item.id === id))))
  }

  useEffect(() => {
    void load().catch((error) => setNotice(message(error)))
  }, [])

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return rows.filter((item) => {
      if (status !== 'all' && item.status !== status) return false
      if (!needle) return true
      return [
        item.maskedProxy,
        item.outboundIp ?? '',
        item.sourceLabel ?? '',
        item.sourceKind,
        item.ipFamily
      ].some((value) => value.toLowerCase().includes(needle))
    })
  }, [rows, search, status])

  const importLines = importText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const liveCount = rows.filter((item) => item.status === 'live').length
  const deadCount = rows.filter((item) => item.status === 'dead').length
  const unknownCount = rows.length - liveCount - deadCount

  const importInventory = async () => {
    if (!importLines.length || busy) return
    setBusy(true)
    setNotice(null)
    try {
      const result = await window.pageAutoProxyBuilder.upsertInventory({
        items: importLines.map((rawProxy) => ({ rawProxy, sourceKind: 'import' }))
      })
      setRows(result.records)
      setImportText('')
      setNotice(
        'Kho Proxy: thêm ' + result.inserted + ', cập nhật ' + result.updated
        + (result.errors.length ? ', lỗi ' + result.errors.length + ' · ' + result.errors[0] : '.')
      )
    } catch (error) {
      setNotice(message(error))
    } finally {
      setBusy(false)
    }
  }

  const testInventory = async (ids: number[]) => {
    if (!ids.length || busy) return
    setBusy(true)
    setNotice(null)
    try {
      const next = await window.pageAutoProxyBuilder.checkInventory({ ids })
      setRows(next)
      const live = next.filter((item) => ids.includes(item.id) && item.status === 'live').length
      const dead = next.filter((item) => ids.includes(item.id) && item.status === 'dead').length
      setNotice('Đã test ' + ids.length + ' proxy: ' + live + ' LIVE · ' + dead + ' DEAD.')
    } catch (error) {
      setNotice(message(error))
    } finally {
      setBusy(false)
    }
  }

  const deleteSelected = async () => {
    if (!selected.size || busy) return
    if (!window.confirm('Xóa ' + selected.size + ' proxy khỏi kho? Account đang gán sẽ không bị sửa.')) return
    setBusy(true)
    setNotice(null)
    try {
      const count = await window.pageAutoProxyBuilder.deleteInventory({ ids: [...selected] })
      setSelected(new Set())
      await load()
      setNotice('Đã xóa ' + count + ' proxy khỏi kho.')
    } catch (error) {
      setNotice(message(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="proxy-center-layout" data-testid="proxy-inventory-panel">
      <div className="proxy-builder-panel proxy-center-import-panel">
        <div className="proxy-builder-result-toolbar">
          <div>
            <strong>Kho Proxy</strong>
            <span>{rows.length} proxy · {liveCount} LIVE · {deadCount} DEAD · {unknownCount} chưa test</span>
          </div>
          <div className="proxy-builder-inline-actions">
            <input className="proxy-center-search" value={search} onChange={(event) => setSearch(event.currentTarget.value)} placeholder="Tìm proxy / outbound / nguồn…" />
            <select value={status} onChange={(event) => setStatus(event.currentTarget.value as typeof status)}>
              <option value="all">Tất cả trạng thái</option>
              <option value="live">LIVE</option>
              <option value="dead">DEAD</option>
              <option value="unknown">Chưa test</option>
            </select>
          </div>
        </div>
        <div className="proxy-center-import-row">
          <textarea
            aria-label="Nhập proxy vào kho"
            value={importText}
            onChange={(event) => setImportText(event.currentTarget.value)}
            placeholder={'host:port:user:pass\nhost:port'}
            rows={3}
            spellCheck={false}
            disabled={busy}
          />
          <div className="proxy-builder-inline-actions">
            <button className="button primary" type="button" disabled={!importLines.length || busy} onClick={() => void importInventory()}>
              Nhập vào kho ({importLines.length})
            </button>
            <span className="proxy-builder-muted">Password được lưu local và luôn mask trên bảng.</span>
          </div>
        </div>
      </div>

      <section className="proxy-builder-panel proxy-builder-results-panel">
        <div className="proxy-builder-result-toolbar">
          <div><strong>Danh sách quản lý</strong><span>Đang chọn {selected.size} · hiển thị {filtered.length}/{rows.length}</span></div>
          <div className="proxy-builder-inline-actions">
            <button className="button secondary" type="button" disabled={!selected.size || busy} onClick={() => void testInventory([...selected])}>Test đã chọn</button>
            <button className="button secondary" type="button" disabled={!rows.length || busy} onClick={() => void testInventory(rows.map((item) => item.id))}>Test tất cả</button>
            <button className="button danger" type="button" disabled={!selected.size || busy} onClick={() => void deleteSelected()}>Xóa khỏi kho</button>
          </div>
        </div>
        <div className="proxy-builder-table-wrap">
          <table className="data-table proxy-builder-table proxy-center-table">
            <thead><tr>
              <th className="proxy-builder-check-column">
                <input
                  type="checkbox"
                  aria-label="Chọn tất cả proxy trong kho"
                  disabled={!filtered.length}
                  checked={Boolean(filtered.length) && filtered.every((item) => selected.has(item.id))}
                  onChange={(event) => {
                    setSelected((current) => {
                      const next = new Set(current)
                      for (const item of filtered) {
                        if (event.currentTarget.checked) next.add(item.id)
                        else next.delete(item.id)
                      }
                      return next
                    })
                  }}
                />
              </th>
              <th>Proxy</th><th>Type</th><th>Outbound IP</th><th>Status</th><th>Latency / lỗi</th><th>Account</th><th>Nguồn</th><th>Lần test</th>
            </tr></thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.id}>
                  <td className="proxy-builder-check-column"><input type="checkbox" checked={selected.has(item.id)} onChange={() => setSelected((current) => {
                    const next = new Set(current)
                    if (next.has(item.id)) next.delete(item.id)
                    else next.add(item.id)
                    return next
                  })} aria-label={'Chọn proxy kho ' + item.id} /></td>
                  <td>{item.maskedProxy}</td>
                  <td>{item.ipFamily === 'unknown' ? '-' : item.ipFamily.toUpperCase()}</td>
                  <td>{item.outboundIp ?? '-'}</td>
                  <td><span className={'proxy-builder-live-badge ' + (item.status === 'unknown' ? 'pending' : item.status)}>{statusLabel(item.status)}</span></td>
                  <td>{item.latencyMs !== null ? item.latencyMs + ' ms' : item.lastError ?? '-'}</td>
                  <td>{item.assignedAccountCount || '-'}</td>
                  <td>{item.sourceKind === 'builder' ? 'Tạo Proxy' : 'Import'}{item.sourceLabel ? ' · ' + item.sourceLabel : ''}</td>
                  <td>{formatCheckedAt(item.lastCheckedAt)}</td>
                </tr>
              ))}
              {!filtered.length ? <tr><td colSpan={9} className="proxy-builder-empty">Kho Proxy chưa có dữ liệu phù hợp.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
      {notice ? <div className="proxy-builder-notice">{notice}</div> : null}
    </section>
  )
}
