export type AppTheme = 'light' | 'dark'

export const APP_THEME_STORAGE_KEY = 'page-auto:theme'

type ThemeReadableStorage = Pick<Storage, 'getItem'>
type ThemeWritableStorage = Pick<Storage, 'setItem'>

function isAppTheme(value: string | null): value is AppTheme {
  return value === 'light' || value === 'dark'
}

function browserStorage(): Storage | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

export function readStoredTheme(storage?: ThemeReadableStorage): AppTheme {
  try {
    const value = (storage ?? browserStorage())?.getItem(APP_THEME_STORAGE_KEY) ?? null
    return isAppTheme(value) ? value : 'light'
  } catch {
    return 'light'
  }
}

export function applyTheme(theme: AppTheme, root?: HTMLElement): void {
  const target = root ?? (typeof document !== 'undefined' ? document.documentElement : undefined)
  if (!target) return
  target.dataset.theme = theme
  target.style.colorScheme = theme
}

export function saveTheme(theme: AppTheme, storage?: ThemeWritableStorage): void {
  try {
    ;(storage ?? browserStorage())?.setItem(APP_THEME_STORAGE_KEY, theme)
  } catch {
    // Theme persistence is a UI preference. Failure must never block the app.
  }
  applyTheme(theme)
}

export function initializeTheme(): AppTheme {
  const theme = readStoredTheme()
  applyTheme(theme)
  return theme
}
