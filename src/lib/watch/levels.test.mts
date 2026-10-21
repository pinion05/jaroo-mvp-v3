import assert from 'node:assert/strict'

import {
  detectStockEvents,
  filterEventsForLevel,
  normalizeAlertLevel,
  parsePriceFromText,
  priceChangePctBetween,
  shouldSendWeeklySummary,
} from './levels'
import type { JarooDeepScanPayload } from '../../../packages/contracts/src/deepscan'

// 이 파일은 두 러너로 실행된다: 저장소 표준(npm run test:web:ts → tsx --test의
// node:test)과 npx vitest run src/lib/watch. vitest는 node:test 등록을 수집하지
// 않으므로('No test suite found') 러너를 감지해 동일한 테스트 본문을 현재 러너에
// 등록한다. assert는 node:assert/strict를 공용으로 쓴다(양 러너 모두 동작).
type RegisterTest = (name: string, fn: () => void | Promise<void>) => void

async function loadTestRegistrar(): Promise<RegisterTest> {
  if (process.env.VITEST != null) {
    // 리터럴이 아닌 지시자로 import — vitest를 의존성에 추가하지 않은 채
    // typecheck가 'vitest' 모듈을 정적으로 해석하지 않게 한다.
    const specifier = 'vitest'
    const mod = (await import(specifier)) as { test: RegisterTest }
    return mod.test
  }
  const mod = await import('node:test')
  return mod.test as unknown as RegisterTest
}

const test = await loadTestRegistrar()

type InsightItem = {
  sourceLabel: string
  label: string
  title: string
  date: string
  sourceBody?: string
  latestFilings?: Array<{ receiptDate: string | null; reportName: string | null; filerName?: string | null; riskLabel?: string | null }>
}

function payloadWith(insights: InsightItem[], currentPriceText: string | null): JarooDeepScanPayload {
  return {
    strategy: { currentPriceText },
    insights: { items: insights },
  } as unknown as JarooDeepScanPayload
}

// 실운영(HPSP) watch_daily_scans 공시 분석 카드 원본 — crawler 직렬화 형식
// '날짜 · 보고서명 · 제출:제출자 · 리스크라벨' 그대로. 카드 title은 종목마다
// 고정('{종목명} 최근 공시 흐름')이라 라인 단위 diff의 대상이 아니다.
const HPSP_SOURCE_BODY = [
  '20261012 · 임원ㆍ주요주주특정증권등소유상황보고서 · 제출:김근영 · 지분 변동',
  '20261007 · 주주총회소집공고 · 제출:HPSP · 일반',
  '20261007 · 주식등의대량보유상황보고서(약식) · 제출:삼성자산운용 · 지분 변동',
  '20261007 · 의결권대리행사권유참고서류 · 제출:HPSP · 일반',
  '20260923 · [기재정정]자기주식처분결과보고서 · 제출:HPSP · 확인 필요',
  '20260923 · 임원ㆍ주요주주특정증권등소유상황보고서 · 제출:김근영 · 지분 변동',
  '20260923 · 임원ㆍ주요주주특정증권등소유상황보고서 · 제출:한대희 · 지분 변동',
  '20260923 · 임원ㆍ주요주주특정증권등소유상황보고서 · 제출:BAEK LAK HO · 지분 변동',
].join('\n')

const 공시카드 = (sourceBody?: string, latestFilings?: InsightItem['latestFilings']): InsightItem => ({
  sourceLabel: '공시 분석',
  label: '공시',
  title: 'HPSP 최근 공시 흐름',
  date: '2026-10-12',
  ...(sourceBody ? { sourceBody } : {}),
  ...(latestFilings ? { latestFilings } : {}),
})

test('normalizeAlertLevel — 알 수 없는 값은 기본(normal)', () => {
  assert.equal(normalizeAlertLevel('detail'), 'detail')
  assert.equal(normalizeAlertLevel('minimal'), 'minimal')
  assert.equal(normalizeAlertLevel(undefined), 'normal')
  assert.equal(normalizeAlertLevel('super'), 'normal')
})

