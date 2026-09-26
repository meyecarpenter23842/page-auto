import { useEffect, useMemo, useState } from 'react'
import type { ProxyCenterFolder, ProxyCenterInventoryRecord, ProxyCenterInventoryStatus } from '../../../shared/proxyBuilder'

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

type UsageFilter = 'all' | 'used' | 'unused'

export function ProxyInventoryPanel() {
  const [rows, setRows] = useState<ProxyCenterInventoryRecord[]>([])
  const [folders, setFolders] = useState<ProxyCenterFolder[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'all' | ProxyCenterInventoryStatus>('all')
  const [usage, setUsage] = useState<UsageFilter>('all')
  const [folderFilter, setFolderFilter] = useState('all')
  const [moveFolder, setMoveFolder] = useState('none')
  const [importText, setImportText] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const load = async () => {
    const [next, nextFolders] = await Promise.all([
      window.pageAutoProxyBuilder.listInventory(),
      window.pageAutoProxyBuilder.listProxyFolders()
    ])
    setRows(next)
    setFolders(nextFolders)
    setSelected((current) => new Set([...current].filter((id) => next.some((item) => item.id === id))))
  }

  useEffect(() => {
    void load().catch((error) => setNotice(message(error)))
  }, [])

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return rows.filter((item) => {
      if (status !== 'all' && item.status !== status) return false
      if (usage === 'used' && item.assignedAccountCount <= 0) return false
      if (usage === 'unused' && item.assignedAccountCount > 0) return false
      if (folderFilter === 'unfiled' && item.folderId !== null) return false
      if (folderFilter.startsWith('folder:') && item.folderId !== Number(folderFilter.slice(7))) return false
      if (!needle) return true
      const folderName = folders.find((folder) => folder.id === item.folderId)?.name ?? ''
      return [
        item.maskedProxy,
        item.outboundIp ?? '',
        item.sourceLabel ?? '',
        item.sourceKind,
        item.ipFamily,
        folderName
      ].some((value) => value.toLowerCase().includes(needle))
    })
  }, [rows, folders, search, status, usage, folderFilter])

  const importLines = importText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const liveCount = rows.filter((item) => item.status === 'live').length
  const deadCount = rows.filter((item) => item.status === 'dead').length
  const unknownCount = rows.length - liveCount - deadCount
  const usedCount = rows.filter((item) => item.assignedAccountCount > 0).length
  const unfiledCount = rows.filter((item) => item.folderId === null).length
  const folderName = (id: number | null) => id === null ? 'Chưa phân loại' : folders.find((folder) => folder.id === id)?.name ?? 'Thư mục đã xóa'

  const selectRows = (predicate: (item: ProxyCenterInventoryRecord) => boolean) => {
    setSelected(new Set(filtered.filter(predicate).map((item) => item.id)))
  }

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

  const createFolder = async () => {
    const name = window.prompt('Tên thư mục proxy mới:')
    if (!name?.trim() || busy) return
    setBusy(true)
    try {
      setFolders(await window.pageAutoProxyBuilder.createProxyFolder({ name }))
      setNotice('Đã tạo thư mục "' + name.trim() + '".')
    } catch (error) {
      setNotice(message(error))
    } finally {
      setBusy(false)
    }
  }

  const renameFolder = async (folder: ProxyCenterFolder) => {
    const name = window.prompt('Đổi tên thư mục:', folder.name)
    if (!name?.trim() || name.trim() === folder.name || busy) return
    setBusy(true)
    try {
      setFolders(await window.pageAutoProxyBuilder.renameProxyFolder({ id: folder.id, name }))
      setNotice('Đã đổi tên thư mục.')
    } catch (error) {
      setNotice(message(error))
    } finally {
      setBusy(false)
    }
  }

  const deleteFolder = async (folder: ProxyCenterFolder) => {
    if (busy || !window.confirm('Xóa thư mục "' + folder.name + '"? Proxy bên trong sẽ chuyển về Chưa phân loại.')) return
    setBusy(true)
    try {
      setFolders(await window.pageAutoProxyBuilder.deleteProxyFolder({ id: folder.id }))
      if (folderFilter === 'folder:' + folder.id) setFolderFilter('all')
      await load()
      setNotice('Đã xóa thư mục; proxy được giữ lại trong Chưa phân loại.')
    } catch (error) {
      setNotice(message(error))
    } finally {
      setBusy(false)
    }
  }

  const moveSelected = async () => {
    if (!selected.size || busy) return
    const folderId = moveFolder === 'none' ? null : Number(moveFolder)
    setBusy(true)
    try {
      setRows(await window.pageAutoProxyBuilder.assignProxyFolder({ ids: [...selected], folderId }))
      setFolders(await window.pageAutoProxyBuilder.listProxyFolders())
      setNotice('Đã chuyển ' + selected.size + ' proxy vào ' + (folderId === null ? 'Chưa phân loại.' : 'thư mục.'))
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
            <span>{rows.length} proxy · {liveCount} LIVE · {deadCount} DEAD · {unknownCount} chưa test · {usedCount} đã dùng</span>
          </div>
          <div className="proxy-builder-inline-actions">
            <input className="proxy-center-search" value={search} onChange={(event) => setSearch(event.currentTarget.value)} placeholder="Tìm proxy / outbound / nguồn / thư mục…" />
            <select value={status} onChange={(event) => setStatus(event.currentTarget.value as typeof status)}>
              <option value="all">Tất cả trạng thái</option>
              <option value="live">LIVE</option>
              <option value="dead">DEAD</option>
              <option value="unknown">Chưa test</option>
            </select>
            <select value={usage} onChange={(event) => setUsage(event.currentTarget.value as UsageFilter)}>
              <option value="all">Tất cả sử dụng</option>
              <option value="unused">Chưa dùng</option>
              <option value="used">Đã dùng</option>
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

      <div className="proxy-center-management">
        <aside className="proxy-builder-panel proxy-center-folders">
          <div className="proxy-center-folder-heading">
            <strong>Thư mục Proxy</strong>
            <button className="button secondary" type="button" disabled={busy} onClick={() => void createFolder()}>+ Tạo</button>
          </div>
          <button type="button" className={folderFilter === 'all' ? 'active' : ''} onClick={() => setFolderFilter('all')}>
            <span>Tất cả proxy</span><b>{rows.length}</b>
          </button>
          <button type="button" className={folderFilter === 'unfiled' ? 'active' : ''} onClick={() => setFolderFilter('unfiled')}>
            <span>Chưa phân loại</span><b>{unfiledCount}</b>
          </button>
          {folders.map((folder) => (
            <div className="proxy-center-folder-item" key={folder.id}>
              <button type="button" className={folderFilter === 'folder:' + folder.id ? 'active' : ''} onClick={() => setFolderFilter('folder:' + folder.id)}>
                <span>{folder.name}</span><b>{folder.proxyCount}</b>
              </button>
              <button className="proxy-center-folder-icon" type="button" title="Đổi tên" onClick={() => void renameFolder(folder)}>✎</button>
              <button className="proxy-center-folder-icon danger" type="button" title="Xóa thư mục" onClick={() => void deleteFolder(folder)}>×</button>
            </div>
          ))}
        </aside>

        <section className="proxy-builder-panel proxy-builder-results-panel">
          <div className="proxy-center-selection-bar">
            <div><strong>Danh sách quản lý</strong><span>Đang chọn {selected.size} · hiển thị {filtered.length}/{rows.length}</span></div>
            <div className="proxy-builder-inline-actions">
              <button className="button secondary" type="button" disabled={!filtered.length || busy} onClick={() => selectRows(() => true)}>Chọn tất cả lọc</button>
              <button className="button secondary" type="button" disabled={!filtered.some((item) => item.assignedAccountCount === 0) || busy} onClick={() => selectRows((item) => item.assignedAccountCount === 0)}>Chọn chưa dùng</button>
              <button className="button secondary" type="button" disabled={!filtered.some((item) => item.assignedAccountCount > 0) || busy} onClick={() => selectRows((item) => item.assignedAccountCount > 0)}>Chọn đã dùng</button>
              <button className="button secondary" type="button" disabled={!selected.size || busy} onClick={() => setSelected(new Set())}>Bỏ chọn</button>
            </div>
          </div>
          <div className="proxy-center-selection-bar secondary">
            <div className="proxy-builder-inline-actions">
              <select value={moveFolder} onChange={(event) => setMoveFolder(event.currentTarget.value)} aria-label="Thư mục đích">
                <option value="none">Chưa phân loại</option>
                {folders.map((folder) => <option value={folder.id} key={folder.id}>{folder.name}</option>)}
              </select>
              <button className="button secondary" type="button" disabled={!selected.size || busy} onClick={() => void moveSelected()}>Chuyển thư mục</button>
            </div>
            <div className="proxy-builder-inline-actions">
              <button className="button secondary" type="button" disabled={!selected.size || busy} onClick={() => void testInventory([...selected])}>Test đã chọn</button>
              <button className="button secondary" type="button" disabled={!filtered.length || busy} onClick={() => void testInventory(filtered.map((item) => item.id))}>Test tập đang lọc</button>
              <button className="button danger" type="button" disabled={!selected.size || busy} onClick={() => void deleteSelected()}>Xóa khỏi kho</button>
            </div>
          </div>
          <div className="proxy-builder-table-wrap">
            <table className="data-table proxy-builder-table proxy-center-table">
              <thead><tr>
                <th className="proxy-builder-check-column">
                  <input
                    type="checkbox"
                    aria-label="Chọn tất cả proxy đang lọc"
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
                <th>Proxy</th><th>Type</th><th>Outbound IP</th><th>Status</th><th>Sử dụng</th><th>Latency / lỗi</th><th>Account</th><th>Thư mục</th><th>Nguồn</th><th>Lần test</th>
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
                    <td><span className={'proxy-center-usage-badge ' + (item.assignedAccountCount > 0 ? 'used' : 'unused')}>{item.assignedAccountCount > 0 ? 'ĐÃ DÙNG' : 'CHƯA DÙNG'}</span></td>
                    <td>{item.latencyMs !== null ? item.latencyMs + ' ms' : item.lastError ?? '-'}</td>
                    <td>{item.assignedAccountCount || '-'}</td>
                    <td>{folderName(item.folderId)}</td>
                    <td>{item.sourceKind === 'builder' ? 'Tạo Proxy' : 'Import'}{item.sourceLabel ? ' · ' + item.sourceLabel : ''}</td>
                    <td>{formatCheckedAt(item.lastCheckedAt)}</td>
                  </tr>
                ))}
                {!filtered.length ? <tr><td colSpan={11} className="proxy-builder-empty">Kho Proxy chưa có dữ liệu phù hợp.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      {notice ? <div className="proxy-builder-notice">{notice}</div> : null}
    </section>
  )
}
