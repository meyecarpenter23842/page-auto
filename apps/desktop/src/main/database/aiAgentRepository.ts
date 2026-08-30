import type Database from 'better-sqlite3'
import type { AiAgentCatalogView, AiAgentRecord, ParsedAiAgentImport } from '../../shared/aiAgents'

const AI_AGENT_CATALOG_STORAGE_KEY = 'ai.agent.catalog.v1'
const AI_AGENT_CATALOG_SCHEMA_VERSION = 1 as const

interface StoredCatalog {
  schemaVersion: typeof AI_AGENT_CATALOG_SCHEMA_VERSION
  agents: AiAgentRecord[]
  defaultAgentId: string | null
}

function emptyCatalog(): StoredCatalog {
  return { schemaVersion: AI_AGENT_CATALOG_SCHEMA_VERSION, agents: [], defaultAgentId: null }
}

function parseCatalog(value: string | undefined): StoredCatalog {
  if (!value) return emptyCatalog()
  try {
    const parsed = JSON.parse(value) as Partial<StoredCatalog>
    if (parsed.schemaVersion !== AI_AGENT_CATALOG_SCHEMA_VERSION || !Array.isArray(parsed.agents)) return emptyCatalog()
    const agents = parsed.agents.filter((agent): agent is AiAgentRecord => Boolean(
      agent
      && typeof agent === 'object'
      && typeof agent.id === 'string'
      && typeof agent.name === 'string'
      && typeof agent.model === 'string'
    ))
    const defaultAgentId = typeof parsed.defaultAgentId === 'string' && agents.some((agent) => agent.id === parsed.defaultAgentId)
      ? parsed.defaultAgentId
      : agents.find((agent) => agent.isDefault)?.id ?? agents.find((agent) => agent.enabled)?.id ?? null
    return {
      schemaVersion: AI_AGENT_CATALOG_SCHEMA_VERSION,
      agents: agents.map((agent) => ({ ...agent, isDefault: agent.id === defaultAgentId })),
      defaultAgentId
    }
  } catch {
    return emptyCatalog()
  }
}

export class AiAgentRepository {
  constructor(private readonly client: Database.Database) {}

  get(): StoredCatalog {
    const row = this.client.prepare('SELECT value FROM app_settings WHERE key = ?').get(AI_AGENT_CATALOG_STORAGE_KEY) as { value: string } | undefined
    return parseCatalog(row?.value)
  }

  view(credentialConfigured: boolean): AiAgentCatalogView {
    const catalog = this.get()
    return {
      agents: catalog.agents,
      defaultAgentId: catalog.defaultAgentId,
      credentialConfigured
    }
  }

  import(parsed: ParsedAiAgentImport, fileName: string): { importedCount: number; updatedCount: number; catalog: StoredCatalog } {
    const current = this.get()
    const byId = new Map(current.agents.map((agent) => [agent.id, agent]))
    let importedCount = 0
    let updatedCount = 0
    const now = Date.now()

    for (const agent of parsed.agents) {
      const previous = byId.get(agent.id)
      if (previous) updatedCount += 1
      else importedCount += 1
      byId.set(agent.id, {
        ...agent,
        sourceFileName: fileName,
        importedAt: now,
        enabled: previous?.enabled ?? true,
        isDefault: false
      })
    }

    const agents = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'vi'))
    let defaultAgentId = current.defaultAgentId && agents.some((agent) => agent.id === current.defaultAgentId && agent.enabled)
      ? current.defaultAgentId
      : null
    if (!defaultAgentId) defaultAgentId = agents.find((agent) => agent.enabled)?.id ?? null

    const next: StoredCatalog = {
      schemaVersion: AI_AGENT_CATALOG_SCHEMA_VERSION,
      defaultAgentId,
      agents: agents.map((agent) => ({ ...agent, isDefault: agent.id === defaultAgentId }))
    }
    this.persist(next)
    return { importedCount, updatedCount, catalog: next }
  }

  setEnabled(agentId: string, enabled: boolean): StoredCatalog {
    const current = this.get()
    if (!current.agents.some((agent) => agent.id === agentId)) throw new Error('Agent không tồn tại.')
    let defaultAgentId = current.defaultAgentId
    const agents = current.agents.map((agent) => agent.id === agentId ? { ...agent, enabled } : agent)
    if (!enabled && defaultAgentId === agentId) defaultAgentId = agents.find((agent) => agent.enabled)?.id ?? null
    if (enabled && !defaultAgentId) defaultAgentId = agentId
    const next: StoredCatalog = {
      schemaVersion: AI_AGENT_CATALOG_SCHEMA_VERSION,
      defaultAgentId,
      agents: agents.map((agent) => ({ ...agent, isDefault: agent.id === defaultAgentId }))
    }
    this.persist(next)
    return next
  }

  setDefault(agentId: string): StoredCatalog {
    const current = this.get()
    const target = current.agents.find((agent) => agent.id === agentId)
    if (!target) throw new Error('Agent không tồn tại.')
    if (!target.enabled) throw new Error('Bật Agent trước khi đặt làm mặc định.')
    const next: StoredCatalog = {
      schemaVersion: AI_AGENT_CATALOG_SCHEMA_VERSION,
      defaultAgentId: agentId,
      agents: current.agents.map((agent) => ({ ...agent, isDefault: agent.id === agentId }))
    }
    this.persist(next)
    return next
  }

  delete(agentId: string): StoredCatalog {
    const current = this.get()
    const agents = current.agents.filter((agent) => agent.id !== agentId)
    let defaultAgentId = current.defaultAgentId === agentId ? null : current.defaultAgentId
    if (defaultAgentId && !agents.some((agent) => agent.id === defaultAgentId && agent.enabled)) defaultAgentId = null
    if (!defaultAgentId) defaultAgentId = agents.find((agent) => agent.enabled)?.id ?? null
    const next: StoredCatalog = {
      schemaVersion: AI_AGENT_CATALOG_SCHEMA_VERSION,
      defaultAgentId,
      agents: agents.map((agent) => ({ ...agent, isDefault: agent.id === defaultAgentId }))
    }
    this.persist(next)
    return next
  }

  getEnabledById(agentId: string): AiAgentRecord {
    const agent = this.get().agents.find((item) => item.id === agentId)
    if (!agent) throw new Error('Agent không tồn tại.')
    if (!agent.enabled) throw new Error('Agent đang bị tắt.')
    return agent
  }

  private persist(catalog: StoredCatalog): void {
    this.client.prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
    `).run(AI_AGENT_CATALOG_STORAGE_KEY, JSON.stringify(catalog), Date.now())
  }
}
