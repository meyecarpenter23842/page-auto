import { dialog, ipcMain } from 'electron'
import type Database from 'better-sqlite3'
import { writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  SCANNER_IPC,
  type ExportScanDatasetCsvInput,
  type ExportScanDatasetCsvResult,
  type SaveScanDatasetInput,
  type ScanDatasetIdPayload,
  type ScanJobIdPayload,
  type StartScanJobInput
} from '../shared/scanner'
import { ScannerRepository } from './database/scannerRepository'
import { scannerDatasetCsv } from './scanner/datasetCsv'
import { MockGroupMembersScanAdapter } from './scanner/adapters/mockGroupMembersScanAdapter'
import { MockPageScanAdapter } from './scanner/adapters/mockPageScanAdapter'
import { MockUserScanAdapter } from './scanner/adapters/mockUserScanAdapter'
import { GroupScanAccountRuntime } from './scanner/group/groupScanAccountRuntime'
import { GroupScanAdapter } from './scanner/group/groupScanAdapter'
import { ScanJobService } from './scanner/scanJobService'
import { ScannerAdapterRegistry } from './scanner/scannerAdapterRegistry'

export interface ScannerIpcRuntime {
  dispose: () => void
}

function safeFileName(value: string): string {
  const normalized = value.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').trim()
  return normalized || 'scanner-dataset'
}

export function registerScannerIpcHandlers(
  database: Database.Database,
  dataDirectory: string = dirname(database.name)
): ScannerIpcRuntime {
  const repository = new ScannerRepository(database)
  const groupRuntime = new GroupScanAccountRuntime(database, dataDirectory)
  const adapters = new ScannerAdapterRegistry([
    new GroupScanAdapter(groupRuntime),
    new MockPageScanAdapter(),
    new MockUserScanAdapter(),
    new MockGroupMembersScanAdapter()
  ])
  const service = new ScanJobService(repository, adapters)

  ipcMain.handle(SCANNER_IPC.startJob, (_event, input: StartScanJobInput) => service.start(input))
  ipcMain.handle(SCANNER_IPC.getJob, (_event, payload: ScanJobIdPayload) => service.get(payload.jobId))
  ipcMain.handle(SCANNER_IPC.pauseJob, (_event, payload: ScanJobIdPayload) => service.pause(payload.jobId))
  ipcMain.handle(SCANNER_IPC.resumeJob, (_event, payload: ScanJobIdPayload) => service.resume(payload.jobId))
  ipcMain.handle(SCANNER_IPC.stopJob, (_event, payload: ScanJobIdPayload) => service.stop(payload.jobId))
  ipcMain.handle(SCANNER_IPC.listDatasets, () => service.listDatasets())
  ipcMain.handle(SCANNER_IPC.getDataset, (_event, payload: ScanDatasetIdPayload) => service.getDataset(payload.datasetId))
  ipcMain.handle(SCANNER_IPC.saveDataset, (_event, input: SaveScanDatasetInput) => service.saveDataset(input))
  ipcMain.handle(
    SCANNER_IPC.exportDatasetCsv,
    async (_event, input: ExportScanDatasetCsvInput): Promise<ExportScanDatasetCsvResult> => {
      const dataset = service.getDataset(input.datasetId)
      if (!dataset) throw new Error(`Không tìm thấy Dataset #${input.datasetId}.`)
      const picked = await dialog.showSaveDialog({
        title: 'Xuất Scanner Dataset CSV',
        defaultPath: `${safeFileName(dataset.name)}.csv`,
        filters: [{ name: 'CSV', extensions: ['csv'] }]
      })
      if (picked.canceled || !picked.filePath) {
        return { canceled: true, filePath: null, recordCount: dataset.recordCount }
      }
      await writeFile(picked.filePath, scannerDatasetCsv(dataset), 'utf8')
      return { canceled: false, filePath: picked.filePath, recordCount: dataset.recordCount }
    }
  )

  return {
    dispose: () => {
      service.dispose()
      groupRuntime.dispose()
      for (const channel of Object.values(SCANNER_IPC)) ipcMain.removeHandler(channel)
    }
  }
}
