import { safeStorage } from 'electron'
import type Database from 'better-sqlite3'

const GEMINI_SECRET_STORAGE_KEY = 'ai.provider.google-gemini.secret.v1'

export class AiGeminiSecretStore {
  constructor(private readonly client: Database.Database) {}

  configured(): boolean {
    return Boolean(this.readEncrypted())
  }

  save(apiKey: string): void {
    const normalized = apiKey.trim()
    if (!normalized) throw new Error('API key Gemini không được để trống.')
    if (normalized.length > 4096) throw new Error('API key Gemini quá dài.')
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Windows chưa sẵn sàng cơ chế mã hóa secret. Không lưu API key plaintext.')
    }
    const encrypted = safeStorage.encryptString(normalized).toString('base64')
    this.client.prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
    `).run(GEMINI_SECRET_STORAGE_KEY, encrypted, Date.now())
  }

  clear(): void {
    this.client.prepare('DELETE FROM app_settings WHERE key = ?').run(GEMINI_SECRET_STORAGE_KEY)
  }

  get(): string {
    const encrypted = this.readEncrypted()
    if (!encrypted) throw new Error('Chưa cấu hình Gemini API key trong Quản lý Agent.')
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Không giải mã được Gemini API key trên máy hiện tại.')
    try {
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
    } catch {
      throw new Error('Gemini API key đã lưu không giải mã được. Hãy nhập lại key.')
    }
  }

  private readEncrypted(): string {
    const row = this.client.prepare('SELECT value FROM app_settings WHERE key = ?').get(GEMINI_SECRET_STORAGE_KEY) as { value: string } | undefined
    return row?.value?.trim() ?? ''
  }
}
