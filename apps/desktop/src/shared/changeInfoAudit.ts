export const CHANGE_INFO_AUDIT_IPC = {
  bio: 'change-info:audit:bio'
} as const

export interface ChangeInfoBioAuditPayload {
  accountId: number
}

export interface ChangeInfoAuditControlEvidence {
  tag: string
  role: string | null
  ariaLabel: string | null
  title: string | null
  text: string
  inputType: string | null
  contentEditable: boolean
}

export interface ChangeInfoAuditRegionEvidence {
  text: string
  controls: ChangeInfoAuditControlEvidence[]
}

export interface ChangeInfoBioAuditEvidence {
  url: string
  title: string
  locale: string | null
  screenshotPath: string | null
  relevantControls: ChangeInfoAuditControlEvidence[]
  relevantRegions: ChangeInfoAuditRegionEvidence[]
}

export type ChangeInfoBioAuditResult =
  | {
      status: 'success'
      accountId: number
      uid: string
      message: string
      evidence: ChangeInfoBioAuditEvidence
    }
  | {
      status: 'needs_attention' | 'failed'
      accountId: number
      uid: string
      code: string
      message: string
      evidence?: ChangeInfoBioAuditEvidence
    }

export interface ChangeInfoAuditApi {
  auditBio(payload: ChangeInfoBioAuditPayload): Promise<ChangeInfoBioAuditResult>
}
