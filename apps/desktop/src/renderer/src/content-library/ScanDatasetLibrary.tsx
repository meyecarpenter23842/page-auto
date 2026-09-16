import { useEffect, useMemo, useState } from 'react'
import type {
  ScanDatasetDetails,
  ScanDatasetFolder,
  ScanDatasetFolderOverview,
  ScanDatasetItemRecord,
  ScanDatasetSummary,
  ScanDatasetType
} from '../../../shared/scanner'
import './scanDatasetLibrary.css'

const TYPE_LABEL: Record<ScanDatasetType, string> = {
  group: 'Nhóm',
  page: 'Trang',
  user: 'Người dùng',
  group_members: 'Thành viên nhóm'
}

const COLUMNS: Record<ScanDatasetType, Array<{ key: string; label: string }>> = {
  group: [
    { key: 'entityId', label: 'Group UID' }, { key: 'displayName', label: 'Tên nhóm' },
    { key: 'members', label: 'Members' }, { key: 'privacy', label: 'Privacy' }, { key: 'location', label: 'Location' }
  ],
  page: [
    { key: 'entityId', label: 'Page UID' }, { key: 'displayName', label: 'Tên Page' },
    { key: 'username', label: 'Username' }, { key: 'category', label: 'Category' }, { key: 'followers', label: 'Followers' }
  ],
  user: [
    { key: 'entityId', label: 'UID' }, { key: 'displayName', label: 'Tên' },
    { key: 'username', label: 'Username' }, { key: 'location', label: 'Location' }, { key: 'followers', label: 'Followers' }
  ],
  group_members: [
    { key: 'entityId', label: 'UID' }, { key: 'displayName', label: 'Tên thành viên' },
    { key: 'sourceGroupId', label: 'Group nguồn' }, { key: 'username', label: 'Username' }, { key: 'location', label: 'Location' }
  ]
}

const EMPTY_FOLDER_OVERVIEW: ScanDatasetFolderOverview = { folders: [], ungroupedDatasetIds: [] }

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }

function itemValue(item: ScanDatasetItemRecord, key: string): string {
  if (key === 'entityId') return item.entityId
  if (key === 'displayName') return item.displayName
  const value = item.data[key]
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Có' : 'Không'
  return String(value)
}

function numericValue(item: ScanDatasetItemRecord, key: string): number | null {
  const value = item.data[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[^0-9.-]/g, ''))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function matchesText(item: ScanDatasetItemRecord, query: string): boolean {
  if (!query) return true
  const haystack = [item.entityId, item.displayName, item.url ?? '', ...Object.values(item.data).map((value) => String(value ?? ''))]
    .join(' ')
    .toLocaleLowerCase('vi-VN')
  return haystack.includes(query.toLocaleLowerCase('vi-VN'))
}

