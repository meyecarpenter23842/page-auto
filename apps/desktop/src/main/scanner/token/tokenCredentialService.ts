import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import type {
  CreateScannerTokenCredentialInput,
  ScannerSourceCapabilities,
  ScannerTokenCredentialSummary
} from '../../../shared/scanner'
import { ScannerTokenCredentialRepository } from './tokenCredentialRepository'
import {
  SCANNER_META_GRAPH_API_VERSION,
  type ScannerTokenValidationResult,
  type ScannerTokenValidatorLike
} from './tokenValidator'

export interface ScannerTokenSecretDecryptResult {
  value: string
  shouldReEncrypt: boolean
}

export interface ScannerTokenSecretStore {
  isAvailable(): Promise<boolean>
  encrypt(value: string): Promise<Buffer>
  decrypt(value: Buffer): Promise<ScannerTokenSecretDecryptResult>
}

function normalizeLabel(value: string): string {
  const label = value.trim()
  if (!label) throw new Error('Tên Access Token là bắt buộc.')
  if (label.length > 120) throw new Error('Tên Access Token tối đa 120 ký tự.')
  return label
}

function normalizeAccessToken(value: string): string {
  const token = value.trim()
  if (!token) throw new Error('Access Token là bắt buộc.')
  if (token.length < 12) throw new Error('Access Token quá ngắn để lưu.')
  if (/\s/.test(token)) throw new Error('Access Token không được chứa khoảng trắng.')
  return token
}

function fingerprint(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

function safeValidationFailure(): ScannerTokenValidationResult {
  return {
    state: 'unverified',
    message: 'Không thể xác minh Access Token lúc này; secret đã được lưu mã hóa cục bộ.',
    subjectId: null,
    subjectName: null
  }
}

export class ScannerTokenCredentialService {
  constructor(
    private readonly repository: ScannerTokenCredentialRepository,
    private readonly secretStore: ScannerTokenSecretStore,
    private readonly validator: ScannerTokenValidatorLike
  ) {}

  async getCapabilities(): Promise<ScannerSourceCapabilities> {
    const tokenStorageAvailable = await this.secretStore.isAvailable().catch(() => false)
    return {
      tokenStorageAvailable,
      tokenScanningSupported: false,
      autoAcquireTokenSupported: false,
      graphApiVersion: SCANNER_META_GRAPH_API_VERSION
    }
  }

  list(): ScannerTokenCredentialSummary[] {
    return this.repository.list()
  }

  async create(input: CreateScannerTokenCredentialInput): Promise<ScannerTokenCredentialSummary> {
    const label = normalizeLabel(input.label)
    const accessToken = normalizeAccessToken(input.accessToken)
    if (!await this.secretStore.isAvailable().catch(() => false)) {
      throw new Error('Mã hóa hệ điều hành chưa sẵn sàng; Page-Auto từ chối lưu Access Token dạng plaintext.')
    }

    const tokenFingerprint = fingerprint(accessToken)
    const duplicate = this.repository.findByFingerprint(tokenFingerprint)
    if (duplicate) throw new Error(`Access Token này đã được lưu với tên “${duplicate.label}”.`)

    const encryptedSecret = await this.secretStore.encrypt(accessToken)
    const created = this.repository.create({
      id: randomUUID(),
      label,
      encryptedSecret,
      tokenLast4: accessToken.slice(-4),
      tokenFingerprint
    })

    const validation = await this.validator.validate(accessToken).catch(() => safeValidationFailure())
    return this.repository.updateValidation(created.id, validation)
  }

  async validate(credentialId: string): Promise<ScannerTokenCredentialSummary> {
    const record = this.repository.getSecretRecord(credentialId)
    if (!record) throw new Error('Không tìm thấy Access Token credential cần xác minh.')
    if (!await this.secretStore.isAvailable().catch(() => false)) {
      throw new Error('Mã hóa hệ điều hành chưa sẵn sàng; không thể giải mã Access Token để xác minh.')
    }

    const decrypted = await this.secretStore.decrypt(record.encryptedSecret)
    if (decrypted.shouldReEncrypt) {
      const refreshedCipher = await this.secretStore.encrypt(decrypted.value)
      this.repository.updateEncryptedSecret(record.id, refreshedCipher)
    }
    const validation = await this.validator.validate(decrypted.value).catch(() => safeValidationFailure())
    return this.repository.updateValidation(record.id, validation)
  }
}
