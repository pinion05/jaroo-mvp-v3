import {
  OPEN_DART_BROAD_TYPE_DEFAULTS,
  OPEN_DART_DISCLOSURE_DETAIL_TYPES,
} from '../data/kr-disclosure-classification-dataset.js';
import { classifyDisclosureFiling } from './deepscan-kr-disclosure-pipeline.js';

export const KR_DISCLOSURE_EVENT_EXTRACTOR_VERSION = 'jaroo.kr-disclosure-event-extractors.experimental.v2';
export const KR_DISCLOSURE_EVENT_GATED_VERSION = 'jaroo.kr-disclosure-event-extractors.gated.v3';

const FILING_STATE_BY_PREFIX = Object.freeze({
  기재정정: 'corrected',
  첨부정정: 'corrected',
  첨부추가: 'corrected',
  변경등록: 'corrected',
  연장결정: 'deferred',
  발행조건확정: 'finalized',
  정정제출요구: 'correction-requested',
});

const CATEGORY_TO_EVENT_TYPE = Object.freeze({
  periodic: 'periodic-report',
  'capital-change': 'capital-change',
  restructuring: 'restructuring',
  'material-contract': 'material-contract',
  ownership: 'ownership-change',
  governance: 'governance',
  'corporate-action': 'corporate-action',
  audit: 'audit',
  insolvency: 'insolvency',
  earnings: 'earnings',
  'trading-status': 'trading-status',
  'legal-regulatory': 'legal-regulatory',
  'related-party': 'related-party',
  other: 'other',
});

const DETAIL_BY_CODE = new Map(OPEN_DART_DISCLOSURE_DETAIL_TYPES.map((detail) => [detail.code, detail]));

const DETAIL_EVENT_DEFAULTS = Object.freeze({
  A001: { type: 'periodic-report', action: 'filed', cause: 'annual-report', subjectType: 'issuer' },
  A002: { type: 'periodic-report', action: 'filed', cause: 'semiannual-report', subjectType: 'issuer' },
  A003: { type: 'periodic-report', action: 'filed', cause: 'quarterly-report', subjectType: 'issuer' },
  C001: { type: 'capital-change', action: 'filed', cause: 'equity-securities', subjectType: 'securities' },
  C002: { type: 'capital-change', action: 'filed', cause: 'debt-securities', subjectType: 'securities' },
  C004: { type: 'restructuring', action: 'filed', cause: 'merger', subjectType: 'issuer' },
  D001: { type: 'ownership-change', action: 'reported', cause: 'large-shareholding', subjectType: 'ownership' },
  D002: { type: 'ownership-change', action: 'reported', cause: 'insider-ownership', subjectType: 'ownership' },
  D003: { type: 'governance', action: 'reported', cause: 'proxy-solicitation', subjectType: 'governance' },
  D004: { type: 'corporate-action', action: 'announced', cause: 'tender-offer', subjectType: 'securities' },
  D005: { type: 'ownership-change', action: 'reported', cause: 'insider-trading-plan', subjectType: 'ownership' },
  E001: { type: 'capital-change', action: 'reported', cause: 'treasury-share', subjectType: 'securities' },
  E002: { type: 'capital-change', action: 'reported', cause: 'treasury-share-trust', subjectType: 'securities' },
  E003: { type: 'restructuring', action: 'completed', cause: 'merger', subjectType: 'issuer' },
  E004: { type: 'capital-change', action: 'granted', cause: 'stock-option', subjectType: 'securities' },
  E005: { type: 'governance', action: 'changed', cause: 'outside-director', subjectType: 'governance' },
  E006: { type: 'governance', action: 'convened', cause: 'shareholder-meeting', subjectType: 'governance' },
  F001: { type: 'audit', action: 'submitted', cause: 'audit-report', subjectType: 'audit-opinion' },
  F002: { type: 'audit', action: 'submitted', cause: 'audit-report', subjectType: 'audit-opinion' },
  J001: { type: 'related-party', action: 'reported', cause: 'internal-transaction', subjectType: 'issuer' },
});

const DETAIL_SECURITIES_CAUSE = Object.freeze({
  C001: 'equity-securities',
  C002: 'debt-securities',
  C003: 'derivative-securities',
  C006: 'equity-securities',
  G002: 'fund-securities',
});

function normalizeText(value) {
  if (value === null || typeof value === 'undefined') return '';
  return String(value).normalize('NFKC').replaceAll(/\s+/gu, ' ').trim();
}

function compactText(value) {
  return normalizeText(value).replaceAll(/\s+/gu, '');
}

function normalizeInput(entry = {}) {
  const reportName = normalizeText(entry.reportName ?? entry.report_nm ?? entry.report_name);
  const remarks = normalizeText(entry.remarks ?? entry.rm);
  const correctionMatch = reportName.match(/^\[(기재정정|첨부정정|첨부추가|변경등록|연장결정|발행조건확정|정정제출요구)\]/u);
  const bodyText = normalizeText(entry.bodyText ?? entry.documentText ?? entry.body_text);
  return {
    reportName,
    remarks,
    text: `${reportName} ${remarks}`.trim(),
    compact: compactText(`${reportName} ${remarks}`),
    correctionKind: correctionMatch?.[1] ?? null,
    filingState: FILING_STATE_BY_PREFIX[correctionMatch?.[1]] ?? null,
    bodyText,
    receiptNumber: normalizeText(entry.rceptNo ?? entry.rcept_no ?? entry.receiptNumber) || null,
    filedAt: normalizeText(entry.filedAt ?? entry.rceptDt ?? entry.rcept_dt) || null,
    disclosureType: normalizeText(entry.disclosureType ?? entry.pblntfTy ?? entry.pblntf_ty).toUpperCase() || null,
    disclosureDetailType: normalizeText(entry.disclosureDetailType ?? entry.pblntfDetailTy ?? entry.pblntf_detail_ty).toUpperCase() || null,
  };
}

