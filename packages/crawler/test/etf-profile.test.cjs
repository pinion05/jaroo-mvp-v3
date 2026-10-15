const test = require('node:test');
const assert = require('node:assert/strict');
const { mock } = require('node:test');

const naverPriceFixture = {
  itemname: 'KODEX 200',
  type: 'EF', // Naver price 상품 유형 — 069500 실측값(2026-10-15)
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
  // 스냅샷 부재 → 시장 미확정(null). 네이버 price엔 시장 식별자가 없어 'kospi'로
  // 추측하지 않는다(오염 계약의 의도적 전환 — 무음 실패 수정).
  assert.equal(profile.market, null);
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

  // 실패 경로는 무음이 아니어야 한다 — 서버 콘솔 warn 1회(코드+에러명 포함).
  const warnMock = mock.method(console, 'warn');

  try {
    const profile = await fetchEtfProfile('069500', {
      fetchImpl,
      fetchSnapshot: async () => {
        throw new Error('wisereport down');
      },
    });

    assert.equal(profile.ok, true);
    assert.equal(profile.name, 'KODEX 200');
    assert.equal(profile.holdings.length, 2);
    // 실패 관측 가능화: 응답 마커 'failed' + 시장 미확정(null)
    assert.equal(profile.sources.wisereport, 'failed');
    assert.equal(profile.market, null);
    assert.equal(warnMock.mock.callCount(), 1);
    assert.match(String(warnMock.mock.calls[0].arguments[0]), /069500/);
    assert.match(String(warnMock.mock.calls[0].arguments[0]), /wisereport 스냅샷 실패/);
  } finally {
    warnMock.mock.restore();
  }

  for (const call of fetchedUrls) {
    assert.match(call.headers['User-Agent'], /Mozilla/);
  }
});

// 무음 실패 수정의 핵심 회귀 방지 — 스냅샷 부재 시 KOSDAQ 상품이 'kospi'로
// 오염되지 않는다(229200 KODEX 코스닥150, naverPrice itemname 실측값).
test('fetchEtfProfile leaves market null for KOSDAQ products when snapshot is missing (no kospi pollution)', async () => {
  const { fetchEtfProfile } = await import('../src/crawlers/etf-profile.js');

  const kosdaqNaverPrice = {
    ...naverPriceFixture,
    itemname: 'KODEX 코스닥150',
  };
  const fetchImpl = async (url) => {
    if (url.endsWith('/price')) return { ok: true, json: async () => kosdaqNaverPrice };
    if (url.endsWith('/ETFComponent')) return { ok: true, json: async () => [] };
    throw new Error(`unexpected url: ${url}`);
  };

  const profile = await fetchEtfProfile('229200', {
    fetchImpl,
    fetchSnapshot: async () => null,
  });

  assert.equal(profile.ok, true);
  assert.equal(profile.name, 'KODEX 코스닥150');
  // 절대 'kospi'가 아님 — 시장 미확정은 null
  assert.equal(profile.market, null);
  assert.notEqual(profile.market, 'kospi');
});

test('fetchEtfProfile marks sources.wisereport empty (null-resolved snapshot) without warning', async () => {
  const { fetchEtfProfile } = await import('../src/crawlers/etf-profile.js');

  const fetchImpl = async (url) => {
    if (url.endsWith('/price')) return { ok: true, json: async () => naverPriceFixture };
    if (url.endsWith('/ETFComponent')) return { ok: true, json: async () => naverComponentFixture };
    throw new Error(`unexpected url: ${url}`);
  };

  const warnMock = mock.method(console, 'warn');

  try {
    // fetchSnapshot이 null로 해결(빈/인식 불가 페이지) — throw가 아니므로 warn 없음
    const profile = await fetchEtfProfile('069500', {
      fetchImpl,
      fetchSnapshot: async () => null,
    });

    assert.equal(profile.ok, true);
    assert.equal(profile.sources.wisereport, 'empty');
    assert.equal(warnMock.mock.callCount(), 0);
  } finally {
    warnMock.mock.restore();
  }
});

