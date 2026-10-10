import { ipcMain } from 'electron'
import type Database from 'better-sqlite3'
import {
  PAGE_SCENARIO_PLAN_STATUSES,
  PAGE_SCENARIO_SCHEDULE_IPC,
  createPageScenarioRunnerSettings,
  normalizePageScenarioPlanInput,
  normalizePageScenarioScheduleMinutes,
  pageScenarioOccurrenceKey,
  positiveUniqueScenarioIds,
  type PageScenarioOccurrenceRecord,
  type PageScenarioPlanRecord,
  type PageScenarioPlanStatus,
  type PageScenarioPlanView,
  type PageScenarioScheduleDashboard,
  type SavePageScenarioPlanInput,
  type SavePageScenarioSchedulePayload,
  type SetPageScenarioScheduleEnabledPayload
} from '../shared/pageScenarioSchedule'
import {
  SCENARIO_RUNNER_IPC,
  type ScenarioRunnerSnapshot,
  type ScenarioRunnerStartPayload
} from '../shared/scenarioRunnerRuntime'
import { BrowserWindowLayoutManager } from './browser/browserWindowLayoutManager'
import { AppSettingsRepository } from './database/appSettingsRepository'
import { BrowserWindowLayoutRepository } from './database/browserWindowLayoutRepository'
import { PageTabRepository } from './database/pageTabRepository'
import { ScenarioRepository } from './database/scenarioRepository'
import { FacebookSessionPolicyWorkerManager } from './facebook/facebookSessionPolicy'
import { AccountExecutionCoordinator } from './services/accountExecutionCoordinator'
import { PostingService } from './services/postingService'
import { ScenarioPostActionAdapter } from './services/scenarioPostActionAdapter'
import { ScenarioRunnerService } from './services/scenarioRunnerService'

export interface ScenarioRunnerIpcRuntime { dispose: () => void }

interface ScenarioRunnerIpcOptions {
  database: Database.Database
  dataDirectory: string
}

interface PageScenarioPlanRow {
  id: number
  pageTabId: number
  scheduleKind: string
  localDate: string | null
  minuteOfDay: number
  accountConcurrency: number
  accountIdsJson: string
  scenarioId: number
  status: string
  lastError: string | null
  createdAt: number
  updatedAt: number
}

interface PageScenarioOccurrenceRow {
  id: number
  planId: number
  occurrenceKey: string
  localDate: string
  scheduledAt: number
  status: string
  pageUid: string
  accountConcurrency: number
  accountIdsJson: string
  scenarioId: number
  runnerRunId: string | null
  resultMessage: string | null
  createdAt: number
  startedAt: number | null
  finishedAt: number | null
  updatedAt: number
}

interface ActiveScheduledScenarioRun {
  planId: number
  occurrenceId: number
  runId: string
  scheduleKind: PageScenarioPlanRecord['scheduleKind']
}

const planColumns = `
  id, page_tab_id AS pageTabId, schedule_kind AS scheduleKind, local_date AS localDate,
  minute_of_day AS minuteOfDay, account_concurrency AS accountConcurrency,
  account_ids_json AS accountIdsJson, scenario_id AS scenarioId, status,
  last_error AS lastError, created_at AS createdAt, updated_at AS updatedAt
`

const occurrenceColumns = `
  id, plan_id AS planId, occurrence_key AS occurrenceKey, local_date AS localDate,
  scheduled_at AS scheduledAt, status, page_uid AS pageUid,
  account_concurrency AS accountConcurrency, account_ids_json AS accountIdsJson,
  scenario_id AS scenarioId, runner_run_id AS runnerRunId, result_message AS resultMessage,
  created_at AS createdAt, started_at AS startedAt, finished_at AS finishedAt, updated_at AS updatedAt
`

function isTerminalScenarioState(state: string): boolean {
  return state === 'completed' || state === 'failed' || state === 'stopped'
}