function createEvent({ type, action = null, state = null, cause = null, subjectType = null }) {
  return { type, action, state, cause, subjectType };
}

function eventKey(event) {
  return [event.type, event.action, event.state, event.cause, event.subjectType].map((value) => value ?? '').join('|');
}

function sortEvents(events) {
  return [...events].sort((left, right) => eventKey(left).localeCompare(eventKey(right), 'en'));
}

function addEvent(events, event) {
  if (!event?.type || events.some((candidate) => eventKey(candidate) === eventKey(event))) return;
  events.push(createEvent(event));
}

function mergeEvent(events, event) {
  const index = events.findIndex((candidate) => candidate.type === event.type);
  if (index === -1) {
    addEvent(events, event);
    return;
  }
  const current = events[index];
  events[index] = createEvent({
    type: current.type,
    action: current.action ?? event.action,
    state: current.state ?? event.state,
    cause: current.cause ?? event.cause,
    subjectType: current.subjectType ?? event.subjectType,
  });
}

function result(strategy, events, confidence, reasons = []) {
  return {
    version: KR_DISCLOSURE_EVENT_EXTRACTOR_VERSION,
    strategy,
    events: sortEvents(events),
    confidence,
    reasons,
  };
}

function correctionState(input) {
  return input.filingState;
}

function causeFromText(compact) {
  if (/무상증자/u.test(compact)) return 'bonus-issue';
  if (/유상증자/u.test(compact)) return 'rights-offering';
  if (/전환사채/u.test(compact)) return 'convertible-bond';
  if (/신주인수권/u.test(compact)) return 'warrant-bond';
  if (/주식(?:의)?병합|주식분할/u.test(compact)) return 'share-consolidation-or-split';
  if (/상장폐지|정리매매/u.test(compact)) return 'delisting';
  if (/합병/u.test(compact)) return 'merger';
  if (/FDA|보완요구서한|CRL/u.test(compact)) return 'fda-crl';
  return null;
}

function securitiesCauseFromText(compact) {
  if (/지분증권|유상증자/u.test(compact)) return 'equity-securities';
  if (/채무증권/u.test(compact)) return 'debt-securities';
  if (/파생결합/u.test(compact)) return 'derivative-securities';
  if (/합병/u.test(compact)) return 'merger';
  if (/분할/u.test(compact)) return 'demerger';
  if (/주식.*교환|주식.*이전/u.test(compact)) return 'share-exchange';
  if (/집합투자증권/u.test(compact)) return 'fund-securities';
  return 'securities-issuance';
}

function extractDocumentSubject(bodyText) {
  if (!bodyText) return '';
  const patterns = [
    /(?:^|\|)\s*1\.\s*제목\s*\|\s*\|\s*([^|]{2,300}?)\s*\|/u,
    /공시제목\s*\|\s*\|\s*([^|]{2,300}?)\s*\|/u,
  ];
  for (const pattern of patterns) {
    const match = bodyText.match(pattern);
    if (match) return normalizeText(match[1]);
  }
  return '';
}

const PERFECTIVE_ACTIONS = new Set([
  'acquired',
  'borrowed',
  'completed',
  'disposed',
  'dissolved',
  'guaranteed',
  'halted',
  'lifted',
  'listed',
]);

