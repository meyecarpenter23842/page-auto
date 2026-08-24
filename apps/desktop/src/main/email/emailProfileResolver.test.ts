import { createServer, type Server } from 'node:http'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectEmailProfile, resolveEmailProfileDirectory } from './emailProfileResolver'

const created: string[] = []
const servers: Server[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>((resolve) => server.close(() => resolve()))
  for (const path of created.splice(0)) await rm(path, { recursive: true, force: true })
})

async function startCdpProbeServer(): Promise<number> {
  const server = createServer((request, response) => {
    if (request.url === '/json/version') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('{"Browser":"Chromium"}')
      return
    }
    response.writeHead(404)
    response.end()
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Không lấy được test CDP port.')
  return address.port
}

describe('email profile resolver', () => {
  it('resolves exactly root/UID and never scans or creates a missing profile', async () => {
    const root = await mkdtemp(join(tmpdir(), 'page-auto-hotmail-'))
    created.push(root)
    expect(resolveEmailProfileDirectory(root, '10001')).toBe(join(root, '10001'))
    expect(resolveEmailProfileDirectory(root, '../escape')).toBeNull()
    expect((await inspectEmailProfile(root, '10001')).status).toBe('missing')
  })

  it('treats a stale DevToolsActivePort as available instead of running', async () => {
    const root = await mkdtemp(join(tmpdir(), 'page-auto-hotmail-'))
    created.push(root)
    const profile = join(root, '10002')
    await mkdir(profile)
    await writeFile(join(profile, 'DevToolsActivePort'), '9\n/devtools/browser/old\n')
    expect(await inspectEmailProfile(root, '10002')).toMatchObject({ status: 'available', cdpEndpoint: null })
  })

  it('recognizes a live CDP profile and keeps locked stale profiles in-use', async () => {
    const root = await mkdtemp(join(tmpdir(), 'page-auto-hotmail-'))
    created.push(root)
    const liveProfile = join(root, '10003')
    await mkdir(liveProfile)
    const port = await startCdpProbeServer()
    await writeFile(join(liveProfile, 'DevToolsActivePort'), `${port}\n/devtools/browser/id\n`)
    expect(await inspectEmailProfile(root, '10003')).toMatchObject({ status: 'running', cdpEndpoint: `http://127.0.0.1:${port}` })

    const lockedProfile = join(root, '10004')
    await mkdir(lockedProfile)
    await writeFile(join(lockedProfile, 'DevToolsActivePort'), '9\n/devtools/browser/old\n')
    await writeFile(join(lockedProfile, 'SingletonLock'), '')
    expect(await inspectEmailProfile(root, '10004')).toMatchObject({ status: 'in_use', cdpEndpoint: null })
  })
})
