import {
  PWA_GROUP_POST_COMMAND_ACTIONS,
  PWA_REMOTE_COMMAND_ID_PATTERN,
  PWA_REMOTE_COMMAND_SCHEMA_VERSION,
  PWA_REMOTE_COMMAND_TARGET,
  isPwaGroupPostCommand,
  type PwaGroupPostCommand,
  type PwaGroupPostCommandAction,
  type PwaGroupPostCommandResult,
  type PwaGroupPostCommandResultCode
} from '../../shared/pwaBridge'
import type { RotationRuntimeSnapshot, RotationRuntimeStatus } from '../../shared/rotation'

export interface PwaRemoteRotationSource {
  status(payload: { pageTabId: number }): RotationRuntimeSnapshot
  start(payload: { pageTabId: number }): RotationRuntimeSnapshot
  pause(payload: { pageTabId: number }): RotationRuntimeSnapshot
  resume(payload: { pageTabId: number }): RotationRuntimeSnapshot
  stop(payload: { pageTabId: number }): RotationRuntimeSnapshot
}

interface ProcessedCommand {
  fingerprint: string
  result: PwaGroupPostCommandResult
  expiresAt: number
}

const VALID_FROM: Record<PwaGroupPostCommandAction, ReadonlySet<RotationRuntimeStatus>> = {
  start: new Set(['idle', 'stopped', 'completed', 'error']),
  pause: new Set(['starting', 'running', 'waiting_window']),
  resume: new Set(['paused']),
  stop: new Set(['starting', 'running', 'waiting_window', 'paused'])
}
const RESULT_CACHE_GRACE_MS = 10 * 60_000

function safeMessage(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error)
  return value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 240) || 'Remote command thất bại trong runtime.'
}

function commandFingerprint(command: PwaGroupPostCommand): string {
  return [command.target, command.pageTabId, command.action, command.issuedAt, command.expiresAt].join(':')
}

export class PwaRemoteControlService {
  private readonly processed = new Map<string, ProcessedCommand>()

  constructor(
    private readonly rotation: PwaRemoteRotationSource,
    private readonly pageExists: (pageTabId: number) => boolean,
    private readonly now: () => number = () => Date.now()
  ) {}

  execute(input: unknown): PwaGroupPostCommandResult {
    const now = this.now()
    this.prune(now)
    if (!isPwaGroupPostCommand(input)) return this.invalidResult(input, now)

    const command = input
    const fingerprint = commandFingerprint(command)
    const previous = this.processed.get(command.commandId)
    if (previous) {
      if (previous.fingerprint === fingerprint) return previous.result
      return this.result(command, false, 'command_conflict', 'commandId đã được dùng cho một lệnh khác.', now, null, null, null)
    }

    if (command.expiresAt <= now) {
      return this.remember(command, fingerprint, this.result(command, false, 'expired', 'Lệnh remote đã hết hạn.', now, null, null, null))
    }
    if (!this.pageExists(command.pageTabId)) {
      return this.remember(command, fingerprint, this.result(command, false, 'page_not_found', 'Page Tab không tồn tại.', now, null, null, null))
    }

    let current: RotationRuntimeSnapshot
    try {
      current = this.rotation.status({ pageTabId: command.pageTabId })
    } catch (error) {
      return this.remember(command, fingerprint, this.result(command, false, 'runtime_error', safeMessage(error), now, null, null, null))
    }

    if (!VALID_FROM[command.action].has(current.status)) {
      return this.remember(command, fingerprint, this.result(
        command,
        false,
        'invalid_state',
        `Không thể ${command.action} khi runtime đang ở trạng thái ${current.status}.`,
        now,
        current.status,
        current.status,
        current.runId
      ))
    }

    try {
      const next = this.rotation[command.action]({ pageTabId: command.pageTabId })
      return this.remember(command, fingerprint, this.result(command, true, 'ok', null, now, current.status, next.status, next.runId))
    } catch (error) {
      return this.remember(command, fingerprint, this.result(command, false, 'runtime_error', safeMessage(error), now, current.status, current.status, current.runId))
    }
  }

  private remember(command: PwaGroupPostCommand, fingerprint: string, result: PwaGroupPostCommandResult): PwaGroupPostCommandResult {
    this.processed.set(command.commandId, {
      fingerprint,
      result,
      expiresAt: command.expiresAt + RESULT_CACHE_GRACE_MS
    })
    if (this.processed.size > 256) {
      const oldest = this.processed.keys().next().value as string | undefined
      if (oldest) this.processed.delete(oldest)
    }
    return result
  }

  private prune(now: number): void {
    for (const [commandId, entry] of this.processed) {
      if (entry.expiresAt <= now) this.processed.delete(commandId)
    }
  }

  private invalidResult(input: unknown, handledAt: number): PwaGroupPostCommandResult {
    const candidate = input && typeof input === 'object' ? input as Record<string, unknown> : {}
    const commandId = typeof candidate.commandId === 'string' && PWA_REMOTE_COMMAND_ID_PATTERN.test(candidate.commandId)
      ? candidate.commandId
      : 'invalid-command'
    const pageTabId = typeof candidate.pageTabId === 'number' && Number.isInteger(candidate.pageTabId) && candidate.pageTabId > 0
      ? candidate.pageTabId
      : 0
    const action = typeof candidate.action === 'string' && (PWA_GROUP_POST_COMMAND_ACTIONS as readonly string[]).includes(candidate.action)
      ? candidate.action as PwaGroupPostCommandAction
      : 'start'
    return {
      schemaVersion: PWA_REMOTE_COMMAND_SCHEMA_VERSION,
      commandId,
      target: PWA_REMOTE_COMMAND_TARGET,
      pageTabId,
      action,
      ok: false,
      code: 'invalid_command',
      message: 'Lệnh remote không hợp lệ.',
      handledAt,
      fromStatus: null,
      runtimeStatus: null,
      runId: null
    }
  }

  private result(
    command: PwaGroupPostCommand,
    ok: boolean,
    code: PwaGroupPostCommandResultCode,
    message: string | null,
    handledAt: number,
    fromStatus: RotationRuntimeStatus | null,
    runtimeStatus: RotationRuntimeStatus | null,
    runId: number | null
  ): PwaGroupPostCommandResult {
    return {
      schemaVersion: PWA_REMOTE_COMMAND_SCHEMA_VERSION,
      commandId: command.commandId,
      target: PWA_REMOTE_COMMAND_TARGET,
      pageTabId: command.pageTabId,
      action: command.action,
      ok,
      code,
      message,
      handledAt,
      fromStatus,
      runtimeStatus,
      runId
    }
  }
}
