import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectEmailProfile, resolveEmailProfileDirectory } from './emailProfileResolver'

const created: string[] = []
afterEach(async () => { for (const path of created.splice(0)) await rm(path, { recursive: true, force: true }) })

describe('email profile resolver', () => {
  it('resolves exactly root/UID and never scans or creates a missing profile', async () => {
    const root = await mkdtemp(join(tmpdir(), 'page-auto-hotmail-'))
    created.push(root)
    expect(resolveEmailProfileDirectory(root, '10001')).toBe(join(root, '10001'))
    expect(resolveEmailProfileDirectory(root, '../escape')).toBeNull()
    expect((await inspectEmailProfile(root, '10001')).status).toBe('missing')
  })

  it('recognizes an available and a CDP-running profile', async () => {
    const root = await mkdtemp(join(tmpdir(), 'page-auto-hotmail-'))
    created.push(root)
    const profile = join(root, '10002')
    await mkdir(profile)
    expect((await inspectEmailProfile(root, '10002')).status).toBe('available')
    await writeFile(join(profile, 'DevToolsActivePort'), '9222\n/devtools/browser/id\n')
    expect(await inspectEmailProfile(root, '10002')).toMatchObject({ status: 'running', cdpEndpoint: 'http://127.0.0.1:9222' })
  })
})
