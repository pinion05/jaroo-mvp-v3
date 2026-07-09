export const MAX_PORTFOLIO_ROWS = 200
export const MAX_PORTFOLIO_REQUEST_BODY_BYTES = 256 * 1024

const MAX_PORTFOLIO_TEXT_LENGTH = 80
const MAX_PORTFOLIO_CODE_LENGTH = 32
const MAX_PORTFOLIO_MONEY_VALUE = 1_000_000_000_000_000
const PORTFOLIO_MARKETS = new Set(['KR', 'KOSPI', 'KOSDAQ', 'ETF', 'ETN', 'US', 'NASDAQ', 'NYSE', 'AMEX'])
const PORTFOLIO_MARKET_TONES = new Set(['kospi', 'kosdaq', 'etf', 'nasdaq'])
const PORTFOLIO_KINDS = new Set(['stock', 'etf'])
const PORTFOLIO_CURRENCIES = new Set(['KRW', 'USD'])
const PORTFOLIO_SOURCES = new Set(['ocr', 'manual', 'import'])

const textEncoder = new TextEncoder()


function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validatePortfolioText(
  row: Record<string, unknown>,
  index: number,
  field: string,
  options: { required?: boolean; maxLength: number; values?: ReadonlySet<string> },
) {
  const value = row[field]
  if (value == null || value === '') {
    return options.required ? `rows[${index}].${field} is required.` : ''
  }
  if (typeof value !== 'string') {
    return `rows[${index}].${field} must be a string.`
  }
  if (!value.trim()) {
    return options.required ? `rows[${index}].${field} is required.` : ''
  }
  if (value.length > options.maxLength) {
    return `rows[${index}].${field} is too long.`
  }
  if (options.values && !options.values.has(value)) {
    return `rows[${index}].${field} has an unsupported value.`
  }
  return ''
}

function validatePortfolioNumber(
  row: Record<string, unknown>,
  index: number,
  field: string,
  options: { required?: boolean; integer?: boolean; nullable?: boolean; min?: number; max?: number },
) {
  const value = row[field]
  if (value == null) {
    if (value === null && options.nullable) {
      return ''
    }
    return options.required ? `rows[${index}].${field} is required.` : ''
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return `rows[${index}].${field} must be a finite number.`
  }
  if (options.integer && !Number.isInteger(value)) {
    return `rows[${index}].${field} must be an integer.`
  }
  if (typeof options.min === 'number' && value < options.min) {
    return `rows[${index}].${field} is below the minimum.`
  }
  if (typeof options.max === 'number' && value > options.max) {
    return `rows[${index}].${field} exceeds the maximum.`
  }
  return ''
}

function getPortfolioRowValidationError(row: unknown, index: number) {
  if (!isRecord(row)) {
    return `rows[${index}] must be an object.`
  }

  return [
    validatePortfolioText(row, index, 'name', { required: true, maxLength: MAX_PORTFOLIO_TEXT_LENGTH }),
    validatePortfolioText(row, index, 'code', { maxLength: MAX_PORTFOLIO_CODE_LENGTH }),
    validatePortfolioText(row, index, 'ticker', { maxLength: MAX_PORTFOLIO_CODE_LENGTH }),
    validatePortfolioText(row, index, 'market', { maxLength: MAX_PORTFOLIO_CODE_LENGTH, values: PORTFOLIO_MARKETS }),
    validatePortfolioText(row, index, 'market_tone', { maxLength: MAX_PORTFOLIO_CODE_LENGTH, values: PORTFOLIO_MARKET_TONES }),
    validatePortfolioText(row, index, 'kind', { maxLength: MAX_PORTFOLIO_CODE_LENGTH, values: PORTFOLIO_KINDS }),
    validatePortfolioNumber(row, index, 'quantity', { required: true, min: 0, max: MAX_PORTFOLIO_MONEY_VALUE }),
    validatePortfolioNumber(row, index, 'average_price', { required: true, min: 0, max: MAX_PORTFOLIO_MONEY_VALUE }),
    validatePortfolioText(row, index, 'average_price_currency', { maxLength: 3, values: PORTFOLIO_CURRENCIES }),
    validatePortfolioNumber(row, index, 'evaluation_amount', { nullable: true, min: 0, max: MAX_PORTFOLIO_MONEY_VALUE }),
    validatePortfolioText(row, index, 'identifier_label', { maxLength: MAX_PORTFOLIO_TEXT_LENGTH }),
    validatePortfolioNumber(row, index, 'sort_order', { required: true, integer: true, min: 0, max: MAX_PORTFOLIO_ROWS - 1 }),
    validatePortfolioText(row, index, 'source', { required: true, maxLength: MAX_PORTFOLIO_CODE_LENGTH, values: PORTFOLIO_SOURCES }),
  ].find(Boolean) ?? ''
}

export function getPortfolioRequestBodySizeError(bodyText: string): string {
  if (textEncoder.encode(bodyText).byteLength > MAX_PORTFOLIO_REQUEST_BODY_BYTES) {
    return `request body exceeds ${MAX_PORTFOLIO_REQUEST_BODY_BYTES} bytes.`
  }
  return ''
}

export function getPortfolioRowsValidationError(rows: unknown): string {
  if (!Array.isArray(rows)) {
    return 'rows must be an array.'
  }
  if (rows.length > MAX_PORTFOLIO_ROWS) {
    return `Too many rows. Up to ${MAX_PORTFOLIO_ROWS} rows are supported.`
  }

  for (let index = 0; index < rows.length; index += 1) {
    const rowError = getPortfolioRowValidationError(rows[index], index)
    if (rowError) {
      return rowError
    }
  }

  return ''
}
