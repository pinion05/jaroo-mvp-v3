const test = require('node:test');
const assert = require('node:assert/strict');

const fixtureHtml = `
<html><head><title>KODEX 코스피 - ETF/ETN</title></head><body>
<script>
var status_data = {"CLS_PRC":"84,235","PRC_CHG":"-4,995","ADJ_CHG":"-5.60","YR_HIGH":"91,800","YR_LOW":"28,203","LIST_STK_CNT":"13,700","trD_QTY":"543,884","trD_AMT":"45,853","MKT_VAL":"11,540","YR_BETA":"1.00","AVG_TRD_QTY20":"596,968","AVG_TRD_AMT20":"48,115","FRG_RT":"0.70","ERN1":"18.52","ERN3":"46.41","ERN6":"101.85","ERN12":"196.28"};
var stock_price_relative_chart_data = {"name":[{"CMP_CD":"226490","CMP_NM":"KODEX 코스피","MKT_NM":"KOSPI"}]};
var product_summary_data = {"BASE_IDX_NM_KOR":"코스피지수","FIRST_SETTLE_DT":"2015-08-21","LIST_DT":"2015-08-24","FUND_TYP":"수익증권형","TOT_PAY":"0.150","DIV_BASE_DT":"매 1월, 4월 7월, 10월의 마지막 영업일","LP_NM_KOR":"신한증권, 한국증권","ISSUE_NM_KOR":"삼성자산운용(주)","URL":"http://www.kodex.com"};
var CU_data = {"grid_data":[
 {"TRD_DT":"2026-06-05","AGMT_STK_CNT":3778.00,"STK_NM_KOR":"삼성전자","ETF_WEIGHT":29.60},
 {"TRD_DT":"2026-06-05","AGMT_STK_CNT":461.00,"STK_NM_KOR":"SK하이닉스","ETF_WEIGHT":22.72},
 {"TRD_DT":"2026-06-05","AGMT_STK_CNT":86.00,"STK_NM_KOR":"SK스퀘어","ETF_WEIGHT":2.58},
 {"TRD_DT":"2026-06-05","AGMT_STK_CNT":133.00,"STK_NM_KOR":"현대차","ETF_WEIGHT":2.22}
]};
var volume_chart_data = {"grid_data":[{"TRD_DT":"2026-06-05","AVG_TRD_QTY":450.0,"AVG_TRD_AMT":39563.0}]};
</script>
</body></html>`;

test('parseWiseReportEtfSnapshotHtml extracts ETF product, status, holdings, and liquidity snapshot', async () => {
  const { parseWiseReportEtfSnapshotHtml } = await import('../src/crawlers/wisereport-etf.js');

  const snapshot = parseWiseReportEtfSnapshotHtml(fixtureHtml, '226490');

  assert.equal(snapshot.schemaVersion, 'wisereport-etf-snapshot-v1');
  assert.equal(snapshot.code, '226490');
  assert.equal(snapshot.asOf, '2026-06-05');
  assert.deepEqual(snapshot.product, {
    name: 'KODEX 코스피',
    marketName: 'KOSPI',
    baseIndexName: '코스피지수',
    firstSettleDate: '2015-08-21',
    listDate: '2015-08-24',
    fundType: '수익증권형',
    totalFeePct: 0.15,
    financialPeriod: null,
    distributionBaseDate: '매 1월, 4월 7월, 10월의 마지막 영업일',
    liquidityProviders: '신한증권, 한국증권',
    issuerName: '삼성자산운용(주)',
    issuerUrl: 'http://www.kodex.com',
    // ETN 전용 키 — ETF 응답에는 없어 null(하위호환 계약)
    expensePct: null,
    firstIssueDate: null,
    expiryDate: null,
    repayUnit: null,
    repayCommissionPct: null,
  });
  assert.equal(snapshot.marketStatus.closePrice, 84235);
  assert.equal(snapshot.marketStatus.changePct, -5.6);
  assert.equal(snapshot.marketStatus.returns.oneMonthPct, 18.52);
  assert.equal(snapshot.constituents.totalCount, 4);
  assert.equal(snapshot.constituents.top10WeightPct, 57.12);
  assert.deepEqual(snapshot.constituents.top10.slice(0, 2), [
    { rank: 1, asOf: '2026-06-05', name: '삼성전자', shares: 3778, weightPct: 29.6 },
    { rank: 2, asOf: '2026-06-05', name: 'SK하이닉스', shares: 461, weightPct: 22.72 },
  ]);
  assert.equal(snapshot.liquidity.avgTradingVolume, 450);
});

