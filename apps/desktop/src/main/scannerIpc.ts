import { dialog, ipcMain } from 'electron'
import type Database from 'better-sqlite3'
import { writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  SCANNER_IPC,
  type CreateScannerTokenCredentialInput,
  type ExportScanDatasetCsvInput,
  type ExportScanDatasetCsvResult,
  type SaveScanDatasetInput,
  type ScanDatasetIdPayload,
  type ScanJobIdPayload,
  type ScannerTokenCredentialIdPayload,
  type StartScanJobInput
} from '../shared/scanner'
import { ScannerRepository } from './database/scannerRepository'
import { scannerDatasetCsv } from './scanner/datasetCsv'
import { MockGroupMembersScanAdapter } from './scanner/adapters/mockGroupMembersScanAdapter'
import { GroupScanAccountRuntime } from './scanner/group/groupScanAccountRuntime'
import { GroupScanAdapter } from './scanner/group/groupScanAdapter'
import { PageScanAccountRuntime } from './scanner/page/pageScanAccountRuntime'
import { PageScanAdapter } from './scanner/page/pageScanAdapter'
import { ScanJobService } from './scanner/scanJobService'
import { ScannerAdapterRegistry } from './scanner/scannerAdapterRegistry'
import { ElectronScannerTokenSecretStore } from './scanner/token/electronTokenSecretStore'
import { ScannerTokenCredentialRepository } from './scanner/token/tokenCredentialRepository'
import { ScannerTokenCredentialService } from './scanner/token/tokenCredentialService'
import { MetaGraphScannerTokenValidator } from './scanner/token/tokenValidator'
import { UserScanAccountRuntime } from './scanner/user/userScanAccountRuntime'
import { UserScanAdapter } from './scanner/user/userScanAdapter'

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
  const pageRuntime = new PageScanAccountRuntime(database, dataDirectory)
  const userRuntime = new UserScanAccountRuntime(database, dataDirectory)
  const adapters = new ScannerAdapterRegistry([
    new GroupScanAdapter(groupRuntime),
    new PageScanAdapter(pageRuntime),
    new UserScanAdapter(userRuntime),
    new MockGroupMembersScanAdapter()
  ])
  const service = new ScanJobService(repository, adapters)
  const tokenService = new ScannerTokenCredentialService(
    new ScannerTokenCredentialRepository(database),
    new ElectronScannerTokenSecretStore(),
    new MetaGraphScannerTokenValidator()
  )

  ipcMain.handle(SCANNER_IPC.startJob, (_event, input: StartScanJobInput) => {
    if (input.source.type === 'token') {
      throw new Error('Access Token credential đã được quản lý an toàn, nhưng adapter quét bằng token chưa được mở ở Batch 3.')
    }
    return service.start(input)
  })
  ipcMain.handle(SCANNER_IPC.getJob, (_event, payload: ScanJobIdPayload) => service.get(payload.jobId))
  ipcMain.handle(SCANNER_IPC.pauseJob, (_event, payload: ScanJobIdPayload) => service.pause(payload.jobId))
  ipcMain.handle(SCANNER_IPC.resumeJob, (_event, payload: ScanJobIdPayload) => service.resume(payload.jobId))
  ipcMain.handle(SCANNER_IPC.stopJob, (_event, payload: ScanJobIdPayload) => service.stop(payload.jobId))
  ipcMain.handle(SCANNER_IPC.listDatasets, () => service.listDatasets())
  ipcMain.handle(SCANNER_IPC.getDataset, (_event, payload: ScanDatasetIdPayload) => service.getDataset(payload.datasetId))
  ipcMain.handle(SCANNER_IPC.saveDataset, (_event, input: SaveScanDatasetInput) => service.saveDataset(input))
  ipcMain.handle(SCANNER_IPC.getSourceCapabilities, () => tokenService.getCapabilities())
  ipcMain.handle(SCANNER_IPC.listTokenCredentials, () => tokenService.list())
  ipcMain.handle(
    SCANNER_IPC.createTokenCredential,
    (_event, input: CreateScannerTokenCredentialInput) => tokenService.create(input)
  )
  ipcMain.handle(
    SCANNER_IPC.validateTokenCredential,
    (_event, payload: ScannerTokenCredentialIdPayload) => tokenService.validate(payload.credentialId)
  )
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
      pageRuntime.dispose()
      userRuntime.dispose()
      for (const channel of Object.values(SCANNER_IPC)) ipcMain.removeHandler(channel)
    }
  }
}
