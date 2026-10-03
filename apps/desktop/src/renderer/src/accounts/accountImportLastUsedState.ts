import {
  ACCOUNT_IMPORT_FIELDS,
  type AccountImportField,
  type AccountImportMapping,
  type AccountImportOperation
} from '../../../shared/accounts'
import {
  DEFAULT_CUSTOM_MAPPING,
  MIN_CUSTOM_MAPPING_COLUMNS,
  normalizeCustomMapping
} from './accountManagerModel'

export interface AccountImportLastUsedState {
  delimiter: string
  mapping: AccountImportMapping
}

interface LastUsedStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

const VALID_IMPORT_FIELDS = new Set<string>(['ignore', ...ACCOUNT_IMPORT_FIELDS])
const STORAGE_PREFIX = 'page-auto.account-import.last-used.'

export function accountImportLastUsedStorageKey(operation: AccountImportOperation): string {
  return `${STORAGE_PREFIX}${operation}`
}

function browserStorage(): LastUsedStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function normalizeStoredMapping(value: unknown): AccountImportMapping {
  if (!Array.isArray(value)) return [...DEFAULT_CUSTOM_MAPPING]
  const mapping = value.map((item): AccountImportField | 'ignore' =>
    typeof item === 'string' && VALID_IMPORT_FIELDS.has(item)
      ? item as AccountImportField | 'ignore'
      : 'ignore'
  )
  return normalizeCustomMapping(mapping, Math.max(mapping.length, MIN_CUSTOM_MAPPING_COLUMNS))
}

export function loadAccountImportLastUsedState(
  operation: AccountImportOperation,
  storage: LastUsedStorage | null = browserStorage()
): AccountImportLastUsedState {
  const fallback: AccountImportLastUsedState = {
    delimiter: '|',
    mapping: [...DEFAULT_CUSTOM_MAPPING]
  }
  if (!storage) return fallback

  try {
    const raw = storage.getItem(accountImportLastUsedStorageKey(operation))
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as { delimiter?: unknown; mapping?: unknown }
    return {
      delimiter: typeof parsed.delimiter === 'string' ? parsed.delimiter : fallback.delimiter,
      mapping: normalizeStoredMapping(parsed.mapping)
    }
  } catch {
    return fallback
  }
}

export function saveAccountImportLastUsedState(
  operation: AccountImportOperation,
  state: AccountImportLastUsedState,
  storage: LastUsedStorage | null = browserStorage()
): void {
  if (!storage) return
  try {
    storage.setItem(accountImportLastUsedStorageKey(operation), JSON.stringify({
      delimiter: state.delimiter,
      mapping: normalizeStoredMapping(state.mapping)
    }))
  } catch {
    // UI preference persistence must never block import/update.
  }
}