function isBusyScenarioState(snapshot: ScenarioRunnerSnapshot | null): boolean {
  return snapshot?.state === 'running' || snapshot?.state === 'stopping'
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function scheduledAtFor(localDate: string, minuteOfDay: number): number {
  const [year, month, day] = localDate.split('-').map(Number)
  const hour = Math.floor(minuteOfDay / 60)
  const minute = minuteOfDay % 60
  return new Date(year!, month! - 1, day!, hour, minute, 0, 0).getTime()
}

function parseIdJson(value: string): number[] {
  try {
    return positiveUniqueScenarioIds(JSON.parse(value) as number[])
  } catch {
    return []
  }
}

function rowToPlan(row: PageScenarioPlanRow): PageScenarioPlanRecord {
  return {
    id: row.id,
    pageTabId: row.pageTabId,
    scheduleKind: row.scheduleKind as PageScenarioPlanRecord['scheduleKind'],
    localDate: row.localDate,
    minuteOfDay: row.minuteOfDay,
    accountConcurrency: row.accountConcurrency,
    accountIds: parseIdJson(row.accountIdsJson),
    scenarioId: row.scenarioId,
    status: row.status as PageScenarioPlanStatus,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

function rowToOccurrence(row: PageScenarioOccurrenceRow): PageScenarioOccurrenceRecord {
  return {
    id: row.id,
    planId: row.planId,
    occurrenceKey: row.occurrenceKey,
    localDate: row.localDate,
    scheduledAt: row.scheduledAt,
    status: row.status as PageScenarioOccurrenceRecord['status'],
    pageUid: row.pageUid,
    accountConcurrency: row.accountConcurrency,
    accountIds: parseIdJson(row.accountIdsJson),
    scenarioId: row.scenarioId,
    runnerRunId: row.runnerRunId,
    resultMessage: row.resultMessage,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    updatedAt: row.updatedAt
  }
}

function assertPlanStatus(status: PageScenarioPlanStatus): void {
  if (!PAGE_SCENARIO_PLAN_STATUSES.includes(status)) throw new Error('Trạng thái lịch Kịch bản Page không hợp lệ.')
}

export function registerScenarioRunnerIpcHandlers(options: ScenarioRunnerIpcOptions): ScenarioRunnerIpcRuntime {
  const appSettings = new AppSettingsRepository(options.database)
  const browserWindowLayoutSettings = new BrowserWindowLayoutRepository(options.database)
  const browserWindowLayout = new BrowserWindowLayoutManager()
  const pageTabs = new PageTabRepository(options.database)
  const scenarios = new ScenarioRepository(options.database)
  const posting = new PostingService(
    options.database,
    options.dataDirectory,
    () => appSettings.get().browser,
    () => appSettings.get().session,
    () => appSettings.get().network,
    () => appSettings.get().runtime,
    () => appSettings.get().logging,
    async () => undefined,
    browserWindowLayout,
    () => browserWindowLayoutSettings.get()
  )
  const postAdapter = new ScenarioPostActionAdapter(options.database, posting)
  const workers = new FacebookSessionPolicyWorkerManager(
    options.database,
    options.dataDirectory,
    () => appSettings.get().runtime,
    postAdapter
  )
  const service = new ScenarioRunnerService(
    options.database,
    workers,
    new AccountExecutionCoordinator(),
    options.dataDirectory,
    () => appSettings.get()
  )

  let scheduledRun: ActiveScheduledScenarioRun | null = null
  let disposed = false
  let ticking = false

  const getPlan = (id: number): PageScenarioPlanRecord | null => {
    const row = options.database.prepare(`SELECT ${planColumns} FROM page_scenario_plans WHERE id = ?`).get(id) as PageScenarioPlanRow | undefined
    return row ? rowToPlan(row) : null
  }

  const listPlans = (pageTabId: number): PageScenarioPlanRecord[] => {
    const rows = options.database.prepare(`
      SELECT ${planColumns}
      FROM page_scenario_plans
      WHERE page_tab_id = ?
      ORDER BY
        CASE status WHEN 'active' THEN 0 WHEN 'needs_attention' THEN 1 WHEN 'disabled' THEN 2 ELSE 3 END,
        CASE schedule_kind WHEN 'specific_date' THEN 0 ELSE 1 END,
        COALESCE(local_date, '9999-12-31'), minute_of_day, id
    `).all(pageTabId) as PageScenarioPlanRow[]
    return rows.map(rowToPlan)
  }

  const listOccurrences = (planId: number, limit = 100): PageScenarioOccurrenceRecord[] => {
    const rows = options.database.prepare(`
      SELECT ${occurrenceColumns}
      FROM page_scenario_plan_occurrences
      WHERE plan_id = ?
      ORDER BY local_date DESC, id DESC
      LIMIT ?
    `).all(planId, Math.max(1, Math.min(1_000, Math.floor(limit)))) as PageScenarioOccurrenceRow[]
    return rows.map(rowToOccurrence)
  }

  const occurrenceExists = (planId: number, localDate: string): boolean => Boolean(options.database.prepare(`
    SELECT 1 FROM page_scenario_plan_occurrences WHERE plan_id = ? AND occurrence_key = ?
  `).get(planId, pageScenarioOccurrenceKey(localDate)))

  const setPlanStatus = (planId: number, status: PageScenarioPlanStatus, lastError: string | null, now = Date.now()): PageScenarioPlanRecord => {
    assertPlanStatus(status)
    const result = options.database.prepare(`
      UPDATE page_scenario_plans SET status = ?, last_error = ?, updated_at = ? WHERE id = ?
    `).run(status, lastError, now, planId)
    if (result.changes !== 1) throw new Error(`Không tìm thấy lịch Kịch bản Page #${planId}.`)
    const plan = getPlan(planId)
    if (!plan) throw new Error(`Không đọc lại được lịch Kịch bản Page #${planId}.`)
    return plan
  }

  const validateCanonical = (input: SavePageScenarioPlanInput) => {
    const normalized = normalizePageScenarioPlanInput(input)
    const page = pageTabs.get(normalized.pageTabId)
    if (!page) throw new Error(`Không tìm thấy Page canonical #${normalized.pageTabId}.`)
    const enabled = new Set(page.accounts.filter((account) => account.enabled).map((account) => account.accountId))
    const invalid = normalized.accountIds.filter((accountId) => !enabled.has(accountId))
    if (invalid.length) throw new Error(`Tài khoản #${invalid.join(', #')} không thuộc binding đang bật của Page.`)
    const scenario = scenarios.get(normalized.scenarioId)
    if (!scenario) throw new Error(`Không tìm thấy Kịch bản #${normalized.scenarioId}.`)
    if (!scenario.actions.some((action) => action.enabled)) throw new Error(`Kịch bản “${scenario.name}” không có action nào được bật.`)
    return { normalized, page, scenario }
  }

  const createPlan = (input: SavePageScenarioPlanInput, now = Date.now()): PageScenarioPlanRecord => {
    const { normalized } = validateCanonical(input)
    const status: PageScenarioPlanStatus = normalized.enabled ? 'active' : 'disabled'
    const result = options.database.prepare(`
      INSERT INTO page_scenario_plans (
        page_tab_id, schedule_kind, local_date, minute_of_day, account_concurrency,
        account_ids_json, scenario_id, status, last_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
    `).run(
      normalized.pageTabId,
      normalized.scheduleKind,
      normalized.localDate,
      normalized.minuteOfDay,
      normalized.accountConcurrency,
      JSON.stringify(normalized.accountIds),
      normalized.scenarioId,
      status,
      now,
      now
    )
    const plan = getPlan(Number(result.lastInsertRowid))
    if (!plan) throw new Error('Không đọc lại được lịch Kịch bản Page vừa tạo.')
    return plan
  }

  const updatePlan = (id: number, input: SavePageScenarioPlanInput, now = Date.now()): PageScenarioPlanRecord => {
    const existing = getPlan(id)
    if (!existing) throw new Error(`Không tìm thấy lịch Kịch bản Page #${id}.`)
    const { normalized } = validateCanonical(input)
    const status: PageScenarioPlanStatus = normalized.enabled ? 'active' : 'disabled'
    options.database.prepare(`
      UPDATE page_scenario_plans
      SET page_tab_id = ?, schedule_kind = ?, local_date = ?, minute_of_day = ?,
          account_concurrency = ?, account_ids_json = ?, scenario_id = ?, status = ?,
          last_error = NULL, updated_at = ?
      WHERE id = ?
    `).run(
      normalized.pageTabId,
      normalized.scheduleKind,
      normalized.localDate,
      normalized.minuteOfDay,
      normalized.accountConcurrency,
      JSON.stringify(normalized.accountIds),
      normalized.scenarioId,
      status,
      now,
      id
    )
    const plan = getPlan(id)
    if (!plan) throw new Error(`Không đọc lại được lịch Kịch bản Page #${id}.`)
    return plan
  }

  const createOccurrence = (plan: PageScenarioPlanRecord, localDate: string, scheduledAt: number, pageUid: string, now = Date.now()): PageScenarioOccurrenceRecord | null => {
    if (occurrenceExists(plan.id, localDate)) return null
    try {
      const result = options.database.prepare(`
        INSERT INTO page_scenario_plan_occurrences (
          plan_id, occurrence_key, local_date, scheduled_at, status, page_uid,
          account_concurrency, account_ids_json, scenario_id, runner_run_id,
          result_message, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, NULL, NULL, ?, ?)
      `).run(
        plan.id,
        pageScenarioOccurrenceKey(localDate),
        localDate,
        scheduledAt,
        pageUid,
        plan.accountConcurrency,
        JSON.stringify(plan.accountIds),
        plan.scenarioId,
        now,
        now
      )
      const row = options.database.prepare(`SELECT ${occurrenceColumns} FROM page_scenario_plan_occurrences WHERE id = ?`)
        .get(Number(result.lastInsertRowid)) as PageScenarioOccurrenceRow | undefined
      return row ? rowToOccurrence(row) : null
    } catch (error) {
      if (occurrenceExists(plan.id, localDate)) return null
      throw error
    }
  }

  const markOccurrence = (
    id: number,
    status: PageScenarioOccurrenceRecord['status'],
    message: string | null,
    runnerRunId: string | null,
    now: number,
    finished: boolean
  ) => {
    options.database.prepare(`
      UPDATE page_scenario_plan_occurrences
      SET status = ?, result_message = ?, runner_run_id = COALESCE(?, runner_run_id),
          started_at = CASE WHEN ? = 'running' THEN COALESCE(started_at, ?) ELSE started_at END,
          finished_at = CASE WHEN ? THEN ? ELSE finished_at END,
          updated_at = ?
      WHERE id = ?
    `).run(status, message, runnerRunId, status, now, finished ? 1 : 0, now, now, id)
  }

  const recoverInterruptedOccurrences = () => {
    const interrupted = options.database.prepare(`
      SELECT DISTINCT plan_id AS planId
      FROM page_scenario_plan_occurrences
      WHERE status IN ('pending', 'running')
    `).all() as Array<{ planId: number }>
    if (!interrupted.length) return
    const now = Date.now()
    const message = 'Ứng dụng đã khởi động lại khi lịch Kịch bản Page đang chạy; không tự chạy lại để tránh lặp hành động.'
    options.database.prepare(`
      UPDATE page_scenario_plan_occurrences
      SET status = 'needs_attention', result_message = ?, finished_at = COALESCE(finished_at, ?), updated_at = ?
      WHERE status IN ('pending', 'running')
    `).run(message, now, now)
    for (const { planId } of interrupted) {
      if (getPlan(planId)) setPlanStatus(planId, 'needs_attention', message, now)
    }
  }

  const finalizeScheduledRun = () => {
    if (!scheduledRun) return
    const snapshot = service.status()
    if (!snapshot || snapshot.runId !== scheduledRun.runId || !isTerminalScenarioState(snapshot.state)) return

    postAdapter.finishScenarioRun(snapshot.runId)
    const needsAttention = snapshot.accountRuntimes.some((runtime) => runtime.state === 'needs_attention')
    const failed = snapshot.state === 'failed'
      || snapshot.state === 'stopped'
      || snapshot.accountRuntimes.some((runtime) => runtime.state === 'failed' || runtime.state === 'stopped')
    const status: PageScenarioOccurrenceRecord['status'] = needsAttention ? 'needs_attention' : failed ? 'failed' : 'success'
    const message = needsAttention
      ? snapshot.accountRuntimes.find((runtime) => runtime.state === 'needs_attention')?.message ?? 'Có tài khoản cần đăng nhập/xác minh.'
      : failed
        ? snapshot.message ?? 'Lịch Kịch bản Page hoàn tất với lỗi.'
        : snapshot.message ?? 'Lịch Kịch bản Page đã hoàn tất.'
    const now = Date.now()
    markOccurrence(scheduledRun.occurrenceId, status, message, snapshot.runId, now, true)
    const plan = getPlan(scheduledRun.planId)
    if (plan) {
      if (needsAttention) setPlanStatus(plan.id, 'needs_attention', message, now)
      else if (scheduledRun.scheduleKind === 'specific_date') setPlanStatus(plan.id, 'completed', failed ? message : null, now)
      else if (plan.status === 'active') setPlanStatus(plan.id, 'active', failed ? message : null, now)
    }
    scheduledRun = null
  }

  const startScheduledPlan = (plan: PageScenarioPlanRecord, localDate: string, scheduledAt: number): boolean => {
    if (scheduledRun || isBusyScenarioState(service.status())) return false
    let canonical: ReturnType<typeof validateCanonical>
    try {
      canonical = validateCanonical({
        pageTabId: plan.pageTabId,
        scheduleKind: plan.scheduleKind,
        localDate: plan.localDate,
        minuteOfDay: plan.minuteOfDay,
        accountConcurrency: plan.accountConcurrency,
        accountIds: plan.accountIds,
        scenarioId: plan.scenarioId,
        enabled: true
      })
    } catch (error) {
      setPlanStatus(plan.id, 'needs_attention', error instanceof Error ? error.message : String(error))
      return false
    }

    let prepared: ReturnType<ScenarioPostActionAdapter['prepareScenarioRun']>
    try {
      prepared = postAdapter.prepareScenarioRun([plan.scenarioId])
    } catch (error) {
      setPlanStatus(plan.id, 'needs_attention', error instanceof Error ? error.message : String(error))
      return false
    }

    const occurrence = createOccurrence(plan, localDate, scheduledAt, canonical.page.pageUid)
    if (!occurrence) return false
    const payload: ScenarioRunnerStartPayload = {
      accountIds: [...plan.accountIds],
      scenarioIds: [plan.scenarioId],
      settings: createPageScenarioRunnerSettings(plan.accountConcurrency),
      executionContext: { kind: 'page', pageTabId: plan.pageTabId, pageUid: canonical.page.pageUid }
    }

    try {
      const snapshot = service.start(payload)
      postAdapter.beginScenarioRun(snapshot.runId, payload.accountIds, prepared)
      const now = Date.now()
      markOccurrence(occurrence.id, 'running', null, snapshot.runId, now, false)
      scheduledRun = { planId: plan.id, occurrenceId: occurrence.id, runId: snapshot.runId, scheduleKind: plan.scheduleKind }
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('Đang có một phiên Kịch Bản chạy')) {
        options.database.prepare("DELETE FROM page_scenario_plan_occurrences WHERE id = ? AND status = 'pending'").run(occurrence.id)
        return false
      }
      service.stop()
      markOccurrence(occurrence.id, 'needs_attention', message, null, Date.now(), true)
      setPlanStatus(plan.id, 'needs_attention', message)
      return false
    }
  }

  const tick = () => {
    if (disposed || ticking) return
    ticking = true
    try {
      finalizeScheduledRun()
      if (scheduledRun || isBusyScenarioState(service.status())) return

      const now = Date.now()
      const localDate = localDateKey(new Date(now))
      const rows = options.database.prepare(`
        SELECT id FROM page_scenario_plans
        WHERE status = 'active'
        ORDER BY CASE schedule_kind WHEN 'specific_date' THEN 0 ELSE 1 END,
          COALESCE(local_date, ?), minute_of_day, id
      `).all(localDate) as Array<{ id: number }>
      for (const row of rows) {
        const plan = getPlan(row.id)
        if (!plan) continue
        if (plan.scheduleKind === 'specific_date' && plan.localDate !== localDate) continue
        if (occurrenceExists(plan.id, localDate)) continue
        const scheduledAt = scheduledAtFor(localDate, plan.minuteOfDay)
        if (scheduledAt > now) continue
        if (startScheduledPlan(plan, localDate, scheduledAt)) break
      }
    } finally {
      ticking = false
    }
  }

  const saveSchedule = (payload: SavePageScenarioSchedulePayload): PageScenarioPlanRecord[] => {
    const minuteOfDays = normalizePageScenarioScheduleMinutes(payload.input.minuteOfDays)
    const planIds = positiveUniqueScenarioIds(payload.planIds ?? [])
    return options.database.transaction(() => {
      for (const planId of planIds) {
        const existing = getPlan(planId)
        if (!existing) throw new Error(`Không tìm thấy slot lịch Kịch bản Page #${planId}.`)
        if (existing.pageTabId !== payload.input.pageTabId) throw new Error('Slot lịch không thuộc đúng Page đang sửa.')
        const latest = listOccurrences(planId, 1)[0]
        if (latest?.status === 'pending' || latest?.status === 'running') throw new Error('Lịch đang có lượt chạy; hãy chờ kết thúc rồi sửa.')
        if (payload.input.scheduleKind === 'specific_date' && payload.input.localDate && listOccurrences(planId, 1000).some((item) => item.localDate === payload.input.localDate)) {
          throw new Error(`Ngày ${payload.input.localDate} đã có lượt chạy; hãy chọn ngày khác để tránh chạy trùng.`)
        }
      }

      const saved: PageScenarioPlanRecord[] = []
      for (let index = 0; index < minuteOfDays.length; index += 1) {
        const input: SavePageScenarioPlanInput = {
          pageTabId: payload.input.pageTabId,
          scheduleKind: payload.input.scheduleKind,
          localDate: payload.input.scheduleKind === 'specific_date' ? payload.input.localDate : null,
          minuteOfDay: minuteOfDays[index]!,
          accountConcurrency: payload.input.accountConcurrency,
          accountIds: [...payload.input.accountIds],
          scenarioId: payload.input.scenarioId,
          enabled: payload.input.enabled
        }
        const existingId = planIds[index]
        saved.push(existingId ? updatePlan(existingId, input) : createPlan(input))
      }
      for (const staleId of planIds.slice(minuteOfDays.length)) {
        if (listOccurrences(staleId, 1).length) throw new Error('Không thể xóa bớt giờ đã có lịch sử chạy; hãy giữ giờ đó hoặc tạo lịch mới.')
        options.database.prepare('DELETE FROM page_scenario_plans WHERE id = ?').run(staleId)
      }
      return saved
    })()
  }

  const getDashboard = (pageTabId: number): PageScenarioScheduleDashboard => {
    if (!Number.isSafeInteger(pageTabId) || pageTabId <= 0) throw new Error('Page không hợp lệ.')
    return {
      plans: listPlans(pageTabId).map((plan): PageScenarioPlanView => ({ ...plan, latestOccurrence: listOccurrences(plan.id, 1)[0] ?? null }))
    }
  }

  recoverInterruptedOccurrences()

  ipcMain.handle(SCENARIO_RUNNER_IPC.start, (_event, payload: ScenarioRunnerStartPayload) => {
    finalizeScheduledRun()
    if (scheduledRun) throw new Error('Lịch Kịch bản Page đang chạy; hãy chờ lượt lịch hiện tại kết thúc.')
    const prepared = postAdapter.prepareScenarioRun(payload.scenarioIds)
    const snapshot = service.start(payload)
    postAdapter.beginScenarioRun(snapshot.runId, payload.accountIds, prepared)
    return snapshot
  })
  ipcMain.handle(SCENARIO_RUNNER_IPC.status, () => {
    finalizeScheduledRun()
    const snapshot = service.status()
    if (snapshot && isTerminalScenarioState(snapshot.state)) postAdapter.finishScenarioRun(snapshot.runId)
    return snapshot
  })
  ipcMain.handle(SCENARIO_RUNNER_IPC.stop, () => service.stop())

  ipcMain.handle(PAGE_SCENARIO_SCHEDULE_IPC.dashboard, (_event, payload: { pageTabId: number }) => getDashboard(payload.pageTabId))
  ipcMain.handle(PAGE_SCENARIO_SCHEDULE_IPC.saveSchedule, (_event, payload: SavePageScenarioSchedulePayload) => saveSchedule(payload))
  ipcMain.handle(PAGE_SCENARIO_SCHEDULE_IPC.deleteSchedule, (_event, payload: { planIds: number[] }) => {
    const planIds = positiveUniqueScenarioIds(payload.planIds)
    return options.database.transaction(() => {
      for (const planId of planIds) {
        const latest = listOccurrences(planId, 1)[0]
        if (latest?.status === 'pending' || latest?.status === 'running') throw new Error('Không thể xóa lịch đang chạy.')
        options.database.prepare('DELETE FROM page_scenario_plans WHERE id = ?').run(planId)
      }
      return true
    })()
  })
  ipcMain.handle(PAGE_SCENARIO_SCHEDULE_IPC.setScheduleEnabled, (_event, payload: SetPageScenarioScheduleEnabledPayload) => {
    const ids = positiveUniqueScenarioIds(payload.planIds)
    return options.database.transaction(() => ids.map((id) => {
      const plan = getPlan(id)
      if (!plan) throw new Error(`Không tìm thấy lịch Kịch bản Page #${id}.`)
      if (plan.pageTabId !== payload.pageTabId) throw new Error('Lịch không thuộc đúng Page đang thao tác.')
      const latest = listOccurrences(id, 1)[0]
      if (!payload.enabled && (latest?.status === 'pending' || latest?.status === 'running')) throw new Error('Không thể tạm dừng lịch đang chạy.')
      return setPlanStatus(id, payload.enabled ? 'active' : 'disabled', null)
    }))()
  })

  const timer = setInterval(tick, 1_000)
  timer.unref?.()
  tick()

  return {
    dispose: () => {
      disposed = true
      clearInterval(timer)
      service.dispose()
      for (const channel of Object.values(SCENARIO_RUNNER_IPC)) ipcMain.removeHandler(channel)
      for (const channel of Object.values(PAGE_SCENARIO_SCHEDULE_IPC)) ipcMain.removeHandler(channel)
    }
  }
}
