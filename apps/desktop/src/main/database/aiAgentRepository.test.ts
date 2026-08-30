import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseAiAgentJson } from '../../shared/aiAgents'
import { initializeDatabase } from './index'
import { AiAgentRepository } from './aiAgentRepository'

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'page-auto-ai-agent-'))
  const runtime = initializeDatabase(join(directory, 'page-auto.sqlite'))
  return { runtime, repository: new AiAgentRepository(runtime.client) }
}

describe('AiAgentRepository', () => {
  it('persists imported agents and keeps a usable default across restart-like reads', () => {
    const { runtime, repository } = setup()
    const parsed = parseAiAgentJson('pack.json', JSON.stringify({ agents: [
      { id: 'one', name: 'Agent One', instructions: 'One', model: 'gemini-3.5-flash' },
      { id: 'two', name: 'Agent Two', instructions: 'Two', model: 'gemini-3.5-flash' }
    ] }))

    repository.import(parsed, 'pack.json')
    const first = repository.get()
    expect(first.agents).toHaveLength(2)
    expect(first.defaultAgentId).toBeTruthy()

    const defaultId = first.defaultAgentId!
    repository.setEnabled(defaultId, false)
    const afterDisable = repository.get()
    expect(afterDisable.defaultAgentId).not.toBe(defaultId)
    expect(afterDisable.agents.find((agent) => agent.id === defaultId)?.enabled).toBe(false)

    const reread = new AiAgentRepository(runtime.client).get()
    expect(reread).toEqual(afterDisable)
    runtime.close()
  })

  it('updates an imported Agent without duplicating it', () => {
    const { runtime, repository } = setup()
    const first = parseAiAgentJson('pack.json', JSON.stringify({ agents: [{ id: 'same', name: 'Agent', instructions: 'v1', model: 'gemini-3.5-flash' }] }))
    const second = parseAiAgentJson('pack.json', JSON.stringify({ agents: [{ id: 'same', name: 'Agent', instructions: 'v2', model: 'gemini-3.5-flash' }] }))

    expect(repository.import(first, 'pack.json')).toMatchObject({ importedCount: 1, updatedCount: 0 })
    expect(repository.import(second, 'pack.json')).toMatchObject({ importedCount: 0, updatedCount: 1 })
    expect(repository.get().agents).toHaveLength(1)
    expect(repository.get().agents[0]?.instructions).toBe('v2')
    runtime.close()
  })
})
