import type {
  SaveScanDatasetInput,
  ScanDatasetDetails,
  ScanDatasetSummary,
  ScanJobDetails,
  ScanJobStatus,
  StartScanJobInput
} from '../../shared/scanner'
import { ScannerRepository } from '../database/scannerRepository'
import { ScannerAdapterRegistry } from './scannerAdapterRegistry'

interface RuntimeControl {
  paused: boolean
  stopped: boolean
}

function isTerminal(status: ScanJobStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'stopped' || status === 'needs_attention'
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class ScanJobService {
  private readonly controls = new Map<number, RuntimeControl>()

  constructor(
    private readonly repository: ScannerRepository,
    private readonly adapters = new ScannerAdapterRegistry(),
    private readonly stepDelayMs = 180
  ) {
    this.repository.recoverInterrupted()
  }

  start(input: StartScanJobInput): ScanJobDetails {
    const created = this.repository.createJob(input)
    const control: RuntimeControl = { paused: false, stopped: false }
    this.controls.set(created.id, control)
    void this.run(created.id, input, control)
    return this.repository.getJob(created.id) ?? created
  }

  get(jobId: number): ScanJobDetails | null {
    return this.repository.getJob(jobId)
  }

  pause(jobId: number): ScanJobDetails | null {
    const job = this.repository.getJob(jobId)
    if (!job || isTerminal(job.status)) return job
    const control = this.controls.get(jobId)
    if (!control) return this.repository.setJobStatus(jobId, 'needs_attention', 'Runtime của phiên quét không còn hoạt động.')
    control.paused = true
    return this.repository.setJobStatus(jobId, 'paused')
  }

  resume(jobId: number): ScanJobDetails | null {
    const job = this.repository.getJob(jobId)
    if (!job || isTerminal(job.status)) return job
    const control = this.controls.get(jobId)
    if (!control) return this.repository.setJobStatus(jobId, 'needs_attention', 'Runtime của phiên quét không còn hoạt động.')
    control.paused = false
    return this.repository.setJobStatus(jobId, 'running')
  }

  stop(jobId: number): ScanJobDetails | null {
    const job = this.repository.getJob(jobId)
    if (!job || isTerminal(job.status)) return job
    const control = this.controls.get(jobId)
    if (control) control.stopped = true
    const stopped = this.repository.setJobStatus(jobId, 'stopped', 'Đã dừng theo yêu cầu.')
    this.controls.delete(jobId)
    return stopped
  }

  listDatasets(): ScanDatasetSummary[] {
    return this.repository.listDatasets()
  }

  getDataset(datasetId: number): ScanDatasetDetails | null {
    return this.repository.getDataset(datasetId)
  }

  saveDataset(input: SaveScanDatasetInput): ScanDatasetDetails {
    return this.repository.createDatasetFromJob(input)
  }

  dispose(): void {
    for (const control of this.controls.values()) control.stopped = true
    this.controls.clear()
  }

  private async run(jobId: number, input: StartScanJobInput, control: RuntimeControl): Promise<void> {
    try {
      this.repository.setJobStatus(jobId, 'running')
      const adapter = this.adapters.get(input.scanType)
      const records = await adapter.scan(input)

      for (const record of records) {
        if (!await this.waitUntilRunnable(control)) return
        this.repository.addResult(jobId, { ...record, scannedAt: Date.now() })
        if (this.stepDelayMs > 0) await sleep(this.stepDelayMs)
      }

      if (!control.stopped) this.repository.setJobStatus(jobId, 'completed')
    } catch (error) {
      if (!control.stopped) {
        this.repository.setJobStatus(
          jobId,
          'failed',
          error instanceof Error ? error.message : String(error)
        )
      }
    } finally {
      this.controls.delete(jobId)
    }
  }

  private async waitUntilRunnable(control: RuntimeControl): Promise<boolean> {
    while (control.paused && !control.stopped) await sleep(80)
    return !control.stopped
  }
}
