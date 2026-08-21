export type FinancialValueTone = 'profit' | 'loss' | 'neutral'

export type FinancialValue = string | number | null | undefined

function parseFinancialValue(value: FinancialValue) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value !== 'string') {
    return null
  }

  const normalized = value
    .trim()
    .replace(/[−–—﹣]/g, '-')
    .replaceAll(',', '')
  const numericMatch = normalized.match(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)/)

  if (!numericMatch) {
    return null
  }

  const parsed = Number(numericMatch[0])
  return Number.isFinite(parsed) ? parsed : null
}

export function getFinancialValueTone(value: FinancialValue): FinancialValueTone {
  const parsed = parseFinancialValue(value)

  if (parsed === null || parsed === 0) {
    return 'neutral'
  }

  return parsed > 0 ? 'profit' : 'loss'
}

export function getFinancialValueTextClass(value: FinancialValue) {
  switch (getFinancialValueTone(value)) {
    case 'profit':
      return 'text-[color:var(--jaroo-profit)]'
    case 'loss':
      return 'text-[color:var(--jaroo-loss)]'
    default:
      return 'text-[color:var(--jaroo-muted)]'
  }
}
