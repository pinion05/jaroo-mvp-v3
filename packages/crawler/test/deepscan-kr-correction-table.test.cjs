const test = require('node:test');
const assert = require('node:assert/strict');

const PARSER_MODULE = '../src/services/deepscan-kr-correction-table.js';
const EXTRACTOR_MODULE = '../src/services/deepscan-kr-disclosure-event-extractors.js';

const PREFIX = '3. 정정사항 | 19. 기타 투자판단에 참고할 사항 | 기재보완에 따른 정정';

const CASES = [
  // Direct operative changes.
  ['row-payment-date-change', `${PREFIX} | 납입일 | 정정 전 | 2025-12-29 | 정정 후 | 2026-01-15`, true],
  ['row-exchange-price-change', `${PREFIX} | 교환가액 | 정정 전 | 1,000원 | 정정 후 | 1,200원`, true],
  ['prefixed-exchange-price-change', `${PREFIX} | 정정 전 | 교환가액 1,000원 | 정정 후 | 교환가액 1,200원`, true],
  ['row-coupon-rate-change', `${PREFIX} | 표면이자율 | 정정 전 | 0% | 정정 후 | 2%`, true],
  ['numbered-row-payment-date-change', `${PREFIX} | 11) 납입일 | 정정 전 | 2025-12-29 | 정정 후 | 2026-01-15`, true],
  ['inline-payment-date-change', `${PREFIX} | 납입일을 2025-12-29에서 2026-01-15로 변경`, true],
  ['inline-exchange-price-change', `${PREFIX} | 교환가액을 1,000원에서 1,200원으로 조정`, true],
  ['inline-coupon-rate-change', `${PREFIX} | 표면이자율을 0%에서 2%로 변경`, true],
  ['inline-option-removal', `${PREFIX} | 조기상환 조건을 삭제`, true],
  ['inline-text-exchange-subject-change', `${PREFIX} | 교환대상을 보통주에서 우선주로 변경`, true],
  ['inline-text-issue-target-change', `${PREFIX} | 발행대상자를 A사에서 B사로 변경`, true],
  ['inline-text-funding-purpose-change', `${PREFIX} | 자금조달목적을 운영자금에서 시설자금으로 수정`, true],
  ['inline-text-issue-method-change', `${PREFIX} | 발행방법을 공모에서 사모로 조정`, true],
  ['inline-text-option-added', `${PREFIX} | 콜옵션 조건을 추가`, true],
  ['inline-text-condition-changed', `${PREFIX} | 교환조건을 변경함`, true],
  ['inline-scheduled-date-change', `${PREFIX} | 납입일을 2025-12-29(예정)에서 2026-01-15(예정)로 변경`, true],
  ['inline-scheduled-target-change', `${PREFIX} | 발행대상자를 A사(예정)에서 B사(예정)로 변경`, true],
  ['embedded-marker-date-change', `${PREFIX} | 납입일 정정 전 2025-12-29 정정 후 2026-01-15`, true],
  ['embedded-note-marker-price-change', `${PREFIX} | 교환가액 (주1) 정정 전 1,000원 (주1) 정정 후 1,200원`, true],

  // Layout variants observed in flattened OpenDART tables.
  ['auxiliary-column-before-markers', `${PREFIX} | 납입일 | 일자 | 정정 전 | 2025-12-29 | 정정 후 | 2026-01-15`, true],
  ['field-after-values', `${PREFIX} | 정정 전 | 2025-12-29 | 정정 후 | 2026-01-15 | 납입일`, true],
  ['header-first-date', '3. 정정사항 | 항목 | 정정사유 | 정정 전 | 정정 후 | 납입일 | 기재보완에 따른 정정 | 2025-12-29 | 2026-01-15 | 19. 기타 투자판단에 참고할 사항', true],
  ['header-first-money', '3. 정정사항 | 항목 | 정정사유 | 정정 전 | 정정 후 | 교환가액 | 기재보완에 따른 정정 | 1,000원 | 1,200원 | 19. 기타 투자판단에 참고할 사항', true],
  ['header-first-rate-without-reason', '3. 정정사항 | 항목 | 정정 전 | 정정 후 | 표면이자율 | 0% | 2% | 19. 기타 투자판단에 참고할 사항', true],
  ['header-first-text-with-trailing-column', '3. 정정사항 | 항목 | 정정사유 | 정정 전 | 정정 후 | 비고 | 교환대상 | 대상 변경 | A사 | B사 | 확인 | 19. 기타 투자판단에 참고할 사항', true],
  ['parenthesized-markers', `${PREFIX} | 납입일 | (정정 전) | 2025-12-29 | (정정 후) | 2026-01-15`, true],
  ['note-markers', `${PREFIX} | 교환가액 | (주1) 정정 전 | 1,000원 | (주1) 정정 후 | 1,200원`, true],
  ['suffix-note-markers', `${PREFIX} | 교환가액 | 정정 전(주1) | 1,000원 | 정정 후(주1) | 1,200원`, true],
  ['bracket-note-markers', `${PREFIX} | 교환가액 | [주1] 정정 전 | 1,000원 | [주1] 정정 후 | 1,200원`, true],
  ['suffix-bracket-note-markers', `${PREFIX} | 납입일 | 정정 전[주1] | 2025-12-29 | 정정 후[주1] | 2026-01-15`, true],
  ['bare-note-markers', `${PREFIX} | 납입일 | 주1) 정정 전 | 2025-12-29 | 주1) 정정 후 | 2026-01-15`, true],
  ['inline-marker-values', `${PREFIX} | 납입일 | 정정 전 2025-12-29 | 정정 후 2026-01-15`, true],
  ['long-auxiliary-before-marker', `${PREFIX} | 납입일 | 일자 | 일정 | 내용 | 내역 | 정정 전 | 2025-12-29 | 정정 후 | 2026-01-15`, true],
  ['long-auxiliary-before-field', `${PREFIX} | 정정 전 | 2025-12-29 | 정정 후 | 2026-01-15 | 일자 | 일정 | 내용 | 납입일`, true],
  ['unmarked-numbered-row', `${PREFIX} | 11) 납입일 | 일정 기재보완 | 2025-12-29 | 2026-01-15`, true],
  ['multirow-second-field-changed', `${PREFIX} | 교환가액 | 정정 전 | 1,000원 | 정정 후 | 1,000원 | 표면이자율 | 정정 전 | 0% | 정정 후 | 2%`, true],

  // Meaning-preserving value representations.
  ['equivalent-money', `${PREFIX} | 교환가액 | 정정 전 | 1,000 원 | 정정 후 | 1000원`, false],
  ['equivalent-rate', `${PREFIX} | 표면이자율 | 정정 전 | 2% | 정정 후 | 2.00%`, false],
  ['equivalent-date', `${PREFIX} | 납입일 | 정정 전 | 2025년 12월 29일 | 정정 후 | 2025-12-29`, false],
  ['equivalent-korean-money-unit', `${PREFIX} | 발행총액 | 정정 전 | 1억원 | 정정 후 | 100,000,000원`, false],
  ['equivalent-yield-rate', `${PREFIX} | 만기보장수익률 | 정정 전 | 연 3.0% | 정정 후 | 3%`, false],
  ['equivalent-redemption-date', `${PREFIX} | 상환기일 | 정정 전 | 2026.01.05. | 정정 후 | 2026-1-5`, false],
  ['compound-korean-money-change', `${PREFIX} | 발행총액 | 정정 전 | 1억2천만원 | 정정 후 | 1억3천만원`, true],
  ['annotated-date-change', `${PREFIX} | 납입일 | 정정 전 | 2025년 12월 29일(월) | 정정 후 | 2026년 1월 15일(목)`, true],
  ['scheduled-date-change', `${PREFIX} | 납입일 | 정정 전 | 2025-12-29(예정) | 정정 후 | 2026-01-15(예정)`, true],
  ['prefixed-money-change', `${PREFIX} | 교환가액 | 정정 전 | 금 1,000원 | 정정 후 | 금 1,200원`, true],
  ['annotated-money-change', `${PREFIX} | 교환가액 | 정정 전 | 1,000원(예정) | 정정 후 | 1,200원(예정)`, true],
  ['million-won-change', `${PREFIX} | 발행총액 | 정정 전 | 1,000백만원 | 정정 후 | 1,200백만원`, true],
  ['annual-rate-change', `${PREFIX} | 표면이자율 | 정정 전 | 연이율 1% | 정정 후 | 연이율 2%`, true],
  ['basis-point-change', `${PREFIX} | 표면이자율 | 정정 전 | 200bp | 정정 후 | 250bp`, true],
  ['percent-point-change', `${PREFIX} | 표면이자율 | 정정 전 | 1%p | 정정 후 | 2%p`, true],
  ['business-day-date-change', `${PREFIX} | 납입일 | 정정 전 | 2025-12-29(영업일) | 정정 후 | 2026-01-15(영업일)`, true],
  ['korean-word-money-change', `${PREFIX} | 발행총액 | 정정 전 | 일억오천만원 | 정정 후 | 이억원`, true],
  ['wide-header-unit-money', '3. 정정사항 | 항목 | 구분 | 단위 | 정정사유 | 비고 | 정정 전 | 정정 후 | 발행총액 | 금액 | 억원 | 금액조정 | 없음 | 10 | 12', true],
  ['header-content-columns-rate', '3. 정정사항 | 항목 | 단위 | 정정 전 내용 | 정정 후 내용 | 비고 | 표면이자율 | 연% | 1 | 2 | 없음', true],
  ['header-root-section', '3. 정정사항 | 구분 | 정정 전 | 정정 후 | 표면이자율 | 0% | 2%', true],
  ['header-unknown-trailing-column', '3. 정정사항 | 구분 | 정정 전 | 정정 후 | 관련공시 | 교환대상 | A사 | B사 | 없음', true],
  ['header-unknown-leading-column', '3. 정정사항 | 구분 | 관련공시 | 정정 전 | 정정 후 | 교환대상 | 없음 | A사 | B사', true],
  ['header-number-column', '3. 정정사항 | 번호 | 구분 | 정정 전 | 정정 후 | 1 | 교환대상 | A사 | B사', true],
  ['header-explicit-unit-equivalence', '3. 정정사항 | 항목 | 단위 | 정정 전 | 정정 후 | 발행총액 | 억원 | 1 | 100,000,000원', false],
  ['accounting-parentheses-money', `${PREFIX} | 발행가액 | 정정 전 | (1,000원) | 정정 후 | (2,000원)`, true],
  ['annotated-tax-money', `${PREFIX} | 발행가액 | 정정 전 | 1,000원(부가세포함) | 정정 후 | 2,000원(부가세포함)`, true],
  ['scheduled-exchange-period-row', `${PREFIX} | 교환청구기간 | 정정 전 | 2026-01-01부터 진행 예정 | 정정 후 | 2026-02-01부터 진행 예정`, true],

  // Description-only changes and explicit no-change evidence.
  ['price-risk-description-only', `${PREFIX} | 정정 전 | 교환가액 변경 가능성 설명 없음 | 정정 후 | 교환가액 변경 가능성에 대한 위험 설명 추가 | 실제 교환가액은 변경하지 않았습니다`, false],
  ['price-risk-table-unrelated', `${PREFIX} | 교환가액 변경 없음 | 위험요소 설명 | 정정 전 | 투자위험 낮음 | 정정 후 | 투자위험 높음`, false],
  ['rate-risk-table-unrelated', `${PREFIX} | 표면이자율은 변경하지 않음 | 투자위험 설명 | 정정 전 | 설명 없음 | 정정 후 | 금리 위험 설명 추가`, false],
  ['price-compared-risk-cells', `${PREFIX} | 정정 전 | 교환가액 관련 위험 설명 A | 정정 후 | 교환가액 관련 위험 설명 B | 실제 교환가액 변경 없음`, false],
  ['rate-compared-risk-cells', `${PREFIX} | 정정 전 | 표면이자율 관련 주의 문구 A | 정정 후 | 표면이자율 관련 주의 문구 B | 실제 표면이자율은 변경하지 않았습니다`, false],
  ['price-label-risk-row', `${PREFIX} | 교환가액 관련 위험 설명 | 정정 전 | 문구 A | 정정 후 | 문구 B`, false],
  ['rate-label-risk-row', `${PREFIX} | 표면이자율 관련 주의사항 문구 | 정정 전 | 문구 A | 정정 후 | 문구 B`, false],
  ['narrative-risk-phrase-deleted', `${PREFIX} | 교환가액 관련 위험 문구를 삭제했습니다`, false],
  ['option-deletion-possibility-reviewed', `${PREFIX} | 풋옵션 삭제 가능성 검토`, false],
  ['option-not-deleted', `${PREFIX} | 조기상환 조건을 삭제하지 않음`, false],
  ['option-withdrawal-reviewed', `${PREFIX} | 풋옵션 철회 여부를 검토`, false],
  ['option-not-deleted-emphatic', `${PREFIX} | 조기상환 조건을 삭제하지는 않음`, false],
  ['option-not-deleted-past', `${PREFIX} | 콜옵션은 삭제하지는 않았습니다`, false],
  ['maturity-no-extension-fact', `${PREFIX} | 만기일을 연장한 바 없음`, false],
  ['period-no-extension-fact', `${PREFIX} | 교환청구기간을 연장한 사실이 없음`, false],
  ['issue-target-replacement-planned', `${PREFIX} | 발행대상자 교체 계획`, false],
  ['maturity-extension-possibility', `${PREFIX} | 만기일 연장 가능성에 대한 설명`, false],
  ['unmarked-values-without-correction-evidence', `${PREFIX} | 상환일 | 2026-01-15 | 2026-06-15`, false],
  ['unmarked-rate-example', `${PREFIX} | 표면이자율 | 2% | 3% | 민감도 구간 예시`, false],
  ['unmarked-money-example', `${PREFIX} | 교환가액 | 1,000원 | 1,200원 | 비교 예시`, false],
  ['no-change-maintained', `${PREFIX} | 정정 전 | 교환가액 관련 설명 A | 정정 후 | 교환가액 관련 설명 B | 교환가액은 유지됩니다`, false],
  ['no-change-no-variation', `${PREFIX} | 정정 전 | 교환가액 관련 설명 A | 정정 후 | 교환가액 관련 설명 B | 교환가액은 변함이 없습니다`, false],
  ['no-change-no-items', `${PREFIX} | 정정 전 | 교환가액 관련 설명 A | 정정 후 | 교환가액 관련 설명 B | 교환가액 변경 사항 없음`, false],
  ['no-change-prior-level', `${PREFIX} | 정정 전 | 교환가액 관련 설명 A | 정정 후 | 교환가액 관련 설명 B | 교환가액은 종전 수준을 유지합니다`, false],
  ['no-change-current-rate', `${PREFIX} | 정정 전 | 표면이자율 관련 문구 A | 정정 후 | 표면이자율 관련 문구 B | 표면이자율은 현행대로 유지합니다`, false],
  ['no-change-redemption-terms', `${PREFIX} | 정정 전 | 조기상환 조건 설명 A | 정정 후 | 조기상환 조건 설명 B | 조기상환 조건에는 변함이 없습니다`, false],
  ['no-change-invariant-price', `${PREFIX} | 정정 전 | 교환가격 관련 설명 A | 정정 후 | 교환가격 관련 설명 B | 교환가격은 불변입니다`, false],

  // Canonical aliases bind no-change evidence, but distinct fields do not.
  ['alias-price-to-amount', `${PREFIX} | 정정 전 | 교환가격 관련 설명 A | 정정 후 | 교환가격 관련 설명 B | 실제 교환가액 변경 없음`, false],
  ['alias-amount-to-price', `${PREFIX} | 정정 전 | 교환가액 관련 설명 A | 정정 후 | 교환가액 관련 설명 B | 실제 교환가격 변경 없음`, false],
  ['alias-payment-date', `${PREFIX} | 정정 전 | 납입기일 관련 설명 A | 정정 후 | 납입기일 관련 설명 B | 실제 납입일 변경 없음`, false],
  ['alias-redemption-date', `${PREFIX} | 정정 전 | 상환기일 관련 설명 A | 정정 후 | 상환기일 관련 설명 B | 실제 상환일 변경 없음`, false],
  ['alias-coupon-rate', `${PREFIX} | 정정 전 | 이자율 관련 설명 A | 정정 후 | 이자율 관련 설명 B | 실제 표면이자율 변경 없음`, false],
  ['different-rate-field-no-change', `${PREFIX} | 표면이자율 | 정정 전 | 0% | 정정 후 | 2% | 만기이자율은 변경하지 않음`, true],
  ['nonoperative-investment-return', `${PREFIX} | 투자수익률을 5%에서 7%로 변경`, false],
  ['nonoperative-market-interest', `${PREFIX} | 시장 참고 이자율을 2%에서 3%로 변경`, false],
  ['nonoperative-internal-return', `${PREFIX} | 내부수익률을 5%에서 7%로 변경`, false],
  ['nonoperative-weighted-interest', `${PREFIX} | 가중평균이자율을 2%에서 3%로 변경`, false],
  ['official-registered-principal-label', `${PREFIX} | 사채의 권면전자등록총액 | 정정 전 | 10억원 | 정정 후 | 12억원`, true],
  ['official-issue-target-label', `${PREFIX} | 발행 대상 | 정정 전 | A사 | 정정 후 | B사`, true],

  // Contradictory evidence: direct typed values take precedence and remain auditable.
  ['contradictory-price-values', `${PREFIX} | 교환가액 | 정정 전 | 1,000원 | 정정 후 | 1,200원 | 교환가액 변경 없음`, true, true],
  ['other-field-no-change', `${PREFIX} | 납입일 | 정정 전 | 2025-12-29 | 정정 후 | 2026-01-15 | 교환가액은 변경하지 않음`, true],
  ['other-rate-no-change', `${PREFIX} | 교환가액 | 정정 전 | 1,000원 | 정정 후 | 1,200원 | 표면이자율은 변경하지 않음`, true],
  ['typed-values-beat-narrative', `${PREFIX} | 교환가액 | 정정 전 | 1,000원 | 정정 후 | 1,200원 | 교환가액 변경 가능성에 관한 설명만 보완했으며 실제 금액은 동일함`, true],
  ['tagged-marker-skips-untagged-after', `${PREFIX} | 교환가액 | (주1) 정정 전 | 1,000원 | 정정 후 | 위험 설명 | (주1) 정정 후 | 1,200원`, true],
  ['cross-field-marker-pair-rejected', `${PREFIX} | 교환가액 | 정정 전 | 1,000원 | 발행가액 | 정정 후 | 1,200원`, false],
  ['cross-rate-marker-pair-rejected', `${PREFIX} | 표면이자율 | 정정 전 | 1% | 만기이자율 | 정정 후 | 2%`, false],
  ['untagged-to-tagged-marker-rejected', `${PREFIX} | 교환가액 | 정정 전 | 1,000원 | (주2) 정정 후 | 1,200원`, false],
  ['unmarked-price-possibility-reason', `${PREFIX} | 교환가액 | 가격조정 가능성 | 1,000원 | 1,200원`, false],
  ['unmarked-date-review-reason', `${PREFIX} | 납입일 | 변경사유 검토중 | 2025-12-29 | 2026-01-15`, false],
  ['unmarked-date-planned-reason', `${PREFIX} | 납입일 | 일정기재 예정 | 2025-12-29 | 2026-01-15`, false],
  ['header-reason-does-not-leak', '3. 정정사항 | 항목 | 정정사유 | 정정 전 | 정정 후 | 교환가액 | 교환대상 교체 | 1,000원 | 1,000원', false],
];

