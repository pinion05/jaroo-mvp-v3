const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtemp, readFile, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const MODULE = '../src/services/deepscan-kr-disclosure-event-extractors.js';
const FIXTURE = join(__dirname, 'fixtures', 'kr-disclosure-event-benchmark.v1.json');
const BODY_REVIEWED_FIXTURE = join(__dirname, 'fixtures', 'kr-disclosure-event-body-reviewed.v1.json');
const SEMANTIC_GATE_FIXTURE = join(__dirname, 'fixtures', 'kr-disclosure-event-semantic-gate.v1.json');
const BENCHMARK = join(__dirname, '..', 'scripts', 'benchmark-dart-disclosure-event-extractors.mjs');
const RESEARCH_BENCHMARK = join(__dirname, '..', 'scripts', 'benchmark-dart-disclosure-event-research.mjs');
const SEMANTIC_GATE_BENCHMARK = join(__dirname, '..', 'scripts', 'benchmark-dart-disclosure-semantic-gate.mjs');

function normalizeEvent(event = {}) {
  return {
    type: event.type ?? 'other',
    action: event.action ?? null,
    state: event.state ?? null,
    cause: event.cause ?? null,
    subjectType: event.subjectType ?? null,
  };
}

function eventSet(events) {
  return events.map(normalizeEvent).map(JSON.stringify).sort();
}

function canonicalEvent(type, action, state, cause, subjectType) {
  return { type, action, state, cause, subjectType };
}

const ITERATION_7_SYNTHETIC_CASES = [
  // F1: final price/terms must be current and field-scoped.
  {
    id: 'i7-f1-positive-final-offering-price', family: 'F1', kind: 'positive',
    input: { reportName: '[기재정정]투자설명서', disclosureDetailType: 'C001', bodyText: '정정사유 | 공모가액 확정에 따른 정정 | 정정 전 | 예정 모집가액 | 정정 후 | 확정 모집가액' },
    expectedEvents: [canonicalEvent('capital-change', 'price-set', 'effective', 'equity-securities', 'securities')],
  },
  {
    id: 'i7-f1-positive-fund-first-price', family: 'F1', kind: 'positive',
    input: { reportName: '[기재정정]증권신고서(집합투자증권-회사형)', disclosureDetailType: 'G002', bodyText: '정정사항 | 정정사유 | 1차 발행가액 결정 | 정정 전 | 예정 모집가액 | 정정 후 | 모집가액' },
    expectedEvents: [canonicalEvent('capital-change', 'price-set', 'effective', 'fund-securities', 'securities')],
  },
  {
    id: 'i7-f1-positive-warrant-exercise-price', family: 'F1', kind: 'positive',
    input: { reportName: '[기재정정]주요사항보고서(신주인수권부사채권발행결정)', disclosureDetailType: 'B001', bodyText: '정정사항 | 정정사유 | 행사가액 확정에 따른 정정 | 정정 전 | 확정 예정 | 정정 후 | 신주인수권의 행사가액은 확정되었습니다' },
    expectedEvents: [canonicalEvent('capital-change', 'price-set', 'effective', 'bond-with-warrants', 'securities')],
  },
  {
    id: 'i7-f1-control-provisional-price', family: 'F1', kind: 'control',
    input: { reportName: '[기재정정]투자설명서', disclosureDetailType: 'C001', bodyText: '정정사항 | 설명 보완 | 모집가액은 예정이며 수요예측 후 향후 확정될 예정' },
    expectedEvents: [canonicalEvent('capital-change', 'updated', 'effective', 'equity-securities', 'securities')],
  },
  {
    id: 'i7-f1-control-risk-price-language', family: 'F1', kind: 'control',
    input: { reportName: '[기재정정]투자설명서', disclosureDetailType: 'C001', bodyText: '정정사항 | 위험요소 설명 보완 | 시장 상황에 따라 모집가격이 변동될 위험이 있습니다' },
    expectedEvents: [canonicalEvent('capital-change', 'updated', 'effective', 'equity-securities', 'securities')],
  },
  {
    id: 'i7-f1-control-historical-price-row', family: 'F1', kind: 'control',
    input: { reportName: '투자설명서', disclosureDetailType: 'C001', bodyText: '과거 발행 내역 | 발행가액 확정 | 현재 모집 증권 | 지분증권 | 이번 가격은 예정' },
    expectedEvents: [canonicalEvent('capital-change', 'published', null, 'equity-securities', 'securities')],
  },

  // F2: terminal predicates are actor/object specific and cannot be inferred from end dates.
  {
    id: 'i7-f2-positive-asset-disposal-cancelled', family: 'F2', kind: 'positive',
    input: { reportName: '[기재정정]유형자산처분결정', disclosureDetailType: 'I001', bodyText: '정정사항 | 정정사유 | 거래상대방과 부동산 처분계약 합의 해제 | 정정 후 | 처분 관련 전 항목 삭제' },
    expectedEvents: [canonicalEvent('asset-transaction', 'cancelled', 'effective', 'tangible-asset-disposal', 'real-estate')],
  },
  {
    id: 'i7-f2-positive-financing-repaid', family: 'F2', kind: 'positive',
    input: { reportName: '[기재정정]부동산투자회사자금차입', disclosureDetailType: 'I001', bodyText: '정정사항 | 정정사유 | 차입금 전액 조기 상환 완료 | 정정 후 | 차입잔액 없음' },
    expectedEvents: [canonicalEvent('material-contract', 'repaid', 'effective', 'financing', 'contract')],
  },
  {
    id: 'i7-f2-positive-guarantee-terminated', family: 'F2', kind: 'positive',
    input: { reportName: '[기재정정]타인에대한채무보증결정', disclosureDetailType: 'I001', bodyText: '정정사항 | 정정사유 | 채무자의 원리금 전액 상환으로 채무보증 종료 | 보증잔액 | 없음' },
    expectedEvents: [canonicalEvent('material-contract', 'terminated', 'effective', 'debt-guarantee', 'contract')],
  },
  {
    id: 'i7-f2-positive-product-approval-withdrawn', family: 'F2', kind: 'positive',
    input: { reportName: '투자판단관련주요경영사항', disclosureDetailType: 'I001', bodyText: '품목허가 신청 | 회사는 심사 중인 품목허가 신청을 자진 취하하였습니다 | 취하 접수 완료' },
    expectedEvents: [canonicalEvent('regulatory-product', 'withdrawn', 'cancelled', 'product-approval', 'product')],
  },
  {
    id: 'i7-f2-positive-fund-investment-withdrawn', family: 'F2', kind: 'positive',
    input: { reportName: '[기재정정]특수관계인과의수익증권거래', disclosureDetailType: 'J001', bodyText: '정정사항 | 위탁운용사 미선정으로 출자를 철회하고 내부거래를 취소함 | 거래금액 | 없음' },
    expectedEvents: [canonicalEvent('related-party', 'withdrawn', 'cancelled', 'fund-security-investment', 'securities')],
  },
  {
    id: 'i7-f2-control-future-loan-maturity', family: 'F2', kind: 'control',
    input: { reportName: '부동산투자회사자금차입', disclosureDetailType: 'I001', filedAt: '2027-01-10', bodyText: '차입일 | 2027-01-10 | 만기일 | 2029-01-10 | 차입 실행 완료' },
    expectedEvents: [canonicalEvent('material-contract', 'borrowed', 'effective', 'financing', 'contract')],
  },
  {
    id: 'i7-f2-control-repayment-plan', family: 'F2', kind: 'control',
    input: { reportName: '[기재정정]부동산투자회사자금차입', disclosureDetailType: 'I001', bodyText: '정정사항 | 상환계획 기재 | 차입금은 향후 일시 상환 예정이며 아직 상환되지 않음' },
    expectedEvents: [canonicalEvent('material-contract', 'updated', 'effective', 'financing', 'contract')],
  },
  {
    id: 'i7-f2-control-contract-end-date', family: 'F2', kind: 'control',
    input: { reportName: '단일판매ㆍ공급계약체결', filedAt: '2027-02-03', bodyText: '계약(수주)일자 | 2027-02-03 | 계약기간 시작일 | 2027-02-03 | 종료일 | 2030-12-31' },
    expectedEvents: [canonicalEvent('material-contract', 'contracted', 'effective', 'supply-contract', 'contract')],
  },
  {
    id: 'i7-f2-control-risk-cancellation', family: 'F2', kind: 'control',
    input: { reportName: '유형자산취득결정', filedAt: '2027-02-03', bodyText: '취득대상 | 토지 | 취득 예정일 | 2027-08-01 | 위험요소 | 인허가 실패 시 계약이 취소될 가능성이 있음' },
    expectedEvents: [canonicalEvent('asset-transaction', 'decided', 'proposed', 'tangible-asset-acquisition', 'real-estate')],
  },
  {
    id: 'i7-f2-control-historical-cancelled-row', family: 'F2', kind: 'control',
    input: { reportName: '유형자산처분결정', filedAt: '2027-02-03', bodyText: '처분대상 | 토지 | 현재 처분 예정일 | 2027-08-01 | 과거 거래내역 | 전년도 계약 취소 완료' },
    expectedEvents: [canonicalEvent('asset-transaction', 'decided', 'proposed', 'tangible-asset-disposal', 'real-estate')],
  },

  // F3: actuality needs a same-intent completion predicate, not a nearby date.
  {
    id: 'i7-f3-positive-equity-closing', family: 'F3', kind: 'positive',
    input: { reportName: '[기재정정]타법인주식및출자증권양수결정', disclosureDetailType: 'B001', bodyText: '정정사항 | 거래종결 확인 | 잔금 전액 지급 완료 | 주식 소유권 이전 완료' },
    expectedEvents: [canonicalEvent('restructuring', 'acquired', 'effective', 'equity-acquisition', 'securities')],
  },
  {
    id: 'i7-f3-positive-property-acquired', family: 'F3', kind: 'positive',
    input: { reportName: '[기재정정]부동산투자회사부동산취득', disclosureDetailType: 'I001', bodyText: '정정사항 | 잔금 지급 완료 | 매매대금 전액 지급으로 부동산 취득이 종결되었습니다' },
    expectedEvents: [canonicalEvent('asset-transaction', 'acquired', 'effective', 'tangible-asset-acquisition', 'real-estate')],
  },
  {
    id: 'i7-f3-positive-rights-offering-completed', family: 'F3', kind: 'positive',
    input: { reportName: '기타경영사항(자율공시)', disclosureDetailType: 'I001', bodyText: '자회사 유상증자 | 납입금 전액 수령 | 신주 발행 및 증자가 완료되었습니다' },
    expectedEvents: [canonicalEvent('capital-change', 'completed', 'effective', 'rights-offering', 'securities')],
  },
  {
    id: 'i7-f3-positive-after-the-fact-service-report', family: 'F3', kind: 'positive',
    input: { reportName: '동일인등출자계열회사와의상품ㆍ용역거래', disclosureDetailType: 'J001', filedAt: '2027-04-01', bodyText: '거래기간 | 2026년 4분기 | 이사회 의결일이 아닌 거래실적 사후 보고일 | 상품ㆍ용역 거래 실적' },
    expectedEvents: [canonicalEvent('related-party', 'reported', 'effective', 'internal-goods-services', 'contract')],
  },
  {
    id: 'i7-f3-control-same-day-decision', family: 'F3', kind: 'control',
    input: { reportName: '타법인주식및출자증권양수결정', disclosureDetailType: 'I001', filedAt: '2027-04-01', bodyText: '이사회 결의일 | 2027-04-01 | 계약체결일 | 2027-04-01 | 잔금 지급과 소유권 이전은 추후 진행' },
    expectedEvents: [canonicalEvent('restructuring', 'decided', 'proposed', 'equity-acquisition', 'securities')],
  },
  {
    id: 'i7-f3-control-partial-payment-future-closing', family: 'F3', kind: 'control',
    input: { reportName: '[기재정정]부동산투자회사부동산취득', filedAt: '2027-04-01', bodyText: '정정사항 | 계약금 일부 지급 | 정정 후 잔금일 | 2027-05-15 | 잔금 납입 후 취득 종결 예정' },
    expectedEvents: [canonicalEvent('asset-transaction', 'rescheduled', 'pending', 'tangible-asset-acquisition', 'real-estate')],
  },
  {
    id: 'i7-f3-control-current-contract-future-maturity', family: 'F3', kind: 'control',
    input: { reportName: '단일판매ㆍ공급계약체결', filedAt: '2027-04-01', bodyText: '계약(수주)일자 | 2027-04-01 | 계약기간 시작일 | 2027-04-01 | 계약기간 종료일 | 2029-04-01' },
    expectedEvents: [canonicalEvent('material-contract', 'contracted', 'effective', 'supply-contract', 'contract')],
  },
  {
    id: 'i7-f3-control-risk-historical-completion', family: 'F3', kind: 'control',
    input: { reportName: '타법인주식및출자증권취득결정', filedAt: '2027-04-01', bodyText: '취득예정일 | 2027-06-30 | 투자위험 | 과거 유사 거래는 잔금 지급 후 완료되었음' },
    expectedEvents: [canonicalEvent('restructuring', 'decided', 'proposed', 'equity-acquisition', 'securities')],
  },

  // F4: current before/after deltas select lifecycle without confusing maturity with termination.
  {
    id: 'i7-f4-positive-loan-extension', family: 'F4', kind: 'positive',
    input: { reportName: '[기재정정]금전대여결정', filedAt: '2027-05-01', bodyText: '정정사항 | 대여기간 종료일 변경 | 정정 전 | 2028-05-01 | 정정 후 | 2029-05-01 | 기존 대여는 실행 중' },
    expectedEvents: [canonicalEvent('material-contract', 'extended', 'effective', 'loan', 'contract')],
  },
  {
    id: 'i7-f4-positive-partial-sale-rescheduled', family: 'F4', kind: 'positive',
    input: { reportName: '[기재정정]자기전환사채매도결정', filedAt: '2027-05-01', bodyText: '정정사항 | 잔금일 변경 | 일부 대금 수령 | 정정 후 잔금일 | 2027-06-15 | 잔금 지급 후 매도 완료 예정' },
    expectedEvents: [canonicalEvent('capital-change', 'rescheduled', 'pending', 'convertible-bond', 'securities')],
    expectedConfidence: 'high',
  },
  {
    id: 'i7-f4-positive-court-deferred-suspension', family: 'F4', kind: 'positive',
    input: { reportName: '[기재정정]주요사항보고서(영업정지)', disclosureDetailType: 'B001', bodyText: '정정사항 | 법원이 행정처분 집행정지를 인용하여 영업정지 효력이 판결 시까지 유예됨' },
    expectedEvents: [canonicalEvent('operating-status', 'halted', 'deferred', 'business-suspension', 'business')],
  },
  {
    id: 'i7-f4-positive-buyer-change-pending-closing', family: 'F4', kind: 'positive',
    input: { reportName: '[기재정정]타법인주식및출자증권처분결정', filedAt: '2027-05-01', bodyText: '정정사항 | 매수인 지위 및 권리의무 이전 | 거래종결은 관계기관 승인 이후 진행 예정 | 아직 지분 이전 전' },
    expectedEvents: [canonicalEvent('restructuring', 'updated', 'pending', 'equity-disposal', 'securities')],
    expectedConfidence: 'high',
  },
  {
    id: 'i7-f4-control-simple-typo', family: 'F4', kind: 'control',
    input: { reportName: '[기재정정]감사보고서', disclosureDetailType: 'F001', bodyText: '정정사항 | 단순 기재오류 수정 | 감사보고서 재발행' },
    expectedEvents: [canonicalEvent('audit', 'updated', 'effective', 'audit-report', 'audit-opinion')],
  },
  {
    id: 'i7-f4-control-description-update', family: 'F4', kind: 'control',
    input: { reportName: '[기재정정]대규모기업집단현황공시', disclosureDetailType: 'I001', bodyText: '정정사항 | 설명 문구 보완 | 거래 일정 변경 없음' },
    expectedEvents: [canonicalEvent('governance', 'updated', 'effective', 'business-group-status', 'governance')],
  },
  {
    id: 'i7-f4-control-risk-delay', family: 'F4', kind: 'control',
    input: { reportName: '[기재정정]주요사항보고서(자산양수결정)', bodyText: '정정사항 | 위험요소 문구 보완 | 인허가 상황에 따라 거래가 지연될 가능성이 있음' },
    expectedEvents: [canonicalEvent('restructuring', 'updated', 'effective', 'asset-acquisition', 'asset')],
  },
  {
    id: 'i7-f4-control-business-suspension-date-only', family: 'F4', kind: 'control',
    input: { reportName: '[기재정정]주요사항보고서(영업정지)', bodyText: '정정 신고 | 정정사항 | 영업정지일자 변경 | 정정 전 | 2027-05-01 | 정정 후 | 2027-06-01' },
    expectedEvents: [canonicalEvent('operating-status', 'halted', 'proposed', 'business-suspension', 'business')],
  },

  // F5: temporal roles keep current contracts effective and future execution proposed/pending.
  {
    id: 'i7-f5-positive-future-bond-sale', family: 'F5', kind: 'positive',
    input: { reportName: '특수관계인에대한채권매도', disclosureDetailType: 'J001', filedAt: '2027-06-01', bodyText: '매도일 | 2027-07-01 | 채권 발행 및 매도는 수요예측 후 진행 예정 | 아직 인수 전' },
    expectedEvents: [canonicalEvent('related-party', 'decided', 'proposed', 'bond-sale', 'securities')],
  },
  {
    id: 'i7-f5-positive-existing-loan-extended-future', family: 'F5', kind: 'positive',
    input: { reportName: '금전대여결정', filedAt: '2027-06-01', bodyText: '거래상대방 관계 | 계열회사 | 기존 금전대여 기간 연장 | 변경계약 시작일 | 2027-06-02 | 연장된 대여기간 | 2027-06-02부터' },
    expectedEvents: [canonicalEvent('related-party', 'extended', 'pending', 'related-party-loan', 'contract')],
  },
  {
    id: 'i7-f5-positive-collateral-receipt-future', family: 'F5', kind: 'positive',
    input: { reportName: '특수관계인으로부터받은담보', disclosureDetailType: 'J001', filedAt: '2027-06-01', bodyText: '담보물 | 토지 및 건물 | 담보받은 일자 | 2027-07-01 | 신탁계약 체결 시 우선수익권을 제공받을 예정' },
    expectedEvents: [canonicalEvent('related-party', 'decided', 'proposed', 'collateral-received', 'real-estate')],
  },
  {
    id: 'i7-f5-control-future-lockup-release', family: 'F5', kind: 'control',
    input: { reportName: '기타안내사항(안내공시)', filedAt: '2027-06-01', bodyText: '| 1. 제목 | | 보통주 의무보유 기간 만료 안내 | | 의무보유 해제일 | 2027-06-30 | 해제 예정 |' },
    expectedEvents: [canonicalEvent('capital-change', 'scheduled', 'pending', 'lockup', 'securities')],
  },
  {
    id: 'i7-f5-control-active-contract-future-end', family: 'F5', kind: 'control',
    input: { reportName: '단일판매ㆍ공급계약체결', filedAt: '2027-06-01', bodyText: '계약(수주)일자 | 2027-06-01 | 계약기간 시작일 | 2027-06-01 | 계약기간 종료일 | 2030-06-01' },
    expectedEvents: [canonicalEvent('material-contract', 'contracted', 'effective', 'supply-contract', 'contract')],
  },
  {
    id: 'i7-f5-control-collateral-received-current', family: 'F5', kind: 'control',
    input: { reportName: '특수관계인으로부터받은담보', disclosureDetailType: 'J001', filedAt: '2027-06-01', bodyText: '담보자산은 계열회사의 주식이며 담보 수령일 | 2027-06-01 | 담보 수령 완료' },
    expectedEvents: [canonicalEvent('related-party', 'received', 'effective', 'collateral-received', 'securities')],
  },

  // F6: the body router is limited to unresolved/incomplete tuples with structured anchors.
  {
    id: 'i7-f6-positive-payment-default', family: 'F6', kind: 'positive',
    input: { reportName: '주요사항보고서(부도발생)', disclosureDetailType: 'B001', bodyText: '부도발생 | 만기어음 | 지급제한으로 결제되지 않아 부도 처리됨 | 부도발생일 | 제출일' },
    expectedEvents: [canonicalEvent('insolvency', 'defaulted', 'effective', 'payment-default', 'issuer')],
  },
  {
    id: 'i7-f6-positive-patent-acquired', family: 'F6', kind: 'positive',
    input: { reportName: '[기재정정]투자판단관련주요경영사항(특허권취득)', disclosureDetailType: 'I001', bodyText: '정정사항 | 해외 특허 등록료 납부 완료 | 납부 확인 시 특허권 법적 효력 발생' },
    expectedEvents: [canonicalEvent('asset-transaction', 'acquired', 'effective', 'patent', 'intellectual-property')],
  },
  {
    id: 'i7-f6-positive-contractor-selected', family: 'F6', kind: 'positive',
    input: { reportName: '투자판단관련주요경영사항', disclosureDetailType: 'I001', bodyText: '공시 제목 | 정비사업 시공자 선정 | 회사가 우선협상대상자로 선정되었음을 통지받음 | 본계약은 추후 체결' },
    expectedEvents: [canonicalEvent('material-contract', 'selected', 'effective', 'construction-project', 'contract')],
  },
  {
    id: 'i7-f6-positive-regulatory-fine', family: 'F6', kind: 'positive',
    input: { reportName: '벌금등의부과(자회사의주요경영사항)', disclosureDetailType: 'I001', bodyText: '부과기관 | 감독기관 | 처분내용 | 과징금 부과 | 통지서 수령 완료 | 납부기한은 추후' },
    expectedEvents: [canonicalEvent('legal-regulatory', 'imposed', 'effective', 'regulatory-fine', 'issuer')],
  },
  {
    id: 'i7-f6-control-promotional-construction', family: 'F6', kind: 'control',
    input: { reportName: '기타경영사항(자율공시)', disclosureDetailType: 'I001', bodyText: '당사는 다양한 건설 프로젝트에서 우수한 시공 역량을 보유하고 있습니다' },
    expectedEvents: [canonicalEvent('other', null, null, null, null)],
  },
  {
    id: 'i7-f6-control-specific-prior-preserved', family: 'F6', kind: 'control',
    input: { reportName: '단일판매ㆍ공급계약체결', filedAt: '2027-07-01', bodyText: '계약(수주)일자 | 2027-07-01 | 계약기간 시작일 | 2027-07-01 | 위험요소 | 규제 과징금이 부과될 가능성' },
    expectedEvents: [canonicalEvent('material-contract', 'contracted', 'effective', 'supply-contract', 'contract')],
  },

  // F7: structured objects refine cause/subject without rewriting action/state.
  {
    id: 'i7-f7-positive-demerger-object', family: 'F7', kind: 'positive',
    input: { reportName: '투자설명서', disclosureDetailType: 'C004', bodyText: '분할회사 | 분할존속회사 | 분할신설회사 | 분할승인 주주총회 예정 | 분할기일 예정' },
    expectedEvents: [canonicalEvent('restructuring', 'decided', 'proposed', 'demerger', 'issuer')],
  },
  {
    id: 'i7-f7-positive-aircraft-lease', family: 'F7', kind: 'positive',
    input: { reportName: '특수관계인과의리스거래', disclosureDetailType: 'J001', filedAt: '2027-08-01', bodyText: '리스회사 | 계열회사 | 리스계약일 | 2027-09-01 | 리스시행일 | 2027-09-15 | 리스물건 | 항공기 1대 | 신규 전대차' },
    expectedEvents: [canonicalEvent('related-party', 'decided', 'proposed', 'aircraft-lease', 'asset')],
  },
  {
    id: 'i7-f7-positive-exchangeable-bond-result', family: 'F7', kind: 'positive',
    input: { reportName: '유상증자또는주식관련사채등의발행결과(자율공시)', disclosureDetailType: 'I001', bodyText: '증권의 종류 | 무보증 사모 교환사채 | 발행방법 | 교환사채 발행 | 실제발행금액 | 납입 완료' },
    expectedEvents: [canonicalEvent('capital-change', 'completed', 'effective', 'exchangeable-bond', 'securities')],
  },
  {
    id: 'i7-f7-control-specific-share-exchange', family: 'F7', kind: 'control',
    input: { reportName: '투자설명서', disclosureDetailType: 'C004', bodyText: '지분증권 투자설명서 | 주식의 포괄적 교환 및 이전 결정' },
    expectedEvents: [canonicalEvent('restructuring', 'decided', 'proposed', 'share-exchange', 'issuer')],
  },
  {
    id: 'i7-f7-control-generic-contract-right', family: 'F7', kind: 'control',
    input: { reportName: '특수관계인과의계약권리의무승계', disclosureDetailType: 'J001', bodyText: '계약상 권리와 의무를 승계함' },
    expectedEvents: [canonicalEvent('related-party', 'updated', 'effective', 'related-party-contract-right-updated', 'contract-right')],
  },

  // F8: enumerate sibling intents before transforms and deduplicate only exact tuples.
  {
    id: 'i7-f8-positive-cash-and-securities-donation', family: 'F8', kind: 'positive',
    input: { reportName: '[기재정정]특수관계인에대한증여', disclosureDetailType: 'J001', bodyText: '정정사항 | 출연 완료에 따른 확정 공시 | 증여목적물 1 | 현금 출연 | 증여목적물 2 | 보통주 출연 | 증여 이행 완료' },
    expectedEvents: [
      canonicalEvent('related-party', 'donated', 'effective', 'cash-donation', 'cash'),
      canonicalEvent('related-party', 'donated', 'effective', 'securities-donation', 'securities'),
    ],
  },
  {
    id: 'i7-f8-positive-three-plan-withdrawals', family: 'F8', kind: 'positive',
    input: { reportName: '[기재정정]수시공시의무관련사항(공정공시)', disclosureDetailType: 'I002', bodyText: '정정사유 | 자기주식 활용계획 전면 철회 | 계획 1 자기주식 소각 | 계획 2 교환사채 발행 | 계획 3 사내근로복지기금 주식 출연 | 세 계획을 모두 철회하기로 결정' },
    expectedEvents: [
      canonicalEvent('corporate-action', 'withdrawn', 'effective', 'share-cancellation', 'securities'),
      canonicalEvent('capital-change', 'withdrawn', 'effective', 'exchangeable-bond', 'securities'),
      canonicalEvent('related-party', 'withdrawn', 'effective', 'employee-welfare-fund-contribution', 'securities'),
    ],
  },
  {
    id: 'i7-f8-control-identical-donation-deduped', family: 'F8', kind: 'control',
    input: { reportName: '단일판매ㆍ공급계약체결', filedAt: '2027-09-01', bodyText: '계약(수주)일자 | 2027-09-01 | 계약기간 시작일 | 2027-09-01 | 동일 공급계약 설명 | 동일 공급계약 설명' },
    expectedEvents: [canonicalEvent('material-contract', 'contracted', 'effective', 'supply-contract', 'contract')],
  },
  {
    id: 'i7-f8-control-existing-independent-siblings', family: 'F8', kind: 'control',
    input: { reportName: '중대재해발생', bodyText: '사고 발생 | 관계기관의 작업중지명령에 따라 해당 공정 작업 중지' },
    expectedEvents: [
      canonicalEvent('legal-regulatory', 'occurred', null, 'serious-industrial-accident', 'issuer'),
      canonicalEvent('operating-status', 'halted', 'effective', 'regulatory-work-stop', 'business'),
    ],
  },

  // Reconciled protected controls: these exact action/state pairs may not move.
  {
    id: 'i7-protected-302', family: 'protected', kind: 'protected',
    input: { reportName: '타법인주식및출자증권양수결정', disclosureDetailType: 'I001', filedAt: '2027-10-01', bodyText: '이사회 결의일 | 2027-10-01 | 계약체결일 | 2027-10-01 | 잔금 지급 및 지분권리 이전은 선행조건 충족 후 진행' },
    expectedEvents: [canonicalEvent('restructuring', 'decided', 'proposed', 'equity-acquisition', 'securities')],
    expectedConfidence: 'high',
  },
  {
    id: 'i7-protected-385', family: 'protected', kind: 'protected',
    input: { reportName: '기타안내사항(안내공시)', filedAt: '2027-10-01', bodyText: '| 1. 제목 | | 보통주 의무보유 기간 만료 안내 | | 의무보유 해제일 | 2027-10-30 | 해제 예정 |' },
    expectedEvents: [canonicalEvent('capital-change', 'scheduled', 'pending', 'lockup', 'securities')],
    expectedConfidence: 'high',
  },

  // Audit-corrected tuples 65/70/86 are explicit contrast rows.
  {
    id: 'i7-corrected-65-loan-extension', family: 'corrected', kind: 'corrected',
    input: { reportName: '[기재정정]금전대여결정', filedAt: '2027-11-01', bodyText: '정정사항 | 대여 종료일 연장 | 대여 실행일 | 2027-09-01 | 정정 전 종료일 | 2028-09-01 | 정정 후 종료일 | 2029-09-01' },
    expectedEvents: [canonicalEvent('material-contract', 'extended', 'effective', 'loan', 'contract')],
  },
  {
    id: 'i7-corrected-70-related-loan-extension', family: 'corrected', kind: 'corrected',
    input: { reportName: '[기재정정]기타경영사항(자율공시)', disclosureDetailType: 'I001', filedAt: '2027-11-01', bodyText: '정정사항 | 계열회사 차입계약 기간 연장 | 차입상대방 | 계열회사 | 변경계약 시작일 | 2027-11-20 | 기존 차입 만기 연장' },
    expectedEvents: [canonicalEvent('related-party', 'extended', 'pending', 'related-party-loan', 'contract')],
  },
  {
    id: 'i7-corrected-86-contractor-selected', family: 'corrected', kind: 'corrected',
    input: { reportName: '투자판단관련주요경영사항', disclosureDetailType: 'I001', bodyText: '공시 제목 | 도시정비사업 시공자 선정 | 우선협상대상자로 선정 통지 수령 | 본계약은 향후 체결 예정' },
    expectedEvents: [canonicalEvent('material-contract', 'selected', 'effective', 'construction-project', 'contract')],
  },
];

