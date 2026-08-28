import {
  getActionDefinition,
  validateActionConfig,
  type ActionConfig,
  type ActionResult
} from '../../shared/actionRegistry'
import {
  actionRuntimeResult,
  type ActionExecutionSummary,
  type ActionLogEvent,
  type ActionLogLevel,
  type ActionPreparationContext,
  type ActionPreparationHost,
  type ActionPreparationResult,
  type ActionRetryPolicy,
  type ActionRunControl,
  type ActionRunRequest
} from '../../shared/actionRuntime'
import { redactExecutionText } from './executionLogSanitizer'

export type { ActionPreparationContext, ActionPreparationHost, ActionRunControl } from '../../shared/actionRuntime'

export interface ActionExecutorContext {
  request: ActionRunRequest
  attempt: number
  control: ActionRunControl
  log(level: ActionLogLevel, message: string, code?: string, data?: Record<string, unknown>): void
}

export interface ActionExecutor {
  actionType: string
  execute(context: ActionExecutorContext, config: ActionConfig): Promise<ActionResult>
}

export type ActionLogSink = (event: ActionLogEvent) => void | Promise<void>

const DEFAULT_RETRY_POLICY: ActionRetryPolicy = {
  maxAttempts: 1,
  delayMs: 0,
  retryableCodes: []
}

const DEFAULT_CONTROL: ActionRunControl = {
  isStopped: () => false,
  waitIfPaused: async () => undefined,
  sleep: async (delayMs) => {
    if (delayMs <= 0) return
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs))
  }
}

function normalizeRetryPolicy(input: ActionRunRequest['retry']): ActionRetryPolicy {
  const maxAttempts = Math.min(3, Math.max(1, Math.floor(input?.maxAttempts ?? DEFAULT_RETRY_POLICY.maxAttempts)))
  const delayMs = Math.min(60_000, Math.max(0, Math.floor(input?.delayMs ?? DEFAULT_RETRY_POLICY.delayMs)))
  return {
    maxAttempts,
    delayMs,
    retryableCodes: input?.retryableCodes ?? DEFAULT_RETRY_POLICY.retryableCodes
  }
}

const secretKeyPattern = /(password|cookie|2fa|token|secret|credential|passphrase|otp|proxy[_ .-]?pass(?:word)?)/i

function safeMessage(value: string | undefined, fallback: string): string {
  return redactExecutionText(value ?? fallback, []) ?? fallback
}

function sanitizeValue(value: unknown, key = ''): unknown {
  if (secretKeyPattern.test(key)) return '[REDACTED]'
  if (typeof value === 'string') return redactExecutionText(value, []) ?? ''
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [childKey, sanitizeValue(child, childKey)]))
}

function sanitizeData(data: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!data) return undefined
  return sanitizeValue(data) as Record<string, unknown>
}

function stoppedResult(): ActionResult {
  return actionRuntimeResult('stopped', 'action_stopped', 'Action đã dừng theo yêu cầu runtime.')
}

function canRetry(result: ActionResult, attempt: number, policy: ActionRetryPolicy): boolean {
  if (attempt >= policy.maxAttempts || result.status !== 'failed' || !result.code) return false
  return policy.retryableCodes.includes(result.code)
}

export class ActionExecutorRegistry {
  private readonly executors = new Map<string, ActionExecutor>()

  register(executor: ActionExecutor): void {
    const actionType = executor.actionType.trim()
    if (!actionType) throw new Error('Action executor phải có actionType.')
    if (!getActionDefinition(actionType)) throw new Error(`Action executor “${actionType}” không có trong action registry.`)
    if (this.executors.has(actionType)) throw new Error(`Action executor “${actionType}” đã được đăng ký.`)
    this.executors.set(actionType, executor)
  }

  get(actionType: string): ActionExecutor | undefined {
    return this.executors.get(actionType)
  }

  has(actionType: string): boolean {
    return this.executors.has(actionType)
  }
}

export class ActionRunner {
  constructor(
    private readonly host: ActionPreparationHost,
    private readonly executors: ActionExecutorRegistry,
    private readonly sink?: ActionLogSink
  ) {}

