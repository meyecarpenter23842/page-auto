import { ipcMain } from 'electron'
import type Database from 'better-sqlite3'
import { AI_AGENT_IPC, type GenerateAiPostsInput } from '../shared/aiAgents'
import {
  AI_API_IPC, type AiApiConnectionDraft, type AiApiDiscoveryInput, type AiApiTestInput
} from '../shared/aiApiConnections'
import { AiApiConnectionService } from './services/aiApiConnectionService'

export interface AiAgentIpcRuntime {
  dispose: () => void
}

/**
 * API-only AI runtime. No Google Agent Builder handlers, remote agent discovery,
 * service-account access or fallback execution are registered.
 */
export function registerAiAgentIpcHandlers(database: Database.Database): AiAgentIpcRuntime {
  const apis = new AiApiConnectionService(database)

  ipcMain.handle(AI_API_IPC.list, () => apis.list())
  ipcMain.handle(AI_API_IPC.discover, (_event, payload: AiApiDiscoveryInput) => apis.discover(payload))
  ipcMain.handle(AI_API_IPC.test, (_event, payload: AiApiTestInput) => apis.test(payload))
  ipcMain.handle(AI_API_IPC.save, (_event, payload: AiApiConnectionDraft) => apis.save(payload))
  ipcMain.handle(AI_API_IPC.remove, (_event, id: string) => apis.remove(id))
  ipcMain.handle(AI_API_IPC.updateModel, (_event, payload: { id: string; modelId: string }) => apis.updateModel(payload.id, payload.modelId))
  ipcMain.handle(AI_API_IPC.setDefault, (_event, id: string) => apis.setDefault(id))
  ipcMain.handle(AI_AGENT_IPC.generatePosts, (_event, input: GenerateAiPostsInput) => {
    if (typeof input?.agentId !== 'string' || !input.agentId.startsWith('api:')) {
      throw new Error('Google Agent Builder đã được gỡ khỏi Page-Auto. Hãy chọn kết nối API trong Quản lý AI.')
    }
    return apis.generate(input)
  })

  return {
    dispose: () => {
      ipcMain.removeHandler(AI_AGENT_IPC.generatePosts)
      for (const channel of Object.values(AI_API_IPC)) ipcMain.removeHandler(channel)
    }
  }
}
