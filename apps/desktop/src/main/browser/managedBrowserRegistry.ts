interface ManagedBrowserEndpoint {
  endpoint: string
  profileDirectory: string | null
}

const managedBrowserEndpoints = new Map<number, ManagedBrowserEndpoint>()

function normalizedPath(value: string): string {
  return value.trim().replace(/[\\/]+$/g, '').toLowerCase()
}

export function setManagedBrowserEndpoint(accountId: number, endpoint: string, profileDirectory?: string): void {
  const normalized = endpoint.trim()
  if (!normalized) {
    managedBrowserEndpoints.delete(accountId)
    return
  }
  managedBrowserEndpoints.set(accountId, {
    endpoint: normalized,
    profileDirectory: profileDirectory?.trim() || null
  })
}

export function getManagedBrowserEndpoint(accountId: number, expectedProfileDirectory?: string): string | null {
  const managed = managedBrowserEndpoints.get(accountId)
  if (!managed) return null
  if (expectedProfileDirectory && managed.profileDirectory) {
    if (normalizedPath(managed.profileDirectory) !== normalizedPath(expectedProfileDirectory)) return null
  }
  if (expectedProfileDirectory && !managed.profileDirectory) return null
  return managed.endpoint
}

export function clearManagedBrowserEndpoint(accountId: number): void {
  managedBrowserEndpoints.delete(accountId)
}

export function clearAllManagedBrowserEndpoints(): void {
  managedBrowserEndpoints.clear()
}
