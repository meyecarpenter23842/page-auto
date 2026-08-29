import type { Locator, Page } from 'playwright-core'
import type { ActionConfig, ActionResult } from '../../../../shared/actionRegistry'
import type { ActionRunControl, ActionRunRequest } from '../../../../shared/actionRuntime'

export type ActionPageResolver = (request: ActionRunRequest) => Promise<Page | null>

export interface BaseViewActionDependencies {
  resolvePage: ActionPageResolver
  navigationTimeoutMs?: number
  actionDelayMinMs?: number | undefined
  actionDelayMaxMs?: number | undefined
}

export function configNumber(config: ActionConfig, key: string, fallback = 0): number {
  const value = config[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function configBoolean(config: ActionConfig, key: string): boolean {
  return config[key] === true
}

export function configString(config: ActionConfig, key: string): string {
  const value = config[key]
  return typeof value === 'string' ? value : ''
}

export function selectedReactions(config: ActionConfig): string[] {
  const mapping = [
    ['reactionLike', 'like'], ['reactionLove', 'love'], ['reactionCare', 'care'],
    ['reactionHaha', 'haha'], ['reactionWow', 'wow'], ['reactionSad', 'sad'], ['reactionAngry', 'angry']
  ] as const
  const selected = mapping.filter(([key]) => configBoolean(config, key)).map(([, reaction]) => reaction)
  return selected.length ? selected : ['like']
}

export function splitLines(value: string): string[] {
  return value.split(/\r?\n|\|/).map((item) => item.trim()).filter(Boolean)
}

export function pickRange(min: number, max: number): number {
  const low = Math.min(min, max)
  const high = Math.max(min, max)
  return high <= low ? low : Math.floor(low + Math.random() * (high - low + 1))
}

export function pickOne<T>(items: readonly T[]): T | undefined {
  return items.length ? items[Math.floor(Math.random() * items.length)] : undefined
}

export function shuffled<T>(items: readonly T[]): T[] {
  const output = [...items]
  for (let index = output.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1))
    const current = output[index]
    output[index] = output[target]!
    output[target] = current!
  }
  return output
}

export async function sleepWithControl(control: ActionRunControl, delayMs: number): Promise<boolean> {
  let remaining = Math.max(0, delayMs)
  while (remaining > 0) {
    if (control.isStopped()) return false
    await control.waitIfPaused()
    if (control.isStopped()) return false
    const chunk = Math.min(1000, remaining)
    await control.sleep(chunk)
    remaining -= chunk
  }
  return !control.isStopped()
}

export function browserActionDelayMs(dependencies: BaseViewActionDependencies): number {
  const minValue = dependencies.actionDelayMinMs
  const maxValue = dependencies.actionDelayMaxMs
  const rawMin = typeof minValue === 'number' && Number.isFinite(minValue) ? minValue : 0
  const rawMax = typeof maxValue === 'number' && Number.isFinite(maxValue) ? maxValue : rawMin
  const low = Math.max(0, Math.min(rawMin, rawMax))
  const high = Math.max(low, Math.max(rawMin, rawMax))
  if (high <= low) return Math.round(low)
  return Math.round(low + Math.random() * (high - low))
}

export async function paceBrowserAction(
  control: ActionRunControl,
  dependencies: BaseViewActionDependencies
): Promise<boolean> {
  return sleepWithControl(control, browserActionDelayMs(dependencies))
}

export async function firstVisible(page: Page | Locator, selectors: readonly string[]): Promise<Locator | null> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first()
    if (await locator.isVisible().catch(() => false)) return locator
  }
  return null
}

export async function clickFirstVisible(page: Page | Locator, selectors: readonly string[]): Promise<boolean> {
  const locator = await firstVisible(page, selectors)
  if (!locator) return false
  return locator.click({ timeout: 5000 }).then(() => true).catch(() => false)
}

export function browserUnavailable(label: string): ActionResult {
  return { status: 'failed', code: 'browser_unavailable', message: `${label}: không lấy được Playwright Page từ runtime.` }
}

export function navigationFailed(label: string, cause: unknown): ActionResult {
  return {
    status: 'failed',
    code: 'navigation_failed',
    message: `${label}: không mở được surface Facebook.`,
    data: { reason: cause instanceof Error ? cause.name : 'navigation_error' }
  }
}
