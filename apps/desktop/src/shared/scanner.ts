export const SCAN_TYPES = ['group', 'page', 'user', 'group_members'] as const
export type ScanType = (typeof SCAN_TYPES)[number]

export const SCAN_JOB_STATUSES = [
  'queued',
  'running',
  'paused',
  'completed',
  'failed',
  'stopped',
  'needs_attention'
] as const
export type ScanJobStatus = (typeof SCAN_JOB_STATUSES)[number]

export const SCAN_RESULT_STATUSES = [
  'success',
  'partial_success',
  'skipped',
  'duplicate',
  'permission_limited',
  'not_found',
  'rate_limited',
  'login_required',
  'needs_attention',
  'failed',
  'stopped'
] as const
export type ScanResultStatus = (typeof SCAN_RESULT_STATUSES)[number]

export type ScanFieldValue = string | number | boolean | null
export type ScanFieldMap = Record<string, ScanFieldValue>

export type ScanSource =
  | { type: 'account'; accountId: number | null }
  | { type: 'token'; credentialId: string | null }

export interface StartScanJobInput {
  scanType: ScanType
  source: ScanSource
  query: string
  filters: ScanFieldMap
  limit: number
}

export interface ScanResultRecord {
  id: number
  jobId: number
  scanType: ScanType
  entityId: string
  displayName: string
  url: string | null
  status: ScanResultStatus
  data: ScanFieldMap
  scannedAt: number
}

export interface ScanJobRecord {
  id: number
  scanType: ScanType
  source: ScanSource
  query: string
  filters: ScanFieldMap
  limit: number
  status: ScanJobStatus
  resultCount: number
  acceptedCount: number
  message: string | null
  startedAt: number | null
  finishedAt: number | null
  createdAt: number
  updatedAt: number
}

export interface ScanJobDetails extends ScanJobRecord {
  results: ScanResultRecord[]
}

export interface ScanJobIdPayload { jobId: number }

export const SCAN_DATASET_TYPES = ['group', 'page', 'user'] as const
export type ScanDatasetType = (typeof SCAN_DATASET_TYPES)[number]

export interface SaveScanDatasetInput {
  jobId: number
  name: string
}

export interface ScanDatasetSummary {
  id: number
  type: ScanDatasetType
  name: string
  recordCount: number
  sourceJobId: number | null
  createdAt: number
  updatedAt: number
}

export interface ScanDatasetItemRecord {
  id: number
  datasetId: number
  entityId: string
  displayName: string
  url: string | null
  data: ScanFieldMap
  sourceJobId: number | null
  createdAt: number
}

export interface ScanDatasetDetails extends ScanDatasetSummary {
  items: ScanDatasetItemRecord[]
}

export interface ScanDatasetIdPayload { datasetId: number }

export const SCANNER_IPC = {
  startJob: 'scanner:job:start',
  getJob: 'scanner:job:get',
  pauseJob: 'scanner:job:pause',
  resumeJob: 'scanner:job:resume',
  stopJob: 'scanner:job:stop',
  listDatasets: 'scanner:dataset:list',
  getDataset: 'scanner:dataset:get',
  saveDataset: 'scanner:dataset:save'
} as const

export function datasetTypeForScanType(scanType: ScanType): ScanDatasetType {
  if (scanType === 'group') return 'group'
  if (scanType === 'page') return 'page'
  return 'user'
}