const ITERATION_7B_NEAR_MISS_CASES = [
  {
    id: 'i7b-correction-unrelated-historical-price',
    input: {
      reportName: '[기재정정]투자설명서',
      disclosureDetailType: 'C001',
      bodyText: '3. 정정사항 | 사업목적 | 정정 전 | 기존 사업 | 정정 후 | 신규 사업 | 4. 참고자료 | 과거 공모가액 확정 내역',
    },
    expectedEvents: [canonicalEvent('capital-change', 'updated', 'effective', 'equity-securities', 'securities')],
  },
  {
    id: 'i7b-current-approval-application-with-historical-withdrawal',
    input: {
      reportName: '투자판단관련주요경영사항',
      disclosureDetailType: 'I001',
      bodyText: '현재 공시사항 | 신규 품목허가 신청 접수 및 심사 개시 | 과거 이력 | 종전 품목허가 신청은 자진 취하 접수 완료',
    },
    expectedEvents: [canonicalEvent('other', null, null, null, null)],
  },
  {
    id: 'i7b-independent-third-party-loan-extension',
    input: {
      reportName: '금전대여결정',
      disclosureDetailType: 'I001',
      filedAt: '2027-06-01',
      bodyText: '거래상대방 관계 | 특수관계가 없는 독립 제3자 | 기존 금전대여 기간 연장 | 변경계약 시작일 | 2027-06-02',
    },
    expectedEvents: [canonicalEvent('material-contract', 'extended', 'pending', 'loan', 'contract')],
  },
  {
    id: 'i7b-bonus-issue-completion-keeps-cause',
    input: {
      reportName: '기타경영사항(자율공시)',
      disclosureDetailType: 'I001',
      bodyText: '자회사 무상증자 | 신주 배정 및 증자가 완료되었습니다',
    },
    expectedEvents: [canonicalEvent('capital-change', 'completed', 'effective', 'bonus-issue', 'securities')],
  },
  {
    id: 'i7b-terminal-transform-preserves-unrelated-siblings',
    input: {
      reportName: '투자판단관련주요경영사항(중대재해발생)',
      disclosureDetailType: 'I001',
      bodyText: '사건 1 | 신규 품목허가 신청을 자진 취하하였고 취하 접수 완료 | 사건 2 | 중대재해 발생 및 관계기관 작업중지명령',
    },
    expectedEvents: [
      canonicalEvent('legal-regulatory', 'occurred', null, 'serious-industrial-accident', 'issuer'),
      canonicalEvent('operating-status', 'halted', 'effective', 'regulatory-work-stop', 'business'),
      canonicalEvent('regulatory-product', 'withdrawn', 'cancelled', 'product-approval', 'product'),
    ],
  },
];

async function loadFixture() {
  return JSON.parse(await readFile(FIXTURE, 'utf8'));
}

test('event benchmark corpus is contrastive, versioned, and multi-event aware', async () => {
  const fixture = await loadFixture();
  assert.equal(fixture.schemaVersion, 'jaroo.kr-disclosure-event-benchmark.v1');
  assert.ok(fixture.cases.length >= 30);
  assert.equal(new Set(fixture.cases.map((entry) => entry.id)).size, fixture.cases.length);
  assert.ok(fixture.cases.filter((entry) => entry.tags.includes('p0')).length >= 4);
  assert.ok(fixture.cases.filter((entry) => entry.tags.includes('contrast')).length >= 8);
  assert.ok(fixture.cases.some((entry) => entry.expectedEvents.length > 1));
  for (const fixtureCase of fixture.cases) {
    assert.ok(fixtureCase.input.reportName, fixtureCase.id);
    assert.ok(fixtureCase.expectedEvents.length > 0, fixtureCase.id);
    for (const event of fixtureCase.expectedEvents) assert.ok(event.type, fixtureCase.id);
  }
});

test('all extractor candidates are deterministic and emit the canonical event shape', async () => {
  const fixture = await loadFixture();
  const { KR_DISCLOSURE_EVENT_EXTRACTOR_CANDIDATES } = await import(MODULE);
  assert.deepEqual(Object.keys(KR_DISCLOSURE_EVENT_EXTRACTOR_CANDIDATES), ['legacy', 'flat', 'structured', 'hybrid', 'document', 'gated']);

  for (const [name, extractor] of Object.entries(KR_DISCLOSURE_EVENT_EXTRACTOR_CANDIDATES)) {
    for (const fixtureCase of fixture.cases) {
      const first = extractor(fixtureCase.input);
      const second = extractor(fixtureCase.input);
      assert.deepEqual(first, second, `${name}:${fixtureCase.id}`);
      const gatedBodyDependentAbstention = name === 'gated'
        && fixtureCase.input.disclosureDetailType === 'J001'
        && !fixtureCase.input.bodyText;
      assert.ok(first.events.length > 0 || gatedBodyDependentAbstention, `${name}:${fixtureCase.id}`);
      for (const event of first.events) {
        assert.deepEqual(Object.keys(event), ['type', 'action', 'state', 'cause', 'subjectType'], `${name}:${fixtureCase.id}`);
      }
    }
  }
});

test('structured and hybrid candidates resolve the four observed P0 semantics', async () => {
  const fixture = await loadFixture();
  const {
    extractEventsHybridProjection,
    extractEventsStructuredTitleProjection,
  } = await import(MODULE);
  const p0Cases = fixture.cases.filter((entry) => entry.tags.includes('p0'));
  assert.equal(p0Cases.length, 4);

  for (const fixtureCase of p0Cases) {
    assert.deepEqual(eventSet(extractEventsStructuredTitleProjection(fixtureCase.input).events), eventSet(fixtureCase.expectedEvents), `structured:${fixtureCase.id}`);
    assert.deepEqual(eventSet(extractEventsHybridProjection(fixtureCase.input).events), eventSet(fixtureCase.expectedEvents), `hybrid:${fixtureCase.id}`);
  }
});

test('hybrid candidate uses provider detail metadata while title-only structured candidate abstains', async () => {
  const {
    extractEventsHybridProjection,
    extractEventsStructuredTitleProjection,
  } = await import(MODULE);
  const input = {
    reportName: '지분공시',
    disclosureType: 'D',
    disclosureDetailType: 'D001',
  };
  assert.equal(extractEventsStructuredTitleProjection(input).events[0].type, 'other');
  assert.deepEqual(extractEventsHybridProjection(input).events, [{
    type: 'ownership-change',
    action: 'reported',
    state: null,
    cause: 'large-shareholding',
    subjectType: 'ownership',
  }]);
});

test('document-aware candidate resolves a generic market notice from its body subject', async () => {
  const { extractEventsDocumentAwareProjection } = await import(MODULE);
  const result = extractEventsDocumentAwareProjection({
    reportName: '기타안내사항(안내공시)',
    disclosureType: 'I',
    disclosureDetailType: 'I003',
    bodyText: '기타 안내사항 | 1. 제목 | | 보통주 의무보유 기간 만료 안내 | | 2. 주요내용 | 의무보유 해제일 2026.07.16 |',
  });
  assert.deepEqual(result.events, [{
    type: 'capital-change',
    action: 'lifted',
    state: null,
    cause: 'lockup',
    subjectType: 'securities',
  }]);
  assert.ok(result.reasons.includes('document-subject-fallback'));
});

test('document-aware candidate matches every source-backed body-required reviewed case', async () => {
  const fixture = JSON.parse(await readFile(BODY_REVIEWED_FIXTURE, 'utf8'));
  const { extractEventsDocumentAwareProjection } = await import(MODULE);
  assert.equal(fixture.schemaVersion, 'jaroo.kr-disclosure-event-body-reviewed.v1');
  assert.equal(fixture.cases.length, 13);
  for (const fixtureCase of fixture.cases) {
    assert.deepEqual(
      eventSet(extractEventsDocumentAwareProjection(fixtureCase.input).events),
      eventSet(fixtureCase.expectedEvents),
      fixtureCase.id,
    );
  }
});

test('document baseline remains separate while the gated candidate exposes all pure gate stages', async () => {
  const extractorModule = await import(MODULE);
  const requiredExports = [
    'normalizeDisclosureEventGateInput',
    'runFilingWrapperGate',
    'extractStructuredBodyFacts',
    'buildDetailPriorClaims',
    'buildTitleSemanticClaims',
    'resolveTemporalEvent',
    'normalizeEventOntology',
    'arbitrateEventCandidates',
    'scoreEventExtractionConfidence',
    'extractEventsGatedProjection',
  ];
  for (const name of requiredExports) assert.equal(typeof extractorModule[name], 'function', name);
  const input = { rceptNo: '20260713800438', reportName: '기타안내사항(안내공시)', bodyText: '| 1. 제목 | | 의무보유 기간 만료 안내 | | 해제일 | 2026.07.16 |' };
  assert.equal(extractorModule.extractEventsDocumentAwareProjection(input).strategy, 'document-aware-hierarchical-projection');
  assert.equal(extractorModule.extractEventsGatedProjection(input).strategy, 'semantic-gate-v3');
  assert.equal(extractorModule.normalizeDisclosureEventGateInput({ reportName: '[첨부추가] 공시' }).wrapperKind, 'attachment-added');
  assert.equal(extractorModule.extractEventsGatedProjection({ reportName: '투자설명서', disclosureDetailType: 'C004' }).confidence, 'medium');
});

test('v3 semantic regression fixture passes exact event sets and confidence contracts', async () => {
  const fixture = JSON.parse(await readFile(SEMANTIC_GATE_FIXTURE, 'utf8'));
  const { extractEventsGatedProjection } = await import(MODULE);
  assert.equal(fixture.schemaVersion, 'jaroo.kr-disclosure-event-semantic-gate.v1');
  assert.ok(fixture.cases.length >= 12);
  for (const fixtureCase of fixture.cases) {
    const actual = extractEventsGatedProjection(fixtureCase.input);
    assert.deepEqual(eventSet(actual.events), eventSet(fixtureCase.expectedEvents), fixtureCase.id);
    if (fixtureCase.expectedConfidence) assert.equal(actual.confidence, fixtureCase.expectedConfidence, fixtureCase.id);
  }
});

