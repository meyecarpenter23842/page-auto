import type {
  SaveScanDatasetInput,
  ScanDatasetDetails,
  ScanDatasetSummary,
  ScanJobDetails,
  ScanJobStatus,
  StartScanJobInput
} from '../../shared/scanner'
import { ScannerRepository } from '../database/scannerRepository'
import {
  ScanAdapterRuntimeError,
  type ScanAdapterControl,
  type ScanAdapterOutput,
  type ScanAdapterRecord,
  type ScanControlState
} from './scanAdapter'
import { ScannerAdapterRegistry } from './scannerAdapterRegistry'

interface RuntimeControl {
  paused: boolean
  stopped: boolean
  listeners: Set<(state: ScanControlState) => void>
}

function isTerminal(status: ScanJobStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'stopped' || status === 'needs_attention'
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isAsyncIterable(output: ScanAdapterOutput): output is AsyncIterable<ScanAdapterRecord> {
  return typeof (output as AsyncIterable<ScanAdapterRecord>)[Symbol.asyncIterator] === 'function'
}

async function* adapterRecords(output: ScanAdapterOutput): AsyncIterable<ScanAdapterRecord> {
  if (isAsyncIterable(output)) {
    for await (const record of output) yield record
    return
  }
  for (const record of await output) yield record
}

function controlState(control: RuntimeControl): ScanControlState {
  if (control.stopped) return 'stopped'
  return control.paused ? 'paused' : 'running'
}

function notify(control: RuntimeControl): void {
  const state = controlState(control)
  for (const listener of control.listeners) listener(state)
}

export class ScanJobService {
  private readonly controls = new Map<number, RuntimeControl>()

  constructor(
    private readonly repository: ScannerRepository,
    private readonly adapters = new ScannerAdapterRegistry(),
    private readonly stepDelayMs = 0
  ) {
    this.repository.recoverInterrupted()
  }

  start(input: StartScanJobInput): ScanJobDetails {
    const created = this.repository.createJob(input)
    const control: RuntimeControl = { paused: false, stopped: false, listeners: new Set() }
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
    notify(control)
    return this.repository.setJobStatus(jobId, 'paused')
  }

  resume(jobId: number): ScanJobDetails | null {
    const job = this.repository.getJob(jobId)
    if (!job || isTerminal(job.status)) return job
    const control = this.controls.get(jobId)
    if (!control) return this.repository.setJobStatus(jobId, 'needs_attention', 'Runtime của phiên quét không còn hoạt động.')
    control.paused = false
    notify(control)
    return this.repository.setJobStatus(jobId, 'running')
  }

  stop(jobId: number): ScanJobDetails | null {
    const job = this.repository.getJob(jobId)
    if (!job || isTerminal(job.status)) return job
    const control = this.controls.get(jobId)
    if (control) {
      control.stopped = true
      control.paused = false
      notify(control)
    }
    return this.repository.setJobStatus(jobId, 'stopped', 'Đã dừng theo yêu cầu.')
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
    for (const control of this.controls.values()) {
      control.stopped = true
      control.paused = false
      notify(control)
      control.listeners.clear()
    }
    this.controls.clear()
  }

  private adapterControl(control: RuntimeControl): ScanAdapterControl {
    return {
      isStopped: () => control.stopped,
      isPaused: () => control.paused,
      waitIfPaused: () => this.waitUntilRunnable(control),
      onStateChange: (listener) => {
        control.listeners.add(listener)
        return () => control.listeners.delete(listener)
      }
    }
  }

  private async run(jobId: number, input: StartScanJobInput, control: RuntimeControl): Promise<void> {
    try {
      this.repository.setJobStatus(jobId, 'running')
      const adapter = this.adapters.get(input.scanType)
      for await (const record of adapterRecords(adapter.scan(input, this.adapterControl(control)))) {
        if (!await this.waitUntilRunnable(control)) return
        this.repository.addResult(jobId, { ...record, scannedAt: Date.now() })
        if (this.stepDelayMs > 0 && !await this.sleepWithControl(control, this.stepDelayMs)) return
      }

      if (!control.stopped) this.repository.setJobStatus(jobId, 'completed')
    } catch (error) {
      if (!control.stopped) {
        const status = error instanceof ScanAdapterRuntimeError ? error.jobStatus : 'failed'
        this.repository.setJobStatus(
          jobId,
          status,
          error instanceof Error ? error.message : String(error)
        )
      }
    } finally {
      control.listeners.clear()
      this.controls.delete(jobId)
    }
  }

  private async sleepWithControl(control: RuntimeControl, delayMs: number): Promise<boolean> {
    let remaining = Math.max(0, delayMs)
    while (remaining > 0 && !control.stopped) {
      if (!await this.waitUntilRunnable(control)) return false
      const chunk = Math.min(80, remaining)
      await sleep(chunk)
      remaining -= chunk
    }
    return !control.stopped
  }

  private async waitUntilRunnable(control: RuntimeControl): Promise<boolean> {
    while (control.paused && !control.stopped) await sleep(80)
    return !control.stopped
  }
}
