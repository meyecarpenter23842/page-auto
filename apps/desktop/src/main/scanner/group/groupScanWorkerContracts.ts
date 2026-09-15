import type { AccountStatus } from '../../../shared/accounts'
import type { BrowserSettings, NetworkSettings, SessionSettings } from '../../../shared/appSettings'
import type { ScanFieldMap } from '../../../shared/scanner'
import type { FacebookRuntimeAccount, FacebookRuntimeProxyConfig } from '../../facebook/facebookCommonRuntime'
import type { GroupScanRawRecord } from './groupScanAdapter'

export interface GroupScanWorkerJob {
  runKey: string
  accountId: number
  profileDirectory: string
  browser: BrowserSettings
  session: SessionSettings
  network: NetworkSettings
  sessionAccount: FacebookRuntimeAccount
  query: string
  filters: ScanFieldMap
  limit: number
  userAgent?: string
  proxy?: FacebookRuntimeProxyConfig
}

export type GroupScanWorkerCommand =
  | { type: 'start'; job: GroupScanWorkerJob }
  | { type: 'pause'; runKey: string }
  | { type: 'resume'; runKey: string }
  | { type: 'stop'; runKey: string }
  | { type: 'shutdown' }

export interface GroupScanWorkerSessionUpdate {
  sessionCookie: string | null
  accountName: string | null
  accountStatus: AccountStatus | null
}

export type GroupScanWorkerEvent =
  | { type: 'ready' }
  | { type: 'record'; runKey: string; record: GroupScanRawRecord }
  | ({ type: 'complete'; runKey: string } & GroupScanWorkerSessionUpdate)
  | ({ type: 'terminal'; runKey: string; status: 'failed' | 'needs_attention'; message: string } & GroupScanWorkerSessionUpdate)
