import { safeStorage } from 'electron'

export interface EmailSecretCipher {
  encrypt(value: string): string
  decrypt(ciphertext: string): string
}

export class ElectronEmailSecretCipher implements EmailSecretCipher {
  encrypt(value: string): string {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Windows secure storage chưa sẵn sàng; OAuth token chưa được lưu.')
    }
    return safeStorage.encryptString(value).toString('base64')
  }

  decrypt(ciphertext: string): string {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Windows secure storage chưa sẵn sàng; không thể đọc OAuth token.')
    }
    return safeStorage.decryptString(Buffer.from(ciphertext, 'base64'))
  }
}