test('typed correction parser classifies the adversarial matrix without lexical-gate leakage', async () => {
  const { analyzeExchangeableBondCorrection } = await import(PARSER_MODULE);

  for (const [id, scope, expectedOperative, expectedConflict = false] of CASES) {
    const analysis = analyzeExchangeableBondCorrection(scope);
    assert.equal(analysis.hasOperativeDelta, expectedOperative, id);
    assert.equal(analysis.hasConflict, expectedConflict, `${id}: conflict`);
  }
});

test('typed correction parser exposes normalized values, canonical aliases, and layout evidence', async () => {
  const { analyzeExchangeableBondCorrection } = await import(PARSER_MODULE);

  const date = analyzeExchangeableBondCorrection(`${PREFIX} | 납입기일 | 정정 전 | 2025년 12월 29일 | 정정 후 | 2026-01-15`);
  assert.deepEqual(
    date.candidates.map(({ canonicalField, valueKind, beforeValue, afterValue, classification }) => ({
      canonicalField,
      valueKind,
      before: beforeValue?.normalized,
      after: afterValue?.normalized,
      classification,
    })),
    [{
      canonicalField: 'paymentDate',
      valueKind: 'date',
      before: '2025-12-29',
      after: '2026-01-15',
      classification: 'operative',
    }],
  );

  const header = analyzeExchangeableBondCorrection(
    '3. 정정사항 | 항목 | 정정사유 | 정정 전 | 정정 후 | 교환가격 | 가격 조정 | 1,000원 | 1,200원',
  );
  assert.equal(header.candidates[0]?.canonicalField, 'exchangePrice');
  assert.equal(header.candidates[0]?.evidenceKind, 'header-first');
  assert.equal(header.candidates[0]?.beforeValue?.normalized, '1000');
  assert.equal(header.candidates[0]?.afterValue?.normalized, '1200');
});

