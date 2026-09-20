import type Database from 'better-sqlite3'
import { dialog, ipcMain } from 'electron'
import { existsSync } from 'node:fs'
import { isIP } from 'node:net'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import type { AccountRecord } from '../shared/accounts'
import {
  PROXY_BUILDER_IPC,
  type ProxyBuilderAuditInput,
  type ProxyBuilderCheckerStartInput,
  type ProxyBuilderProvisionInput,
  type ProxyBuilderRunIdPayload,
  type ProxyBuilderRuntimeControlInput,
  type ProxyCenterAccountBinding,
  type ProxyCenterAccountIdsInput,
  type ProxyCenterAssignInput,
  type ProxyCenterInventoryDeleteInput,
  type ProxyCenterInventoryRecord,
  type ProxyCenterInventoryUpsertInput
} from '../shared/proxyBuilder'
import { AccountRepository } from './database/accountRepository'
import { ProxyCenterInventoryRepository } from './database/proxyInventoryRepository'
import { ProxyBuilderCheckerService, checkProxyLineNow, parseProxyLine } from './proxyBuilder/checkerService'
import { ProxyBuilderProvisionService } from './proxyBuilder/provisionService'
import { auditProxyBuilderVps } from './proxyBuilder/sshDiscoveryService'

export interface ProxyBuilderIpcRuntime { dispose: () => void }

function endpointKey(host: string, port: number, username: string | null | undefined): string {
  return host.trim().toLowerCase() + ':' + port + ':' + (username?.trim() ?? '')
}

function displayHost(host: string): string {
  return host.includes(':') ? '[' + host + ']' : host
}

function configuredAccountEndpoint(account: AccountRecord): { key: string | null; maskedProxy: string } | null {
  const proxyType = account.proxyType?.trim().toLowerCase().replace(/:\/\/$/, '').replace(/:$/, '') ?? ''
  const host = account.proxyHost?.trim()
  const port = account.proxyPort
  if (host && Number.isInteger(port) && port && port > 0 && port <= 65535) {
    const username = account.proxyUsername?.trim() || null
    const maskedProxy = displayHost(host) + ':' + port + (username ? ':' + username + ':••••' : '')
    return {
      key: proxyType && proxyType !== 'http' ? null : endpointKey(host, port, username),
      maskedProxy
    }
  }

  const raw = account.proxy?.trim()
  if (!raw) return null
  if (proxyType && proxyType !== 'http') return { key: null, maskedProxy: 'Proxy ' + proxyType.toUpperCase() + ' đã cấu hình' }
  try {
    const parsed = parseProxyLine(raw)
    return {
      key: endpointKey(parsed.host, parsed.port, parsed.username),
      maskedProxy: parsed.maskedProxy
    }
  } catch {
    return { key: null, maskedProxy: 'Proxy đã cấu hình (ngoài kho HTTP)' }
  }
}

function decorateInventory(
  records: ProxyCenterInventoryRecord[],
  accounts: AccountRecord[]
): ProxyCenterInventoryRecord[] {
  const counts = new Map<string, number>()
  for (const account of accounts) {
    const endpoint = configuredAccountEndpoint(account)
    if (!endpoint?.key) continue
    counts.set(endpoint.key, (counts.get(endpoint.key) ?? 0) + 1)
  }

  return records.map((record) => ({
    ...record,
    assignedAccountCount: counts.get(endpointKey(record.host, record.port, record.username)) ?? 0
  }))
}

function bindingSnapshot(
  accounts: AccountRecord[],
  inventory: ProxyCenterInventoryRecord[]
): ProxyCenterAccountBinding[] {
  const inventoryByKey = new Map(
    inventory.map((record) => [endpointKey(record.host, record.port, record.username), record] as const)
  )
  const endpoints = accounts.map((account) => ({
    account,
    endpoint: configuredAccountEndpoint(account)
  }))
  const counts = new Map<string, number>()
  for (const item of endpoints) {
    if (!item.endpoint?.key) continue
    counts.set(item.endpoint.key, (counts.get(item.endpoint.key) ?? 0) + 1)
  }

  return endpoints.map(({ account, endpoint }) => {
    const matched = endpoint?.key ? inventoryByKey.get(endpoint.key) : undefined
    return {
      accountId: account.id,
      uid: account.uid,
      name: account.name,
      category: account.category,
      accountStatus: account.status,
      inventoryId: matched?.id ?? null,
      inventoryStatus: matched?.status ?? null,
      maskedProxy: endpoint?.maskedProxy ?? null,
      duplicateBindingCount: endpoint?.key ? counts.get(endpoint.key) ?? 0 : 0
    }
  })
}

