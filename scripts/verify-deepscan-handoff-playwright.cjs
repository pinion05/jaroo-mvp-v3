const { chromium } = require('playwright')

const BASE_URL = process.env.JAROO_BASE_URL || 'http://127.0.0.1:3000'
const MERGE_KEY = 'jaroo:screenshot-ocr-merge-result'
const APPLIED_KEY = 'jaroo:applied-home-portfolio'
const TARGET_KEY = 'jaroo:deepscan-target'
const SLIM_KEY = 'jaroo:deepscan-slim-summary'

const scenarios = {
  recomputable: {
    description: 'quantity+profitRate+evaluationAmount가 있어 apply 시 avgPrice를 계산할 수 있는 케이스',
    mergeResult: {
      broker: '테스트증권',
      rows: [
        {
          fileName: 'recomputable.png',
          name: '한미반도체',
          quantity: '10주',
          profitRate: '-23.4%',
          evaluationAmount: '2,920,000원',
          averagePrice: '',
          code: '042700',
          resolvedName: '한미반도체',
          resolvedCode: '042700',
          resolvedMarket: 'KOSPI',
          resolvedMarketTone: 'kospi',
          resolvedKind: 'stock',
        },
      ],
    },
  },
  source_insufficient: {
    description: 'avgPrice 계산에 필요한 profitRate가 없어 apply 후에도 avgPrice를 만들 수 없는 케이스',
    mergeResult: {
      broker: '테스트증권',
      rows: [
        {
          fileName: 'source-insufficient.png',
          name: '한미반도체',
          quantity: '10주',
          profitRate: '',
          evaluationAmount: '2,920,000원',
          averagePrice: '',
          code: '042700',
          resolvedName: '한미반도체',
          resolvedCode: '042700',
          resolvedMarket: 'KOSPI',
          resolvedMarketTone: 'kospi',
          resolvedKind: 'stock',
        },
      ],
    },
  },
  stale_applied_session: {
    description: 'patch 전 applied-home이 남아 avgPrice는 비고 home hydrate로 evaluationAmount만 붙는 stale 세션 유사 케이스',
    appliedSession: {
      broker: '테스트증권',
      rows: [
        {
          name: '한미반도체',
          quantity: '10주',
          averagePrice: '',
          resolvedName: '한미반도체',
          resolvedCode: '042700',
          resolvedMarket: 'KOSPI',
          resolvedMarketTone: 'kospi',
          resolvedKind: 'stock',
        },
      ],
      appliedAt: '2026-04-16T02:00:00.000Z',
    },
  },
}

async function dumpStorage(page) {
  return page.evaluate(({ APPLIED_KEY, TARGET_KEY, SLIM_KEY }) => {
    const parse = (value) => {
      if (!value) return null
      try {
        return JSON.parse(value)
      } catch {
        return { __parseError: true, raw: value }
      }
    }

    return {
      appliedRaw: window.sessionStorage.getItem(APPLIED_KEY),
      applied: parse(window.sessionStorage.getItem(APPLIED_KEY)),
      targetRaw: window.sessionStorage.getItem(TARGET_KEY),
      target: parse(window.sessionStorage.getItem(TARGET_KEY)),
      slimRaw: window.sessionStorage.getItem(SLIM_KEY),
      slim: parse(window.sessionStorage.getItem(SLIM_KEY)),
    }
  }, { APPLIED_KEY, TARGET_KEY, SLIM_KEY })
}