// ETN 상품 — 동일 엔드포인트(ETF.aspx?cmp_cd=530092)가 ETN 응답을 반환한다.
// product_summary_data 실측값(2026-10-15): EXPENSES='0.50'(보수), FIRST_ISSUE_DT
// ='2021-10-14'(최초발행), EXP_TRD_DT='2031-09-15'(만기), REPAY_UNIT='100000'
// (상환단위), REPAY_COMM='1.00'(상환수수료). FIRST_SETTLE_DT·TOT_PAY는 부재.
const etnFixtureHtml = `
<html><head><title>삼성 인버스 코스피 200 선물 ETN</title></head><body>
<script>
var status_data = {"CLS_PRC":"2,910","PRC_CHG":"10","ADJ_CHG":"0.34","YR_HIGH":"7,465","YR_LOW":"2,070","LIST_STK_CNT":"5,000","trD_QTY":"45,093","trD_AMT":"129","MKT_VAL":"146","YR_BETA":"-1.02","AVG_TRD_QTY20":"29,391","AVG_TRD_AMT20":"78","FRG_RT":"0.00","ERN1":"10.86","ERN3":"5.05","ERN6":"-22.04","ERN12":"-34.83"};
var stock_price_relative_chart_data = {"name":[{"CMP_CD":"530092","CMP_NM":"삼성 인버스 코스피 200 선물 ETN","MKT_NM":"KOSPI"}]};
var product_summary_data = {"BASE_IDX_NM_KOR":"코스피 200 선물 TWAP 인버스지수","FIRST_ISSUE_DT":"2021-10-14","LIST_DT":"2021-10-21","EXP_TRD_DT":"2031-09-15","EXPENSES":"0.50","REPAY_UNIT":"100000","REPAY_COMM":"1.00","DIV_BASE_DT":"해당사항 없음","LP_NM_KOR":"삼성증권","ISSUE_NM_KOR":"삼성증권","URL":"","DIV_NM_KOR":"지급(재투자)"};
var volume_chart_data = {"grid_data":[{"TRD_DT":"2026-10-14","AVG_TRD_QTY":450.0,"AVG_TRD_AMT":39563.0}]};
</script>
</body></html>`;

test('parseWiseReportEtfSnapshotHtml maps ETN product keys (동일 엔드포인트의 ETN 응답)', async () => {
  const { parseWiseReportEtfSnapshotHtml } = await import('../src/crawlers/wisereport-etf.js');

  const snapshot = parseWiseReportEtfSnapshotHtml(etnFixtureHtml, '530092');

  assert.equal(snapshot.code, '530092');
  assert.equal(snapshot.product.name, '삼성 인버스 코스피 200 선물 ETN');
  assert.equal(snapshot.product.marketName, 'KOSPI');
  assert.equal(snapshot.product.issuerName, '삼성증권');
  assert.equal(snapshot.product.baseIndexName, '코스피 200 선물 TWAP 인버스지수');
  // ETN 전용 매핑
  assert.equal(snapshot.product.expensePct, 0.5);
  assert.equal(snapshot.product.firstIssueDate, '2021-10-14');
  assert.equal(snapshot.product.expiryDate, '2031-09-15');
  assert.equal(snapshot.product.repayUnit, 100000);
  assert.equal(snapshot.product.repayCommissionPct, 1.0);
  // ETF 전용 키는 ETN 응답에 부재 — null(하위호환)
  assert.equal(snapshot.product.firstSettleDate, null);
  assert.equal(snapshot.product.totalFeePct, null);
  assert.equal(snapshot.product.fundType, null);
});

test('fetchWiseReportEtfSnapshot requests WiseReport ETF detail page and parses response', async () => {
  const { fetchWiseReportEtfSnapshot } = await import('../src/crawlers/wisereport-etf.js');
  const requested = [];

  const snapshot = await fetchWiseReportEtfSnapshot('226490', {
    timeoutMs: false,
    fetchImpl: async (url, init) => {
      requested.push({ url, init });
      return new Response(fixtureHtml, { status: 200, headers: { 'Content-Type': 'text/html' } });
    },
  });

  assert.equal(requested.length, 1);
  assert.match(String(requested[0].url), /ETF\/ETF\.aspx\?cmp_cd=226490/);
  assert.equal(requested[0].init.headers.Referer, 'https://comp.wisereport.co.kr/ETF/lookup.aspx');
  assert.equal(snapshot.product.baseIndexName, '코스피지수');
  assert.equal(snapshot.constituents.top10[0].name, '삼성전자');
});

// 바디 읽기 타임아웃 보호 — 헤더만 커버하는 구 withFetchTimeout 패턴이면 헤더
// 반환 후 타이머가 해제돼 text()가 영구 대기한다. 그 경우 이 테스트는 2초
// 타임아웃으로 실패해야 한다(구현 누락 감지용).
test('fetchWiseReportEtfSnapshot aborts body reads that exceed the deadline', { timeout: 2000 }, async () => {
  const { fetchWiseReportEtfSnapshot } = await import('../src/crawlers/wisereport-etf.js');

  // ok 응답을 반환하되 text()는 init.signal abort 시에만 거부하는 목업
  // (undici가 signal을 바디 스트림에 연결하는 동작 시뮬레이션).
  const fetchImpl = async (url, init) => ({
    ok: true,
    status: 200,
    text: () =>
      new Promise((_, reject) => {
        init.signal.addEventListener('abort', () =>
          reject(init.signal.reason ?? new DOMException('aborted', 'AbortError')),
        );
      }),
  });

  await assert.rejects(
    () => fetchWiseReportEtfSnapshot('226490', { timeoutMs: 30, fetchImpl }),
  );
});
