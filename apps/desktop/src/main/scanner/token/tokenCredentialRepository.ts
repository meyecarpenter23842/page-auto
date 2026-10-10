import { Buffer } from 'node:buffer'
import type Database from 'better-sqlite3'
import {
  SCANNER_TOKEN_VALIDATION_STATES,
  type ScannerTokenCredentialSummary,
  type ScannerTokenValidationState
} from '../../../shared/scanner'

interface TokenCredentialRow extends Record<string, unknown> {
  id: string
  label: string
  encryptedSecret: Buffer
  tokenLast4: string
  tokenFingerprint: string
  validationState: string
  validationMessage: string | null
  subjectId: string | null
  subjectName: string | null
  validatedAt: number | null
  createdAt: number
  updatedAt: number
}

export interface CreateScannerTokenCredentialRecord {
  id: string
  label: string
  encryptedSecret: Buffer
  tokenLast4: string
  tokenFingerprint: string
}

export interface ScannerTokenValidationUpdate {
  state: ScannerTokenValidationState
  message: string | null
  subjectId: string | null
  subjectName: string | null
}

export interface ScannerTokenSecretRecord {
  id: string
  encryptedSecret: Buffer
}

function validationState(value: string): ScannerTokenValidationState {
  if ((SCANNER_TOKEN_VALIDATION_STATES as readonly string[]).includes(value)) {
    return value as ScannerTokenValidationState
  }
  return 'unverified'
}

function summaryFromRow(row: TokenCredentialRow): ScannerTokenCredentialSummary {
  const last4 = String(row.tokenLast4 ?? '').slice(-4)
  return {
    id: String(row.id),
    label: String(row.label),
    maskedToken: last4 ? `••••${last4}` : '••••',
    fingerprint: String(row.tokenFingerprint).slice(0, 12),
    validationState: validationState(String(row.validationState)),
    validationMessage: row.validationMessage === null ? null : String(row.validationMessage),
    subjectId: row.subjectId === null ? null : String(row.subjectId),
    subjectName: row.subjectName === null ? null : String(row.subjectName),
    validatedAt: row.validatedAt === null ? null : Number(row.validatedAt),
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt)
  }
}

export class ScannerTokenCredentialRepository {
  constructor(private readonly client: Database.Database) {}

  list(): ScannerTokenCredentialSummary[] {
    const rows = this.client.prepare(`
      SELECT
        id,
        label,
        encrypted_secret AS encryptedSecret,
        token_last4 AS tokenLast4,
        token_fingerprint AS tokenFingerprint,
        validation_state AS validationState,
        validation_message AS validationMessage,
        subject_id AS subjectId,
        subject_name AS subjectName,
        validated_at AS validatedAt,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM scanner_token_credentials
      WHERE credential_type = 'access_token'
      ORDER BY updated_at DESC, id
    `).all() as TokenCredentialRow[]
    return rows.map(summaryFromRow)
  }

  get(id: string): ScannerTokenCredentialSummary | null {
    const row = this.readRow(id)
    return row ? summaryFromRow(row) : null
  }

  getSecretRecord(id: string): ScannerTokenSecretRecord | null {
    const normalized = id.trim()
    if (!normalized) return null
    const row = this.client.prepare(`
      SELECT id, encrypted_secret AS encryptedSecret
      FROM scanner_token_credentials
      WHERE id = ? AND credential_type = 'access_token'
    `).get(normalized) as { id: string; encryptedSecret: Buffer } | undefined
    if (!row) return null
    return { id: String(row.id), encryptedSecret: Buffer.from(row.encryptedSecret) }
  }

  findByFingerprint(fingerprint: string): ScannerTokenCredentialSummary | null {
    const normalized = fingerprint.trim()
    if (!normalized) return null
    const row = this.client.prepare(`
      SELECT
        id,
        label,
        encrypted_secret AS encryptedSecret,
        token_last4 AS tokenLast4,
        token_fingerprint AS tokenFingerprint,
        validation_state AS validationState,
        validation_message AS validationMessage,
        subject_id AS subjectId,
        subject_name AS subjectName,
        validated_at AS validatedAt,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM scanner_token_credentials
      WHERE token_fingerprint = ? AND credential_type = 'access_token'
    `).get(normalized) as TokenCredentialRow | undefined
    return row ? summaryFromRow(row) : null
  }

  create(input: CreateScannerTokenCredentialRecord, now = Date.now()): ScannerTokenCredentialSummary {
    const id = input.id.trim()
    const label = input.label.trim()
    if (!id) throw new Error('Credential ID là bắt buộc.')
    if (!label) throw new Error('Tên Access Token là bắt buộc.')
    this.client.prepare(`
      INSERT INTO scanner_token_credentials(
        id, credential_type, label, encrypted_secret, token_last4, token_fingerprint,
        validation_state, validation_message, subject_id, subject_name,
        validated_at, created_at, updated_at
      ) VALUES (?, 'access_token', ?, ?, ?, ?, 'unverified', NULL, NULL, NULL, NULL, ?, ?)
    `).run(
      id,
      label,
      input.encryptedSecret,
      input.tokenLast4,
      input.tokenFingerprint,
      now,
      now
    )
    return this.require(id)
  }

  updateEncryptedSecret(id: string, encryptedSecret: Buffer, now = Date.now()): void {
    const normalized = id.trim()
    const result = this.client.prepare(`
      UPDATE scanner_token_credentials
      SET encrypted_secret = ?, updated_at = ?
      WHERE id = ? AND credential_type = 'access_token'
    `).run(encryptedSecret, now, normalized)
    if (result.changes === 0) throw new Error(`Không tìm thấy Access Token credential ${normalized}.`)
  }

  updateValidation(
    id: string,
    validation: ScannerTokenValidationUpdate,
    now = Date.now()
  ): ScannerTokenCredentialSummary {
    const normalized = id.trim()
    const result = this.client.prepare(`
      UPDATE scanner_token_credentials
      SET validation_state = ?, validation_message = ?, subject_id = ?, subject_name = ?,
          validated_at = ?, updated_at = ?
      WHERE id = ? AND credential_type = 'access_token'
    `).run(
      validation.state,
      validation.message,
      validation.subjectId,
      validation.subjectName,
      now,
      now,
      normalized
    )
    if (result.changes === 0) throw new Error(`Không tìm thấy Access Token credential ${normalized}.`)
    return this.require(normalized)
  }

  private readRow(id: string): TokenCredentialRow | null {
    const normalized = id.trim()
    if (!normalized) return null
    const row = this.client.prepare(`
      SELECT
        id,
        label,
        encrypted_secret AS encryptedSecret,
        token_last4 AS tokenLast4,
        token_fingerprint AS tokenFingerprint,
        validation_state AS validationState,
        validation_message AS validationMessage,
        subject_id AS subjectId,
        subject_name AS subjectName,
        validated_at AS validatedAt,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM scanner_token_credentials
      WHERE id = ? AND credential_type = 'access_token'
    `).get(normalized) as TokenCredentialRow | undefined
    return row ?? null
  }

  private require(id: string): ScannerTokenCredentialSummary {
    const record = this.get(id)
    if (!record) throw new Error(`Không tìm thấy Access Token credential ${id}.`)
    return record
  }
}
