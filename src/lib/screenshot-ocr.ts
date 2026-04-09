export const SCREENSHOT_OCR_STORAGE_KEY = 'jaroo:screenshot-ocr-upload'

export type OcrRow = {
  name: string
  quantity: string
  profitRate: string
}

export type ScreenshotUploadSession = {
  fileName: string
  broker: string
  imageDataUrl: string
}

export function sanitizeOcrRows(input: unknown): OcrRow[] {
  if (!Array.isArray(input)) {
    return []
  }

  return input
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => ({
      name: typeof item.name === 'string' ? item.name.trim() : '',
      quantity: typeof item.quantity === 'string' ? item.quantity.trim() : '',
      profitRate: typeof item.profitRate === 'string' ? item.profitRate.trim() : '',
    }))
    .filter((item) => item.name.length > 0 || item.quantity.length > 0 || item.profitRate.length > 0)
}