test('J001 zero-activity periodic loan tables preserve the communicative filing event', async () => {
  const { extractEventsGatedProjection } = await import(MODULE);
  const actual = extractEventsGatedProjection({
    rceptNo: '20260714000419',
    reportName: '계열금융회사의약관에의한금융거래-[장단기대여]',
    disclosureDetailType: 'J001',
    bodyText: '거래상대방 | - | 거래일자 | - | 대여종류 | - | 거래금액 | - | 실제 인수금액은 없었습니다.',
  });
  assert.deepEqual(actual.events, [{
    type: 'related-party',
    action: 'reported',
    state: 'effective',
    cause: 'related-party-lending',
    subjectType: 'contract',
  }]);
  assert.equal(actual.confidence, 'medium');
});

test('J001 body-dependent disclosures abstain when the body is unavailable', async () => {
  const { extractEventsGatedProjection } = await import(MODULE);
  const actual = extractEventsGatedProjection({
    reportName: '약관에의한금융거래시계열금융회사의거래상대방의공시',
    disclosureDetailType: 'J001',
  });
  assert.deepEqual(actual.events, []);
  assert.equal(actual.confidence, 'low');
});

test('Q1-promoted semantic families use generalized lifecycle and object rules', async () => {
  const { extractEventsGatedProjection } = await import(MODULE);
  const cases = [
    {
      id: 'corrected-audit-reissue',
      input: {
        reportName: '[기재정정]감사보고서',
        disclosureDetailType: 'F001',
        filedAt: '2026-03-17',
        bodyText: '정정신고 | 정정사유 | 재무제표 수정에 따른 감사보고서 재발행',
      },
      expected: { type: 'audit', action: 'updated', state: 'effective', cause: 'audit-report', subjectType: 'audit-opinion' },
    },
    {
      id: 'corrected-offering-price',
      input: {
        reportName: '[기재정정]투자설명서(집합투자증권)',
        disclosureDetailType: 'G002',
        filedAt: '2026-03-10',
        bodyText: '정정신고 | 정정사유 | 1차 발행가액 확정 | 예정 모집가액 3000원 | 확정 발행가액 3055원',
      },
      expected: { type: 'capital-change', action: 'price-set', state: 'effective', cause: 'fund-securities', subjectType: 'securities' },
    },
    {
      id: 'chief-executive-change',
      input: { reportName: '대표이사(대표집행임원)변경(안내공시)', bodyText: '대표이사 신규 선임' },
      expected: { type: 'governance', action: 'changed', state: 'effective', cause: 'chief-executive-change', subjectType: 'governance' },
    },
    {
      id: 'related-party-collateral-received',
      input: { reportName: '특수관계인으로부터받은담보', disclosureDetailType: 'J001', filedAt: '2026-03-01', bodyText: '담보물 | 계열회사 주식 | 담보 수령일 | 2026.03.01' },
      expected: { type: 'related-party', action: 'received', state: 'effective', cause: 'collateral-received', subjectType: 'securities' },
    },
    {
      id: 'related-party-deposit-effective',
      input: { reportName: '특수관계인과의예ㆍ적금거래', disclosureDetailType: 'J001', filedAt: '2026-02-27', bodyText: '예ㆍ적금일 | 2026.02.27 | 예ㆍ적금의 종류 | USD RP | 상품가입 완료' },
      expected: { type: 'related-party', action: 'deposited', state: 'effective', cause: 'deposit-investment', subjectType: 'securities' },
    },
    {
      id: 'related-party-donation-planned',
      input: { reportName: '특수관계인에대한증여', disclosureDetailType: 'J001', filedAt: '2026-03-01', bodyText: '현금 출연은 분기별 출연 예정이며 이사회에서 의결하였다' },
      expected: { type: 'related-party', action: 'decided', state: 'proposed', cause: 'cash-donation', subjectType: 'cash' },
    },
  ];

  for (const fixtureCase of cases) {
    assert.deepEqual(extractEventsGatedProjection(fixtureCase.input).events, [fixtureCase.expected], fixtureCase.id);
  }

  assert.deepEqual(extractEventsGatedProjection({
    reportName: '매매거래정지및정지해제(중요내용공시)',
    filedAt: '2026-03-26',
    bodyText: '매매거래정지일시 | 2026.03.26 17:05 | 매매거래정지해제일시 | 2026.03.27 09:00 | 주식소각 결정',
  }).events, [
    { type: 'trading-status', action: 'halted', state: 'effective', cause: 'share-cancellation', subjectType: 'listed-shares' },
    { type: 'trading-status', action: 'lifted', state: 'pending', cause: 'share-cancellation', subjectType: 'listed-shares' },
  ]);
});

test('iteration 5 gates cover Q4 lifecycle, fallback, polarity, and object taxonomies', async () => {
  const { extractEventsGatedProjection } = await import(MODULE);
  const cases = [
    {
      id: 'contract-termination-polarity',
      input: { reportName: '단일판매ㆍ공급계약해지', bodyText: '계약 해지일자 | 2025.11.20 | 해지 주요사유 | 상호 합의' },
      expected: [{ type: 'material-contract', action: 'terminated', state: 'effective', cause: 'supply-contract', subjectType: 'contract' }],
    },
    {
      id: 'generic-collateral-rescue',
      input: { reportName: '타인에대한담보제공결정', bodyText: '담보제공 결정 | 담보자산 | 공장 설비' },
      expected: [{ type: 'material-contract', action: 'provided', state: 'effective', cause: 'collateral-provision', subjectType: 'asset' }],
    },
    {
      id: 'compliance-program-multi-event',
      input: { reportName: '공정거래자율준수프로그램운영현황(안내공시)', bodyText: '운영현황 보고 | 차기 교육 예정' },
      expected: [
        { type: 'legal-regulatory', action: 'reported', state: 'effective', cause: 'compliance-program', subjectType: 'issuer' },
        { type: 'legal-regulatory', action: 'scheduled', state: 'pending', cause: 'compliance-program', subjectType: 'issuer' },
      ],
    },
    {
      id: 'facility-correction-remains-pending',
      input: { reportName: '[기재정정]신규시설투자등(자율공시)', bodyText: '정정사유 | 투자기간 종료일 변경 | 정정후 종료일 | 2027.02.28' },
      expected: [{ type: 'capital-expenditure', action: 'updated', state: 'pending', cause: 'facility-investment', subjectType: 'asset' }],
    },
    {
      id: 'serious-accident-independent-work-stop',
      input: { reportName: '중대재해발생', bodyText: '사고 발생 | 관계기관의 작업중지명령에 따라 해당 공정 작업 중지' },
      expected: [
        { type: 'legal-regulatory', action: 'occurred', state: null, cause: 'serious-industrial-accident', subjectType: 'issuer' },
        { type: 'operating-status', action: 'halted', state: 'effective', cause: 'regulatory-work-stop', subjectType: 'business' },
      ],
    },
    {
      id: 'related-party-security-borrowing-object',
      input: { reportName: '계열금융회사의약관에의한금융거래-[장단기차입]', disclosureDetailType: 'J001', bodyText: '거래상품 | 기업어음(CP) | 차입 실행 완료' },
      expected: [{ type: 'related-party', action: 'borrowed', state: 'effective', cause: 'securities-borrowing', subjectType: 'securities' }],
    },
    {
      id: 'loan-correction-end-date-extension',
      input: { reportName: '[기재정정]금전대여결정', bodyText: '정정사유 | 대여기간 종료일 변경 | 정정후 종료일 | 2025.11.20' },
      expected: [{ type: 'material-contract', action: 'extended', state: 'effective', cause: 'loan', subjectType: 'contract' }],
    },
    {
      id: 'generic-production-termination-rescue',
      input: { reportName: '기타안내사항(안내공시)', bodyText: '제목 | 생산 설비 가동중단 관련 진행사항 | 해당 생산을 종료하였고 재개 계획은 없음' },
      expected: [{ type: 'operating-status', action: 'terminated', state: 'effective', cause: 'production-suspension', subjectType: 'business' }],
    },
    {
      id: 'service-contract-semantic-title-without-issuer-literal',
      input: { reportName: '어플리케이션운영서비스계약체결', bodyText: '계약 체결 | 운영서비스 제공' },
      expected: [{ type: 'material-contract', action: 'contracted', state: 'effective', cause: 'service-contract', subjectType: 'contract' }],
    },
  ];

  for (const fixtureCase of cases) {
    const actual = extractEventsGatedProjection(fixtureCase.input);
    assert.deepEqual(eventSet(actual.events), eventSet(fixtureCase.expected), fixtureCase.id);
  }

  const serviceNearNegative = extractEventsGatedProjection({
    reportName: '기타경영사항(자율공시)',
    bodyText: '어플리케이션 운영서비스 품질 점검 결과를 안내합니다.',
  });
  assert.ok(serviceNearNegative.events.every((event) => event.cause !== 'service-contract'));
});

test('iteration 6 gates require field-scoped evidence and calibrate unsupported corrections', async () => {
  const { extractEventsGatedProjection } = await import(MODULE);
  const cases = [
    {
      id: 'bodyless-fund-correction-abstains-on-state',
      input: {
        reportName: '[기재정정]증권신고서(집합투자증권-회사형)',
        disclosureDetailType: 'G002',
      },
      expected: { type: 'capital-change', action: 'updated', state: null, cause: 'fund-securities', subjectType: 'securities' },
      confidence: 'medium',
    },
    {
      id: 'conversion-price-application-date',
      input: {
        reportName: '전환가액ㆍ신주인수권행사가액ㆍ교환가액의조정(안내공시)',
        filedAt: '2025-12-23',
        bodyText: '조정전 가액 | 675 | 조정후 가액 | 848 | 조정가액 적용일 | 2025-12-23',
      },
      expected: { type: 'capital-change', action: 'adjusted', state: 'effective', cause: 'convertible-price', subjectType: 'securities' },
    },
    {
      id: 'supply-contract-execution-date',
      input: {
        reportName: '단일판매ㆍ공급계약체결',
        filedAt: '2025-12-31',
        bodyText: '계약기간 | 시작일 | 2025-03-03 | 종료일 | 2028-09-11 | 계약(수주)일자 | 2025-12-31',
      },
      expected: { type: 'material-contract', action: 'contracted', state: 'effective', cause: 'supply-contract', subjectType: 'contract' },
    },
    {
      id: 'anchored-securities-borrowing-synonym',
      input: {
        reportName: '계열금융회사의약관에의한금융거래-[장단기차입]',
        disclosureDetailType: 'J001',
        bodyText: '거래일자 | 2025-07-01 | 종류 | 지분증권 | 거래목적 | ETF 설정용 차입',
      },
      expected: { type: 'related-party', action: 'borrowed', state: 'effective', cause: 'securities-borrowing', subjectType: 'securities' },
    },
    {
      id: 'anchored-warrant-exercise-subtype',
      input: {
        reportName: '전환청구권ㆍ신주인수권ㆍ교환청구권행사',
        bodyText: '1. 구분 | 신주인수권부사채권의 신주인수권 행사 | 행사주식수 | 69,385',
      },
      expected: { type: 'capital-change', action: 'exercised', state: 'effective', cause: 'warrant-bond', subjectType: 'securities' },
    },
    {
      id: 'value-up-implementation-report',
      input: {
        reportName: '기업가치제고계획(자율공시)',
        bodyText: '1. 계획서 명칭 | 2025년 기업가치 제고 계획 (이행현황) | 2. 주요 내용 | 이행평가 및 실행 현황',
      },
      expected: { type: 'corporate-event', action: 'reported', state: 'effective', cause: 'value-up-plan', subjectType: 'issuer' },
    },
    {
      id: 'existing-stock-option-grant-correction',
      input: {
        reportName: '[기재정정]주식매수선택권부여에관한신고',
        disclosureDetailType: 'E004',
        bodyText: '정정대상 공시서류 | 주식매수선택권 부여에 관한 신고 | 최초제출일 | 2025-03-18 | 정정사항 | 공정가치 산정 가정 기재오류',
      },
      expected: { type: 'capital-change', action: 'updated', state: 'effective', cause: 'stock-option', subjectType: 'securities' },
    },
    {
      id: 'corrected-related-party-loan-future-period',
      input: {
        reportName: '[기재정정]특수관계인에대한자금대여',
        disclosureDetailType: 'J001',
        bodyText: '정정후 거래일자 | 2026년 1분기 중 필요시 자금대여 | 향후 대여 예정',
      },
      expected: { type: 'related-party', action: 'updated', state: 'pending', cause: 'related-party-loan', subjectType: 'contract' },
      confidence: 'medium',
    },
  ];

  for (const fixtureCase of cases) {
    const actual = extractEventsGatedProjection(fixtureCase.input);
    assert.deepEqual(actual.events, [fixtureCase.expected], fixtureCase.id);
    if (fixtureCase.confidence) assert.equal(actual.confidence, fixtureCase.confidence, fixtureCase.id);
  }

  const continuingContract = extractEventsGatedProjection({
    reportName: '단일판매ㆍ공급계약체결',
    filedAt: '2025-10-23',
    bodyText: '계약기간 | 시작일 | 2023-01-02 | 계약(수주)일자 | 2025-10-23 | 일부계약 진행 후 수행중이었음',
  });
  assert.equal(continuingContract.events[0].state, null);

  const earlierDirectorChange = extractEventsGatedProjection({
    reportName: '사외이사의선임ㆍ해임또는중도퇴임에관한신고',
    filedAt: '2025-12-31',
    bodyText: '사외이사 변경 발생일 | 2025-12-30 | 신규 선임 | 임기시작일 | -',
  });
  assert.equal(earlierDirectorChange.events[0].state, null);
});

test('iteration 7 semantic families preserve scoped intent, polarity, lifecycle, and cardinality', async () => {
  const { extractEventsGatedProjection } = await import(MODULE);
  const familyCounts = Object.fromEntries(
    [...new Set(ITERATION_7_SYNTHETIC_CASES.map((fixtureCase) => fixtureCase.family))]
      .map((family) => [family, ITERATION_7_SYNTHETIC_CASES.filter((fixtureCase) => fixtureCase.family === family).length]),
  );

  assert.equal(ITERATION_7_SYNTHETIC_CASES.length, 58);
  assert.deepEqual(familyCounts, {
    F1: 6,
    F2: 10,
    F3: 8,
    F4: 8,
    F5: 6,
    F6: 6,
    F7: 5,
    F8: 4,
    protected: 2,
    corrected: 3,
  });

  const failures = [];
  for (const fixtureCase of ITERATION_7_SYNTHETIC_CASES) {
    const actual = extractEventsGatedProjection(fixtureCase.input);
    if (JSON.stringify(eventSet(actual.events)) !== JSON.stringify(eventSet(fixtureCase.expectedEvents))) {
      failures.push({
        id: fixtureCase.id,
        family: fixtureCase.family,
        kind: fixtureCase.kind,
        expected: eventSet(fixtureCase.expectedEvents),
        actual: eventSet(actual.events),
      });
    } else if (fixtureCase.expectedConfidence && actual.confidence !== fixtureCase.expectedConfidence) {
      failures.push({
        id: fixtureCase.id,
        family: fixtureCase.family,
        kind: fixtureCase.kind,
        expectedConfidence: fixtureCase.expectedConfidence,
        actualConfidence: actual.confidence,
      });
    }
  }
  assert.deepEqual(failures, []);
});

test('iteration 7b generalized near misses keep current scope, cause, relation, and cardinality', async () => {
  const { extractEventsGatedProjection } = await import(MODULE);
  const failures = ITERATION_7B_NEAR_MISS_CASES.flatMap((fixtureCase) => {
    const actual = extractEventsGatedProjection(fixtureCase.input);
    return JSON.stringify(eventSet(actual.events)) === JSON.stringify(eventSet(fixtureCase.expectedEvents))
      ? []
      : [{ id: fixtureCase.id, expected: eventSet(fixtureCase.expectedEvents), actual: eventSet(actual.events) }];
  });
  assert.deepEqual(failures, []);
});