test('parsePriceFromText — 콤마·원 표기에서 숫자 추출', () => {
  assert.equal(parsePriceFromText('274,250원'), 274250)
  assert.equal(parsePriceFromText(null), null)
  assert.equal(parsePriceFromText('가격 정보 없음'), null)
})

test('어제와 오늘이 같은 공시 라인 집합이면 이벤트 0건', () => {
  // 카드 title이 양일 동일하므로 옛 title-diff 구현도 0건을 냈지만, 그건
  // 변화가 없어서가 아니라 title이 고정이라서였다. 이제 라인 단위 키로
  // 비교해 '정말 변화 없음'일 때만 0건이다.
  const yesterday = payloadWith([공시카드(HPSP_SOURCE_BODY)], '274,250원')
  const today = payloadWith([공시카드(HPSP_SOURCE_BODY)], '280,000원')
  assert.deepEqual(detectStockEvents(today, yesterday), [])
})

test('어제 대비 신규 공시 라인만 이벤트가 된다 — 카드 title은 양일 동일', () => {
  const 신규라인 = '20261014 · 주요사항보고서(자율공시) · 제출:HPSP · 일반'
  const yesterday = payloadWith([공시카드(HPSP_SOURCE_BODY)], '274,250원')
  const today = payloadWith([공시카드(`${신규라인}\n${HPSP_SOURCE_BODY}`)], '280,000원')
  const events = detectStockEvents(today, yesterday)
  // 카드 title('HPSP 최근 공시 흐름')이 양일 동일하므로 옛 title-diff 구현으로는
  // 절대 검출할 수 없던 경우다.
  assert.deepEqual(events.map((event) => event.title), ['주요사항보고서(자율공시) (제출:HPSP)'])
  assert.equal(events[0]?.kind, 'disclosure')
  assert.equal(events[0]?.layer, 1)
})

test('보고서명에 안전 키워드가 있으면 safety 이벤트로 분류된다', () => {
  const 신규라인 = '20261014 · 상장폐지 적합성 심사 대상 지정 · 제출:HPSP · 치명적 리스크'
  const yesterday = payloadWith([공시카드(HPSP_SOURCE_BODY)], '274,250원')
  const today = payloadWith([공시카드(`${신규라인}\n${HPSP_SOURCE_BODY}`)], '280,000원')
  const events = detectStockEvents(today, yesterday)
  assert.equal(events.length, 1)
  assert.equal(events[0]?.kind, 'safety')
  assert.equal(events[0]?.layer, 'safety')
  assert.equal(events[0]?.title, '상장폐지 적합성 심사 대상 지정 (제출:HPSP)')
})

test('구조체 latestFilings이 있으면 sourceBody보다 우선한다 — 어제는 구조체 없는 스냅샷', () => {
  // 어제: 실저장 스냅샷 형태(sourceBody만, 구조체 없음) / 오늘: 구조체 미러.
  // 오늘 sourceBody에는 구조체에 없는 미끄러지는 라인을 심어 구조체 우선을 검증.
  const yesterday = payloadWith([공시카드(HPSP_SOURCE_BODY)], '274,250원')
  const today = payloadWith(
    [
      공시카드(
        `${'20261014 · 소스바디에만 있는 보고서 · 제출:HPSP · 일반'}\n${HPSP_SOURCE_BODY}`,
        [
          { receiptDate: '2026-10-14', reportName: '주요사항보고서(자율공시)', filerName: 'HPSP', riskLabel: '일반' },
          { receiptDate: '2026-10-12', reportName: '임원ㆍ주요주주특정증권등소유상황보고서', filerName: '김근영', riskLabel: '지분 변동' },
        ],
      ),
    ],
    '280,000원',
  )
  const events = detectStockEvents(today, yesterday)
  assert.deepEqual(events.map((event) => event.title), ['주요사항보고서(자율공시) (제출:HPSP)'])
})

