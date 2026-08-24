import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { EmailProfileResolver } from './emailProfileResolver'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'page-auto-hotmail-'))
  roots.push(value)
  return value
}

describe('EmailProfileResolver', () => {
  it('resolves root/UID without creating a missing profile', async () => {
    const profileRoot = await root()
    const resolver = new EmailProfileResolver(() => profileRoot)
    const inspection = await resolver.inspect('61560799655329')
    expect(inspection.status).toBe('missing')
    expect(inspection.profileDirectory).toBe(join(profileRoot, '61560799655329'))
  })

  it('detects an available external profile and a running CDP profile', async () => {
    const profileRoot = await root()
    const profile = join(profileRoot, '10001')
    await mkdir(profile)
    const resolver = new EmailProfileResolver(() => profileRoot)
    expect((await resolver.inspect('10001')).status).toBe('available')
    await writeFile(join(profile, 'DevToolsActivePort'), '9222\n/devtools/browser/test\n')
    const running = await resolver.inspect('10001')
    expect(running.status).toBe('running')
    expect(running.cdpEndpoint).toBe('http://127.0.0.1:9222')
  })

  it('refuses a locked profile without a CDP endpoint', async () => {
    const profileRoot = await root()
    const profile = join(profileRoot, '10002')
    await mkdir(profile)
    await writeFile(join(profile, 'SingletonLock'), 'locked')
    const resolver = new EmailProfileResolver(() => profileRoot)
    expect((await resolver.inspect('10002')).status).toBe('in_use')
  })
})
