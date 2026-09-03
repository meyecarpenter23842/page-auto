import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_APP_SETTINGS } from '../../shared/appSettings'
import {
  FACEBOOK_LOGIN_RECOVERY_ORDER,
  facebookSessionPolicyAllowsAutoLogin,
  facebookSessionPolicyStateFromReason,
  facebookSessionPolicyStateFromRuntimeState,
  facebookSessionPolicyStopsFacebookActions
} from '../../shared/facebookSessionPolicy'
import type { ScenarioActionWorkerJob } from '../../shared/scenarioActionWorker'
import { AccountRepository } from '../database/accountRepository'
import { initializeDatabase } from '../database/index'
import { FacebookCommonSessionPolicy } from '../facebook/facebookSessionPolicy'

const tempDirectories: string[] = []
const runtimes: ReturnType<typeof initializeDatabase>[] = []

afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.close()
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('Issue #266 Common Session Policy', () => {
  it('standardizes VALID / LOGGED_OUT / CHECKPOINT without treating login 2FA as checkpoint', () => {
    expect(facebookSessionPolicyStateFromReason('valid')).toBe('VALID')
    expect(facebookSessionPolicyStateFromReason('checkpoint')).toBe('CHECKPOINT')
    for (const reason of ['login_required', 'login_failed', 'two_factor_missing', 'two_factor_failed', 'unknown'] as const) {
      expect(facebookSessionPolicyStateFromReason(reason)).toBe('LOGGED_OUT')
    }

    expect(facebookSessionPolicyStateFromRuntimeState('valid')).toBe('VALID')
    expect(facebookSessionPolicyStateFromRuntimeState('needs_login')).toBe('LOGGED_OUT')
    expect(facebookSessionPolicyStateFromRuntimeState('verification_required')).toBe('CHECKPOINT')
    expect(facebookSessionPolicyAllowsAutoLogin('LOGGED_OUT')).toBe(true)
    expect(facebookSessionPolicyAllowsAutoLogin('CHECKPOINT')).toBe(false)
    expect(facebookSessionPolicyStopsFacebookActions('CHECKPOINT')).toBe(true)
  })

  it('locks the common recovery order to cookie first, then identifier/password, then 2FA', () => {
    expect(FACEBOOK_LOGIN_RECOVERY_ORDER).toEqual(['COOKIE', 'IDENTIFIER_PASSWORD', 'TWO_FACTOR'])
  })

  it('re-hydrates an action job from the latest canonical account row instead of the Start snapshot', () => {
    const directory = mkdtempSync(join(tmpdir(), 'page-auto-session-policy-'))
    const profileRoot = join(directory, 'profiles')
    tempDirectories.push(directory)
    const runtime = initializeDatabase(join(directory, 'page-auto.sqlite'))
    runtimes.push(runtime)
    const accounts = new AccountRepository(runtime.client)
    const account = accounts.create({
      uid: '10001',
      username: 'old-user',
      password: 'old-pass',
      cookie: 'c_user=10001; xs=old',
      twoFactorSecret: 'OLD2FA',
      userAgent: 'old-agent',
      proxy: '127.0.0.1:8080:old:oldpass'
    })

    const browser = { ...DEFAULT_APP_SETTINGS.browser, externalProfileRoot: profileRoot }
    const snapshotJob: ScenarioActionWorkerJob = {
      accountId: account.id,
      profileDirectory: join(profileRoot, 'stale-profile'),
      browser,
      session: { ...DEFAULT_APP_SETTINGS.session },
      network: { ...DEFAULT_APP_SETTINGS.network },
      sessionAccount: {
        id: account.id,
        uid: account.uid,
        username: account.username,
        password: account.password,
        cookie: account.cookie,
        twoFactorSecret: account.twoFactorSecret,
        name: account.name
      },
      request: {
        runKey: 'issue-266-policy',
        actionType: 'view_newsfeed',
        label: 'Policy test',
        actor: { kind: 'profile', accountId: account.id, accountUid: account.uid },
        config: {}
      },
      ...(account.userAgent ? { userAgent: account.userAgent } : {}),
      proxy: { server: 'http://127.0.0.1:8080', username: 'old', password: 'oldpass' }
    }

    accounts.update(account.id, {
      username: 'fresh-user',
      password: 'fresh-pass',
      cookie: 'c_user=10001; xs=fresh',
      twoFactorSecret: 'FRESH2FA',
      userAgent: 'fresh-agent',
      proxy: '127.0.0.1:9090:fresh:freshpass'
    })

    const hydrated = new FacebookCommonSessionPolicy(runtime.client, directory).hydrateScenarioActionJob(snapshotJob)

    expect(hydrated.sessionAccount).toMatchObject({
      id: account.id,
      uid: '10001',
      username: 'fresh-user',
      password: 'fresh-pass',
      cookie: 'c_user=10001; xs=fresh',
      twoFactorSecret: 'FRESH2FA'
    })
    expect(hydrated.userAgent).toBe('fresh-agent')
    expect(hydrated.proxy).toEqual({
      server: 'http://127.0.0.1:9090',
      username: 'fresh',
      password: 'freshpass'
    })
    expect(hydrated.profileDirectory).toBe(join(profileRoot, '10001'))
    expect(hydrated.request.actor.accountUid).toBe('10001')
    expect(snapshotJob.sessionAccount.password).toBe('old-pass')
    expect(snapshotJob.sessionAccount.cookie).toContain('xs=old')
  })
})
