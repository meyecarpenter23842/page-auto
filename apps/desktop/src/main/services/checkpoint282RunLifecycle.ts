import { randomUUID } from 'node:crypto'
import type { AccountRecord } from '../../shared/accounts'
import type {
  FacebookCheckpoint282Result,
  FacebookCheckpoint282RunPayload,
  FacebookCheckpointSurface
} from '../../shared/facebookCheckpoint'
import { expectedFacebookUserId } from '../browser/facebookAccountIdentity'
import {
  appendCheckpoint282History,
  finalizeCheckpoint282AssetRun,
  validateCheckpoint282RunAsset
} from '../browser/checkpoint282Assets'

export type Checkpoint282Runner = (
  payload: Omit<FacebookCheckpoint282RunPayload, 'accountId' | 'asset'>
) => Promise<FacebookCheckpoint282Result>

export interface Checkpoint282RunLifecycleOptions {
  normalizeResult?: (result: FacebookCheckpoint282Result) => FacebookCheckpoint282Result
}

export class Checkpoint282RunLifecycle {
  constructor(private readonly dataDirectory: string) {}

  async execute(
    account: AccountRecord,
    payload: FacebookCheckpoint282RunPayload,
    run: Checkpoint282Runner,
    options: Checkpoint282RunLifecycleOptions = {}
  ): Promise<FacebookCheckpoint282Result> {
    let asset = null
    try {
      asset = payload.asset
        ? validateCheckpoint282RunAsset({ dataDirectory: this.dataDirectory, uid: account.uid, asset: payload.asset })
        : null
    } catch (cause) {
      const result: FacebookCheckpoint282Result = {
        accountId: account.id,
        uid: account.uid,
        state: 'error',
        surface: payload.surface,
        message: cause instanceof Error ? cause.message : String(cause)
      }
      const finalResult = options.normalizeResult?.(result) ?? result
      this.record(account, payload, finalResult, payload.asset ?? null)
      return finalResult
    }

    let result: FacebookCheckpoint282Result
    try {
      result = await run({
        surface: payload.surface,
        action: payload.action,
        evidenceFolder: payload.evidenceFolder ?? null
      })
    } catch (cause) {
      result = {
        accountId: account.id,
        uid: account.uid,
        state: 'error',
        surface: payload.surface,
        message: cause instanceof Error ? cause.message : String(cause)
      }
    }

    const normalized = options.normalizeResult?.(result) ?? result
    const verifiedResult: FacebookCheckpoint282Result = normalized.state === 'resolved'
      ? {
          ...normalized,
          identityVerification: expectedFacebookUserId(account.uid) ? 'uid_match' : 'session_only'
        }
      : normalized
    const assetPromotion = finalizeCheckpoint282AssetRun({
      dataDirectory: this.dataDirectory,
      uid: account.uid,
      asset,
      result: verifiedResult
    })
    const finalResult = assetPromotion ? { ...verifiedResult, assetPromotion } : verifiedResult
    this.record(account, payload, finalResult, asset)
    return finalResult
  }

  recordOperatorStop(
    account: AccountRecord,
    surface: FacebookCheckpointSurface,
    message = 'Đã dừng CP282 và đóng browser của account.'
  ): FacebookCheckpoint282Result {
    const result: FacebookCheckpoint282Result = {
      accountId: account.id,
      uid: account.uid,
      state: 'stopped',
      surface,
      message
    }
    this.record(account, {
      accountId: account.id,
      surface,
      action: 'stop',
      asset: null,
      evidenceFolder: null
    }, result, null)
    return result
  }

  private record(
    account: AccountRecord,
    payload: FacebookCheckpoint282RunPayload,
    result: FacebookCheckpoint282Result,
    asset: FacebookCheckpoint282RunPayload['asset']
  ): void {
    appendCheckpoint282History(this.dataDirectory, {
      id: randomUUID(),
      at: Date.now(),
      accountId: account.id,
      uid: account.uid,
      action: payload.action,
      state: result.state,
      message: result.assetPromotion
        ? `${result.message} · ${result.assetPromotion.message}`
        : result.message,
      assetPath: asset?.path ?? null,
      assetOrigin: asset?.origin ?? null,
      assetConfirmedUsed: asset?.confirmedUsed ?? false,
      promotionState: result.assetPromotion?.state ?? null,
      canonicalPath: result.assetPromotion?.canonicalPath ?? null,
      evidencePath: result.evidencePath ?? null
    })
  }
}