test('fetchEtfProfile marks sources.wisereport ok when the snapshot resolves', async () => {
  const { fetchEtfProfile } = await import('../src/crawlers/etf-profile.js');

  const fetchImpl = async (url) => {
    if (url.endsWith('/price')) return { ok: true, json: async () => naverPriceFixture };
    if (url.endsWith('/ETFComponent')) return { ok: true, json: async () => naverComponentFixture };
    throw new Error(`unexpected url: ${url}`);
  };

  const profile = await fetchEtfProfile('069500', {
    fetchImpl,
    fetchSnapshot: async () => snapshotFixture,
  });

  assert.equal(profile.ok, true);
  assert.equal(profile.sources.wisereport, 'ok');
  assert.equal(profile.market, 'kospi');
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
test('fetchEtfProfile rejects stock codes (type ST → NotAnEtfError)', async () => {
  const { fetchEtfProfile } = await import('../src/crawlers/etf-profile.js');

  const stockPriceFixture = {
    itemname: '삼성전자',
    type: 'ST', // 005930 실측값(2026-10-15)
    nowPrice: 60_000,
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

// 2026-10-15 실측: 530092 삼성 인버스 코스피 200 선물 ETN — naver price type='EN',
// nav/inav/issuerNameKo/deviationRate/totalNetAssets/totalFee 전부 null이라 구
// hasEtfSignal 휴리스틱이 ETN을 주식으로 오판했다(폐지 동기).
const etnPriceFixture = {
  itemname: '삼성 인버스 코스피 200 선물 ETN',
  type: 'EN',
  nowPrice: 3130,
  prevChangeRate: 7.56,
  nav: null,
  inav: null,
  issuerNameKo: null,
  totalNetAssets: null,
  totalFee: null,
  deviationRate: null,
};

const etnSnapshotFixture = {
  schemaVersion: 'wisereport-etf-snapshot-v1',
  code: '530092',
  asOf: '2026-10-14',
  product: {
    name: '삼성 인버스 코스피 200 선물 ETN',
    marketName: 'KOSPI',
    baseIndexName: '코스피 200 선물 TWAP 인버스지수',
    issuerName: '삼성증권',
    // ETN 전용 키(2026-10-15 실측): EXPENSES/FIRST_ISSUE_DT/EXP_TRD_DT/REPAY_UNIT/REPAY_COMM
    expensePct: 0.5,
    firstIssueDate: '2021-10-14',
    expiryDate: '2031-09-15',
    repayUnit: 100000,
    repayCommissionPct: 1.0,
  },
  marketStatus: {
    closePrice: 2910,
    returns: { oneMonthPct: 10.86, threeMonthPct: 5.05, sixMonthPct: -22.0, twelveMonthPct: null },
  },
  constituents: { rows: [] },
};

test('fetchEtfProfile builds an ETN profile for type EN with holdings fixed to null', async () => {
  const { fetchEtfProfile } = await import('../src/crawlers/etf-profile.js');

  const fetchImpl = async (url) => {
    if (url.endsWith('/price')) return { ok: true, json: async () => etnPriceFixture };
    // ETFComponent는 ETN에 200+빈 배열을 반환한다(실측) — []를 세는 결함 방어
    if (url.endsWith('/ETFComponent')) return { ok: true, json: async () => [] };
    throw new Error(`unexpected url: ${url}`);
  };

  const profile = await fetchEtfProfile('530092', {
    fetchImpl,
    fetchSnapshot: async () => etnSnapshotFixture,
  });

  assert.equal(profile.ok, true);
  assert.equal(profile.instrumentType, 'etn');
  assert.equal(profile.name, '삼성 인버스 코스피 200 선물 ETN');
  assert.equal(profile.market, 'kospi');
  assert.deepEqual(profile.quote, { changePct: 7.56 });
  assert.deepEqual(profile.returns, { m1: 10.86, m3: 5.05, m6: -22.0, y1: null });
  // ETN product: EXPENSES→totalFeePct, 발행/만기/상환 필드 주입
  assert.equal(profile.product.totalFeePct, 0.5);
  assert.equal(profile.product.issuerName, '삼성증권');
  assert.equal(profile.product.firstSettleDate, null); // ETF 전용 — ETN 응답에 부재
  assert.equal(profile.product.issueDate, '2021-10-14');
  assert.equal(profile.product.maturityDate, '2031-09-15');
  assert.equal(profile.product.repayUnit, 100000);
  assert.equal(profile.product.repayCommissionPct, 1.0);
  // nav/aum은 ETN price 응답에 없다(실측 전부 null)
  assert.equal(profile.product.nav, null);
  assert.equal(profile.product.aum, null);
  // 핵심 회귀 방어: ETFComponent가 200+[]를 반환해도 ETN holdings는 null
  assert.equal(profile.holdings, null);
  assert.equal(profile.sources.wisereport, 'ok');
});

test('fetchEtfProfile tolerates a missing wisereport snapshot for ETN (ok:true 관용)', async () => {
  const { fetchEtfProfile } = await import('../src/crawlers/etf-profile.js');

  const fetchImpl = async (url) => {
    if (url.endsWith('/price')) return { ok: true, json: async () => etnPriceFixture };
    if (url.endsWith('/ETFComponent')) return { ok: true, json: async () => [] };
    throw new Error(`unexpected url: ${url}`);
  };

  const profile = await fetchEtfProfile('530092', {
    fetchImpl,
    fetchSnapshot: async () => null,
  });

  assert.equal(profile.ok, true);
  assert.equal(profile.instrumentType, 'etn');
  assert.equal(profile.sources.wisereport, 'empty');
  // 스냅샷 부재 → ETN 상품 필드 전부 null로 관용(ETF와 동일 정책)
  assert.equal(profile.product.issueDate, null);
  assert.equal(profile.product.maturityDate, null);
  assert.equal(profile.product.totalFeePct, null);
  assert.equal(profile.market, null);
  assert.equal(profile.holdings, null);
});

test('fetchEtfProfile rejects codes whose naver price type is unrecognized or absent (no heuristic fallback)', async () => {
  const { fetchEtfProfile } = await import('../src/crawlers/etf-profile.js');

  // type 부재 — 휴리스틱 부활 금지(지시): nav가 있어도 거부
  const legacyShapeWithNav = { ...etnPriceFixture, type: undefined, nav: 100 };
  await assert.rejects(
    () =>
      fetchEtfProfile('530092', {
        fetchImpl: async (url) => {
          if (url.endsWith('/price')) return { ok: true, json: async () => legacyShapeWithNav };
          return { ok: true, json: async () => [] };
        },
        fetchSnapshot: async () => null,
      }),
    (error) => error.code === 'NOT_ETF',
  );

  // 미인식 값 — 결정론 3분류(EF/EN/ST) 밖은 전부 거부
  const unknownType = { ...etnPriceFixture, type: 'XY' };
  await assert.rejects(
    () =>
      fetchEtfProfile('530092', {
        fetchImpl: async (url) => {
          if (url.endsWith('/price')) return { ok: true, json: async () => unknownType };
          return { ok: true, json: async () => [] };
        },
        fetchSnapshot: async () => null,
      }),
    (error) => error.code === 'NOT_ETF',
  );
});
