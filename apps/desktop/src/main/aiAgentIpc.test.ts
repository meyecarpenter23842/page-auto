import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initializeDatabase } from './database'

const mock = vi.hoisted(() => {
  const handlers = new Map<string, (_event: unknown, payload?: unknown) => unknown>()
  return { handlers }
})
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, callback: (_event: unknown, payload?: unknown) => unknown) => {
      mock.handlers.set(channel, callback)
    }),
    removeHandler: vi.fn((channel: string) => mock.handlers.delete(channel))
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString('utf8')
  }
}))
import { registerAiAgentIpcHandlers } from './aiAgentIpc'

const dirs: string[] = []
afterEach(() => {
  mock.handlers.clear()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('AI API-only IPC registration', () => {
  it('does not expose Google Agent Builder credentials, discovery or legacy execution', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'page-auto-no-agent-runtime-'))
    dirs.push(directory)
    const database = initializeDatabase(join(directory, 'page-auto.sqlite'))
    const handlers = registerAiAgentIpcHandlers(database.client)
    try {
      expect(mock.handlers.has('ai-agent:import-json')).toBe(false)
      expect(mock.handlers.has('ai-agent:catalog')).toBe(false)
      expect(mock.handlers.has('ai-agent:set-enabled')).toBe(false)
      expect(mock.handlers.has('ai-agent:set-default')).toBe(false)
      expect(mock.handlers.has('ai-agent:clear-gemini-api-key')).toBe(false)
      expect(mock.handlers.has('ai-api:discover')).toBe(true)
      expect(mock.handlers.has('ai-api:list')).toBe(true)
      const generate = mock.handlers.get('ai-agent:generate-posts')
      expect(generate).toBeDefined()
      expect(() => generate?.({}, { agentId: 'old-google-agent-123' })).toThrow('đã được gỡ')
      expect(mock.handlers.size).toBe(8)
    } finally {
      handlers.dispose()
      expect(mock.handlers.size).toBe(0)
      database.close()
    }
  })
})
