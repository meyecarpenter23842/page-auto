import type { AccountStatus } from '../../../shared/accounts'
import type { BrowserSettings, NetworkSettings, SessionSettings } from '../../../shared/appSettings'
import type { ScanFieldMap } from '../../../shared/scanner'
import type { FacebookRuntimeAccount, FacebookRuntimeProxyConfig } from '../../facebook/facebookCommonRuntime'
import type { PageScanRawRecord } from './pageScanAdapter'

export interface PageScanWorkerJob {
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

export type PageScanWorkerCommand =
  | { type: 'start'; job: PageScanWorkerJob }
  | { type: 'pause'; runKey: string }
  | { type: 'resume'; runKey: string }
  | { type: 'stop'; runKey: string }
  | { type: 'shutdown' }

export interface PageScanWorkerSessionUpdate {
  sessionCookie: string | null
  accountName: string | null
  accountStatus: AccountStatus | null
}

export type PageScanWorkerEvent =
  | { type: 'ready' }
  | { type: 'record'; runKey: string; record: PageScanRawRecord }
  | ({ type: 'complete'; runKey: string } & PageScanWorkerSessionUpdate)
  | ({ type: 'terminal'; runKey: string; status: 'failed' | 'needs_attention'; message: string } & PageScanWorkerSessionUpdate)
