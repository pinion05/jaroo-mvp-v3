/**
 * Versioned KR disclosure classification dataset.
 *
 * Sources:
 * - OpenDART disclosure search guide and its pblntf_ty / pblntf_detail_ty table
 *   https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019001
 * - Observed OpenDART title variants curated in
 *   test/fixtures/kr-disclosure-classification-gold.v1.json
 * - Delisting-risk samples maintained in deepscan-kr-disclosure-risk-keywords.js
 *
 * Keep this module declarative. Classification mechanics belong in
 * deepscan-kr-disclosure-pipeline.js; taxonomy and policy decisions belong here.
 */

export const KR_DISCLOSURE_CLASSIFICATION_DATASET_VERSION =
  'jaroo.deepscan.kr-disclosure-classification-dataset.v1';

export const KR_DISCLOSURE_CLASSIFICATION_DATASET_AS_OF = '2026-07-20';

export const KR_DISCLOSURE_CATEGORY_ORDER = Object.freeze([
  'high-risk',
  'audit',
  'trading-status',
  'legal-regulatory',
  'insolvency',
  'restructuring',
  'capital-change',
  'material-contract',
  'corporate-action',
  'earnings',
  'related-party',
  'ownership',
  'periodic',
  'governance',
  'other',
]);

export const KR_DISCLOSURE_CATEGORY_CONFIG = Object.freeze({
  'high-risk': Object.freeze({
    label: '중대 위험',
    materiality: 100,
    risk: 'high',
    dumpPolicy: 'full_text',
    tier: 0,
  }),
  audit: Object.freeze({
    label: '감사·검토',
    materiality: 90,
    risk: 'low',
    dumpPolicy: 'key_sections',
    tier: 1,
    riskEscalationPattern: '의견거절|부적정|한정의견|계속기업|감사범위\\s*제한',
  }),
  'trading-status': Object.freeze({
    label: '거래·상장 상태',
    materiality: 90,
    risk: 'high',
    dumpPolicy: 'full_text',
    tier: 1,
  }),
  'legal-regulatory': Object.freeze({
    label: '소송·제재',
    materiality: 90,
    risk: 'medium',
    dumpPolicy: 'full_text',
    tier: 1,
    riskEscalationPattern: '횡령|배임|제재|영업정지|회계처리기준\\s*위반|과징금|기소',
  }),
  insolvency: Object.freeze({
    label: '회생·파산·부도',
    materiality: 90,
    risk: 'high',
    dumpPolicy: 'full_text',
    tier: 1,
  }),
  restructuring: Object.freeze({
    label: '합병·분할·사업재편',
    materiality: 85,
    risk: 'medium',
    dumpPolicy: 'full_text',
    tier: 1,
  }),
  'capital-change': Object.freeze({
    label: '자본·증권 변동',
    materiality: 75,
    risk: 'medium',
    dumpPolicy: 'full_text',
    tier: 2,
  }),
  'material-contract': Object.freeze({
    label: '주요 계약·보증',
    materiality: 75,
    risk: 'medium',
    dumpPolicy: 'full_text',
    tier: 2,
  }),
  'corporate-action': Object.freeze({
    label: '배당·공개매수 등',
    materiality: 75,
    risk: 'medium',
    dumpPolicy: 'full_text',
    tier: 2,
  }),
  earnings: Object.freeze({
    label: '실적·전망',
    materiality: 70,
    risk: 'low',
    dumpPolicy: 'full_text',
    tier: 2,
  }),
  'related-party': Object.freeze({
    label: '특수관계인 거래',
    materiality: 65,
    risk: 'medium',
    dumpPolicy: 'full_text',
    tier: 3,
  }),
  ownership: Object.freeze({
    label: '지분·보유 변동',
    materiality: 55,
    risk: 'low',
    dumpPolicy: 'full_text',
    tier: 3,
  }),
  periodic: Object.freeze({
    label: '정기 보고',
    materiality: 35,
    risk: 'low',
    dumpPolicy: 'key_sections',
    tier: 4,
  }),
  governance: Object.freeze({
    label: '지배구조·주주총회',
    materiality: 35,
    risk: 'low',
    dumpPolicy: 'key_sections',
    tier: 4,
  }),
  other: Object.freeze({
    label: '기타',
    materiality: 10,
    risk: 'low',
    dumpPolicy: 'metadata_only',
    tier: 5,
  }),
});

export const OPEN_DART_DISCLOSURE_TYPES = Object.freeze({
  A: '정기공시',
  B: '주요사항보고',
  C: '발행공시',
  D: '지분공시',
  E: '기타공시',
  F: '외부감사관련',
  G: '펀드공시',
  H: '자산유동화',
  I: '거래소공시',
  J: '공정위공시',
});

function detail(code, label, defaultCategory, mode = 'exact') {
  return Object.freeze({
    code,
    type: code.slice(0, 1),
    label,
    defaultCategory,
    mode,
  });
}

