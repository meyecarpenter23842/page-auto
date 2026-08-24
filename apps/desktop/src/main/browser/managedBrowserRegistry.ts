const managedBrowserEndpoints = new Map<number, string>()

export function setManagedBrowserEndpoint(accountId: number, endpoint: string): void {
  const normalized = endpoint.trim()
  if (!normalized) {
    managedBrowserEndpoints.delete(accountId)
    return
  }
  managedBrowserEndpoints.set(accountId, normalized)
}

export function getManagedBrowserEndpoint(accountId: number): string | null {
  return managedBrowserEndpoints.get(accountId) ?? null
}

export function clearManagedBrowserEndpoint(accountId: number): void {
  managedBrowserEndpoints.delete(accountId)
}

export function clearAllManagedBrowserEndpoints(): void {
  managedBrowserEndpoints.clear()
}
