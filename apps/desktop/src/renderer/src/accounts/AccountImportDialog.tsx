import { useEffect, useMemo, useState } from 'react'
import {
  ACCOUNT_IMPORT_FIELDS,
  BUILTIN_IMPORT_PRESETS,
  type AccountImportField,
  type AccountImportMapping,
  type AccountImportOperation,
  type AccountImportResult,
  type ImportPreset
} from '../../../shared/accounts'
import {
  DEFAULT_CUSTOM_MAPPING,
  MIN_CUSTOM_MAPPING_COLUMNS,
  PREVIEW_LIMIT,
  importFieldLabels,
  normalizeCustomMapping,
  type PreviewRow
} from './accountManagerModel'

export interface ImportDialogProps {
  operation: AccountImportOperation
  presets: ImportPreset[]
  onClose: () => void
  onImported: (result: AccountImportResult, operation: AccountImportOperation) => void
  onPresetSaved: (preset: ImportPreset) => void
}

export function ImportDialog({ operation, presets, onClose, onImported, onPresetSaved }: ImportDialogProps) {
  const [rawText, setRawText] = useState('')
  const [delimiter, setDelimiter] = useState('|')
  const [mapping, setMapping] = useState<AccountImportMapping>(() => [...DEFAULT_CUSTOM_MAPPING])
  const [presetName, setPresetName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const previewRows = useMemo<PreviewRow[]>(() => rawText
    .split(/\r?\n/)
    .map((raw, index) => ({ line: index + 1, raw, values: raw.split(delimiter || '|') }))
    .filter((row) => row.raw.trim()), [rawText, delimiter])

  const maxDataColumns = useMemo(() => previewRows.reduce((max, row) => Math.max(max, row.values.length), 0), [previewRows])
  const distinctColumnCounts = useMemo(() => new Set(previewRows.map((row) => row.values.length)), [previewRows])

  useEffect(() => {
    setMapping((current) => normalizeCustomMapping(current, Math.max(maxDataColumns, MIN_CUSTOM_MAPPING_COLUMNS)))
  }, [maxDataColumns])

  const applyPreset = (nextDelimiter: string, nextMapping: AccountImportMapping) => {
    setDelimiter(nextDelimiter)
    setMapping(normalizeCustomMapping([...nextMapping], Math.max(maxDataColumns, nextMapping.length)))
  }

  const addMappingColumn = () => setMapping((current) => [...current, 'ignore'])
  const removeMappingColumn = () => setMapping((current) => current.length > MIN_CUSTOM_MAPPING_COLUMNS ? current.slice(0, -1) : current)

  const importNow = async () => {
    const uidMappings = mapping.filter((field) => field === 'uid').length
    if (uidMappings !== 1) {
      setError('Cần ánh xạ đúng 1 cột UID/Tên đăng nhập.')
      return
    }

    if (operation === 'update' && !mapping.some((field) => field !== 'uid' && field !== 'ignore')) {
      setError('Cần chọn ít nhất 1 trường để cập nhật ngoài UID.')
      return
    }

    setError(null)
    setSaving(true)
    try {
      const result = await window.pageAuto.importAccounts({ rawText, delimiter, mapping, operation })
      onImported(result, operation)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  const savePreset = async () => {
    if (!presetName.trim()) {
      setError('Nhập tên mẫu trước khi lưu.')
      return
    }
    try {
      const preset = await window.pageAuto.saveImportPreset({ name: presetName, delimiter, mapping })
      onPresetSaved(preset)
      setPresetName('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="modal import-modal account-import-v2" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">Quản lý tài khoản</p>
            <h2>{operation === 'insert' ? 'Nhập tài khoản' : 'Cập nhật tài khoản theo UID'}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose}>×</button>
        </div>

        <div className="import-operation-note">
          {operation === 'insert'
            ? 'UID đã tồn tại sẽ được bỏ qua. Dấu phân cách giữ nguyên vị trí cột trống.'
            : 'UID là khóa tìm tài khoản. Bỏ qua = giữ dữ liệu cũ; ô có cột nhưng để trống = xóa dữ liệu cũ; cột không tồn tại trong dòng = giữ nguyên.'}
        </div>

        <div className="import-toolbar-row">
          <label><span>Dấu phân cách</span><input className="delimiter-input" value={delimiter} maxLength={8} onChange={(e) => setDelimiter(e.target.value)} /></label>
          <span className="mapping-format-hint">Mặc định: UID | Mật khẩu | 2FA | Cookie | Email | Mật khẩu email | Proxy | User-Agent | Ghi chú</span>
        </div>

        <label className="paste-area">
          <span>Dán dữ liệu — mỗi tài khoản một dòng</span>
          <textarea rows={7} value={rawText} onChange={(e) => setRawText(e.target.value)} placeholder="100001|password|2fa|cookie|email|passmail|proxy|useragent|note" />
        </label>

        <div className="preset-strip">
          {[...BUILTIN_IMPORT_PRESETS.map((preset) => ({ ...preset, id: preset.key })), ...presets].map((preset) => (
            <button key={String(preset.id)} type="button" className="preset-chip" onClick={() => applyPreset(preset.delimiter, preset.mapping)}>{preset.name}</button>
          ))}
        </div>

        <div className="mapping-panel">
          <div className="mapping-header">
            <div>
              <strong>Ánh xạ thứ tự cột</strong>
              <span>{maxDataColumns ? `${maxDataColumns} cột dữ liệu · ` : ''}{mapping.length} ô ánh xạ</span>
            </div>
            <div className="mapping-actions">
              <button className="button secondary compact" type="button" onClick={removeMappingColumn} disabled={mapping.length <= MIN_CUSTOM_MAPPING_COLUMNS}>− Cột</button>
              <button className="button secondary compact" type="button" onClick={addMappingColumn}>+ Cột</button>
            </div>
          </div>

          <div className="mapping-grid">
            {mapping.map((field, index) => (
              <label key={index}>
                <span>Cột {index + 1}</span>
                <select value={field} onChange={(e) => setMapping((current) => current.map((item, itemIndex) => itemIndex === index ? e.target.value as AccountImportField | 'ignore' : item))}>
                  <option value="ignore">Bỏ qua</option>
                  {ACCOUNT_IMPORT_FIELDS.map((item) => <option key={item} value={item}>{importFieldLabels[item]}</option>)}
                </select>
              </label>
            ))}
          </div>

          <div className="import-preview-heading">
            <strong>Xem trước dữ liệu</strong>
            <span>{previewRows.length} dòng{distinctColumnCounts.size > 1 ? ' · có dòng lệch số cột' : ''}</span>
          </div>

          <div className="import-preview-wrap">
            <table className="import-preview-table">
              <thead>
                <tr>
                  <th>Dòng</th>
                  {mapping.map((field, index) => <th key={index}>Cột {index + 1}<small>{importFieldLabels[field]}</small></th>)}
                </tr>
              </thead>
              <tbody>
                {previewRows.slice(0, PREVIEW_LIMIT).map((row) => {
                  const mismatched = distinctColumnCounts.size > 1 && row.values.length !== maxDataColumns
                  return (
                    <tr key={row.line} className={mismatched ? 'preview-row-warning' : ''}>
                      <td className="preview-line-number">{row.line}{mismatched ? ' ⚠' : ''}</td>
                      {mapping.map((_field, index) => {
                        const exists = index < row.values.length
                        const value = exists ? (row.values[index] ?? '').trim() : ''
                        return (
                          <td key={index} className={!exists ? 'preview-cell-missing' : value === '' ? 'preview-cell-empty' : ''} title={value || undefined}>
                            {!exists ? '[Không có cột]' : value === '' ? '[Trống]' : value}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
                {previewRows.length === 0 ? <tr><td colSpan={mapping.length + 1} className="preview-empty-state">Dán dữ liệu để xem từng cột trước khi thực hiện.</td></tr> : null}
              </tbody>
            </table>
          </div>
          {previewRows.length > PREVIEW_LIMIT ? <div className="preview-more">Đang xem {PREVIEW_LIMIT}/{previewRows.length} dòng đầu.</div> : null}

          <div className="save-preset-row">
            <input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="Tên mẫu tùy chỉnh" />
            <button className="button secondary" type="button" onClick={() => void savePreset()}>Lưu mẫu</button>
          </div>
        </div>

        {error ? <div className="inline-error">{error}</div> : null}
        <div className="modal-actions">
          <button className="button secondary" type="button" onClick={onClose}>Hủy</button>
          <button className="button primary" type="button" disabled={saving || !rawText.trim()} onClick={() => void importNow()}>
            {saving ? 'Đang xử lý…' : operation === 'insert' ? 'Nhập tài khoản' : 'Cập nhật tài khoản'}
          </button>
        </div>
      </div>
    </div>
  )
}
export { ImportDialog as AccountImportDialog }
