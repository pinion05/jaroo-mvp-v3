const test = require('node:test');
const assert = require('node:assert/strict');

const naverPriceFixture = {
  itemname: 'KODEX 200',
  issuerNameKo: '삼성자산운용(ETF)',
  totalFee: 0.15,
  totalNetAssets: 24_418_048_340_212,
  nav: 105_660.1,
  inav: 104_819.62,
  deviationRate: 0.24,
  deviationSign: '-',
  nowPrice: 104_275,
};

const naverComponentFixture = [
  {
    itemCode: '069500',
    componentItemCode: '005930',
    componentName: '삼성전자',
    weight: '32.63',
    referenceDate: '2026-09-15',
  },
  {
    itemCode: '069500',
    componentItemCode: '000660',
    componentName: 'SK하이닉스',
    weight: '27.07',
    referenceDate: '2026-09-15',
  },
];

const snapshotFixture = {
  schemaVersion: 'wisereport-etf-snapshot-v1',
  code: '069500',
  asOf: '2026-09-15',
  product: {
    name: 'KODEX 200',
    marketName: 'KOSPI',
    baseIndexName: '코스피200지수',
    firstSettleDate: '2002-10-11',
    totalFeePct: 0.15,
    issuerName: '삼성자산운용(주)',
  },
  marketStatus: {
    beta: 1.0,
    yearHigh: 152_455,
    yearLow: 100_000,
    returns: { oneMonthPct: 1.2, threeMonthPct: 3.4, sixMonthPct: null, twelveMonthPct: -5.6 },
  },
  constituents: { rows: [] },
};

test('buildEtfProfile merges naver price, wisereport snapshot, and naver components', async () => {
  const { buildEtfProfile } = await import('../src/crawlers/etf-profile.js');

  const profile = buildEtfProfile({
    code: '069500',
    snapshot: snapshotFixture,
    naverPrice: naverPriceFixture,
    naverComponent: naverComponentFixture,
  });

  assert.equal(profile.schemaVersion, 'jaroo-etf-profile-v1');
  assert.equal(profile.ok, true);
  assert.equal(profile.code, '069500');
  assert.equal(profile.name, 'KODEX 200');
  assert.equal(profile.market, 'kospi');
  // 위세리포트 우선, 네이버 보강
  assert.equal(profile.product.issuerName, '삼성자산운용(주)');
  assert.equal(profile.product.baseIndexName, '코스피200지수');
  assert.equal(profile.product.firstSettleDate, '2002-10-11');
  assert.equal(profile.product.aum, 24_418_048_340_212);
  assert.equal(profile.product.nav, 105_660.1);
  assert.equal(profile.product.deviationPct, -0.24); // deviationSign '-' 반영
  assert.equal(profile.product.totalFeePct, 0.15);
  // 구성종목: weight 내림차순, rank 부여
  assert.deepEqual(profile.holdings, [
    { rank: 1, code: '005930', name: '삼성전자', weightPct: 32.63, changePct: null },
    { rank: 2, code: '000660', name: 'SK하이닉스', weightPct: 27.07, changePct: null },
  ]);
  // 기간별 수익률은 위세리포트 스냅샷에서
  assert.deepEqual(profile.returns, { m1: 1.2, m3: 3.4, m6: null, y1: -5.6 });
  assert.equal(profile.daily, null);
});

test('buildEtfProfile tolerates missing snapshot (naver-only) and caps holdings at 30', async () => {
  const { buildEtfProfile } = await import('../src/crawlers/etf-profile.js');

  const manyComponents = Array.from({ length: 40 }, (_, i) => ({
    componentItemCode: String(100000 + i),
    componentName: `종목${i}`,
    weight: String(40 - i),
    referenceDate: '2026-09-15',
  }));

  const profile = buildEtfProfile({
    code: '069500',
    snapshot: null,
    naverPrice: naverPriceFixture,
    naverComponent: manyComponents,
  });

  assert.equal(profile.ok, true);
  assert.equal(profile.product.baseIndexName, null);
  assert.equal(profile.product.firstSettleDate, null);
  assert.equal(profile.product.issuerName, '삼성자산운용(ETF)');
  assert.equal(profile.market, 'kospi');
  assert.equal(profile.holdings.length, 30);
  assert.equal(profile.holdings[0].rank, 1);
  assert.deepEqual(profile.returns, null);
});

test('buildEtfProfile maps kosdaq market and rejects non-list component rows', async () => {
  const { buildEtfProfile } = await import('../src/crawlers/etf-profile.js');

  const profile = buildEtfProfile({
    code: '226490',
    snapshot: { ...snapshotFixture, product: { ...snapshotFixture.product, marketName: 'KOSDAQ' } },
    naverPrice: naverPriceFixture,
    naverComponent: [
      { componentItemCode: '005930', componentName: '삼성전자', weight: '10', referenceDate: '2026-09-15' },
      { componentItemCode: '', componentName: '현금성', weight: '5', referenceDate: '2026-09-15' },
    ],
  });

  assert.equal(profile.market, 'kosdaq');
  assert.equal(profile.holdings.length, 1);
});

test('fetchEtfProfile fetches naver endpoints with UA header and tolerates snapshot failure', async () => {
  const { fetchEtfProfile } = await import('../src/crawlers/etf-profile.js');

  const fetchedUrls = [];
  const fetchImpl = async (url, init) => {
    fetchedUrls.push({ url, headers: init?.headers });
    if (url.endsWith('/price')) {
      return { ok: true, json: async () => naverPriceFixture };
    }
    if (url.endsWith('/ETFComponent')) {
      return { ok: true, json: async () => naverComponentFixture };
    }
    throw new Error(`unexpected url: ${url}`);
  };

  const profile = await fetchEtfProfile('069500', {
    fetchImpl,
    fetchSnapshot: async () => {
      throw new Error('wisereport down');
    },
  });

  assert.equal(profile.ok, true);
  assert.equal(profile.name, 'KODEX 200');
  assert.equal(profile.holdings.length, 2);
  for (const call of fetchedUrls) {
    assert.match(call.headers['User-Agent'], /Mozilla/);
  }
});

test('fetchEtfProfile throws when naver price fails entirely', async () => {
  const { fetchEtfProfile } = await import('../src/crawlers/etf-profile.js');

  await assert.rejects(
    () =>
      fetchEtfProfile('069500', {
        fetchImpl: async () => ({ ok: false, status: 404, text: async () => 'not found' }),
        fetchSnapshot: async () => snapshotFixture,
      }),
    /etf profile unavailable/i,
  );
});

// Regression: ISSUE-001 — 주식 코드가 ok:true ETF 프로필로 반환되던 결함
// Found by /qa on 2026-09-15
// Report: .gstack/qa-reports/qa-report-localhost-3000-2026-09-15.md
test('fetchEtfProfile rejects stock codes without ETF signals (NotAnEtfError)', async () => {
  const { fetchEtfProfile } = await import('../src/crawlers/etf-profile.js');

  const stockPriceFixture = {
    itemname: '삼성전자',
    nowPrice: 60_000,
    // nav/inav/issuerNameKo 부재 = ETF 아님
  };

  await assert.rejects(
    () =>
      fetchEtfProfile('005930', {
        fetchImpl: async () => ({ ok: true, json: async () => stockPriceFixture }),
        fetchSnapshot: async () => null,
      }),
    (error) => error.code === 'NOT_ETF' && error.name === 'NotAnEtfError',
  );
});