function filingDate(input) {
  const raw = input.filedAt || input.receiptNumber?.slice(0, 8);
  const match = String(raw ?? '').match(/^(\d{4})[-.]?(\d{2})[-.]?(\d{2})/u);
  if (!match) return null;
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function semanticDates(text) {
  return [...normalizeText(text).matchAll(/(?<!\d)(20\d{2})[년.\-/\s]+(\d{1,2})[월.\-/\s]+(\d{1,2})일?/gu)]
    .map((match) => new Date(`${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}T00:00:00Z`))
    .filter((date) => !Number.isNaN(date.getTime()));
}

export function normalizeDisclosureEventGateInput(entry = {}) {
  const input = normalizeInput(entry);
  return Object.freeze({
    ...input,
    wrapperKind: input.correctionKind === '첨부추가'
      ? 'attachment-added'
      : input.correctionKind
        ? 'correction'
        : 'original',
  });
}

export function runFilingWrapperGate(input, event) {
  if (!input.filingState || event.state !== input.filingState) return createEvent(event);
  return createEvent({ ...event, state: null });
}

export function extractStructuredBodyFacts(input) {
  const fullText = compactText(`${input.reportName} ${input.remarks} ${input.bodyText}`);
  const filed = filingDate(input);
  const dates = semanticDates(fullText);
  return Object.freeze({
    fullText,
    dates: Object.freeze(dates.map((date) => date.toISOString().slice(0, 10))),
    hasFutureDate: Boolean(filed && dates.some((date) => date > filed)),
    releaseTimestampBlank: /(?:해제|정지해제)(?:일시|시각)[^|]{0,20}\|?\s*[-미정]*\s*(?:\||$)/u.test(fullText),
    bodyAvailable: Boolean(input.bodyText),
  });
}

export function buildDetailPriorClaims(input) {
  return Object.freeze({
    detailType: input.disclosureDetailType,
    requiresBody: ['C004', 'E004', 'J001'].includes(input.disclosureDetailType),
    relatedParty: input.disclosureDetailType === 'J001',
  });
}

export function buildTitleSemanticClaims(input) {
  const text = compactText(`${input.reportName} ${extractDocumentSubject(input.bodyText)}`);
  return Object.freeze({
    text,
    decided: /결정|결의/u.test(text),
    completed: /완료|종료보고|발행결과|실적보고/u.test(text),
    scheduled: /예정|계획/u.test(text),
  });
}

export function resolveTemporalEvent(event, { bodyFacts, titleClaims }) {
  let resolved = createEvent(event);
  if (!titleClaims.completed && PERFECTIVE_ACTIONS.has(resolved.action)
    && (titleClaims.decided || bodyFacts.hasFutureDate)) {
    resolved = createEvent({
      ...resolved,
      action: titleClaims.decided ? 'decided' : 'scheduled',
      state: titleClaims.decided ? 'proposed' : 'pending',
    });
  }
  if (resolved.cause === 'lockup' && bodyFacts.hasFutureDate) {
    resolved = createEvent({ ...resolved, action: 'scheduled', state: 'pending' });
  }
  if (resolved.action === 'decided' && resolved.state === null) {
    resolved = createEvent({ ...resolved, state: 'proposed' });
  }
  if (resolved.action === 'scheduled' && resolved.state === null) {
    resolved = createEvent({ ...resolved, state: 'pending' });
  }
  if (resolved.type === 'trading-status' && resolved.action === 'lifted' && bodyFacts.releaseTimestampBlank) {
    resolved = createEvent({ ...resolved, action: 'halted', state: 'effective' });
  }
  if (titleClaims.completed && resolved.state === null && ['completed', 'disposed', 'purchased'].includes(resolved.action)) {
    resolved = createEvent({ ...resolved, state: 'effective' });
  }
  return resolved;
}

function j001EventFromText(text, bodyFacts) {
  const compact = compactText(text);
  const future = bodyFacts.hasFutureDate || /예정|결정/u.test(compact);
  if (/상품|용역/u.test(compact)) {
    return createEvent({
      type: 'related-party',
      action: 'changed',
      state: 'effective',
      cause: 'internal-goods-services',
      subjectType: 'contract',
    });
  }
  if (/주식.*(?:처분|매도|양도).*(?:완료|결과)|(?:완료|결과).*주식.*(?:처분|매도|양도)/u.test(compact)) {
    return createEvent({
      type: 'related-party',
      action: 'disposed',
      state: 'effective',
      cause: 'affiliate-share-disposal',
      subjectType: 'securities',
    });
  }
  if (/출자|지분투자/u.test(compact)) {
    return createEvent({
      type: 'related-party',
      action: 'decided',
      state: 'proposed',
      cause: 'affiliate-equity-investment',
      subjectType: 'securities',
    });
  }
  if (/유가증권|채권|주식/u.test(compact) && /매수|취득/u.test(compact)) {
    return createEvent({
      type: 'related-party',
      action: future ? 'decided' : 'purchased',
      state: future ? 'proposed' : 'effective',
      cause: 'securities-purchase',
      subjectType: 'securities',
    });
  }
  if (/자금|금전/u.test(compact) && /대여/u.test(compact)) {
    return createEvent({
      type: 'related-party',
      action: future ? 'decided' : 'lent',
      state: future ? 'proposed' : 'effective',
      cause: 'related-party-loan',
      subjectType: 'contract',
    });
  }
  const object = /부동산/u.test(compact) ? 'real-estate' : /계약.*(?:권리|의무)|권리의무/u.test(compact) ? 'contract-right' : 'contract';
  const operation = /차입/u.test(compact) ? 'borrowed' : /증여/u.test(compact) ? 'donated' : /임차/u.test(compact) ? 'leased-in' : /임대/u.test(compact) ? 'leased-out' : /변경|승계/u.test(compact) ? 'updated' : 'reported';
  return createEvent({
    type: 'related-party',
    action: future ? 'decided' : operation,
    state: future ? 'proposed' : 'effective',
    cause: `related-party-${object}-${operation}`,
    subjectType: object,
  });
}

export function normalizeEventOntology(event, context) {
  const { input, bodyFacts, titleClaims } = context;
  const fullText = bodyFacts.fullText;
  if (input.disclosureDetailType === 'J001') return j001EventFromText(fullText, bodyFacts);
  if (input.disclosureDetailType === 'E004' && /취소|철회/u.test(fullText)) {
    return createEvent({ type: 'capital-change', action: 'cancelled', state: 'effective', cause: 'stock-option', subjectType: 'securities' });
  }
  if (input.disclosureDetailType === 'C004' && /(?:주식.*교환|주식.*이전)/u.test(fullText)) {
    return createEvent({ type: 'restructuring', action: titleClaims.completed ? 'completed' : 'decided', state: titleClaims.completed ? 'effective' : 'proposed', cause: 'share-exchange', subjectType: 'issuer' });
  }
  if (input.disclosureDetailType === 'C004' && /투자설명서/u.test(fullText)
    && /지분증권|채무증권|파생결합|증권발행/u.test(fullText)) {
    return createEvent({ type: 'capital-change', action: 'published', state: 'effective', cause: securitiesCauseFromText(fullText), subjectType: 'securities' });
  }
  if (/자진(?:해산|청산)|자발적(?:해산|청산)/u.test(fullText)) {
    return createEvent({ type: 'restructuring', action: 'decided', state: 'proposed', cause: 'voluntary-liquidation', subjectType: 'subsidiary' });
  }
  return createEvent(event);
}

export function arbitrateEventCandidates(candidates) {
  const events = [];
  for (const candidate of candidates) addEvent(events, candidate.event ?? candidate);
  return sortEvents(events);
}

export function scoreEventExtractionConfidence({ input, candidates, events }) {
  if (events.length === 0 || events.some((event) => event.type === 'other')) return 'low';
  if (!input.bodyText && ['C004', 'E004', 'J001'].includes(input.disclosureDetailType)) return 'medium';
  if (candidates.some((candidate) => candidate.confidence === 'medium')) return 'medium';
  return 'high';
}

export function evaluateDisclosureEventGate({ event, input, semanticCompact = '', source = 'document-candidate' }) {
  const normalizedInput = input.wrapperKind ? input : normalizeDisclosureEventGateInput(input);
  const bodyFacts = extractStructuredBodyFacts(normalizedInput);
  const titleClaims = buildTitleSemanticClaims(normalizedInput);
  const wrapped = runFilingWrapperGate(normalizedInput, event);
  const temporal = resolveTemporalEvent(wrapped, { bodyFacts, titleClaims });
  const normalized = normalizeEventOntology(temporal, {
    input: normalizedInput,
    bodyFacts,
    titleClaims,
    semanticCompact,
  });
  const confidence = (!bodyFacts.bodyAvailable && buildDetailPriorClaims(normalizedInput).requiresBody)
    || bodyFacts.releaseTimestampBlank
    ? 'medium'
    : 'high';
  return {
    event: normalized,
    confidence,
    evidence: [source, `wrapper:${normalizedInput.wrapperKind}`, bodyFacts.hasFutureDate ? 'temporal:future' : 'temporal:observed'],
  };
}

export function createGatedDisclosureEventCandidate(candidate) {
  const evaluated = evaluateDisclosureEventGate(candidate);
  return Object.freeze({
    event: evaluated.event,
    confidence: evaluated.confidence,
    evidence: Object.freeze([...evaluated.evidence]),
  });
}

const DOCUMENT_SEMANTIC_RULES = Object.freeze([
  [/자기주식취득신탁계약체결/u, { type: 'capital-change', action: 'contracted', cause: 'treasury-share-trust', subjectType: 'securities' }],
  [/자기주식취득신탁계약해지|신탁계약해지결과/u, { type: 'capital-change', action: 'terminated', cause: 'treasury-share-trust', subjectType: 'securities' }],
  [/자기주식취득결정/u, { type: 'capital-change', action: 'decided', cause: 'treasury-share-acquisition', subjectType: 'securities' }],
  [/자기주식처분결정/u, { type: 'capital-change', action: 'decided', cause: 'treasury-share-disposal', subjectType: 'securities' }],
  [/자기주식취득결과/u, { type: 'capital-change', action: 'completed', cause: 'treasury-share-acquisition', subjectType: 'securities' }],
  [/자기주식처분결과/u, { type: 'capital-change', action: 'completed', cause: 'treasury-share-disposal', subjectType: 'securities' }],
  [/신탁계약에의한취득상황/u, { type: 'capital-change', action: 'reported', cause: 'treasury-share-trust', subjectType: 'securities' }],
  [/감자결정/u, { type: 'capital-change', action: 'decided', cause: 'capital-reduction', subjectType: 'securities' }],
  [/자기신주인수권부사채만기전취득/u, { type: 'capital-change', action: 'acquired', cause: 'warrant-bond', subjectType: 'securities' }],
  [/상각형조건부자본증권발행|자본으로인정되는채무증권발행/u, { type: 'capital-change', action: 'decided', cause: 'contingent-capital-securities', subjectType: 'securities' }],
  [/주권관련사채권의취득/u, { type: 'capital-change', action: 'acquired', cause: 'equity-linked-bond', subjectType: 'securities' }],
  [/주권관련사채권의처분/u, { type: 'capital-change', action: 'disposed', cause: 'equity-linked-bond', subjectType: 'securities' }],
  [/해외증권시장주권등상장/u, { type: 'capital-change', action: 'listed', cause: 'overseas-listing', subjectType: 'securities' }],
  [/타법인주식및출자증권(?:양수|취득)/u, { type: 'restructuring', action: 'acquired', cause: 'equity-acquisition', subjectType: 'securities' }],
  [/타법인주식및출자증권(?:양도|처분)/u, { type: 'restructuring', action: 'disposed', cause: 'equity-disposal', subjectType: 'securities' }],
  [/유형자산양수|비유동자산취득/u, { type: 'restructuring', action: 'acquired', cause: 'asset-acquisition', subjectType: 'asset' }],
  [/영업양수/u, { type: 'restructuring', action: 'acquired', cause: 'business-acquisition', subjectType: 'business' }],
  [/회사합병결정/u, { type: 'restructuring', action: 'decided', cause: 'merger', subjectType: 'issuer' }],
  [/주식(?:의)?포괄적교환|주식교환.*이전/u, { type: 'restructuring', action: 'decided', cause: 'share-exchange', subjectType: 'issuer' }],
  [/합병등종료보고서/u, { type: 'restructuring', action: 'completed', cause: 'merger-or-reorganization', subjectType: 'issuer' }],
  [/채권은행등의관리절차개시/u, { type: 'insolvency', action: 'initiated', cause: 'creditor-bank-management', subjectType: 'issuer' }],
  [/회생절차개시신청/u, { type: 'insolvency', action: 'applied', cause: 'rehabilitation', subjectType: 'issuer' }],
  [/상장채권기한의이익상실/u, { type: 'insolvency', action: 'defaulted', cause: 'bond-default', subjectType: 'securities' }],
  [/소송등의제기|경영권분쟁소송/u, { type: 'legal-regulatory', action: 'filed', cause: 'litigation', subjectType: 'issuer' }],
  [/회계처리기준위반/u, { type: 'legal-regulatory', action: 'sanctioned', cause: 'accounting-violation', subjectType: 'issuer' }],
  [/중대재해관련형사처벌사실확인/u, { type: 'legal-regulatory', action: 'confirmed', cause: 'serious-industrial-accident-penalty', subjectType: 'issuer' }],
  [/중대재해발생/u, { type: 'legal-regulatory', action: 'occurred', cause: 'serious-industrial-accident', subjectType: 'issuer' }],
  [/특수관계인에대한자금대여/u, { type: 'material-contract', action: 'lent', cause: 'related-party-loan', subjectType: 'contract' }],
  [/단기차입금증가|부동산투자회사자금차입/u, { type: 'material-contract', action: 'borrowed', cause: 'financing', subjectType: 'contract' }],
  [/신규시설투자/u, { type: 'capital-expenditure', action: 'decided', cause: 'facility-investment', subjectType: 'asset' }],
  [/생산중단/u, { type: 'operating-status', action: 'halted', cause: 'production-suspension', subjectType: 'business' }],
  [/시공자선정/u, { type: 'material-contract', action: 'selected', cause: 'construction-project', subjectType: 'contract' }],
  [/경영권매각/u, { type: 'ownership-change', action: 'initiated', cause: 'control-sale', subjectType: 'ownership' }],
  [/최대주주변경/u, { type: 'ownership-change', action: 'changed', cause: 'controlling-shareholder', subjectType: 'ownership' }],
  [/지주회사의자회사탈퇴/u, { type: 'corporate-profile', action: 'changed', cause: 'subsidiary-exit', subjectType: 'issuer' }],
  [/자기주식소각계획/u, { type: 'corporate-action', action: 'planned', state: 'proposed', cause: 'share-cancellation', subjectType: 'securities' }],
  [/주주환원정책/u, { type: 'corporate-action', action: 'announced', state: 'proposed', cause: 'shareholder-return-policy', subjectType: 'securities' }],
  [/주식소각결정/u, { type: 'corporate-action', action: 'decided', cause: 'share-cancellation', subjectType: 'securities' }],
  [/주주명부폐쇄기간|주주명부폐쇄.*기준일|기준일설정/u, { type: 'corporate-action', action: 'decided', cause: 'record-date', subjectType: 'securities' }],
  [/부동산투자회사금전배당/u, { type: 'corporate-action', action: 'decided', cause: 'cash-dividend', subjectType: 'securities' }],
  [/의무보유.*(?:만료|해제)/u, { type: 'capital-change', action: 'lifted', cause: 'lockup', subjectType: 'securities' }],
  [/유상증자계획/u, { type: 'capital-change', action: 'planned', state: 'proposed', cause: 'rights-offering', subjectType: 'securities' }],
  [/소액공모실적보고서/u, { type: 'capital-change', action: 'completed', cause: 'equity-securities', subjectType: 'securities' }],
  [/유상증자.*(?:발행결과|청약결과)|증권발행(?:실적보고서|결과)/u, { type: 'capital-change', action: 'completed', cause: 'securities-issuance', subjectType: 'securities' }],
  [/유상증자신주발행가액/u, { type: 'capital-change', action: 'price-set', cause: 'rights-offering', subjectType: 'securities' }],
  [/증권신고서|소액공모공시서류/u, { type: 'capital-change', action: 'filed', cause: 'securities-issuance', subjectType: 'securities' }],
  [/투자설명서/u, { type: 'capital-change', action: 'published', cause: 'securities-offering', subjectType: 'securities' }],
  [/일괄신고/u, { type: 'capital-change', action: 'filed', cause: 'shelf-registration', subjectType: 'securities' }],
  [/의결권대리행사권유/u, { type: 'governance', action: 'solicited', cause: 'proxy-solicitation', subjectType: 'governance' }],
  [/임시주주총회결과/u, { type: 'governance', action: 'held', cause: 'shareholder-meeting', subjectType: 'governance' }],
  [/주주총회소집결의/u, { type: 'governance', action: 'convened', cause: 'shareholder-meeting', subjectType: 'governance' }],
  [/공개매수결과/u, { type: 'corporate-action', action: 'completed', cause: 'tender-offer', subjectType: 'securities' }],
  [/공개매수에관한의견/u, { type: 'corporate-action', action: 'opinion-filed', cause: 'tender-offer', subjectType: 'securities' }],
  [/공개매수(?:신고서|설명서)/u, { type: 'corporate-action', action: 'announced', cause: 'tender-offer', subjectType: 'securities' }],
  [/특정증권등거래계획철회/u, { type: 'ownership-change', action: 'withdrawn', cause: 'insider-trading-plan', subjectType: 'ownership' }],
  [/특정증권등거래계획보고/u, { type: 'ownership-change', action: 'reported', cause: 'insider-trading-plan', subjectType: 'ownership' }],
  [/임원.*주요주주특정증권등소유상황/u, { type: 'ownership-change', action: 'reported', cause: 'insider-ownership', subjectType: 'ownership' }],
  [/주요주주의주식보유변동/u, { type: 'ownership-change', action: 'reported', cause: 'major-shareholder', subjectType: 'ownership' }],
  [/주식등의대량보유상황/u, { type: 'ownership-change', action: 'reported', cause: 'large-shareholding', subjectType: 'ownership' }],
  [/최대주주등소유주식변동/u, { type: 'ownership-change', action: 'reported', cause: 'controlling-shareholder', subjectType: 'ownership' }],
  [/기업설명회\(IR\)개최/u, { type: 'corporate-event', action: 'scheduled', cause: 'investor-relations', subjectType: 'issuer' }],
  [/장래사업.*경영계획/u, { type: 'corporate-event', action: 'announced', cause: 'business-plan', subjectType: 'issuer' }],
  [/기업가치제고계획/u, { type: 'corporate-event', action: 'announced', cause: 'value-up-plan', subjectType: 'issuer' }],
  [/재무구조개선계획/u, { type: 'capital-change', action: 'planned', state: 'proposed', cause: 'capital-strengthening', subjectType: 'issuer' }],
  [/지속가능경영보고서/u, { type: 'sustainability', action: 'published', cause: 'sustainability-report', subjectType: 'issuer' }],
  [/결산실적공시예고/u, { type: 'earnings', action: 'scheduled', cause: 'earnings-release', subjectType: 'financials' }],
  [/연결재무제표기준영업실적등에대한전망/u, { type: 'earnings', action: 'forecasted', cause: 'earnings-guidance', subjectType: 'financials' }],
  [/풍문또는보도에대한해명/u, { type: 'disclosure-inquiry', action: 'responded', state: 'uncertain', cause: 'rumor-inquiry', subjectType: 'issuer' }],
  [/투자유의안내/u, { type: 'trading-status', action: 'warned', state: 'effective', cause: 'investor-caution', subjectType: 'listed-shares' }],
  [/상장적격성실질심사/u, { type: 'trading-status', action: 'under-review', state: 'effective', cause: 'listing-eligibility', subjectType: 'listed-shares' }],
  [/매매거래정지및정지해제\(풍문등조회공시\)/u, { type: 'trading-status', action: 'lifted', state: 'lifted', cause: 'rumor-inquiry', subjectType: 'listed-shares' }],
  [/매매거래정지및정지해제\(중요내용공시\)/u, { type: 'trading-status', action: 'lifted', state: 'lifted', cause: 'material-disclosure', subjectType: 'listed-shares' }],
  [/대규모기업집단현황공시/u, { type: 'governance', action: 'reported', cause: 'business-group-status', subjectType: 'governance' }],
  [/지급수단별.*지급기간별/u, { type: 'other', action: 'reported', cause: 'subcontract-payment-terms', subjectType: 'issuer' }],
]);

function addDocumentSemanticEvents(events, input, semanticCompact) {
  const refinedTypes = new Set();
  for (const [pattern, definition] of DOCUMENT_SEMANTIC_RULES) {
    if (!pattern.test(semanticCompact)) continue;
    if (refinedTypes.has(definition.type)) continue;
    const event = createEvent({
      ...definition,
      state: definition.state ?? correctionState(input),
    });
    for (let index = events.length - 1; index >= 0; index -= 1) {
      if (events[index].type === event.type) events.splice(index, 1);
    }
    addEvent(events, event);
    refinedTypes.add(event.type);
  }

  if (/증권신고서|증권발행실적보고서|투자설명서|일괄신고|소액공모/u.test(semanticCompact)) {
    const index = events.findIndex((event) => event.type === 'capital-change' && event.cause === 'securities-issuance');
    if (index >= 0) events[index] = createEvent({ ...events[index], cause: securitiesCauseFromText(semanticCompact) });
  }
}

function eventsFromFlatKeywords(input) {
  const events = [];
  const text = input.compact;
  const state = correctionState(input);

  if (/사업보고서/u.test(text)) addEvent(events, createEvent({ type: 'periodic-report', action: 'filed', state, cause: 'annual-report', subjectType: 'issuer' }));
  else if (/반기보고서/u.test(text)) addEvent(events, createEvent({ type: 'periodic-report', action: 'filed', state, cause: 'semiannual-report', subjectType: 'issuer' }));
  else if (/분기보고서/u.test(text)) addEvent(events, createEvent({ type: 'periodic-report', action: 'filed', state, cause: 'quarterly-report', subjectType: 'issuer' }));

  if (/주권?매매거래정지|매매거래정지|거래정지|기타시장안내/u.test(text)) {
    const action = /해제/u.test(text) ? 'lifted' : /기간변경/u.test(text) ? 'changed' : /NXT|시간외단일가매매제외/u.test(text) ? 'scope-changed' : 'halted';
    addEvent(events, createEvent({ type: 'trading-status', action, state: action === 'lifted' ? 'lifted' : 'effective', cause: causeFromText(text), subjectType: 'listed-shares' }));
  }
  if (/불성실공시/u.test(text)) addEvent(events, createEvent({ type: 'legal-regulatory', action: 'designated', state: 'effective', cause: 'disclosure-compliance', subjectType: 'issuer' }));
  if (/영문상호|상호변경|약명및영문명/u.test(text)) addEvent(events, createEvent({ type: 'corporate-profile', action: 'name-changed', state: 'effective', subjectType: 'issuer' }));
  if (/FDA|보완요구서한|CRL|품목허가/u.test(text)) {
    const action = /승인/u.test(text) && !/보완요구/u.test(text) ? 'approved' : 'received';
    addEvent(events, createEvent({ type: 'regulatory-product', action, state: 'effective', cause: action === 'approved' ? 'fda-approval' : 'fda-crl', subjectType: 'product' }));
  }
  if (/유상증자/u.test(text)) addEvent(events, createEvent({ type: 'capital-change', action: /결정/u.test(text) ? 'decided' : /발행가액/u.test(text) ? 'price-set' : 'announced', state, cause: 'rights-offering', subjectType: 'securities' }));
  if (/무상증자/u.test(text)) addEvent(events, createEvent({ type: 'capital-change', action: 'announced', state, cause: 'bonus-issue', subjectType: 'securities' }));
  if (/전환사채|전환가액/u.test(text)) addEvent(events, createEvent({ type: 'capital-change', action: /조정/u.test(text) ? 'adjusted' : 'decided', state, cause: /조정/u.test(text) ? 'convertible-price' : 'convertible-bond', subjectType: 'securities' }));
  if (/자기주식취득신탁계약해지|신탁계약해지/u.test(text)) addEvent(events, createEvent({ type: 'capital-change', action: 'terminated', state, cause: 'treasury-share-trust', subjectType: 'securities' }));
  if (/주식매수선택권/u.test(text)) addEvent(events, createEvent({ type: 'capital-change', action: 'granted', state, cause: 'stock-option', subjectType: 'securities' }));
  if (/비유동자산취득|자산양수/u.test(text)) addEvent(events, createEvent({ type: 'restructuring', action: 'acquired', state, cause: 'asset-acquisition', subjectType: 'asset' }));
  if (/합병등종료|합병완료/u.test(text)) addEvent(events, createEvent({ type: 'restructuring', action: 'completed', state, cause: 'merger', subjectType: 'issuer' }));
  if (/채무보증/u.test(text)) addEvent(events, createEvent({ type: 'material-contract', action: 'guaranteed', state, cause: 'debt-guarantee', subjectType: 'contract' }));
  if (/단일판매.*공급계약|공급계약체결/u.test(text)) addEvent(events, createEvent({ type: 'material-contract', action: 'contracted', state, cause: 'supply-contract', subjectType: 'contract' }));
  if (/주식등의대량보유|최대주주등소유주식변동/u.test(text)) addEvent(events, createEvent({ type: 'ownership-change', action: 'reported', state, cause: 'large-shareholding', subjectType: 'ownership' }));
  if (/임원.*주요주주.*거래계획철회/u.test(text)) addEvent(events, createEvent({ type: 'ownership-change', action: 'withdrawn', state, cause: 'insider-trading-plan', subjectType: 'ownership' }));
  if (/공개매수/u.test(text)) addEvent(events, createEvent({ type: 'corporate-action', action: 'announced', state, cause: 'tender-offer', subjectType: 'securities' }));
  if (/현금.*배당결정/u.test(text)) addEvent(events, createEvent({ type: 'corporate-action', action: 'decided', state, cause: 'cash-dividend', subjectType: 'securities' }));
  if (/주주총회소집/u.test(text)) addEvent(events, createEvent({ type: 'governance', action: 'convened', state, cause: 'shareholder-meeting', subjectType: 'governance' }));
  if (/사외이사/u.test(text)) addEvent(events, createEvent({ type: 'governance', action: 'changed', state, cause: 'outside-director', subjectType: 'governance' }));
  if (/감사보고서|감사의견/u.test(text)) addEvent(events, createEvent({ type: 'audit', action: 'submitted', state, cause: /의견거절/u.test(text) ? 'disclaimer-of-opinion' : 'audit-report', subjectType: 'audit-opinion' }));
  if (/해산/u.test(text)) addEvent(events, createEvent({ type: 'insolvency', action: 'dissolved', state, cause: 'dissolution', subjectType: 'issuer' }));
  if (/잠정.*실적|영업\(잠정\)실적/u.test(text)) addEvent(events, createEvent({ type: 'earnings', action: 'announced', state: 'preliminary', cause: 'operating-results', subjectType: 'financials' }));
  if (/조회공시요구.*답변/u.test(text)) addEvent(events, createEvent({ type: 'disclosure-inquiry', action: 'responded', state: /미확정/u.test(text) ? 'uncertain' : null, cause: 'rumor-inquiry', subjectType: 'issuer' }));
  if (/기업설명회\(IR\)개최/u.test(text)) addEvent(events, createEvent({ type: 'corporate-event', action: 'scheduled', state, cause: 'investor-relations', subjectType: 'issuer' }));
  if (/특수관계인|대규모내부거래/u.test(text)) addEvent(events, createEvent({ type: 'related-party', action: 'reported', state, cause: 'internal-transaction', subjectType: 'issuer' }));

  return events;
}

function eventsFromStructuredTitle(input) {
  const events = eventsFromFlatKeywords({ ...input, compact: input.compact.replaceAll('기타시장안내', '') });
  const text = input.compact;

  if (/기타시장안내.*(?:영문상호|약명및영문명)/u.test(text)) {
    return [createEvent({ type: 'corporate-profile', action: 'name-changed', state: 'effective', subjectType: 'issuer' })];
  }

  if (/불성실공시법인미지정/u.test(text)) {
    return [createEvent({
      type: 'legal-regulatory',
      action: 'not-designated',
      state: /지정유예/u.test(text) ? 'deferred' : 'effective',
      cause: 'disclosure-compliance',
      subjectType: 'issuer',
    })];
  }

  if (/불성실공시법인지정해제/u.test(text)) {
    return [createEvent({ type: 'legal-regulatory', action: 'designation-lifted', state: 'lifted', cause: 'disclosure-compliance', subjectType: 'issuer' })];
  }

  if (/불성실공시법인지정/u.test(text)) {
    return [createEvent({ type: 'legal-regulatory', action: 'designated', state: 'effective', cause: 'disclosure-compliance', subjectType: 'issuer' })];
  }

  if (/NXT경쟁매매대상종목지정|시간외단일가매매제외/u.test(text)) {
    return [createEvent({ type: 'trading-status', action: 'scope-changed', state: 'effective', cause: 'nxt-trading', subjectType: 'listed-shares' })];
  }

  return events;
}

function detailDefaultEvent(input) {
  const explicit = DETAIL_EVENT_DEFAULTS[input.disclosureDetailType];
  if (explicit) return createEvent({ ...explicit, state: correctionState(input) });

  const detail = DETAIL_BY_CODE.get(input.disclosureDetailType);
  if (!detail || detail.mode !== 'exact') return null;
  const type = CATEGORY_TO_EVENT_TYPE[detail.defaultCategory];
  if (!type || type === 'other') return null;
  const action = {
    'periodic-report': 'filed',
    'capital-change': 'filed',
    restructuring: 'filed',
    'ownership-change': 'reported',
    governance: 'reported',
    audit: 'submitted',
    'related-party': 'reported',
    'corporate-action': 'announced',
  }[type] ?? 'reported';
  return createEvent({ type, action, state: correctionState(input) });
}

export function extractEventsLegacyCategoryProjection(entry = {}) {
  const classified = classifyDisclosureFiling(entry);
  const categories = Array.isArray(classified.categories) ? classified.categories : [classified.primaryCategory];
  const events = [];
  for (const category of categories) {
    const type = CATEGORY_TO_EVENT_TYPE[category];
    if (type && type !== 'other') addEvent(events, createEvent({ type }));
  }
  if (events.length === 0) addEvent(events, createEvent({ type: 'other' }));
  return result('legacy-category-projection', events, classified.classificationConfidence ?? 'low', classified.classificationReasons ?? []);
}

export function extractEventsFlatKeywordProjection(entry = {}) {
  const input = normalizeInput(entry);
  const events = eventsFromFlatKeywords(input);
  if (events.length === 0) addEvent(events, createEvent({ type: 'other' }));
  return result('flat-keyword-projection', events, events[0]?.type === 'other' ? 'low' : 'medium', ['flat-title-keywords']);
}

export function extractEventsStructuredTitleProjection(entry = {}) {
  const input = normalizeInput(entry);
  const events = eventsFromStructuredTitle(input);
  if (events.length === 0) addEvent(events, createEvent({ type: 'other' }));
  return result('structured-title-projection', events, events[0]?.type === 'other' ? 'low' : 'high', ['wrapper-aware-title-structure']);
}

export function extractEventsHybridProjection(entry = {}) {
  const input = normalizeInput(entry);
  const events = eventsFromStructuredTitle(input);
  const hasStructuredTitleEvent = events.length > 0;
  const detailEvent = detailDefaultEvent(input);

  if (detailEvent) {
    if (events.length === 0) addEvent(events, detailEvent);
    else if (events.some((event) => event.type === detailEvent.type)) mergeEvent(events, detailEvent);
  }

  if (events.length === 0 && input.disclosureType) {
    const broadCategory = OPEN_DART_BROAD_TYPE_DEFAULTS[input.disclosureType];
    const broadType = CATEGORY_TO_EVENT_TYPE[broadCategory];
    if (broadType && broadType !== 'other') addEvent(events, createEvent({ type: broadType, state: correctionState(input) }));
  }

  if (events.length === 0) addEvent(events, createEvent({ type: 'other' }));
  const exactDetail = DETAIL_BY_CODE.get(input.disclosureDetailType)?.mode === 'exact';
  const confidence = events[0]?.type === 'other' ? 'low' : exactDetail || hasStructuredTitleEvent ? 'high' : 'medium';
  return result('structured-hybrid-projection', events, confidence, [
    'wrapper-aware-title-structure',
    ...(detailEvent ? [`detail-type:${input.disclosureDetailType}`] : []),
  ]);
}

export function extractEventsDocumentAwareProjection(entry = {}) {
  const input = normalizeInput(entry);
  const bodySubject = extractDocumentSubject(input.bodyText);
  const semanticCompact = compactText([
    input.reportName,
    input.remarks,
    bodySubject,
  ].filter(Boolean).join(' '));
  const semanticInput = { ...input, compact: semanticCompact };
  const events = eventsFromStructuredTitle(semanticInput);
  addDocumentSemanticEvents(events, input, semanticCompact);

  if (input.disclosureDetailType === 'C004') {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      if (['capital-change', 'restructuring'].includes(events[index].type)) events.splice(index, 1);
    }
    const action = /발행실적|결과/u.test(semanticCompact)
      ? 'completed'
      : /투자설명서/u.test(semanticCompact)
        ? 'published'
        : 'filed';
    addEvent(events, createEvent({
      type: 'restructuring',
      action,
      state: correctionState(input),
      cause: securitiesCauseFromText(semanticCompact) === 'securities-issuance'
        ? 'reorganization'
        : securitiesCauseFromText(semanticCompact),
      subjectType: 'issuer',
    }));
  }

  if (input.disclosureDetailType === 'E003') {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      if (events[index].type === 'restructuring') events.splice(index, 1);
    }
    const cause = /자산양수도/u.test(semanticCompact)
      ? 'asset-transfer'
      : /주식.*교환|주식.*이전/u.test(semanticCompact)
        ? 'share-exchange'
        : /분할/u.test(semanticCompact)
          ? 'demerger'
          : 'merger';
    addEvent(events, createEvent({
      type: 'restructuring',
      action: 'completed',
      state: correctionState(input),
      cause,
      subjectType: cause === 'asset-transfer' ? 'asset' : 'issuer',
    }));
  }

  const securitiesCause = DETAIL_SECURITIES_CAUSE[input.disclosureDetailType];
  if (securitiesCause) {
    for (let index = 0; index < events.length; index += 1) {
      if (events[index].type === 'capital-change') {
        events[index] = createEvent({ ...events[index], cause: securitiesCause });
      }
    }
  }

  const detailEvent = detailDefaultEvent(input);
  if (detailEvent) {
    const matchingType = events.find((event) => event.type === detailEvent.type);
    if (matchingType) mergeEvent(events, detailEvent);
    else if (events.length === 0) addEvent(events, detailEvent);
  }

  if (events.length === 0 && input.disclosureType) {
    const broadCategory = OPEN_DART_BROAD_TYPE_DEFAULTS[input.disclosureType];
    const broadType = CATEGORY_TO_EVENT_TYPE[broadCategory];
    if (broadType && broadType !== 'other') {
      addEvent(events, createEvent({ type: broadType, state: correctionState(input) }));
    }
  }

  if (events.length === 0) addEvent(events, createEvent({ type: 'other' }));
  const usedBody = Boolean(input.bodyText && bodySubject);
  return result('document-aware-hierarchical-projection', events, events[0]?.type === 'other' ? 'low' : 'high', [
    'provider-detail-first',
    'structured-title-semantics',
    ...(usedBody ? ['document-subject-fallback'] : []),
  ]);
}

export function extractEventsGatedProjection(entry = {}) {
  const input = normalizeDisclosureEventGateInput(entry);
  const base = extractEventsDocumentAwareProjection(entry);
  const candidates = base.events.map((event) => createGatedDisclosureEventCandidate({
    event,
    input,
    source: 'document-candidate',
  }));
  const events = arbitrateEventCandidates(candidates);
  const confidence = scoreEventExtractionConfidence({ input, candidates, events });
  return {
    version: KR_DISCLOSURE_EVENT_GATED_VERSION,
    strategy: 'semantic-gate-v3',
    events,
    confidence,
    reasons: [
      'document-baseline-preserved',
      'semantic-gate-v3',
      ...new Set(candidates.flatMap((candidate) => candidate.evidence)),
    ],
  };
}

export const KR_DISCLOSURE_EVENT_EXTRACTOR_CANDIDATES = Object.freeze({
  legacy: extractEventsLegacyCategoryProjection,
  flat: extractEventsFlatKeywordProjection,
  structured: extractEventsStructuredTitleProjection,
  hybrid: extractEventsHybridProjection,
  document: extractEventsDocumentAwareProjection,
  gated: extractEventsGatedProjection,
});
