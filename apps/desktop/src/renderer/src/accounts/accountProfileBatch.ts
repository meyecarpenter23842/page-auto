import type { BrowserProfileResult } from '../../../shared/accounts'

export interface AccountProfileOpenTarget {
  id: number
  uid: string
}

export interface AccountProfileOpenOutcome {
  accountId: number
  uid: string
  status: BrowserProfileResult['status']
  message: string | null
}

export type AccountProfileOpener = (accountId: number) => Promise<BrowserProfileResult>

/**
 * Dispatch every selected account immediately, then wait for all session checks to
 * settle. BrowserProfileManager still owns one worker/profile per account; this only
 * removes the renderer-side "exactly one selected account" bottleneck.
 */
export async function openAccountProfilesBatch(
  accounts: readonly AccountProfileOpenTarget[],
  openOne: AccountProfileOpener
): Promise<AccountProfileOpenOutcome[]> {
  return Promise.all(accounts.map(async (account) => {
    try {
      const result = await openOne(account.id)
      return {
        accountId: account.id,
        uid: account.uid,
        status: result.status,
        message: result.message ?? null
      }
    } catch (error) {
      return {
        accountId: account.id,
        uid: account.uid,
        status: 'error' as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }))
}
