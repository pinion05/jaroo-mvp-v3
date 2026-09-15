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
  prevChangeRate: -1.08,
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
  // 전일 대비 등락률은 네이버 price의 prevChangeRate에서 (quotes API엔 등락률이 없다)
  assert.deepEqual(profile.quote, { changePct: -1.08 });
});

test('buildEtfProfile maps quote.changePct to null when prevChangeRate is absent', async () => {
  const { buildEtfProfile } = await import('../src/crawlers/etf-profile.js');

  const profile = buildEtfProfile({
    code: '069500',
    snapshot: null,
    naverPrice: { ...naverPriceFixture, prevChangeRate: null },
    naverComponent: null,
  });

  assert.equal(profile.ok, true);
  assert.deepEqual(profile.quote, { changePct: null });
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

test('fetchEtfProfile collects ~1y daily closes from m.stock naver price pages (Task 9)', async () => {
  const { fetchEtfProfile } = await import('../src/crawlers/etf-profile.js');

  const requestedUrls = [];
  // 5페이지 × 60행 (newest-first, 콤마 포함 문자열 시세) — page 5는 20행.
  const pageRow = (n) => ({
    localTradedAt: `2026-${String(10 - n).padStart(2, '0')}-15`,
    closePrice: `${(1000 + n).toLocaleString('en-US')}`,
  });
  const fetchImpl = async (url) => {
    requestedUrls.push(url);
    if (url.includes('/detail/')) {
      return { ok: true, json: async () => (url.endsWith('/price') ? naverPriceFixture : naverComponentFixture) };
    }
    const page = Number(new URL(url).searchParams.get('page'));
    const rows = page < 5 ? Array.from({ length: 60 }, (_, i) => pageRow(page + (i % 3))) : [];
    return { ok: true, json: async () => rows };
  };

  const profile = await fetchEtfProfile('069500', {
    fetchImpl,
    fetchSnapshot: async () => null,
  });

  assert.equal(profile.ok, true);
  assert.ok(Array.isArray(profile.daily));
  // 빈 페이지(5)에서 조기 종료 — 4페이지分 240행
  assert.equal(profile.daily.length, 240);
  // 오름차순(과거→최신) 정렬 + 콤마 제거 파싱
  const first = profile.daily[0];
  const last = profile.daily[profile.daily.length - 1];
  assert.ok(first.date < last.date, `expected ascending, got ${first.date}..${last.date}`);
  assert.equal(typeof last.close, 'number');
  assert.ok(requestedUrls.some((url) => url.includes('m.stock.naver.com/api/stock/069500/price')));
});

test('fetchEtfProfile tolerates daily history failure (daily: null)', async () => {
  const { fetchEtfProfile } = await import('../src/crawlers/etf-profile.js');

  const fetchImpl = async (url) => {
    if (url.includes('/price?page=') || url.includes('/price?')) {
      if (url.includes('m.stock.naver.com')) {
        throw new Error('history down');
      }
    }
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
    fetchSnapshot: async () => snapshotFixture,
  });

  assert.equal(profile.ok, true);
  assert.equal(profile.daily, null);
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
