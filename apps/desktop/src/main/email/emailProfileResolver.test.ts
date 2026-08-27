import { createServer, type Server } from 'node:http'
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ensureEmailProfileDirectory,
  inspectEmailProfile,
  resolveEmailProfileDirectory,
  validateEmailProfileRoot
} from './emailProfileResolver'

const created: string[] = []
const servers: Server[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
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
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Không lấy được test CDP port.')
  return address.port
}

describe('email profile resolver', () => {
  it('resolves exactly root/UID and keeps inspection read-only for a missing profile', async () => {
    const root = await mkdtemp(join(tmpdir(), 'page-auto-hotmail-'))
    created.push(root)
    expect(resolveEmailProfileDirectory(root, '10001')).toBe(join(root, '10001'))
    expect(resolveEmailProfileDirectory(root, '../escape')).toBeNull()
    expect((await inspectEmailProfile(root, '10001')).status).toBe('missing')
    await expect(stat(join(root, '10001'))).rejects.toThrow()
  })

  it('creates exactly root/UID on demand and reuses an existing profile directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'page-auto-hotmail-create-'))
    created.push(root)
    const expected = join(root, '10004')

    expect(await ensureEmailProfileDirectory(root, '10004')).toBe(expected)
    expect((await stat(expected)).isDirectory()).toBe(true)
    await writeFile(join(expected, 'marker.txt'), 'keep')

    expect(await ensureEmailProfileDirectory(root, '10004')).toBe(expected)
    expect((await stat(join(expected, 'marker.txt'))).isFile()).toBe(true)
    await expect(ensureEmailProfileDirectory(root, '../escape')).rejects.toThrow(/UID không hợp lệ/)
  })

  it('requires an existing absolute Email Profile Root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'page-auto-hotmail-root-'))
    created.push(root)
    expect(await validateEmailProfileRoot(root)).toBe(resolve(root))
    await expect(validateEmailProfileRoot('relative/profiles')).rejects.toThrow(/tuyệt đối/)
    await expect(validateEmailProfileRoot(join(root, 'missing'))).rejects.toThrow(/không tồn tại/)
  })

  it('treats stale CDP metadata as launchable instead of trusting a leftover lock marker', async () => {
    const root = await mkdtemp(join(tmpdir(), 'page-auto-hotmail-'))
    created.push(root)
    const profile = join(root, '10002')
    await mkdir(profile)
    await writeFile(join(profile, 'DevToolsActivePort'), '9\n/devtools/browser/old\n')
    await writeFile(join(profile, 'SingletonLock'), 'leftover-marker')
    expect(await inspectEmailProfile(root, '10002')).toMatchObject({ status: 'available', cdpEndpoint: null })
  })

  it('recognizes a live CDP profile', async () => {
    const root = await mkdtemp(join(tmpdir(), 'page-auto-hotmail-'))
    created.push(root)
    const liveProfile = join(root, '10003')
    await mkdir(liveProfile)
    const port = await startCdpProbeServer()
    await writeFile(join(liveProfile, 'DevToolsActivePort'), `${port}\n/devtools/browser/id\n`)
    expect(await inspectEmailProfile(root, '10003')).toMatchObject({ status: 'running', cdpEndpoint: `http://127.0.0.1:${port}` })
  })
})
