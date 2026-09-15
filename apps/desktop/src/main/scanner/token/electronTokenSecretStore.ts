import { safeStorage } from 'electron'
import type { ScannerTokenSecretDecryptResult, ScannerTokenSecretStore } from './tokenCredentialService'

export class ElectronScannerTokenSecretStore implements ScannerTokenSecretStore {
  async isAvailable(): Promise<boolean> {
    try {
      return await safeStorage.isAsyncEncryptionAvailable()
    } catch {
      return false
    }
  }

  async encrypt(value: string): Promise<Buffer> {
    if (!await this.isAvailable()) {
      throw new Error('Mã hóa hệ điều hành chưa sẵn sàng.')
    }
    return safeStorage.encryptStringAsync(value)
  }

  async decrypt(value: Buffer): Promise<ScannerTokenSecretDecryptResult> {
    if (!await this.isAvailable()) {
      throw new Error('Mã hóa hệ điều hành chưa sẵn sàng.')
    }
    const decrypted = await safeStorage.decryptStringAsync(value)
    return {
      value: decrypted.result,
      shouldReEncrypt: decrypted.shouldReEncrypt
    }
  }
}
