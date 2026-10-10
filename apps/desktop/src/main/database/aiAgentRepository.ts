import type Database from 'better-sqlite3'
import {
  AI_AGENT_PROVIDER,
  type AiAgentCatalogView,
  type AiAgentRecord,
  type GoogleCloudCredentialView,
  type RemoteAgentDescriptor
} from '../../shared/aiAgents'

const AI_AGENT_CATALOG_STORAGE_KEY = 'ai.agent.catalog.v2'
const AI_AGENT_CATALOG_SCHEMA_VERSION = 2 as const

interface StoredCatalog {
  schemaVersion: typeof AI_AGENT_CATALOG_SCHEMA_VERSION
  agents: AiAgentRecord[]
  defaultAgentId: string | null
  lastSyncAt: number | null
}

function emptyCatalog(): StoredCatalog {
  return {
    schemaVersion: AI_AGENT_CATALOG_SCHEMA_VERSION,
    agents: [],
    defaultAgentId: null,
    lastSyncAt: null
  }
}

function parseCatalog(value: string | undefined): StoredCatalog {
  if (!value) return emptyCatalog()
  try {
    const parsed = JSON.parse(value) as Partial<StoredCatalog>
    if (
      parsed.schemaVersion !== AI_AGENT_CATALOG_SCHEMA_VERSION
      || !Array.isArray(parsed.agents)
    ) {
      return emptyCatalog()
    }

    const agents = parsed.agents.filter((agent): agent is AiAgentRecord => Boolean(
      agent
      && typeof agent === 'object'
      && agent.provider === AI_AGENT_PROVIDER
      && typeof agent.id === 'string'
      && typeof agent.providerId === 'string'
      && typeof agent.name === 'string'
      && typeof agent.projectId === 'string'
      && typeof agent.location === 'string'
    ))

    const defaultAgentId = typeof parsed.defaultAgentId === 'string'
      && agents.some((agent) => agent.id === parsed.defaultAgentId && agent.enabled)
      ? parsed.defaultAgentId
      : agents.find((agent) => agent.isDefault && agent.enabled)?.id
        ?? agents.find((agent) => agent.enabled)?.id
        ?? null

    return {
      schemaVersion: AI_AGENT_CATALOG_SCHEMA_VERSION,
      agents: agents.map((agent) => ({ ...agent, isDefault: agent.id === defaultAgentId })),
      defaultAgentId,
      lastSyncAt: typeof parsed.lastSyncAt === 'number' ? parsed.lastSyncAt : null
    }
  } catch {
    return emptyCatalog()
  }
}

function toRecord(remote: RemoteAgentDescriptor, previous: AiAgentRecord | undefined, now: number): AiAgentRecord {
  return {
    id: remote.resourceName,
    provider: AI_AGENT_PROVIDER,
    providerId: remote.resourceName,
    name: remote.displayName || remote.resourceName.split('/').at(-1) || 'Agent Builder',
    description: remote.description,
    instructions: '',
    model: 'Agent Builder',
    tools: [],
    inputFields: [],
    enabled: previous?.enabled ?? true,
    isDefault: false,
    sourceFileName: 'Google Cloud Agent Runtime',
    sourceFormat: 'reasoning-engine',
    importedAt: now,
    projectId: remote.projectId,
    location: remote.location
  }
}

export class AiAgentRepository {
  constructor(private readonly client: Database.Database) {}

  get(): StoredCatalog {
    const row = this.client.prepare(
      'SELECT value FROM app_settings WHERE key = ?'
    ).get(AI_AGENT_CATALOG_STORAGE_KEY) as { value: string } | undefined
    return parseCatalog(row?.value)
  }

  view(credential: GoogleCloudCredentialView): AiAgentCatalogView {
    const catalog = this.get()
    return {
      agents: catalog.agents,
      defaultAgentId: catalog.defaultAgentId,
      credentialConfigured: credential.configured,
      projectId: credential.projectId,
      serviceAccountEmail: credential.serviceAccountEmail,
      lastSyncAt: catalog.lastSyncAt
    }
  }

  syncRemote(remoteAgents: readonly RemoteAgentDescriptor[]): {
    importedCount: number
    updatedCount: number
    catalog: StoredCatalog
  } {
    const current = this.get()
    const previousByProviderId = new Map(current.agents.map((agent) => [agent.providerId, agent]))
    const now = Date.now()
    let importedCount = 0
    let updatedCount = 0

    const agents = remoteAgents
      .map((remote) => {
        const previous = previousByProviderId.get(remote.resourceName)
        if (previous) updatedCount += 1
        else importedCount += 1
        return toRecord(remote, previous, now)
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'vi'))

    let defaultAgentId = current.defaultAgentId
      && agents.some((agent) => agent.id === current.defaultAgentId && agent.enabled)
      ? current.defaultAgentId
      : null
    if (!defaultAgentId) defaultAgentId = agents.find((agent) => agent.enabled)?.id ?? null

    const next: StoredCatalog = {
      schemaVersion: AI_AGENT_CATALOG_SCHEMA_VERSION,
      agents: agents.map((agent) => ({ ...agent, isDefault: agent.id === defaultAgentId })),
      defaultAgentId,
      lastSyncAt: now
    }
    this.persist(next)
    return { importedCount, updatedCount, catalog: next }
  }

  setEnabled(agentId: string, enabled: boolean): StoredCatalog {
    const current = this.get()
    if (!current.agents.some((agent) => agent.id === agentId)) {
      throw new Error('Agent không tồn tại.')
    }

    let defaultAgentId = current.defaultAgentId
    const agents = current.agents.map((agent) => (
      agent.id === agentId ? { ...agent, enabled } : agent
    ))
    if (!enabled && defaultAgentId === agentId) {
      defaultAgentId = agents.find((agent) => agent.enabled)?.id ?? null
    }
    if (enabled && !defaultAgentId) defaultAgentId = agentId

    const next: StoredCatalog = {
      ...current,
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
      ...current,
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
    if (defaultAgentId && !agents.some((agent) => agent.id === defaultAgentId && agent.enabled)) {
      defaultAgentId = null
    }
    if (!defaultAgentId) defaultAgentId = agents.find((agent) => agent.enabled)?.id ?? null

    const next: StoredCatalog = {
      ...current,
      defaultAgentId,
      agents: agents.map((agent) => ({ ...agent, isDefault: agent.id === defaultAgentId }))
    }
    this.persist(next)
    return next
  }

  clear(): StoredCatalog {
    this.client.prepare('DELETE FROM app_settings WHERE key = ?').run(AI_AGENT_CATALOG_STORAGE_KEY)
    return emptyCatalog()
  }

  getEnabledById(agentId: string): AiAgentRecord {
    const agent = this.get().agents.find((item) => item.id === agentId)
    if (!agent) throw new Error('Agent không tồn tại. Hãy kết nối lại Agent Builder.')
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
