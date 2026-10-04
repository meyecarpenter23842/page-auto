import { access } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { BrowserContext, CDPSession } from 'playwright-core'
import type { CaptchaBrowserRuntimeState, CaptchaProviderRuntimeConfig } from './captchaRuntime'

interface ExtensionInfo {
  id: string
  name: string
  version: string
  path: string
  enabled: boolean
}

interface LooseCdpSession {
  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>
}

function normalizePath(value: string): string {
  return resolve(value).replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase()
}

function isManagedExtensionPath(path: string, root: string): boolean {
  const candidate = normalizePath(path)
  const managedRoot = normalizePath(root)
  return candidate === managedRoot || candidate.startsWith(`${managedRoot}/`)
}

async function readStorage(
  cdp: LooseCdpSession,
  extensionId: string,
  keys: string[]
): Promise<Record<string, unknown>> {
  const result = await cdp.send<{ data?: Record<string, unknown> }>('Extensions.getStorageItems', {
    id: extensionId,
    storageArea: 'local',
    keys
  })
  return result.data ?? {}
}

async function writeStorage(
  cdp: LooseCdpSession,
  extensionId: string,
  values: Record<string, unknown>
): Promise<void> {
  await cdp.send('Extensions.setStorageItems', {
    id: extensionId,
    storageArea: 'local',
    values
  })
}

async function configureOmoCaptcha(
  cdp: LooseCdpSession,
  extensionId: string,
  apiKey: string
): Promise<void> {
  await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 250))
  await writeStorage(cdp, extensionId, { api_key: apiKey })
  const readback = await readStorage(cdp, extensionId, ['api_key'])
  if (readback.api_key !== apiKey) {
    throw new Error('OmoCaptcha không xác nhận API key sau khi cấu hình extension.')
  }
}

async function configureTwoCaptcha(
  cdp: LooseCdpSession,
  extensionId: string,
  apiKey: string
): Promise<void> {
  const stored = await readStorage(cdp, extensionId, ['config'])
  const current = stored.config && typeof stored.config === 'object'
    ? stored.config as Record<string, unknown>
    : {}
  await writeStorage(cdp, extensionId, { config: { ...current, apiKey } })

  const readback = await readStorage(cdp, extensionId, ['config'])
  const config = readback.config && typeof readback.config === 'object'
    ? readback.config as Record<string, unknown>
    : {}
  if (config.apiKey !== apiKey) {
    throw new Error('2Captcha không xác nhận API key sau khi cấu hình extension.')
  }
}

async function waitForExtensionWorker(
  context: BrowserContext,
  extensionId: string,
  timeoutMs = 5_000
) {
  const prefix = `chrome-extension://${extensionId}/`
  const deadline = Date.now() + timeoutMs
  while (Date.now() <= deadline) {
    const worker = context.serviceWorkers().find((item) => item.url().startsWith(prefix))
    if (worker) return worker
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 100))
  }
  return null
}

async function configureEzCaptcha(
  context: BrowserContext,
  cdp: LooseCdpSession,
  extensionId: string,
  apiKey: string
): Promise<void> {
  const stored = await readStorage(cdp, extensionId, ['settings'])
  const current = stored.settings && typeof stored.settings === 'object'
    ? stored.settings as Record<string, unknown>
    : {}
  await writeStorage(cdp, extensionId, {
    settings: { ...current, key: apiKey, enabled: true }
  })

  const worker = await waitForExtensionWorker(context, extensionId)
  if (!worker) {
    throw new Error('EZCaptcha chưa khởi tạo background service worker để nhận cấu hình.')
  }

  const runtimeResult = await worker.evaluate(async ({ key }) => {
    const chromeApi = (globalThis as unknown as {
      chrome?: {
        runtime?: {
          sendMessage?: (
            message: unknown,
            callback?: (response?: unknown) => void
          ) => void
          lastError?: { message?: string }
        }
      }
    }).chrome
    const runtime = chromeApi?.runtime
    if (!runtime?.sendMessage) return { ok: false, error: 'runtime_unavailable' }

    return await new Promise<{ ok: boolean; error?: string }>((resolveMessage) => {
      runtime.sendMessage?.(
        { className: 'Settings', method: 'set', args: [{ key, enabled: true }] },
        () => {
          const error = chromeApi?.runtime?.lastError?.message
          resolveMessage(error ? { ok: false, error } : { ok: true })
        }
      )
    })
  }, { key: apiKey })

  if (!runtimeResult.ok) {
    throw new Error(`EZCaptcha Settings.set thất bại: ${runtimeResult.error ?? 'unknown'}`)
  }

  const readback = await readStorage(cdp, extensionId, ['settings'])
  const settings = readback.settings && typeof readback.settings === 'object'
    ? readback.settings as Record<string, unknown>
    : {}
  if (settings.key !== apiKey || settings.enabled !== true) {
    throw new Error('EZCaptcha không xác nhận API key/enabled sau khi cấu hình extension.')
  }
}

async function configureProvider(
  context: BrowserContext,
  cdp: LooseCdpSession,
  extensionId: string,
  config: CaptchaProviderRuntimeConfig
): Promise<void> {
  if (config.provider === 'omocaptcha') {
    await configureOmoCaptcha(cdp, extensionId, config.apiKey)
    return
  }
  if (config.provider === '2captcha') {
    await configureTwoCaptcha(cdp, extensionId, config.apiKey)
    return
  }
  await configureEzCaptcha(context, cdp, extensionId, config.apiKey)
}

export async function configureManagedCaptchaExtension(
  context: BrowserContext,
  state: CaptchaBrowserRuntimeState
): Promise<{ provider: string | null; extensionId: string | null }> {
  const browser = context.browser()
  if (!browser) throw new Error('Không lấy được Browser CDP session để cấu hình CAPTCHA extension.')

  const session = await browser.newBrowserCDPSession()
  const cdp = session as unknown as LooseCdpSession

  try {
    const listed = await cdp.send<{ extensions?: ExtensionInfo[] }>('Extensions.getExtensions')
    const extensions = listed.extensions ?? []
    const managed = extensions.filter((extension) =>
      isManagedExtensionPath(extension.path, state.managedExtensionRoot)
    )
    const active = state.active

    if (!active) {
      for (const extension of managed) {
        await cdp.send('Extensions.uninstall', { id: extension.id })
      }
      return { provider: null, extensionId: null }
    }

    await access(resolve(active.extensionDirectory, 'manifest.json')).catch(() => {
      throw new Error(
        `Thiếu extension asset cho ${active.provider}: ${active.extensionDirectory}. `
        + 'Thư mục provider phải là extension unpacked và có manifest.json.'
      )
    })

    for (const extension of managed) {
      if (normalizePath(extension.path) === normalizePath(active.extensionDirectory)) continue
      await cdp.send('Extensions.uninstall', { id: extension.id })
    }

    const existing = extensions.find((extension) =>
      normalizePath(extension.path) === normalizePath(active.extensionDirectory)
    )
    const extensionId = existing?.id ?? (await cdp.send<{ id?: string }>('Extensions.loadUnpacked', {
      path: resolve(active.extensionDirectory),
      enableInIncognito: false
    })).id

    if (!extensionId) {
      throw new Error(`${active.provider} không trả extension ID sau khi load.`)
    }

    await configureProvider(context, cdp, extensionId, active)
    return { provider: active.provider, extensionId }
  } finally {
    await (session as CDPSession).detach().catch(() => undefined)
  }
}
