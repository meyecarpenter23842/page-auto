import { contextBridge, ipcRenderer } from 'electron'
import {
  ACTION_WORKSPACE_IPC,
  type ActionWorkspacePresetApi,
  type ActionWorkspacePresetIdPayload,
  type ActionWorkspacePresetListPayload,
  type SaveActionWorkspacePresetInput
} from '../shared/actionWorkspaces'

const changeInfoApi: ActionWorkspacePresetApi = {
  listPresets: (payload: ActionWorkspacePresetListPayload) => ipcRenderer.invoke(ACTION_WORKSPACE_IPC.presetList, payload),
  savePreset: (input: SaveActionWorkspacePresetInput) => ipcRenderer.invoke(ACTION_WORKSPACE_IPC.presetSave, input),
  deletePreset: (payload: ActionWorkspacePresetIdPayload) => ipcRenderer.invoke(ACTION_WORKSPACE_IPC.presetDelete, payload),
  pickTextFile: () => ipcRenderer.invoke(ACTION_WORKSPACE_IPC.pickTextFile),
  pickFolder: () => ipcRenderer.invoke(ACTION_WORKSPACE_IPC.pickFolder)
}

contextBridge.exposeInMainWorld('pageAutoChangeInfo', changeInfoApi)
export type ChangeInfoPreloadApi = typeof changeInfoApi