test('gated disclosure lifecycle consumes typed correction analysis', async () => {
  const { extractEventsGatedProjection } = await import(EXTRACTOR_MODULE);

  for (const [id, bodyText, expectedOperative] of CASES) {
    const result = extractEventsGatedProjection({
      reportName: '[기재정정]주요사항보고서(교환사채권발행결정)',
      disclosureDetailType: 'B001',
      receiptDate: '20251224',
      bodyText,
    });
    assert.deepEqual(result.events, [{
      type: 'capital-change',
      action: expectedOperative ? 'updated' : 'decided',
      state: expectedOperative ? 'pending' : 'proposed',
      cause: 'exchangeable-bond',
      subjectType: 'securities',
    }], id);
  }
});

test('candidate evidence remains local to its row and preserves independent occurrences', async () => {
  const { analyzeExchangeableBondCorrection } = await import(PARSER_MODULE);

  const localConflict = analyzeExchangeableBondCorrection(
    `${PREFIX} | 교환가액 | 정정 전 | 1,000원 | 정정 후 | 1,200원 | 별도 정정행 | 교환가액 변경 없음`,
  );
  assert.equal(localConflict.hasOperativeDelta, true);
  assert.equal(localConflict.hasConflict, false);

  const duplicateOccurrences = analyzeExchangeableBondCorrection(
    `${PREFIX} | 납입일 | 정정 전 | 2025-12-29 | 정정 후 | 2026-01-15 | 별도 정정행 | 납입일 | 정정 전 | 2025-12-29 | 정정 후 | 2026-01-15`,
  );
  assert.equal(duplicateOccurrences.candidates.filter(({ canonicalField }) => canonicalField === 'paymentDate').length, 2);

  const separateNaturalBoundary = analyzeExchangeableBondCorrection(
    `${PREFIX} | 교환가액 | 정정 전 | 1,000원 | 정정 후 | 1,200원 | 별도 항목 | 교환가액 변경 없음`,
  );
  assert.equal(separateNaturalBoundary.hasConflict, false);

  const nextNaturalBoundary = analyzeExchangeableBondCorrection(
    `${PREFIX} | 교환가액 | 정정 전 | 1,000원 | 정정 후 | 1,200원 | 다음 항목 | 교환가액 변경 없음`,
  );
  assert.equal(nextNaturalBoundary.hasConflict, false);

  const longSameRowConflict = analyzeExchangeableBondCorrection(
    `${PREFIX} | 교환가액 | 정정 전 | 1,000원 | 정정 후 | 1,200원 | 정정사유 | 가격조정 | 비고 | 교환가액 변경 없음`,
  );
  assert.equal(longSameRowConflict.hasConflict, true);

  const embeddedOccurrences = analyzeExchangeableBondCorrection(
    `${PREFIX} | 납입일 정정 전 2025-12-29 정정 후 2026-01-15 납입일 정정 전 2025-12-29 정정 후 2026-01-15`,
  );
  assert.equal(embeddedOccurrences.candidates.filter(({ evidenceKind }) => evidenceKind === 'embedded-marker').length, 2);

  const punctuatedEmbeddedOccurrences = analyzeExchangeableBondCorrection(
    `${PREFIX} | 납입일 정정 전 2025-12-29 정정 후 2026-01-15, 납입일 정정 전 2026-01-15 정정 후 2026-01-15`,
  );
  assert.equal(punctuatedEmbeddedOccurrences.hasOperativeDelta, true);
  assert.equal(punctuatedEmbeddedOccurrences.candidates.filter(({ evidenceKind }) => evidenceKind === 'embedded-marker').length, 2);

  const overlappingEvidence = analyzeExchangeableBondCorrection(
    '3. 정정사항 | 항목 | 정정 전 | 정정 후 | 비고 | 납입일 | 2025-12-29 | 2025-12-29 | | 납입일 정정 전 2025-12-29 정정 후 2026-01-15',
  );
  assert.equal(overlappingEvidence.hasOperativeDelta, true);
});