test('iteration 8 accumulates scoped lifecycle repairs without losing sibling intent', async () => {
  const { extractEventsGatedProjection } = await import(MODULE);
  const cases = [
    {
      id: 'offering-milestones-rescheduled',
      input: {
        reportName: '[기재정정]증권신고서(지분증권)',
        disclosureDetailType: 'C001',
        filedAt: '2027-03-10',
        bodyText: '3. 정정사항 | [공통정정] 일정변경 | 정정 전 | 주금납입일 2027-03-20 | 정정 후 | 주금납입일 2027-04-20 | 신주상장 예정일 2027-05-02',
      },
      expectedEvents: [canonicalEvent('capital-change', 'rescheduled', 'pending', 'equity-securities', 'securities')],
    },
    {
      id: 'demerger-registration-rescheduled',
      input: {
        reportName: '[기재정정]주요사항보고서(회사분할결정)',
        filedAt: '2027-03-10',
        bodyText: '3. 정정사항 | 일정변경으로 인한 정정 | 정정 전 | 분할등기예정일자 2027-03-20 | 정정 후 | 분할등기예정일자 2027-04-20',
      },
      expectedEvents: [canonicalEvent('restructuring', 'rescheduled', 'pending', 'demerger', 'issuer')],
    },
    {
      id: 'blank-final-terms-stay-pending',
      input: {
        reportName: '[기재정정]주요사항보고서(신주인수권부사채권발행결정)',
        filedAt: '2027-03-10',
        bodyText: '3. 정정사항 | 사채만기일 | 일정변경에 따른 기재정정 | 정정 전 | 행사가액 확정 예정 | 정정 후 | 행사가액은 청약 후 확정될 예정 | 납입일 2027-04-20',
      },
      expectedEvents: [canonicalEvent('capital-change', 'updated', 'pending', 'bond-with-warrants', 'securities')],
    },
    {
      id: 'ownership-not-yet-effective',
      input: {
        reportName: '[기재정정]최대주주변경을수반하는주식양수도계약체결',
        filedAt: '2027-03-10',
        bodyText: '3. 정정사항 | 정정 전 | 변경예정일 2027-03-20 | 정정 후 | 변경예정일 2027-04-20 | 현재 소유권 변경은 미발생',
      },
      expectedEvents: [canonicalEvent('ownership-change', 'updated', 'pending', 'controlling-shareholder', 'ownership')],
    },
    {
      id: 'dual-sibling-different-stage-accumulator',
      input: {
        reportName: '[기재정정]소송등의제기ㆍ신청(자본거래 일정변경)',
        disclosureDetailType: 'C001',
        filedAt: '2027-03-10',
        bodyText: '3. 정정사항 | 현재 소송을 취하하고 철회함 | [공통정정] 일정변경 | 정정 전 | 주금납입일 2027-03-20 | 정정 후 | 주금납입일 2027-04-20',
      },
      expectedEvents: [
        canonicalEvent('legal-regulatory', 'withdrawn', 'effective', 'litigation', 'issuer'),
        canonicalEvent('capital-change', 'rescheduled', 'pending', 'equity-securities', 'securities'),
      ],
    },
    {
      id: 'existing-guarantee-extended-effective',
      input: {
        reportName: '타인에대한채무보증결정',
        filedAt: '2027-03-10',
        bodyText: '기존 채무보증 기간 연장 | 채무보증기간 시작일 2027-03-10 | 종료일 2029-03-10',
      },
      expectedEvents: [canonicalEvent('material-contract', 'extended', 'effective', 'debt-guarantee', 'contract')],
    },
    {
      id: 'aircraft-lease-extended-pending',
      input: {
        reportName: '특수관계인과의리스거래',
        disclosureDetailType: 'J001',
        filedAt: '2027-03-10',
        bodyText: '기존 항공기 리스 계약기간 연장 | 각 계약별 세부내역 | 리스물건 항공기 | 변경계약 시작일 2027-04-10',
      },
      expectedEvents: [canonicalEvent('related-party', 'extended', 'pending', 'aircraft-lease', 'asset')],
    },
    {
      id: 'new-fund-optional-extension-control',
      input: {
        reportName: '특수관계인과의수익증권거래',
        disclosureDetailType: 'J001',
        filedAt: '2027-03-10',
        bodyText: '거래일자 2027-04-10 | 신규 수익증권 설정 예정 | 편입물 만기 미도래 또는 연장시 연장 가능',
      },
      expectedEvents: [canonicalEvent('related-party', 'decided', 'proposed', 'fund-security-investment', 'securities')],
    },
    {
      id: 'bond-purchase-already-effective',
      input: {
        reportName: '특수관계인으로부터채권매수',
        disclosureDetailType: 'J001',
        filedAt: '2027-03-10',
        bodyText: '매수일자 2027-03-09 | 발행일 2027-03-09 | 만기일 2027-09-09 | 단기자금 운용 목적으로 채권을 매입한 거래',
      },
      expectedEvents: [canonicalEvent('related-party', 'purchased', 'effective', 'bond-transactions', 'securities')],
    },
    {
      id: 'corrected-business-disposal-completed',
      input: {
        reportName: '[기재정정]영업양도결정(자율공시)(종속회사의주요경영사항)',
        filedAt: '2027-03-10',
        bodyText: '정정사유 거래 종결 및 양수인 변경에 따른 정정공시 | 양도대금 전액 수령 완료',
      },
      expectedEvents: [canonicalEvent('restructuring', 'completed', 'effective', 'business-disposal', 'business')],
    },
    {
      id: 'future-equity-disposal-remains-proposed',
      input: {
        reportName: '타법인주식및출자증권양도결정(자회사의 주요경영사항)',
        filedAt: '2027-03-10',
        bodyText: '계약금 2027-03-10 | 잔금 12,000,000,000원 (2027-04-10 예정) | 거래종결일은 선행조건 충족 여부에 따라 변동 가능',
      },
      expectedEvents: [canonicalEvent('restructuring', 'decided', 'proposed', 'equity-disposal', 'securities')],
    },
    {
      id: 'trust-contract-started-on-filing-date',
      input: {
        reportName: '주요사항보고서(자기주식취득신탁계약체결결정)',
        filedAt: '2027-03-10',
        bodyText: '신탁계약기간 시작일 2027-03-10 | 종료일 2028-03-09 | 계약체결 예정일자 2027-03-10 | 계약목적 임직원 성과보상 재원 확보',
      },
      expectedEvents: [canonicalEvent('capital-change', 'decided', 'proposed', 'treasury-share-trust', 'securities')],
    },
    {
      id: 'future-convertible-bond-purchase-remains-proposed',
      input: {
        reportName: '주요사항보고서(자기전환사채만기전취득결정)',
        filedAt: '2027-03-10',
        bodyText: '지급(예정)일 2027-04-10 | 향후처리계획 취득 후 소각 | 보유현금을 활용하여 상기 사채를 상환할 예정',
      },
      expectedEvents: [canonicalEvent('capital-change', 'decided', 'proposed', 'convertible-bond', 'securities')],
    },
    {
      id: 'future-related-party-debt-assumption',
      input: {
        reportName: '특수관계인으로부터채무인수',
        disclosureDetailType: 'J001',
        filedAt: '2027-03-10',
        bodyText: '채무인수 예정일 2027-04-10 | 수익권매매계약 체결에 따라 담보대출을 인수하는 건',
      },
      expectedEvents: [canonicalEvent('related-party', 'decided', 'proposed', 'debt-assumption', 'contract')],
    },
    {
      id: 'future-related-party-technology-transfer',
      input: {
        reportName: '특수관계인으로부터기술이전',
        disclosureDetailType: 'J001',
        filedAt: '2027-03-10',
        bodyText: '계약기간 2027-04-10 ~ 2027-05-10 | 계약체결일 2027-04-10 | 거래종결일(기술이전일)은 향후 일정에 따라 변경될 수 있음',
      },
      expectedEvents: [canonicalEvent('related-party', 'decided', 'proposed', 'technology-transfer', 'contract-right')],
    },
    {
      id: 'real-estate-collateral-already-provided',
      input: {
        reportName: '특수관계인에대한담보제공',
        disclosureDetailType: 'J001',
        filedAt: '2027-03-10',
        bodyText: '담보제공일자 2027-03-10 | 담보물 부동산(담보신탁 우선수익권) | 기존 약정을 종료하고 신규 약정을 체결함에 따라 담보 제공되는 건',
      },
      expectedEvents: [canonicalEvent('related-party', 'provided', 'effective', 'collateral-provision', 'real-estate')],
    },
  ];
  const failures = cases.flatMap((fixtureCase) => {
    const actual = extractEventsGatedProjection(fixtureCase.input);
    return JSON.stringify(eventSet(actual.events)) === JSON.stringify(eventSet(fixtureCase.expectedEvents))
      ? []
      : [{ id: fixtureCase.id, expected: eventSet(fixtureCase.expectedEvents), actual: eventSet(actual.events) }];
  });
  assert.deepEqual(failures, []);
});

test('iteration 8 semantic repair uses operative fields instead of purpose or funding prose', async () => {
  const { extractEventsGatedProjection } = await import(MODULE);
  const cases = [
    {
      id: 'trust-same-day-exact-purpose-stays-proposed',
      input: { reportName: '주요사항보고서(자기주식취득신탁계약체결결정)', filedAt: '2027-03-10', bodyText: '계약기간 | 시작일 | 2027-03-10 | 종료일 | 2028-03-09 | 계약체결 예정일자 | 2027-03-10 | 계약목적 | 임직원 성과보상재원 확보' },
      expectedEvents: [canonicalEvent('capital-change', 'decided', 'proposed', 'treasury-share-trust', 'securities')],
    },
    {
      id: 'trust-same-day-purpose-paraphrase-stays-proposed',
      input: { reportName: '주요사항보고서(자기주식취득신탁계약체결결정)', filedAt: '2027-03-10', bodyText: '계약기간 | 시작일 | 2027-03-10 | 종료일 | 2028-03-09 | 계약체결 예정일자 | 2027-03-10 | 계약목적 | 임직원 보상을 위한 재원 마련' },
      expectedEvents: [canonicalEvent('capital-change', 'decided', 'proposed', 'treasury-share-trust', 'securities')],
    },
    {
      id: 'trust-current-perfective-contract-is-effective',
      input: { reportName: '주요사항보고서(자기주식취득신탁계약체결결정)', filedAt: '2027-03-10', bodyText: '계약기간 | 시작일 | 2027-03-10 | 계약체결일 | 2027-03-10 | 금일 신탁계약을 체결 완료하였음' },
      expectedEvents: [canonicalEvent('capital-change', 'contracted', 'effective', 'treasury-share-trust', 'securities')],
    },
    {
      id: 'cb-future-payment-exact-cash-source-stays-proposed',
      input: { reportName: '주요사항보고서(자기전환사채만기전취득결정)', filedAt: '2027-03-10', bodyText: '취득 결정일 2027-03-10 | 지급(예정)일 2027-04-10 | 취득 후 소각 | 보유현금을 활용하여 상기 사채를 상환할 예정' },
      expectedEvents: [canonicalEvent('capital-change', 'decided', 'proposed', 'convertible-bond', 'securities')],
    },
    {
      id: 'cb-future-payment-paraphrase-stays-proposed',
      input: { reportName: '주요사항보고서(자기전환사채만기전취득결정)', filedAt: '2027-03-10', bodyText: '취득 결정일 2027-03-10 | 지급(예정)일 2027-04-10 | 취득 후 소각 | 회사 자금으로 해당 사채 대금을 지급할 계획' },
      expectedEvents: [canonicalEvent('capital-change', 'decided', 'proposed', 'convertible-bond', 'securities')],
    },
    {
      id: 'cb-deposit-now-balance-and-transfer-future-stays-proposed',
      input: { reportName: '주요사항보고서(자기전환사채만기전취득결정)', filedAt: '2027-03-10', bodyText: '지급(예정)일 2027-03-10 | 계약금은 금일 지급 | 잔금은 2027-04-10 지급 예정 | 대금 전액 지급 완료 즉시 사채를 수령할 예정' },
      expectedEvents: [canonicalEvent('capital-change', 'decided', 'proposed', 'convertible-bond', 'securities')],
    },
    {
      id: 'cb-actual-same-day-acquisition-is-effective',
      input: { reportName: '주요사항보고서(자기전환사채만기전취득결정)', filedAt: '2027-03-10', bodyText: '지급일 2027-03-10 | 실제 사채 취득일 2027-03-10 | 대금 지급 및 사채 취득 완료' },
      expectedEvents: [canonicalEvent('capital-change', 'acquired', 'effective', 'convertible-bond', 'securities')],
    },
  ];
  const results = cases.map((fixtureCase) => ({ fixtureCase, actual: extractEventsGatedProjection(fixtureCase.input) }));
  const failures = results.flatMap(({ fixtureCase, actual }) => {
    const expected = eventSet(fixtureCase.expectedEvents);
    const observed = eventSet(actual.events);
    return JSON.stringify(observed) === JSON.stringify(expected) && actual.events.length === 1
      ? []
      : [{ id: fixtureCase.id, expected, actual: observed, cardinality: actual.events.length }];
  });
  assert.deepEqual(failures, []);
  assert.equal(results[0].actual.confidence, results[1].actual.confidence);
  assert.equal(results[3].actual.confidence, results[4].actual.confidence);
});

test('iteration 8 actuality repair rejects scheduled and historical evidence while accepting Korean perfective paraphrases', async () => {
  const { extractEventsGatedProjection } = await import(MODULE);
  const cases = [
    {
      id: 'trust-current-perfective-paraphrase-is-effective',
      input: { reportName: '주요사항보고서(자기주식취득신탁계약체결결정)', filedAt: '2027-03-10', bodyText: '계약기간 | 시작일 | 2027-03-10 | 계약체결일 | 2027-03-10 | 금일 신탁 계약 체결 절차를 모두 마쳤습니다' },
      expectedEvents: [canonicalEvent('capital-change', 'contracted', 'effective', 'treasury-share-trust', 'securities')],
    },
    {
      id: 'cb-scheduled-actual-acquisition-label-stays-proposed',
      input: { reportName: '주요사항보고서(자기전환사채만기전취득결정)', filedAt: '2027-03-10', bodyText: '실제 사채 취득일 2027-04-10 예정 | 취득 대금은 당일 지급 예정' },
      expectedEvents: [canonicalEvent('capital-change', 'decided', 'proposed', 'convertible-bond', 'securities')],
    },
    {
      id: 'cb-payment-date-mapped-to-scheduled-acquisition-stays-proposed',
      input: { reportName: '주요사항보고서(자기전환사채만기전취득결정)', filedAt: '2027-03-10', bodyText: '지급(예정)일 2027-03-10 | 지급 예정일은 실제 사채 취득일로 예정되어 있습니다' },
      expectedEvents: [canonicalEvent('capital-change', 'decided', 'proposed', 'convertible-bond', 'securities')],
    },
    {
      id: 'cb-current-perfective-paraphrase-is-effective',
      input: { reportName: '주요사항보고서(자기전환사채만기전취득결정)', filedAt: '2027-03-10', bodyText: '지급일 2027-03-10 | 오늘 사채 대금을 모두 지급하고 채권을 넘겨받았습니다' },
      expectedEvents: [canonicalEvent('capital-change', 'acquired', 'effective', 'convertible-bond', 'securities')],
    },
    {
      id: 'cb-current-actual-acquisition-date-role-paraphrase-is-effective',
      input: { reportName: '주요사항보고서(자기전환사채만기전취득결정)', filedAt: '2027-03-10', bodyText: '대금 지급일 2027-03-10 | 대금 지급일은 채권을 실제로 넘겨받은 날에 해당합니다' },
      expectedEvents: [canonicalEvent('capital-change', 'acquired', 'effective', 'convertible-bond', 'securities')],
    },
    {
      id: 'cb-completed-acquisition-with-future-resale-remains-effective',
      input: { reportName: '주요사항보고서(자기전환사채만기전취득결정)', filedAt: '2027-03-10', bodyText: '지급일 2027-03-10 | 대금 지급 및 사채 취득 완료 | 취득 후 2027-04-10 재매각 예정' },
      expectedEvents: [canonicalEvent('capital-change', 'acquired', 'effective', 'convertible-bond', 'securities')],
    },
    {
      id: 'trust-historical-completion-stays-proposed',
      input: { reportName: '주요사항보고서(자기주식취득신탁계약체결결정)', filedAt: '2027-03-10', bodyText: '계약기간 | 시작일 | 2027-03-10 | 계약체결 예정일자 | 2027-03-10 | 과거이력 | 2026년에는 신탁계약을 체결 완료하였음' },
      expectedEvents: [canonicalEvent('capital-change', 'decided', 'proposed', 'treasury-share-trust', 'securities')],
    },
    {
      id: 'cb-historical-completion-stays-proposed',
      input: { reportName: '주요사항보고서(자기전환사채만기전취득결정)', filedAt: '2027-03-10', bodyText: '취득 결정일 2027-03-10 | 지급(예정)일 2027-04-10 | 과거내역 | 2026년에는 대금 지급 및 사채 취득 완료' },
      expectedEvents: [canonicalEvent('capital-change', 'decided', 'proposed', 'convertible-bond', 'securities')],
    },
  ];
  const failures = cases.flatMap(({ id, input, expectedEvents }) => {
    const actual = extractEventsGatedProjection(input);
    const expected = eventSet(expectedEvents);
    const observed = eventSet(actual.events);
    const resolved = actual.events.length > 0 && actual.events.every((event) => event.type !== 'other');
    return JSON.stringify(observed) === JSON.stringify(expected)
      && actual.confidence === 'high'
      && resolved
      && actual.events.length === 1
      ? []
      : [{ id, expected, actual: observed, confidence: actual.confidence, resolved, cardinality: actual.events.length }];
  });
  assert.deepEqual(failures, []);
});

test('iteration 8 multi-intent accumulation is invariant to neutral distance', async () => {
  const { extractEventsGatedProjection } = await import(MODULE);
  const filler = (length) => '중립문장'.repeat(Math.ceil(length / 4)).slice(0, length);
  const expectedEvents = [
    canonicalEvent('legal-regulatory', 'withdrawn', 'effective', 'litigation', 'issuer'),
    canonicalEvent('capital-change', 'rescheduled', 'pending', 'equity-securities', 'securities'),
  ];
  const variants = [0, 301, 4096, 16384].flatMap((length) => [
    {
      id: `terminal-then-schedule-neutral-${length}`,
      bodyText: `3. 정정사항 | 현재 소송을 취하하고 철회함 | ${filler(length)} | [공통정정] 일정변경 | 정정 전 | 주금납입일 2027-03-20 | 정정 후 | 주금납입일 2027-04-20`,
    },
    {
      id: `schedule-then-terminal-neutral-${length}`,
      bodyText: `3. 정정사항 | [공통정정] 일정변경 | 정정 전 | 주금납입일 2027-03-20 | 정정 후 | 주금납입일 2027-04-20 | ${filler(length)} | 현재 소송을 취하하고 철회함`,
    },
  ].map(({ id, bodyText }) => ({
    id,
    input: {
      reportName: '[기재정정]소송등의제기ㆍ신청',
      disclosureDetailType: 'C001',
      filedAt: '2027-03-10',
      bodyText,
    },
  })));
  const failures = variants.flatMap(({ id, input }) => {
    const actual = extractEventsGatedProjection(input);
    return JSON.stringify(eventSet(actual.events)) === JSON.stringify(eventSet(expectedEvents)) && actual.events.length === 2
      ? []
      : [{ id, expected: eventSet(expectedEvents), actual: eventSet(actual.events), cardinality: actual.events.length }];
  });
  assert.deepEqual(failures, []);
});

test('iteration 8 semantic metamorphisms preserve tuple confidence resolution and sibling cardinality', async () => {
  const { extractEventsGatedProjection } = await import(MODULE);
  const filler = (length) => '중립문장'.repeat(Math.ceil(length / 4)).slice(0, length);
  const project = (input) => {
    const actual = extractEventsGatedProjection(input);
    return {
      events: eventSet(actual.events),
      confidence: actual.confidence,
      resolved: actual.events.length > 0 && actual.events.every((event) => event.type !== 'other'),
      cardinality: actual.events.length,
    };
  };
  const trust = (purpose) => ({ reportName: '주요사항보고서(자기주식취득신탁계약체결결정)', filedAt: '2027-03-10', bodyText: `계약기간 | 시작일 | 2027-03-10 | 종료일 | 2028-03-09 | 계약체결 예정일자 | 2027-03-10 | 계약목적 | ${purpose}` });
  const cb = (funding) => ({ reportName: '주요사항보고서(자기전환사채만기전취득결정)', filedAt: '2027-03-10', bodyText: `취득 결정일 2027-03-10 | 지급(예정)일 2027-04-10 | 취득 후 소각 | ${funding}` });
  const terminalFirst = (length) => ({ reportName: '[기재정정]소송등의제기ㆍ신청', disclosureDetailType: 'C001', filedAt: '2027-03-10', bodyText: `3. 정정사항 | 현재 소송을 취하하고 철회함 | ${filler(length)} | [공통정정] 일정변경 | 정정 전 | 주금납입일 2027-03-20 | 정정 후 | 주금납입일 2027-04-20` });
  const scheduleFirst = (length) => ({ reportName: '[기재정정]소송등의제기ㆍ신청', disclosureDetailType: 'C001', filedAt: '2027-03-10', bodyText: `3. 정정사항 | [공통정정] 일정변경 | 정정 전 | 주금납입일 2027-03-20 | 정정 후 | 주금납입일 2027-04-20 | ${filler(length)} | 현재 소송을 취하하고 철회함` });
  const comparisons = [
    ['trust-purpose-exact-vs-paraphrase', trust('임직원 성과보상재원 확보'), trust('임직원 보상을 위한 재원 마련')],
    ['cb-funding-exact-vs-paraphrase', cb('보유현금을 활용하여 상기 사채를 상환할 예정'), cb('회사 자금으로 해당 사채 대금을 지급할 계획')],
    ['distance-zero-vs-301', terminalFirst(0), terminalFirst(301)],
    ['order-terminal-vs-schedule-first-zero', terminalFirst(0), scheduleFirst(0)],
    ['order-terminal-vs-schedule-first-4096', terminalFirst(4096), scheduleFirst(4096)],
    ['order-terminal-vs-schedule-first-16384', terminalFirst(16384), scheduleFirst(16384)],
  ];
  const failures = comparisons.flatMap(([id, left, right]) => {
    const leftProjection = project(left);
    const rightProjection = project(right);
    return JSON.stringify(leftProjection) === JSON.stringify(rightProjection)
      ? []
      : [{ id, left: leftProjection, right: rightProjection }];
  });
  assert.deepEqual(failures, []);
});

test('semantic gate benchmark enforces exact-set accuracy, coverage, and high-confidence precision', () => {
  const output = execFileSync(process.execPath, [
    SEMANTIC_GATE_BENCHMARK,
    `--fixture=${SEMANTIC_GATE_FIXTURE}`,
    '--gate=strict',
    '--json',
  ], { encoding: 'utf8' });
  const report = JSON.parse(output);
  assert.equal(report.gate.passed, true);
  assert.equal(report.metrics.exactSetAccuracy, 1);
  assert.equal(report.metrics.fieldAccuracy, 1);
  assert.equal(report.metrics.highConfidenceExactPrecision, 1);
  assert.ok(report.metrics.exactSetWilsonLower > 0.75);
  assert.ok(report.metrics.highConfidenceWilsonLower > 0.7);
  assert.ok(report.metrics.highConfidenceCoverage >= 0.35);
});

