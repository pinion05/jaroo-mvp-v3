type UnknownRecord = Record<string, unknown>

export type UsConsensusDecodedFacts = {
  asOfDate?: string
  targetPeriodId?: string
  targetPeriodLabel?: string
  spotPrice?: number
  forecastRevenue?: number
  forecastRevenueRevisionPct?: number
  forecastEps?: number
  forecastEpsRevisionPct?: number
  forwardPer?: number
  forecastBps?: number
  forecastBpsRevisionPct?: number
  forwardPbr?: number
  sourceOpaqueMetrics: Record<string, number | null>
  decodingConfidence: 'sample-backed'
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : null
}

function asFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function decodeUsConsensusObservation(observation: unknown): UsConsensusDecodedFacts {
  const record = asRecord(observation)
  const metrics = asRecord(record?.metrics)
  const sourceOpaqueMetrics = Object.fromEntries(
    Object.entries(metrics ?? {}).map(([key, value]) => [key, asFiniteNumber(value)]),
  )

  return {
    asOfDate: typeof record?.asOfDate === 'string' ? record.asOfDate : undefined,
    targetPeriodId: typeof record?.targetPeriodId === 'string' ? record.targetPeriodId : undefined,
    targetPeriodLabel: typeof record?.targetPeriodLabel === 'string' ? record.targetPeriodLabel : undefined,
    spotPrice: asFiniteNumber(metrics?.val1) ?? undefined,
    forecastRevenue: asFiniteNumber(metrics?.val2) ?? undefined,
    forecastRevenueRevisionPct: asFiniteNumber(metrics?.val3) ?? undefined,
    forecastEps: asFiniteNumber(metrics?.val4) ?? undefined,
    forecastEpsRevisionPct: asFiniteNumber(metrics?.val5) ?? undefined,
    forwardPer: asFiniteNumber(metrics?.val6) ?? undefined,
    forecastBps: asFiniteNumber(metrics?.val7) ?? undefined,
    forecastBpsRevisionPct: asFiniteNumber(metrics?.val8) ?? undefined,
    forwardPbr: asFiniteNumber(metrics?.val9) ?? undefined,
    sourceOpaqueMetrics,
    decodingConfidence: 'sample-backed',
  }
}
