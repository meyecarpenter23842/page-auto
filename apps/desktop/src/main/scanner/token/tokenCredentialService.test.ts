import { Buffer } from 'node:buffer'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyScannerMigration } from '../../database/scannerMigration'
import { ScannerTokenCredentialRepository } from './tokenCredentialRepository'
import {
  ScannerTokenCredentialService,
  type ScannerTokenSecretStore
} from './tokenCredentialService'
import type { ScannerTokenValidatorLike } from './tokenValidator'

let db: Database.Database

class FakeSecretStore implements ScannerTokenSecretStore {
  readonly values = new Map<string, string>()
  available = true
  private nextId = 0

  async isAvailable(): Promise<boolean> {
    return this.available
  }

  async encrypt(value: string): Promise<Buffer> {
    const encrypted = Buffer.from(`cipher-${this.nextId++}`)
    this.values.set(encrypted.toString('hex'), value)
    return encrypted
  }

  async decrypt(value: Buffer): Promise<{ value: string; shouldReEncrypt: boolean }> {
    const secret = this.values.get(value.toString('hex'))
    if (!secret) throw new Error('missing fake secret')
    return { value: secret, shouldReEncrypt: false }
  }
}

beforeEach(() => {
  db = new Database(':memory:')
  db.exec(`
    CREATE TABLE __page_auto_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
    CREATE TABLE accounts (id INTEGER PRIMARY KEY NOT NULL);
  `)
  applyScannerMigration(db)
})

afterEach(() => db.close())

describe('ScannerTokenCredentialService', () => {
  it('stores only encrypted token bytes and returns masked metadata', async () => {
    const secretStore = new FakeSecretStore()
    const validator: ScannerTokenValidatorLike = {
      validate: async () => ({
        state: 'valid',
        message: 'validated fixture',
        subjectId: '12345',
        subjectName: 'Fixture Subject'
      })
    }
    const repository = new ScannerTokenCredentialRepository(db)
    const service = new ScannerTokenCredentialService(repository, secretStore, validator)
    const rawToken = 'scanner-secret-token-1234567890'

    const created = await service.create({ label: 'Token Page', accessToken: rawToken })
    const row = db.prepare(`
      SELECT encrypted_secret AS encryptedSecret, token_last4 AS tokenLast4, token_fingerprint AS fingerprint
      FROM scanner_token_credentials WHERE id = ?
    `).get(created.id) as { encryptedSecret: Buffer; tokenLast4: string; fingerprint: string }

    expect(created.maskedToken).toBe('••••7890')
    expect(created.validationState).toBe('valid')
    expect(created.subjectId).toBe('12345')
    expect(created).not.toHaveProperty('accessToken')
    expect(row.encryptedSecret.toString('utf8')).not.toContain(rawToken)
    expect(row.tokenLast4).toBe('7890')
    expect(row.fingerprint).toHaveLength(64)
  })

  it('rejects duplicate token fingerprints and never falls back to plaintext when storage is unavailable', async () => {
    const secretStore = new FakeSecretStore()
    const validator: ScannerTokenValidatorLike = {
      validate: async () => ({
        state: 'unverified',
        message: null,
        subjectId: null,
        subjectName: null
      })
    }
    const repository = new ScannerTokenCredentialRepository(db)
    const service = new ScannerTokenCredentialService(repository, secretStore, validator)
    const rawToken = 'duplicate-scanner-secret-token'

    await service.create({ label: 'Token A', accessToken: rawToken })
    await expect(service.create({ label: 'Token B', accessToken: rawToken })).rejects.toThrow('đã được lưu')

    secretStore.available = false
    await expect(service.create({ label: 'Token C', accessToken: 'another-scanner-secret-token' }))
      .rejects.toThrow('từ chối lưu Access Token dạng plaintext')
    expect(repository.list()).toHaveLength(1)
  })

  it('keeps credential secrets immutable and revalidates through the Main-only secret store', async () => {
    const secretStore = new FakeSecretStore()
    let validatedSecret = ''
    const validator: ScannerTokenValidatorLike = {
      validate: async (accessToken) => {
        validatedSecret = accessToken
        return {
          state: 'valid',
          message: null,
          subjectId: '777',
          subjectName: 'Token Owner'
        }
      }
    }
    const repository = new ScannerTokenCredentialRepository(db)
    const service = new ScannerTokenCredentialService(repository, secretStore, validator)
    const created = await service.create({ label: 'Immutable', accessToken: 'immutable-scanner-token-9876' })

    validatedSecret = ''
    const validated = await service.validate(created.id)

    expect(validatedSecret).toBe('immutable-scanner-token-9876')
    expect(validated.validationState).toBe('valid')
    expect(validated.subjectName).toBe('Token Owner')
  })
})