export function ScanDatasetLibrary() {
  const [datasets, setDatasets] = useState<ScanDatasetSummary[]>([])
  const [folderOverview, setFolderOverview] = useState<ScanDatasetFolderOverview>(EMPTY_FOLDER_OVERVIEW)
  const [expandedFolders, setExpandedFolders] = useState<Set<number>>(() => new Set())
  const [ungroupedExpanded, setUngroupedExpanded] = useState(true)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [details, setDetails] = useState<ScanDatasetDetails | null>(null)
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null)
  const [typeFilter, setTypeFilter] = useState<'all' | ScanDatasetType>('all')
  const [datasetQuery, setDatasetQuery] = useState('')
  const [recordQuery, setRecordQuery] = useState('')
  const [minValue, setMinValue] = useState(0)
  const [maxValue, setMaxValue] = useState(0)
  const [privacy, setPrivacy] = useState('all')
  const [sourceGroupId, setSourceGroupId] = useState('')
  const [renameValue, setRenameValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const loadDatasets = async (preferId?: number | null) => {
    const [next, folders] = await Promise.all([
      window.pageAutoScanner.listDatasets(),
      window.pageAutoScanner.listDatasetFolders()
    ])
    setDatasets(next)
    setFolderOverview(folders)
    setExpandedFolders((current) => {
      const expanded = new Set(current)
      for (const folder of folders.folders) if (folder.parentId === null) expanded.add(folder.id)
      return expanded
    })
    const target = preferId && next.some((item) => item.id === preferId) ? preferId : next[0]?.id ?? null
    setSelectedId(target)
    if (target === null) {
      setDetails(null)
      setRenameValue('')
      setSelectedItemId(null)
      return
    }
    const loaded = await window.pageAutoScanner.getDataset({ datasetId: target })
    setDetails(loaded)
    setRenameValue(loaded?.name ?? '')
    setSelectedItemId(loaded?.items[0]?.id ?? null)
  }

  useEffect(() => { void loadDatasets().catch((error) => setNotice(errorMessage(error))) }, [])

  const visibleDatasets = useMemo(() => {
    const query = datasetQuery.trim().toLocaleLowerCase('vi-VN')
    return datasets.filter((dataset) => {
      if (typeFilter !== 'all' && dataset.type !== typeFilter) return false
      return !query || dataset.name.toLocaleLowerCase('vi-VN').includes(query)
    })
  }, [datasets, datasetQuery, typeFilter])

  const visibleItems = useMemo(() => {
    if (!details) return []
    const query = recordQuery.trim()
    return details.items.filter((item) => {
      if (!matchesText(item, query)) return false
      if (details.type === 'group') {
        const members = numericValue(item, 'members')
        if (minValue > 0 && (members === null || members < minValue)) return false
        if (maxValue > 0 && (members === null || members > maxValue)) return false
        if (privacy !== 'all' && String(item.data.privacy ?? '').toLocaleLowerCase().includes(privacy) === false) return false
      }
      if (details.type === 'page' || details.type === 'user') {
        const followers = numericValue(item, 'followers')
        if (minValue > 0 && (followers === null || followers < minValue)) return false
        if (maxValue > 0 && (followers === null || followers > maxValue)) return false
      }
      if (details.type === 'group_members' && sourceGroupId.trim()) {
        if (!String(item.data.sourceGroupId ?? '').includes(sourceGroupId.trim())) return false
      }
      return true
    })
  }, [details, recordQuery, minValue, maxValue, privacy, sourceGroupId])

  const selectedItem = useMemo(() => details?.items.find((item) => item.id === selectedItemId) ?? null, [details, selectedItemId])
  const roots = useMemo(() => folderOverview.folders.filter((folder) => folder.parentId === null), [folderOverview])
  const childrenByParent = useMemo(() => {
    const map = new Map<number, ScanDatasetFolder[]>()
    for (const folder of folderOverview.folders) {
      if (folder.parentId === null) continue
      const children = map.get(folder.parentId) ?? []
      children.push(folder)
      map.set(folder.parentId, children)
    }
    return map
  }, [folderOverview])
  const folderByDatasetId = useMemo(() => {
    const map = new Map<number, number>()
    for (const folder of folderOverview.folders) {
      for (const datasetId of folder.datasetIds) map.set(datasetId, folder.id)
    }
    return map
  }, [folderOverview])
  const datasetsByFolder = useMemo(() => {
    const map = new Map<number, ScanDatasetSummary[]>()
    for (const dataset of visibleDatasets) {
      const folderId = folderByDatasetId.get(dataset.id)
      if (folderId === undefined) continue
      const items = map.get(folderId) ?? []
      items.push(dataset)
      map.set(folderId, items)
    }
    return map
  }, [visibleDatasets, folderByDatasetId])
  const ungroupedDatasets = useMemo(
    () => visibleDatasets.filter((dataset) => !folderByDatasetId.has(dataset.id)),
    [visibleDatasets, folderByDatasetId]
  )
  const selectedFolderId = details ? folderByDatasetId.get(details.id) ?? null : null

  const folderVisibleCount = (folder: ScanDatasetFolder): number => {
    const direct = datasetsByFolder.get(folder.id)?.length ?? 0
    if (folder.parentId !== null) return direct
    return direct + (childrenByParent.get(folder.id) ?? []).reduce((total, child) => total + (datasetsByFolder.get(child.id)?.length ?? 0), 0)
  }

  const toggleFolder = (folderId: number) => {
    setExpandedFolders((current) => {
      const next = new Set(current)
      if (next.has(folderId)) next.delete(folderId)
      else next.add(folderId)
      return next
    })
  }

  const selectDataset = async (datasetId: number) => {
    if (busy || datasetId === selectedId) return
    setBusy(true)
    setSelectedId(datasetId)
    setDetails(null)
    setSelectedItemId(null)
    setRenameValue('')
    setNotice(null)
    try {
      const loaded = await window.pageAutoScanner.getDataset({ datasetId })
      setDetails(loaded)
      setRenameValue(loaded?.name ?? '')
      setSelectedItemId(loaded?.items[0]?.id ?? null)
      setRecordQuery(''); setMinValue(0); setMaxValue(0); setPrivacy('all'); setSourceGroupId('')
    } catch (error) { setNotice(errorMessage(error)) }
    finally { setBusy(false) }
  }

  const createFolder = async (parentId: number | null) => {
    if (busy) return
    const name = window.prompt(parentId === null ? 'Tên thư mục Dataset cấp 1:' : 'Tên thư mục Dataset cấp 2:')
    if (name === null || !name.trim()) return
    setBusy(true); setNotice(null)
    try {
      const created = await window.pageAutoScanner.createDatasetFolder({ name, parentId })
      const overview = await window.pageAutoScanner.listDatasetFolders()
      setFolderOverview(overview)
      if (parentId !== null) setExpandedFolders((current) => new Set(current).add(parentId))
      else setExpandedFolders((current) => new Set(current).add(created.id))
      setNotice(`Đã tạo thư mục “${created.name}”.`)
    } catch (error) { setNotice(errorMessage(error)) } finally { setBusy(false) }
  }

  const renameFolder = async (folder: ScanDatasetFolder) => {
    if (busy) return
    const name = window.prompt('Tên mới của thư mục:', folder.name)
    if (name === null || !name.trim() || name.trim() === folder.name) return
    setBusy(true); setNotice(null)
    try {
      const renamed = await window.pageAutoScanner.renameDatasetFolder({ folderId: folder.id, name })
      setFolderOverview(await window.pageAutoScanner.listDatasetFolders())
      setNotice(`Đã đổi tên thư mục thành “${renamed.name}”.`)
    } catch (error) { setNotice(errorMessage(error)) } finally { setBusy(false) }
  }

  const deleteFolder = async (folder: ScanDatasetFolder) => {
    if (busy) return
    if (!window.confirm(`Xóa thư mục “${folder.name}”? Dataset bên trong sẽ chuyển về “Chưa phân loại”.`)) return
    setBusy(true); setNotice(null)
    try {
      const result = await window.pageAutoScanner.deleteDatasetFolder({ folderId: folder.id })
      if (!result.deleted) throw new Error('Thư mục không còn tồn tại.')
      await loadDatasets(selectedId)
      setNotice('Đã xóa thư mục. Dataset bên trong vẫn được giữ lại ở “Chưa phân loại”.')
    } catch (error) { setNotice(errorMessage(error)) } finally { setBusy(false) }
  }

  const moveDataset = async (folderId: number | null) => {
    if (!details || busy || folderId === selectedFolderId) return
    setBusy(true); setNotice(null)
    try {
      const overview = await window.pageAutoScanner.moveDataset({ datasetId: details.id, folderId })
      setFolderOverview(overview)
      if (folderId !== null) {
        const destination = overview.folders.find((folder) => folder.id === folderId)
        if (destination?.parentId !== null && destination?.parentId !== undefined) {
          setExpandedFolders((current) => new Set(current).add(destination.parentId!))
        }
        setExpandedFolders((current) => new Set(current).add(folderId))
      } else setUngroupedExpanded(true)
      setNotice(folderId === null ? 'Đã chuyển Dataset về “Chưa phân loại”.' : 'Đã chuyển Dataset vào thư mục.')
    } catch (error) { setNotice(errorMessage(error)) } finally { setBusy(false) }
  }

  const renameDataset = async () => {
    if (!details || busy) return
    setBusy(true); setNotice(null)
    try {
      const renamed = await window.pageAutoScanner.renameDataset({ datasetId: details.id, name: renameValue })
      setDetails(renamed)
      await loadDatasets(renamed.id)
      setNotice(`Đã đổi tên thành “${renamed.name}”.`)
    } catch (error) { setNotice(errorMessage(error)) } finally { setBusy(false) }
  }

  const deleteDataset = async () => {
    if (!details || busy) return
    if (!window.confirm(`Xóa Dataset “${details.name}” khỏi Thư viện?`)) return
    setBusy(true); setNotice(null)
    try {
      const result = await window.pageAutoScanner.deleteDataset({ datasetId: details.id })
      if (!result.deleted) throw new Error('Dataset không còn tồn tại.')
      await loadDatasets(null)
      setNotice('Đã xóa Dataset khỏi Thư viện.')
    } catch (error) { setNotice(errorMessage(error)) } finally { setBusy(false) }
  }

  const exportDataset = async () => {
    if (!details || busy) return
    setBusy(true); setNotice(null)
    try {
      const result = await window.pageAutoScanner.exportDatasetCsv({ datasetId: details.id })
      if (!result.canceled) setNotice(`Đã xuất ${result.recordCount} record${result.filePath ? ` · ${result.filePath}` : ''}.`)
    } catch (error) { setNotice(errorMessage(error)) } finally { setBusy(false) }
  }

  const renderDatasetButton = (dataset: ScanDatasetSummary, depth: 1 | 2) => (
    <button
      key={dataset.id}
      type="button"
      disabled={busy}
      className={`scan-library-dataset-button depth-${depth}${selectedId === dataset.id ? ' active' : ''}`}
      onClick={() => void selectDataset(dataset.id)}
    >
      <strong>{dataset.name}</strong><span>{TYPE_LABEL[dataset.type]} · {dataset.recordCount} record</span>
    </button>
  )

  const renderFolderRow = (folder: ScanDatasetFolder, depth: 0 | 1) => {
    const expanded = expandedFolders.has(folder.id)
    const childFolders = depth === 0 ? childrenByParent.get(folder.id) ?? [] : []
    const directDatasets = datasetsByFolder.get(folder.id) ?? []
    return (
      <div className="scan-library-folder-node" key={folder.id} data-folder-depth={depth + 1}>
        <div className={`scan-library-folder-row depth-${depth}`}>
          <button className="scan-library-folder-toggle" type="button" aria-expanded={expanded} onClick={() => toggleFolder(folder.id)}>
            <span aria-hidden="true">{expanded ? '▾' : '▸'}</span><strong>{folder.name}</strong><small>{folderVisibleCount(folder)}</small>
          </button>
          <div className="scan-library-folder-actions">
            {depth === 0 ? <button type="button" disabled={busy} aria-label={`Tạo thư mục con trong ${folder.name}`} title="Tạo thư mục cấp 2" onClick={() => void createFolder(folder.id)}>＋</button> : null}
            <button type="button" disabled={busy} aria-label={`Đổi tên thư mục ${folder.name}`} title="Đổi tên" onClick={() => void renameFolder(folder)}>✎</button>
            <button type="button" disabled={busy} aria-label={`Xóa thư mục ${folder.name}`} title="Xóa" onClick={() => void deleteFolder(folder)}>×</button>
          </div>
        </div>
        {expanded ? <div className="scan-library-folder-children">
          {childFolders.map((child) => renderFolderRow(child, 1))}
          {directDatasets.map((dataset) => renderDatasetButton(dataset, depth === 0 ? 1 : 2))}
        </div> : null}
      </div>
    )
  }

  const filterLabel = details?.type === 'group' ? 'Members' : details?.type === 'page' || details?.type === 'user' ? 'Followers' : null
  const columns = details ? COLUMNS[details.type] : []

  return (
    <section className="scan-library" data-testid="scan-dataset-library">
      <aside className="scan-library-sidebar">
        <div className="scan-library-heading"><strong>Dữ liệu quét</strong><span>{datasets.length} Dataset</span></div>
        <label>Loại dữ liệu<select value={typeFilter} onChange={(event) => setTypeFilter(event.currentTarget.value as 'all' | ScanDatasetType)}><option value="all">Tất cả</option>{Object.entries(TYPE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <input value={datasetQuery} onChange={(event) => setDatasetQuery(event.currentTarget.value)} placeholder="Tìm Dataset..." aria-label="Tìm Dataset" />
        <div className="scan-library-folder-toolbar"><strong>Thư mục</strong><button className="button secondary" type="button" disabled={busy} onClick={() => void createFolder(null)}>+ Thư mục</button></div>
        <div className="scan-library-datasets" data-testid="scan-dataset-folder-tree">
          {roots.map((folder) => renderFolderRow(folder, 0))}
          <div className="scan-library-folder-node ungrouped">
            <div className="scan-library-folder-row depth-0">
              <button className="scan-library-folder-toggle" type="button" aria-expanded={ungroupedExpanded} onClick={() => setUngroupedExpanded((value) => !value)}>
                <span aria-hidden="true">{ungroupedExpanded ? '▾' : '▸'}</span><strong>Chưa phân loại</strong><small>{ungroupedDatasets.length}</small>
              </button>
            </div>
            {ungroupedExpanded ? <div className="scan-library-folder-children">{ungroupedDatasets.map((dataset) => renderDatasetButton(dataset, 1))}</div> : null}
          </div>
          {!visibleDatasets.length && !folderOverview.folders.length ? <p>Chưa có Dataset phù hợp.</p> : null}
        </div>
      </aside>

      <div className="scan-library-main">
        <div className="scan-library-toolbar">
          <div><strong>{details?.name ?? (busy ? 'Đang tải Dataset…' : 'Chọn một Dataset')}</strong><span>{details ? `${TYPE_LABEL[details.type]} · ${details.recordCount} record` : 'Dataset được lưu từ Quét dữ liệu sẽ xuất hiện tại đây.'}</span></div>
          {details ? <div className="scan-library-actions">
            <label className="scan-library-folder-picker">Thư mục<select aria-label="Thư mục Dataset" value={selectedFolderId ?? ''} disabled={busy} onChange={(event) => void moveDataset(event.currentTarget.value ? Number(event.currentTarget.value) : null)}><option value="">Chưa phân loại</option>{roots.flatMap((root) => [<option key={root.id} value={root.id}>{root.name}</option>, ...(childrenByParent.get(root.id) ?? []).map((child) => <option key={child.id} value={child.id}>↳ {root.name} / {child.name}</option>)])}</select></label>
            <input value={renameValue} onChange={(event) => setRenameValue(event.currentTarget.value)} aria-label="Tên Dataset" />
            <button className="button secondary" disabled={busy || !renameValue.trim()} onClick={() => void renameDataset()}>Đổi tên</button>
            <button className="button secondary" disabled={busy} onClick={() => void exportDataset()}>Xuất CSV</button>
            <button className="button secondary" disabled={busy} onClick={() => void deleteDataset()}>Xóa</button>
          </div> : null}
        </div>

        <div className="scan-library-filters">
          <input value={recordQuery} onChange={(event) => setRecordQuery(event.currentTarget.value)} placeholder="Tìm UID, tên hoặc metadata..." aria-label="Tìm record" />
          {filterLabel ? <><label>{filterLabel} từ<input type="number" min={0} value={minValue} onChange={(event) => setMinValue(Math.max(0, Number(event.currentTarget.value) || 0))} /></label><label>{filterLabel} đến<input type="number" min={0} value={maxValue} onChange={(event) => setMaxValue(Math.max(0, Number(event.currentTarget.value) || 0))} /></label></> : null}
          {details?.type === 'group' ? <label>Privacy<select value={privacy} onChange={(event) => setPrivacy(event.currentTarget.value)}><option value="all">Tất cả</option><option value="public">Public</option><option value="private">Private</option></select></label> : null}
          {details?.type === 'group_members' ? <label>Group nguồn<input value={sourceGroupId} onChange={(event) => setSourceGroupId(event.currentTarget.value)} placeholder="Group UID" /></label> : null}
          {details ? <span>{visibleItems.length}/{details.recordCount} record</span> : null}
        </div>

        <div className="scan-library-table-wrap"><table><thead><tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead><tbody>
          {visibleItems.map((item) => <tr key={item.id} className={selectedItemId === item.id ? 'selected' : ''} onClick={() => setSelectedItemId(item.id)}>{columns.map((column) => <td key={column.key}>{itemValue(item, column.key)}</td>)}</tr>)}
          {!visibleItems.length ? <tr><td className="scan-library-empty" colSpan={Math.max(1, columns.length)}>{details ? 'Không có record phù hợp bộ lọc.' : busy ? 'Đang tải Dataset…' : 'Chưa chọn Dataset.'}</td></tr> : null}
        </tbody></table></div>
        {notice ? <div className="scan-library-notice">{notice}</div> : null}
      </div>

      <aside className="scan-library-detail">
        <div className="scan-library-heading"><strong>Chi tiết</strong><span>{selectedItem ? selectedItem.entityId : 'Chưa chọn record'}</span></div>
        {selectedItem ? <div className="scan-library-detail-body"><dl><dt>Tên</dt><dd>{selectedItem.displayName}</dd><dt>UID</dt><dd>{selectedItem.entityId}</dd><dt>URL</dt><dd>{selectedItem.url ?? '—'}</dd>{Object.entries(selectedItem.data).map(([key, value]) => <div className="scan-library-meta" key={key}><dt>{key}</dt><dd>{value === null || value === '' ? '—' : String(value)}</dd></div>)}</dl></div> : <p className="scan-library-detail-empty">Chọn một dòng trong bảng để xem toàn bộ metadata đã quét.</p>}
      </aside>
    </section>
  )
}
