const test = require('node:test');
const assert = require('node:assert/strict');

// TC-CRW-041 — src/crawlers/us-consensus.js (US 컨센서스/애널리스트) 커버리지 갭 테스트.
// us-consensus는 기존 자동화 테스트가 전무했다. FMP 미설정 환경에서 finnhub 폴백 경로만으로
// getUSConsensus가 컨센서스를 조립하는지(외부 네트워크 없음, fetch 스텁)와
// 추천 분포 → 파생 투자의견 라벨/스코어 변환, augmentUSConsensusWithWiseReport의
// peer/스냅 지표 보강을 검증한다.

// api-clients.js가 모듈 로드 시점에 API 키를 캡처하므로, 동적 import 전에 환경을 고정한다.
process.env.FINNHUB_API_KEY = 'tc-test-finnhub-token';
delete process.env.FMP_API_KEY;
delete process.env.POLYGON_API_KEY;

const RECOMMENDATIONS = [
  { strongBuy: 2, buy: 2, hold: 1, sell: 0, strongSell: 0, period: '2026-11' },
  { strongBuy: 1, buy: 1, hold: 2, sell: 1, strongSell: 0, period: '2026-10' },
];

function stubFinnhub() {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    const target = new URL(String(url));
    calls.push(target.hostname + target.pathname);
    assert.equal(target.hostname, 'finnhub.io', 'FMP/Polygon은 키 미설정이라 fetch가 발생하면 안 된다');

    if (target.pathname === '/api/v1/stock/recommendation') {
      return { ok: true, json: async () => RECOMMENDATIONS };
    }
    if (target.pathname === '/api/v1/stock/earnings') {
      return {
        ok: true,
        json: async () => [
          { actual: 2.1, estimate: 2.0, surprise: 0.1, surprisePercent: 5, period: '2026-Q3', quarter: 3, year: 2026 },
        ],
      };
    }
    if (target.pathname === '/api/v1/stock/profile2') {
      return {
        ok: true,
        json: async () => ({
          name: 'Apple Inc',
          finnhubIndustry: 'Technology',
          weburl: 'https://apple.com',
          exchange: 'NASDAQ',
          marketCapitalization: 3500000,
          logo: 'https://example.com/logo.png',
        }),
      };
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  };

  return async () => {
    globalThis.fetch = originalFetch;
    return calls;
  };
}

const wisereportRawData = {
  ticker: 'AAPL',
  pages: {
    'company-analysis': {
      auxiliary: [
        {
          id: 'compare-list',
          ok: true,
          data: {
            data: [
              { TICKER: 'MSFT', PROPER_NAME: 'Microsoft Corp', EX_NM: 'NASDAQ', CMP_CD: 'MSFT' },
              { TICKER: 'AAPL-US', PROPER_NAME: 'Apple Inc', EX_NM: 'NASDAQ', CMP_CD: 'AAPL' },
            ],
          },
        },
      ],
    },
    'company-snap': {
      auxiliary: [
        {
          id: 'snap-financial-summary',
          ok: true,
          data: {
            Data2: [
              { ITEM_NM: '시가총액(백만)', VAL1: '3500000' },
              { ITEM_NM: '보통주주가', VAL1: '258.35' },
            ],
          },
        },
      ],
    },
  },
};

