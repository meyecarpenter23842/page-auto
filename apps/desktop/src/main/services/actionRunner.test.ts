import { describe, expect, it } from 'vitest'
import {
  createDefaultActionConfig,
  getActionDefinition,
  type ActionResult
} from '../../shared/actionRegistry'
import { applyK433GroupInteractionActionOverrides } from '../../shared/k433GroupInteractionActionOverrides'
import type { ActionPreparationResult, ActionRunRequest } from '../../shared/actionRuntime'
import {
  ActionExecutorRegistry,
  ActionRunner,
  type ActionPreparationContext,
  type ActionPreparationHost,
  type ActionRunControl
} from './actionRunner'

class ReadyHost implements ActionPreparationHost {
  calls = 0
  async prepare(_context: ActionPreparationContext): Promise<ActionPreparationResult> {
    this.calls += 1
    return { status: 'ready' }
  }
}

const profileRequest: ActionRunRequest = {
  runKey: 'run-1',
  actionType: 'view_newsfeed',
  label: 'View newsfeed',
  actor: { kind: 'profile', accountId: 7, accountUid: '10007' },
  config: {}
}

function immediateControl(): ActionRunControl {
  return {
    isStopped: () => false,
    waitIfPaused: async () => undefined,
    sleep: async () => undefined
  }
}

describe('ActionRunner', () => {
  it('validates config, prepares actor once and runs a registered executor', async () => {
    const host = new ReadyHost()
    const executors = new ActionExecutorRegistry()
    let receivedDuration = 0
    executors.register({
      actionType: 'view_newsfeed',
      execute: async (_context, config): Promise<ActionResult> => {
        receivedDuration = Number(config.durationSeconds)
        return { status: 'success', message: 'ok' }
      }
    })
    const events: string[] = []
    const runner = new ActionRunner(host, executors, (event) => { events.push(event.stage) })

    const summary = await runner.run(profileRequest, immediateControl())

    expect(summary.result.status).toBe('success')
    expect(summary.attempts).toBe(1)
    expect(receivedDuration).toBe(15)
    expect(host.calls).toBe(1)
    expect(events).toContain('preparing_actor')
    expect(events).toContain('executing')
  })

  it('rejects persisted config that violates action override rules before Facebook preparation', async () => {
    applyK433GroupInteractionActionOverrides()
    const definition = getActionDefinition('group_interaction')
    expect(definition).toBeTruthy()
    const config = createDefaultActionConfig(definition!)
    for (const key of [
      'reactionLike',
      'reactionLove',
      'reactionCare',
      'reactionHaha',
      'reactionWow',
      'reactionSad',
      'reactionAngry'
    ]) config[key] = false
    config.shareGroupEnabled = true
    config.shareGroupWhitelist = ''

    const host = new ReadyHost()
    const executors = new ActionExecutorRegistry()
    let executorCalls = 0
    executors.register({
      actionType: 'group_interaction',
      execute: async (): Promise<ActionResult> => {
        executorCalls += 1
        return { status: 'success', message: 'unexpected' }
      }
    })
    const runner = new ActionRunner(host, executors)
    const summary = await runner.run({
      ...profileRequest,
      actionType: 'group_interaction',
      label: 'Tương tác nhóm',
      config
    }, immediateControl())

    expect(summary.result).toMatchObject({ status: 'failed', code: 'action_config_invalid' })
    expect(summary.result.message).toContain('Loại cảm xúc')
    expect(summary.result.message).toContain('Whitelist nhóm đích khi chia sẻ')
    expect(summary.attempts).toBe(0)
    expect(host.calls).toBe(0)
    expect(executorCalls).toBe(0)
  })

  it('blocks unsupported actor before preparing Facebook runtime', async () => {
    const host = new ReadyHost()
    const executors = new ActionExecutorRegistry()
    const runner = new ActionRunner(host, executors)
    const summary = await runner.run({
      ...profileRequest,
      actionType: 'send_friend_request',
      actor: { kind: 'page', accountId: 7, accountUid: '10007', pageUid: '90001' }
    })

    expect(summary.result).toMatchObject({ status: 'skipped', code: 'action_actor_unsupported' })
    expect(host.calls).toBe(0)
  })

  it('returns a clear placeholder result when executor is not implemented yet', async () => {
    const host = new ReadyHost()
    const runner = new ActionRunner(host, new ActionExecutorRegistry())
    const summary = await runner.run(profileRequest)

    expect(summary.result).toMatchObject({ status: 'skipped', code: 'action_not_implemented' })
    expect(host.calls).toBe(0)
    expect(summary.attempts).toBe(0)
  })

  it('retries only explicitly retryable failed codes', async () => {
    const host = new ReadyHost()
    const executors = new ActionExecutorRegistry()
    let calls = 0
    executors.register({
      actionType: 'view_newsfeed',
      execute: async (): Promise<ActionResult> => {
        calls += 1
        return calls === 1
          ? { status: 'failed', code: 'network_timeout', message: 'temporary' }
          : { status: 'success', message: 'ok' }
      }
    })
    const runner = new ActionRunner(host, executors)
    const summary = await runner.run({
      ...profileRequest,
      retry: { maxAttempts: 2, delayMs: 0, retryableCodes: ['network_timeout'] }
    }, immediateControl())

    expect(summary.result.status).toBe('success')
    expect(summary.attempts).toBe(2)
    expect(calls).toBe(2)
  })

  it('stops before session preparation when runtime is cancelled', async () => {
    const host = new ReadyHost()
    const executors = new ActionExecutorRegistry()
    executors.register({
      actionType: 'view_newsfeed',
      execute: async (): Promise<ActionResult> => ({ status: 'success', message: 'unexpected' })
    })
    const runner = new ActionRunner(host, executors)
    const summary = await runner.run(profileRequest, {
      isStopped: () => true,
      waitIfPaused: async () => undefined,
      sleep: async () => undefined
    })

    expect(summary.result).toMatchObject({ status: 'stopped', code: 'action_stopped' })
    expect(host.calls).toBe(0)
  })
})
