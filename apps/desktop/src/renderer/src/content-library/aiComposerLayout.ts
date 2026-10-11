/** Persist only a numeric UI preference, never credentials or post data. */
export const AI_COMPOSER_WIDTH_KEY = 'page-auto.ai-composer-width.v1'
export const DEFAULT_AI_COMPOSER_WIDTH = 400

export function clampAiComposerWidth(value: number, availableWidth?: number): number {
  const max = Math.min(620, availableWidth ? Math.max(320, Math.floor(availableWidth * 0.44)) : 620)
  return Math.min(max, Math.max(320, Math.round(Number.isFinite(value) ? value : DEFAULT_AI_COMPOSER_WIDTH)))
}

export function readAiComposerWidth(storage: Pick<Storage, 'getItem'>): number {
  try {
    const raw = storage.getItem(AI_COMPOSER_WIDTH_KEY)
    return raw?.trim() ? clampAiComposerWidth(Number(raw)) : DEFAULT_AI_COMPOSER_WIDTH
  } catch {
    return DEFAULT_AI_COMPOSER_WIDTH
  }
}

export function saveAiComposerWidth(storage: Pick<Storage, 'setItem'>, width: number): void {
  try {
    storage.setItem(AI_COMPOSER_WIDTH_KEY, String(clampAiComposerWidth(width)))
  } catch {
    // Restricted local storage must not block the editor.
  }
}
