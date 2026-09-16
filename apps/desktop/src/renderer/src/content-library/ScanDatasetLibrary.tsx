import { useEffect, useMemo, useState } from 'react'
import type {
  ScanDatasetDetails,
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
    const next = await window.pageAutoScanner.listDatasets()
    setDatasets(next)
    const target = preferId && next.some((item) => item.id === preferId) ? preferId : next[0]?.id ?? null
    setSelectedId(target)
    if (target === null) {
      setDetails(null)
      setRenameValue('')
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

  const filterLabel = details?.type === 'group' ? 'Members' : details?.type === 'page' || details?.type === 'user' ? 'Followers' : null
  const columns = details ? COLUMNS[details.type] : []

  return (
    <section className="scan-library" data-testid="scan-dataset-library">
      <aside className="scan-library-sidebar">
        <div className="scan-library-heading"><strong>Dữ liệu quét</strong><span>{datasets.length} Dataset</span></div>
        <label>Loại dữ liệu<select value={typeFilter} onChange={(event) => setTypeFilter(event.currentTarget.value as 'all' | ScanDatasetType)}><option value="all">Tất cả</option>{Object.entries(TYPE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <input value={datasetQuery} onChange={(event) => setDatasetQuery(event.currentTarget.value)} placeholder="Tìm Dataset..." aria-label="Tìm Dataset" />
        <div className="scan-library-datasets">
          {visibleDatasets.map((dataset) => <button key={dataset.id} type="button" disabled={busy} className={selectedId === dataset.id ? 'active' : ''} onClick={() => void selectDataset(dataset.id)}><strong>{dataset.name}</strong><span>{TYPE_LABEL[dataset.type]} · {dataset.recordCount} record</span></button>)}
          {!visibleDatasets.length ? <p>Chưa có Dataset phù hợp.</p> : null}
        </div>
      </aside>

      <div className="scan-library-main">
        <div className="scan-library-toolbar">
          <div><strong>{details?.name ?? (busy ? 'Đang tải Dataset…' : 'Chọn một Dataset')}</strong><span>{details ? `${TYPE_LABEL[details.type]} · ${details.recordCount} record` : 'Dataset được lưu từ Quét dữ liệu sẽ xuất hiện tại đây.'}</span></div>
          {details ? <div className="scan-library-actions"><input value={renameValue} onChange={(event) => setRenameValue(event.currentTarget.value)} aria-label="Tên Dataset" /><button className="button secondary" disabled={busy || !renameValue.trim()} onClick={() => void renameDataset()}>Đổi tên</button><button className="button secondary" disabled={busy} onClick={() => void exportDataset()}>Xuất CSV</button><button className="button secondary" disabled={busy} onClick={() => void deleteDataset()}>Xóa</button></div> : null}
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