export function registerProxyBuilderIpc(database: Database.Database): ProxyBuilderIpcRuntime {
  const provision = new ProxyBuilderProvisionService()
  const checker = new ProxyBuilderCheckerService()
  const inventory = new ProxyCenterInventoryRepository(database)
  const accounts = new AccountRepository(database)

  const listInventory = () => decorateInventory(inventory.list(), accounts.list())
  const listBindings = () => bindingSnapshot(accounts.list(), listInventory())

  for (const channel of Object.values(PROXY_BUILDER_IPC)) ipcMain.removeHandler(channel)

  ipcMain.handle(PROXY_BUILDER_IPC.pickPrivateKey, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Chọn SSH Private Key',
      properties: ['openFile']
    })
    const path = result.filePaths[0]
    if (result.canceled || !path) return { cancelled: true }
    return { cancelled: false, path, fileName: basename(path) }
  })
  ipcMain.handle(PROXY_BUILDER_IPC.pickOciConfig, async () => {
    const defaultPath = join(homedir(), '.oci', 'config')
    const result = await dialog.showOpenDialog({
      title: 'Chọn OCI config',
      ...(existsSync(defaultPath) ? { defaultPath } : {}),
      properties: ['openFile']
    })
    const path = result.filePaths[0]
    if (result.canceled || !path) return { cancelled: true }
    return { cancelled: false, path, fileName: basename(path) }
  })
  ipcMain.handle(PROXY_BUILDER_IPC.auditVps, (_event, input: ProxyBuilderAuditInput) => auditProxyBuilderVps(input))
  ipcMain.handle(PROXY_BUILDER_IPC.provisionStart, (_event, input: ProxyBuilderProvisionInput) => provision.start(input))
  ipcMain.handle(PROXY_BUILDER_IPC.provisionStatus, (_event, payload: ProxyBuilderRunIdPayload) => provision.status(payload))
  ipcMain.handle(PROXY_BUILDER_IPC.provisionCancel, (_event, payload: ProxyBuilderRunIdPayload) => provision.cancel(payload))
  ipcMain.handle(PROXY_BUILDER_IPC.runtimeControl, (_event, input: ProxyBuilderRuntimeControlInput) => provision.controlRuntime(input))
  ipcMain.handle(PROXY_BUILDER_IPC.checkerStart, (_event, input: ProxyBuilderCheckerStartInput) => checker.start(input))
  ipcMain.handle(PROXY_BUILDER_IPC.checkerStatus, (_event, payload: ProxyBuilderRunIdPayload) => checker.status(payload))
  ipcMain.handle(PROXY_BUILDER_IPC.checkerCancel, (_event, payload: ProxyBuilderRunIdPayload) => checker.cancel(payload))

  ipcMain.handle(PROXY_BUILDER_IPC.inventoryList, () => listInventory())
  ipcMain.handle(PROXY_BUILDER_IPC.inventoryUpsert, (_event, input: ProxyCenterInventoryUpsertInput) => {
    const result = inventory.upsert(input)
    return { ...result, records: listInventory() }
  })
  ipcMain.handle(PROXY_BUILDER_IPC.inventoryDelete, (_event, input: ProxyCenterInventoryDeleteInput) => inventory.delete(input.ids))
  ipcMain.handle(PROXY_BUILDER_IPC.inventoryCheck, async (_event, input: ProxyCenterInventoryDeleteInput) => {
    const ids = [...new Set(input.ids.filter((id) => Number.isInteger(id) && id > 0))]
    let cursor = 0
    const worker = async () => {
      while (cursor < ids.length) {
        const id = ids[cursor]
        cursor += 1
        if (!id) continue
        const secret = inventory.getSecret(id)
        if (!secret) continue
        const checked = await checkProxyLineNow(secret.rawProxy, 12_000, 1)
        inventory.applyCheck(id, {
          live: checked.live,
          outboundIp: checked.outboundIp,
          ipFamily: checked.outboundIp
            ? isIP(checked.outboundIp) === 6 ? 'ipv6' : 'ipv4'
            : 'unknown',
          latencyMs: checked.latencyMs,
          error: checked.error
        })
      }
    }
    await Promise.all(Array.from({ length: Math.min(20, ids.length) }, () => worker()))
    return listInventory()
  })

  ipcMain.handle(PROXY_BUILDER_IPC.accountBindingsList, () => listBindings())
  ipcMain.handle(PROXY_BUILDER_IPC.accountBindingsAssign, (_event, input: ProxyCenterAssignInput) => {
    const secret = inventory.getSecret(input.proxyId)
    if (!secret) throw new Error('Proxy trong kho không còn tồn tại.')
    const accountIds = [...new Set(input.accountIds.filter((id) => Number.isInteger(id) && id > 0))]
    if (!accountIds.length) return listBindings()

    const assign = database.transaction(() => {
      for (const accountId of accountIds) {
        if (!accounts.getById(accountId)) throw new Error('Account #' + accountId + ' không còn tồn tại.')
        accounts.update(accountId, {
          proxy: secret.rawProxy,
          proxyType: 'http',
          proxyHost: secret.host,
          proxyPort: secret.port,
          proxyUsername: secret.username,
          proxyPassword: secret.password
        })
      }
    })
    assign()
    return listBindings()
  })
  ipcMain.handle(PROXY_BUILDER_IPC.accountBindingsClear, (_event, input: ProxyCenterAccountIdsInput) => {
    const accountIds = [...new Set(input.accountIds.filter((id) => Number.isInteger(id) && id > 0))]
    if (!accountIds.length) return listBindings()

    const clear = database.transaction(() => {
      for (const accountId of accountIds) {
        if (!accounts.getById(accountId)) throw new Error('Account #' + accountId + ' không còn tồn tại.')
        accounts.update(accountId, {
          proxy: null,
          proxyType: null,
          proxyHost: null,
          proxyPort: null,
          proxyUsername: null,
          proxyPassword: null
        })
      }
    })
    clear()
    return listBindings()
  })

  return {
    dispose: () => {
      checker.dispose()
      provision.dispose()
      for (const channel of Object.values(PROXY_BUILDER_IPC)) ipcMain.removeHandler(channel)
    }
  }
}