test('TC-CRW-041 getUSConsensus는 FMP 미설정 시 finnhub 폴백(profile2·recommendation·earnings)으로 컨센서스를 조립하고, WiseReport 보강은 peer 목록·스냅 지표를 채운다', async () => {
  const { getUSConsensus, augmentUSConsensusWithWiseReport } = await import('../src/crawlers/us-consensus.js');
  const restore = stubFinnhub();

  try {
    const result = await getUSConsensus('AAPL');

    // 1) 프로필: fmp 실패 → finnhub profile2 폴백
    assert.equal(result.profile.companyName, 'Apple Inc');
    assert.equal(result.profile.sector, 'Technology');
    assert.equal(result.profile.exchange, 'NASDAQ');
    assert.equal(result.profile.mktCap, 3500000);
    assert.equal(result.profile.source, 'finnhub-profile2');

    // 2) FMP 전용 데이터(목표가 컨센서스/추정치)는 우아하게 null
    assert.equal(result.consensus, null);
    assert.equal(result.analystEstimates, null);
    assert.equal(result.meta.target.source, null);
    assert.equal(result.meta.target.status, 'unavailable');
    assert.equal(result.meta.estimates.status, 'unavailable');

    // 3) 추천 분포 스냅샷: 최신 행 기준
    assert.equal(result.recommendations.provider, 'finnhub');
    assert.equal(result.recommendations.totalAnalysts, 5);
    assert.deepEqual(result.recommendations.distribution, {
      strongBuy: 2, buy: 2, hold: 1, sell: 0, strongSell: 0, total: 5,
    });

    // 4) 파생 투자의견: (2*5 + 2*4 + 1*3) / 5 = 4.2 → 'Buy', 1~5 스케일
    assert.equal(result.rating.provider, 'finnhub');
    assert.equal(result.rating.source, 'finnhub-recommendation-derived');
    assert.equal(result.rating.label, 'Buy');
    assert.equal(result.rating.score, 4.2);
    assert.equal(result.rating.scaleMin, 1);
    assert.equal(result.rating.scaleMax, 5);
    assert.equal(result.rating.totalAnalysts, 5);
    assert.equal(result.rating.period, '2026-11');

    // 5) 실적: earnings 캘린더(fmp) 부재 → finnhub earnings 히스토리 폴백
    assert.equal(result.earnings.length, 1);
    assert.equal(result.earnings[0].provider, 'finnhub');
    assert.equal(result.earnings[0].source, 'finnhub-earnings-history');
    assert.equal(result.earnings[0].epsActual, 2.1);
    assert.equal(result.earnings[0].estimate, 2.0);
    assert.equal(result.earnings[0].surprisePercent, 5);

    // 6) 프로필·컨센서스가 이미 있으므로 WiseReport 자동 보강은 미요청으로 끝난다(네트워크 0회)
    assert.equal(result.meta.peers.status, 'not_requested');
    assert.equal(result.meta.peers.attempted, false);

    // 7) WiseReport 보강(순수 함수): compare-list → peers, snap 요약 → 프로필 공백 필드
    const augmented = augmentUSConsensusWithWiseReport(result, wisereportRawData);
    assert.equal(augmented.meta.profile.status, 'ok');
    assert.deepEqual(
      augmented.meta.profile.filledFields,
      ['price'],
      '기존 프로필에 없던 price만 보강해야 한다(회사명/거래소/시가총액은 보존)',
    );
    assert.equal(augmented.profile.price, 258.35);
    assert.equal(augmented.profile.companyName, 'Apple Inc', '기존 값이 우선한다');
    assert.equal(augmented.profile.source, 'finnhub-profile2', '기존 source는 덮어쓰지 않는다');

    assert.equal(augmented.meta.peers.status, 'ok');
    assert.equal(augmented.meta.peers.count, 2);
    assert.deepEqual(
      augmented.peers.items,
      [
        { ticker: 'MSFT', companyName: 'Microsoft Corp', exchange: 'NASDAQ', cmpCode: 'MSFT' },
        { ticker: 'AAPL-US', companyName: 'Apple Inc', exchange: 'NASDAQ', cmpCode: 'AAPL' },
      ],
    );

    assert.equal(augmented.meta.references.status, 'ok');
    assert.deepEqual(
      augmented.references.peers.compareList,
      { data: wisereportRawData.pages['company-analysis'].auxiliary[0].data.data },
      'compare-list 참조는 aux data 래퍼 객체 그대로 노출된다',
    );

    // 8) 네트워크 호출은 finnhub 3종(company-news 아님: recommendation, earnings, profile2)뿐
    const calls = await restore();
    assert.deepEqual(calls.sort(), [
      'finnhub.io/api/v1/stock/earnings',
      'finnhub.io/api/v1/stock/profile2',
      'finnhub.io/api/v1/stock/recommendation',
    ]);
  } finally {
    await restore();
  }
});
