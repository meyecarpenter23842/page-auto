import type { ScanFieldMap, ScanJobStatus, ScanResultStatus, ScanType, StartScanJobInput } from '../../shared/scanner'

export interface ScanAdapterRecord {
  entityId: string
  displayName: string
  url: string | null
  status: ScanResultStatus
  data: ScanFieldMap
}

export type ScanControlState = 'running' | 'paused' | 'stopped'

export interface ScanAdapterControl {
  isStopped(): boolean
  isPaused(): boolean
  waitIfPaused(): Promise<boolean>
  onStateChange(listener: (state: ScanControlState) => void): () => void
}

export class ScanAdapterRuntimeError extends Error {
  constructor(
    readonly jobStatus: Extract<ScanJobStatus, 'failed' | 'needs_attention'>,
    message: string
  ) {
    super(message)
    this.name = 'ScanAdapterRuntimeError'
  }
}

export type ScanAdapterOutput = AsyncIterable<ScanAdapterRecord> | Promise<ScanAdapterRecord[]>

export interface ScanAdapter {
  readonly scanType: ScanType
  scan(input: StartScanJobInput, control: ScanAdapterControl): ScanAdapterOutput
}
