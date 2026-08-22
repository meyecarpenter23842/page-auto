import type {
  AccountDraft,
  AccountImportField,
  AccountImportIssue,
  AccountImportRequest
} from '../../shared/accounts'

const numericFields = new Set<AccountImportField>(['proxyPort', 'friendCount'])

export interface ParsedAccountImport {
  accounts: AccountDraft[]
  errors: AccountImportIssue[]
}

function parseNumericValue(field: AccountImportField, value: string): number | null | string {
  if (!numericFields.has(field)) {
    return value
  }

  if (value === '') {
    return null
  }

  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : value
}

export function parseAccountImport(request: AccountImportRequest): ParsedAccountImport {
  const delimiter = request.delimiter || '|'
  const errors: AccountImportIssue[] = []
  const accounts: AccountDraft[] = []
  const seenUids = new Set<string>()

  if (delimiter.length > 8) {
    return {
      accounts: [],
      errors: [{ line: 0, message: 'Delimiter quá dài.' }]
    }
  }

  const lines = request.rawText.split(/\r?\n/)

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? ''
    const lineNumber = index + 1

    if (!rawLine.trim()) {
      continue
    }

    const values = rawLine.split(delimiter).map((value) => value.trim())
    const draft: Partial<AccountDraft> = {}
    let invalidNumericField: AccountImportField | null = null

    request.mapping.forEach((field, columnIndex) => {
      if (field === 'ignore') {
        return
      }

      const rawValue = values[columnIndex] ?? ''
      const parsedValue = parseNumericValue(field, rawValue)
      if (numericFields.has(field) && typeof parsedValue === 'string' && parsedValue !== '') {
        invalidNumericField = field
        return
      }

      if (parsedValue === '') {
        return
      }

      ;(draft as Record<string, unknown>)[field] = parsedValue
    })

    if (invalidNumericField) {
      errors.push({
        line: lineNumber,
        message: `${invalidNumericField} phải là số.`
      })
      continue
    }

    const uid = typeof draft.uid === 'string' ? draft.uid.trim() : ''
    if (!uid) {
      errors.push({ line: lineNumber, message: 'Thiếu UID/UserName.' })
      continue
    }

    if (seenUids.has(uid)) {
      errors.push({ line: lineNumber, message: `UID/UserName bị trùng trong dữ liệu import: ${uid}` })
      continue
    }

    seenUids.add(uid)
    accounts.push({ ...draft, uid } as AccountDraft)
  }

  return { accounts, errors }
}
