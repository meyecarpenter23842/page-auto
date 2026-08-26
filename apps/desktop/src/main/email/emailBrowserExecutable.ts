import { isAbsolute, dirname, join, resolve } from 'node:path'

function environmentValue(env: NodeJS.ProcessEnv, names: string[]): string | null {
  for (const name of names) {
    const value = env[name]
    if (value?.trim()) return value.trim()
  }
  return null
}

function addCandidate(target: string[], seen: Set<string>, value: string | null | undefined): void {
  const normalized = value?.trim()
  if (!normalized) return
  const key = process.platform === 'win32' ? normalized.toLowerCase() : normalized
  if (seen.has(key)) return
  seen.add(key)
  target.push(normalized)
}

export function emailBrowserExecutableCandidates(
  profileRoot: string,
  requestedExecutable: string,
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const candidates: string[] = []
  const seen = new Set<string>()
  const requested = requestedExecutable.trim()

  // Manual Email browser selection is authoritative. Browser Auto must never
  // borrow the Facebook browser setting as a hidden fallback.
  if (requested) {
    addCandidate(candidates, seen, requested)
    return candidates
  }

  const normalizedRoot = profileRoot.trim()
  if (normalizedRoot && isAbsolute(normalizedRoot)) {
    const appRoot = dirname(resolve(normalizedRoot))
    for (const relativePath of [
      'chrome.exe',
      join('chrome', 'chrome.exe'),
      join('Chrome', 'chrome.exe'),
      join('chromium', 'chrome.exe'),
      join('Chromium', 'chrome.exe'),
      join('Chromium', 'Application', 'chrome.exe'),
      join('browser', 'chrome.exe'),
      join('Browser', 'chrome.exe'),
      join('Chrome-bin', 'chrome.exe')
    ]) {
      addCandidate(candidates, seen, join(appRoot, relativePath))
    }
  }

  const programFiles = environmentValue(env, ['PROGRAMFILES', 'ProgramFiles'])
  const programFilesX86 = environmentValue(env, ['PROGRAMFILES(X86)', 'ProgramFiles(x86)'])
  const localAppData = environmentValue(env, ['LOCALAPPDATA', 'LocalAppData'])

  for (const root of [programFiles, programFilesX86, localAppData]) {
    if (!root) continue
    addCandidate(candidates, seen, join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'))
  }
  for (const root of [programFiles, programFilesX86]) {
    if (!root) continue
    addCandidate(candidates, seen, join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
  }
  if (localAppData) {
    addCandidate(candidates, seen, join(localAppData, 'Chromium', 'Application', 'chrome.exe'))
  }

  return candidates
}
