const test = require('node:test');
const assert = require('node:assert/strict');

// 네이버 컨센서스 폴백(buildNaverConsensusSyntheticRow) 회귀 테스트.
//
// 배경(PR #345): 합성 행의 증권사별 데이터(analystBrokers·증권사수·최고/최저)가
// 루트 필드에만 있으면 딥스캔 canonical의 slim 재조립(deepscan-payload 빌더가
// rows 있는 페이지를 테이블 페이로드로 취급)에서 전부 떨어져 나가
// analystCount 1 · brokers null → 웹 '증권사 1곳' 폴백이 떴다(실측 005930).
// 합성 행 rows에 증권사별 행(추정기관·목표주가·날짜)을 싣는 수정을 고정한다.

function naverConsensusIsoDaysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// stock.naver.com 실제 엔드포인트 2개(consensus JSON API, researches/v2/company)를
// 스텁한다. 날짜는 90일 리포트 윈도우 안쪽(now 기준 상대 날짜)으로 생성한다.
function stubNaverConsensusFetch({ brokerItems }) {
  const originalFetch = globalThis.fetch;
  const fetchCalls = [];
  globalThis.fetch = async (url) => {
    const target = new URL(String(url));
    fetchCalls.push(target.pathname + target.search);

    if (target.pathname === '/api/domestic/detail/005930/consensus') {
      return {
        ok: true,
        json: async () => ({ targetPrice: '100,000', opinion: '4.04', date: '20260909' }),
      };
    }
    if (target.pathname === '/api/stockSecurity/researches/v2/company') {
      const offset = Number(target.searchParams.get('index') ?? '0');
      return {
        ok: true,
        json: async () => ({ items: offset === 0 ? brokerItems : [] }),
      };
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  };

  return async () => {
    globalThis.fetch = originalFetch;
    return fetchCalls;
  };
}

test('buildNaverConsensusSyntheticRow가 증권사별 행(추정기관·목표주가·날짜)을 rows에 싣는다', async () => {
  const dMirae = naverConsensusIsoDaysAgo(5);
  const dHyundai = naverConsensusIsoDaysAgo(10);
  const restore = stubNaverConsensusFetch({
    brokerItems: [
      { brokerName: '미래에셋증권', goalPrice: '110,000', writeDate: dMirae },
      { brokerName: '현대차증권', goalPrice: '90,000', writeDate: dHyundai },
    ],
  });

  try {
    const { buildNaverConsensusSyntheticRow } = await import('../src/services/deepscan-kr-naver-consensus.js');
    const synthetic = await buildNaverConsensusSyntheticRow('005930');

    assert.ok(synthetic, '폴백 합성 행이 생성되어야 한다');
    // 루트 요약(합성 행이 그대로 살아있는 경로용)도 유지된다.
    assert.equal(synthetic.추정기관, 'consensus');
    assert.equal(synthetic.targetPrice, 100000);
    assert.equal(synthetic.증권사수, 2);
    assert.equal(synthetic.최고목표주가, 110000);
    assert.equal(synthetic.최저목표주가, 90000);
    assert.deepEqual(synthetic.analystBrokers, [
      { name: '미래에셋증권', targetPrice: 110000, date: dMirae },
      { name: '현대차증권', targetPrice: 90000, date: dHyundai },
    ]);
    // 핵심 수정: 증권사별 행이 readTargetPriceFromRow/rowBrokers가 인식하는
    // 키(추정기관·목표주가·날짜)로 rows에 실려야 한다.
    assert.deepEqual(synthetic.rows, [
      { 추정기관: 'consensus', 목표주가: 100000, '투자의견(점수)': 4.04 },
      { 추정기관: '미래에셋증권', 목표주가: 110000, 날짜: dMirae },
      { 추정기관: '현대차증권', 목표주가: 90000, 날짜: dHyundai },
    ]);
  } finally {
    await restore();
  }
});

test('네이버 폴백 합성 행이 딥스캔 slim 재조립(루트 요약 유실) 후에도 analystCount·analystBrokers·최고/최저를 복원한다', async () => {
  const dMirae = naverConsensusIsoDaysAgo(5);
  const dHyundai = naverConsensusIsoDaysAgo(10);
  const restore = stubNaverConsensusFetch({
    brokerItems: [
      { brokerName: '미래에셋증권', goalPrice: '110,000', writeDate: dMirae },
      { brokerName: '현대차증권', goalPrice: '90,000', writeDate: dHyundai },
    ],
  });

  try {
    const { buildNaverConsensusSyntheticRow } = await import('../src/services/deepscan-kr-naver-consensus.js');
    const synthetic = await buildNaverConsensusSyntheticRow('005930');
    assert.ok(synthetic);

    // 크롤러(getCrawlV12)와 동일하게 합성 행을 opinion 페이지에 주입한다
    // (crawler 반환은 normalized·pages 두 키 모두 갱신한다).
    const opinionPage = { ...synthetic, bodyTextHead: '네이버 증권 컨센서스 폴백 데이터' };
    const aggregate = {
      normalized: { opinion: opinionPage },
      pages: { opinion: opinionPage },
    };

    // 딥스캔 canonical이 실제로 쓰는 slim 재조립 경로(deepscan-payload 자체 빌더).
    // rows 있는 페이지는 테이블 페이로드로 취급되어 루트 요약 필드가 유실된다.
    const { loadWiseReportKrSlimSource } = await import('../src/services/deepscan-payload.js');
    const slim = await loadWiseReportKrSlimSource(
      { instrument: { code: '005930', name: '삼성전자' } },
      { loadAggregate: async () => aggregate, cacheClient: null },
    );

    assert.deepEqual(Object.keys(slim.pages.opinion), ['rows'], 'slim 재조립 후 opinion 페이지는 rows만 남는다(루트 요약 유실 재현)');
    assert.equal(slim.pages.opinion.rows.length, 3);

    const { buildDeepScanKrEvidencePacket } = await import('../src/services/deepscan-kr-evidence.js');
    const packet = buildDeepScanKrEvidencePacket(
      {
        instrument: { code: '005930', name: '삼성전자' },
        holding: { shares: '12', averagePrice: '71000' },
      },
      { slim },
    );

    const snapshot = packet.consensusSnapshot;
    // 루트 요약이 유실된 slim에서도 rows 기반으로 복원되어야 한다(실측 005930 회귀).
    assert.equal(snapshot.targetPrice, 100000);
    assert.equal(snapshot.recommendationScore, 4.04);
    assert.equal(snapshot.analystCount, 2);
    assert.deepEqual(snapshot.analystBrokers, [
      { name: '미래에셋증권', targetPrice: 110000, date: dMirae },
      { name: '현대차증권', targetPrice: 90000, date: dHyundai },
    ]);
    assert.equal(snapshot.highestTargetPrice, 110000);
    assert.equal(snapshot.lowestTargetPrice, 90000);
  } finally {
    await restore();
  }
});
