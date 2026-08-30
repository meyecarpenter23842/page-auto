import { safeStorage } from 'electron'
import type Database from 'better-sqlite3'
import type { GoogleCloudCredentialView } from '../../shared/aiAgents'
import type { GoogleServiceAccountCredential } from './googleServiceAccountCredential'

const GOOGLE_CLOUD_CREDENTIAL_STORAGE_KEY = 'ai.provider.google-agent-runtime.credential.v1'

interface StoredGoogleServiceAccountCredential {
  type: 'service_account'
  projectId: string
  clientEmail: string
  privateKey: string
  tokenUri: string
  sourceFileName: string
}

export class AiGoogleCloudCredentialStore {
  constructor(private readonly client: Database.Database) {}

  configured(): boolean {
    return Boolean(this.readEncrypted())
  }

  view(): GoogleCloudCredentialView {
    const credential = this.tryGet()
    return {
      configured: Boolean(credential),
      projectId: credential?.projectId ?? null,
      serviceAccountEmail: credential?.clientEmail ?? null,
      sourceFileName: credential?.sourceFileName ?? null
    }
  }

  save(credential: GoogleServiceAccountCredential): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error(
        'Windows chưa sẵn sàng cơ chế mã hóa secret. Page-Auto sẽ không lưu private key plaintext.'
      )
    }

    const stored: StoredGoogleServiceAccountCredential = { ...credential }
    const encrypted = safeStorage.encryptString(JSON.stringify(stored)).toString('base64')
    this.client.prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
    `).run(GOOGLE_CLOUD_CREDENTIAL_STORAGE_KEY, encrypted, Date.now())
  }

  clear(): void {
    this.client.prepare(
      'DELETE FROM app_settings WHERE key = ?'
    ).run(GOOGLE_CLOUD_CREDENTIAL_STORAGE_KEY)
  }

  get(): GoogleServiceAccountCredential {
    const credential = this.tryGet()
    if (!credential) {
      throw new Error(
        'Chưa kết nối Google Cloud. Mở Quản lý Agent và chọn service-account JSON.'
      )
    }
    return credential
  }

  private tryGet(): GoogleServiceAccountCredential | null {
    const encrypted = this.readEncrypted()
    if (!encrypted) return null
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Không giải mã được Google Cloud credential trên máy hiện tại.')
    }

    try {
      const raw = safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
      const parsed = JSON.parse(raw) as StoredGoogleServiceAccountCredential
      if (
        parsed.type !== 'service_account'
        || !parsed.projectId
        || !parsed.clientEmail
        || !parsed.privateKey
      ) {
        throw new Error('credential-invalid')
      }
      return parsed
    } catch {
      throw new Error(
        'Google Cloud credential đã lưu không giải mã được. Hãy kết nối lại service-account JSON.'
      )
    }
  }

  private readEncrypted(): string {
    const row = this.client.prepare(
      'SELECT value FROM app_settings WHERE key = ?'
    ).get(GOOGLE_CLOUD_CREDENTIAL_STORAGE_KEY) as { value: string } | undefined
    return row?.value?.trim() ?? ''
  }
}