/**
 * All 61 pblntf_detail_ty values currently documented by OpenDART.
 *
 * mode:
 * - exact: the provider detail code is sufficient for the semantic default.
 * - title_required: the provider bucket contains heterogeneous events, so the
 *   title/remarks must refine it; unmatched records are flagged for review.
 */
export const OPEN_DART_DISCLOSURE_DETAIL_TYPES = Object.freeze([
  detail('A001', '사업보고서', 'periodic'),
  detail('A002', '반기보고서', 'periodic'),
  detail('A003', '분기보고서', 'periodic'),
  detail('A004', '등록법인결산서류(자본시장법이전)', 'periodic'),
  detail('A005', '소액공모법인결산서류', 'periodic'),

  detail('B001', '주요사항보고서', null, 'title_required'),
  detail('B002', '주요경영사항신고(자본시장법 이전)', null, 'title_required'),
  detail('B003', '최대주주등과의거래신고(자본시장법 이전)', 'related-party'),

  detail('C001', '증권신고(지분증권)', 'capital-change'),
  detail('C002', '증권신고(채무증권)', 'capital-change'),
  detail('C003', '증권신고(파생결합증권)', 'capital-change'),
  detail('C004', '증권신고(합병등)', 'restructuring'),
  detail('C005', '증권신고(기타)', 'capital-change'),
  detail('C006', '소액공모(지분증권)', 'capital-change'),
  detail('C007', '소액공모(채무증권)', 'capital-change'),
  detail('C008', '소액공모(파생결합증권)', 'capital-change'),
  detail('C009', '소액공모(합병등)', 'restructuring'),
  detail('C010', '소액공모(기타)', 'capital-change'),
  detail('C011', '호가중개시스템을통한소액매출', 'capital-change'),

  detail('D001', '주식등의대량보유상황보고서', 'ownership'),
  detail('D002', '임원ㆍ주요주주특정증권등소유상황보고서', 'ownership'),
  detail('D003', '의결권대리행사권유', 'governance'),
  detail('D004', '공개매수', 'corporate-action'),
  detail('D005', '임원ㆍ주요주주 특정증권등 거래계획보고서', 'ownership'),

  detail('E001', '자기주식취득/처분', 'capital-change'),
  detail('E002', '신탁계약체결/해지', 'capital-change'),
  detail('E003', '합병등종료보고서', 'restructuring'),
  detail('E004', '주식매수선택권부여에관한신고', 'capital-change'),
  detail('E005', '사외이사에관한신고', 'governance'),
  detail('E006', '주주총회소집보고서', 'governance'),
  detail('E007', '시장조성/안정조작', 'capital-change'),
  detail('E008', '합병등신고서(자본시장법 이전)', 'restructuring'),
  detail('E009', '금융위등록/취소(자본시장법 이전)', 'other'),
  detail('E010', '이중상환청구권부채권(커버드본드)', 'capital-change'),

  detail('F001', '감사보고서', 'audit'),
  detail('F002', '연결감사보고서', 'audit'),
  detail('F003', '결합감사보고서', 'audit'),
  detail('F004', '회계법인사업보고서', 'periodic'),
  detail('F005', '감사전재무제표미제출신고서', 'audit'),

  detail('G001', '증권신고(집합투자증권-신탁형)', 'capital-change'),
  detail('G002', '증권신고(집합투자증권-회사형)', 'capital-change'),
  detail('G003', '증권신고(집합투자증권-합병)', 'restructuring'),

  detail('H001', '자산유동화계획/양도등록', 'capital-change'),
  detail('H002', '사업/반기/분기보고서', 'periodic'),
  detail('H003', '증권신고(유동화증권등)', 'capital-change'),
  detail('H004', '채권유동화계획/양도등록', 'capital-change'),
  detail('H005', '자산유동화관련중요사항발생등보고', null, 'title_required'),
  detail('H006', '주요사항보고서', null, 'title_required'),

  detail('I001', '수시공시', null, 'title_required'),
  detail('I002', '공정공시', null, 'title_required'),
  detail('I003', '시장조치/안내', null, 'title_required'),
  detail('I004', '지분공시', 'ownership'),
  detail('I005', '증권투자회사', 'other'),
  detail('I006', '채권공시', null, 'title_required'),

  detail('J001', '대규모내부거래관련', 'related-party'),
  detail('J002', '대규모내부거래관련(구)', 'related-party'),
  detail('J004', '기업집단현황공시', 'governance'),
  detail('J005', '비상장회사중요사항공시', null, 'title_required'),
  detail('J006', '기타공정위공시', 'other'),
  detail('J008', '대규모내부거래관련(공익법인용)', 'related-party'),
  detail('J009', '하도급대금결제조건공시', 'other'),
]);

export const OPEN_DART_BROAD_TYPE_DEFAULTS = Object.freeze({
  A: 'periodic',
  B: null,
  C: 'capital-change',
  D: 'ownership',
  E: null,
  F: 'audit',
  G: 'capital-change',
  H: null,
  I: null,
  J: 'governance',
});

