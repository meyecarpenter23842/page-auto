import type { AccountStatus } from '../../../shared/accounts'
import type { BrowserSettings, NetworkSettings, SessionSettings } from '../../../shared/appSettings'
import type { FacebookRuntimeAccount, FacebookRuntimeProxyConfig } from '../../facebook/facebookCommonRuntime'
import type { GroupMembersScanRawRecord } from './groupMembersScanAdapter'
import type { GroupMembersTarget } from './groupMembersScanSupport'

export interface GroupMembersScanWorkerJob {
  runKey: string
  accountId: number
  profileDirectory: string
  browser: BrowserSettings
  session: SessionSettings
  network: NetworkSettings
  sessionAccount: FacebookRuntimeAccount
  groups: GroupMembersTarget[]
  limit: number
  userAgent?: string
  proxy?: FacebookRuntimeProxyConfig
}

export type GroupMembersScanWorkerCommand =
  | { type: 'start'; job: GroupMembersScanWorkerJob }
  | { type: 'pause'; runKey: string }
  | { type: 'resume'; runKey: string }
  | { type: 'stop'; runKey: string }
  | { type: 'shutdown' }

export interface GroupMembersScanWorkerSessionUpdate {
  sessionCookie: string | null
  accountName: string | null
  accountStatus: AccountStatus | null
}

export type GroupMembersScanWorkerEvent =
  | { type: 'ready' }
  | { type: 'record'; runKey: string; record: GroupMembersScanRawRecord }
  | ({ type: 'complete'; runKey: string } & GroupMembersScanWorkerSessionUpdate)
  | ({ type: 'terminal'; runKey: string; status: 'failed' | 'needs_attention'; message: string } & GroupMembersScanWorkerSessionUpdate)
