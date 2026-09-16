import { contextBridge, ipcRenderer } from 'electron'
import {
  SCANNER_IPC,
  type CreateScanDatasetFolderInput,
  type CreateScannerTokenCredentialInput,
  type ExportScanDatasetCsvInput,
  type ExportScanDatasetCsvResult,
  type MoveScanDatasetInput,
  type RenameScanDatasetFolderInput,
  type RenameScanDatasetInput,
  type SaveScanDatasetInput,
  type ScanDatasetDeleteResult,
  type ScanDatasetDetails,
  type ScanDatasetFolder,
  type ScanDatasetFolderDeleteResult,
  type ScanDatasetFolderIdPayload,
  type ScanDatasetFolderOverview,
  type ScanDatasetIdPayload,
  type ScanDatasetSummary,
  type ScanJobDetails,
  type ScanJobIdPayload,
  type ScannerSourceCapabilities,
  type ScannerTokenCredentialIdPayload,
  type ScannerTokenCredentialSummary,
  type StartScanJobInput
} from '../shared/scanner'

const api = {
  startJob: (input: StartScanJobInput): Promise<ScanJobDetails> => ipcRenderer.invoke(SCANNER_IPC.startJob, input) as Promise<ScanJobDetails>,
  getJob: (payload: ScanJobIdPayload): Promise<ScanJobDetails | null> => ipcRenderer.invoke(SCANNER_IPC.getJob, payload) as Promise<ScanJobDetails | null>,
  pauseJob: (payload: ScanJobIdPayload): Promise<ScanJobDetails | null> => ipcRenderer.invoke(SCANNER_IPC.pauseJob, payload) as Promise<ScanJobDetails | null>,
  resumeJob: (payload: ScanJobIdPayload): Promise<ScanJobDetails | null> => ipcRenderer.invoke(SCANNER_IPC.resumeJob, payload) as Promise<ScanJobDetails | null>,
  stopJob: (payload: ScanJobIdPayload): Promise<ScanJobDetails | null> => ipcRenderer.invoke(SCANNER_IPC.stopJob, payload) as Promise<ScanJobDetails | null>,
  listDatasets: (): Promise<ScanDatasetSummary[]> => ipcRenderer.invoke(SCANNER_IPC.listDatasets) as Promise<ScanDatasetSummary[]>,
  getDataset: (payload: ScanDatasetIdPayload): Promise<ScanDatasetDetails | null> => ipcRenderer.invoke(SCANNER_IPC.getDataset, payload) as Promise<ScanDatasetDetails | null>,
  saveDataset: (input: SaveScanDatasetInput): Promise<ScanDatasetDetails> => ipcRenderer.invoke(SCANNER_IPC.saveDataset, input) as Promise<ScanDatasetDetails>,
  renameDataset: (input: RenameScanDatasetInput): Promise<ScanDatasetDetails> => ipcRenderer.invoke(SCANNER_IPC.renameDataset, input) as Promise<ScanDatasetDetails>,
  deleteDataset: (payload: ScanDatasetIdPayload): Promise<ScanDatasetDeleteResult> => ipcRenderer.invoke(SCANNER_IPC.deleteDataset, payload) as Promise<ScanDatasetDeleteResult>,
  exportDatasetCsv: (input: ExportScanDatasetCsvInput): Promise<ExportScanDatasetCsvResult> => ipcRenderer.invoke(SCANNER_IPC.exportDatasetCsv, input) as Promise<ExportScanDatasetCsvResult>,
  listDatasetFolders: (): Promise<ScanDatasetFolderOverview> => ipcRenderer.invoke(SCANNER_IPC.listDatasetFolders) as Promise<ScanDatasetFolderOverview>,
  createDatasetFolder: (input: CreateScanDatasetFolderInput): Promise<ScanDatasetFolder> => ipcRenderer.invoke(SCANNER_IPC.createDatasetFolder, input) as Promise<ScanDatasetFolder>,
  renameDatasetFolder: (input: RenameScanDatasetFolderInput): Promise<ScanDatasetFolder> => ipcRenderer.invoke(SCANNER_IPC.renameDatasetFolder, input) as Promise<ScanDatasetFolder>,
  deleteDatasetFolder: (payload: ScanDatasetFolderIdPayload): Promise<ScanDatasetFolderDeleteResult> => ipcRenderer.invoke(SCANNER_IPC.deleteDatasetFolder, payload) as Promise<ScanDatasetFolderDeleteResult>,
  moveDataset: (input: MoveScanDatasetInput): Promise<ScanDatasetFolderOverview> => ipcRenderer.invoke(SCANNER_IPC.moveDataset, input) as Promise<ScanDatasetFolderOverview>,
  getSourceCapabilities: (): Promise<ScannerSourceCapabilities> => ipcRenderer.invoke(SCANNER_IPC.getSourceCapabilities) as Promise<ScannerSourceCapabilities>,
  listTokenCredentials: (): Promise<ScannerTokenCredentialSummary[]> => ipcRenderer.invoke(SCANNER_IPC.listTokenCredentials) as Promise<ScannerTokenCredentialSummary[]>,
  createTokenCredential: (input: CreateScannerTokenCredentialInput): Promise<ScannerTokenCredentialSummary> => ipcRenderer.invoke(SCANNER_IPC.createTokenCredential, input) as Promise<ScannerTokenCredentialSummary>,
  validateTokenCredential: (payload: ScannerTokenCredentialIdPayload): Promise<ScannerTokenCredentialSummary> => ipcRenderer.invoke(SCANNER_IPC.validateTokenCredential, payload) as Promise<ScannerTokenCredentialSummary>
}

contextBridge.exposeInMainWorld('pageAutoScanner', api)
export type ScannerPreloadApi = typeof api