test('제출자 세그먼트 없는 라인은 filerName 빈 문자열로 파싱되어 신규 판정된다', () => {
  const 어제라인들 = HPSP_SOURCE_BODY
  const 오늘라인들 = HPSP_SOURCE_BODY.replace(
    '20261007 · 주주총회소집공고 · 제출:HPSP · 일반',
    '20261007 · 주주총회소집공고 · 일반',
  )
  const yesterday = payloadWith([공시카드(어제라인들)], '274,250원')
  const today = payloadWith([공시카드(오늘라인들)], '280,000원')
  const events = detectStockEvents(today, yesterday)
  assert.deepEqual(events.map((event) => event.title), ['주주총회소집공고'])
})

test('동일일·동일 보고서명이라도 제출자가 다르면 새 공시다 — 기존 제출자 건은 스킵', () => {
  // 어제는 20260923 임원보고서 3건 중 김근영·BAEK LAK HO만 있었고,
  // 오늘 한대희 건이 추가됐다. 동일 보고서명이지만 제출자가 키에 포함되어
  // 한대희 건만 신규로 발화한다.
  const 어제라인들 = HPSP_SOURCE_BODY
    .split('\n')
    .filter((line) => !line.includes('제출:한대희'))
    .join('\n')
  const yesterday = payloadWith([공시카드(어제라인들)], '274,250원')
  const today = payloadWith([공시카드(HPSP_SOURCE_BODY)], '280,000원')
  const events = detectStockEvents(today, yesterday)
  assert.deepEqual(events.map((event) => event.title), ['임원ㆍ주요주주특정증권등소유상황보고서 (제출:한대희)'])
})

test('날짜 형식 혼재 — 어제 YYYYMMDD(sourceBody)와 오늘 YYYY-MM-DD(구조체) 같은 공시는 새 공시 아니다', () => {
  const yesterday = payloadWith([공시카드('20261012 · 임원ㆍ주요주주특정증권등소유상황보고서 · 제출:김근영 · 지분 변동')], '274,250원')
  const today = payloadWith(
    [공시카드(undefined, [{ receiptDate: '2026-10-12', reportName: '임원ㆍ주요주주특정증권등소유상황보고서', filerName: '김근영', riskLabel: '지분 변동' }])],
    '280,000원',
  )
  assert.deepEqual(detectStockEvents(today, yesterday), [])
})

test('최초 관측(이전 스냅샷 없음) — 오늘 보고서명 중 안전 키워드만 즉시 발화', () => {
  const today = payloadWith([공시카드(`20261014 · 상장폐지 적합성 심사 대상 지정 · 제출:HPSP · 치명적 리스크\n${HPSP_SOURCE_BODY}`)], '100원')
  const events = detectStockEvents(today, null)
  assert.equal(events.length, 1)
  assert.equal(events[0]?.kind, 'safety')
  assert.equal(events[0]?.title, '상장폐지 적합성 심사 대상 지정 (제출:HPSP)')
})

test('가격 변화율 — 부호 있는 퍼센트', () => {
  const before = payloadWith([], '200원')
  const after = payloadWith([], '190원')
  assert.equal(priceChangePctBetween(after, before), -5)
})

test('강도 게이트 — minimal은 안전만, normal은 공시 포함, detail은 급등락 추가', () => {
  const events = detectStockEvents(
    payloadWith([공시카드(`20261014 · 주요사항보고서(자율공시) · 제출:HPSP · 일반\n${HPSP_SOURCE_BODY}`)], '105원'),
    payloadWith([공시카드(HPSP_SOURCE_BODY)], '100원'),
  )
  // 5% 상승이지만 공시 이벤트가 층1 — 급등락은 detail 전용.
  assert.equal(filterEventsForLevel(events, 'minimal', 5).events.length, 0)
  assert.equal(filterEventsForLevel(events, 'normal', 5).events.length, 1)
  const detail = filterEventsForLevel(events, 'detail', 5).events
  assert.equal(detail.length, 2)
  assert.ok(detail.some((event) => event.kind === 'spike'))
})

test('주간 요약은 minimal이면 보내지 않는다', () => {
  assert.equal(shouldSendWeeklySummary('minimal'), false)
  assert.equal(shouldSendWeeklySummary('normal'), true)
  assert.equal(shouldSendWeeklySummary('detail'), true)
})
