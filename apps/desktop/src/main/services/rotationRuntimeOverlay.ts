import type { ExecuteSinglePostingJobResult, PostingCheckpointKind } from '../../shared/posting'
import type {
  PostingJobPreview,
  RotationAccountRuntimeState,
  RotationAccountRuntimeStatus,
  RotationRuntimeSnapshot
} from '../../shared/rotation'

interface PageRuntimeState {
  pageTabId: number
  runId: number
  cycle: number
  pendingCycleReset: boolean
  activeAccountId: number | null
  previewAccountId: number | null
  currentPostPreview: PostingJobPreview | null
  accountOrder: number[]
  accountStates: Map<number, RotationAccountRuntimeState>
}

const NON_ACCOUNT_FAILURE_CODES = new Set(['no_pending_item', 'no_content', 'missing_media'])

function cloneAccountState(state: RotationAccountRuntimeState): RotationAccountRuntimeState {
  return { ...state }
}

function runtimeAccountError(outcome: ExecuteSinglePostingJobResult): boolean {
  if (outcome.result.status === 'needs_login') return true
  if (outcome.result.status !== 'failed') return false
  return !NON_ACCOUNT_FAILURE_CODES.has(outcome.result.code ?? '')
}

function runtimeCheckpointKind(outcome: ExecuteSinglePostingJobResult): PostingCheckpointKind | undefined {
  const validation = outcome.result.sessionValidation
  const checkpoint = outcome.result.code === 'verification_required' || validation?.state === 'verification_required'
  if (!checkpoint) return undefined
  return validation?.checkpointKind ?? 'unknown'
}

export class RotationRuntimeOverlayRegistry {
  private readonly byPageTab = new Map<number, PageRuntimeState>()
  private readonly pageTabByRun = new Map<number, number>()

  decorate(snapshot: RotationRuntimeSnapshot): RotationRuntimeSnapshot {
    const state = this.ensureState(snapshot)
    if (!state) {
      return { ...snapshot, accountStates: [], currentPostPreview: null }
    }

    if (snapshot.cycle !== state.cycle) {
      if (snapshot.cycle > state.cycle) state.pendingCycleReset = true
      state.cycle = snapshot.cycle
    }

    if (state.pendingCycleReset && snapshot.currentAccountId !== null) {
      this.resetAccounts(state)
      state.pendingCycleReset = false
    }

    if (snapshot.currentAccountId !== null) {
      const accountId = snapshot.currentAccountId
      state.activeAccountId = accountId
      const current = state.accountStates.get(accountId)
      if (current?.status !== 'error') {
        const waiting = snapshot.status === 'paused'
          || (snapshot.nextActionAt !== null && snapshot.nextActionAt > Date.now())
        this.setAccountState(state, accountId, waiting ? 'waiting' : 'running', waiting ? 'Đang chờ/delay.' : 'Đang chạy.')
      }
    } else if (state.activeAccountId !== null) {
      const previousId = state.activeAccountId
      const previous = state.accountStates.get(previousId)
      if (previous?.status !== 'error') {
        if (snapshot.status === 'paused') {
          this.setAccountState(state, previousId, 'waiting', 'Đang tạm dừng/chờ tiếp tục.')
        } else if (previous?.status === 'running' || previous?.status === 'waiting') {
          this.setAccountState(state, previousId, 'completed_turn', 'Đã chạy lượt trong phiên.')
        }
      }
      state.activeAccountId = null
    }

    if (snapshot.status === 'stopped' || snapshot.status === 'completed' || snapshot.status === 'error') {
      state.currentPostPreview = null
      state.previewAccountId = null
    }

    return {
      ...snapshot,
      accountStates: state.accountOrder
        .map((accountId) => state.accountStates.get(accountId))
        .filter((entry): entry is RotationAccountRuntimeState => Boolean(entry))
        .map(cloneAccountState),
      currentPostPreview: state.currentPostPreview ? { ...state.currentPostPreview } : null
    }
  }

  notePostingStart(runId: number, accountId: number | undefined): void {
    if (accountId === undefined) return
    const state = this.stateForRun(runId)
    if (!state) return
    if (state.pendingCycleReset) {
      this.resetAccounts(state)
      state.pendingCycleReset = false
    }
    state.activeAccountId = accountId
    state.currentPostPreview = null
    state.previewAccountId = null
    if (state.accountStates.get(accountId)?.status !== 'error') {
      this.setAccountState(state, accountId, 'running', 'Đang chuẩn bị bài.')
    }
  }

