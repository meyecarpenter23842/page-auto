import { safeStorage } from 'electron'

export interface TokenProtector {
  protect: (value: string) => string
  unprotect: (value: string) => string
}

export class ElectronSafeStorageTokenProtector implements TokenProtector {
  protect(value: string): string {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Windows secure storage chưa sẵn sàng; không lưu OAuth token plaintext.')
    }
    return safeStorage.encryptString(value).toString('base64')
  }

  unprotect(value: string): string {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Windows secure storage chưa sẵn sàng để đọc OAuth token.')
    }
    return safeStorage.decryptString(Buffer.from(value, 'base64'))
  }
}
