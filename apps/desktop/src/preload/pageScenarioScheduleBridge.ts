import { contextBridge, ipcRenderer } from 'electron'
import {
  PAGE_SCENARIO_SCHEDULE_IPC,
  type PageScenarioPagePayload,
  type PageScenarioPlanIdsPayload,
  type PageScenarioScheduleApi,
  type SavePageScenarioSchedulePayload,
  type SetPageScenarioScheduleEnabledPayload
} from '../shared/pageScenarioSchedule'

const pageScenarioSchedule: PageScenarioScheduleApi = {
  getDashboard: (payload: PageScenarioPagePayload) => ipcRenderer.invoke(PAGE_SCENARIO_SCHEDULE_IPC.dashboard, payload),
  saveSchedule: (payload: SavePageScenarioSchedulePayload) => ipcRenderer.invoke(PAGE_SCENARIO_SCHEDULE_IPC.saveSchedule, payload),
  deleteSchedule: (payload: PageScenarioPlanIdsPayload) => ipcRenderer.invoke(PAGE_SCENARIO_SCHEDULE_IPC.deleteSchedule, payload),
  setScheduleEnabled: (payload: SetPageScenarioScheduleEnabledPayload) => ipcRenderer.invoke(PAGE_SCENARIO_SCHEDULE_IPC.setScheduleEnabled, payload)
}

contextBridge.exposeInMainWorld('pageScenarioSchedule', pageScenarioSchedule)
export type PageScenarioSchedulePreloadApi = typeof pageScenarioSchedule
