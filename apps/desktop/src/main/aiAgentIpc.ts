import { dialog, ipcMain } from 'electron'
import type Database from 'better-sqlite3'
import { readFile, stat } from 'node:fs/promises'
import {
  AI_AGENT_IPC,
  parseAiAgentJson,
  type AiAgentEnabledPayload,
  type AiAgentIdPayload,
  type GenerateAiPostsInput,
  type SaveGeminiApiKeyInput
} from '../shared/aiAgents'
import { AiAgentRepository } from './database/aiAgentRepository'
import { AiGeminiSecretStore } from './services/aiGeminiSecretStore'
import { GeminiAiContentService } from './services/geminiAiContentService'

const MAX_AGENT_JSON_BYTES = 5 * 1024 * 1024

export interface AiAgentIpcRuntime {
  dispose: () => void
}

export function registerAiAgentIpcHandlers(database: Database.Database): AiAgentIpcRuntime {
  const agents = new AiAgentRepository(database)
  const secrets = new AiGeminiSecretStore(database)
  const generation = new GeminiAiContentService(agents, () => secrets.get())

  const view = () => agents.view(secrets.configured())

  ipcMain.handle(AI_AGENT_IPC.catalog, () => view())

  ipcMain.handle(AI_AGENT_IPC.importJson, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import Agent JSON',
      properties: ['openFile'],
      filters: [{ name: 'Agent JSON', extensions: ['json'] }]
    })
    const filePath = result.canceled ? undefined : result.filePaths[0]
    if (!filePath) return null

    const fileStat = await stat(filePath)
    if (fileStat.size > MAX_AGENT_JSON_BYTES) throw new Error('File Agent JSON lớn hơn giới hạn 5 MB.')

    const fileName = filePath.split(/[\\/]/).at(-1) ?? 'agent.json'
    const raw = await readFile(filePath, 'utf8')
    const parsed = parseAiAgentJson(fileName, raw)
    const imported = agents.import(parsed, fileName)

    return {
      catalog: view(),
      fileName,
      importedCount: imported.importedCount,
      updatedCount: imported.updatedCount,
      warnings: parsed.warnings
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

  ipcMain.handle(AI_AGENT_IPC.saveGeminiApiKey, (_event, input: SaveGeminiApiKeyInput) => {
    secrets.save(input.apiKey)
    return view()
  })

  ipcMain.handle(AI_AGENT_IPC.clearGeminiApiKey, () => {
    secrets.clear()
    return view()
  })

  ipcMain.handle(AI_AGENT_IPC.generatePosts, (_event, input: GenerateAiPostsInput) => generation.generate(input))

  return {
    dispose: () => {
      for (const channel of Object.values(AI_AGENT_IPC)) ipcMain.removeHandler(channel)
    }
  }
}
