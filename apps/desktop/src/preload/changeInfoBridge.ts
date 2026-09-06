import { contextBridge, ipcRenderer } from 'electron'
import {
  CHANGE_INFO_AUDIT_IPC,
  type ChangeInfoAuditApi,
  type ChangeInfoBioAuditPayload
} from '../shared/changeInfoAudit'
import {
  ACTION_WORKSPACE_IPC,
  type ActionWorkspacePresetApi,
  type ActionWorkspacePresetIdPayload,
  type ActionWorkspacePresetListPayload,
  type SaveActionWorkspacePresetInput
} from '../shared/actionWorkspaces'

export type ChangeInfoPreloadApi = ActionWorkspacePresetApi & ChangeInfoAuditApi

const changeInfoApi: ChangeInfoPreloadApi = {
  listPresets: (payload: ActionWorkspacePresetListPayload) => ipcRenderer.invoke(ACTION_WORKSPACE_IPC.presetList, payload),
  savePreset: (input: SaveActionWorkspacePresetInput) => ipcRenderer.invoke(ACTION_WORKSPACE_IPC.presetSave, input),
  deletePreset: (payload: ActionWorkspacePresetIdPayload) => ipcRenderer.invoke(ACTION_WORKSPACE_IPC.presetDelete, payload),
  pickTextFile: () => ipcRenderer.invoke(ACTION_WORKSPACE_IPC.pickTextFile),
  pickFolder: () => ipcRenderer.invoke(ACTION_WORKSPACE_IPC.pickFolder),
  auditBio: (payload: ChangeInfoBioAuditPayload) => ipcRenderer.invoke(CHANGE_INFO_AUDIT_IPC.bio, payload)
}

contextBridge.exposeInMainWorld('pageAutoChangeInfo', changeInfoApi)
