import type { ScanResultRecord } from '../../../shared/scanner'

export interface GroupSelectionFilters {
  membersMin: number
  membersMax: number
  privacy: string
  location: string
}

function numericValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim()
}

export function groupResultMatchesSelectionFilters(
  result: ScanResultRecord,
  filters: GroupSelectionFilters
): boolean {
  if (result.status !== 'success' && result.status !== 'partial_success') return false

  const members = numericValue(result.data.members)
  const minimum = Math.max(0, Number.isFinite(filters.membersMin) ? filters.membersMin : 0)
  const maximum = Math.max(0, Number.isFinite(filters.membersMax) ? filters.membersMax : 0)
  if (minimum > 0 && (members === null || members < minimum)) return false
  if (maximum > 0 && (members === null || members > maximum)) return false

  const wantedPrivacy = normalizeText(filters.privacy)
  const actualPrivacy = normalizeText(textValue(result.data.privacy))
  if (wantedPrivacy === 'public' && actualPrivacy !== 'public') return false
  if (wantedPrivacy === 'private' && actualPrivacy !== 'private') return false

  const wantedLocation = normalizeText(filters.location)
  if (wantedLocation) {
    const haystack = normalizeText([
      textValue(result.data.location),
      textValue(result.data.filterText)
    ].filter(Boolean).join(' '))
    if (!haystack.includes(wantedLocation)) return false
  }

  return true
}

export function eligibleGroupResultIds(
  results: ScanResultRecord[],
  filters: GroupSelectionFilters
): number[] {
  return results
    .filter((result) => groupResultMatchesSelectionFilters(result, filters))
    .map((result) => result.id)
}