  async run(request: ActionRunRequest, control: ActionRunControl = DEFAULT_CONTROL): Promise<ActionExecutionSummary> {
    const startedAt = Date.now()
    let attempts = 0
    let normalizedConfig: ActionConfig | null = null

    const emit = (stage: ActionLogEvent['stage'], level: ActionLogLevel, message: string, code?: string, attempt?: number, data?: Record<string, unknown>) => {
      const event: ActionLogEvent = {
        runKey: request.runKey,
        actionType: request.actionType,
        actor: request.actor.kind,
        stage,
        level,
        message: safeMessage(message, 'Action runtime event.'),
        at: Date.now(),
        ...(attempt === undefined ? {} : { attempt }),
        ...(code === undefined ? {} : { code }),
        ...(data === undefined ? {} : { data: sanitizeData(data)! })
      }
      void this.sink?.(event)
    }

    const finish = (result: ActionResult): ActionExecutionSummary => {
      const safeResult: ActionResult = {
        ...result,
        ...(result.message === undefined ? {} : { message: safeMessage(result.message, 'Action kết thúc.') }),
        ...(result.data === undefined ? {} : { data: sanitizeData(result.data)! })
      }
      emit('completed', safeResult.status === 'failed' || safeResult.status === 'needs_attention' ? 'warning' : 'info', safeResult.message ?? 'Action kết thúc.', safeResult.code, attempts)
      return { result: safeResult, normalizedConfig, attempts, startedAt, finishedAt: Date.now() }
    }

    emit('validating', 'debug', 'Đang kiểm tra action và config.')
    const definition = getActionDefinition(request.actionType)
    if (!definition) {
      return finish(actionRuntimeResult('failed', 'action_not_registered', `Action “${request.actionType}” chưa có trong registry.`))
    }
    if (!definition.capabilities.actors.includes(request.actor.kind)) {
      return finish(actionRuntimeResult('skipped', 'action_actor_unsupported', `Action “${definition.label}” không hỗ trợ actor ${request.actor.kind}.`))
    }
    if (request.actor.kind === 'page' && !request.actor.pageUid.trim()) {
      return finish(actionRuntimeResult('failed', 'page_uid_required', 'Actor Page thiếu Page UID.'))
    }

    const validation = validateActionConfig(request.actionType, request.config)
    if (!validation.valid) {
      return finish(actionRuntimeResult('failed', 'action_config_invalid', validation.errors.join(' '), { errors: validation.errors }))
    }
    normalizedConfig = validation.value

    const executor = this.executors.get(request.actionType)
    if (!executor) {
      return finish(actionRuntimeResult('skipped', 'action_not_implemented', `Action “${definition.label}” đã có registry/runner nhưng chưa có executor thật.`))
    }

    if (control.isStopped()) return finish(stoppedResult())
    await control.waitIfPaused()
    if (control.isStopped()) return finish(stoppedResult())

    emit('preparing_actor', 'info', `Chuẩn bị session và actor ${request.actor.kind}.`)
    let preparation: ActionPreparationResult
    try {
      preparation = await this.host.prepare({
        request,
        control,
        log: (level, message, code, data) => emit('preparing_actor', level, message, code, undefined, data)
      })
    } catch (error) {
      return finish(actionRuntimeResult(
        'failed',
        'browser_unavailable',
        safeMessage(error instanceof Error ? error.message : String(error), 'Không chuẩn bị được Facebook runtime.')
      ))
    }
    if (preparation.status === 'blocked') return finish(preparation.result)

    const policy = normalizeRetryPolicy(request.retry)
    for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
      if (control.isStopped()) return finish(stoppedResult())
      await control.waitIfPaused()
      if (control.isStopped()) return finish(stoppedResult())

      attempts = attempt
      emit('executing', 'info', `Chạy action lần ${attempt}/${policy.maxAttempts}.`, undefined, attempt)
      let result: ActionResult
      try {
        result = await executor.execute({
          request,
          attempt,
          control,
          log: (level, message, code, data) => emit('executing', level, message, code, attempt, data)
        }, normalizedConfig)
      } catch (error) {
        result = actionRuntimeResult(
          'failed',
          'executor_exception',
          safeMessage(error instanceof Error ? error.message : String(error), 'Action executor phát sinh lỗi.')
        )
      }

      if (!canRetry(result, attempt, policy)) return finish(result)
      emit('retry_wait', 'warning', `Action lỗi tạm thời; chờ ${policy.delayMs} ms trước lần thử tiếp theo.`, result.code, attempt)
      await control.sleep(policy.delayMs)
    }

    return finish(actionRuntimeResult('failed', 'executor_exception', 'Action runner kết thúc ngoài retry loop.'))
  }
}
