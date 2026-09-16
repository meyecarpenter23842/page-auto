import { useEffect, useMemo, useRef, useState } from 'react'
import type { AccountRecord } from '../../../shared/accounts'
import type {
  ScanDatasetSummary,
  ScanFieldMap,
  ScanJobDetails,
  ScanResultRecord,
  ScanType
} from '../../../shared/scanner'
import { ScannerSourcePanel, type ScannerSourceMode } from './ScannerSourcePanel'
import { eligibleGroupResultIds, reconcileGroupResultSelection } from './scannerGroupSelection'
import './scanner.css'

const TABS: Array<{ id: ScanType; label: string; hint: string }> = [
  { id: 'group', label: 'Quét Nhóm', hint: 'Từ khóa, Group UID/URL hoặc nhiều UID/URL (mỗi dòng một Group)' },
  { id: 'page', label: 'Quét Page', hint: 'Từ khóa, Page UID hoặc URL Page' },
  { id: 'user', label: 'Quét Người dùng', hint: 'UID hoặc URL Profile' },
  { id: 'group_members', label: 'Thành viên nhóm', hint: 'Group UID/URL (mỗi dòng một Group) hoặc chọn Group Dataset' }
]
const EMPTY_GROUP_RESULTS: ScanResultRecord[] = []

const STATUS_LABEL: Record<string, string> = {
  queued: 'Đang xếp hàng', running: 'Đang quét', paused: 'Tạm dừng', completed: 'Hoàn tất', failed: 'Lỗi', stopped: 'Đã dừng', needs_attention: 'Cần xử lý'
}

interface ResultColumn { key: string; label: string }

const COLUMNS: Record<ScanType, ResultColumn[]> = {
  group: [
    { key: 'entityId', label: 'Group UID' }, { key: 'displayName', label: 'Tên nhóm' }, { key: 'members', label: 'Members' },
    { key: 'privacy', label: 'Privacy' }, { key: 'locale', label: 'Locale' }, { key: 'location', label: 'Location' },
    { key: 'category', label: 'Category' }, { key: 'status', label: 'Trạng thái' }
  ],
  page: [
    { key: 'entityId', label: 'Page UID' }, { key: 'displayName', label: 'Tên Page' }, { key: 'username', label: 'Username' },
    { key: 'category', label: 'Category' }, { key: 'followers', label: 'Followers' }, { key: 'likes', label: 'Likes' },
    { key: 'location', label: 'Location' }, { key: 'status', label: 'Trạng thái' }
  ],
  user: [
    { key: 'entityId', label: 'UID' }, { key: 'displayName', label: 'Tên' }, { key: 'username', label: 'Username' },
    { key: 'location', label: 'Location' }, { key: 'followers', label: 'Followers' }, { key: 'status', label: 'Trạng thái' }
  ],
  group_members: [
    { key: 'entityId', label: 'UID' }, { key: 'displayName', label: 'Tên thành viên' }, { key: 'sourceGroupId', label: 'Group nguồn' },
    { key: 'username', label: 'Username' }, { key: 'location', label: 'Location' }, { key: 'status', label: 'Trạng thái' }
  ]
}

function resultValue(result: ScanResultRecord, key: string): string {
  if (key === 'entityId') return result.entityId
  if (key === 'displayName') return result.displayName.trim() || '—'
  if (key === 'status') return result.status
  const value = result.data[key]
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Có' : 'Không'
  return String(value)
}

function defaultDatasetName(scanType: ScanType): string {
  const label = TABS.find((tab) => tab.id === scanType)?.label ?? 'Dataset'
  const date = new Date().toLocaleDateString('vi-VN').replaceAll('/', '-')
  return `${label} ${date}`
}

function terminal(job: ScanJobDetails | null): boolean {
  return !job || ['completed', 'failed', 'stopped', 'needs_attention'].includes(job.status)
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }
function needsProductionAccount(scanType: ScanType): boolean { return scanType === 'group' || scanType === 'page' || scanType === 'user' || scanType === 'group_members' }

