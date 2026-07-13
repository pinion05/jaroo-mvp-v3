import test from 'node:test'
import assert from 'node:assert/strict'

import {
  MAX_RECOVERY_FORECAST_PEER_SERIES,
  MAX_RECOVERY_FORECAST_PRICE_POINTS,
  MAX_RECOVERY_FORECAST_TOTAL_PRICE_POINTS,
  POST,
  createRecoveryForecastResponse,
  getRecoveryForecastValidationError,
} from './route'

function buildPriceSeriesFromReturns(returns: number[], initialClose = 100) {
  const points = [{ date: '2026-01-01', close: initialClose }]
  let close = initialClose

  returns.forEach((logReturn, index) => {
    close *= Math.exp(logReturn)
    points.push({ date: `2026-01-${String(index + 2).padStart(2, '0')}`, close })
  })

  return points
}

function buildIntegratedPayload() {
  return {
    primarySeries: buildPriceSeriesFromReturns([0.1, 0.1, 0.1]),
    peerSeries: [
      {
        label: 'peer-a',
        series: [
          { date: '2026-02-01', close: 121 },
          { date: '2026-02-02', close: 100 },
          { date: '2026-02-03', close: 121 },
          { date: '2026-02-04', close: 121 },
          { date: '2026-02-05', close: 100 },
          { date: '2026-02-06', close: 121 },
        ],
      },
    ],
    currentPrice: 100,
    targetPrice: 121,
    options: {
      similarPattern: {
        lookbackDays: 2,
        tolerancePct: 5,
        spacingDays: 1,
        minSampleSize: 2,
      },
      simulation: {
        horizonDays: 5,
        pathCount: 7,
        seed: 'api-integrated',
      },
    },
  }
}

test('recovery forecast API validation rejects non-object payloads', () => {
  assert.equal(getRecoveryForecastValidationError(null), 'A JSON object body is required.')
})

test('recovery forecast API validation requires primary price points', () => {
  assert.equal(
    getRecoveryForecastValidationError({ currentPrice: 100, targetPrice: 120 }),
    'primarySeries must contain at least one price point.',
  )
})

test('recovery forecast API validation caps primary point count', () => {
  assert.equal(
    getRecoveryForecastValidationError({
      primarySeries: Array.from({ length: MAX_RECOVERY_FORECAST_PRICE_POINTS + 1 }, () => 100),
      currentPrice: 100,
      targetPrice: 120,
    }),
    `primarySeries supports up to ${MAX_RECOVERY_FORECAST_PRICE_POINTS} price points.`,
  )
})

test('recovery forecast API validation caps peer series count', () => {
  assert.equal(
    getRecoveryForecastValidationError({
      primarySeries: [100],
      peerSeries: Array.from({ length: MAX_RECOVERY_FORECAST_PEER_SERIES + 1 }, () => [100]),
      currentPrice: 100,
      targetPrice: 120,
    }),
    `peerSeries supports up to ${MAX_RECOVERY_FORECAST_PEER_SERIES} series.`,
  )
})

test('recovery forecast API validation caps total point count across primary and peer series', () => {
  assert.equal(
    getRecoveryForecastValidationError({
      primarySeries: Array.from({ length: MAX_RECOVERY_FORECAST_PRICE_POINTS }, () => 100),
      peerSeries: Array.from({ length: MAX_RECOVERY_FORECAST_PEER_SERIES }, () => (
        Array.from({ length: 1801 }, () => 100)
      )),
      currentPrice: 100,
      targetPrice: 120,
    }),
    `The recovery forecast request supports up to ${MAX_RECOVERY_FORECAST_TOTAL_PRICE_POINTS} total price points.`,
  )
})

test('recovery forecast API validation requires target and current context', () => {
  assert.equal(
    getRecoveryForecastValidationError({ primarySeries: [100], currentPrice: 100 }),
    'targetPrice, buyPrice, or averagePrice must be a positive number.',
  )

  assert.equal(
    getRecoveryForecastValidationError({ primarySeries: [100], targetPrice: 120 }),
    'currentPrice must be a positive number unless targetDrawdownPct is provided.',
  )
})

test('createRecoveryForecastResponse returns forecaster output as raw JSON', async () => {
  const response = await createRecoveryForecastResponse(
    buildIntegratedPayload(),
    () => ({ status: 'available', consensus: { expectedRecoveryDays: 12 } }),
  )

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    forecast: {
      status: 'available',
      consensus: { expectedRecoveryDays: 12 },
    },
  })
})

test('POST /api/recovery-forecast runs the recovery model end-to-end from JSON body', async () => {
  const response = await POST(new Request('http://localhost/api/recovery-forecast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildIntegratedPayload()),
  }))
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.forecast.status, 'available')
  assert.equal(body.forecast.consensus.expectedRecoveryDays, 2)
  assert.equal(body.forecast.consensus.recoveryProbabilityPct, 100)
  assert.equal(body.forecast.modelDetails.similarPattern.sampleCount, 2)
  assert.equal(body.forecast.modelDetails.gbm.medianRecoveryDays, 2)
  assert.equal(body.forecast.modelDetails.jumpDiffusion.medianRecoveryDays, 2)
})

test('POST /api/recovery-forecast can infer current price from target drawdown pct', async () => {
  const payload = {
    ...buildIntegratedPayload(),
    currentPrice: undefined,
    targetDrawdownPct: ((121 - 100) / 121) * 100,
  }

  const response = await POST(new Request('http://localhost/api/recovery-forecast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.forecast.status, 'available')
  assert.equal(body.forecast.consensus.expectedRecoveryDays, 2)
  assert.equal(body.forecast.modelDetails.gbm.medianRecoveryDays, 2)
  assert.equal(body.forecast.modelDetails.jumpDiffusion.medianRecoveryDays, 2)
})

test('POST /api/recovery-forecast rejects malformed JSON', async () => {
  const response = await POST(new Request('http://localhost/api/recovery-forecast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{bad json',
  }))

  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { error: 'A JSON object body is required.' })
})
