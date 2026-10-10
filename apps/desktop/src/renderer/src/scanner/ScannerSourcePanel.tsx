import { useEffect, useMemo, useState } from 'react'
import type { AccountRecord } from '../../../shared/accounts'
import type {
  ScannerSourceCapabilities,
  ScannerTokenCredentialSummary
} from '../../../shared/scanner'

export type ScannerSourceMode = 'account' | 'token'

interface ScannerSourcePanelProps {
  accounts: AccountRecord[]
  accountId: number | null
  onAccountIdChange: (accountId: number | null) => void
  sourceMode: ScannerSourceMode
  onSourceModeChange: (mode: ScannerSourceMode) => void
  tokenCredentialId: string | null
  onTokenCredentialIdChange: (credentialId: string | null) => void
  locked: boolean
  onNotice: (message: string | null) => void
}

const VALIDATION_LABEL: Record<ScannerTokenCredentialSummary['validationState'], string> = {
  unverified: 'Chưa xác minh',
  valid: 'Hợp lệ',
  expired: 'Hết hạn',
  permission_limited: 'Thiếu quyền',
  invalid: 'Không hợp lệ',
  needs_reauth: 'Cần cấp lại'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function ScannerSourcePanel({
  accounts,
  accountId,
  onAccountIdChange,
  sourceMode,
  onSourceModeChange,
  tokenCredentialId,
  onTokenCredentialIdChange,
  locked,
  onNotice
}: ScannerSourcePanelProps) {
  const [credentials, setCredentials] = useState<ScannerTokenCredentialSummary[]>([])
  const [capabilities, setCapabilities] = useState<ScannerSourceCapabilities | null>(null)
  const [tokenLabel, setTokenLabel] = useState('')
  const [tokenSecret, setTokenSecret] = useState('')
  const [tokenBusy, setTokenBusy] = useState(false)

  const selectedCredential = useMemo(
    () => credentials.find((credential) => credential.id === tokenCredentialId) ?? null,
    [credentials, tokenCredentialId]
  )

  const loadTokenSources = async () => {
    const [nextCapabilities, nextCredentials] = await Promise.all([
      window.pageAutoScanner.getSourceCapabilities(),
      window.pageAutoScanner.listTokenCredentials()
    ])
    setCapabilities(nextCapabilities)
    setCredentials(nextCredentials)
    if (!tokenCredentialId && nextCredentials[0]) onTokenCredentialIdChange(nextCredentials[0].id)
  }

  useEffect(() => {
    void loadTokenSources().catch((error) => onNotice(errorMessage(error)))
  }, [])

  const createCredential = async () => {
    if (tokenBusy || locked) return
    setTokenBusy(true)
    onNotice(null)
    try {
      const created = await window.pageAutoScanner.createTokenCredential({
        label: tokenLabel,
        accessToken: tokenSecret
      })
      setTokenSecret('')
      setTokenLabel('')
      const nextCredentials = await window.pageAutoScanner.listTokenCredentials()
      setCredentials(nextCredentials)
      onTokenCredentialIdChange(created.id)
      onNotice(`Đã lưu “${created.label}” bằng mã hóa hệ điều hành · ${VALIDATION_LABEL[created.validationState]}.`)
    } catch (error) {
      onNotice(errorMessage(error))
    } finally {
      setTokenBusy(false)
    }
  }

  const validateCredential = async () => {
    if (!selectedCredential || tokenBusy || locked) return
    setTokenBusy(true)
    onNotice(null)
    try {
      const validated = await window.pageAutoScanner.validateTokenCredential({ credentialId: selectedCredential.id })
      setCredentials((current) => current.map((credential) => credential.id === validated.id ? validated : credential))
      onNotice(`${validated.label}: ${VALIDATION_LABEL[validated.validationState]}${validated.validationMessage ? ` · ${validated.validationMessage}` : ''}`)
    } catch (error) {
      onNotice(errorMessage(error))
    } finally {
      setTokenBusy(false)
    }
  }

  const storageAvailable = capabilities?.tokenStorageAvailable ?? false

  return (
    <div className="scanner-source-card" data-testid="scanner-source-panel">
      <div className="scanner-source-copy">
        <span className="scanner-section-kicker">NGUỒN QUÉT DÙNG CHUNG</span>
        <strong>Account / session hoặc Access Token</strong>
        <small>Account dùng Facebook Common Runtime. Token chỉ nhận từ người dùng, lưu mã hóa Main-only; Batch 3 chưa bật adapter quét bằng token.</small>
      </div>

      <div className="scanner-source-mode" role="group" aria-label="Nguồn quét">
        <button
          type="button"
          className={sourceMode === 'account' ? 'scanner-source-mode-button active' : 'scanner-source-mode-button'}
          aria-pressed={sourceMode === 'account'}
          disabled={locked}
          onClick={() => onSourceModeChange('account')}
        >Account/session</button>
        <button
          type="button"
          className={sourceMode === 'token' ? 'scanner-source-mode-button active' : 'scanner-source-mode-button'}
          aria-pressed={sourceMode === 'token'}
          disabled={locked}
          onClick={() => onSourceModeChange('token')}
        >Access Token</button>
      </div>

      {sourceMode === 'account' ? (
        <label>
          Account
          <select
            value={accountId ?? ''}
            disabled={locked}
            onChange={(event) => onAccountIdChange(event.currentTarget.value ? Number(event.currentTarget.value) : null)}
          >
            <option value="">Không chọn</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.uid} · {account.name ?? account.username ?? 'Chưa có tên'}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <label>
          Token credential
          <select
            value={tokenCredentialId ?? ''}
            disabled={locked || tokenBusy}
            onChange={(event) => onTokenCredentialIdChange(event.currentTarget.value || null)}
          >
            <option value="">Chưa chọn token</option>
            {credentials.map((credential) => (
              <option key={credential.id} value={credential.id}>
                {credential.label} · {credential.maskedToken} · {VALIDATION_LABEL[credential.validationState]}
              </option>
            ))}
          </select>
        </label>
      )}

      {sourceMode === 'token' ? (
        <div className="scanner-token-manager" data-testid="scanner-token-manager">
          <div className="scanner-token-form">
            <label>
              Tên token
              <input
                value={tokenLabel}
                maxLength={120}
                disabled={locked || tokenBusy}
                onChange={(event) => setTokenLabel(event.currentTarget.value)}
                placeholder="Ví dụ: Token quét Page"
              />
            </label>
            <label>
              Access Token
              <input
                data-testid="scanner-token-secret"
                type="password"
                autoComplete="off"
                value={tokenSecret}
                disabled={locked || tokenBusy}
                onChange={(event) => setTokenSecret(event.currentTarget.value)}
                placeholder="Dán token do anh cung cấp"
              />
            </label>
            <button
              className="button secondary"
              type="button"
              disabled={locked || tokenBusy || !storageAvailable || !tokenLabel.trim() || !tokenSecret.trim()}
              onClick={() => void createCredential()}
            >Lưu token mã hóa</button>
            <button
              className="button secondary"
              type="button"
              disabled={locked || tokenBusy || !selectedCredential}
              onClick={() => void validateCredential()}
            >Xác minh token</button>
          </div>

          <div className="scanner-token-status">
            <span>Mã hóa hệ điều hành: <strong>{capabilities ? (storageAvailable ? 'Sẵn sàng' : 'Không khả dụng') : 'Đang kiểm tra…'}</strong></span>
            <span>Graph API: <strong>{capabilities?.graphApiVersion ?? '—'}</strong></span>
            <span>Quét bằng token: <strong>{capabilities?.tokenScanningSupported ? 'Đã hỗ trợ' : 'Chưa bật ở Batch 3'}</strong></span>
            <span>Tự lấy token từ phiên Facebook: <strong>{capabilities?.autoAcquireTokenSupported ? 'Đã hỗ trợ' : 'Không hỗ trợ'}</strong></span>
          </div>

          {selectedCredential ? (
            <div className={`scanner-token-detail state-${selectedCredential.validationState}`}>
              <strong>{selectedCredential.label}</strong>
              <span>{selectedCredential.maskedToken} · fingerprint {selectedCredential.fingerprint}</span>
              <span>{VALIDATION_LABEL[selectedCredential.validationState]}{selectedCredential.subjectName ? ` · ${selectedCredential.subjectName}` : ''}</span>
              {selectedCredential.validationMessage ? <small>{selectedCredential.validationMessage}</small> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