function titleRule(id, category, pattern) {
  return Object.freeze({ id, category, pattern, flags: 'u' });
}

/**
 * Semantic title rules. Patterns run against normalized report names and rm.
 * Each rule is intentionally named so classificationReasons can identify the
 * exact data rule that fired.
 */
export const KR_DISCLOSURE_TITLE_RULES = Object.freeze([
  titleRule(
    'audit-report-or-opinion',
    'audit',
    '감사보고서|연결감사보고서|검토보고서|반기검토의견|감사의견|의견거절|부적정|한정의견|계속기업|감사전재무제표',
  ),
  titleRule(
    'exchange-trading-or-listing-status',
    'trading-status',
    '주권?매매거래정지|매매거래정지|거래정지|정리매매|관리종목|투자주의\\s*환기|상장적격성|기타시장안내|투자유의안내|시장조치',
  ),
  titleRule(
    'litigation-sanction-or-misconduct',
    'legal-regulatory',
    '소송|횡령|배임|불성실공시|제재|회계처리기준\\s*위반|영업정지|과징금|기소|압수수색',
  ),
  titleRule(
    'insolvency-or-dissolution',
    'insolvency',
    '회생|파산|부도|채무불이행|기한의이익상실|자본잠식|해산사유|해산결정|해산',
  ),
  titleRule(
    'merger-transfer-or-reorganization',
    'restructuring',
    '합병|회사분할|분할합병|영업양수|영업양도|주식(?:의포괄적)?교환|자산양수|자산양도(?!등의등록신청서)|비유동자산취득|타법인주식및출자증권(?:취득|처분)',
  ),
  titleRule(
    'equity-debt-or-treasury-share-change',
    'capital-change',
    '유상증자|무상증자|전환사채|신주인수권|교환사채|전환가액|교환가액|행사가액|전환청구권행사|신주인수권행사|감자|자기주식|증권발행|증권신고서|투자설명서|일괄신고|파생결합증권|주식매수선택권|신주발행가액|소액공모|호가중개시스템을통한소액매출|신탁계약(?:체결|해지|에의한취득)|발행사실보고서|자산유동화계획|자산양도등의등록신청서|채권유동화계획|채권양도등의등록신청서|유동화증권',
  ),
  titleRule(
    'sales-contract-guarantee-or-financing',
    'material-contract',
    '단일판매|공급계약|수주|계약체결|계약해지|채무보증|담보제공|자금대여|자금차입|출자결정|대규모내부거래',
  ),
  titleRule(
    'dividend-tender-or-share-unit-action',
    'corporate-action',
    '배당|주식소각|액면분할|주식병합|공개매수|주주명부폐쇄|기준일설정',
  ),
  titleRule(
    'earnings-or-guidance',
    'earnings',
    '잠정.*실적|영업.*실적|매출액.*손익구조|결산실적|실적전망|실적공시|매출액.*변경',
  ),
  titleRule(
    'related-party-transaction',
    'related-party',
    '특수관계인|계열(?:금융)?회사|동일인등|최대주주등과의거래',
  ),
  titleRule(
    'beneficial-or-insider-ownership',
    'ownership',
    '임원[ㆍ·ᆞ\\s]?주요주주|주요주주|최대주주|대량보유|소유주식변동|주식보유변동|주식등의대량보유|지분공시|특정증권등거래계획',
  ),
  titleRule(
    'periodic-report',
    'periodic',
    '사업보고서|반기보고서|분기보고서|등록법인결산서류|소액공모법인결산서류',
  ),
  titleRule(
    'governance-meeting-or-board',
    'governance',
    '기업지배구조|대규모기업집단|주주총회|임원선임|사외이사|대표이사|의결권대리행사권유|이사회',
  ),
  titleRule(
    'subcontract-payment-conditions',
    'other',
    '지급수단별[ㆍ·ᆞ\\s]*지급기간별지급금액및분쟁조정기구',
  ),
]);

export const KR_DISCLOSURE_CLASSIFICATION_DATASET = Object.freeze({
  schemaVersion: KR_DISCLOSURE_CLASSIFICATION_DATASET_VERSION,
  asOf: KR_DISCLOSURE_CLASSIFICATION_DATASET_AS_OF,
  sourceUrl: 'https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019001',
  categoryOrder: KR_DISCLOSURE_CATEGORY_ORDER,
  categoryConfig: KR_DISCLOSURE_CATEGORY_CONFIG,
  disclosureTypes: OPEN_DART_DISCLOSURE_TYPES,
  disclosureDetailTypes: OPEN_DART_DISCLOSURE_DETAIL_TYPES,
  broadTypeDefaults: OPEN_DART_BROAD_TYPE_DEFAULTS,
  titleRules: KR_DISCLOSURE_TITLE_RULES,
});
