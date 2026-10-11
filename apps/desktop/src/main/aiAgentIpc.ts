import { dialog, ipcMain } from 'electron'
import { readFile, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import type Database from 'better-sqlite3'
import { AI_AGENT_IPC, type GenerateAiPostsInput } from '../shared/aiAgents'
import {
  AI_API_IPC, type AiApiConnectionDraft, type AiApiDiscoveryInput, type AiApiTestInput
} from '../shared/aiApiConnections'
import { AiApiConnectionService } from './services/aiApiConnectionService'
import { AI_IMAGE_IPC, MAX_IMAGE_SOURCE_BYTES, type GenerateAiImagesInput, type SaveAiImagesInput } from '../shared/aiImages'
import { saveAiImageFiles } from './services/aiImageService'

export interface AiAgentIpcRuntime {
  dispose: () => void
}

/**
 * API-only AI runtime. No Google Agent Builder handlers, remote agent discovery,
 * service-account access or fallback execution are registered.
 */
export function registerAiAgentIpcHandlers(database: Database.Database): AiAgentIpcRuntime {
  const apis = new AiApiConnectionService(database)
  const activeTests = new Map<string, AbortController>()
  const outputFolders = new Map<number,string>()
  const activeImageRequests = new Set<number>()

  ipcMain.handle(AI_API_IPC.list, () => apis.list())
  ipcMain.handle(AI_API_IPC.discover, (_event, payload: AiApiDiscoveryInput) => apis.discover(payload))
  ipcMain.handle(AI_API_IPC.test, async (event, payload: AiApiTestInput) => {
    const requestId = payload?.requestId
    // Older callers can still test without a cancellation identity.
    if (requestId === undefined) return apis.test(payload)
    if (typeof requestId !== 'string' || !/^[a-z0-9._-]{1,80}$/i.test(requestId)) {
      throw new Error('Mã yêu cầu kiểm tra Model không hợp lệ.')
    }
    const key = `${event.sender.id}:${requestId}`
    if (activeTests.has(key)) throw new Error('Yêu cầu kiểm tra Model đang chạy.')
    const controller = new AbortController()
    activeTests.set(key, controller)
    try {
      return await apis.test(payload, controller.signal)
    } finally {
      activeTests.delete(key)
    }
  })
  ipcMain.handle(AI_API_IPC.cancelTest, (event, requestId: string) => {
    if (typeof requestId !== 'string' || !/^[a-z0-9._-]{1,80}$/i.test(requestId)) return false
    const key = `${event.sender.id}:${requestId}`
    const controller = activeTests.get(key)
    if (!controller) return false
    controller.abort()
    return true
  })
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

  ipcMain.handle(AI_IMAGE_IPC.pickSource, async () => {
    const chosen = await dialog.showOpenDialog({
      title:'Chọn ảnh đầu vào cho AI',properties:['openFile'],
      filters:[{name:'Ảnh PNG, JPEG, WEBP',extensions:['png','jpg','jpeg','webp']}]
    })
    const path = chosen.filePaths[0]
    if (chosen.canceled || !path) return null
    const info = await stat(path)
    if (!info.isFile() || !info.size || info.size > MAX_IMAGE_SOURCE_BYTES) {
      throw new Error('Ảnh đầu vào phải nhỏ hơn 10 MB.')
    }
    const bytes = await readFile(path)
    if (!bytes.length || bytes.length > MAX_IMAGE_SOURCE_BYTES) {
      throw new Error('Ảnh đầu vào phải nhỏ hơn 10 MB.')
    }
    const extension = extname(path).toLowerCase()
    const mime = extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg'
    // Signature and MIME validation is repeated by the service before sending.
    return {name:basename(path),dataUrl:'data:'+mime+';base64,'+bytes.toString('base64')}
  })
  ipcMain.handle(AI_IMAGE_IPC.chooseFolder, async (event) => {
    const chosen = await dialog.showOpenDialog({title:'Chọn ổ đĩa hoặc thư mục lưu ảnh AI',properties:['openDirectory','createDirectory']})
    const path = chosen.filePaths[0]
    if (chosen.canceled || !path) return null
    outputFolders.set(event.sender.id,path)
    return path
  })
  ipcMain.handle(AI_IMAGE_IPC.generate, async (event,input: GenerateAiImagesInput) => {
    const owner = event.sender.id
    if (activeImageRequests.has(owner)) throw new Error('Đang tạo ảnh. Vui lòng chờ lượt hiện tại.')
    activeImageRequests.add(owner)
    try { return await apis.generateImages(input) }
    finally { activeImageRequests.delete(owner) }
  })
  ipcMain.handle(AI_IMAGE_IPC.save, async (event,input: SaveAiImagesInput) => {
    const folder = outputFolders.get(event.sender.id)
    if (!folder) throw new Error('Chọn thư mục lưu ảnh trước khi lưu.')
    return saveAiImageFiles(folder,input)
  })

  return {
    dispose: () => {
      for (const controller of activeTests.values()) controller.abort()
      activeTests.clear()
      outputFolders.clear()
      activeImageRequests.clear()
      for (const channel of Object.values(AI_IMAGE_IPC)) ipcMain.removeHandler(channel)
      ipcMain.removeHandler(AI_AGENT_IPC.generatePosts)
      for (const channel of Object.values(AI_API_IPC)) ipcMain.removeHandler(channel)
    }
  }
}
