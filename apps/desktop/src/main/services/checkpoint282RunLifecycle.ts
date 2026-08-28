import { randomUUID } from 'node:crypto'
import type { AccountRecord } from '../../shared/accounts'
import type {
  FacebookCheckpoint282Result,
  FacebookCheckpoint282RunPayload
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

export class Checkpoint282RunLifecycle {
  constructor(private readonly dataDirectory: string) {}

  async execute(
    account: AccountRecord,
    payload: FacebookCheckpoint282RunPayload,
    run: Checkpoint282Runner
  ): Promise<FacebookCheckpoint282Result> {
    let asset = null
    try {
      asset = payload.asset
        ? validateCheckpoint282RunAsset({ dataDirectory: this.dataDirectory, uid: account.uid, asset: payload.asset })
        : null
    } catch (error) {
      const result: FacebookCheckpoint282Result = {
        accountId: account.id,
        uid: account.uid,
        state: 'error',
        surface: payload.surface,
        message: error instanceof Error ? error.message : String(error)
      }
      this.record(account, payload, result, payload.asset ?? null)
      return result
    }

    let result: FacebookCheckpoint282Result
    try {
      result = await run({
        surface: payload.surface,
        action: payload.action,
        evidenceFolder: payload.evidenceFolder ?? null
      })
    } catch (error) {
      result = {
        accountId: account.id,
        uid: account.uid,
        state: 'error',
        surface: payload.surface,
        message: error instanceof Error ? error.message : String(error)
      }
    }

    const verifiedResult: FacebookCheckpoint282Result = result.state === 'resolved'
      ? {
          ...result,
          identityVerification: expectedFacebookUserId(account.uid) ? 'uid_match' : 'session_only'
        }
      : result
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
