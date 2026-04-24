import { NextResponse } from 'next/server'

import { buildRecoveryForecastFromPriceSeries } from '../../../../packages/deepscan-runtime-core/src/recovery-forecast.js'

export const runtime = 'nodejs'

export const MAX_RECOVERY_FORECAST_PRICE_POINTS = 3000
export const MAX_RECOVERY_FORECAST_PEER_SERIES = 5
export const MAX_RECOVERY_FORECAST_TOTAL_PRICE_POINTS = 12000

type RecoveryForecastPricePoint = number | string | {
  date?: unknown
  tradeDate?: unknown
  at?: unknown
  time?: unknown
  close?: unknown
  closePrice?: unknown
  price?: unknown
  value?: unknown
}

type RecoveryForecastPeerSeries = RecoveryForecastPricePoint[] | {
  label?: unknown
  name?: unknown
  series?: unknown
}

type RecoveryForecastRequest = {
  currentPrice?: unknown
  targetPrice?: unknown
  buyPrice?: unknown
  averagePrice?: unknown
  targetDrawdownPct?: unknown
  primarySeries?: unknown
  priceSeries?: unknown
  series?: unknown
  peerSeries?: unknown
  options?: unknown
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parsePositiveNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value
  }

  if (typeof value !== 'string') {
    return null
  }

  const parsed = Number(value.replace(/[,\s₩$원]/g, '').trim())
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function getPrimarySeries(payload: RecoveryForecastRequest | null) {
  if (!payload) {
    return []
  }

  return payload.primarySeries ?? payload.priceSeries ?? payload.series
}

function getPeerSeries(payload: RecoveryForecastRequest | null) {
  return Array.isArray(payload?.peerSeries) ? payload.peerSeries as RecoveryForecastPeerSeries[] : []
}

function countPeerSeriesPoints(peerSeries: RecoveryForecastPeerSeries[]) {
  return peerSeries.reduce((total, peer) => {
    if (Array.isArray(peer)) {
      return total + peer.length
    }

    if (isPlainObject(peer) && Array.isArray(peer.series)) {
      return total + peer.series.length
    }

    return total
  }, 0)
}

export function getRecoveryForecastValidationError(payload: RecoveryForecastRequest | null) {
  if (!isPlainObject(payload)) {
    return 'A JSON object body is required.'
  }

  const primarySeries = getPrimarySeries(payload)
  if (!Array.isArray(primarySeries) || primarySeries.length === 0) {
    return 'primarySeries must contain at least one price point.'
  }

  if (primarySeries.length > MAX_RECOVERY_FORECAST_PRICE_POINTS) {
    return `primarySeries supports up to ${MAX_RECOVERY_FORECAST_PRICE_POINTS} price points.`
  }

  const peerSeries = getPeerSeries(payload)
  if (peerSeries.length > MAX_RECOVERY_FORECAST_PEER_SERIES) {
    return `peerSeries supports up to ${MAX_RECOVERY_FORECAST_PEER_SERIES} series.`
  }

  const totalPricePoints = primarySeries.length + countPeerSeriesPoints(peerSeries)
  if (totalPricePoints > MAX_RECOVERY_FORECAST_TOTAL_PRICE_POINTS) {
    return `The recovery forecast request supports up to ${MAX_RECOVERY_FORECAST_TOTAL_PRICE_POINTS} total price points.`
  }

  const hasTargetPrice = parsePositiveNumber(payload.targetPrice ?? payload.buyPrice ?? payload.averagePrice) !== null
  if (!hasTargetPrice) {
    return 'targetPrice, buyPrice, or averagePrice must be a positive number.'
  }

  const hasCurrentPrice = parsePositiveNumber(payload.currentPrice) !== null
  const hasTargetDrawdownPct = typeof payload.targetDrawdownPct === 'number' && Number.isFinite(payload.targetDrawdownPct) && payload.targetDrawdownPct >= 0
  if (!hasCurrentPrice && !hasTargetDrawdownPct) {
    return 'currentPrice must be a positive number unless targetDrawdownPct is provided.'
  }

  return ''
}

function buildForecastInput(payload: RecoveryForecastRequest) {
  return {
    ...payload,
    primarySeries: getPrimarySeries(payload),
    peerSeries: getPeerSeries(payload),
  }
}

export async function createRecoveryForecastResponse(
  payload: RecoveryForecastRequest | null,
  forecaster: typeof buildRecoveryForecastFromPriceSeries = buildRecoveryForecastFromPriceSeries,
) {
  const validationError = getRecoveryForecastValidationError(payload)
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 })
  }

  try {
    const requestPayload = payload as RecoveryForecastRequest
    const forecast = forecaster(buildForecastInput(requestPayload), isPlainObject(requestPayload.options) ? requestPayload.options : {})
    return NextResponse.json({ forecast })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'recovery forecast failed',
      },
      { status: 500 },
    )
  }
}

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as RecoveryForecastRequest | null
  return createRecoveryForecastResponse(payload)
}