test('semantic gate metrics reject abstain, other, missing, extra, all-low, and duplicate-template gaming', async () => {
  const benchmark = await import(pathToFileURL(SEMANTIC_GATE_BENCHMARK));
  const gold = { type: 'capital-change', action: 'decided', state: 'proposed', cause: 'rights-offering', subjectType: 'securities' };
  const fixtureCase = { id: 'case', templateKey: 'A', expectedEvents: [gold] };
  const evaluate = (events, confidence = 'high', extra = {}) => benchmark.evaluateSemanticGateCandidate(fixtureCase, { events, confidence, ...extra });
  assert.equal(evaluate([], 'high', { resolved: false }).exact, false);
  assert.equal(evaluate([{ ...gold, type: 'other' }]).resolved, false);
  assert.equal(evaluate([{ ...gold, cause: null }]).exact, false);
  assert.equal(evaluate([gold, gold]).exact, false);

  const allLow = benchmark.assessSemanticGateThresholds([evaluate([gold], 'low')]);
  assert.equal(allLow.passed, false);
  assert.equal(allLow.metrics.highConfidenceExactPrecision, 0);

  const repeated = Array.from({ length: 9 }, (_, index) => ({ ...evaluate([gold]), id: `a-${index}` }));
  const wrongTemplate = { ...evaluate([], 'high', { resolved: false }), id: 'b-1', templateKey: 'B' };
  const macroGate = benchmark.assessSemanticGateThresholds([...repeated, wrongTemplate], {
    exactSetAccuracy: 0.8,
    templateMacroAccuracy: 0.9,
  });
  assert.equal(macroGate.metrics.exactSetAccuracy, 0.9);
  assert.equal(macroGate.metrics.templateMacroAccuracy, 0.5);
  assert.equal(macroGate.passed, false);
});

test('current correction scope distinguishes completed litigation withdrawal from active proceedings', async () => {
  const { extractEventsGatedProjection } = await import(MODULE);
  const withdrawn = canonicalEvent('legal-regulatory', 'withdrawn', 'effective', 'litigation', 'issuer');
  const active = canonicalEvent('legal-regulatory', 'updated', 'active', 'litigation', 'issuer');
  const cases = [
    {
      id: 'formal-withdrawal-under-correction-content-heading',
      bodyText: '정정 내용 | 당사는 이 사건 청구를 철회하였으며 법원 접수가 완료됐습니다',
      expectedEvents: [withdrawn],
    },
    {
      id: 'withdrawal-intent-does-not-end-current-proceeding',
      bodyText: '정정 내용 | 다음 기일 뒤 취하를 검토할 예정이며 현재 재판은 계속 진행합니다',
      expectedEvents: [active],
    },
    {
      id: 'rejected-withdrawal-remains-active',
      bodyText: '정정 내용 | 취하 신청을 냈으나 재판부가 기각하여 사건은 계속됩니다',
      expectedEvents: [active],
    },
    {
      id: 'issuer-clause-wins-over-counterparty-denial',
      bodyText: '정정 내용 | 상대방이 본소를 철회한 것은 아니지만 당사는 반소를 취하했고 접수를 마쳤습니다',
      expectedEvents: [withdrawn],
    },
    {
      id: 'natural-language-withdrawal-perfective',
      bodyText: '소송 정정 | 회사는 다툼 중인 신청을 거두어들였고 그 부분의 심리는 종료됐습니다',
      expectedEvents: [withdrawn],
    },
    {
      id: 'negated-reversal-preserves-completed-withdrawal',
      bodyText: '정정 내용 | 당사는 취하 결정을 번복하지 않고 예정대로 철회했으며 접수도 완료했습니다',
      expectedEvents: [withdrawn],
    },
    {
      id: 'counterparty-withdrawal-does-not-end-issuer-claim',
      bodyText: '정정 내용 | 당사는 본안 청구를 유지합니다 | 상대방은 반소를 취하했고 법원 접수를 마쳤습니다',
      expectedEvents: [active],
    },
    {
      id: 'natural-language-withdrawal-negation-stays-active',
      bodyText: '정정 내용 | 회사는 이 신청을 거두어들이지 않기로 확정했습니다',
      expectedEvents: [active],
    },
    {
      id: 'natural-language-withdrawal-plan-stays-active',
      bodyText: '정정 내용 | 당사는 향후 이 청구를 거두어들일 계획입니다',
      expectedEvents: [active],
    },
    {
      id: 'withdrawal-deliberation-without-proof-stays-active',
      bodyText: '정정 내용 | 당사는 취하 여부를 협의 중이며 아직 아무 결정도 내리지 않았습니다',
      expectedEvents: [active],
    },
    {
      id: 'withdrawal-request-retraction-keeps-claim-active',
      bodyText: '정정 내용 | 당사는 취하 요청을 철회하고 본안 청구를 유지하기로 했습니다',
      expectedEvents: [active],
    },
    {
      id: 'historical-litigation-section-does-not-overwrite-current',
      bodyText: '정정 내용 | 당사는 현재 청구를 유지합니다 | 과거 소송 내역 | 당사는 별개의 예전 소송을 취하했습니다',
      expectedEvents: [active],
    },
    {
      id: 'counterparty-company-claim-does-not-invalidate-issuer-completion',
      bodyText: '정정 내용 | 당사는 청구를 취하해 접수를 완료했습니다 | 상대방 회사는 취하가 무효라고 주장했습니다',
      expectedEvents: [withdrawn],
    },
  ];
  const failures = cases.flatMap(({ id, bodyText, expectedEvents }) => {
    const actual = extractEventsGatedProjection({
      reportName: '[기재정정]소송 등의 제기·신청',
      disclosureDetailType: 'C001',
      filedAt: '2028-06-03',
      bodyText,
    });
    return JSON.stringify(eventSet(actual.events)) === JSON.stringify(eventSet(expectedEvents))
      ? []
      : [{ id, expected: eventSet(expectedEvents), actual: eventSet(actual.events) }];
  });
  assert.deepEqual(failures, []);
});

test('actuality roles combine current signature, settlement, and transfer evidence without historical leakage', async () => {
  const { extractEventsGatedProjection } = await import(MODULE);
  const contracted = canonicalEvent('capital-change', 'contracted', 'effective', 'treasury-share-trust', 'securities');
  const trustProposed = canonicalEvent('capital-change', 'decided', 'proposed', 'treasury-share-trust', 'securities');
  const acquired = canonicalEvent('capital-change', 'acquired', 'effective', 'convertible-bond', 'securities');
  const bondProposed = canonicalEvent('capital-change', 'decided', 'proposed', 'convertible-bond', 'securities');
  const cases = [
    {
      id: 'trust-seal-completed-on-contract-date',
      input: {
        reportName: '주요사항보고서(자기주식취득신탁계약체결결정)',
        filedAt: '2028-06-03',
        bodyText: '계약일 | 2028-06-03 | 수탁사와 계약서 서명과 날인을 모두 마쳐 즉시 효력이 발생합니다',
      },
      expectedEvents: [contracted],
    },
    {
      id: 'current-trust-section-excludes-later-history',
      input: {
        reportName: '주요사항보고서(자기주식취득신탁계약체결결정)',
        filedAt: '2028-06-03',
        bodyText: '금번 신탁계약 | 2028-06-03 은행과 서명 절차를 끝냈습니다 | 지난 계약 참고 | 2027-05-01 종료 예정',
      },
      expectedEvents: [contracted],
    },
    {
      id: 'historical-trust-completion-does-not-cross-current-heading',
      input: {
        reportName: '주요사항보고서(자기주식취득신탁계약체결결정)',
        filedAt: '2028-06-03',
        bodyText: '종전 계약 현황 | 2027-05-01 날인을 완료 | 금번 계약 현황 | 계약 예정일 2028-07-01 | 현재 협의 중',
      },
      expectedEvents: [trustProposed],
    },
    {
      id: 'same-day-trust-completion-plan-stays-proposed',
      input: {
        reportName: '주요사항보고서(자기주식취득신탁계약체결결정)',
        filedAt: '2028-06-03',
        bodyText: '계약일 | 2028-06-03 | 계약서 서명과 날인을 오늘 완료할 예정입니다',
      },
      expectedEvents: [trustProposed],
    },
    {
      id: 'negated-trust-seal-stays-proposed',
      input: {
        reportName: '주요사항보고서(자기주식취득신탁계약체결결정)',
        filedAt: '2028-06-03',
        bodyText: '계약일 | 2028-06-03 | 계약서 날인을 완료하지 못했고 현재 협의 중입니다',
      },
      expectedEvents: [trustProposed],
    },
    {
      id: 'unrelated-minutes-signature-stays-proposed',
      input: {
        reportName: '주요사항보고서(자기주식취득신탁계약체결결정)',
        filedAt: '2028-06-03',
        bodyText: '계약일 | 2028-06-03 | 이사회 의사록 서명을 완료했으나 신탁계약은 아직 협의 중입니다',
      },
      expectedEvents: [trustProposed],
    },
    {
      id: 'historical-trust-heading-stays-proposed',
      input: {
        reportName: '주요사항보고서(자기주식취득신탁계약체결결정)',
        filedAt: '2028-06-03',
        bodyText: '금번 신탁계약 | 계약 예정일 2028-06-03 | 현재 협의 중 | 과거 신탁계약 내역 | 2027-05-01 계약서 날인 완료',
      },
      expectedEvents: [trustProposed],
    },
    {
      id: 'later-writing-example-does-not-poison-real-trust-completion',
      input: {
        reportName: '주요사항보고서(자기주식취득신탁계약체결결정)',
        filedAt: '2028-06-03',
        bodyText: '계약일 | 2028-06-03 | 은행과 신탁계약 체결을 완료하였습니다 | 작성예시 | 계약서 서명 완료',
      },
      expectedEvents: [contracted],
    },
    {
      id: 'bond-transfer-before-final-settlement',
      input: {
        reportName: '주요사항보고서(자기전환사채만기전취득결정)',
        filedAt: '2028-06-03',
        bodyText: '실제 취득일 | 2028-06-03 | 전환사채를 인도받은 후 잔금 전액 정산도 끝냈습니다',
      },
      expectedEvents: [acquired],
    },
    {
      id: 'bond-current-completion-excludes-future-history',
      input: {
        reportName: '주요사항보고서(자기전환사채만기전취득결정)',
        filedAt: '2028-06-03',
        bodyText: '이번 거래 | 2028-06-03 대금을 전액 결제하고 사채 전부를 인수 완료 | 과거 검토자료 | 2029-01-01 지급 예정 사례',
      },
      expectedEvents: [acquired],
    },
    {
      id: 'bond-payment-only-retains-proposed-state',
      input: {
        reportName: '주요사항보고서(자기전환사채만기전취득결정)',
        filedAt: '2028-06-03',
        bodyText: '결제일 | 2028-06-03 | 대금은 전액 정산했지만 채권 인도는 다음 주 예정입니다',
      },
      expectedEvents: [bondProposed],
    },
    {
      id: 'same-day-bond-completion-plan-stays-proposed',
      input: {
        reportName: '주요사항보고서(자기전환사채만기전취득결정)',
        filedAt: '2028-06-03',
        bodyText: '결제일 | 2028-06-03 | 대금 결제 완료 및 채권 인수 완료 예정',
      },
      expectedEvents: [bondProposed],
    },
    {
      id: 'partial-bond-settlement-and-transfer-stay-proposed',
      input: {
        reportName: '주요사항보고서(자기전환사채만기전취득결정)',
        filedAt: '2028-06-03',
        bodyText: '결제일 | 2028-06-03 | 대금 일부 결제를 완료하고 채권 일부를 인수 완료',
      },
      expectedEvents: [bondProposed],
    },
    {
      id: 'bond-payment-incomplete-stays-proposed',
      input: {
        reportName: '주요사항보고서(자기전환사채만기전취득결정)',
        filedAt: '2028-06-03',
        bodyText: '실제 취득일 | 2028-06-03 | 대금 지급은 아직 완료되지 않았으나 전환사채 인수 완료',
      },
      expectedEvents: [bondProposed],
    },
    {
      id: 'bond-unpaid-after-transfer-stays-proposed',
      input: {
        reportName: '주요사항보고서(자기전환사채만기전취득결정)',
        filedAt: '2028-06-03',
        bodyText: '취득일 | 2028-06-03 | 전환사채를 취득하였으나 대금 전액은 미지급 상태입니다',
      },
      expectedEvents: [bondProposed],
    },
    {
      id: 'historical-bond-heading-does-not-complete-current-trade',
      input: {
        reportName: '주요사항보고서(자기전환사채만기전취득결정)',
        filedAt: '2028-06-03',
        bodyText: '이번 거래 | 2028-06-03 현재 대금 지급 및 사채 이전을 협의 중 | 과거 사채 거래 내역 | 2027-01-01 대금 결제 완료 후 사채 인수 완료',
      },
      expectedEvents: [bondProposed],
    },
    {
      id: 'unrelated-future-board-date-does-not-block-bond-completion',
      input: {
        reportName: '주요사항보고서(자기전환사채만기전취득결정)',
        filedAt: '2028-06-03',
        bodyText: '향후 이사회 예정일 2028-07-01 | 결제일 2028-06-03 | 대금 전액 결제 완료 후 전환사채 전부 인수 완료',
      },
      expectedEvents: [acquired],
    },
  ];
  const failures = cases.flatMap(({ id, input, expectedEvents }) => {
    const actual = extractEventsGatedProjection(input);
    return JSON.stringify(eventSet(actual.events)) === JSON.stringify(eventSet(expectedEvents))
      ? []
      : [{ id, expected: eventSet(expectedEvents), actual: eventSet(actual.events) }];
  });
  assert.deepEqual(failures, []);
});

test('litigation corrections accumulate independent equity schedule changes before lifecycle repair', async () => {
  const { extractEventsGatedProjection } = await import(MODULE);
  const equity = canonicalEvent('capital-change', 'rescheduled', 'pending', 'equity-securities', 'securities');
  const withdrawn = canonicalEvent('legal-regulatory', 'withdrawn', 'effective', 'litigation', 'issuer');
  const active = canonicalEvent('legal-regulatory', 'updated', 'active', 'litigation', 'issuer');
  const filler = '중립설명'.repeat(900);
  const cases = [
    {
      id: 'terminal-before-generalized-schedule-labels',
      bodyText: '정정 내용 | 당사 소송을 철회하고 접수를 마침 | 유상증자 일정 변경 | 변경 전 납입일 2028-07-01 | 변경 후 납입일 2028-07-20',
      litigation: withdrawn,
    },
    {
      id: 'schedule-before-active-litigation',
      bodyText: '주식 발행 일정 변경 | 종전 납입일 2028-07-01 | 새 납입일 2028-07-20 | 정정 내용 | 취하 신청이 반려되어 소송을 계속 진행합니다',
      litigation: active,
    },
    {
      id: 'neutral-distance-does-not-remove-second-intent',
      bodyText: `소송 정정 | 청구를 철회 완료 | ${filler} | 자금조달 정정 | 납입일을 2028-07-01에서 2028-07-30으로 변경`,
      litigation: withdrawn,
    },
  ];
  const failures = cases.flatMap(({ id, bodyText, litigation }) => {
    const expectedEvents = [equity, litigation];
    const actual = extractEventsGatedProjection({
      reportName: '[기재정정]소송등의제기ㆍ신청',
      disclosureDetailType: 'C001',
      filedAt: '2028-06-03',
      bodyText,
    });
    return JSON.stringify(eventSet(actual.events)) === JSON.stringify(eventSet(expectedEvents)) && actual.events.length === 2
      ? []
      : [{ id, expected: eventSet(expectedEvents), actual: eventSet(actual.events), cardinality: actual.events.length }];
  });
  assert.deepEqual(failures, []);
});

test('historical equity schedule references do not create a second current event', async () => {
  const { extractEventsGatedProjection } = await import(MODULE);
  const expectedEvents = [canonicalEvent('legal-regulatory', 'withdrawn', 'effective', 'litigation', 'issuer')];
  const variants = [
    '정정 내용 | 당사는 청구를 철회하고 법원 접수를 완료 | 참고자료 | 과거 유상증자 일정 변경 | 종전 납입일 2027-01-01 | 변경 납입일 2027-02-01',
    '정정 내용 | 당사는 청구를 철회하고 법원 접수를 완료 | 과거 증자 검토 자료 | 유상증자 일정 변경 | 변경 전 납입일 2027-01-01 | 변경 후 납입일 2027-02-01',
    '정정 내용 | 당사는 청구 취하 접수를 완료했습니다 | 유상증자 일정 변경 가능성을 검토 중 | 과거 증자 예시 | 변경 전 납입일 2027-01-01 | 변경 후 납입일 2027-02-01',
  ];
  for (const bodyText of variants) {
    const actual = extractEventsGatedProjection({
      reportName: '[기재정정]소송등의제기ㆍ신청',
      disclosureDetailType: 'C001',
      filedAt: '2028-06-03',
      bodyText,
    });
    assert.deepEqual(eventSet(actual.events), eventSet(expectedEvents));
    assert.equal(actual.events.length, 1);
  }
});

test('equity schedule synonym still accumulates as an independent current event', async () => {
  const { extractEventsGatedProjection } = await import(MODULE);
  const expectedEvents = [
    canonicalEvent('legal-regulatory', 'withdrawn', 'effective', 'litigation', 'issuer'),
    canonicalEvent('capital-change', 'rescheduled', 'pending', 'equity-securities', 'securities'),
  ];
  const actual = extractEventsGatedProjection({
    reportName: '[기재정정]소송등의제기ㆍ신청',
    disclosureDetailType: 'C001',
    filedAt: '2028-06-03',
    bodyText: '정정 내용 | 당사는 청구 취하 접수를 완료했습니다 | 유상증자의 납입기일을 2028-07-01에서 2028-07-20으로 바꾸었습니다',
  });
  assert.deepEqual(eventSet(actual.events), eventSet(expectedEvents));
  assert.equal(actual.events.length, 2);
});

test('regulatory product withdrawal accepts approval synonyms and explicit retraction proof', async () => {
  const { extractEventsGatedProjection } = await import(MODULE);
  const expectedEvents = [canonicalEvent('regulatory-product', 'withdrawn', 'cancelled', 'product-approval', 'product')];
  const cases = [
    {
      id: 'medicine-approval-title-with-agency-receipt',
      input: {
        reportName: '투자판단 관련 주요경영사항 (의약품 허가신청 자진 철회)',
        filedAt: '2028-06-03',
        bodyText: '철회 확정일 2028-06-03 | 관계기관 접수 완료',
      },
    },
    {
      id: 'product-approval-retraction-in-remarks',
      input: {
        reportName: '투자판단 관련 주요경영사항',
        remarks: '신약 품목허가 신청을 자진 철회하기로 확정',
        filedAt: '2028-06-03',
        bodyText: '기관 제출일 2028-06-03',
      },
    },
    {
      id: 'new-drug-approval-withdrawal-accepted-by-agency',
      input: {
        reportName: '투자판단 관련 주요경영사항',
        filedAt: '2028-06-03',
        bodyText: '신약 허가 신청 철회서를 식약처가 2028-06-03 수리하여 신청 절차가 종료됐습니다',
      },
    },
    {
      id: 'product-withdrawal-form-accepted-by-agency',
      input: {
        reportName: '투자판단 관련 주요경영사항',
        filedAt: '2028-06-03',
        bodyText: '품목허가 신청을 철회하였고 식약처가 철회서를 수리했습니다',
      },
    },
  ];
  const failures = cases.flatMap(({ id, input }) => {
    const actual = extractEventsGatedProjection(input);
    return JSON.stringify(eventSet(actual.events)) === JSON.stringify(eventSet(expectedEvents))
      ? []
      : [{ id, expected: eventSet(expectedEvents), actual: eventSet(actual.events) }];
  });
  assert.deepEqual(failures, []);
});

test('regulatory product withdrawal requires current affirmative terminal proof', async () => {
  const { extractEventsGatedProjection } = await import(MODULE);
  const cases = [
    {
      id: 'future-review',
      bodyText: '품목허가 신청 자진 철회를 검토 중 | 철회 공문 기관 제출일 2028-07-01 예정',
    },
    {
      id: 'explicit-negation',
      bodyText: '품목허가 신청은 자진 철회하지 않기로 결정 | 기관 제출일 2028-06-03은 기존 보완자료 제출일입니다',
    },
    {
      id: 'rejected-request',
      bodyText: '품목허가 신청의 자진 철회 요청이 관계기관에서 반려됨 | 기관 제출일 2028-06-03',
    },
    {
      id: 'reversed-decision',
      bodyText: '품목허가 신청을 자진 철회하기로 결정했으나 결정을 번복하고 허가 절차를 유지합니다 | 기관 제출일 2028-06-03',
    },
    {
      id: 'historical-withdrawal',
      bodyText: '현재 품목허가 신청 절차는 유지 중입니다 | 과거 제품 이력 | 이전 품목허가 신청은 자진 철회 완료',
    },
  ];
  const failures = cases.flatMap(({ id, bodyText }) => {
    const actual = extractEventsGatedProjection({
      reportName: '투자판단 관련 주요경영사항',
      filedAt: '2028-06-03',
      bodyText,
    });
    return actual.events.some((event) => event.type === 'regulatory-product' && event.action === 'withdrawn')
      ? [{ id, actual: eventSet(actual.events) }]
      : [];
  });
  assert.deepEqual(failures, []);
});