  notePrepared(runId: number, accountId: number, preview: PostingJobPreview): void {
    const state = this.stateForRun(runId)
    if (!state) return
    state.activeAccountId = accountId
    state.previewAccountId = accountId
    state.currentPostPreview = { ...preview }
    if (state.accountStates.get(accountId)?.status !== 'error') {
      this.setAccountState(state, accountId, 'running', `Đang đăng Group ${preview.groupUid}.`)
    }
  }

  notePostingResult(outcome: ExecuteSinglePostingJobResult): void {
    const state = this.stateForRun(outcome.run.run.id)
    const accountId = outcome.accountId
    if (!state || accountId === null) return

    if (runtimeAccountError(outcome)) {
      this.setAccountState(state, accountId, 'error', outcome.result.message, runtimeCheckpointKind(outcome))
    } else if (state.accountStates.get(accountId)?.status !== 'error') {
      this.setAccountState(state, accountId, 'running', outcome.result.message)
    }

    if (state.previewAccountId === accountId) {
      state.currentPostPreview = null
      state.previewAccountId = null
    }
  }

  notePostingException(runId: number, accountId: number | undefined, message: string): void {
    if (accountId === undefined) return
    const state = this.stateForRun(runId)
    if (!state) return
    state.activeAccountId = accountId
    this.setAccountState(state, accountId, 'error', message)
    if (state.previewAccountId === accountId) {
      state.currentPostPreview = null
      state.previewAccountId = null
    }
  }

  clearAll(): void {
    this.byPageTab.clear()
    this.pageTabByRun.clear()
  }

  private ensureState(snapshot: RotationRuntimeSnapshot): PageRuntimeState | null {
    if (snapshot.runId === null || !snapshot.run) return null
    const existing = this.byPageTab.get(snapshot.pageTabId)
    if (!existing || existing.runId !== snapshot.runId) {
      if (existing) this.pageTabByRun.delete(existing.runId)
      const created: PageRuntimeState = {
        pageTabId: snapshot.pageTabId,
        runId: snapshot.runId,
        cycle: snapshot.cycle,
        pendingCycleReset: false,
        activeAccountId: null,
        previewAccountId: null,
        currentPostPreview: null,
        accountOrder: [],
        accountStates: new Map()
      }
      this.byPageTab.set(snapshot.pageTabId, created)
      this.pageTabByRun.set(snapshot.runId, snapshot.pageTabId)
      this.syncAccounts(created, snapshot)
      return created
    }

    this.pageTabByRun.set(snapshot.runId, snapshot.pageTabId)
    this.syncAccounts(existing, snapshot)
    return existing
  }

  private syncAccounts(state: PageRuntimeState, snapshot: RotationRuntimeSnapshot): void {
    const enabledAccounts = snapshot.run?.run.snapshot.accounts
      .filter((account) => account.enabled)
      .sort((a, b) => a.sortOrder - b.sortOrder) ?? []
    const enabledIds = new Set(enabledAccounts.map((account) => account.accountId))
    state.accountOrder = enabledAccounts.map((account) => account.accountId)

    for (const accountId of state.accountStates.keys()) {
      if (!enabledIds.has(accountId)) state.accountStates.delete(accountId)
    }
    for (const accountId of state.accountOrder) {
      if (!state.accountStates.has(accountId)) {
        state.accountStates.set(accountId, { accountId, status: 'not_run', message: null })
      }
    }
  }

  private resetAccounts(state: PageRuntimeState): void {
    for (const accountId of state.accountOrder) {
      state.accountStates.set(accountId, { accountId, status: 'not_run', message: null })
    }
    state.activeAccountId = null
    state.previewAccountId = null
    state.currentPostPreview = null
  }

  private setAccountState(
    state: PageRuntimeState,
    accountId: number,
    status: RotationAccountRuntimeStatus,
    message: string | null,
    checkpointKind?: PostingCheckpointKind
  ): void {
    if (!state.accountStates.has(accountId)) state.accountOrder.push(accountId)
    state.accountStates.set(accountId, {
      accountId,
      status,
      message,
      ...(checkpointKind ? { checkpointKind } : {})
    })
  }

  private stateForRun(runId: number): PageRuntimeState | null {
    const pageTabId = this.pageTabByRun.get(runId)
    return pageTabId === undefined ? null : this.byPageTab.get(pageTabId) ?? null
  }
}

export const rotationRuntimeOverlay = new RotationRuntimeOverlayRegistry()
