import { contextBridge, ipcRenderer } from 'electron'
import {
  SCANNER_IPC,
  type SaveScanDatasetInput,
  type ScanDatasetDetails,
  type ScanDatasetIdPayload,
  type ScanDatasetSummary,
  type ScanJobDetails,
  type ScanJobIdPayload,
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
  saveDataset: (input: SaveScanDatasetInput): Promise<ScanDatasetDetails> => ipcRenderer.invoke(SCANNER_IPC.saveDataset, input) as Promise<ScanDatasetDetails>
}

contextBridge.exposeInMainWorld('pageAutoScanner', api)
export type ScannerPreloadApi = typeof api