test('round 2 independent semantic audit preserves current actors, actuality roles, and sibling cardinality', async () => {
  const { extractEventsGatedProjection } = await import(MODULE);
  const litigation = (action, state) => canonicalEvent('legal-regulatory', action, state, 'litigation', 'issuer');
  const trust = (action, state) => canonicalEvent('capital-change', action, state, 'treasury-share-trust', 'securities');
  const bond = (action, state) => canonicalEvent('capital-change', action, state, 'convertible-bond', 'securities');
  const equity = canonicalEvent('capital-change', 'rescheduled', 'pending', 'equity-securities', 'securities');
  const product = canonicalEvent('regulatory-product', 'withdrawn', 'cancelled', 'product-approval', 'product');
  const litigationInput = (bodyText) => ({
    reportName: '[기재정정]소송등의제기ㆍ신청',
    disclosureDetailType: 'C001',
    filedAt: '2031-09-18',
    bodyText,
  });
  const trustInput = (bodyText) => ({
    reportName: '주요사항보고서(자기주식취득신탁계약체결결정)',
    filedAt: '2031-09-18',
    bodyText,
  });
  const bondInput = (bodyText) => ({
    reportName: '주요사항보고서(자기전환사채만기전취득결정)',
    filedAt: '2031-09-18',
    bodyText,
  });
  const productInput = (bodyText) => ({
    reportName: '투자판단 관련 주요경영사항',
    filedAt: '2031-09-18',
    bodyText,
  });
  const withdrawn = litigation('withdrawn', 'effective');
  const active = litigation('updated', 'active');
  const cases = [
    ['litigation-completion-morphology', litigationInput('3. 정정사항 | 원고인 당사는 신청 전부를 취하하여 전자소송 기록에 반영되었습니다'), [withdrawn]],
    ['litigation-history-heading', litigationInput('3. 정정사항 | 당사는 현 사건의 청구취지를 유지하고 있습니다 | 별건 처리 연혁 | 2029년 당사가 제기한 다른 사건은 소를 취하했습니다'), [active]],
    ['litigation-final-positive-wins', litigationInput('3. 정정사항 | 당사는 취하하지 않겠다는 종전 입장을 폐기하고 금일 본소를 취하했습니다'), [withdrawn]],
    ['trust-electronic-agreement', trustInput('계약일 | 2031-09-18 | 수탁은행과 전자약정 체결을 종결하여 그 시점부터 효력이 생겼습니다'), [trust('contracted', 'effective')]],
    ['trust-history-performance', trustInput('이번 안건 | 계약 예정일 2031-09-18 | 약정 조건을 협상하고 있습니다 | 종전 집행 실적 | 2030-04-02 은행과 계약서 날인을 완료했습니다'), [trust('decided', 'proposed')]],
    ['trust-template-after-current', trustInput('계약일 | 2031-09-18 | 수탁은행과 계약서 날인 절차를 끝냈습니다 | 별첨 기재 견본 | 서명 완료 예정이라고 작성할 수 있음'), [trust('contracted', 'effective')]],
    ['trust-unrelated-bank-document', trustInput('계약일 | 2031-09-18 | 은행 제출용 잔액확인서 날인을 완료했습니다 | 신탁 약정서는 양측 미서명 상태입니다'), [trust('decided', 'proposed')]],
    ['bond-full-payment-and-rights-transfer', bondInput('거래일 | 2031-09-18 | 매매대금을 완납했고 전자등록 사채의 권리를 넘겨받아 명의가 이전되었습니다'), [bond('acquired', 'effective')]],
    ['bond-old-round-history', bondInput('이번 안건 | 취득결정일 2031-09-18 | 실제 인수와 지급은 2031-10-20에 실행할 계획입니다 | 직전 회차 거래 요약 | 2030-08-01 대금 지급 완료 및 사채 인수 완료'), [bond('decided', 'proposed')]],
    ['bond-half-quantity', bondInput('결제일 | 2031-09-18 | 대금 결제를 완료했고 채권의 절반만 인수했습니다'), [bond('decided', 'proposed')]],
    ['bond-reversed-evidence-order', bondInput('결제일 | 2031-09-18 | 채권 인수를 마친 뒤 매매대금 전액을 결제했습니다'), [bond('acquired', 'effective')]],
    ['multi-payment-deadline', litigationInput('3. 정정사항 | 당사는 본소를 취하해 사건 종결 통지를 받았습니다 | 유상증자 자금 납부기한을 2031-10-02에서 2031-10-27로 옮겼습니다'), [equity, withdrawn]],
    ['multi-adjusted-label-pair', litigationInput('3. 정정사항 | 당사는 이 청구를 계속 수행합니다 | 주식발행 일정 조정 | 당초 주금 납입기일 2031-10-02 | 조정 주금 납입기일 2031-10-27'), [equity, active]],
    ['multi-current-two-actions', litigationInput('3. 정정사항 | 자금조달 납입일을 2031-10-02에서 2031-10-30으로 조정했습니다 | 당사는 본소를 취하하여 사건번호에서 말소되었습니다'), [equity, withdrawn]],
    ['multi-archived-schedule', litigationInput('3. 정정사항 | 회사는 현 청구를 계속 유지합니다 | 부록: 전년도 자금조달 변경 기록 | 유상증자 납입일을 2030-05-01에서 2030-05-21로 변경했습니다'), [active]],
    ['multi-hypothetical-scenario', litigationInput('3. 정정사항 | 당사는 청구를 취하했고 법원의 종결 안내를 수령했습니다 | 내부 시나리오: 유상증자 납입일을 2031-10-02에서 2031-11-01로 변경할 수도 있음'), [withdrawn]],
    ['multi-original-revised-labels', litigationInput('3. 정정사항 | 당사의 소송 취하 처리가 확정되었습니다 | 유상증자 일정 개편 | 당초 납입일 2031-10-02 | 개정 납입일 2031-10-25'), [equity, withdrawn]],
    ['product-agency-processed', productInput('의약품 품목허가 신청 취하 신고가 규제기관에서 처리되어 해당 심사 건이 종결되었습니다'), [product]],
    ['product-abandonment-form', productInput('신약 품목허가 신청 포기서를 규제기관에 제출했고 수리 통보를 받았습니다'), [product]],
  ];
  const mustNotEmit = [
    ['product-sent-then-recalled', productInput('품목허가 신청 철회서를 기관에 발송했고 같은 날 제출을 취소하여 서류를 회수했습니다 | 심사는 계속됩니다')],
    ['product-closed-project-history', productInput('현재 신약 허가 신청은 보완자료 검토 단계입니다 | 종료된 개발과제 | 2028년 다른 품목허가 신청은 자진 철회를 완료했습니다')],
    ['product-training-example', productInput('현재 품목허가 신청은 심사관 질의에 답변 중입니다 | 교육용 문구 | 품목허가 신청 철회 완료라고 기재하는 사례')],
  ];

  const failures = cases.flatMap(([id, input, expectedEvents]) => {
    const actual = extractEventsGatedProjection(input);
    return JSON.stringify(eventSet(actual.events)) === JSON.stringify(eventSet(expectedEvents))
      ? []
      : [{ id, expected: eventSet(expectedEvents), actual: eventSet(actual.events) }];
  });
  for (const [id, input] of mustNotEmit) {
    const actual = extractEventsGatedProjection(input);
    if (actual.events.some((event) => event.type === product.type && event.action === product.action)) {
      failures.push({ id, expected: 'no regulatory-product withdrawal', actual: eventSet(actual.events) });
    }
  }
  assert.deepEqual(failures, []);
});

test('round 3 independent semantic audit re-enters current spans and merges intent lifecycles', async () => {
  const { extractEventsGatedProjection } = await import(MODULE);
  const withdrawn = canonicalEvent('legal-regulatory', 'withdrawn', 'effective', 'litigation', 'issuer');
  const contracted = canonicalEvent('capital-change', 'contracted', 'effective', 'treasury-share-trust', 'securities');
  const acquired = canonicalEvent('capital-change', 'acquired', 'effective', 'convertible-bond', 'securities');
  const bondProposed = canonicalEvent('capital-change', 'decided', 'proposed', 'convertible-bond', 'securities');
  const equity = canonicalEvent('capital-change', 'rescheduled', 'pending', 'equity-securities', 'securities');
  const accident = canonicalEvent('legal-regulatory', 'occurred', null, 'serious-industrial-accident', 'issuer');
  const cases = [
    {
      id: 'litigation-current-span-after-history',
      input: { reportName: '[기재정정]소송등의제기ㆍ신청', bodyText: '3. 정정내용 | 과거 사건 이력 | 당시에는 청구를 유지하고 심리를 계속함 | 이번 안건 | 당사는 이번 청구를 취하했고 재판부의 종결 처리를 확인함' },
      expectedEvents: [withdrawn],
    },
    {
      id: 'litigation-invalidation-double-negative',
      input: { reportName: '[기재정정]소송등의제기ㆍ신청', bodyText: '3. 정정사항 | 당사는 청구 취하를 완료했습니다. 해당 취하가 무효로 된 것은 아니고 법원의 종국 안내까지 도달했습니다.' },
      expectedEvents: [withdrawn],
    },
    {
      id: 'trust-attributive-completion',
      input: { reportName: '주요사항보고서(자기주식취득신탁계약체결결정)', filedAt: '2027-06-11', bodyText: '계약일 | 2027.06.10 | 신탁계약서에는 당사와 수탁은행의 인감 날인을 모두 마친 상태입니다.' },
      expectedEvents: [contracted],
    },
    {
      id: 'trust-current-span-after-history',
      input: { reportName: '주요사항보고서(자기주식취득신탁계약체결결정)', filedAt: '2027-06-11', bodyText: '과거 계약 내역 | 2025년 계약은 서명 없이 종료 | 금번 신탁계약 현황 | 계약체결일 2027.06.11 | 신탁약정서를 수탁사와 날인까지 끝냈습니다' },
      expectedEvents: [contracted],
    },
    {
      id: 'bond-account-transfer-and-completion',
      input: { reportName: '자기전환사채만기전취득결정', filedAt: '2027-06-11', bodyText: '대금 지급일 | 2027.06.11 | 매매대금을 전부 결제하였고 대상 전환사채는 당사 증권계좌로 대체되어 취득을 마쳤습니다.' },
      expectedEvents: [acquired],
    },
    {
      id: 'bond-passive-rights-transfer-before-payment',
      input: { reportName: '자기전환사채만기전취득결정', filedAt: '2027-06-11', bodyText: '실제 사채 취득일 | 2027.06.10 | 전환사채 권리와 명의가 먼저 당사로 이전되었습니다 | 이어서 2027.06.11 매매대금을 전액 완납했습니다.' },
      expectedEvents: [acquired],
    },
    {
      id: 'bond-relative-future-balance',
      input: { reportName: '자기전환사채만기전취득결정', filedAt: '2027-06-11', bodyText: '사채 취득일 | 2027.06.11 | 전환사채 실물은 인도받았으나 매매대금 잔액은 다음 주에 지급하기로 했습니다.' },
      expectedEvents: [bondProposed],
    },
    {
      id: 'multi-replaces-generic-capital-lifecycle',
      input: { reportName: '[기재정정]소송등의제기ㆍ신청(유상증자 일정)', disclosureDetailType: 'C001', filedAt: '2027-06-11', bodyText: '3. 정정내용 | 당사가 소취하 접수를 마치고 사건 종결 통지를 받음 | 유상증자 일정에서 자금 납입기일을 2027.06.28에서 2027.07.30으로 옮겼음' },
      expectedEvents: [equity, withdrawn],
    },
    {
      id: 'accident-jurisdictional-agency-order',
      input: { reportName: '중대재해발생(자율공시)', bodyText: '현장 사고가 발생했습니다 | 관할청이 해당 라인에 작업정지 명령을 내려 즉시 가동을 멈췄습니다.' },
      expectedEvents: [accident, canonicalEvent('operating-status', 'halted', 'effective', 'regulatory-work-stop', 'business')],
    },
    {
      id: 'accident-labor-authority-order-dedupes',
      input: { reportName: '중대재해발생(자율공시)', bodyText: '사고 발생을 확인함 | 고용당국이 공정 A에 작업중지 조치를 통보함 | 같은 명령에 따라 인접 공정도 작업정지 조치를 이행함' },
      expectedEvents: [accident, canonicalEvent('operating-status', 'halted', 'effective', 'regulatory-work-stop', 'business')],
    },
    {
      id: 'accident-voluntary-stop-is-not-regulatory-order',
      input: { reportName: '중대재해발생(자율공시)', bodyText: '사고 사실을 확인했습니다 | 회사는 자체 안전점검을 위해 설비를 잠시 세웠으나 행정기관의 작업정지 명령은 없습니다.' },
      expectedEvents: [accident],
    },
    {
      id: 'accident-current-denial-excludes-historical-order',
      input: { reportName: '중대재해발생(자율공시)', bodyText: '이번 안건 | 금일 사고가 발생했고 관계기관 조사는 진행 중이나 작업정지 명령은 아직 없음 | 과거 참고 자료 | 전년도 사고 때 작업중지 조치를 받은 바 있음' },
      expectedEvents: [accident],
    },
  ];
  const failures = cases.flatMap(({ id, input, expectedEvents }) => {
    const actual = extractEventsGatedProjection(input);
    return JSON.stringify(eventSet(actual.events)) === JSON.stringify(eventSet(expectedEvents))
      ? []
      : [{ id, expected: eventSet(expectedEvents), actual: eventSet(actual.events) }];
  });
  assert.deepEqual(failures, []);
});

test('round 4 independent semantic audit binds actors, objects, ordered polarity, and current islands', async () => {
  const { extractEventsGatedProjection } = await import(MODULE);
  const withdrawn = canonicalEvent('legal-regulatory', 'withdrawn', 'effective', 'litigation', 'issuer');
  const active = canonicalEvent('legal-regulatory', 'updated', 'active', 'litigation', 'issuer');
  const contracted = canonicalEvent('capital-change', 'contracted', 'effective', 'treasury-share-trust', 'securities');
  const acquired = canonicalEvent('capital-change', 'acquired', 'effective', 'convertible-bond', 'securities');
  const bondProposed = canonicalEvent('capital-change', 'decided', 'proposed', 'convertible-bond', 'securities');
  const equity = canonicalEvent('capital-change', 'rescheduled', 'pending', 'equity-securities', 'securities');
  const accident = canonicalEvent('legal-regulatory', 'occurred', null, 'serious-industrial-accident', 'issuer');
  const workStop = canonicalEvent('operating-status', 'halted', 'effective', 'regulatory-work-stop', 'business');
  const cases = [
    ['litigation-counterparty-continuation', { reportName: '[기재정정] 소송등의제기', filedAt: '20260720', bodyText: '3. 정정사유 | 이번 안건 | 당사는 청구를 철회하여 법원 기록에 반영됐습니다. 상대방 회사는 별도 반소를 계속합니다.' }, [withdrawn]],
    ['litigation-withdrawal-request-retracted', { reportName: '[기재정정] 소송등의제기', filedAt: '20260720', bodyText: '3. 정정사항 | 이번 안건 | 당사는 법원에 보낸 취하 요청을 다시 철회했고 본안 절차를 이어가기로 했습니다.' }, [active]],
    ['trust-old-negative-then-current-complete', { reportName: '자기주식취득신탁계약체결결정', filedAt: '20260720', bodyText: '이번 계약 | 계약체결일 2026년 7월 19일 | 당초 초안은 미날인이었으나 현재 전자약정 체결 절차를 모두 끝냈습니다. | 직전 계약 기록 | 당시에는 계약 예정이었습니다.' }, [contracted]],
    ['trust-current-island-carries-date', { reportName: '자기주식취득신탁계약체결결정', filedAt: '20260720', bodyText: '금번 계약 | 계약기간 시작일 2026년 7월 20일 | 문서 초안에는 미서명으로 표시됐습니다. | 현재 계약 | 수탁기관과 당사는 전자약정을 체결하였고 효력이 발생했습니다.' }, [contracted]],
    ['trust-history-between-current-islands', { reportName: '자기주식취득신탁계약체결결정', filedAt: '20260720', bodyText: '금번 계약 | 계약일 2026년 7월 20일 | 당사와 수탁기관은 서명 일정을 논의 중입니다. | 과거 계약 내역 | 양측 날인 완료. | 이번 계약 | 전자계약서에 양측 서명을 마치고 계약 효력이 생겼습니다.' }, [contracted]],
    ['bond-third-party-roles-do-not-bind-issuer', { reportName: '자기전환사채만기전취득결정', filedAt: '20260720', bodyText: '현재 거래 | 지급일 2026년 7월 20일 | 관계회사가 매도인에게 대금을 완납했고 관계회사 명의로 채권을 넘겨받았습니다. 당사는 아직 인수하지 않았습니다.' }, [bondProposed]],
    ['bond-old-nonpayment-then-complete', { reportName: '자기전환사채만기전취득결정', filedAt: '20260720', bodyText: '금번 거래 | 지급일 2026년 7월 20일 | 오전 초안에는 미지급으로 기재됐으나 오후에 잔금까지 완납했고 전환사채를 모두 넘겨받았습니다.' }, [acquired]],
    ['bond-passive-payment-and-ownership', { reportName: '자기전환사채만기전취득결정', filedAt: '20260720', bodyText: '현재 거래 | 정산일 2026년 7월 20일 | 매매대금이 전액 완납되었고 전환사채의 소유권이 당사에 귀속되었습니다.' }, [acquired]],
    ['multi-current-islands-with-schedule', { reportName: '[기재정정] 소송등의제기', filedAt: '20260720', bodyText: '3. 정정내용 | 현재 거래 | 당사는 소송 절차를 계속합니다. | 과거 이력 | 유상증자 납부기한 2025년 3월 2일에서 2025년 3월 22일로 조정. | 이번 안건 | 유상증자 자금 납부기한을 원래 2026년 7월 26일에서 새 기한 2026년 9월 3일로 개편했습니다.' }, [equity, active]],
    ['work-stop-review-without-order', { reportName: '중대재해발생', filedAt: '20260720', bodyText: '현재 사고 | 감독기관이 작업정지 조치를 검토하고 있으나 아직 발령하거나 통보한 사실은 없습니다.' }, [accident]],
    ['work-stop-order-cancelled', { reportName: '중대재해발생', filedAt: '20260720', bodyText: '금번 사고 | 고용당국의 작업중지 명령을 처음 통보받았지만 재검토 결과 당일 그 명령이 취소되어 효력이 없습니다.' }, [accident]],
    ['work-stop-later-order-wins', { reportName: '중대재해발생', filedAt: '20260720', bodyText: '이번 사고 | 오전에는 작업정지 명령이 없다고 안내됐으나 오후에 고용노동부가 당사 공정에 작업중지 명령을 발령했습니다.' }, [accident, workStop]],
    ['work-stop-third-party-target', { reportName: '중대재해발생', filedAt: '20260720', bodyText: '현재 사고 | 인접 협력업체 공장에는 관계기관의 작업정지 명령이 부과됐지만 당사 사업장에는 어떠한 명령도 없었습니다.' }, [accident]],
  ];
  const failures = cases.flatMap(([id, input, expectedEvents]) => {
    const actual = extractEventsGatedProjection(input);
    return JSON.stringify(eventSet(actual.events)) === JSON.stringify(eventSet(expectedEvents))
      ? []
      : [{ id, expected: eventSet(expectedEvents), actual: eventSet(actual.events) }];
  });
  const productObjectMismatch = extractEventsGatedProjection({
    reportName: '투자판단 관련 주요경영사항',
    filedAt: '20260720',
    bodyText: '이번 개발과제 | 당사는 임상시험계획 신청을 철회했지만 품목허가 신청은 그대로 유지하고 있습니다.',
  });
  if (productObjectMismatch.events.some((event) => event.type === 'regulatory-product' && event.action === 'withdrawn')) {
    failures.push({ id: 'product-withdrawal-object-mismatch', actual: eventSet(productObjectMismatch.events) });
  }
  assert.deepEqual(failures, []);
});

