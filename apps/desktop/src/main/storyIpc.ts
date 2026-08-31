import { dialog, ipcMain } from 'electron'
import type Database from 'better-sqlite3'
import {
  STORY_IPC,
  type CreateStoryInput,
  type UpdateStoryInput
} from '../shared/story'
import { StoryRepository } from './database/storyRepository'

export interface StoryIpcRuntime {
  dispose: () => void
}

export function registerStoryIpcHandlers(database: Database.Database): StoryIpcRuntime {
  const stories = new StoryRepository(database)

  ipcMain.handle(STORY_IPC.list, () => stories.list())
  ipcMain.handle(STORY_IPC.create, (_event, input: CreateStoryInput) => stories.create(input))
  ipcMain.handle(STORY_IPC.update, (_event, input: UpdateStoryInput) => stories.update(input))
  ipcMain.handle(STORY_IPC.pickMediaFile, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Chọn ảnh hoặc video cho Story',
      properties: ['openFile'],
      filters: [
        { name: 'Ảnh / video', extensions: ['jpg', 'jpeg', 'png', 'webp', 'mp4', 'mov', 'm4v', 'webm'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  ipcMain.handle(STORY_IPC.pickMediaFolder, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Chọn folder ảnh / video cho Story',
      properties: ['openDirectory']
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  return {
    dispose: () => {
      for (const channel of Object.values(STORY_IPC)) ipcMain.removeHandler(channel)
    }
  }
}
