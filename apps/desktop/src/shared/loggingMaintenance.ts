export interface LogCleanupResult {
  cutoffTimestamp: number | null
  deletedRows: number
  deletedEvidenceFiles: number
  skipped: boolean
  message: string
}