test('round 5 independent semantic audit separates aliases, follow-up plans, and regulatory actors', async () => {
  const { extractEventsGatedProjection } = await import(MODULE);
  const withdrawn = canonicalEvent('legal-regulatory', 'withdrawn', 'effective', 'litigation', 'issuer');
  const active = canonicalEvent('legal-regulatory', 'updated', 'active', 'litigation', 'issuer');
  const equity = canonicalEvent('capital-change', 'rescheduled', 'pending', 'equity-securities', 'securities');
  const acquired = canonicalEvent('capital-change', 'acquired', 'effective', 'convertible-bond', 'securities');
  const accident = canonicalEvent('legal-regulatory', 'occurred', null, 'serious-industrial-accident', 'issuer');
  const workStop = canonicalEvent('operating-status', 'halted', 'effective', 'regulatory-work-stop', 'business');
  const cases = [
    {
      id: 'equity-schedule-replaces-rights-offering-alias-after-withdrawal',
      input: {
        reportName: '[기재정정]소송등의제기 및 유상증자결정',
        filedAt: '2026-07-23',
        bodyText: '3. 정정사유 | 당사는 본건 소송을 취하하였고 법원 접수 완료를 확인했습니다. | 유상증자 일정 | 변경전 주금납입일 2026년 8월 10일 | 변경후 주금납입일 2026년 8월 26일 | 납입 일정을 변경 확정했습니다.',
      },
      expectedEvents: [equity, withdrawn],
    },
    {
      id: 'equity-schedule-replaces-rights-offering-alias-during-active-case',
      input: {
        reportName: '[기재정정]소송등의제기 및 유상증자결정',
        filedAt: '2026-07-23',
        bodyText: '3. 정정내용 | 상대방은 반소를 철회하여 접수했습니다. | 당사는 본안 청구를 계속 진행합니다. | 유상증자 일정 | 변경전 주금납입일 2026년 8월 10일 | 변경후 주금납입일 2026년 8월 26일 | 납입 일정을 변경 확정했습니다.',
      },
      expectedEvents: [equity, active],
    },
    {
      id: 'completed-bond-acquisition-survives-later-disposal-plan',
      input: {
        reportName: '자기전환사채만기전취득결정',
        filedAt: '2026-07-23',
        bodyText: '대금 지급일 | 2026년 7월 20일 | 대금 지급을 완료하고 전환사채를 인수했습니다. | 취득 완료 후 일부를 다음 달 재매각할 계획입니다.',
      },
      expectedEvents: [acquired],
    },
    {
      id: 'affiliate-order-release-does-not-release-issuer-order',
      input: {
        reportName: '중대재해발생',
        filedAt: '2026-07-23',
        bodyText: '중대재해가 발생했습니다. | 고용노동부는 당사 생산라인에 작업중지 명령을 발령했습니다. | 관계회사에 내려졌던 별도 작업정지 조치는 해제되었습니다.',
      },
      expectedEvents: [accident, workStop],
    },
  ];

  const failures = cases.flatMap(({ id, input, expectedEvents }) => {
    const actual = extractEventsGatedProjection(input);
    return JSON.stringify(eventSet(actual.events)) === JSON.stringify(eventSet(expectedEvents))
      ? []
      : [{ id, expected: eventSet(expectedEvents), actual: eventSet(actual.events) }];
  });
  assert.deepEqual(failures, []);
});

test('round 6 independent semantic audit supports heading-free corrections and sentence-bound actors', async () => {
  const { extractEventsGatedProjection } = await import(MODULE);
  const withdrawn = canonicalEvent('legal-regulatory', 'withdrawn', 'effective', 'litigation', 'issuer');
  const active = canonicalEvent('legal-regulatory', 'updated', 'active', 'litigation', 'issuer');
  const trust = canonicalEvent('capital-change', 'contracted', 'effective', 'treasury-share-trust', 'securities');
  const acquired = canonicalEvent('capital-change', 'acquired', 'effective', 'convertible-bond', 'securities');
  const equity = canonicalEvent('capital-change', 'rescheduled', 'pending', 'equity-securities', 'securities');
  const accident = canonicalEvent('legal-regulatory', 'occurred', null, 'serious-industrial-accident', 'issuer');
  const workStop = canonicalEvent('operating-status', 'halted', 'effective', 'regulatory-work-stop', 'business');
  const cases = [
    {
      id: 'heading-free-litigation-current-island',
      input: { reportName: '[기재정정] 소송등의제기ㆍ신청(경영권분쟁소송)', bodyText: '종전 공시 | 당사는 화해 가능성을 검토하며 취하할 계획이었습니다. | 금번 사건 | 당사는 청구를 유지하고 심리를 계속 수행하고 있습니다.' },
      expectedEvents: [active],
    },
    {
      id: 'heading-free-litigation-counterclaim',
      input: { reportName: '[기재정정] 소송등의제기ㆍ신청(경영권분쟁소송)', bodyText: '이번 사건 | 당사는 주위적 청구를 취하하여 접수가 완료되었습니다. 상대방은 별도의 반소 청구를 계속 유지하고 있습니다.' },
      expectedEvents: [withdrawn],
    },
    {
      id: 'heading-free-litigation-reentry-after-before-section',
      input: { reportName: '[기재정정] 소송등의제기ㆍ신청(경영권분쟁소송)', bodyText: '정정 전 | 상대방이 취하 의사를 밝혔습니다. | 이번 사건 | 당사는 청구 취하서를 제출했고 법원이 이를 접수하여 종결 처리했습니다.' },
      expectedEvents: [withdrawn],
    },
    {
      id: 'trust-final-contract-particle',
      input: { reportName: '자기주식취득 신탁계약 체결 결정', filedAt: '2026-07-23', bodyText: '종전 초안 | 수탁기관 날인 누락. | 현재 계약 | 2026년 7월 23일 양 당사자의 날인이 끝나 최종 계약서 체결이 완료되었습니다.' },
      expectedEvents: [trust],
    },
    {
      id: 'trust-original-exchange-completion',
      input: { reportName: '자기주식취득 신탁계약 체결 결정', filedAt: '2026-07-23', bodyText: '계약체결일 | 2026년 7월 21일 | 양측 서명과 원본 교환을 마쳐 신탁계약 체결 절차가 종료되었습니다.' },
      expectedEvents: [trust],
    },
    {
      id: 'trust-company-and-trustee-electronic-signature',
      input: { reportName: '자기주식취득 신탁계약 체결 결정', filedAt: '2026-07-23', bodyText: '현재 안건 | 계약체결일 2026년 7월 23일. | 과거 참고 | 초안은 미서명 상태였습니다. | 금번 계약 | 회사와 신탁사는 전자서명을 끝내 계약 체결을 완료했습니다.' },
      expectedEvents: [trust],
    },
    {
      id: 'bond-account-transfer-before-resale-plan',
      input: { reportName: '자기전환사채 만기전 취득 결정', filedAt: '2026-07-23', bodyText: '취득일 | 2026년 7월 23일 | 당사는 매매대금을 전액 지급했고 전환사채가 당사 증권계좌로 대체되었습니다. 취득 후 다음 달 재매각할 계획입니다.' },
      expectedEvents: [acquired],
    },
    {
      id: 'bond-settlement-and-rights-transfer-complete',
      input: { reportName: '자기전환사채 만기전 취득 결정', filedAt: '2026-07-23', bodyText: '실제 취득일 | 2026-07-22 | 잔금 정산과 사채 권리 이전이 모두 끝났습니다. 취득 완료 뒤 해당 사채를 소각할 예정입니다.' },
      expectedEvents: [acquired],
    },
    {
      id: 'bond-future-partial-disposal-is-not-partial-acquisition',
      input: { reportName: '자기전환사채 만기전 취득 결정', filedAt: '2026-07-23', bodyText: '정산일 | 2026년 7월 22일 | 당사는 대금 정산을 마쳤고 실물 사채 전부를 인도받았습니다. 향후 일부를 소각하는 방안을 검토합니다.' },
      expectedEvents: [acquired],
    },
    {
      id: 'inline-old-new-equity-schedule',
      input: { reportName: '[기재정정] 소송등의제기ㆍ신청', bodyText: '현재 사항 | 당사는 청구 취하서를 제출했고 법원 접수로 종결되었습니다. 주식발행 주금 납입기일은 종전 2026-08-05, 변경 후 2026-08-12입니다.' },
      expectedEvents: [equity, withdrawn],
    },
    {
      id: 'colon-separated-equity-schedule',
      input: { reportName: '[기재정정] 소송등의제기ㆍ신청', bodyText: '현재 사건 | 당사의 취하 요청은 반려되어 소송이 계속됩니다. 유상증자 납입일: 기존 2026년 8월 1일 / 수정 납입일: 2026년 8월 9일.' },
      expectedEvents: [equity, active],
    },
    {
      id: 'labor-office-work-stop',
      input: { reportName: '중대재해발생', bodyText: '당사 사업장에서 사고가 발생했습니다. 관할 노동관서는 당사의 혼합공정에 작업중지 명령을 내렸고 즉시 효력이 발생했습니다.' },
      expectedEvents: [accident, workStop],
    },
    {
      id: 'authority-negative-then-positive-work-stop',
      input: { reportName: '중대재해 발생', bodyText: '당사 물류센터에서 중대재해가 발생했습니다. 관계당국은 초기에 명령을 내리지 않았으나 현장 조사 후 당사 작업장에 작업중지 명령을 발령했습니다.' },
      expectedEvents: [accident, workStop],
    },
    {
      id: 'outsourcing-company-only-work-stop',
      input: { reportName: '중대재해발생', bodyText: '당사 현장에서 사고가 발생했습니다. 고용노동부는 인접한 외주업체 새길건설의 공정에만 작업중지 명령을 발령했으며 당사 공정은 대상이 아닙니다.' },
      expectedEvents: [accident],
    },
  ];

  const failures = cases.flatMap(({ id, input, expectedEvents }) => {
    const actual = extractEventsGatedProjection(input);
    return JSON.stringify(eventSet(actual.events)) === JSON.stringify(eventSet(expectedEvents))
      ? []
      : [{ id, expected: eventSet(expectedEvents), actual: eventSet(actual.events) }];
  });
  const thirdPartyProductWithdrawal = extractEventsGatedProjection({
    reportName: '투자판단 관련 주요경영사항',
    bodyText: '공동개발사 별빛바이오가 자기 명의의 품목허가 신청을 취하했습니다. 당사 명의의 신약허가 신청은 유지 중입니다.',
  });
  if (thirdPartyProductWithdrawal.events.some((event) => event.type === 'regulatory-product' && event.action === 'withdrawn')) {
    failures.push({ id: 'third-party-product-withdrawal', actual: eventSet(thirdPartyProductWithdrawal.events) });
  }
  assert.deepEqual(failures, []);
});

test('round 7 valid semantic contract accumulates explicit body intents under generic titles', async () => {
  const { extractEventsGatedProjection } = await import(MODULE);
  const active = canonicalEvent('legal-regulatory', 'updated', 'active', 'litigation', 'issuer');
  const withdrawn = canonicalEvent('legal-regulatory', 'withdrawn', 'effective', 'litigation', 'issuer');
  const trustProposed = canonicalEvent('capital-change', 'decided', 'proposed', 'treasury-share-trust', 'securities');
  const trustEffective = canonicalEvent('capital-change', 'contracted', 'effective', 'treasury-share-trust', 'securities');
  const bondProposed = canonicalEvent('capital-change', 'decided', 'proposed', 'convertible-bond', 'securities');
  const bondEffective = canonicalEvent('capital-change', 'acquired', 'effective', 'convertible-bond', 'securities');
  const product = canonicalEvent('regulatory-product', 'withdrawn', 'cancelled', 'product-approval', 'product');
  const accident = canonicalEvent('legal-regulatory', 'occurred', null, 'serious-industrial-accident', 'issuer');
  const workStop = canonicalEvent('operating-status', 'halted', 'effective', 'regulatory-work-stop', 'business');
  const equity = canonicalEvent('capital-change', 'rescheduled', 'pending', 'equity-securities', 'securities');
  const cases = [
    ['suffix-correction-litigation-active', { reportName: '소송 등의 제기·신청(정정)', bodyText: '[과거 경과] 2025년 제기한 물품대금 청구는 같은 해 취하했습니다. [금번 사건] 당사는 별도의 손해배상 청구를 제기했고 현재 변론기일을 기다리고 있습니다.' }, [active]],
    ['suffix-correction-litigation-withdrawn', { reportName: '소송 등의 제기·신청(정정)', bodyText: '[금번 정정] 당사는 법원에 소취하서를 제출하여 해당 손해배상 청구를 전부 취하하였습니다.' }, [withdrawn]],
    ['direct-trust-effective', { reportName: '자기주식취득 신탁계약 체결', filedAt: '2026-07-23', bodyText: '당사는 2026년 7월 23일 한국투자증권과 자기주식취득 신탁계약에 서명하고 계약 효력을 발생시켰습니다.' }, [trustEffective]],
    ['direct-trust-correction-effective', { reportName: '자기주식취득 신탁계약 체결(정정)', bodyText: '[종전 초안] 날인이 되지 않아 계약이 성립하지 않았습니다. [금번 계약] 양사는 오늘 전자서명을 완료했고 자기주식취득 신탁계약이 즉시 발효되었습니다.' }, [trustEffective]],
    ['direct-bond-effective', { reportName: '자기 전환사채 취득', filedAt: '2026-07-23', bodyText: '당사는 보유자로부터 자기 전환사채를 매수하여 대금을 전액 지급했고 사채권도 2026년 7월 23일 당사에 귀속되었습니다.' }, [bondEffective]],
    ['direct-bond-correction-effective', { reportName: '자기 전환사채 취득(정정)', bodyText: '[종전] 잔금 미지급으로 소유권이 이전되지 않았습니다. [금번] 오늘 잔금을 전액 완납했고 전환사채의 모든 권리가 당사에 이전되었습니다.' }, [bondEffective]],
    ['direct-product-withdrawal', { reportName: '의약품 품목허가 신청 취하', bodyText: '당사는 식품의약품안전처에 제출한 신약 품목허가 신청을 전부 취하했으며 접수 취소 처리가 완료되었습니다.' }, [product]],
    ['partial-indication-product-withdrawal', { reportName: '의약품 품목허가 신청 일부 취하', bodyText: '두 개 적응증 중 A 적응증에 대한 품목허가 신청은 취하 완료했고, B 적응증 신청은 유지합니다.' }, [product]],
    ['generic-trust-and-bond', { reportName: '기타 주요경영사항(자율공시)', bodyText: '[자기주식] 당사는 증권사와 자기주식취득 신탁계약의 서명과 날인을 완료해 계약이 발효되었습니다. [전환사채] 별도 보유자에게 취득대금을 전액 지급하고 자기 전환사채의 권리를 넘겨받았습니다.' }, [trustEffective, bondEffective]],
    ['generic-litigation-and-trust-proposal', { reportName: '기타 주요경영사항(자율공시)', bodyText: '[소송] 당사가 피고인 손해배상 사건은 현재 계속 중입니다. [자기주식] 이사회는 자기주식취득 신탁계약을 다음 달 체결하기로 결정했으며 아직 서명 전입니다.' }, [active, trustProposed]],
    ['generic-product-and-accident', { reportName: '주요 경영사항 공시', bodyText: '[의약품] 당사는 식약처 품목허가 신청을 전부 취하했고 취하 처리가 완료되었습니다. [안전사고] 오늘 당사 사업장에서 사망자 1명이 발생한 중대산업재해가 발생했습니다.' }, [product, accident]],
    ['generic-work-stop-and-equity-schedule', { reportName: '주요사항보고서(정정)', bodyText: '[행정처분] 관할 고용노동청이 당사 제2공장에 작업중지명령을 발령하여 즉시 효력이 발생했습니다. [유상증자] 납입일을 2026년 8월 1일에서 8월 20일로 변경했습니다.' }, [workStop, equity]],
    ['generic-three-independent-intents', { reportName: '기타 주요경영사항(자율공시)', bodyText: '[신탁] 증권사와 자기주식취득 신탁계약을 체결하고 효력을 발생시켰습니다. [전환사채] 이사회는 자기 전환사채 취득을 결정했으나 대금은 다음 달 지급합니다. [소송] 당사가 제기한 부당이득 반환 청구는 현재 심리 중입니다.' }, [trustEffective, bondProposed, active]],
    ['generic-product-object-mismatch-and-bond', { reportName: '기타 주요경영사항(자율공시)', bodyText: '[임상시험] 임상시험계획 승인 신청은 취하했지만 의약품 품목허가 신청은 그대로 유지합니다. [전환사채] 자기 전환사채 취득대금 전액 지급 및 권리 이전을 완료했습니다.' }, [bondEffective]],
    ['generic-third-party-trust-and-issuer-litigation', { reportName: '기타 주요경영사항(자율공시)', bodyText: '[관계회사] 관계회사가 자기주식취득 신탁계약을 체결했고 당사는 당사자가 아닙니다. [당사 소송] 당사는 오늘 기존 손해배상 청구를 전부 취하했습니다.' }, [withdrawn]],
    ['generic-history-current-trust-and-accident', { reportName: '주요 경영사항 공시', bodyText: '[과거 참고] 당사는 2021년 자기 전환사채를 취득했습니다. [금번 신탁] 오늘 자기주식취득 신탁계약 서명을 완료했습니다. [금번 사고] 당사 공장에서 사망 사고가 발생하여 중대산업재해로 조사 중입니다.' }, [trustEffective, accident]],
    ['generic-trust-and-bond-followups', { reportName: '기타 주요경영사항(자율공시)', bodyText: '[금번 안건] 이사회가 자기주식취득 신탁계약을 의결했습니다. [금번 후속] 오후에 증권사와 전자서명을 완료했습니다. [별도 안건] 자기 전환사채 잔금을 완납하고 권리 이전도 마쳤습니다.' }, [trustEffective, bondEffective]],
    ['generic-cancelled-work-stop-and-litigation', { reportName: '주요 경영사항 공시(정정)', bodyText: '[작업중지] 관할청이 오전에 작업중지명령을 발령했으나 같은 날 이를 직권 취소하여 현재 효력이 없습니다. [소송] 당사가 피고인 손해배상 청구는 현재 계속 중입니다.' }, [active]],
    ['generic-product-third-party-bond-and-trust', { reportName: '기타 주요경영사항(자율공시)', bodyText: '[의약품] 당사는 의약품 품목허가 신청을 취하하여 절차가 종료되었습니다. [관계회사 CB] 관계회사가 전환사채를 취득했고 당사는 취득하지 않았습니다. [당사 신탁] 이사회는 자기주식취득 신탁계약을 체결하기로 결정했으며 계약은 다음 달 예정입니다.' }, [product, trustProposed]],
    ['generic-two-litigation-lifecycles-and-product', { reportName: '주요 경영사항 공시', bodyText: '[본소] 당사는 기존 본소를 전부 취하했습니다. [반소] 상대방의 반소는 당사를 상대로 현재 계속 중입니다. [품목허가] 별도 의약품 품목허가 신청은 오늘 취하 완료했습니다.' }, [withdrawn, active, product]],
  ];

  const failures = cases.flatMap(([id, input, expectedEvents]) => {
    const actual = extractEventsGatedProjection(input);
    return JSON.stringify(eventSet(actual.events)) === JSON.stringify(eventSet(expectedEvents))
      ? []
      : [{ id, expected: eventSet(expectedEvents), actual: eventSet(actual.events) }];
  });
  assert.deepEqual(failures, []);
});

