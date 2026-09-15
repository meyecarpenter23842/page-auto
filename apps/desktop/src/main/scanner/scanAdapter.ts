import type { ScanFieldMap, ScanResultStatus, ScanType, StartScanJobInput } from '../../shared/scanner'

export interface ScanAdapterRecord {
  entityId: string
  displayName: string
  url: string | null
  status: ScanResultStatus
  data: ScanFieldMap
}

export interface ScanAdapter {
  readonly scanType: ScanType
  scan(input: StartScanJobInput): Promise<ScanAdapterRecord[]>
}
