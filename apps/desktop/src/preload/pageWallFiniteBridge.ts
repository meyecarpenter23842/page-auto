import { contextBridge, ipcRenderer } from 'electron'
import {
  PAGE_WALL_FINITE_IPC,
  type PageWallFiniteApi,
  type PageWallFinitePagePayload,
  type PageWallFinitePlanIdPayload,
  type PageWallFiniteRunNowPayload,
  type SavePageWallFinitePlanPayload
} from '../shared/pageWallFiniteRuntime'

const pageWallFinite: PageWallFiniteApi = {
  getDashboard: (payload: PageWallFinitePagePayload) => ipcRenderer.invoke(PAGE_WALL_FINITE_IPC.dashboard, payload),
  runNow: (payload: PageWallFiniteRunNowPayload) => ipcRenderer.invoke(PAGE_WALL_FINITE_IPC.runNow, payload),
  savePlan: (payload: SavePageWallFinitePlanPayload) => ipcRenderer.invoke(PAGE_WALL_FINITE_IPC.savePlan, payload),
  deletePlan: (payload: PageWallFinitePlanIdPayload) => ipcRenderer.invoke(PAGE_WALL_FINITE_IPC.deletePlan, payload)
}

contextBridge.exposeInMainWorld('pageWallFinite', pageWallFinite)
export type PageWallFinitePreloadApi = typeof pageWallFinite
