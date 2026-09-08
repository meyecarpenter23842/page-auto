import type {
  EmailAuthV2HandlerResult,
  EmailAuthV2Surface
} from './emailAuthV2Contracts'

export interface MicrosoftAuthDetectedState<TDetection = unknown> {
  surface: EmailAuthV2Surface
  detection: TDetection
}

export interface MicrosoftAuthDispatchContext<TDetection = unknown> {
  step: number
  surface: EmailAuthV2Surface
  detection: TDetection
}

export type MicrosoftAuthStateHandler<TDetection = unknown> = (
  context: MicrosoftAuthDispatchContext<TDetection>
) => Promise<EmailAuthV2HandlerResult>

export type MicrosoftAuthHandlerMap<TDetection = unknown> = Partial<Record<
  EmailAuthV2Surface,
  MicrosoftAuthStateHandler<TDetection>
>>

export interface MicrosoftAuthDispatchLoopOptions<TDetection = unknown> {
  detect: () => Promise<MicrosoftAuthDetectedState<TDetection> | null>
  handlers: MicrosoftAuthHandlerMap<TDetection>
  maxSteps?: number
  onTransition?: (context: MicrosoftAuthDispatchContext<TDetection>) => void
}

/**
 * Batch 1 controller skeleton: detect current state, dispatch exactly one handler,
 * then detect from scratch again for every non-terminal result.
 *
 * No handler is allowed to declare the next Microsoft state. `handled` and
 * `retryable` both return control to the detector. Unknown surfaces fail closed.
 */
export async function runMicrosoftAuthDispatchLoop<TDetection = unknown>(
  options: MicrosoftAuthDispatchLoopOptions<TDetection>
): Promise<EmailAuthV2HandlerResult> {
  const maxSteps = Math.max(1, Math.trunc(options.maxSteps ?? 32))

  for (let step = 0; step < maxSteps; step += 1) {
    const detected = await options.detect()
    if (!detected) {
      return {
        kind: 'needs_attention',
        reason: 'microsoft_surface_unreadable'
      }
    }

    const context: MicrosoftAuthDispatchContext<TDetection> = {
      step,
      surface: detected.surface,
      detection: detected.detection
    }
    options.onTransition?.(context)

    const handler = options.handlers[detected.surface]
    if (!handler) {
      return {
        kind: 'needs_attention',
        reason: `unsupported_microsoft_surface:${detected.surface}`
      }
    }

    const result = await handler(context)
    if (result.kind === 'authenticated' || result.kind === 'needs_attention') return result
    // `handled` and `retryable` intentionally fall through to a fresh detect.
  }

  return {
    kind: 'needs_attention',
    reason: 'microsoft_auth_retry_budget_exhausted'
  }
}
