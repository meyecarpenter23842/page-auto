import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { RemoteAgentDescriptor } from '../../shared/aiAgents'
import { initializeDatabase } from './index'
import { AiAgentRepository } from './aiAgentRepository'

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'page-auto-ai-agent-'))
  const runtime = initializeDatabase(join(directory, 'page-auto.sqlite'))
  return { runtime, repository: new AiAgentRepository(runtime.client) }
}

function remote(id: string, location = 'us-central1'): RemoteAgentDescriptor {
  return {
    resourceName: `projects/project-a/locations/${location}/reasoningEngines/${id}`,
    displayName: `Agent ${id}`,
    description: `Description ${id}`,
    projectId: 'project-a',
    location
  }
}

describe('AiAgentRepository', () => {
  it('persists Agent Runtime sync and keeps a usable default', () => {
    const { runtime, repository } = setup()

    const first = repository.syncRemote([remote('one'), remote('two')])
    expect(first.importedCount).toBe(2)
    expect(first.updatedCount).toBe(0)
    expect(first.catalog.agents).toHaveLength(2)
    expect(first.catalog.defaultAgentId).toBeTruthy()

    const defaultId = first.catalog.defaultAgentId!
    repository.setEnabled(defaultId, false)
    const afterDisable = repository.get()
    expect(afterDisable.defaultAgentId).not.toBe(defaultId)
    expect(afterDisable.agents.find((agent) => agent.id === defaultId)?.enabled).toBe(false)

    const reread = new AiAgentRepository(runtime.client).get()
    expect(reread).toEqual(afterDisable)
    runtime.close()
  })

  it('refreshes existing remote Agents without duplicating them', () => {
    const { runtime, repository } = setup()

    expect(repository.syncRemote([remote('same')])).toMatchObject({
      importedCount: 1,
      updatedCount: 0
    })
    expect(repository.syncRemote([{
      ...remote('same'),
      displayName: 'Agent renamed'
    }])).toMatchObject({
      importedCount: 0,
      updatedCount: 1
    })

    const current = repository.get()
    expect(current.agents).toHaveLength(1)
    expect(current.agents[0]?.name).toBe('Agent renamed')
    runtime.close()
  })

  it('clears the local Agent catalog when the cloud connection is removed', () => {
    const { runtime, repository } = setup()
    repository.syncRemote([remote('one')])
    repository.clear()
    expect(repository.get().agents).toEqual([])
    expect(repository.get().defaultAgentId).toBeNull()
    runtime.close()
  })
})
