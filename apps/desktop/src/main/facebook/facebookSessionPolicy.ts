import type Database from 'better-sqlite3'
import type { AccountRecord } from '../../shared/accounts'
import type { AppSettings, RuntimeSettings } from '../../shared/appSettings'
import type { BrowserWindowPlacement } from '../../shared/browserWindowLayout'
import type { ActionExecutionSummary, ActionLogEvent, ActionRunRequest } from '../../shared/actionRuntime'
import { facebookSessionPolicyStateFromRuntimeState } from '../../shared/facebookSessionPolicy'
import type {
  ScenarioActionSessionAccount,
  ScenarioActionWorkerJob,
  ScenarioActionWorkerResult
} from '../../shared/scenarioActionWorker'
import { resolveFacebookProfileDirectory } from '../browser/facebookProfileResolver'
import { resolveAccountProxyState } from '../browser/proxyConfig'
import {
  ScenarioActionWorkerManager,
  type ScenarioActionSpecialHandler
} from '../browser/scenarioActionWorkerManager'
import { AccountRepository } from '../database/accountRepository'

export function canonicalScenarioActionSessionAccount(account: AccountRecord): ScenarioActionSessionAccount {
  return {
    id: account.id,
    uid: account.uid,
    username: account.username,
    password: account.password,
    cookie: account.cookie,
    twoFactorSecret: account.twoFactorSecret,
    name: account.name
  }
}

/**
 * Build only the immutable business/settings part of a Scenario/Workspace job.
 * Account-derived launch/session data is intentionally left as a placeholder and
 * must be resolved by FacebookCommonSessionPolicy immediately before execution.
 */
export function scenarioActionJobForCommonSessionPolicy(
  account: AccountRecord,
  request: ActionRunRequest,
  settings: AppSettings,
  browserPlacement?: BrowserWindowPlacement | null
): ScenarioActionWorkerJob {
  return {
    accountId: account.id,
    profileDirectory: '',
    browser: { ...settings.browser },
    session: { ...settings.session },
    network: { ...settings.network },
    sessionAccount: canonicalScenarioActionSessionAccount(account),
    request,
    ...(browserPlacement ? { browserPlacement } : {})
  }
}

/**
 * Main-process boundary for live Facebook account data.
 *
 * Run snapshots may freeze business config and account ordering, but secrets and
 * session material are live canonical data. Every action job is re-hydrated here
 * immediately before it is handed to an action worker so cookie/password/2FA,
 * profile path, proxy and User-Agent cannot silently stay stale from Start.
 */
export class FacebookCommonSessionPolicy {
  private readonly accounts: AccountRepository

  constructor(
    database: Database.Database,
    private readonly dataDirectory: string
  ) {
    this.accounts = new AccountRepository(database)
  }

  hydrateScenarioActionJob(job: ScenarioActionWorkerJob): ScenarioActionWorkerJob {
    const account = this.accounts.getById(job.accountId)
    if (!account) throw new Error(`Không tìm thấy account #${job.accountId} để chuẩn bị Facebook session.`)
    if (account.status === 'disabled') throw new Error(`Account #${job.accountId} đang bị tắt trong Account Manager.`)

    const profileDirectory = resolveFacebookProfileDirectory(this.dataDirectory, account, job.browser).profileDirectory
    const proxyResolution = resolveAccountProxyState(account)
    if (proxyResolution.status === 'invalid') throw new Error(proxyResolution.message)

    const { userAgent: _staleUserAgent, proxy: _staleProxy, ...baseJob } = job
    const actor = {
      ...job.request.actor,
      accountId: account.id,
      accountUid: account.uid
    }

    return {
      ...baseJob,
      accountId: account.id,
      profileDirectory,
      sessionAccount: canonicalScenarioActionSessionAccount(account),
      request: { ...job.request, actor },
      ...(account.userAgent ? { userAgent: account.userAgent } : {}),
      ...(proxyResolution.status === 'valid' ? { proxy: proxyResolution.proxy } : {})
    }
  }
}

function policyPreparationFailure(job: ScenarioActionWorkerJob, error: unknown): ScenarioActionWorkerResult {
  const now = Date.now()
  const message = error instanceof Error ? error.message : String(error)
  const summary: ActionExecutionSummary = {
    result: { status: 'failed', code: 'session_account_unavailable', message },
    normalizedConfig: null,
    attempts: 0,
    startedAt: now,
    finishedAt: now
  }
  return { summary, sessionCookie: null, accountName: null, sessionState: null, sessionPolicyState: null }
}

/**
 * Shared Scenario/Workspace action-worker host that enforces canonical credential
 * hydration before any special handler or browser worker sees the job.
 */
export class FacebookSessionPolicyWorkerManager extends ScenarioActionWorkerManager {
  private readonly sessionPolicy: FacebookCommonSessionPolicy

  constructor(
    database: Database.Database,
    dataDirectory: string,
    getRuntimeSettings: () => RuntimeSettings,
    specialHandler?: ScenarioActionSpecialHandler
  ) {
    super(getRuntimeSettings, specialHandler)
    this.sessionPolicy = new FacebookCommonSessionPolicy(database, dataDirectory)
  }

  override async run(
    job: ScenarioActionWorkerJob,
    onLog?: (event: ActionLogEvent) => void
  ): Promise<ScenarioActionWorkerResult> {
    let hydrated: ScenarioActionWorkerJob
    try {
      hydrated = this.sessionPolicy.hydrateScenarioActionJob(job)
    } catch (error) {
      return policyPreparationFailure(job, error)
    }
    const result = await super.run(hydrated, onLog)
    return {
      ...result,
      sessionPolicyState: result.sessionState
        ? facebookSessionPolicyStateFromRuntimeState(result.sessionState)
        : null
    }
  }
}