test('round 8 natural prose keeps independent event lifecycles separate', async () => {
  const { extractEventsGatedProjection } = await import(MODULE);
  const active = canonicalEvent('legal-regulatory', 'updated', 'active', 'litigation', 'issuer');
  const filed = canonicalEvent('legal-regulatory', 'filed', null, 'litigation', 'issuer');
  const withdrawn = canonicalEvent('legal-regulatory', 'withdrawn', 'effective', 'litigation', 'issuer');
  const trustProposed = canonicalEvent('capital-change', 'decided', 'proposed', 'treasury-share-trust', 'securities');
  const trustEffective = canonicalEvent('capital-change', 'contracted', 'effective', 'treasury-share-trust', 'securities');
  const bondProposed = canonicalEvent('capital-change', 'decided', 'proposed', 'convertible-bond', 'securities');
  const bondEffective = canonicalEvent('capital-change', 'acquired', 'effective', 'convertible-bond', 'securities');
  const product = canonicalEvent('regulatory-product', 'withdrawn', 'cancelled', 'product-approval', 'product');
  const cases = [
    ['generic-active-arbitration', {
      reportName: '기타 주요경영사항(자율공시)',
      bodyText: '당사가 2025년 11월 싱가포르국제중재센터에 제기한 공급계약 관련 중재사건은 현재 서면심리가 진행되고 있습니다. 2026년 7월 22일 중재판정부가 추가 자료 제출 일정을 지정하였으며 아직 판정이나 취하의 효력은 발생하지 않았습니다.',
    }, [active]],
    ['withdrawal-title-confirms-effective-withdrawal', {
      reportName: '소송 등의 제기ㆍ신청(일정금액 이상의 청구)(취하)',
      bodyText: '당사가 원고로 제기했던 대여금 청구소송에 관하여 법원에 소취하서를 제출하였고, 피고의 동의서가 접수되어 같은 날 소취하의 효력이 발생하였습니다. 이에 해당 사건은 종료되었습니다.',
    }, [withdrawn]],
    ['reversed-withdrawal-decision-keeps-litigation-active', {
      reportName: '[기재정정]소송등의제기ㆍ신청',
      bodyText: '정정 내용 | 앞서 취하하기로 했던 결정을 번복하여 소송을 계속 수행하기로 확정했습니다.',
    }, [active]],
    ['generic-withdrawn-and-newly-filed-lawsuits', {
      reportName: '주요경영사항공시',
      bodyText: '첫째, 당사가 2025년 제기한 사건은 상대방 동의를 얻은 소취하가 확정되어 종료되었습니다. 둘째, 별개의 하도급 정산분쟁에 대해서는 당사가 서울서부지방법원에 새 소장을 제출하여 접수번호를 부여받았습니다.',
    }, [withdrawn, filed]],
    ['unexecuted-trust-correction-stays-proposed', {
      reportName: '주요사항보고서(자기주식취득신탁계약체결결정)(정정)',
      bodyText: '이사회가 결의한 자기주식취득 신탁계약의 예정금액과 예정기관을 정정합니다. 계약 예정일은 7월 29일이며 아직 실제 계약은 체결되지 않았습니다.',
    }, [trustProposed]],
    ['generic-independent-trusts-preserve-both-states', {
      reportName: '기타 주요경영사항(자율공시)',
      bodyText: '제1호 신탁은 당사 이사회가 20억원 규모로 체결하기로 의결했으나 계약서 서명 전입니다. 별개의 제2호 자기주식취득 신탁은 같은 날 누리증권과 35억원 규모 계약을 체결하여 즉시 효력이 발생했습니다.',
    }, [trustProposed, trustEffective]],
    ['alternate-own-convertible-bond-title-confirms-completion', {
      reportName: '전환사채(해외전환사채 포함) 발행 후 만기 전 사채 취득',
      bodyText: '당사는 당사 발행 제5회 전환사채 취득대금을 지급하고 사채권을 인도받았습니다. 해당 취득은 같은 날 효력이 발생했으며 취득 절차가 완료되었습니다.',
    }, [bondEffective]],
    ['generic-independent-bonds-preserve-both-states', {
      reportName: '주요경영사항공시',
      bodyText: '당사 발행 제9회 전환사채는 대금 지급과 권리 이전을 마쳐 취득이 완료되었습니다. 이와 별개인 제10회 전환사채에 대해서는 이사회가 만기 전 취득을 결의했으며 실제 취득 예정일은 다음 달입니다.',
    }, [bondEffective, bondProposed]],
    ['generic-new-lawsuit-and-trust-decision', {
      reportName: '기타 주요경영사항(자율공시)',
      bodyText: '당사는 거래처의 계약위반에 대해 서울중앙지방법원에 손해배상 소장을 제출하여 접수를 마쳤습니다. 이와 독립하여 같은 날 이사회는 자기주식취득 신탁계약을 체결하기로 결의했으며 계약서 서명은 다음 주 예정입니다.',
    }, [filed, trustProposed]],
    ['issuer-bond-excludes-third-party-product-withdrawal', {
      reportName: '기타 주요경영사항(자율공시)',
      bodyText: '당사는 당사 발행 전환사채를 만기 전에 취득하여 대금 지급과 권리 이전을 끝냈습니다. 별도로 비연결 관계회사가 자사 명의의 품목허가 신청을 취하했으나, 당사는 그 신청의 신청인이나 제품 보유자가 아닙니다.',
    }, [bondEffective]],
    ['one-product-withdrawal-is-not-cancelled-by-other-product-plans', {
      reportName: '기타 주요경영사항(자율공시)',
      bodyText: '제품 JRB-631의 품목허가 신청은 당사가 자진취하서를 제출하여 규제기관 접수와 심사 취소가 완료되었습니다. 별개 제품 JRB-632는 취하 계획이 없고 심사가 계속되며, JRB-633은 향후 취하 여부를 검토할 뿐 아직 결정되지 않았습니다.',
    }, [product]],
  ];

  const failures = cases.flatMap(([id, input, expectedEvents]) => {
    const actual = extractEventsGatedProjection(input);
    return JSON.stringify(eventSet(actual.events)) === JSON.stringify(eventSet(expectedEvents))
      ? []
      : [{ id, expected: eventSet(expectedEvents), actual: eventSet(actual.events) }];
  });
  assert.deepEqual(failures, []);
});

test('round 9 semantic subjects separate lifecycle, actor, and independent objects', async () => {
  const { extractEventsGatedProjection } = await import(MODULE);
  const active = canonicalEvent('legal-regulatory', 'updated', 'active', 'litigation', 'issuer');
  const filed = canonicalEvent('legal-regulatory', 'filed', null, 'litigation', 'issuer');
  const withdrawn = canonicalEvent('legal-regulatory', 'withdrawn', 'effective', 'litigation', 'issuer');
  const trustEffective = canonicalEvent('capital-change', 'contracted', 'effective', 'treasury-share-trust', 'securities');
  const trustProposed = canonicalEvent('capital-change', 'decided', 'proposed', 'treasury-share-trust', 'securities');
  const bondProposed = canonicalEvent('capital-change', 'decided', 'proposed', 'convertible-bond', 'securities');
  const bondEffective = canonicalEvent('capital-change', 'acquired', 'effective', 'convertible-bond', 'securities');
  const product = canonicalEvent('regulatory-product', 'withdrawn', 'cancelled', 'product-approval', 'product');
  const positiveCases = [
    ['active-litigation-status-title', {
      reportName: '소송등의 진행상황',
      bodyText: '당사가 피고인 계약금 반환 사건은 현재 변론기일이 진행되었고 원고는 청구를 유지하고 있어 본건은 계속 중입니다.',
    }, [active]],
    ['newly-filed-lawsuit-does-not-duplicate-active-lifecycle', {
      reportName: '소송등의제기ㆍ신청',
      bodyText: '당사는 손해를 회복하기 위해 거래처를 상대로 손해배상청구 소를 제기하였습니다. 법원이 같은 날 소장을 접수했습니다.',
    }, [filed]],
    ['effective-litigation-withdrawal-title', {
      reportName: '소송 등의 취하',
      bodyText: '원고가 당사를 상대로 낸 소송 전부를 취하했고 법원은 취하서를 유효하게 접수했습니다. 피고인 당사는 취하에 동의하여 사건이 종결되었습니다.',
    }, [withdrawn]],
    ['effective-trust-extension-contract', {
      reportName: '자기주식취득 신탁계약 연장 체결',
      bodyText: '기존 자기주식 신탁의 만기를 1년 연장하는 변경계약을 새 수탁사와 오늘 체결했습니다. 양 당사자 서명이 완료되어 변경계약은 체결일로부터 유효합니다.',
    }, [trustEffective]],
    ['planned-trust-is-effective-after-current-signature', {
      reportName: '자기주식취득 신탁계약 체결',
      bodyText: '어제까지는 계약 예정이었으나 오늘 수탁사와 최종 계약서 교환 및 전자서명을 마쳤습니다. 자기주식 취득 신탁은 오늘부터 효력이 있습니다.',
    }, [trustEffective]],
    ['future-own-bond-decision', {
      reportName: '자기 전환사채 취득 결정',
      bodyText: '이사회는 회사가 발행한 전환사채 전액을 다음 달 매수하기로 결정했습니다. 매매대금 지급과 권리 이전은 아직이므로 현재는 취득 결정 단계입니다.',
    }, [bondProposed]],
    ['completed-own-bond-settlement', {
      reportName: '자기 전환사채 매입 종결',
      bodyText: '발행회사인 당사는 사채권자 전원에게 약정 매수가액을 지급했고 채권 인도를 완료했습니다. 외부 잔액은 0원으로 실제 자기 전환사채 취득이 종결되었습니다.',
    }, [bondEffective]],
    ['partial-own-bond-acquisition-with-external-balance-stays-proposed', {
      reportName: '자기 전환사채 일부 취득',
      bodyText: '전환사채 중 40%는 오늘 회사가 매입했으나 60%가 외부에 잔존하고 추가 정산이 필요합니다. 전체 취득 완료가 아니라 잔여분 취득 결정 단계입니다.',
    }, [bondProposed]],
    ['independent-own-bond-rounds', {
      reportName: '자기 전환사채 취득 현황',
      bodyText: '서로 다른 회차를 함께 보고합니다. 제4회 전환사채는 대금 지급과 권리 이전을 끝내 전액 취득했습니다. 제6회는 외부 잔액이 남아 다음 달 매입하기로만 결정했고 아직 결제하지 않았습니다.',
    }, [bondEffective, bondProposed]],
    ['one-of-two-product-approvals-withdrawn', {
      reportName: '복수 품목 허가 진행 변경',
      bodyText: '당사가 신청한 두 제품은 독립적입니다. 진통제 A의 품목허가 신청은 재추진 없이 전부 취하되어 심사가 종료됐고, 진단키트 B의 신청은 취하하지 않아 심사 중입니다.',
    }, [product]],
    ['four-independent-body-events', {
      reportName: '복수 주요사항 종합공시',
      bodyText: '서로 독립인 네 건입니다. 새 원고의 공사대금 소장이 당사를 상대로 법원에 접수됐습니다. 당사는 증권사와 자기주식취득 신탁계약을 서명해 효력이 생겼습니다. 자기 전환사채 전액은 대금 지급과 이전을 마쳐 회사가 취득했습니다. 당사 신약 품목허가 신청도 최종 자진취하되어 심사가 취소됐습니다.',
    }, [filed, trustEffective, bondEffective, product]],
    ['withdrawn-lawsuit-and-unexecuted-trust-decision', {
      reportName: '소송 취하 및 자기주식 신탁 추진',
      bodyText: '원고가 당사 상대 소송 전부를 취하했고 법원이 유효하게 접수했습니다. 같은 날 이사회는 자기주식취득 신탁계약 추진을 결의했으나 수탁사 서명은 다음 주 예정입니다.',
    }, [withdrawn, trustProposed]],
    ['current-trust-contract-excludes-following-historical-summary', {
      reportName: '자기주식 신탁계약 및 과거 사건 참고',
      bodyText: '당사는 오늘 은행과 자기주식취득 신탁계약에 최종 서명했고 즉시 효력이 발생했습니다. 2020년 종료된 소송, 2022년 취득한 전환사채, 2023년 취하한 품목은 단순 연혁입니다.',
    }, [trustEffective]],
    ['effective-trust-and-own-bond-remain-independent', {
      reportName: '신탁계약 체결 및 자기 전환사채 취득',
      bodyText: '당사는 은행과 자기주식취득 신탁계약에 전자서명하여 오늘 효력을 개시했습니다. 별도로 자기 전환사채 전액의 결제와 권리 이전을 완료해 외부 잔액이 없습니다.',
    }, [trustEffective, bondEffective]],
    ['active-litigation-with-unrelated-object-noise', {
      reportName: '진행 소송 및 기타 거래 안내',
      bodyText: '당사가 피고인 부당이득반환 소송은 현재 변론이 계속되고 청구도 유지됩니다. 같은 문서의 자기주식은 신탁 없는 직접매수이고, 전환사채 매수인은 제3자 펀드이며, 허가 관련 내용은 임상시험계획 보완입니다.',
    }, [active]],
  ];

  const failures = positiveCases.flatMap(([id, input, expectedEvents]) => {
    const actual = extractEventsGatedProjection(input);
    return JSON.stringify(eventSet(actual.events)) === JSON.stringify(eventSet(expectedEvents))
      ? []
      : [{ id, expected: eventSet(expectedEvents), actual: eventSet(actual.events) }];
  });
  const forbiddenCases = [
    ['third-party-bond-purchase', {
      reportName: '전환사채 거래 관련 안내',
      bodyText: '관계회사가 당사가 발행한 전환사채 일부를 기존 투자자로부터 매수했습니다. 매수인은 발행회사인 당사가 아니며 당사의 자기 전환사채 취득도 아닙니다.',
    }, (event) => event.cause === 'convertible-bond'],
    ['withdrawn-bond-decision', {
      reportName: '자기 전환사채 취득 결정 철회',
      bodyText: '당초 예정했던 전환사채 매수는 합의가 무산되어 오늘 전면 철회되었습니다. 회사가 실제로 취득한 물량은 없고 향후 취득 의무도 없습니다.',
    }, (event) => event.cause === 'convertible-bond'],
    ['historical-own-bond-disposition-plan-is-not-current-acquisition', {
      reportName: '자기 전환사채 처분 계획',
      bodyText: '당사는 과거에 이미 취득해 보유 중인 자기 전환사채를 다음 분기에 재매각할 계획입니다. 이번 공시에서 새로 취득하거나 취득을 결정한 사실은 없습니다.',
    }, (event) => event.cause === 'convertible-bond'],
    ['product-reapplication-is-not-fda-crl', {
      reportName: '품목허가 보완 후 재신청',
      bodyText: '지난달 형식상 취하했던 품목허가 신청은 자료 보완을 마쳐 오늘 같은 품목으로 재신청했고 당국 심사가 진행 중입니다.',
    }, (event) => event.cause === 'fda-crl'],
    ['third-party-product-withdrawal-is-not-fda-crl', {
      reportName: '종속회사 품목허가 취하',
      bodyText: '종속회사가 별도 법인 및 신청인으로서 품목허가 신청을 취하했습니다. 모회사인 당사가 낸 신청은 유지되고 있습니다.',
    }, (event) => event.cause === 'fda-crl'],
    ['product-withdrawal-rumor-is-not-fda-crl', {
      reportName: '품목허가 취하설 해명',
      bodyText: '시장에 퍼진 당사의 품목허가 신청 취하설은 사실무근입니다. 신청은 철회되지 않았고 규제기관의 본심사가 정상적으로 계속되고 있습니다.',
    }, (event) => event.cause === 'fda-crl'],
    ['final-judgment-is-not-active-litigation', {
      reportName: '소송 등의 판결ㆍ결정',
      bodyText: '당사가 피고였던 침해 사건은 대법원의 상고기각 판결이 송달되어 확정되었습니다. 추가 심리나 계속 중인 절차는 없으며 해당 소송은 종결되었습니다.',
    }, (event) => event.cause === 'litigation' && event.state === 'active'],
    ['product-withdrawal-denial-is-not-withdrawal-or-litigation', {
      reportName: '해명공시',
      bodyText: '당사가 품목허가 신청을 취하했다는 보도는 사실이 아닙니다. 신청은 정상적으로 심사 중이며 당사는 취하서를 제출하거나 취하 의사를 규제기관에 통보한 바 없습니다.',
    }, (event) => (event.cause === 'product-approval' && event.action === 'withdrawn') || event.cause === 'litigation'],
  ];
  for (const [id, input, forbidden] of forbiddenCases) {
    const actual = extractEventsGatedProjection(input);
    if (actual.events.some(forbidden)) failures.push({ id, actual: eventSet(actual.events) });
  }
  assert.deepEqual(failures, []);
});

test('semantic gate source contains no receipt or corporation literal branches', async () => {
  const source = await readFile(join(__dirname, '..', 'src', 'services', 'deepscan-kr-disclosure-event-extractors.js'), 'utf8');
  assert.doesNotMatch(source, /20\d{12}/u);
  assert.doesNotMatch(source, /(?:corpName|receiptNumber|rceptNo)\s*={2,3}/u);
});

test('benchmark runner compares both title-only and provider-detail modes', () => {
  const output = execFileSync(process.execPath, [BENCHMARK, '--json', '--iterations=5'], { encoding: 'utf8' });
  const report = JSON.parse(output);
  assert.equal(report.caseCount >= 30, true);
  assert.deepEqual(Object.keys(report.modes), ['title-only', 'provider-detail']);
  for (const mode of Object.values(report.modes)) {
    assert.deepEqual(Object.keys(mode), ['legacy', 'flat', 'structured', 'hybrid', 'document', 'gated']);
    for (const metrics of Object.values(mode)) {
      assert.equal(typeof metrics.selectionScore, 'number');
      assert.equal(metrics.latency.operationCount > 0, true);
    }
  }
  assert.ok(report.modes['title-only'].structured.selectionScore > report.modes['title-only'].legacy.selectionScore);
  assert.ok(report.modes['provider-detail'].hybrid.selectionScore > report.modes['provider-detail'].structured.selectionScore);
});

test('research benchmark keeps accuracy labels separate from coverage metrics', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jaroo-dart-event-research-'));
  const auditPath = join(directory, 'audit.json');
  const corpusPath = join(directory, 'corpus.json');
  await writeFile(auditPath, JSON.stringify({
    query: { corpClass: 'Y', from: '20260701', to: '20260721' },
    results: [
      {
        detailType: 'A001',
        detailMode: 'exact',
        samples: [{ rceptNo: '1', reportName: '사업보고서 (2025.12)', disclosureType: 'A' }],
      },
      {
        detailType: 'I001',
        detailMode: 'title_required',
        samples: [{ rceptNo: '2', reportName: '투자판단관련주요경영사항', disclosureType: 'I' }],
      },
    ],
  }));
  await writeFile(corpusPath, JSON.stringify({
    summary: { bodyAvailableCount: 1 },
    cases: [{
      key: 'I001|generic',
      input: {
        rceptNo: '2',
        reportName: '투자판단관련주요경영사항',
        disclosureType: 'I',
        disclosureDetailType: 'I001',
        bodyText: '투자판단 관련 주요경영사항 | 1. 제목 | | 정비사업 시공자 선정 | | 2. 주요내용 |',
      },
    }],
  }));

  try {
    const output = execFileSync(process.execPath, [
      RESEARCH_BENCHMARK,
      `--audit=${auditPath}`,
      `--corpus=${corpusPath}`,
      '--iterations=1',
      '--json',
    ], { cwd: join(__dirname, '..'), encoding: 'utf8' });
    const report = JSON.parse(output);
    assert.deepEqual(report.interpretation.accuracyMetrics, [
      'adversarialEventGold',
      'bodyReviewedEventSet',
      'humanTypeGold',
      'exactProviderAgreement',
    ]);
    assert.deepEqual(report.interpretation.coverageOnlyMetrics, [
      'titleRequiredCoverage',
      'titleRequiredHierarchicalCoverage',
      'bodyTemplateCoverage',
    ]);
    assert.equal(report.candidates.document.exactProviderAgreement.agreement, 1);
    assert.equal(report.candidates.document.titleRequiredHierarchicalCoverage.resolutionRate, 1);
    assert.equal(report.candidates.document.bodyTemplateCoverage.bodyResolved, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
