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
    id: 'i7b-correction-field-scope',
    input: {
      reportName: '[기재정정]투자설명서',
      disclosureDetailType: 'C001',
      bodyText: '정정사항 | 사업목적 | 정정 전 | 기존 사업목적 | 정정 후 | 신규 사업목적 | 참고자료 | 과거 공모가액 확정 내역',
    },
    expectedEvents: [canonicalEvent('capital-change', 'updated', 'effective', 'equity-securities', 'securities')],
  },
  {
    id: 'i7b-current-approval-historical-withdrawal',
    input: {
      reportName: '투자판단관련주요경영사항',
      disclosureDetailType: 'I001',
      bodyText: '현재 결과 | 신약 A 품목허가 승인 통지 수령 | 과거 이력 | 신약 B 품목허가 신청 자진 취하 접수 완료',
    },
    expectedEvents: [canonicalEvent('regulatory-product', 'approved', 'effective', 'fda-approval', 'product')],
  },
  {
    id: 'i7b-bonus-issue-completion',
    input: {
      reportName: '기타경영사항(자율공시)',
      disclosureDetailType: 'I001',
      bodyText: '자회사 무상증자 | 신주 배정 및 무상증자가 완료되었습니다',
    },
    expectedEvents: [canonicalEvent('capital-change', 'completed', 'effective', 'bonus-issue', 'securities')],
  },
  {
    id: 'i7b-independent-loan-extension',
    input: {
      reportName: '금전대여결정',
      filedAt: '2027-06-01',
      bodyText: '거래상대방 관계 | 특수관계 없음 | 독립 제3자 | 기존 금전대여 기간 연장 | 변경계약 시작일 | 2027-07-01',
    },
    expectedEvents: [canonicalEvent('material-contract', 'extended', 'pending', 'loan', 'contract')],
  },
  {
    id: 'i7b-terminal-with-independent-sibling',
    input: {
      reportName: '투자판단관련주요경영사항',
      disclosureDetailType: 'I001',
      filedAt: '2027-06-01',
      bodyText: '1. 품목허가 신청 자진취하 | 취하 접수 완료 | 2. 단일판매ㆍ공급계약 체결 | 계약(수주)일자 | 2027-06-01 | 계약기간 시작일 | 2027-06-01',
    },
    expectedEvents: [
      canonicalEvent('regulatory-product', 'withdrawn', 'cancelled', 'product-approval', 'product'),
      canonicalEvent('material-contract', 'contracted', 'effective', 'supply-contract', 'contract'),
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

test('iteration 7b near misses preserve scoped facts and sibling intents', async () => {
  const { extractEventsGatedProjection } = await import(MODULE);
  assert.equal(ITERATION_7B_NEAR_MISS_CASES.length, 5);

  const failures = [];
  for (const fixtureCase of ITERATION_7B_NEAR_MISS_CASES) {
    const actual = extractEventsGatedProjection(fixtureCase.input);
    if (actual.events.length !== fixtureCase.expectedEvents.length
      || JSON.stringify(eventSet(actual.events)) !== JSON.stringify(eventSet(fixtureCase.expectedEvents))) {
      failures.push({
        id: fixtureCase.id,
        expected: eventSet(fixtureCase.expectedEvents),
        actual: eventSet(actual.events),
      });
    }
  }
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
  assert.ok(report.metrics.highConfidenceCoverage >= 0.50);
  assert.ok(report.metrics.highConfidenceCount >= 35);
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