export function ScannerWorkspace() {
  const [activeType, setActiveType] = useState<ScanType>('group')
  const [accounts, setAccounts] = useState<AccountRecord[]>([])
  const [accountId, setAccountId] = useState<number | null>(null)
  const [sourceMode, setSourceMode] = useState<ScannerSourceMode>('account')
  const [tokenCredentialId, setTokenCredentialId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(100)
  const [membersMin, setMembersMin] = useState(0)
  const [membersMax, setMembersMax] = useState(0)
  const [privacy, setPrivacy] = useState('all')
  const [location, setLocation] = useState('')
  const [job, setJob] = useState<ScanJobDetails | null>(null)
  const [selectedResultIds, setSelectedResultIds] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [datasetName, setDatasetName] = useState(defaultDatasetName('group'))
  const [datasets, setDatasets] = useState<ScanDatasetSummary[]>([])
  const [datasetCount, setDatasetCount] = useState(0)
  const [lastDatasetId, setLastDatasetId] = useState<number | null>(null)
  const [groupDatasetId, setGroupDatasetId] = useState<number | null>(null)
  const previousEligibleIdsRef = useRef<Set<number>>(new Set())
  const previousGroupFilterKeyRef = useRef('')

  const activeTab = useMemo(() => TABS.find((tab) => tab.id === activeType) ?? TABS[0]!, [activeType])
  const columns = COLUMNS[activeType]
  const sourceLocked = Boolean(job && !terminal(job))
  const groupDatasets = useMemo(() => datasets.filter((dataset) => dataset.type === 'group'), [datasets])
  const groupResults = activeType === 'group' ? (job?.results ?? EMPTY_GROUP_RESULTS) : EMPTY_GROUP_RESULTS
  const eligibleIds = useMemo(() => eligibleGroupResultIds(groupResults, {
    membersMin, membersMax, privacy, location
  }), [groupResults, membersMin, membersMax, privacy, location])
  const eligibleIdSet = useMemo(() => new Set(eligibleIds), [eligibleIds])
  const groupFilterKey = useMemo(() => JSON.stringify({
    membersMin,
    membersMax,
    privacy,
    location: location.trim().toLocaleLowerCase()
  }), [membersMin, membersMax, privacy, location])
  const allEligibleSelected = eligibleIds.length > 0 && eligibleIds.every((id) => selectedResultIds.has(id))

  useEffect(() => {
    void Promise.all([window.pageAuto.listAccounts({ status: 'all' }), window.pageAutoScanner.listDatasets()]).then(([nextAccounts, nextDatasets]) => {
      setAccounts(nextAccounts)
      setAccountId((current) => current ?? nextAccounts[0]?.id ?? null)
      setDatasets(nextDatasets)
      setDatasetCount(nextDatasets.length)
      setLastDatasetId(nextDatasets[0]?.id ?? null)
    }).catch((error) => setNotice(errorMessage(error)))
  }, [])

  useEffect(() => {
    setDatasetName(defaultDatasetName(activeType))
    setQuery('')
    setJob(null)
    setSelectedResultIds(new Set())
    setNotice(null)
  }, [activeType])

  useEffect(() => {
    if (!job || terminal(job)) return
    const timer = window.setInterval(() => {
      void window.pageAutoScanner.getJob({ jobId: job.id }).then((next) => { if (next) setJob(next) }).catch((error) => setNotice(errorMessage(error)))
    }, 300)
    return () => window.clearInterval(timer)
  }, [job?.id, job?.status])

  useEffect(() => {
    if (activeType !== 'group') {
      previousEligibleIdsRef.current = new Set()
      previousGroupFilterKeyRef.current = ''
      return
    }
    const previousEligibleIds = previousEligibleIdsRef.current
    const previousFilterKey = previousGroupFilterKeyRef.current
    const filterChanged = previousFilterKey !== '' && previousFilterKey !== groupFilterKey
    previousEligibleIdsRef.current = new Set(eligibleIds)
    previousGroupFilterKeyRef.current = groupFilterKey
    setSelectedResultIds((current) => reconcileGroupResultSelection(
      current,
      previousEligibleIds,
      eligibleIds,
      { resetToEligible: filterChanged }
    ))
  }, [activeType, eligibleIds, groupFilterKey])

  const buildFilters = (): ScanFieldMap => activeType === 'group_members'
    ? { groupDatasetId }
    : {}

  const start = async () => {
    if (busy) return
    if (sourceMode === 'token') {
      setNotice(tokenCredentialId ? 'Token credential đã sẵn sàng, nhưng adapter quét bằng token chưa có production path được audit.' : 'Hãy lưu/chọn một Token credential. Adapter quét bằng token chưa có production path được audit.')
      return
    }
    if (needsProductionAccount(activeType) && accountId === null) { setNotice(`${activeTab.label} production cần chọn một Account Page-Auto.`); return }
    setBusy(true); setNotice(null)
    try {
      const next = await window.pageAutoScanner.startJob({ scanType: activeType, source: { type: 'account', accountId }, query, filters: buildFilters(), limit })
      setJob(next)
      setSelectedResultIds(new Set())
    } catch (error) { setNotice(errorMessage(error)) } finally { setBusy(false) }
  }

  const runCommand = async (command: 'pauseJob' | 'resumeJob' | 'stopJob') => {
    if (!job) return
    setBusy(true)
    try { const next = await window.pageAutoScanner[command]({ jobId: job.id }); if (next) setJob(next) }
    catch (error) { setNotice(errorMessage(error)) } finally { setBusy(false) }
  }

  const toggleResult = (resultId: number) => {
    setSelectedResultIds((current) => {
      const next = new Set(current)
      if (next.has(resultId)) next.delete(resultId)
      else next.add(resultId)
      return next
    })
  }

  const toggleAllEligible = () => {
    setSelectedResultIds((current) => {
      const next = new Set(current)
      if (allEligibleSelected) eligibleIds.forEach((id) => next.delete(id))
      else eligibleIds.forEach((id) => next.add(id))
      return next
    })
  }

  const saveDataset = async () => {
    if (!job || job.results.length === 0 || busy) return
    const groupSelection = activeType === 'group' ? [...selectedResultIds] : undefined
    if (activeType === 'group' && groupSelection?.length === 0) {
      setNotice('Hãy chọn ít nhất một Group để lưu Dataset.')
      return
    }
    setBusy(true)
    try {
      const created = await window.pageAutoScanner.saveDataset({ jobId: job.id, name: datasetName, resultIds: groupSelection })
      const nextDatasets = await window.pageAutoScanner.listDatasets()
      setDatasets(nextDatasets)
      setDatasetCount(nextDatasets.length)
      setLastDatasetId(created.id)
      setNotice(`Đã lưu Dataset “${created.name}” với ${created.recordCount} record.`)
    } catch (error) { setNotice(errorMessage(error)) } finally { setBusy(false) }
  }

  const exportCsv = async () => {
    if (lastDatasetId === null || busy) return
    setBusy(true)
    try {
      const result = await window.pageAutoScanner.exportDatasetCsv({ datasetId: lastDatasetId })
      if (!result.canceled) setNotice(`Đã xuất CSV ${result.recordCount} record${result.filePath ? ` · ${result.filePath}` : ''}.`)
    } catch (error) { setNotice(errorMessage(error)) } finally { setBusy(false) }
  }

  const startDisabled = busy || Boolean(job && !terminal(job)) || sourceMode === 'token' || (needsProductionAccount(activeType) && accountId === null)
  const selectedCount = activeType === 'group' ? selectedResultIds.size : (job?.results.length ?? 0)
  const showGroupResultFilters = activeType === 'group' && Boolean(job?.results.length) && terminal(job)

  return (
    <section className="scanner-shell" data-testid="scanner-workspace">
      <div className="scanner-tabs" role="tablist" aria-label="Loại dữ liệu quét">
        {TABS.map((tab) => <button key={tab.id} type="button" role="tab" aria-selected={activeType === tab.id} className={activeType === tab.id ? 'scanner-tab active' : 'scanner-tab'} onClick={() => setActiveType(tab.id)}>{tab.label}</button>)}
      </div>

      <ScannerSourcePanel accounts={accounts} accountId={accountId} onAccountIdChange={setAccountId} sourceMode={sourceMode} onSourceModeChange={setSourceMode} tokenCredentialId={tokenCredentialId} onTokenCredentialIdChange={setTokenCredentialId} locked={sourceLocked} onNotice={setNotice} />

      <div className={activeType === 'group' ? 'scanner-config-grid scanner-group-scan-config' : 'scanner-config-grid'}>
        <div className={activeType === 'group' ? 'scanner-card scanner-query-card scanner-group-query-card' : 'scanner-card scanner-query-card'}>
          <span className="scanner-section-kicker">NGUỒN / TÌM KIẾM</span>
          <label>{activeTab.hint}<input value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder={activeTab.hint} /></label>
          <label className="scanner-limit-field">Giới hạn<input type="number" min={1} max={50000} value={limit} onChange={(event) => setLimit(Math.max(1, Math.min(50000, Number(event.currentTarget.value) || 1)))} /></label>
          {activeType === 'group' ? <button className="button primary scanner-run-button" type="button" disabled={startDisabled} onClick={() => void start()}>Quét</button> : null}
        </div>

        {activeType !== 'group' ? <div className="scanner-card scanner-filter-card">
          <span className="scanner-section-kicker">TÙY CHỌN</span>
          {activeType === 'group_members' ? <label className="scanner-group-dataset-field">Group Dataset<select aria-label="Group Dataset nguồn" value={groupDatasetId ?? ''} onChange={(event) => setGroupDatasetId(event.currentTarget.value ? Number(event.currentTarget.value) : null)}><option value="">Không dùng Dataset</option>{groupDatasets.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name} · {dataset.recordCount}</option>)}</select></label> : <span className="scanner-inline-note">Metadata không xác minh được sẽ để trống, không đoán dữ liệu.</span>}
          <button className="button primary scanner-run-button" type="button" disabled={startDisabled} onClick={() => void start()}>Quét</button>
        </div> : null}
      </div>

      <div className="scanner-card scanner-result-card">
        <div className="scanner-result-header"><div><span className="scanner-section-kicker">KẾT QUẢ DATA-GRID</span><strong>{activeType === 'group' ? `${job?.resultCount ?? 0} tìm thấy · ${eligibleIds.length} đạt lọc · ${selectedCount} đã chọn` : `${job?.resultCount ?? 0} kết quả · ${job?.acceptedCount ?? 0} accepted`}</strong></div><div className="scanner-runtime-state">{job ? STATUS_LABEL[job.status] ?? job.status : 'Chưa chạy'}{job?.message ? ` · ${job.message}` : ''}</div></div>
        {showGroupResultFilters ? <div className="scanner-result-filters" data-testid="group-result-filters">
          <label>Members tối thiểu<input type="number" min={0} value={membersMin} onChange={(event) => setMembersMin(Math.max(0, Number(event.currentTarget.value) || 0))} /></label>
          <label>Members tối đa<input type="number" min={0} value={membersMax} onChange={(event) => setMembersMax(Math.max(0, Number(event.currentTarget.value) || 0))} /></label>
          <label>Privacy<select value={privacy} onChange={(event) => setPrivacy(event.currentTarget.value)}><option value="all">Tất cả</option><option value="public">Public</option><option value="private">Private</option></select></label>
          <label>Location<input value={location} onChange={(event) => setLocation(event.currentTarget.value)} placeholder="Tất cả" /></label>
        </div> : null}
        <div className="scanner-table-wrap"><table className="scanner-table"><thead><tr>{activeType === 'group' ? <th className="scanner-check-column"><input type="checkbox" aria-label="Chọn tất cả Group đạt bộ lọc" checked={allEligibleSelected} disabled={eligibleIds.length === 0} onChange={toggleAllEligible} /></th> : null}{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead><tbody>
          {job?.results.map((result) => <tr key={result.id} className={activeType === 'group' && eligibleIdSet.has(result.id) ? 'scanner-row-eligible' : undefined}>{activeType === 'group' ? <td className="scanner-check-column"><input type="checkbox" aria-label={`Chọn Group ${result.entityId}`} checked={selectedResultIds.has(result.id)} onChange={() => toggleResult(result.id)} /></td> : null}{columns.map((column) => <td key={column.key}>{resultValue(result, column.key)}</td>)}</tr>)}
          {!job?.results.length ? <tr><td colSpan={columns.length + (activeType === 'group' ? 1 : 0)} className="scanner-empty">{activeType === 'group' ? 'Chưa có kết quả Quét Nhóm.' : activeType === 'page' ? 'Chưa có kết quả Quét Page.' : activeType === 'user' ? 'Chưa có kết quả Quét Người dùng.' : 'Chưa có kết quả Thành viên nhóm.'}</td></tr> : null}
        </tbody></table></div>
      </div>

      <div className="scanner-footer">
        <div className="scanner-actions">
          <button className="button secondary" type="button" disabled={busy || job?.status !== 'running'} onClick={() => void runCommand('pauseJob')}>Pause</button>
          <button className="button secondary" type="button" disabled={busy || job?.status !== 'paused'} onClick={() => void runCommand('resumeJob')}>Resume</button>
          <button className="button secondary" type="button" disabled={busy || !job || terminal(job)} onClick={() => void runCommand('stopJob')}>Dừng</button>
        </div>
        <div className="scanner-dataset-actions">
          <span>{datasetCount} Dataset đã lưu</span><input value={datasetName} onChange={(event) => setDatasetName(event.currentTarget.value)} aria-label="Tên Dataset" />
          <button className="button secondary" type="button" disabled={busy || !job?.results.length || (activeType === 'group' && selectedResultIds.size === 0)} onClick={() => void saveDataset()}>Lưu Dataset</button>
          <button className="button secondary" type="button" disabled={busy || lastDatasetId === null} onClick={() => void exportCsv()}>Xuất CSV</button>
        </div>
      </div>
      {notice ? <div className="scanner-notice">{notice}</div> : null}
    </section>
  )
}
