import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'

/** UI-only state: no credentials, business config or IPC persistence. */
export function isGridString(value: unknown): value is string {
  return typeof value === 'string'
}

export function useGridPreference<T>(
  key: string,
  fallback: T,
  isValid: (value: unknown) => value is T
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key)
      if (raw !== null) {
        const parsed: unknown = JSON.parse(raw)
        if (isValid(parsed)) return parsed
      }
    } catch {
      // Storage may be unavailable or contain a stale value; use safe defaults.
    }
    return fallback
  })

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // UI stays usable when persistence is unavailable.
    }
  }, [key, value])

  return [value, setValue]
}
