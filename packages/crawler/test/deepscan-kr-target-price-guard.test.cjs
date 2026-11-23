const test = require('node:test');
const assert = require('node:assert/strict');

// 컨센서스 목표가 상식 범위 가드 계약(TC-e2e-deepscan §9 관측 3 — 목표가 이상치).
//
// 조사 결과(2026-11-06 실측): 삼성전자 472,381원 등 E2E 관측값은 네이버 컨센서스
// API의 실제 응답(targetPrice "472381.0", 당시 시세 약 2.34배)이며 중계 코드의
// 오버플로·단위 혼동이 아니다. 다만 가드가 전혀 없어 외부 데이터 오염(100배급
// 이상치)이 전략 목표가 텍스트로 그대로 흘러들어갈 수 있어 TC-blackbox-data
// TC-BBD-017 상식 범위(현재가의 0.1~20배, 절대 1천~1억원)로 차단한다.

function slimSources(targetPrice, quotePrice) {
  return {
    slim: {
      code: '005930',
      company: { code: '005930', name: '삼성전자' },
      pages: {
        opinion: {
          rows: [{ 추정기관: 'consensus', 목표주가: targetPrice, '투자의견(점수)': 4 }],
        },
      },
    },
    quotes: quotePrice === null
      ? { items: [], missing: [], asOf: { kr: null, us: null }, providerStatus: {} }
      : {
          items: [{
            market: 'KR', code: '005930', price: quotePrice, currency: 'KRW',
            volume: 1, asOf: '2026-11-05', source: 'krx', status: 'ok',
          }],
          missing: [],
          asOf: { kr: '2026-11-05', us: null },
          providerStatus: {},
        },
    packageResult: {
      stockCode: '005930',
      listingMarket: 'KOSPI',
      timestamp: '2026-11-05T12:00:00.000Z',
      reportContent: 'ok',
    },
  };
}

test('정상 목표가(현재가의 0.1~20배)는 그대로 반영된다 — 실측 이상치 후보 4종목 포함', async () => {
  const { buildDeepScanKrEvidencePacket } = await import('../src/services/deepscan-kr-evidence.js');

  // E2E 실측 4종목 계열: 삼성전자 472,381 vs 현재가 201,500(2.34배) 등 1.3~2.4배는
  // 외부 컨센서스의 실제 값이므로 가드를 통과해야 한다(조사 결론 고정).
  for (const [target, price] of [[472381, 201500], [219722, 157000], [287059, 215000], [368143, 246000]]) {
    const packet = buildDeepScanKrEvidencePacket(
      { instrument: { code: '005930', name: '삼성전자' } },
      slimSources(target, price),
    );
    assert.equal(packet.consensusSnapshot.targetPrice, target, `target=${target} price=${price}`);
    assert.equal(packet.consensusSnapshot.targetPriceStatus, 'present');
  }

  // 저가 목표가도 0.1배 이상이면 통과
  const low = buildDeepScanKrEvidencePacket(
    { instrument: { code: '005930', name: '삼성전자' } },
    slimSources(30000, 200000),
  );
  assert.equal(low.consensusSnapshot.targetPrice, 30000);
});

test('현재가 대비 20배 초과 목표가(외부 데이터 오염)는 거부된다', async () => {
  const { buildDeepScanKrEvidencePacket } = await import('../src/services/deepscan-kr-evidence.js');

  const packet = buildDeepScanKrEvidencePacket(
    { instrument: { code: '005930', name: '삼성전자' } },
    slimSources(4723810, 20150), // 234배 — 단위 혼동/오염 시그니처
  );
  assert.equal(packet.consensusSnapshot.targetPrice, null);
  assert.equal(packet.consensusSnapshot.targetPriceStatus, 'not_provided');
  assert.equal(packet.consensusSnapshot.targetGapPct, null);
  // 투자의견 점수는 목표가와 독립적으로 보존된다
  assert.equal(packet.consensusSnapshot.recommendationScore, 4);
});

test('현재가 대비 0.1배 미만 목표가도 거부된다', async () => {
  const { buildDeepScanKrEvidencePacket } = await import('../src/services/deepscan-kr-evidence.js');
  const packet = buildDeepScanKrEvidencePacket(
    { instrument: { code: '005930', name: '삼성전자' } },
    slimSources(900, 201500), // 0.0045배
  );
  assert.equal(packet.consensusSnapshot.targetPrice, null);
});

test('현재가를 모르면 절대 상식 범위(1천~1억원)만 적용한다', async () => {
  const { buildDeepScanKrEvidencePacket } = await import('../src/services/deepscan-kr-evidence.js');

  // E2E 실측 환경(KRX 키 미설정로 현재가 수집 실패) 재현: 정상 범위 값은 통과
  const sane = buildDeepScanKrEvidencePacket(
    { instrument: { code: '005930', name: '삼성전자' } },
    slimSources(472381, null),
  );
  assert.equal(sane.consensusSnapshot.targetPrice, 472381);

  // 절대 하한 미달(500원)·상한 초과(3억원)는 거부
  const tooSmall = buildDeepScanKrEvidencePacket(
    { instrument: { code: '005930', name: '삼성전자' } },
    slimSources(500, null),
  );
  assert.equal(tooSmall.consensusSnapshot.targetPrice, null);
  const tooLarge = buildDeepScanKrEvidencePacket(
    { instrument: { code: '005930', name: '삼성전자' } },
    slimSources(300000000, null),
  );
  assert.equal(tooLarge.consensusSnapshot.targetPrice, null);
});
