import { dialog, ipcMain } from 'electron'
import type Database from 'better-sqlite3'
import { readFile, stat } from 'node:fs/promises'
import {
  AI_AGENT_IPC,
  type AiAgentEnabledPayload,
  type AiAgentIdPayload,
  type GenerateAiPostsInput
} from '../shared/aiAgents'
import { AI_API_IPC, type AiApiConnectionDraft, type AiApiDiscoveryInput, type AiApiTestInput } from '../shared/aiApiConnections'
import { AiApiConnectionService } from './services/aiApiConnectionService'
import { AiAgentRepository } from './database/aiAgentRepository'
import { AiGoogleCloudCredentialStore } from './services/aiGoogleCloudCredentialStore'
import { parseGoogleServiceAccountJson } from './services/googleServiceAccountCredential'
import { GoogleAgentRuntimeService } from './services/googleAgentRuntimeService'

const MAX_GOOGLE_CREDENTIAL_BYTES = 1024 * 1024

export interface AiAgentIpcRuntime {
  dispose: () => void
}

export function registerAiAgentIpcHandlers(database: Database.Database): AiAgentIpcRuntime {
  const agents = new AiAgentRepository(database)
  const credentials = new AiGoogleCloudCredentialStore(database)
  const runtime = new GoogleAgentRuntimeService(agents, credentials)
  const apis = new AiApiConnectionService(database)

  const view = () => agents.view(credentials.view())

  ipcMain.handle(AI_AGENT_IPC.catalog, () => view())
  ipcMain.handle(AI_API_IPC.list, () => apis.list())
  ipcMain.handle(AI_API_IPC.discover, (_event, payload: AiApiDiscoveryInput) => apis.discover(payload))
  ipcMain.handle(AI_API_IPC.test, (_event, payload: AiApiTestInput) => apis.test(payload))
  ipcMain.handle(AI_API_IPC.save, (_event, payload: AiApiConnectionDraft) => apis.save(payload))
  ipcMain.handle(AI_API_IPC.remove, (_event, id: string) => apis.remove(id))
  ipcMain.handle(AI_API_IPC.updateModel, (_event, payload: { id: string; modelId: string }) => apis.updateModel(payload.id, payload.modelId))
  ipcMain.handle(AI_API_IPC.setDefault, (_event, id: string) => apis.setDefault(id))

  ipcMain.handle(AI_AGENT_IPC.importJson, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Kết nối Google Agent Builder',
      properties: ['openFile'],
      filters: [{ name: 'Google Cloud service account', extensions: ['json'] }]
    })
    const filePath = result.canceled ? undefined : result.filePaths[0]
    if (!filePath) return null

    const fileStat = await stat(filePath)
    if (fileStat.size > MAX_GOOGLE_CREDENTIAL_BYTES) {
      throw new Error('File Google Cloud credential lớn hơn giới hạn 1 MB.')
    }

    const fileName = filePath.split(/[\\/]/).at(-1) ?? 'service-account.json'
    const raw = await readFile(filePath, 'utf8')
    const credential = parseGoogleServiceAccountJson(raw, fileName)
    credentials.save(credential)

    const remoteAgents = await runtime.syncAgents()
    const synced = agents.syncRemote(remoteAgents)
    const warnings = remoteAgents.length
      ? []
      : [
          'Đã kết nối Google Cloud nhưng chưa thấy Agent Runtime nào đã deploy trong project này.'
        ]

    return {
      catalog: view(),
      fileName,
      importedCount: synced.importedCount,
      updatedCount: synced.updatedCount,
      warnings
    }
  })

  ipcMain.handle(AI_AGENT_IPC.setEnabled, (_event, payload: AiAgentEnabledPayload) => {
    agents.setEnabled(payload.agentId, payload.enabled)
    return view()
  })

  ipcMain.handle(AI_AGENT_IPC.setDefault, (_event, payload: AiAgentIdPayload) => {
    agents.setDefault(payload.agentId)
    return view()
  })

  ipcMain.handle(AI_AGENT_IPC.delete, (_event, payload: AiAgentIdPayload) => {
    agents.delete(payload.agentId)
    return view()
  })

  ipcMain.handle(AI_AGENT_IPC.saveGeminiApiKey, () => {
    throw new Error(
      'Page-Auto không dùng Gemini API key cho Agent Builder. Hãy kết nối bằng Google Cloud service-account JSON.'
    )
  })

  ipcMain.handle(AI_AGENT_IPC.clearGeminiApiKey, () => {
    credentials.clear()
    agents.clear()
    return view()
  })

  ipcMain.handle(
    AI_AGENT_IPC.generatePosts,
    (_event, input: GenerateAiPostsInput) => input.agentId?.startsWith('api:') ? apis.generate(input) : runtime.generate(input)
  )

  return {
    dispose: () => {
      for (const channel of Object.values(AI_AGENT_IPC)) ipcMain.removeHandler(channel)
      for (const channel of Object.values(AI_API_IPC)) ipcMain.removeHandler(channel)
    }
  }
}
