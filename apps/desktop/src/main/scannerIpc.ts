import { ipcMain } from 'electron'
import type Database from 'better-sqlite3'
import {
  SCANNER_IPC,
  type SaveScanDatasetInput,
  type ScanDatasetIdPayload,
  type ScanJobIdPayload,
  type StartScanJobInput
} from '../shared/scanner'
import { ScannerRepository } from './database/scannerRepository'
import { ScanJobService } from './scanner/scanJobService'

export interface ScannerIpcRuntime {
  dispose: () => void
}

export function registerScannerIpcHandlers(database: Database.Database): ScannerIpcRuntime {
  const service = new ScanJobService(new ScannerRepository(database))

  ipcMain.handle(SCANNER_IPC.startJob, (_event, input: StartScanJobInput) => service.start(input))
  ipcMain.handle(SCANNER_IPC.getJob, (_event, payload: ScanJobIdPayload) => service.get(payload.jobId))
  ipcMain.handle(SCANNER_IPC.pauseJob, (_event, payload: ScanJobIdPayload) => service.pause(payload.jobId))
  ipcMain.handle(SCANNER_IPC.resumeJob, (_event, payload: ScanJobIdPayload) => service.resume(payload.jobId))
  ipcMain.handle(SCANNER_IPC.stopJob, (_event, payload: ScanJobIdPayload) => service.stop(payload.jobId))
  ipcMain.handle(SCANNER_IPC.listDatasets, () => service.listDatasets())
  ipcMain.handle(SCANNER_IPC.getDataset, (_event, payload: ScanDatasetIdPayload) => service.getDataset(payload.datasetId))
  ipcMain.handle(SCANNER_IPC.saveDataset, (_event, input: SaveScanDatasetInput) => service.saveDataset(input))

  return {
    dispose: () => {
      service.dispose()
      for (const channel of Object.values(SCANNER_IPC)) ipcMain.removeHandler(channel)
    }
  }
}
