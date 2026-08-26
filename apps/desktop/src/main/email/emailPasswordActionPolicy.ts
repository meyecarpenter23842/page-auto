const MICROSOFT_PASSWORD_MIN_LENGTH = 8
const MICROSOFT_PASSWORD_MAX_LENGTH = 256

export function validateEmailPassword(value: string | null | undefined): string {
  if (typeof value !== 'string' || value.length < MICROSOFT_PASSWORD_MIN_LENGTH) {
    throw new Error(`Password Email mới phải có ít nhất ${MICROSOFT_PASSWORD_MIN_LENGTH} ký tự.`)
  }
  if (value.length > MICROSOFT_PASSWORD_MAX_LENGTH) {
    throw new Error(`Password Email mới không được vượt quá ${MICROSOFT_PASSWORD_MAX_LENGTH} ký tự.`)
  }
  if (/[\r\n\0]/.test(value)) {
    throw new Error('Password Email mới chứa ký tự điều khiển không được hỗ trợ.')
  }
  return value
}