async function runScenario(browser, scenarioName, scenario) {
  const context = await browser.newContext()
  await context.addInitScript(({ mergeKey, mergePayload, appliedKey, appliedPayload }) => {
    try {
      window.sessionStorage.clear()
      window.localStorage.clear()
      if (mergePayload) {
        window.sessionStorage.setItem(mergeKey, mergePayload)
      }
      if (appliedPayload) {
        window.sessionStorage.setItem(appliedKey, appliedPayload)
      }
    } catch {}
  }, {
    mergeKey: MERGE_KEY,
    mergePayload: scenario.mergeResult ? JSON.stringify(scenario.mergeResult) : null,
    appliedKey: APPLIED_KEY,
    appliedPayload: scenario.appliedSession ? JSON.stringify(scenario.appliedSession) : null,
  })

  const page = await context.newPage()
  const deepscanRequests = []
  page.on('request', (request) => {
    const url = request.url()
    if (url.includes('/api/deepscan?')) {
      deepscanRequests.push(url)
    }
  })

  let mergeSeedRow = null
  let afterApply = null

  if (scenario.mergeResult) {
    await page.goto(`${BASE_URL}/merge`, { waitUntil: 'networkidle' })
    mergeSeedRow = await page.evaluate((key) => {
      const raw = window.sessionStorage.getItem(key)
      if (!raw) return null
      try {
        return JSON.parse(raw)?.rows?.[0] ?? null
      } catch {
        return null
      }
    }, MERGE_KEY)

    await page.getByRole('button', { name: '포트폴리오에 적용하기' }).click()
    await page.waitForURL('**/home', { timeout: 15000 })
    await page.waitForLoadState('networkidle')

    afterApply = await dumpStorage(page)
  } else {
    await page.goto(`${BASE_URL}/home`, { waitUntil: 'networkidle' })
    afterApply = await dumpStorage(page)
  }

  const deepscanLinks = page.locator('a[href="/deepscan"]')
  const deepscanCount = await deepscanLinks.count()
  if (deepscanCount === 0) {
    throw new Error('home 화면에서 /deepscan 링크를 찾지 못함')
  }

  const chosenIndex = Math.min(1, deepscanCount - 1)
  await deepscanLinks.nth(chosenIndex).evaluate((node) => node.click())
  await page.waitForURL('**/deepscan', { timeout: 15000 })
  await page.waitForTimeout(3000)

  const afterDeepScan = await dumpStorage(page)

  await context.close()

  const appliedRow = afterApply.applied?.rows?.[0] || null
  const targetHolding = afterDeepScan.target?.holding || null
  const lastRequest = deepscanRequests.at(-1) || null

  let classification = 'unknown'
  if (appliedRow?.averagePrice && lastRequest && lastRequest.includes('averagePrice=')) {
    classification = 'recomputed-on-apply'
  } else if (!appliedRow?.averagePrice && lastRequest && !lastRequest.includes('averagePrice=')) {
    classification = scenario.appliedSession ? 'stale-applied-session-like' : 'source-insufficient-after-apply'
  }

  return {
    scenario: scenarioName,
    description: scenario.description,
    classification,
    mergeSeedRow: mergeSeedRow
      ? {
          quantity: mergeSeedRow.quantity,
          profitRate: mergeSeedRow.profitRate,
          evaluationAmount: mergeSeedRow.evaluationAmount,
          averagePrice: mergeSeedRow.averagePrice,
        }
      : null,
    appliedRow: appliedRow
      ? {
          quantity: appliedRow.quantity,
          averagePrice: appliedRow.averagePrice,
        }
      : null,
    targetHolding: targetHolding
      ? {
          shares: targetHolding.shares,
          averagePrice: targetHolding.averagePrice,
          evaluationAmount: targetHolding.evaluationAmount,
          metaLine: targetHolding.metaLine,
        }
      : null,
    deepscanRequests,
  }
}

async function main() {
  const requested = process.argv.slice(2)
  const names = requested.length ? requested : Object.keys(scenarios)
  const browser = await chromium.launch({ headless: true })

  try {
    const results = []
    for (const name of names) {
      const scenario = scenarios[name]
      if (!scenario) {
        throw new Error(`unknown scenario: ${name}`)
      }
      results.push(await runScenario(browser, name, scenario))
    }
    console.log(JSON.stringify({ baseUrl: BASE_URL, results }, null, 2))
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
