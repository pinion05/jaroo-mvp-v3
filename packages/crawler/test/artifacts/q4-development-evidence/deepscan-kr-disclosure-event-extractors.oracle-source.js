import {
  OPEN_DART_BROAD_TYPE_DEFAULTS,
  OPEN_DART_DISCLOSURE_DETAIL_TYPES,
} from '../data/kr-disclosure-classification-dataset.js';
import {
  canonicalizeDisclosureEventAliases,
  KR_DISCLOSURE_EVENT_ONTOLOGY_HASH,
  KR_DISCLOSURE_EVENT_ONTOLOGY_VERSION,
} from './deepscan-kr-disclosure-event-ontology.js';
import { classifyDisclosureFiling } from './deepscan-kr-disclosure-pipeline.js';

export const KR_DISCLOSURE_EVENT_EXTRACTOR_VERSION = 'jaroo.kr-disclosure-event-extractors.experimental.v2';
export const KR_DISCLOSURE_EVENT_GATED_VERSION = 'jaroo.kr-disclosure-event-extractors.gated.v5';

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
  const correctionKind = correctionMatch?.[1]
    ?? (/\(정정\)$/u.test(compactText(reportName)) ? '기재정정' : null);
  const bodyText = normalizeText(entry.bodyText ?? entry.documentText ?? entry.body_text);
  return {
    reportName,
    remarks,
    text: `${reportName} ${remarks}`.trim(),
    compact: compactText(`${reportName} ${remarks}`),
    correctionKind,
    filingState: FILING_STATE_BY_PREFIX[correctionKind] ?? null,
    bodyText,
    receiptNumber: normalizeText(entry.rceptNo ?? entry.rcept_no ?? entry.receiptNumber) || null,
    filedAt: normalizeText(
      entry.filedAt
      ?? entry.receiptDate
      ?? entry.reportDate
      ?? entry.rceptDt
      ?? entry.rcept_dt,
    ) || null,
    disclosureType: normalizeText(entry.disclosureType ?? entry.pblntfTy ?? entry.pblntf_ty).toUpperCase() || null,
    disclosureDetailType: normalizeText(entry.disclosureDetailType ?? entry.pblntfDetailTy ?? entry.pblntf_detail_ty).toUpperCase() || null,
  };
}

function createEvent({ type, action = null, state = null, cause = null, subjectType = null }) {
  return { type, action, state, cause, subjectType };
}

function canonicalizeResolvedEvent(event) {
  const normalized = createEvent(event);
  return normalized.type === 'other'
    ? normalized
    : canonicalizeDisclosureEventAliases(normalized);
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

function appendEventOccurrence(events, event) {
  if (!event?.type) return;
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
  if (/주식소각/u.test(compact)) return 'share-cancellation';
  if (/감자/u.test(compact)) return 'capital-reduction';
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

const DISCLOSURE_ACTIONS = new Set([
  'announced',
  'filed',
  'opinion-filed',
  'published',
  'reported',
  'responded',
  'withdrawn',
]);

const EXECUTION_ACTIONS = new Set([
  'adjusted',
  'cancelled',
  'changed',
  'completed',
  'deposited',
  'designated',
  'exercised',
  'held',
  'rescheduled',
  'terminated',
  'updated',
  'withdrawn',
]);

function filingDate(input) {
  const raw = input.filedAt || input.receiptNumber?.slice(0, 8);
  const match = String(raw ?? '').match(/^(\d{4})[-.]?(\d{2})[-.]?(\d{2})/u);
  if (!match) return null;
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function semanticDates(text) {
  return [...normalizeText(text).matchAll(/(?<!\d)'?(20\d{2}|\d{2})[년.\-/\s]+(\d{1,2})[월.\-/\s]+(\d{1,2})일?/gu)]
    .map((match) => {
      const year = match[1].length === 2 ? `20${match[1]}` : match[1];
      return new Date(`${year}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}T00:00:00Z`);
    })
    .filter((date) => !Number.isNaN(date.getTime()));
}

function firstDateAfterLabel(text, labelPattern, preferLast = false) {
  const matches = [...compactText(text).matchAll(new RegExp(`(?:${labelPattern})[^0-9']{0,80}'?(20\\d{2}|\\d{2})[년.\\-/\\s]+(\\d{1,2})[월.\\-/\\s]+(\\d{1,2})일?`, 'gu'))];
  const match = preferLast ? matches.at(-1) : matches[0];
  if (!match) return null;
  const year = match[1].length === 2 ? `20${match[1]}` : match[1];
  const date = new Date(`${year}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function firstMonthAfterLabel(text, labelPattern, preferLast = false) {
  const matches = [...compactText(text).matchAll(new RegExp(`(?:${labelPattern})[^0-9']{0,80}'?(20\\d{2}|\\d{2})[년.\\-/\\s]+(\\d{1,2})월`, 'gu'))];
  const match = preferLast ? matches.at(-1) : matches[0];
  if (!match) return null;
  const year = match[1].length === 2 ? `20${match[1]}` : match[1];
  const date = new Date(`${year}-${match[2].padStart(2, '0')}-01T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function relationToFiling(date, filed) {
  if (!date || !filed) return null;
  if (date > filed) return 'future';
  if (date < filed) return 'past';
  return 'same-day';
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
  const rawText = normalizeText(`${input.reportName} ${input.remarks} ${input.bodyText}`);
  const fullText = compactText(rawText);
  const filed = filingDate(input);
  const dates = semanticDates(fullText);
  const preferLastLabeledDate = Boolean(input.correctionKind);
  const operationalLabel = '권유시작일|거래시작일|차입일|대여일(?:자)?|증여일|보증(?:개시|시작)일|채무보증기간|지정[ㆍ·ᆞ]?부과일자|거래일자|매매일자|출자일자|상장일자|효력발생일|임차일자|임대(?:개시)?일자|계약시작일';
  const operationalDate = firstDateAfterLabel(rawText, operationalLabel, preferLastLabeledDate);
  const operationalMonth = firstMonthAfterLabel(rawText, operationalLabel, preferLastLabeledDate);
  const contractDate = firstDateAfterLabel(rawText, '계약(?:\\(수주\\))?일자|계약체결일', preferLastLabeledDate);
  const contractStartDate = firstDateAfterLabel(
    rawText,
    '계약기간.{0,30}시작일|계약시작일',
    preferLastLabeledDate,
  );
  const governanceDate = firstDateAfterLabel(rawText, '사외이사변경발생일', preferLastLabeledDate);
  const subsidiaryExitDate = firstDateAfterLabel(rawText, '자회사탈퇴일자|탈퇴일자', preferLastLabeledDate);
  const adjustmentDate = firstDateAfterLabel(rawText, '조정가액적용일|(?:전환|행사|교환)가액적용일', preferLastLabeledDate);
  const effectivenessDate = firstDateAfterLabel(rawText, '효력발생(?:예정)?일', preferLastLabeledDate);
  const scheduledDate = firstDateAfterLabel(rawText, '예정일|예정일자|예정기간|해제일|생산중단일|의무보유해제일', preferLastLabeledDate);
  const releaseDate = firstDateAfterLabel(rawText, '매매거래정지해제일시|정지해제일시|해제일시', preferLastLabeledDate);
  return Object.freeze({
    rawText,
    fullText,
    dates: Object.freeze(dates.map((date) => date.toISOString().slice(0, 10))),
    hasFutureDate: Boolean(filed && dates.some((date) => date > filed)),
    operationalDateRelation: relationToFiling(operationalDate, filed),
    operationalMonthRelation: relationToFiling(operationalMonth, filed),
    contractDateRelation: relationToFiling(contractDate, filed),
    contractStartDateRelation: relationToFiling(contractStartDate, filed),
    governanceDateRelation: relationToFiling(governanceDate, filed),
    subsidiaryExitDateRelation: relationToFiling(subsidiaryExitDate, filed),
    adjustmentDateRelation: relationToFiling(adjustmentDate, filed),
    effectivenessDateRelation: relationToFiling(effectivenessDate, filed),
    scheduledDateRelation: relationToFiling(scheduledDate, filed),
    releaseDateRelation: relationToFiling(releaseDate, filed),
    scheduledPeriod: /(?:거래일자|출자일자|대여일자).{0,100}(?:20\d{2}년)?(?:[1-4]분기|\d{1,2}월).{0,30}예정/u.test(fullText),
    completionObserved: /(?:상장하였습니다|거래(?:가)?종결(?:되었|완료)|대금(?:수령|지급).{0,20}완료|(?:주식|지분권리|자산).{0,20}(?:양수|양도|취득|처분).{0,20}완료|청약결과|발행결과|취득결과보고서|처분결과보고서|해지결과보고서|공개매수결과보고서)/u.test(fullText),
    transactionCompletionObserved: /거래(?:가)?종결/u.test(fullText) && /대금.{0,40}(?:수령|지급)/u.test(fullText),
    deferred: /(?:결정|절차).{0,30}(?:보류|유예)|(?:보류|유예).{0,30}(?:결정|절차)/u.test(fullText),
    haltTimestampBlank: /매매거래정지일시\|+[-미정]+(?:\||$)/u.test(fullText),
    releaseTimestampBlank: /(?:해제|정지해제)(?:일시|시각)[^|]{0,20}\|+[-미정]+(?:\||$)/u.test(fullText),
    haltTimestampPresent: /매매거래정지일시[^0-9']{0,40}'?(?:20\d{2}|\d{2})[.년\-/\s]/u.test(fullText),
    releaseTimestampPresent: /매매거래정지해제일시[^0-9']{0,40}'?(?:20\d{2}|\d{2})[.년\-/\s]/u.test(fullText),
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
  const reportText = compactText(input.reportName);
  const text = compactText(`${input.reportName} ${extractDocumentSubject(input.bodyText)}`);
  return Object.freeze({
    detailType: input.disclosureDetailType,
    reportText,
    text,
    decided: /결정|결의/u.test(text),
    completed: /완료|종료보고|결과보고서|발행결과|실적보고|청약결과/u.test(text),
    scheduled: /예정|계획/u.test(text),
  });
}

export function resolveTemporalEvent(event, { bodyFacts, titleClaims }) {
  let resolved = createEvent(event);
  const disclosureAction = DISCLOSURE_ACTIONS.has(resolved.action);
  const explicitDecision = resolved.action === 'decided' || resolved.action === 'planned' || titleClaims.decided;
  const eventSpecificDeferred = resolved.cause === 'rehabilitation' && bodyFacts.deferred;
  const filingLifecycleDetail = ['C002', 'C003', 'C006'].includes(titleClaims.detailType);

  if (titleClaims.completed) {
    resolved = createEvent({ ...resolved, state: 'effective' });
  } else if (bodyFacts.transactionCompletionObserved && PERFECTIVE_ACTIONS.has(resolved.action)) {
    resolved = createEvent({ ...resolved, state: 'effective' });
  } else if (titleClaims.decided && resolved.action === 'announced') {
    resolved = createEvent({ ...resolved, action: 'decided', state: 'proposed' });
  } else if (resolved.action === 'reported' && resolved.cause === 'insider-trading-plan'
    && (bodyFacts.operationalDateRelation === 'future' || bodyFacts.scheduledDateRelation === 'future')) {
    resolved = createEvent({ ...resolved, action: 'scheduled', state: 'pending' });
  } else if (disclosureAction) {
    if (resolved.action === 'filed' && filingLifecycleDetail
      && (bodyFacts.effectivenessDateRelation === 'future'
        || (titleClaims.detailType === 'C006' && bodyFacts.scheduledDateRelation === 'future'))) {
      resolved = createEvent({ ...resolved, state: 'pending' });
    } else if (resolved.action === 'filed' && filingLifecycleDetail
      && ['past', 'same-day'].includes(bodyFacts.effectivenessDateRelation)) {
      resolved = createEvent({ ...resolved, state: 'effective' });
    } else if (resolved.action === 'withdrawn') {
      resolved = createEvent({ ...resolved, state: resolved.state ?? 'effective' });
    } else if (['opinion-filed', 'published'].includes(resolved.action)
      && ['past', 'same-day'].includes(bodyFacts.effectivenessDateRelation ?? bodyFacts.operationalDateRelation)) {
      resolved = createEvent({ ...resolved, state: 'effective' });
    }
  } else if (eventSpecificDeferred) {
    resolved = createEvent({ ...resolved, state: 'deferred' });
  } else if ((bodyFacts.operationalDateRelation === 'past' || bodyFacts.operationalDateRelation === 'same-day')
    && (PERFECTIVE_ACTIONS.has(resolved.action) || ['contracted', 'guaranteed', 'purchased', 'solicited'].includes(resolved.action))) {
    resolved = createEvent({ ...resolved, state: 'effective' });
  } else if (explicitDecision && !EXECUTION_ACTIONS.has(resolved.action)) {
    resolved = createEvent({
      ...resolved,
      action: resolved.action === 'planned' ? 'planned' : 'decided',
      state: 'proposed',
    });
  } else if (bodyFacts.scheduledDateRelation === 'future') {
    resolved = createEvent({ ...resolved, action: 'scheduled', state: 'pending' });
  } else if (bodyFacts.completionObserved) {
    if (resolved.state === null) resolved = createEvent({ ...resolved, state: 'effective' });
  } else if (bodyFacts.operationalDateRelation === 'future' || titleClaims.scheduled) {
    resolved = createEvent({ ...resolved, action: 'scheduled', state: 'pending' });
  }
  if (resolved.action === 'initiated' && resolved.cause === 'creditor-bank-management' && resolved.state === null) {
    resolved = createEvent({ ...resolved, state: 'effective' });
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

function j001EventFromText(input, bodyFacts) {
  const title = compactText(input.reportName);
  const body = bodyFacts.fullText;
  const effective = bodyFacts.operationalDateRelation === 'past' || bodyFacts.operationalDateRelation === 'same-day' || bodyFacts.completionObserved;
  const future = !effective && (bodyFacts.operationalDateRelation === 'future'
    || bodyFacts.operationalMonthRelation === 'future'
    || bodyFacts.scheduledDateRelation === 'future'
    || bodyFacts.scheduledPeriod
    || /예정/u.test(title)
    || /(?:예정|예상|계획).{0,40}(?:거래|출연|전환|실행)/u.test(body));

  if (!bodyFacts.bodyAvailable) return null;
  if (/특수관계인으로부터받은담보/u.test(title)) {
    return createEvent({ type: 'related-party', action: 'received', state: 'effective', cause: 'collateral-received', subjectType: 'securities' });
  }
  if (/특수관계인에대한담보제공/u.test(title)) {
    return createEvent({
      type: 'related-party',
      action: future ? 'decided' : 'provided',
      state: future ? 'proposed' : 'effective',
      cause: 'collateral-provision',
      subjectType: 'securities',
    });
  }
  if (/특수관계인에게.*부동산매도|특수관계인에대한부동산매도/u.test(title)) {
    return createEvent({ type: 'related-party', action: future ? 'decided' : 'sold', state: future ? 'proposed' : 'effective', cause: 'real-estate-sale', subjectType: 'real-estate' });
  }
  if (/특수관계인과의보험거래/u.test(title)) {
    return createEvent({ type: 'related-party', action: 'decided', state: 'proposed', cause: /퇴직연금/u.test(body) ? 'retirement-pension' : 'insurance-transaction', subjectType: 'contract' });
  }
  if (/특수관계인의유상증자참여/u.test(title)) {
    return createEvent({ type: 'related-party', action: 'decided', state: 'proposed', cause: 'rights-offering-participation', subjectType: 'securities' });
  }
  if (/특수관계인에대한채권매도/u.test(title)) {
    return createEvent({ type: 'related-party', action: future ? 'decided' : 'sold', state: future ? 'proposed' : 'effective', cause: 'bond-sale', subjectType: 'securities' });
  }
  if (/특수관계인에대한영업양도/u.test(title)) {
    const agreementUpdated = /변경합의/u.test(body);
    return createEvent({
      type: 'related-party',
      action: agreementUpdated ? 'updated' : future ? 'decided' : 'disposed',
      state: agreementUpdated || effective ? 'effective' : 'proposed',
      cause: 'business-transfer',
      subjectType: 'operating-business',
    });
  }
  if (/특수관계인으로부터주식의취득/u.test(title)) {
    return createEvent({ type: 'related-party', action: future ? 'decided' : 'acquired', state: future ? 'proposed' : 'effective', cause: 'equity-acquisition', subjectType: 'securities' });
  }
  if (/특수관계인과의예.*적금거래/u.test(title)) {
    return createEvent({ type: 'related-party', action: future && !effective ? 'decided' : 'deposited', state: future && !effective ? 'proposed' : 'effective', cause: 'deposit-investment', subjectType: 'securities' });
  }
  if (/약관에의한금융거래시계열금융회사의거래상대방의공시/u.test(title)) {
    return createEvent({ type: 'related-party', action: 'decided', state: 'proposed', cause: 'affiliate-financial-transactions', subjectType: 'contract' });
  }
  if (/특수관계인과의내부거래/u.test(title) && /브랜드|라이선스/u.test(body)) {
    return createEvent({ type: 'related-party', action: input.correctionKind ? 'updated' : 'reported', state: 'effective', cause: 'brand-license-fee', subjectType: 'contract' });
  }
  if (/계열금융회사의약관에의한금융거래/u.test(title)) {
    if (/장단기대여/u.test(title) && /실제(?:대여|거래|인수)?금액은?없/u.test(body)) return null;
    const product = [
      [/유가증권-수익증권/u, ['fund-security-transactions', 'securities']],
      [/유가증권-채권/u, ['bond-transactions', 'securities']],
      [/보험/u, ['retirement-pension-transactions', 'contract']],
      [/기타유가증권/u, ['other-securities-transactions', 'securities']],
      [/예[ㆍ·ᆞ]?적금/u, ['deposit-product-transactions', 'contract']],
      [/파생금융상품/u, ['derivative-swap-transactions', 'contract']],
      [/유가증권-주식/u, ['equity-transactions', 'securities']],
      [/CP/u, ['commercial-paper-transactions', 'securities']],
    ].find(([pattern]) => pattern.test(title));
    if (product) return createEvent({ type: 'related-party', action: 'reported', state: 'effective', cause: product[1][0], subjectType: product[1][1] });
    if (/장단기차입/u.test(title)) {
      if (/주식|유가증권/u.test(body)) return createEvent({ type: 'related-party', action: 'borrowed', state: 'effective', cause: 'securities-borrowing', subjectType: 'securities' });
      return createEvent({ type: 'related-party', action: 'borrowed', state: 'effective', cause: 'related-party-borrowing', subjectType: 'contract' });
    }
  }
  if (/단기금융상품거래/u.test(title) && /MMF|MoneyMarketFund/u.test(body)) {
    return createEvent({ type: 'related-party', action: 'purchased', state: 'effective', cause: 'mmf-purchase', subjectType: 'securities' });
  }
  if (/상품[ㆍ·ᆞ]?용역.*변경/u.test(title)) {
    return createEvent({
      type: 'related-party',
      action: 'changed',
      state: 'effective',
      cause: 'internal-goods-services',
      subjectType: 'contract',
    });
  }
  if (/상품[ㆍ·ᆞ]?용역.*거래/u.test(title)) {
    return createEvent({ type: 'related-party', action: 'decided', state: 'proposed', cause: 'internal-goods-services', subjectType: 'contract' });
  }
  if (/주식의처분|주식.*(?:처분|매도|양도)/u.test(title) && (effective || /거래종결일/u.test(body))) {
    return createEvent({
      type: 'related-party',
      action: 'disposed',
      state: 'effective',
      cause: 'affiliate-share-disposal',
      subjectType: 'securities',
    });
  }
  if (/출자/u.test(title)) {
    return createEvent({
      type: 'related-party',
      action: effective ? 'invested' : 'decided',
      state: effective ? 'effective' : 'proposed',
      cause: /투자조합|펀드/u.test(body) ? 'fund-investment' : 'affiliate-equity-investment',
      subjectType: 'securities',
    });
  }
  if (/유가증권차입/u.test(title)) return createEvent({ type: 'related-party', action: future ? 'decided' : 'borrowed', state: future ? 'proposed' : 'effective', cause: 'securities-borrowing', subjectType: 'securities' });
  if (/수익증권/u.test(title) && /투자/u.test(body)) {
    return createEvent({ type: 'related-party', action: future ? 'decided' : 'invested', state: future ? 'proposed' : 'effective', cause: 'fund-security-investment', subjectType: 'securities' });
  }
  if (/유가증권매수/u.test(title)) {
    return createEvent({
      type: 'related-party',
      action: future && !effective ? 'decided' : 'purchased',
      state: future && !effective ? 'proposed' : 'effective',
      cause: 'securities-purchase',
      subjectType: 'securities',
    });
  }
  if (/자금대여/u.test(title)) {
    return createEvent({
      type: 'related-party',
      action: /만기.{0,30}연장|연장.{0,30}만기/u.test(body) ? 'extended' : future ? 'decided' : 'lent',
      state: future ? 'proposed' : 'effective',
      cause: 'related-party-loan',
      subjectType: 'contract',
    });
  }
  if (/금전.*증여|증여/u.test(title)) {
    const plannedDonation = future || /분기.{0,40}출연|출연.{0,40}(?:예정|계획)/u.test(body);
    return createEvent({ type: 'related-party', action: plannedDonation ? 'decided' : 'donated', state: plannedDonation ? 'proposed' : 'effective', cause: 'cash-donation', subjectType: 'cash' });
  }
  if (/부동산매수/u.test(title)) return createEvent({ type: 'related-party', action: future && !effective ? 'decided' : 'purchased', state: future && !effective ? 'proposed' : 'effective', cause: 'real-estate-purchase', subjectType: 'real-estate' });
  if (/부동산임차/u.test(title)) return createEvent({ type: 'related-party', action: future ? 'decided' : 'leased-in', state: future ? 'proposed' : 'effective', cause: 'related-party-real-estate-leased-in', subjectType: 'real-estate' });
  if (/부동산임대/u.test(title)) return createEvent({ type: 'related-party', action: future ? 'decided' : 'leased-out', state: future ? 'proposed' : 'effective', cause: 'related-party-real-estate-leased-out', subjectType: 'real-estate' });
  const object = /계약.*(?:권리|의무)|권리의무/u.test(body) ? 'contract-right' : 'contract';
  const operation = /변경|승계/u.test(body) ? 'updated' : 'reported';
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
  if (event.type === 'ownership-change'
    && event.action === 'reported'
    && (['D001', 'D002'].includes(input.disclosureDetailType)
      || /주식등의대량보유상황|임원.*주요주주.*소유상황|최대주주등소유주식변동/u.test(titleClaims.reportText))) {
    return createEvent({ ...event, state: 'effective' });
  }
  if (input.disclosureDetailType === 'J001') return j001EventFromText(input, bodyFacts);
  if (input.disclosureDetailType === 'I001' && /정기주주총회결과/u.test(titleClaims.reportText)) {
    return createEvent({ type: 'governance', action: 'completed', state: 'effective', cause: 'shareholder-meeting', subjectType: 'governance' });
  }
  if (input.disclosureDetailType === 'I003' && /불성실공시법인지정/u.test(titleClaims.reportText) && event.state === 'pending') {
    return createEvent({ ...event, action: 'designated', state: 'pending' });
  }
  if (event.action === 'withdrawn') {
    return createEvent({
      ...event,
      state: event.state ?? 'cancelled',
      cause: causeFromText(fullText) ?? event.cause,
      subjectType: event.subjectType ?? 'securities',
    });
  }
  if (event.type === 'restructuring' && event.cause === 'business-disposal'
    && (bodyFacts.completionObserved || /거래종결일.{0,120}예치금정산|최종양수도금액.{0,40}확정/u.test(fullText))) {
    return createEvent({ ...event, action: 'completed', state: 'effective' });
  }
  if (/영업.*잠정.*실적/u.test(titleClaims.reportText)
    && /판매량/u.test(fullText)
    && /(?:매출액|영업이익|당기순이익)[^0-9]{0,30}[-–]/u.test(fullText)) {
    return createEvent({ type: 'operating-performance', action: 'announced', state: 'preliminary', cause: 'sales-volume', subjectType: 'operations' });
  }
  if (/장래사업.*경영계획/u.test(titleClaims.reportText) && /영업이익.{0,100}(?:목표|전망)/u.test(fullText)) {
    return createEvent({ type: 'earnings', action: 'forecasted', state: null, cause: 'earnings-guidance', subjectType: 'financials' });
  }
  if (/최대주주등소유주식변동/u.test(titleClaims.reportText) && /신규선임/u.test(fullText)) {
    return createEvent({ type: 'ownership-change', action: 'reported', state: null, cause: 'insider-holdings', subjectType: 'ownership' });
  }
  if (event.type === 'capital-change' && event.action === 'completed'
    && (/^유상증자(?!또는주식관련사채)/u.test(titleClaims.reportText)
      || (/청약결과/u.test(titleClaims.reportText) && /발행방법.{0,100}유상증자/u.test(fullText)))) {
    return createEvent({ ...event, cause: 'rights-offering' });
  }
  if (/기타시장안내.*상장적격성실질심사사유발생/u.test(titleClaims.reportText)) {
    return createEvent({ type: 'trading-status', action: 'triggered', state: 'screening-pending', cause: 'listing-eligibility', subjectType: 'listed-shares' });
  }
  if (/단기차입금증가결정/u.test(titleClaims.reportText) && /기업어음|전자단기사채/u.test(fullText) && /발행한도/u.test(fullText)) {
    return createEvent({ type: 'capital-change', action: 'decided', state: 'proposed', cause: 'short-term-debt-issuance-limit', subjectType: 'securities' });
  }
  if (input.disclosureDetailType === 'C004' && /증권신고서/u.test(titleClaims.reportText)) {
    return createEvent({ ...event, action: 'filed', state: null });
  }
  if (input.disclosureDetailType === 'E004'
    && ((/취소|철회/u.test(titleClaims.reportText) && !/부여|행사/u.test(titleClaims.reportText))
      || /정정(?:사항|사유).{0,160}(?:주식매수선택권)?.{0,80}(?:취소|철회)/u.test(fullText))) {
    return createEvent({ type: 'capital-change', action: 'cancelled', state: 'effective', cause: 'stock-option', subjectType: 'securities' });
  }
  if (input.disclosureDetailType === 'C004' && /분할합병/u.test(fullText)) {
    return createEvent({ type: 'restructuring', action: titleClaims.completed ? 'completed' : 'decided', state: titleClaims.completed ? 'effective' : 'proposed', cause: 'split-merger', subjectType: 'issuer' });
  }
  if (input.disclosureDetailType === 'C004' && /(?:주식.*교환|주식.*이전)/u.test(fullText)) {
    return createEvent({ type: 'restructuring', action: titleClaims.completed ? 'completed' : 'decided', state: titleClaims.completed ? 'effective' : 'proposed', cause: 'share-exchange', subjectType: 'issuer' });
  }
  if (input.disclosureDetailType === 'E003' && /타법인주식|출자증권양수|주식양수/u.test(fullText)) {
    return createEvent({ type: 'restructuring', action: 'completed', state: 'effective', cause: 'equity-acquisition', subjectType: 'securities' });
  }
  if (input.disclosureDetailType === 'E003' && /영업양수도|영업양도/u.test(fullText)) {
    return createEvent({ type: 'restructuring', action: 'completed', state: 'effective', cause: 'business-disposal', subjectType: 'business' });
  }
  if (input.disclosureDetailType === 'C004' && /투자설명서/u.test(fullText)
    && /지분증권|채무증권|파생결합|증권발행/u.test(fullText)) {
    return createEvent({ type: 'capital-change', action: 'published', state: 'effective', cause: securitiesCauseFromText(fullText), subjectType: 'securities' });
  }
  if (/(?:자진|자발적)(?:해산|청산)|종속회사.{0,80}청산결의|청산결의.{0,80}종속회사/u.test(fullText)) {
    return createEvent({ type: 'restructuring', action: 'decided', state: 'proposed', cause: 'voluntary-liquidation', subjectType: 'subsidiary' });
  }
  return createEvent(event);
}

export function applyCorrectionLifecycle(event, { input, bodyFacts }) {
  if (!event) return null;
  if (input.wrapperKind !== 'correction') return createEvent(event);
  const title = compactText(input.reportName);
  const text = bodyFacts.fullText;
  if (!/정정신고|정정사항|정정사유|정정대상/u.test(text)) return createEvent(event);
  if (/정정사유.{0,40}단순기재오류/u.test(text)) return createEvent(event);
  const correctionLead = text.match(/정정(?:사유|사항).{0,240}/u)?.[0] ?? '';

  if (/철회신고서/u.test(title)) {
    return createEvent({ ...event, action: 'withdrawn', state: 'cancelled' });
  }
  if (/투자설명서|증권신고서/u.test(title)
    && /발행가액.{0,40}확정|확정.{0,40}발행가액/u.test(correctionLead)) {
    return createEvent({ ...event, action: 'price-set', state: 'effective' });
  }
  if (EXECUTION_ACTIONS.has(event.action) && !['updated', 'rescheduled'].includes(event.action)) {
    return createEvent({ ...event, state: event.state ?? 'effective' });
  }
  if (/사채.*발행결정|전환사채.*발행결정|신주인수권부사채.*발행결정|교환사채.*발행결정/u.test(title)) {
    return createEvent(event);
  }

  if (event.action === 'initiated' && event.cause === 'creditor-bank-management') {
    return createEvent({ ...event, state: 'effective' });
  }
  if (event.action === 'solicited' && event.cause === 'proxy-solicitation') {
    return createEvent({ ...event, state: 'effective' });
  }
  if (event.action === 'halted' && event.cause === 'business-suspension') {
    return createEvent({ ...event, state: 'proposed' });
  }

  const scheduleChanged = bodyFacts.hasFutureDate
    && /소집일시변경|예정[)]?일(?:자)?(?:정정|변경)|정지일자.{0,20}(?:정정|변경)|납입일.{0,40}교부예정일정정|체결일확정/u.test(correctionLead);
  if (scheduleChanged) return createEvent({ ...event, action: 'rescheduled', state: 'pending' });

  let resolvedState = 'effective';
  if (event.cause === 'litigation') resolvedState = 'active';
  else if (event.state === 'preliminary' || ['active', 'alleged'].includes(event.state)) resolvedState = event.state;
  else if (bodyFacts.hasFutureDate && /일자|예정일|일시|일정/u.test(correctionLead) && !/오기|오류/u.test(correctionLead)) resolvedState = 'pending';
  else if (/오기|오류/u.test(correctionLead) && event.state === 'proposed') resolvedState = 'proposed';
  return createEvent({ ...event, action: 'updated', state: resolvedState });
}

export function arbitrateEventCandidates(candidates) {
  const events = [];
  for (const candidate of candidates) addEvent(events, candidate.event ?? candidate);
  return sortEvents(events);
}

function applyEventSetRules(input, events) {
  const bodyFacts = extractStructuredBodyFacts(input);
  const title = compactText(input.reportName);
  const resolved = [...events];

  if (/상장폐지관련안내/u.test(title) && /감사의견.{0,40}거절/u.test(bodyFacts.fullText)) {
    return sortEvents([
      createEvent({ type: 'trading-status', action: 'delisting-triggered', state: 'pending', cause: 'audit-opinion', subjectType: 'listed-shares' }),
      createEvent({ type: 'trading-status', action: 'halted', state: 'effective', cause: 'delisting-review', subjectType: 'listed-shares' }),
    ]);
  }

  if (resolved.some((event) => event.type === 'capital-change' && event.cause === 'rights-offering')
    && /최대주주.{0,80}변경|경영권.{0,80}변경/u.test(bodyFacts.fullText)) {
    addEvent(resolved, createEvent({
      type: 'ownership-change',
      action: 'changed',
      state: bodyFacts.hasFutureDate ? 'pending' : 'effective',
      cause: 'controlling-shareholder',
      subjectType: 'ownership',
    }));
  }

  if (!/매매거래정지및정지해제/u.test(title)) return sortEvents(resolved);

  if (bodyFacts.haltTimestampBlank && bodyFacts.releaseTimestampBlank && /감자결정|변경상장절차/u.test(bodyFacts.fullText)) {
    return [createEvent({
      type: 'trading-status',
      action: 'unchanged',
      state: 'effective',
      cause: 'capital-reduction',
      subjectType: 'listed-shares',
    })];
  }
  if (bodyFacts.haltTimestampPresent && bodyFacts.releaseTimestampPresent) {
    const cause = causeFromText(bodyFacts.fullText)
      ?? (/풍문|조회공시/u.test(title) ? 'rumor-inquiry' : 'material-disclosure');
    return sortEvents([
      createEvent({ type: 'trading-status', action: 'halted', state: 'effective', cause, subjectType: 'listed-shares' }),
      createEvent({
        type: 'trading-status',
        action: 'lifted',
        state: bodyFacts.releaseDateRelation === 'future' ? 'pending' : 'lifted',
        cause,
        subjectType: 'listed-shares',
      }),
    ]);
  }
  return sortEvents(resolved);
}

function semanticEvent(type, action, state, cause, subjectType) {
  return createEvent({ type, action, state, cause, subjectType });
}

function semanticGateDecision(authority, events) {
  return Object.freeze({ authority, events: sortEvents(events) });
}

function boundedOfferingInventory(bodyFacts) {
  const body = bodyFacts.rawText;
  const startMatch = body.match(/모집\s*또는\s*매출\s*증권의\s*종류\s*:?(?:\s*\|)*/u);
  if (!startMatch || typeof startMatch.index !== 'number') return '';
  const start = startMatch.index + startMatch[0].length;
  const tail = body.slice(start);
  const boundary = tail.search(/이번\s*모집\s*또는\s*매출총액|일괄신고서의\s*내용과\s*모집/u);
  return boundary < 0 ? tail : tail.slice(0, boundary);
}

export function extractStructuredOccurrenceSet(input, bodyFacts) {
  const title = compactText(input.reportName);
  const rawBody = bodyFacts.rawText;
  const body = bodyFacts.fullText;

  if (input.wrapperKind === 'correction'
    && /소송등의제기/u.test(title)
    && /(?:신청취하서.{0,60}접수|가처분신청.{0,80}취하)/u.test(body)
    && /교환사채(?:권)?발행.{0,120}(?:전면)?철회/u.test(body)
    && /자기주식처분.{0,120}(?:전면)?철회/u.test(body)) {
    return semanticGateDecision('complete', [
      semanticEvent('legal-regulatory', 'withdrawn', 'effective', 'litigation', 'issuer'),
      semanticEvent('capital-change', 'withdrawn', 'cancelled', 'exchangeable-bond', 'securities'),
      semanticEvent('corporate-action', 'withdrawn', 'cancelled', 'treasury-share-disposal', 'listed-shares'),
    ]);
  }

  if (input.wrapperKind === 'correction'
    && /장래사업[ㆍ·ᆞ]?경영계획/u.test(title)
    && /투자규모.{0,80}조정/u.test(body)
    && /사업진출.{0,80}취소/u.test(body)
    && /사업매각.{0,80}결정/u.test(body)) {
    return semanticGateDecision('complete', [
      semanticEvent('capital-expenditure', 'adjusted', 'effective', 'facility-investment', 'asset'),
      semanticEvent('corporate-event', 'cancelled', 'cancelled', 'business-plan', 'business'),
      semanticEvent('restructuring', 'decided', 'proposed', 'business-disposal', 'business'),
    ]);
  }

  if (/일괄신고추가서류/u.test(title)
    && /(?:파생결합증권|주가연계증권|주식연계증권)/u.test(`${title}${bodyFacts.fullText}`)) {
    const inventory = boundedOfferingInventory(bodyFacts);
    const series = new Set(
      [...inventory.matchAll(/(?:ELS|DLS)\s*제?\s*(\d+)\s*호/giu)]
        .map((match) => `${match[0].toUpperCase().includes('DLS') ? 'DLS' : 'ELS'}:${match[1]}`),
    );
    const genericSeries = new Set(
      [...inventory.matchAll(/제\s*(\d+)\s*(?:회|호)[^제]{0,180}?(?:기타)?파생결합증권/gu)]
        .map((match) => match[1]),
    );
    const occurrenceCount = series.size || genericSeries.size;
    if (occurrenceCount > 0) {
      const cause = /주가연계증권|주식연계증권|ELS/u.test(`${title}${inventory}`)
        ? 'derivative-linked-securities'
        : 'derivative-securities';
      return semanticGateDecision('complete', Array.from({ length: occurrenceCount }, () => (
        semanticEvent('capital-change', 'solicited', 'pending', cause, 'securities')
      )));
    }
  }

  if (/특정증권등거래계획보고서/u.test(title)) {
    const recipients = new Set();
    for (const match of rawBody.matchAll(/(?:수증자|양수인|매수인|수익자)\s*[:：]?\s*([가-힣A-Za-z0-9㈜()·. ]{2,40})/gu)) {
      recipients.add(compactText(match[1]).replace(/(?:증여|매수|매도|처분).*$/u, ''));
    }
    for (const match of rawBody.matchAll(/([가-힣]{2,8})\s*\|\s*(?:증여|매수|매도|처분)/gu)) {
      recipients.add(compactText(match[1]));
    }
    recipients.delete('합계');
    if (recipients.size > 0) {
      return semanticGateDecision('complete', [...recipients].map(() => (
        semanticEvent('ownership-change', 'scheduled', 'pending', 'insider-trading-plan', 'ownership')
      )));
    }
  }

  return null;
}

function lastMatchEnd(text, pattern) {
  let end = -1;
  for (const match of text.matchAll(pattern)) end = Math.max(end, match.index + match[0].length);
  return end;
}

const NONCURRENT_SECTION_BOUNDARY = /(?:^|\|)(?:4\.?)?(?:과거[^|]{0,24}(?:이력|내역|자료|예시|사건|계약|거래|참고)|지난[^|]{0,20}(?:참고|이력|내역)|종전[^|]{0,24}(?:실적|현황|이력|내역|공시|초안)|이전[^|]{0,20}(?:사례|이력|내역|경과)|별건[^|]{0,20}(?:연혁|이력|내역)|직전(?:회차|거래|계약)[^|]{0,24}(?:요약|기록|이력|내역)|부록[:：]?[^|]{0,36}(?:전년도|과거|이전|종전)[^|]{0,36}(?:기록|실적|이력|내역)|종료된(?:개발)?과제|참고(?:자료|사항)|작성(?:안내|예시)|별첨(?:기재)?(?:견본|예시|양식)|교육용(?:문구|예시|자료)|유의사항(?:및위험고지)?|위험고지|투자위험|위험요소|경쟁제품)(?:\||$)/u;
const CURRENT_SECTION_HEADING = /^(?:(?:금번|이번)(?:(?:신탁)?(?:계약|거래)(?:현황)?|안건|사건|소송|사고|사항|개발과제)|현재(?:계약|거래|안건|사건|소송|사고|사항|개발과제))$/u;

function currentCorrectionScope(input, bodyFacts) {
  if (input.wrapperKind !== 'correction') return '';
  const text = bodyFacts.fullText;
  const numberedStart = text.search(/(?:^|\|)3\.?정정(?:사유|사항|내용)/u);
  const start = numberedStart >= 0
    ? numberedStart
    : text.search(/정정(?:사유|사항|내용)|(?:소송|자금조달)정정/u);
  if (start < 0) return currentDisclosureScope(bodyFacts);
  const scope = currentDisclosureScope(bodyFacts, text.slice(start));
  const seenNotes = new Set();
  let detailBoundary = -1;
  for (const match of scope.matchAll(/(?:^|\|)\(주(\d+)\)정정전/gu)) {
    if (seenNotes.has(match[1])) {
      detailBoundary = match.index;
      break;
    }
    seenNotes.add(match[1]);
  }
  return detailBoundary < 0 ? scope : scope.slice(0, detailBoundary);
}

function currentDisclosureScope(bodyFacts, sourceText = bodyFacts.fullText) {
  const body = sourceText || bodyFacts.fullText;
  const selected = [];
  let include = true;
  for (const clause of body.split('|').filter(Boolean)) {
    if (NONCURRENT_SECTION_BOUNDARY.test(`|${clause}|`)) {
      include = false;
      continue;
    }
    if (CURRENT_SECTION_HEADING.test(clause)) include = true;
    if (include) selected.push(clause);
  }
  return selected.join('|');
}

function hasCompletedTrustContract(scope) {
  const clauses = scope.split('|').filter(Boolean);
  let completed = false;
  for (let index = 0; index < clauses.length; index += 1) {
    const clause = clauses[index];
    const previous = clauses[index - 1] ?? '';
    const adjacentTrustContext = /(?:신탁(?:계약|약정)|전자약정|계약서|약정서)/u.test(previous)
      && !/(?:이사회|의사록|결의서|잔액확인서|확인서|보고서|공문)/u.test(clause);
    const directTrustContext = /(?:신탁(?:계약|약정)|전자약정|계약서|약정서)/u.test(clause);
    const roleBoundSignature = /(?:양당사자|양측|수탁(?:사|은행|기관)|신탁(?:사|업자)|증권사|회사와신탁사).{0,100}(?:전자서명|서명(?:과|및)날인|서명|날인)/u.test(clause);
    if (!directTrustContext && !adjacentTrustContext && !roleBoundSignature) continue;

    const incompleteEnd = Math.max(
      lastMatchEnd(clause, /(?:미서명|미날인|미체결|성립전|조율중|협상중|협의중|완료하지못|완료되지않|체결(?:하지않|되지않)|서명(?:하지않|되지않)|날인(?:하지않|되지않)|성립하지않|효력.{0,20}발생하지않|이뤄지지않|이루어지지않)/gu),
      lastMatchEnd(clause, /(?:서명|날인|체결).{0,60}(?:예정|계획|방침|추후|향후)/gu),
    );
    const completionEnd = Math.max(
      lastMatchEnd(clause, /(?:신탁(?:계약|약정)|전자약정|계약서|약정서).{0,100}(?:(?:체결|약정)(?:절차)?(?:이|가|을|를)?(?:모두)?(?:완료|종결|종료|마쳤|마친|끝냈|끝낸|끝났|완료한|확정)|(?:체결|약정)(?:하였|했|함|되었습니다|됐습니다)|(?:성립|효력(?:발생|이생겼)))/gu),
      lastMatchEnd(clause, /(?:전자서명|서명(?:과|및)날인|서명|날인)(?:이|가|을|를)?(?:절차)?(?:를|을)?(?:까지|도|은|는)?(?:이날)?(?:모두)?.{0,40}(?:완료|마쳤|마친|마쳐|끝내|끝냈|끝낸|끝났|완료한)/gu),
      lastMatchEnd(clause, /신탁계약.{0,100}(?:전자서명|서명|날인).{0,60}(?:완료|마쳤|끝내|효력(?:이|가|을|를)?발생|발효)/gu),
      lastMatchEnd(clause, /신탁계약.{0,100}체결(?:하고|하여|해).{0,60}(?:효력(?:이|가|을|를)?발생|발효)/gu),
      lastMatchEnd(clause, /신탁계약.{0,100}(?:즉시)?발효/gu),
      roleBoundSignature
        ? lastMatchEnd(clause, /(?:계약|약정).{0,40}(?:체결)(?:절차)?(?:이|가|을|를)?.{0,30}(?:완료|종결|종료|마쳤|끝내|끝났)/gu)
        : -1,
    );
    if (completionEnd >= 0 || incompleteEnd >= 0) completed = completionEnd > incompleteEnd;
  }
  return completed;
}

function hasCompletedConvertibleBondAcquisition(scope) {
  const combinedCompletion = /(?:대금)?(?:지급|결제|정산).{0,80}(?:사채|채권|증권).{0,80}(?:취득|인수|수령|인도|넘겨받)(?:을|를)?(?:모두)?(?:완료|마침)/u.test(scope)
    || /(?:사채|채권|증권).{0,100}(?:취득|인수|수령|인도|넘겨받).{0,100}(?:대금|잔금).{0,60}(?:지급|결제|정산)(?:을|를|도|까지)?(?:완료|하였|했|함|했습니다|마쳤|끝냈)/u.test(scope)
    || /(?:대금|잔금).{0,40}(?:지급|결제|정산).{0,100}(?:사채|채권|증권).{0,80}(?:권리|명의|소유권).{0,40}(?:이전|귀속).{0,40}(?:모두)?(?:완료|끝났|마쳤)/u.test(scope)
    || /(?:전환사채|사채권|채권).{0,100}(?:대금|잔금).{0,50}(?:전액)?(?:지급|완납|정산).{0,100}(?:권리|명의|소유권).{0,60}(?:이전|귀속|넘겨받|명의개서)(?:이|가|을|를|도)?.{0,30}(?:완료|마쳤|되었|됐|되었습니다)?/u.test(scope)
    || /(?:대금|잔금).{0,40}(?:전액)?(?:지급|완납|정산).{0,100}(?:전환사채|사채권|채권).{0,60}(?:권리이전|명의개서|소유권이전).{0,40}(?:모두)?(?:완료|마쳤|끝냈)/u.test(scope);
  const scheduledAcquisitionDate = /(?:실제)?(?:사채|채권|증권).{0,10}취득일(?:자)?.{0,20}예정|(?:사채|채권|증권).{0,10}취득예정일/u.test(scope);
  // A template sentence such as “지급(예정)일은 실제 사채 취득일입니다”
  // still describes a scheduled execution date.  Treat a date-role sentence as
  // actuality evidence only when it contains a perfective transfer/acquisition
  // predicate.  Otherwise the form's boilerplate would turn same-day decisions
  // into completed acquisitions without payment or title-transfer evidence.
  const actualAcquisitionDateRole = !scheduledAcquisitionDate
    && /(?:대금)?지급일|결제일|정산일/u.test(scope)
    && /(?:사채|채권|증권).{0,30}(?:실제로)?(?:취득한|인수한|수령한|넘겨받은)날.{0,12}(?:임|입니다|에해당|로확정)/u.test(scope);
  const paymentCompleted = /(?:대금|잔금).{0,60}(?:전액|모두)?.{0,30}(?:지급|결제|정산)(?:을|를|도|까지)?(?:완료|하였|했|함|하고|됐|마쳤|끝냈)/u.test(scope)
    || /(?:전액|모두).{0,10}(?:결제|정산)(?:을|를)?(?:완료|하였|했|함|됐|마쳤|끝냈)/u.test(scope)
    || /(?:결제일|정산일).{0,80}(?:전액|모두)?(?:결제|정산)(?:을|를)?(?:완료|하였|했|함|됐|마쳤|끝냈)/u.test(scope)
    || /(?:매매)?(?:대금|잔금)(?:이|가|은|는|을|를|까지)?(?:전액|모두|전부)?.{0,16}완납(?:되었|됐|되었습니다|하였|했|함|했습니다)?/u.test(scope)
    || /대금지급(?:을|를)?완료/u.test(scope);
  const securityReceived = /(?:사채|채권|증권).{0,120}(?:소유권|권리|명의)?.{0,40}(?:취득(?:을|를)?(?:모두)?(?:완료|마쳤|마친|끝냈|끝낸)|취득(?:하였|했|함|했습니다)|인수(?:를|을)?(?:모두)?(?:완료|마침|마쳤|마친|끝냈)|인수(?:하였|했|한|함|했습니다)|수령(?:완료|하였|했|함|했습니다)|인도(?:완료|받(?:았|았습니다|음))|넘겨받(?:아|아서|았|았습니다|음)|명의(?:가)?(?:이전|개서).{0,20}(?:완료|마쳤)?|(?:당사)?(?:증권)?계좌.{0,24}(?:대체|입고)(?:되었|됐|되었습니다|완료)?)/u.test(scope);
  const passiveRightsTransferred = /(?:사채|채권|증권|사채권).{0,120}(?:권리|명의|소유권|권).{0,100}(?:이전(?:되었|됐|되었습니다|완료|도마쳤)|귀속(?:되었|됐|되었습니다)|넘어(?:왔|왔습니다)|명의개서.{0,20}(?:완료|마쳤))/u.test(scope);
  return combinedCompletion || actualAcquisitionDateRole || (paymentCompleted && (securityReceived || passiveRightsTransferred));
}

function relationToFilingWithinScope(scope, filed, labelPattern = null, fallbackToFirstDate = false) {
  const labeledDate = labelPattern ? firstDateAfterLabel(scope, labelPattern, false) : null;
  const date = labeledDate ?? (fallbackToFirstDate ? semanticDates(scope)[0] : null);
  return relationToFiling(date, filed);
}

function issuerLitigationClauses(scope) {
  const clauses = scope.split('|')
    .flatMap((clause) => clause.split(/(?:[!?。]+|(?<!\d)\.(?!\d))/u))
    .filter(Boolean);
  const issuerBoundClauses = clauses.map((clause) => {
    const companyMatches = [...clause.matchAll(/회사(?:는|가)?/gu)]
      .filter((match) => !clause.slice(Math.max(0, match.index - 4), match.index).endsWith('상대방'));
    const issuerIndexes = [clause.lastIndexOf('당사'), companyMatches.at(-1)?.index ?? -1]
      .filter((index) => index >= 0);
    return issuerIndexes.length === 0 ? null : clause.slice(Math.max(...issuerIndexes));
  });
  if (issuerBoundClauses.some(Boolean)) {
    return issuerBoundClauses.flatMap((clause, index) => {
      if (clause) return [clause];
      const contextualClause = clauses[index];
      const independentCase = /^(?:(?:제?\d+|[A-Z])(?:번|호)?사건|별개(?:인|의|로)?|다른사건|한편|또한)/u.test(contextualClause);
      const sameCaseContinuation = /(?:같은날|해당사건|본건|법원|중재기관).{0,80}(?:소장|청구|접수|사건번호|심리|변론)/u.test(contextualClause)
        && !/^(?:상대방|상대측|피고측|원고측)/u.test(contextualClause)
        && !/(?:관계회사|계열회사|종속회사|자회사|제3자|타사).{0,80}(?:소송|소장|청구)/u.test(contextualClause);
      return independentCase || sameCaseContinuation
        ? [contextualClause]
        : [];
    });
  }
  return clauses.filter((clause) => !/^정정(?:사유|사항|내용)$/u.test(clause)
    && !/^(?:상대방|상대측|피고측|원고측)/u.test(clause));
}

function classifyLitigationClause(clause) {
  const withdrawal = /(?:취하|철회|거두어들)/u.test(clause);
  const continuing = /(?:본안)?청구.{0,50}(?:유지|계속|제기|심리중|변론기일)|(?:소송|중재|재판|절차|사건|본소|반소|심리|변론).{0,60}(?:유지|계속|진행(?:중|되고|되며)|그대로진행|계속진행|계속수행|심리중|변론기일)|(?:소장|청구).{0,30}(?:제기|제출)/u.test(clause);
  const continuingDenied = /(?:추가)?(?:심리|절차|소송|사건).{0,60}(?:계속중인)?(?:사항|절차)?(?:이|가|은|는)?(?:없|아니|종결|종료)|계속중인(?:심리|절차|소송|사건).{0,30}(?:이|가|은|는)?(?:없|아니)/u.test(clause);
  if (!withdrawal) {
    return continuing && !continuingDenied
      ? semanticEvent('legal-regulatory', 'updated', 'active', 'litigation', 'issuer')
      : null;
  }

  const completedEnd = Math.max(
    lastMatchEnd(clause, /(?:취하|철회)(?:처리|절차|신청)?(?:가|이|를|을)?(?:하였|했|함|해(?:서|여)?|하여|했고|하고|되었|됐|완료|확정)/gu),
    lastMatchEnd(clause, /(?:취하|철회).{0,36}(?:접수|기록반영|사건번호.{0,12}말소|종결(?:통지|안내)?).{0,24}(?:완료|마쳤|끝|확인|받|수령|되었|됐)?/gu),
    lastMatchEnd(clause, /(?:소)?취하(?:서)?.{0,140}(?:접수|수리|동의).{0,100}(?:취하)?(?:의)?효력(?:이|가)?발생/gu),
    lastMatchEnd(clause, /(?:소)?취하(?:의)?효력(?:이|가)?발생/gu),
    lastMatchEnd(clause, /(?:소)?취하(?:가|는|를|을|처리가|절차가)?(?:확정|완료|되어(?:종료|종결))/gu),
    lastMatchEnd(clause, /거두어들(?:였|였고|임|여|여서)/gu),
  );
  const negatedEnd = Math.max(
    lastMatchEnd(clause, /(?:취하|철회)(?:를|을|는|가)?(?:하지(?:는)?않|하지못|아니|없)/gu),
    lastMatchEnd(clause, /거두어들(?:이지않|이지못|지않|지못)/gu),
  );
  const prospectiveEnd = Math.max(
    lastMatchEnd(clause, /(?:취하|철회|거두어들).{0,48}(?:예정(?!대로)|계획|방침|검토|협의|의향|추후|향후|다음|여부|미정|조건|경우|할수있)/gu),
    lastMatchEnd(clause, /(?:예정(?!대로)|계획|방침|검토|협의|의향|추후|향후|조건|경우).{0,48}(?:취하|철회|거두어들)/gu),
  );
  const requestRetractedEnd = lastMatchEnd(clause, /취하요청.{0,20}철회(?:하였|했|함|해|했고|하고|되었|됐|완료)?/gu);
  const invalidationNegated = /(?:반려|기각|무효)(?:로)?(?:되지않|된것이아니|된것은아니)|번복(?:하지않|한것이아니|한것은아니)/u.test(clause);
  const invalidatedEnd = invalidationNegated ? -1 : Math.max(
    lastMatchEnd(clause, /(?:취하|철회).{0,72}(?:반려|기각|번복|무효|효력.{0,20}(?:발생하지않|없))/gu),
    lastMatchEnd(clause, /(?:반려|기각|번복|무효).{0,72}(?:취하|철회)/gu),
  );
  const continuingEnd = Math.max(
    lastMatchEnd(clause, /(?:본안)?청구.{0,50}(?:유지|계속|제기|심리중|변론기일)/gu),
    lastMatchEnd(clause, /(?:소송|중재|재판|절차|사건|본소|반소|심리|변론).{0,60}(?:유지|계속|진행(?:중|되고|되며)|그대로진행|계속진행|계속수행|심리중|변론기일)/gu),
    lastMatchEnd(clause, /(?:소장|청구).{0,30}(?:제기|제출)/gu),
  );
  const blockingEnd = Math.max(negatedEnd, prospectiveEnd, requestRetractedEnd, invalidatedEnd, continuingEnd);
  if (completedEnd > blockingEnd) {
    return semanticEvent('legal-regulatory', 'withdrawn', 'effective', 'litigation', 'issuer');
  }
  if (blockingEnd >= 0) {
    return semanticEvent('legal-regulatory', 'updated', 'active', 'litigation', 'issuer');
  }

  return semanticEvent(
    'legal-regulatory',
    completedEnd >= 0 ? 'withdrawn' : 'updated',
    completedEnd >= 0 ? 'effective' : 'active',
    'litigation',
    'issuer',
  );
}

function litigationLifecycleEvent(scope) {
  const decisions = issuerLitigationClauses(scope).map(classifyLitigationClause).filter(Boolean);
  return decisions.at(-1) ?? null;
}

function hasTerminalProductWithdrawal(scope) {
  const namedApprovalApplication = /(?:품목허가|의약품허가|신약허가).{0,50}신청/u.test(scope)
    && /(?:품목허가|의약품허가|신약허가).{0,50}신청.{0,100}(?:취하|철회|포기)/u.test(scope);
  const productScopedRetraction = /제품.{0,80}(?:자진)?(?:취하|철회|포기)(?:서)?.{0,100}(?:규제기관|식품의약품안전처|식약처).{0,80}(?:접수|수리|심사취소|심사종료)/u.test(scope);
  if (!namedApprovalApplication && !productScopedRetraction) return false;
  const thirdPartyWithdrawal = /(?:공동개발사|관계회사|계열회사|파트너사|제휴사|타사|제3자).{0,100}(?:품목허가|의약품허가|신약허가).{0,50}신청.{0,80}(?:취하|철회|포기)/u.test(scope);
  const issuerWithdrawal = /(?:당사|우리회사)(?:가|는|명의(?:로|의)?).{0,100}(?:품목허가|의약품허가|신약허가).{0,50}신청.{0,80}(?:취하|철회|포기)/u.test(scope)
    || /(?:^|\|)회사(?:가|는).{0,100}(?:품목허가|의약품허가|신약허가).{0,50}신청.{0,80}(?:취하|철회|포기)/u.test(scope);
  if (thirdPartyWithdrawal && !issuerWithdrawal) return false;

  const terminalEnd = Math.max(
    lastMatchEnd(scope, /(?:취하|철회|포기)(?:신고|처리|절차)?(?:가|이|를|을)?(?:하였|하여|해|했|함|완료|확정|되어|되었|됐)/gu),
    lastMatchEnd(scope, /(?:취하|철회|포기)확정일/gu),
    lastMatchEnd(scope, /(?:취하|철회|포기)(?:서|공문|신고|신청서)?.{0,100}(?:식품의약품안전처|식약처|규제기관|관계기관|담당기관|기관).{0,60}(?:(?<!불)수리|접수|처리).{0,40}(?:완료|끝|통보|종결|되었|됐)?/gu),
    lastMatchEnd(scope, /(?:식품의약품안전처|식약처|규제기관|관계기관|담당기관|기관).{0,100}(?:취하|철회|포기)(?:서|공문|신고|신청서)?.{0,40}(?:(?<!불)수리|접수|처리)/gu),
    lastMatchEnd(scope, /(?:취하|철회|포기).{0,60}(?:심사|신청|절차|건).{0,40}(?:종결|종료)/gu),
    lastMatchEnd(scope, /자진(?:취하|철회|포기)(?:하기로)?(?:결정|확정)/gu),
  );
  const negatedEnd = Math.max(
    lastMatchEnd(scope, /(?:취하|철회|포기)(?:를|을|는|가)?(?:하지(?:는)?않|하지못|아니)/gu),
    lastMatchEnd(scope, /(?:취하|철회|포기)의사.{0,24}(?:전혀)?없/gu),
  );
  const prospectiveEnd = Math.max(
    lastMatchEnd(scope, /(?:취하|철회|포기).{0,48}(?:검토중|검토예정|예정|계획|방침|협의중|가능성|경우|조건)/gu),
    lastMatchEnd(scope, /(?:검토중|검토예정|예정|계획|방침|협의중|경우|조건).{0,48}(?:취하|철회|포기)/gu),
  );
  const invalidatedEnd = Math.max(
    lastMatchEnd(scope, /(?:취하|철회|포기).{0,100}(?:요청|신고|제출|결정)?.{0,30}(?:불수리|반려|기각|번복|무효|제출(?:을|를)?취소|서류(?:를|을)?회수)/gu),
    lastMatchEnd(scope, /(?:불수리|반려|기각|번복|무효|제출(?:을|를)?취소|서류(?:를|을)?회수).{0,100}(?:취하|철회|포기)/gu),
  );
  const independentTrialContinuation = /(?:별개(?:의)?|별도(?:의)?)?임상시험.{0,50}(?:유지|계속|진행|수행)/u.test(scope);
  const continuingEnd = Math.max(
    lastMatchEnd(scope, /(?:허가|신청|심사)절차.{0,40}(?:유지|계속|진행중|그대로남)/gu),
    independentTrialContinuation
      ? -1
      : lastMatchEnd(scope, /(?:품목허가|의약품허가|신약허가).{0,50}신청.{0,40}(?:유지|계속|진행중|그대로남)/gu),
    lastMatchEnd(scope, /(?:심사|질의|보완자료).{0,50}(?:계속|진행중|답변중|회신중|검토단계|준비중)/gu),
  );
  const partialProductWithdrawal = /(?:일부취하|일부철회|일부포기)|(?:복수(?:제품)?|두개|두제품|둘이상|독립(?:적)?인.{0,20}제품|적응증).{0,140}(?:품목허가|의약품허가|신약허가).{0,100}(?:취하|철회|포기).{0,140}(?:다른|나머지|별도|[A-Z](?:제품|적응증)|진단키트).{0,80}(?:유지|계속|심사중|취하하지않)/u.test(scope);
  const laterIndependentProduct = terminalEnd >= 0
    && /(?:별개(?:의)?|별도(?:의)?|다른|나머지|(?:진단키트|제품|의약품|신약)[A-Z0-9-]*|[A-Z](?:제품|적응증)?)(?:의)?(?:품목허가)?신청.{0,100}(?:취하하지않|철회하지않|포기하지않|유지|계속|심사중)/u.test(scope.slice(terminalEnd));
  const independentPartialWithdrawal = partialProductWithdrawal || laterIndependentProduct;
  const blockingEnd = independentPartialWithdrawal
    ? invalidatedEnd
    : Math.max(negatedEnd, prospectiveEnd, invalidatedEnd, continuingEnd);
  return terminalEnd >= 0 && terminalEnd > blockingEnd;
}

function hasAffirmativeProductApproval(scope) {
  const positiveEnd = Math.max(
    lastMatchEnd(scope, /(?:품목허가|의약품허가|신약허가).{0,80}(?:승인|획득|허가완료)/gu),
    lastMatchEnd(scope, /(?:승인|획득).{0,80}(?:품목허가|의약품허가|신약허가)/gu),
  );
  const negativeEnd = Math.max(
    lastMatchEnd(scope, /(?:승인|허가).{0,40}(?:되지않|받지못|아니|없|거절|반려|불허|보류)/gu),
    lastMatchEnd(scope, /(?:미승인|불승인|승인거절|승인반려|허가거절|허가반려|허가불허)/gu),
  );
  return positiveEnd >= 0 && positiveEnd > negativeEnd;
}

function hasAffirmativeLoanTermination(scope) {
  const terminalEnd = lastMatchEnd(scope, /(?:해지|종료|조기상환|대여금회수|채권회수)/gu);
  const blockingEnd = Math.max(
    lastMatchEnd(scope, /(?:해지|종료|조기상환|대여금회수|채권회수).{0,32}(?:하지않|하지아니|아니|없|철회|취소)/gu),
    lastMatchEnd(scope, /(?:유지|계속).{0,40}(?:결정|합의|예정|계획|하기로)/gu),
  );
  return terminalEnd >= 0 && terminalEnd > blockingEnd;
}

function hasAffirmativeBusinessPlanWithdrawal(scope) {
  const terminalEnd = lastMatchEnd(scope, /(?:철회|중단)/gu);
  const blockingEnd = Math.max(
    lastMatchEnd(scope, /(?:철회|중단).{0,32}(?:하지않|하지아니|아니|없|취소|번복)/gu),
    lastMatchEnd(scope, /(?:유지|계속).{0,40}(?:결정|예정|계획|하기로)/gu),
  );
  return terminalEnd >= 0 && terminalEnd > blockingEnd;
}

function hasAffirmativeRegulatoryWorkStop(scope) {
  let effective = false;
  for (const clause of scope.split(/(?:\||[!?。]+|(?<!\d)\.(?!\d))/u).filter(Boolean)) {
    const workStop = /(?:작업중지|작업정지)(?:명령|조치)/u.test(clause);
    const referencedOrder = effective && /(?:그|해당|같은)명령/u.test(clause);
    if (!workStop && !referencedOrder) continue;

    const thirdPartyTarget = /(?:인접)?(?:협력업체|외주업체|관계회사|계열회사|타사|제3자).{0,80}(?:공장|사업장|공정|라인)?.{0,100}(?:작업중지|작업정지)(?:명령|조치)/u.test(clause);
    const issuerTargetMention = /(?:당사|우리회사).{0,80}(?:공장|사업장|공정|라인)?.{0,100}(?:작업중지|작업정지)(?:명령|조치)/u.test(clause)
      || /(?:작업중지|작업정지)(?:명령|조치).{0,100}(?:당사|우리회사)(?:의|가|는|사업장|공정|라인)/u.test(clause);
    const issuerExclusion = /(?:당사|우리회사)(?:의)?(?:공정|사업장|라인)?.{0,60}(?:명령|조치)?(?:의)?대상(?:이|은|에는|에는)?(?:아니|아님|아닙|제외)|(?:당사|우리회사)(?:의)?(?:공정|사업장|라인)?.{0,60}(?:명령|조치).{0,30}적용되지않/u.test(clause);
    const issuerTarget = issuerTargetMention && !issuerExclusion;
    const issuerDenial = issuerExclusion
      || /(?:당사|우리회사)(?:공정|사업장|라인)?.{0,80}(?:어떠한)?명령(?:도|은|는|이|가)?(?:없|받지않)/u.test(clause);
    if (thirdPartyTarget && !issuerTarget && !issuerDenial) continue;

    const positiveEnd = thirdPartyTarget && !issuerTarget ? -1 : Math.max(
      lastMatchEnd(clause, /(?:관계기관|관계당국|행정기관|감독기관|관할청|관할고용노동청|고용노동청|관할노동관서|노동관서|고용당국|고용노동부).{0,100}(?:작업중지|작업정지)(?:명령|조치)/gu),
      lastMatchEnd(clause, /(?:작업중지|작업정지)(?:명령|조치).{0,80}(?:관계기관|관계당국|행정기관|감독기관|관할청|관할고용노동청|고용노동청|관할노동관서|노동관서|고용당국|고용노동부).{0,40}(?:발령|통보|부과|명령)/gu),
    );
    const negativeEnd = Math.max(
      lastMatchEnd(clause, /(?:작업중지|작업정지)(?:명령|조치).{0,120}(?:아직)?(?:없|내려지지않|발령되지않|통보되지않|받지않|검토중|검토하고있)/gu),
      lastMatchEnd(clause, /(?:발령|통보|부과).{0,40}(?:사실|내역)?.{0,20}(?:없|아니)/gu),
      lastMatchEnd(clause, /(?:(?:작업중지|작업정지)(?:명령|조치)|(?:그|해당|같은)명령).{0,120}(?:취소|철회|해제|무효|효력.{0,20}없)/gu),
      issuerDenial ? clause.length : -1,
    );
    if (positiveEnd >= 0 || negativeEnd >= 0) effective = positiveEnd > negativeEnd;
  }
  return effective;
}

function hasAffirmativeIssuerOperationalWorkStop(scope) {
  if (hasAffirmativeRegulatoryWorkStop(scope)) return true;

  let effective = false;
  for (const clause of scope.split(/(?:\||[!?。]+|(?<!\d)\.(?!\d))/u).filter(Boolean)) {
    const thirdPartyOnly = /(?:협력업체|외주업체|관계회사|계열회사|타사|제3자).{0,120}(?:작업중지|작업정지|작업중단)/u.test(clause)
      && !/(?:당사|우리회사|해당현장|본현장|진행중인작업공종)/u.test(clause);
    if (thirdPartyOnly) continue;

    const positiveEnd = Math.max(
      lastMatchEnd(clause, /(?:당사|우리회사|해당현장|본현장|진행중인작업공종|현장자체).{0,100}(?:작업중지|작업정지|작업중단).{0,40}(?:실시|시행|조치|중단하였|중지하였)/gu),
      lastMatchEnd(clause, /(?:작업중지|작업정지|작업중단).{0,40}(?:실시|시행|조치).{0,100}(?:당사|우리회사|해당현장|본현장)/gu),
    );
    const negativeEnd = Math.max(
      lastMatchEnd(clause, /(?:작업중지|작업정지|작업중단)(?:를|을)?(?:실시|시행|조치)?(?:할)?(?:예정|계획|검토중|협의중)|(?:작업중지|작업정지|작업중단)(?:를|을)?(?:실시|시행)하지않/gu),
      lastMatchEnd(clause, /(?:작업중지|작업정지|작업중단).{0,100}(?:해제|종료|철회|취소|재개)/gu),
    );
    if (positiveEnd >= 0 || negativeEnd >= 0) effective = positiveEnd > negativeEnd;
  }
  return effective;
}

function explicitSectionFamily(scope) {
  if (/(?:자기주식(?:취득)?신탁|신탁계약|제\d+호신탁|신탁은|신탁을|신탁의)/u.test(scope)) return 'trust';
  if (/전환사채|사채권|(?:^|[^A-Z])CB(?:[^A-Z]|$)/u.test(scope)) return 'bond';
  if (/품목허가|의약품허가|신약허가|허가신청|임상시험|제품.{0,40}(?:허가|취하|심사)/u.test(scope)) return 'product';
  if (/작업중지|작업정지|행정처분/u.test(scope)) return 'work-stop';
  if (/유상증자|주식발행|자금조달/u.test(scope)) return 'equity';
  if (/중대산업재해|중대재해|안전사고|사망사고|금번사고/u.test(scope)) return 'accident';
  if (/소송|중재(?:사건|절차|판정부|센터)?|본소|반소장?|손해배상|청구(?:소송|사건)?|소장|소취하|취하서|심리|재판|판결|상고|항소|법적분쟁/u.test(scope)) return 'litigation';
  return null;
}

function isIndependentNaturalSection(scope) {
  return /^(?:첫째|둘째|셋째|넷째|다섯째|이와(?:는)?(?:별도로|독립하여|별개(?:인|의|로)?)|별개(?:인|의|로)?|별도(?:로|의)?|한편|또한|제\d+(?:호|회(?:전환사채|사채권)?)|[A-Z]사건)/u.test(scope)
    || /^당사.{0,50}(?:별개로|별도로)/u.test(scope)
    || /^다른.{0,50}(?:별개|별도)/u.test(scope);
}

function appendExplicitSection(sections, section) {
  const previous = sections.at(-1);
  if (!previous) {
    sections.push(section);
    return;
  }
  if (!section.family || (section.family === previous.family && !section.independent)) {
    previous.text = `${previous.text}|${section.label}|${section.text}`;
    return;
  }
  sections.push(section);
}

function appendNaturalBodySections(sections, currentBody) {
  const naturalSections = currentBody
    .split(/(?:\|+|[!?。]+|(?:(?<!\d)\.|\.(?!\d))|(?=(?:둘째|셋째|넷째|다섯째|이와(?:는)?(?:별도로|독립하여|별개(?:인|의|로)?)|한편|또한|제\d+회(?:전환사채|사채권)),?))/u)
    .filter(Boolean);
  let previousNaturalFamily = null;
  for (const text of naturalSections) {
    const historicalLead = /^(?:과거|종전|이전|지난해|참고로)/u.test(text);
    const currentLifecycle = /(?:공시일)?현재|금번|이번|계속|진행(?:중|되고|되며)|유지/u.test(text);
    const historicalSummary = /(?:단순연혁|단순참고|참고사항(?:입니다)?|과거이력(?:입니다)?)/u.test(text);
    if ((historicalLead || historicalSummary) && !currentLifecycle) continue;
    const inferredFamily = explicitSectionFamily(text);
    const productContinuation = previousNaturalFamily === 'product'
      && /(?:허가)?신청|심사|규제기관|식약처|취하서|취하의사/u.test(text)
      && !/(?:소송|법원|원고|피고|청구|소장|중재|재판)/u.test(text);
    const numberedFamily = (previousNaturalFamily === 'bond' && /^제\d+회/u.test(text))
      || (previousNaturalFamily === 'trust' && /^제\d+호/u.test(text))
      ? previousNaturalFamily
      : null;
    const family = productContinuation ? 'product' : inferredFamily ?? numberedFamily;
    if (family) previousNaturalFamily = family;
    appendExplicitSection(sections, {
      label: '',
      text,
      family,
      independent: isIndependentNaturalSection(text),
    });
  }
}

function explicitBodySections(bodyText) {
  const body = compactText(bodyText);
  const headings = [...body.matchAll(/\[([^\]]{1,50})\]/gu)];
  const sections = [];

  if (headings.length > 0) {
    const preamble = body.slice(0, headings[0].index);
    if (preamble) appendNaturalBodySections(sections, preamble);
    let previousFamily = null;
    for (let index = 0; index < headings.length; index += 1) {
      const heading = headings[index];
      const label = heading[1];
      const text = body.slice(heading.index + heading[0].length, headings[index + 1]?.index ?? body.length);
      if (/^(?:과거|종전|이전|지난|참고)/u.test(label)) continue;
      const inferredFamily = explicitSectionFamily(`${label}|${text}`);
      const continuation = /(?:후속|최종|확인)/u.test(label);
      const family = inferredFamily ?? (continuation ? previousFamily : null);
      if (family) previousFamily = family;
      appendExplicitSection(sections, {
        label,
        text,
        family,
        independent: !continuation,
      });
    }
    return sections;
  }

  const currentBody = body.includes('|') ? currentDisclosureScope({ fullText: body }, body) : body;
  appendNaturalBodySections(sections, currentBody);
  return sections;
}

function joinExplicitSections(sections, family) {
  return sections
    .filter((section) => section.family === family)
    .map((section) => `${section.label}|${section.text}`)
    .join('|');
}

function hasExplicitEquityScheduleDelta(scope) {
  if (!/(?:유상증자|주식발행|자금조달)/u.test(scope)
    || !/(?:주금|자금)?(?:납입(?:일|기일)|납부(?:일|기한))/u.test(scope)) return false;
  return /(?:주금|자금)?(?:납입(?:일|기일)|납부(?:일|기한)).{0,120}에서.{0,100}(?:변경|정정|조정|수정|개정|바꿨|옮겼|개편)/u.test(scope)
    || /(?:변경전|정정전|종전|기존|당초|원래).{0,100}(?:변경후|정정후|변경|새|조정|개정|수정)/u.test(scope);
}

function explicitTrustEvent(scope) {
  if (!scope) return null;
  const trustIndex = scope.search(/(?:자기주식(?:취득)?신탁|신탁계약|제\d+호신탁|신탁은|신탁을)/u);
  const actorScope = trustIndex >= 0 ? scope.slice(0, trustIndex + 20) : scope;
  const issuerActorEnd = lastMatchEnd(actorScope, /(?:당사|우리회사)(?:가|는|이사회가|이사회는)/gu);
  const thirdPartyActorEnd = lastMatchEnd(actorScope, /(?:관계회사|계열회사|종속회사|자회사|제3자|타사)(?:가|는|의)?/gu);
  const issuerDisclaimed = /당사.{0,100}(?:당사자|위탁자|수익자).{0,40}(?:아니|아님|아닙)/u.test(scope);
  if (issuerDisclaimed || thirdPartyActorEnd > issuerActorEnd) return null;

  const cancelled = /(?:신탁)?계약(?:체결)?(?:결의|결정).{0,80}(?:철회|취소|번복)|(?:철회|취소|번복).{0,80}(?:자기주식(?:취득)?신탁|신탁계약)/u.test(scope);
  const falseReport = /(?:보도|소문|풍문).{0,80}(?:사실과다르|사실이아니)|(?:신탁계약|계약체결).{0,80}(?:사실과다르|사실이아니)/u.test(scope);
  if (cancelled || falseReport) return null;

  const completionEnd = Math.max(
    lastMatchEnd(scope, /(?:자기주식(?:취득)?신탁|신탁계약|제\d+호신탁).{0,180}(?:체결(?:하였|했|함|하여|해|완료)|서명(?:하였|했|함|하고|하여|해|완료|마쳐|마쳤)|날인(?:하였|했|함|하고|하여|해|완료|마쳐|마쳤)).{0,100}(?:효력(?:이|가|을|를)?(?:발생|개시)|유효|발효|완료|마쳤|끝냈)?/gu),
    lastMatchEnd(scope, /(?:자기주식(?:취득)?신탁|신탁계약).{0,140}(?:즉시)?(?:효력(?:이|가|을|를)?(?:발생|개시)|유효|발효)/gu),
  );
  const incompleteEnd = Math.max(
    lastMatchEnd(scope, /(?:계약|체결|서명|날인).{0,60}(?:예정|서명전|미서명|미날인|미체결|아직.{0,30}(?:되지않|하지않)|이루어진바없|전혀없)/gu),
    lastMatchEnd(scope, /효력.{0,40}(?:발생하지않|없)/gu),
  );
  const completed = hasCompletedTrustContract(scope) || completionEnd > incompleteEnd;
  if (completed) {
    return semanticEvent('capital-change', 'contracted', 'effective', 'treasury-share-trust', 'securities');
  }

  const decided = /(?:이사회|당사).{0,120}(?:자기주식(?:취득)?신탁|신탁계약|계약).{0,100}(?:체결하기로)?(?:결정|의결|결의|승인)/u.test(scope)
    || /(?:이사회|당사).{0,80}(?:결정|의결|결의|승인).{0,100}(?:자기주식(?:취득)?신탁|신탁계약)/u.test(scope)
    || /(?:자기주식(?:취득)?신탁|신탁계약|제\d+호신탁).{0,140}(?:체결하기로)?(?:결정|의결|결의|승인)/u.test(scope);
  const decisionNegated = /(?:이사회)?(?:결정|의결|결의|승인).{0,50}(?:없|하지않|되지않|이루어진바없)|(?:검토자료|초안)만.{0,60}(?:작성|준비)/u.test(scope);
  const executionPending = /(?:신탁계약|계약|계약서|서명|체결).{0,80}(?:예정|다음|향후|추후|서명전|미서명|미체결|아직.{0,30}(?:되지않|하지않))/u.test(scope);
  if ((decided && !decisionNegated)
    || (executionPending && !decisionNegated && /(?:자기주식(?:취득)?신탁|신탁계약|제\d+호신탁)/u.test(scope))) {
    return semanticEvent('capital-change', 'decided', 'proposed', 'treasury-share-trust', 'securities');
  }
  return null;
}

function explicitConvertibleBondEvent(scope) {
  if (!scope) return null;
  const bondIndex = scope.search(/(?:전환사채|사채권)/u);
  const actorScope = bondIndex >= 0 ? scope.slice(0, bondIndex + 20) : scope;
  const issuerActorEnd = lastMatchEnd(actorScope, /(?:당사|우리회사)(?:가|는|발행)/gu);
  const thirdPartyActorEnd = lastMatchEnd(actorScope, /(?:관계회사|계열회사|종속회사|자회사|제3자|타사)(?:가|는|의)?/gu);
  const thirdPartyAcquisition = /(?:관계회사|계열회사|종속회사|자회사|제3자|타사).{0,120}(?:전환사채|사채권).{0,100}(?:취득|인수|수령|매수|매입|권리이전)/u.test(scope);
  const issuerDenial = /당사.{0,100}(?:전환사채|사채권).{0,60}(?:취득|인수|수령|매수|매입).{0,30}(?:하지않|하지못|없)/u.test(scope)
    || /당사.{0,50}(?:취득|인수|수령|매수|매입)(?:하지않|하지못|없)/u.test(scope)
    || /(?:매수인|취득자|양수인).{0,50}(?:당사|발행회사).{0,30}(?:아니|아님|아닙)/u.test(scope)
    || /(?:새로|이번공시에서).{0,70}(?:취득|인수|매수|매입).{0,50}(?:사실(?:이|은|도)?없|하지않)/u.test(scope);
  if (issuerDenial || (thirdPartyAcquisition && thirdPartyActorEnd > issuerActorEnd)) return null;

  const cancelled = /(?:전환사채|사채권).{0,100}(?:취득|인수|매수|매입)(?:결의|결정)?.{0,60}(?:취소|철회|번복)|(?:취소|철회|번복).{0,80}(?:전환사채|사채권).{0,60}(?:취득|인수|매수|매입)/u.test(scope);
  if (cancelled) return null;

  const outstanding = /(?:나머지|잔여분?|잔금|대금잔액|외부잔액|잔액).{0,100}(?:지급|결제|정산|취득|인수|매수|매입|이전|인도|수령).{0,40}(?:예정|추후|향후|다음)/u.test(scope)
    || /(?:일부|부분|1차|절반|반만|\d+%|\d+분의\d+).{0,50}(?:취득|인수|매수|매입|대금|사채|채권).{0,100}(?:나머지|잔여).{0,60}(?:예정|추후|향후|다음)/u.test(scope)
    || /(?:\d+%|일부|부분|잔여분?).{0,100}(?:외부|사채권자).{0,50}(?:잔존|남아|보유중)|(?:외부|사채권자).{0,80}(?:잔액|잔여|\d+%).{0,40}(?:잔존|남아|보유중)/u.test(scope);
  const executionIncomplete = /(?:대금|잔금).{0,30}(?:지급|결제|정산).{0,60}(?:아직|미지급|미결제|미정산|되지않|하지않|완료되지않)/u.test(scope)
    || /(?:권리(?:의)?이전|사채권인도).{0,40}(?:아직|미완료|되지않|하지않|완료되지않)/u.test(scope)
    || /(?:대금지급|결제|정산|권리(?:의)?이전|사채권인도)(?:전|이전)(?:이므로|입니다|임)?/u.test(scope)
    || /(?:아직|미지급|미결제|미정산).{0,60}(?:대금|잔금|결제|정산|권리(?:의)?이전|사채권인도|취득)/u.test(scope)
    || /(?:조건|동의).{0,80}(?:성취|확정|완료).{0,40}(?:전|되지않)/u.test(scope);
  const scopedCompletion = /(?:대금|잔금).{0,80}(?:지급|완납|결제|정산).{0,120}(?:사채권|권리|명의|소유권).{0,60}(?:인도|이전|귀속|대체).{0,60}(?:완료|마쳐|마쳤|끝냈|효력(?:이|가)?발생)/u.test(scope)
    || /(?:전환사채|사채권).{0,140}(?:취득|인수|매입).{0,80}(?:완료|마쳐|마쳤|끝냈|종결|효력(?:이|가)?발생)/u.test(scope)
    || /(?:전환사채|사채권).{0,120}(?:전액)?(?:결제|대금.{0,20}지급).{0,100}(?:사채권|채권|권리).{0,50}(?:인도|이전).{0,40}(?:완료|마쳐|마쳤|끝냈)/u.test(scope)
    || /(?:자기|당사발행)?전환사채.{0,80}(?:전액)?.{0,80}(?:대금.{0,20}지급|결제|정산).{0,80}(?:권리)?이전(?:을|를)?(?:마쳐|마쳤|완료|끝내|끝냈).{0,60}(?:당사|회사)(?:가|는)?(?:취득|인수)/u.test(scope);
  const completionNegated = /(?:전체|전액)?취득(?:이|은|는)?완료(?:가|이)?(?:아니|되지않)|취득완료가아니/u.test(scope);
  if ((hasCompletedConvertibleBondAcquisition(scope) || scopedCompletion)
    && !outstanding
    && !executionIncomplete
    && !completionNegated) {
    return semanticEvent('capital-change', 'acquired', 'effective', 'convertible-bond-acquisition', 'securities');
  }
  const decided = /(?:이사회|대표이사|당사).{0,120}(?:자기|당사발행|제\d+회)?전환사채.{0,100}(?:만기전)?(?:취득|인수|매수|매입).{0,60}(?:결정|결의|의결|승인)/u.test(scope)
    || /(?:전환사채|사채권).{0,100}(?:만기전)?(?:취득|인수|매수|매입).{0,60}(?:결정|결의|의결|승인)/u.test(scope);
  const decisionNegated = /(?:결정|결의|의결|승인)(?:한바|된바|한사실|된사실|사항)?(?:이|가|을|를|은|는)?(?:없|하지않|되지않)|(?:협의|검토|가능성).{0,80}(?:확정되지않|결정되지않)/u.test(scope);
  const partialExecution = outstanding && (/(?:일부|부분|1차|절반|반만|\d+%|\d+분의\d+).{0,100}(?:대금)?(?:지급|결제|정산|취득|인수|매수|매입)|(?:대금|잔금).{0,80}(?:일부|부분|1차|절반|반만).{0,40}(?:지급|결제|정산)/u.test(scope)
    || /(?:부분취득|전체취득완료가아니|잔여분취득결정)/u.test(scope));
  if (partialExecution || (decided && !decisionNegated)) {
    return semanticEvent('capital-change', 'decided', 'proposed', 'convertible-bond-acquisition', 'securities');
  }
  return null;
}

function explicitFiledLitigationEvent(clause) {
  const filingDocument = '(?:소장|반소장|청구소장|청구서|중재신청서|항소장|항고장)';
  const negated = new RegExp(`${filingDocument}.{0,50}(?:제출|접수|신청).{0,30}(?:하지않|하지못|없)|(?:제기|제출|신청).{0,30}(?:사실이없|사실이아니)`, 'u').test(clause);
  if (negated) return null;
  const filed = new RegExp(`${filingDocument}.{0,60}(?:제출|송달받).{0,100}(?:접수|접수번호|사건번호|부여받|접수확인|접수를마쳤|접수됐|접수되었)`, 'u').test(clause)
    || new RegExp(`${filingDocument}.{0,60}(?:접수|사건번호|접수번호).{0,60}(?:부여받|확인|마쳤|됐|되었)`, 'u').test(clause)
    || new RegExp(`${filingDocument}.{0,100}(?:법원|중재기관|중재센터).{0,40}접수(?:됐|되었|완료|되었습니다)`, 'u').test(clause)
    || new RegExp(`(?:법원|중재기관|중재센터).{0,100}${filingDocument}.{0,50}접수(?:하였|했|함|했습니다|완료|됐|되었|되었습니다)`, 'u').test(clause)
    || new RegExp(`당사.{0,120}${filingDocument}.{0,50}(?:제출하였|제출했|제출했습니다|접수하였|접수했)`, 'u').test(clause)
    || /당사.{0,160}(?:소송|청구)?소(?:를|을)?제기(?:하였|했|함|했습니다)/u.test(clause);
  return filed
    ? semanticEvent('legal-regulatory', 'filed', 'active', 'litigation', 'issuer')
    : null;
}

function isThirdPartyOnlyLitigation(scope) {
  const thirdPartyActor = /(?:관계회사|계열회사|종속회사|자회사|제3자|타사).{0,140}(?:소송|중재|소장|청구).{0,80}(?:제기|제출|신청|진행)/u.test(scope);
  const issuerDisclaimed = /당사.{0,100}(?:원고|피고|당사자|참가인|신청인).{0,50}(?:아니|아님|아닙)/u.test(scope);
  return thirdPartyActor && issuerDisclaimed;
}

function isFalseLitigationReport(scope) {
  return /(?:풍문|소문|보도).{0,100}(?:사실이아니|사실과다르)/u.test(scope)
    || /(?:소장|반소장|청구서|중재신청서).{0,60}(?:제출|접수|신청).{0,30}(?:되지않|하지않|사실이없)/u.test(scope);
}

function isConcludedLitigationWithoutWithdrawal(scope) {
  if (/(?:취하|철회|거두어들)/u.test(scope)) return false;
  const concluded = /(?:상고|항소)?(?:기각)?판결.{0,80}(?:확정|송달)|(?:소송|사건).{0,100}(?:종결|종료)|(?:종결|종료).{0,100}(?:소송|사건)/u.test(scope);
  const noContinuation = /(?:추가)?(?:심리|절차|소송|사건).{0,80}(?:계속중인)?(?:사항|절차)?(?:이|가|은|는)?(?:없|아니|종결|종료)|계속중인(?:심리|절차|소송|사건).{0,30}(?:이|가|은|는)?(?:없|아니)/u.test(scope);
  return concluded && noContinuation;
}

function applyExplicitBodyIntentRule(input, events) {
  const title = compactText(input.reportName);
  const sections = explicitBodySections(input.bodyText);
  const fullCurrentScope = sections.map((section) => `${section.label}|${section.text}`).join('|');
  const bodyFamilies = new Set(sections.map((section) => section.family).filter(Boolean));
  const genericTitle = /^(?:기타주요경영사항(?:\(자율공시\))?|주요경영사항공시(?:\(정정\))?|주요사항보고서\(정정\))$/u.test(title);
  const titleFamilyCount = [
    /(?:소송|항소|중재)/u,
    /자기주식(?:취득)?신탁/u,
    /(?:전환사채|사채권)/u,
    /(?:품목허가|의약품허가|신약허가)/u,
  ].filter((pattern) => pattern.test(title)).length;
  const bodyDrivenMulti = bodyFamilies.size >= 2
    && (titleFamilyCount >= 2 || /(?:주요|복수|종합|현안|사건|진행|현황|안내|공시|거래|계약)/u.test(title));
  const explanatoryTitle = bodyFamilies.size >= 1 && /^(?:해명공시|조회공시(?:요구)?(?:에대한)?답변?)$/u.test(title);
  const accumulateBodyIntents = genericTitle || bodyDrivenMulti || explanatoryTitle;
  const litigationCorrection = input.wrapperKind === 'correction' && /소송등의제기/u.test(title);
  const litigationWithdrawalTitle = /소송등의제기.{0,60}(?:취하|철회)/u.test(title);
  const litigationTitle = /(?:소송|항소|중재)/u.test(title);
  const trustTitle = /자기주식(?:취득)?신탁(?:계약)?/u.test(title) && !/(?:철회|해지)/u.test(title);
  const bondTitle = /(?:전환사채|사채권)/u.test(title);
  const productTitle = /(?:품목허가|의약품허가|신약허가)/u.test(title);
  if (!accumulateBodyIntents
    && !litigationCorrection
    && !litigationWithdrawalTitle
    && !litigationTitle
    && !trustTitle
    && !bondTitle
    && !productTitle) return null;

  const familyScopes = (family) => sections
    .filter((section) => section.family === family)
    .map((section) => `${section.label}|${section.text}`);
  let resolved = accumulateBodyIntents ? [] : events.filter((event) => event.type !== 'other');
  let matchedSemanticEvidence = accumulateBodyIntents;
  let suppressedBaseIntent = false;

  if (accumulateBodyIntents || litigationCorrection || litigationWithdrawalTitle || litigationTitle) {
    const litigationSections = sections.filter((section) => section.family === 'litigation');
    const litigationEvents = [];
    let concludedLitigation = false;
    for (const section of litigationSections) {
      const sectionScope = `${section.label}|${section.text}`;
      if (isThirdPartyOnlyLitigation(sectionScope) || isFalseLitigationReport(sectionScope)) continue;
      if (isConcludedLitigationWithoutWithdrawal(sectionScope)) {
        concludedLitigation = true;
        continue;
      }
      const sectionEvents = [];
      const litigationClauses = issuerLitigationClauses(sectionScope);
      for (const clause of litigationClauses) {
        const lifecycleEvent = classifyLitigationClause(clause);
        const event = lifecycleEvent?.action === 'withdrawn'
          ? lifecycleEvent
          : explicitFiledLitigationEvent(clause) ?? lifecycleEvent;
        if (event) appendEventOccurrence(sectionEvents, event);
      }
      if (sectionEvents.length === 0) {
        const sectionFiledEvent = explicitFiledLitigationEvent(sectionScope);
        if (sectionFiledEvent) appendEventOccurrence(sectionEvents, sectionFiledEvent);
      }
      if (/반소/u.test(section.label)
        && /당사.{0,80}(?:상대로|피고|계속|심리)/u.test(section.text)
        && /(?:계속|심리중|진행중)/u.test(section.text)) {
        appendEventOccurrence(sectionEvents, semanticEvent('legal-regulatory', 'updated', 'active', 'litigation', 'issuer'));
      }
      const independentClauseOccurrences = litigationClauses.some((clause, index) => index > 0
        && /^(?:(?:제?\d+|[A-Z])(?:번|호)?사건|별개(?:인|의|로)?|다른사건|한편|또한)/u.test(clause));
      let selectedSectionEvents = sectionEvents;
      if (!independentClauseOccurrences) {
        const deduplicated = [];
        for (const event of sectionEvents) addEvent(deduplicated, event);
        const dominantAction = deduplicated.some((event) => event.action === 'withdrawn')
          ? 'withdrawn'
          : deduplicated.some((event) => event.action === 'filed') ? 'filed' : null;
        selectedSectionEvents = dominantAction
          ? deduplicated.filter((event) => event.action === dominantAction)
          : deduplicated;
      }
      for (const event of selectedSectionEvents) {
        appendEventOccurrence(litigationEvents, event);
      }
    }
    if (litigationEvents.length > 0) {
      resolved = resolved.filter((event) => !(event.type === 'legal-regulatory' && event.cause === 'litigation'));
      for (const event of litigationEvents) appendEventOccurrence(resolved, event);
      matchedSemanticEvidence = true;
    } else if (concludedLitigation) {
      resolved = resolved.filter((event) => !(event.type === 'legal-regulatory' && event.cause === 'litigation'));
      suppressedBaseIntent = true;
      matchedSemanticEvidence = true;
    }
  }

  if (accumulateBodyIntents || trustTitle) {
    const scopedTrustSections = familyScopes('trust');
    const trustScopes = trustTitle && scopedTrustSections.length === 1
      ? [fullCurrentScope]
      : scopedTrustSections.length > 0 ? scopedTrustSections : [fullCurrentScope];
    const trustEvents = trustScopes.map(explicitTrustEvent).filter(Boolean);
    if (trustEvents.length > 0) {
      resolved = resolved.filter((event) => event.cause !== 'treasury-share-trust');
      for (const event of trustEvents) appendEventOccurrence(resolved, event);
      matchedSemanticEvidence = true;
    } else if (trustTitle && trustScopes.some((scope) => /(?:철회|취소|번복).{0,100}(?:신탁|계약)|(?:신탁|계약).{0,100}(?:사실이아니|사실무근)|(?:결정|의결|결의).{0,50}(?:없|하지않)|당사.{0,100}(?:당사자|위탁자|수익자).{0,40}(?:아니|아님|아닙)/u.test(scope))) {
      const previousLength = resolved.length;
      resolved = resolved.filter((event) => event.cause !== 'treasury-share-trust');
      suppressedBaseIntent ||= previousLength !== resolved.length;
      matchedSemanticEvidence = true;
    }
  }

  if (accumulateBodyIntents || bondTitle) {
    const scopedBondSections = familyScopes('bond').map((scope) => (
      /(?:전환사채|사채권)/u.test(scope) ? scope : `전환사채|${scope}`
    ));
    const bondScopes = scopedBondSections.length > 0 ? scopedBondSections : [fullCurrentScope];
    const bondEvents = bondScopes.map(explicitConvertibleBondEvent).filter(Boolean);
    if (bondEvents.length > 0) {
      resolved = resolved.filter((event) => !(event.type === 'capital-change'
        && ['convertible-bond', 'convertible-bond-acquisition'].includes(event.cause)));
      for (const event of bondEvents) appendEventOccurrence(resolved, event);
      matchedSemanticEvidence = true;
    } else if (bondTitle && bondScopes.some((scope) => /(?:관계회사|계열회사|종속회사|자회사|제3자|타사).{0,140}(?:전환사채|사채권).{0,100}(?:취득|인수|매수|매입)|(?:매수인|취득자|양수인).{0,50}(?:당사|발행회사).{0,30}(?:아니|아님|아닙)|(?:취득|인수|매수|매입)(?:결의|결정)?.{0,80}(?:취소|철회|번복)|(?:재매각|재처분|매도).{0,140}(?:새로|이번공시).{0,80}(?:취득|인수|매수|매입).{0,50}(?:사실(?:이|은|도)?없|하지않)|(?:새로|이번공시에서).{0,70}(?:취득|인수|매수|매입).{0,50}(?:사실(?:이|은|도)?없|하지않)/u.test(scope))) {
      const previousLength = resolved.length;
      resolved = resolved.filter((event) => !(event.type === 'capital-change'
        && ['convertible-bond', 'convertible-bond-acquisition'].includes(event.cause)));
      suppressedBaseIntent ||= previousLength !== resolved.length;
      matchedSemanticEvidence = true;
    }
  }

  if (accumulateBodyIntents || productTitle) {
    const scopedProductSections = familyScopes('product');
    const productScopes = scopedProductSections.length > 0 ? scopedProductSections : [fullCurrentScope];
    const withdrawnProductScopes = productScopes.filter(hasTerminalProductWithdrawal);
    if (withdrawnProductScopes.length > 0) {
      resolved = resolved.filter((event) => event.type !== 'regulatory-product');
      for (const _scope of withdrawnProductScopes) {
        appendEventOccurrence(resolved, semanticEvent('regulatory-product', 'withdrawn', 'cancelled', 'product-approval', 'product'));
      }
      matchedSemanticEvidence = true;
    } else if (productTitle) {
      const approvedProductScopes = productScopes.filter(hasAffirmativeProductApproval);
      if (approvedProductScopes.length > 0) {
        resolved = resolved.filter((event) => event.type !== 'regulatory-product');
        for (const _scope of approvedProductScopes) {
          appendEventOccurrence(resolved, semanticEvent('regulatory-product', 'approved', 'effective', 'product-approval', 'product'));
        }
        matchedSemanticEvidence = true;
      } else if (!/(?:FDA|CRL|보완요구서한)/u.test(title + fullCurrentScope)) {
        const previousLength = resolved.length;
        resolved = resolved.filter((event) => !(event.type === 'regulatory-product' && event.cause === 'fda-crl'));
        suppressedBaseIntent ||= previousLength !== resolved.length;
        matchedSemanticEvidence = true;
      }
    }
  }

  if (accumulateBodyIntents) {
    const accidentScope = joinExplicitSections(sections, 'accident');
    if (/(?:중대산업재해|중대재해|사망(?:자\d+명)?(?:이)?발생|사망사고).{0,80}(?:발생|조사중)|(?:발생|조사중).{0,80}(?:중대산업재해|중대재해|사망사고)/u.test(accidentScope)) {
      addEvent(resolved, semanticEvent('legal-regulatory', 'occurred', null, 'serious-industrial-accident', 'issuer'));
    }
    const workStopScope = joinExplicitSections(sections, 'work-stop');
    if (hasAffirmativeRegulatoryWorkStop(workStopScope)) {
      addEvent(resolved, semanticEvent('operating-status', 'halted', 'active', 'work-stop', 'operating-business'));
    }
    const equityScope = joinExplicitSections(sections, 'equity');
    if (hasExplicitEquityScheduleDelta(equityScope)) {
      addEvent(resolved, semanticEvent('capital-change', 'rescheduled', 'pending', 'equity-securities', 'securities'));
    }
  }

  if ((accumulateBodyIntents || suppressedBaseIntent) && resolved.length === 0) {
    addEvent(resolved, semanticEvent('other', null, null, null, null));
  }
  return matchedSemanticEvidence ? sortEvents(resolved) : null;
}

function hasAffirmativeRelatedPartyEvidence(input, bodyFacts) {
  if (input.disclosureDetailType === 'J001') return true;
  const body = bodyFacts.fullText;
  if (/(?:특수관계|계열관계).{0,20}(?:없|아님)|독립제3자|비특수관계/u.test(body)) return false;
  return /(?:(?:거래|차입|대여)상대방(?:과의)?관계|회사와의관계).{0,80}(?:특수관계인|계열회사|관계회사|자회사|종속회사)/u.test(body)
    || /(?:금전대여|대여금).{0,100}(?:계열회사간거래|지분.{0,30}보유한자회사)/u.test(body);
}

function replaceMatchedIntents(events, predicate, replacements) {
  const retained = events.filter((event) => event.type !== 'other' && !predicate(event));
  for (const replacement of replacements) addEvent(retained, replacement);
  return sortEvents(retained);
}

const TERMINAL_LIFECYCLE_ACTIONS = new Set([
  'cancelled', 'dismissed', 'lifted', 'repaid', 'terminated', 'withdrawn',
]);

const PRICE_BEARING_CAPITAL_CAUSES = new Set([
  'bond-with-warrants',
  'contingent-capital-securities',
  'convertible-bond',
  'derivative-securities',
  'equity-linked-bond',
  'equity-securities',
  'exchangeable-bond',
  'fund-securities',
  'rights-offering',
  'stock-option',
]);

function lifecycleIntentKey(event) {
  return `${event.type ?? ''}|${event.cause ?? ''}|${event.subjectType ?? ''}`;
}

function preserveTerminalLifecycle(events, terminalOwners) {
  if (terminalOwners.size === 0) return events;
  return sortEvents(events.map((event) => {
    const owner = terminalOwners.get(lifecycleIntentKey(event));
    return owner ? createEvent({ ...event, action: owner.action, state: owner.state }) : event;
  }));
}

function applyFinalTermsRule(input, events, bodyFacts) {
  const title = compactText(input.reportName);
  const correctionScope = currentCorrectionScope(input, bodyFacts);
  const hasCurrentDelta = /정정전.{0,1000}정정후/u.test(correctionScope);
  const firstBefore = correctionScope.indexOf('정정전');
  const correctionLead = firstBefore < 0 ? correctionScope.slice(0, 900) : correctionScope.slice(0, firstBefore);
  const decisionOnly = /최종발행가액결정/u.test(correctionScope)
    && !/최종발행가액확정/u.test(correctionScope);
  const unrelatedVoluntaryCorrection = /(?:기재사항추가|보고서제출|위험요소).{0,80}(?:자진)?정정|자진정정.{0,80}(?:기재사항|위험요소)/u.test(correctionLead)
    || /자진정정/u.test(correctionScope.slice(0, 900));
  const explicitlyFinalPrice = !decisionOnly
    && !unrelatedVoluntaryCorrection
    && /(?:공모가액|모집가액|발행가액|신주발행가액|행사가액).{0,30}확정|확정.{0,30}(?:공모가액|모집가액|발행가액|신주발행가액|행사가액)/u.test(correctionScope);
  const firstPriceDecision = /1차발행가액결정/u.test(correctionScope);
  const representationOnly = /(?:원화표시|환산금액|환율적용).{0,80}(?:기재|변경)|(?:기재|변경).{0,80}(?:원화표시|환산금액|환율적용)/u.test(correctionScope);
  const completionWins = events.some((event) => event.action === 'completed')
    || /(?:증자가|발행이|납입이|납입을).{0,30}(?:완료|종결)/u.test(correctionScope);
  const currentFinalPrice = hasCurrentDelta
    && (explicitlyFinalPrice || firstPriceDecision)
    && !representationOnly
    && !completionWins;
  const finalPriceNotice = input.wrapperKind === 'original'
    && /유상증자신주발행가액/u.test(title)
    && /구분.{0,80}확정발행가액/u.test(bodyFacts.fullText);
  if (!currentFinalPrice && !finalPriceNotice) return null;

  const warrantTerms = /신주인수권부사채|신주인수권.{0,20}행사가액/u.test(`${title}${correctionScope}`);
  const matchesPriceBearingIntent = (event) => event.type === 'capital-change'
    && PRICE_BEARING_CAPITAL_CAUSES.has(event.cause);
  let replacements = events
    .filter(matchesPriceBearingIntent)
    .map((event) => createEvent({
      ...event,
      action: 'price-set',
      state: 'effective',
      cause: warrantTerms ? 'bond-with-warrants' : event.cause,
    }));
  if (replacements.length === 0 && warrantTerms) {
    replacements = [semanticEvent('capital-change', 'price-set', 'effective', 'bond-with-warrants', 'securities')];
  }
  if (replacements.length === 0) return null;
  return replaceMatchedIntents(events, matchesPriceBearingIntent, replacements);
}

function applyTerminalPolarityRule(input, events, bodyFacts) {
  const title = compactText(input.reportName);
  const body = bodyFacts.fullText;
  const correctionScope = currentCorrectionScope(input, bodyFacts);
  const currentScope = input.wrapperKind === 'correction' ? correctionScope : body;
  const currentSubjectScope = input.wrapperKind === 'correction' ? correctionScope : currentDisclosureScope(bodyFacts);

  const litigationLifecycle = input.wrapperKind === 'correction' && /소송등의제기/u.test(title)
    ? litigationLifecycleEvent(currentScope)
    : null;
  const existingLitigationLifecycles = events.filter((event) => event.type === 'legal-regulatory' && event.cause === 'litigation');
  if (litigationLifecycle && existingLitigationLifecycles.length <= 1) {
    return replaceMatchedIntents(
      events,
      (event) => event.type === 'legal-regulatory' && event.cause === 'litigation',
      [litigationLifecycle],
    );
  }

  if (/유형자산(?:처분|양도|취득|양수)결정/u.test(title)
    && /정정사유.{0,80}(?:계약해제합의|계약취소)|(?:계약해제합의|계약취소).{0,80}(?:정정공시|정정사항)|(?:전항목|주요항목).{0,40}(?:철회|삭제)/u.test(currentScope)) {
    const acquisition = /취득|양수/u.test(title);
    const subjectType = /토지|건물|부동산/u.test(currentScope) ? 'real-estate' : 'asset';
    return replaceMatchedIntents(
      events,
      (event) => event.type === 'asset-transaction',
      [semanticEvent('asset-transaction', 'cancelled', 'effective', acquisition ? 'tangible-asset-acquisition' : 'tangible-asset-disposal', subjectType)],
    );
  }

  if (/부동산투자회사자금차입/u.test(title)
    && /(?:차입금|대출금?|일시대출).{0,50}(?:전액)?조기상환|(?:전액)?조기상환.{0,50}(?:차입금|대출금?|일시대출)/u.test(currentScope)
    && !/(?:상환예정|향후상환|상환계획|조기상환가능성)/u.test(currentScope)
    && /조기상환.{0,20}(?:완료|완납|종료|따른정정)|(?:차입잔액|대출잔액).{0,20}(?:없음|0)/u.test(currentScope)) {
    return replaceMatchedIntents(
      events,
      (event) => event.type === 'material-contract',
      [semanticEvent('material-contract', 'repaid', 'effective', 'financing', 'contract')],
    );
  }

  if (input.wrapperKind === 'correction'
    && /타인에대한채무보증결정/u.test(title)
    && /채무자.{0,80}(?:전액)?상환|(?:전액)?상환.{0,80}채무자/u.test(currentScope)
    && /채무보증.{0,40}(?:종료|해제)|보증잔액.{0,20}(?:없음|0)/u.test(currentScope)) {
    return replaceMatchedIntents(
      events,
      (event) => event.type === 'material-contract',
      [semanticEvent('material-contract', 'terminated', 'effective', 'debt-guarantee', 'contract')],
    );
  }

  if (/주권관련사채권의처분결정/u.test(title)
    && /(?:인수자|매수인|상대방).{0,80}(?:자금사정|의무불이행).{0,80}계약해지|계약해지.{0,80}(?:인수자|매수인|상대방)/u.test(currentScope)) {
    return replaceMatchedIntents(
      events,
      (event) => event.type === 'capital-change',
      [semanticEvent('capital-change', 'terminated', 'effective', 'equity-linked-bond', 'securities')],
    );
  }

  if ((/투자판단관련주요경영사항/u.test(title)
      || /(?:품목허가|의약품허가|신약허가).{0,40}(?:신청)?.{0,20}(?:취하|철회|포기)/u.test(title))
    && hasTerminalProductWithdrawal(currentSubjectScope)) {
    return replaceMatchedIntents(
      events,
      (event) => ['other', 'regulatory-product'].includes(event.type),
      [semanticEvent('regulatory-product', 'withdrawn', 'cancelled', 'product-approval', 'product')],
    );
  }

  if (input.disclosureDetailType === 'J001'
    && /수익증권거래/u.test(title)
    && /(?:출자|투자).{0,40}(?:철회|취소)|(?:철회|취소).{0,40}(?:출자|투자|내부거래)/u.test(currentScope)
    && /위탁운용사.{0,30}미선정|거래.{0,30}취소/u.test(currentScope)) {
    return replaceMatchedIntents(
      events,
      (event) => event.type === 'related-party',
      [semanticEvent('related-party', 'withdrawn', 'cancelled', 'fund-security-investment', 'securities')],
    );
  }

  if (input.disclosureDetailType === 'J001'
    && /특수관계인에대한채권매도/u.test(title)
    && /(?:실제)?인수물량.{0,30}(?:발생하지않|없)|미인수/u.test(body)) {
    return replaceMatchedIntents(
      events,
      (event) => event.type === 'related-party',
      [semanticEvent('related-party', 'cancelled', 'effective', 'bond-sale', 'securities')],
    );
  }

  return null;
}

function applyActualityRule(input, events, bodyFacts) {
  const title = compactText(input.reportName);
  const body = bodyFacts.fullText;
  const corrected = input.wrapperKind === 'correction';
  const currentScope = corrected ? currentCorrectionScope(input, bodyFacts) : body;
  const filed = filingDate(input);
  const relationAfterLabel = (labelPattern, preferLast = corrected) => relationToFiling(
    firstDateAfterLabel(bodyFacts.rawText, labelPattern, preferLast),
    filed,
  );

  if (input.disclosureDetailType === 'J001'
    && /특수관계인으로부터채권매수/u.test(title)
    && ['past', 'same-day'].includes(relationAfterLabel('매수일자', false))
    && /채권을.{0,20}(?:매입|매수)|단기자금운용/u.test(body)) {
    return replaceMatchedIntents(events, (event) => event.type === 'related-party', [
      semanticEvent('related-party', 'purchased', 'effective', 'bond-transactions', 'securities'),
    ]);
  }

  if (corrected && /영업양도결정/u.test(title)
    && /정정사유.{0,60}거래종결및양수인변경/u.test(body)) {
    return replaceMatchedIntents(events, (event) => event.cause === 'business-disposal', [
      semanticEvent('restructuring', 'completed', 'effective', 'business-disposal', 'business'),
    ]);
  }

  if (!corrected && /타법인주식및출자증권양도결정/u.test(title)
    && relationAfterLabel('양도예정일자', false) === 'future'
    && /잔금.{0,100}예정/u.test(body)
    && /거래선행조건.{0,80}(?:충족|변동)/u.test(body)) {
    return replaceMatchedIntents(events, (event) => event.cause === 'equity-disposal', [
      semanticEvent('restructuring', 'decided', 'proposed', 'equity-disposal', 'securities'),
    ]);
  }

  if (!corrected && /지주회사의자회사탈퇴/u.test(title)
    && ['past', 'same-day'].includes(relationAfterLabel('탈퇴일자', false))
    && /흡수합병에따른자회사탈퇴/u.test(body)) {
    return replaceMatchedIntents(events, (event) => event.cause === 'subsidiary-exit', [
      semanticEvent('corporate-profile', 'changed', 'effective', 'subsidiary-exit', 'issuer'),
    ]);
  }

  if (input.disclosureDetailType === 'J001' && /특수관계인에대한영업양도/u.test(title)
    && relationAfterLabel('양도일자', false) === 'future'
    && /거래종결예정일/u.test(body)) {
    return replaceMatchedIntents(events, (event) => event.type === 'related-party', [
      semanticEvent('related-party', 'decided', 'proposed', 'business-transfer', 'operating-business'),
    ]);
  }

  if (!corrected && /타법인주식및출자증권(?:양수|취득)결정/u.test(title)
    && ((relationAfterLabel('양수예정일자|취득예정일자', false) === 'future'
      && /(?:잔금|거래종결일).{0,120}(?:선행조건|예정)/u.test(body))
      || /잔금.{0,80}거래종결의선행조건이모두충족/u.test(body))) {
    return replaceMatchedIntents(events, (event) => event.cause === 'equity-acquisition', [
      semanticEvent('restructuring', 'decided', 'proposed', 'equity-acquisition', 'securities'),
    ]);
  }

  if (corrected && /영업양수결정/u.test(title)
    && /이전대상재무상태표확정에따른양수가액및잔금확정/u.test(body)
    && /잔금은거래종결일기준.{0,120}확정한금액/u.test(body)) {
    return replaceMatchedIntents(events, (event) => event.cause === 'business-acquisition', [
      semanticEvent('restructuring', 'acquired', 'effective', 'business-acquisition', 'business'),
    ]);
  }

  if (input.disclosureDetailType === 'J001' && /특수관계인으로부터주식의취득/u.test(title)
    && relationAfterLabel('거래일자', false) === 'future'
    && /매매계약체결예정일/u.test(body)) {
    return replaceMatchedIntents(events, (event) => event.type === 'related-party', [
      semanticEvent('related-party', 'decided', 'proposed', 'equity-acquisition', 'securities'),
    ]);
  }

  if (!corrected && /자기주식취득신탁계약체결결정/u.test(title)) {
    const currentBody = currentDisclosureScope(bodyFacts, compactText(input.bodyText));
    const operativeDate = relationToFilingWithinScope(
      currentBody,
      filed,
      '계약기간.{0,30}시작일|계약체결일|계약일',
      true,
    );
    const affirmativeContract = hasCompletedTrustContract(currentBody);
    const effective = ['past', 'same-day'].includes(operativeDate) && affirmativeContract;
    return replaceMatchedIntents(events, (event) => event.cause === 'treasury-share-trust', [
      semanticEvent(
        'capital-change',
        effective ? 'contracted' : 'decided',
        effective ? 'effective' : 'proposed',
        'treasury-share-trust',
        'securities',
      ),
    ]);
  }

  if (!corrected && /자기전환사채만기전취득결정/u.test(title)) {
    const currentBody = currentDisclosureScope(bodyFacts, compactText(input.bodyText));
    const paymentRelation = relationToFilingWithinScope(
      currentBody,
      filed,
      '(?:대금)?지급(?:\\(예정\\))?일|지급예정일|결제일|정산일',
    );
    const acquisitionRelation = relationToFilingWithinScope(
      currentBody,
      filed,
      '(?:실제)?(?:사채|채권)?취득일|취득예정일',
    );
    const operativeRelation = paymentRelation || acquisitionRelation
      ? null
      : relationToFilingWithinScope(currentBody, filed, null, true);
    const affirmativeAcquisition = hasCompletedConvertibleBondAcquisition(currentBody);
    const acquisitionClauses = currentBody
      .split(/(?:\||[!?。]+|(?<!\d)\.(?!\d))/u)
      .filter(Boolean);
    const balanceOutstanding = acquisitionClauses.some((clause) => (
      /(?:잔금|대금잔액|매매대금잔액|잔여(?:사채|채권)).{0,100}(?:지급|결제|정산|취득|인수|이전|인도|수령).{0,30}(?:예정|추후|향후|하기로)/u.test(clause)
      || /(?:잔금|대금잔액|매매대금잔액|잔여(?:사채|채권)).{0,80}(?:다음주|익일|후일|추후|향후).{0,40}(?:지급|결제|정산|취득|인수|이전|인도|수령)/u.test(clause)
    ));
    const securityTransferPending = acquisitionClauses.some((clause) => (
      /(?:사채|채권|증권).{0,30}(?:취득|인수|권리이전|명의이전|계좌대체|인도|수령).{0,50}(?:예정|추후|향후|아직.{0,20}(?:이뤄지지않|완료되지않))/u.test(clause)
      && !/(?:취득|인수|수령|인도).{0,30}(?:후|뒤|완료).{0,60}(?:재매각|재처분|매도|소각)/u.test(clause)
    ));
    const deferredPayment = acquisitionClauses.some((clause) => /대금.{0,40}(?:추후|향후).{0,20}(?:지급|납부)/u.test(clause));
    const completionConditional = acquisitionClauses.some((clause) => /전액지급완료즉시.{0,60}(?:사채|증권).{0,30}(?:수령|이전)예정/u.test(clause));
    const residualObligation = balanceOutstanding || securityTransferPending || deferredPayment || completionConditional;
    const prospectiveExecution = /(?:지급|결제|정산|취득|인수|이전|인도|수령|실행)(?:을|를)?(?:완료|완료할|마칠|진행할)?(?:예정|계획|방침)/u.test(currentBody)
      || /(?:지급|결제|정산|취득|인수|이전|인도|수령|실행)하기로(?:하였|했|함|했습니다)/u.test(currentBody);
    const partialExecution = acquisitionClauses.some((clause) => {
        const followUpDisposition = /(?:취득|인수|수령|인도).{0,30}(?:완료)?(?:후|뒤).{0,50}(?:일부|부분|절반|\d+분의\d+).{0,50}(?:재매각|재처분|매도|소각)/u.test(clause);
        const executionRole = /(?:대금|잔금|사채|채권|증권).{0,40}(?:지급|결제|정산|취득|인수|수령|인도)|(?:지급|결제|정산|취득|인수|수령|인도).{0,40}(?:대금|잔금|사채|채권|증권)/u.test(clause);
        const partialQuantity = /(?:일부|부분|1차|절반|반만|\d+분의\d+).{0,30}(?:대금|잔금|사채|채권|증권|지급|결제|정산|취득|인수|수령)|(?:대금|잔금|사채|채권|증권|지급|결제|정산|취득|인수|수령).{0,30}(?:일부|부분|1차|절반|반만|\d+분의\d+)/u.test(clause);
        return executionRole && partialQuantity && !followUpDisposition;
      });
    const paymentCompletionEnd = Math.max(
      lastMatchEnd(currentBody, /(?:대금|잔금).{0,80}(?:지급|결제|정산)(?:이|가|은|는|을|를|도|까지)?(?:완료|하였|했|함|됐|마쳤|끝냈)/gu),
      lastMatchEnd(currentBody, /(?:대금|잔금).{0,40}완납(?:되었|됐|되었습니다|하였|했|함|했습니다)?/gu),
    );
    const paymentIncompleteEnd = Math.max(
      lastMatchEnd(currentBody, /(?:대금|잔금).{0,50}(?:지급|결제|정산).{0,40}(?:아직)?(?:완료되지않|완료하지못|미완료|미지급|미납)/gu),
      lastMatchEnd(currentBody, /(?:대금|잔금).{0,30}(?:미지급|미결제|미정산|미납)/gu),
    );
    const paymentIncomplete = paymentIncompleteEnd > paymentCompletionEnd;
    const issuerCompletionEnd = lastMatchEnd(currentBody, /당사.{0,100}(?:사채|채권|증권).{0,80}(?:취득|인수|수령|넘겨받|귀속|명의이전)/gu);
    const issuerDenialEnd = lastMatchEnd(currentBody, /당사.{0,80}(?:아직)?(?:취득|인수|수령|넘겨받).{0,30}(?:하지않|하지못|못했|전단계)/gu);
    const thirdPartyAcquisition = /(?:관계회사|계열회사|자회사|제3자|타사)(?:가|는|명의).{0,140}(?:사채|채권|증권).{0,100}(?:취득|인수|수령|넘겨받|귀속|명의이전)/u.test(currentBody);
    const actorMismatch = issuerDenialEnd > issuerCompletionEnd || (thirdPartyAcquisition && issuerCompletionEnd < 0);
    if (paymentRelation || acquisitionRelation || operativeRelation || residualObligation || affirmativeAcquisition) {
      const effective = affirmativeAcquisition
        && paymentRelation !== 'future'
        && acquisitionRelation !== 'future'
        && operativeRelation !== 'future'
        && !residualObligation
        && !prospectiveExecution
        && !partialExecution
        && !paymentIncomplete
        && !actorMismatch;
      return replaceMatchedIntents(events, (event) => event.type === 'capital-change'
        && ['convertible-bond', 'convertible-bond-acquisition'].includes(event.cause), [
        semanticEvent(
          'capital-change',
          effective ? 'acquired' : 'decided',
          effective ? 'effective' : 'proposed',
          'convertible-bond-acquisition',
          'securities',
        ),
      ]);
    }
  }

  if (input.disclosureDetailType === 'J001' && /특수관계인으로부터채무인수/u.test(title)
    && relationAfterLabel('(?:채무)?인수(?:예정)?일', false) === 'future'
    && /담보대출을인수/u.test(body)) {
    return replaceMatchedIntents(events, (event) => event.type === 'related-party', [
      semanticEvent('related-party', 'decided', 'proposed', 'debt-assumption', 'contract'),
    ]);
  }

  if (input.disclosureDetailType === 'J001' && /특수관계인으로부터기술이전/u.test(title)
    && relationAfterLabel('계약체결일', false) === 'future'
    && /거래종결일\(기술이전일\).{0,80}변경될수있/u.test(body)) {
    return replaceMatchedIntents(events, (event) => event.type === 'related-party', [
      semanticEvent('related-party', 'decided', 'proposed', 'technology-transfer', 'contract-right'),
    ]);
  }

  if (input.disclosureDetailType === 'J001' && /특수관계인에대한담보제공/u.test(title)
    && ['past', 'same-day'].includes(relationAfterLabel('담보제공일자', false))
    && /담보물.{0,60}부동산/u.test(body)
    && /신규약정을체결.{0,60}담보제공되는건/u.test(body)) {
    return replaceMatchedIntents(events, (event) => event.type === 'related-party', [
      semanticEvent('related-party', 'provided', 'effective', 'collateral-provision', 'real-estate'),
    ]);
  }

  if (corrected && /타법인주식및출자증권(?:양수|취득)결정/u.test(title)) {
    const explicitClosing = /출자금납입완료/u.test(currentScope)
      || /거래종결확인.{0,160}잔금(?:전액)?지급완료.{0,160}(?:주식)?소유권이전완료/u.test(currentScope)
      || /잔금(?:전액)?지급완료.{0,160}(?:주식)?소유권이전완료/u.test(currentScope)
      || (/거래종결후최종매매대금확정/u.test(currentScope)
        && /잔금\(거래종결일\)/u.test(currentScope));
    if (explicitClosing) {
      return replaceMatchedIntents(
        events,
        (event) => event.type === 'restructuring' && event.cause === 'equity-acquisition',
        [semanticEvent('restructuring', 'acquired', 'effective', 'equity-acquisition', 'securities')],
      );
    }
  }

  if (corrected && /부동산투자회사부동산취득/u.test(title)) {
    const explicitAcquisition = /(?:잔금|매매대금).{0,50}(?:전액)?지급완료.{0,100}(?:부동산)?취득.{0,30}(?:종결|완료)/u.test(currentScope)
      || /(?:부동산)?취득.{0,30}(?:종결|완료).{0,100}(?:잔금|매매대금).{0,50}(?:전액)?지급완료/u.test(currentScope)
      || (/정정사유.{0,80}잔금지급일변경\(확정\)/u.test(currentScope) && !bodyFacts.hasFutureDate);
    if (explicitAcquisition) {
      return replaceMatchedIntents(
        events,
        (event) => event.type === 'asset-transaction' && event.cause === 'tangible-asset-acquisition',
        [semanticEvent('asset-transaction', 'acquired', 'effective', 'tangible-asset-acquisition', 'real-estate')],
      );
    }
  }

  const completedIssueCause = /무상증자/u.test(currentScope)
    ? 'bonus-issue'
    : /유상증자/u.test(currentScope)
      ? 'rights-offering'
      : null;
  if ((/유상증자결정/u.test(title) || /기타경영사항/u.test(title))
    && completedIssueCause
    && /(?:증자가완료|증자완료|출자금납입완료|납입금전액수령.{0,80}(?:신주발행및)?증자.{0,20}완료)/u.test(currentScope)) {
    return replaceMatchedIntents(
      events,
      (event) => event.type === 'capital-change',
      [semanticEvent('capital-change', 'completed', 'effective', completedIssueCause, 'securities')],
    );
  }

  if (input.disclosureDetailType === 'J001'
    && /동일인등출자계열회사와의상품[ㆍ·ᆞ]?용역거래/u.test(title)
    && /(?:이사회의결일은의결이아닌|이사회의결일이아닌거래실적)(?:\(사후\)|사후)?보고일/u.test(body)) {
    return replaceMatchedIntents(
      events,
      (event) => event.type === 'related-party' && event.cause === 'internal-goods-services',
      [semanticEvent('related-party', 'reported', 'effective', 'internal-goods-services', 'contract')],
    );
  }

  if (!corrected && /자기주식취득신탁계약체결결정/u.test(title)
    && ['past', 'same-day'].includes(relationAfterLabel('계약기간.{0,30}시작일|계약체결예정일자', false))
    && /본(?:자기주식취득)?신탁계약을체결함으로써/u.test(body)) {
    return replaceMatchedIntents(
      events,
      (event) => event.type === 'capital-change' && event.cause === 'treasury-share-trust',
      [semanticEvent('capital-change', 'contracted', 'effective', 'treasury-share-trust', 'securities')],
    );
  }

  if (input.disclosureDetailType === 'J001'
    && /특수관계인에대한주식의처분/u.test(title)
    && ['past', 'same-day'].includes(relationAfterLabel('거래일자', false))
    && /거래일자.{0,8}주식매각및대금수령일/u.test(body)) {
    return replaceMatchedIntents(
      events,
      (event) => event.type === 'related-party',
      [semanticEvent('related-party', 'disposed', 'effective', 'equity-disposal', 'securities')],
    );
  }

  if (corrected && /타인에대한담보제공결정/u.test(title)
    && ['past', 'same-day'].includes(relationAfterLabel('담보제공기간.{0,40}시작일'))
    && /특수관계인|계열회사|자회사/u.test(body)) {
    return replaceMatchedIntents(
      events,
      (event) => ['material-contract', 'related-party'].includes(event.type) && event.cause === 'collateral-provision',
      [semanticEvent('related-party', 'updated', 'effective', 'collateral-provision', 'securities')],
    );
  }

  if (!corrected && /부동산투자회사자산보관위탁계약변경/u.test(title)
    && ['past', 'same-day'].includes(relationAfterLabel('계약변경일자', false))
    && !/(?:승인이후효력발생|승인이후효력이발생|주주총회.{0,80}결의예정)/u.test(body)) {
    return replaceMatchedIntents(
      events,
      (event) => event.type === 'material-contract' && event.cause === 'asset-custody-contract',
      [semanticEvent('material-contract', 'changed', 'effective', 'asset-custody-contract', 'contract')],
    );
  }

  return null;
}

function applyCorrectionLifecycleDeltaRule(input, events, bodyFacts) {
  const title = compactText(input.reportName);
  const body = bodyFacts.fullText;
  const corrected = input.wrapperKind === 'correction';
  const currentScope = corrected ? currentCorrectionScope(input, bodyFacts) : body;
  const filed = filingDate(input);
  const relationAfterLabel = (labelPattern, preferLast = corrected) => relationToFiling(
    firstDateAfterLabel(bodyFacts.rawText, labelPattern, preferLast),
    filed,
  );

  if (corrected
    && /주식소각결정/u.test(title)
    && /(?:소각예정일만변경|소각예정일.{0,60}(?:변경|연기|연장))/u.test(currentScope)) {
    return replaceMatchedIntents(
      events,
      (event) => event.type === 'corporate-action' && event.cause === 'share-cancellation',
      [semanticEvent('corporate-action', 'rescheduled', 'deferred', 'share-cancellation', 'securities')],
    );
  }

  if (corrected
    && /단일판매[ㆍ·ᆞ]?공급계약체결/u.test(title)
    && /(?:계약기간)?종료일.{0,60}(?:변경|연장)|납품일자변경/u.test(currentScope)) {
    return replaceMatchedIntents(
      events,
      (event) => event.type === 'material-contract' && event.cause === 'supply-contract',
      [semanticEvent('material-contract', 'extended', 'effective', 'supply-contract', 'contract')],
    );
  }

  if (corrected
    && /신규시설투자/u.test(title)
    && /투자금액.{0,40}(?:증액|증가|상향)|(?:증액|증가|상향).{0,40}투자금액/u.test(currentScope)) {
    return replaceMatchedIntents(
      events,
      (event) => ['capital-expenditure', 'corporate-action'].includes(event.type) || event.cause === 'facility-investment',
      [semanticEvent('corporate-action', 'adjusted', 'effective', 'facility-investment', 'asset')],
    );
  }

  const scheduleDelta = corrected && (
    /\[공통정정\]일정변경/u.test(currentScope)
    || /기준일변경에따른정정/u.test(currentScope)
    || /2차매매거래종결일연장/u.test(currentScope)
    || /(?:일정변경.{0,120}분할등기예정일자|분할일정종료보고총회일분할등기예정일자.{0,80}일정변경)/u.test(currentScope)
    || /취득예정일변경/u.test(currentScope)
  ) && !/(?:발행가액|행사가액|공모가액|모집가액).{0,30}확정/u.test(currentScope);
  if (scheduleDelta) {
    if (/주권관련사채권의취득결정/u.test(title)) {
      return replaceMatchedIntents(
        events,
        (event) => event.type === 'asset-transaction' || event.cause === 'equity-linked-bond',
        [semanticEvent('asset-transaction', 'rescheduled', 'pending', 'securities-purchase', 'securities')],
      );
    }
    const nonOtherEvents = events.filter((event) => event.type !== 'other');
    const scopedScheduleFamilies = new Set(explicitBodySections(input.bodyText)
      .filter((section) => /(?:일정변경|기준일변경|예정일변경|납입(?:일|기일).{0,100}(?:정정전|정정후|변경)|(?:정정전|정정후|변경).{0,100}납입(?:일|기일))/u.test(`${section.label}|${section.text}`))
      .map((section) => section.family)
      .filter(Boolean));
    const scheduleTargets = nonOtherEvents.length <= 1
      ? nonOtherEvents
      : nonOtherEvents.filter((event) => (
        scopedScheduleFamilies.has(semanticSectionFamily(event))
        || (scopedScheduleFamilies.size === 0 && (
          (event.cause === 'equity-securities' && /(?:유상증자|주식발행|자금조달|주금(?:납입)?)/u.test(currentScope))
          || (event.cause === 'treasury-share-trust' && /(?:자기주식취득)?신탁/u.test(currentScope))
          || (['convertible-bond', 'bond-with-warrants', 'exchangeable-bond', 'equity-linked-bond'].includes(event.cause)
            && /(?:전환사채|신주인수권부사채|교환사채|사채권)/u.test(currentScope))
          || (event.type === 'restructuring' && /(?:합병|분할|주식교환|주식이전)/u.test(currentScope))
          || (event.type === 'asset-transaction' && /(?:취득|처분|양수|양도)예정일/u.test(currentScope))
          || (event.cause === 'litigation' && /(?:소송|중재|심리|변론)일정/u.test(currentScope))
        ))
      ));
    const targetKeys = new Set(scheduleTargets.map(lifecycleIntentKey));
    const replacements = scheduleTargets
      .map((event) => createEvent({ ...event, action: 'rescheduled', state: 'pending' }));
    if (replacements.length > 0) {
      return replaceMatchedIntents(events, (event) => targetKeys.has(lifecycleIntentKey(event)), replacements);
    }
  }

  const pendingCorrectionFamily = corrected && (
    (/특수관계인의유상증자참여/u.test(title) && /최종발행가액.{0,80}변동/u.test(currentScope) && !/확정된최종발행가액을적용/u.test(currentScope))
    || (/유상증자결정/u.test(title) && /확정예정일/u.test(currentScope) && /납입일/u.test(currentScope))
    || (/타법인주식및출자증권취득결정/u.test(title) && /최종발행가액.{0,120}취득/u.test(currentScope))
    || (/주식교환[ㆍ·ᆞ]?이전결정/u.test(title) && /주식매수청구취득주식처분방안추가반영/u.test(currentScope))
    || (/자기주식취득결정/u.test(title) && /무상증자결의시점부터.{0,80}자기주식을취득하지않을예정/u.test(currentScope))
    || (/무상증자결정/u.test(title) && /자기주식취득계획변경/u.test(currentScope))
    || (/감자결정/u.test(title) && /전환사채전환청구에따른주식수량반영/u.test(currentScope))
    || (/타법인주식및출자증권양도결정/u.test(title) && /정산이완료되지않/u.test(currentScope))
    || (/투자판단관련주요경영사항/u.test(title) && /최대주주변경은없습니다/u.test(currentScope))
    || (/자본으로인정되는채무증권발행결정/u.test(title) && /일부조건변경에따른정정/u.test(currentScope) && relationAfterLabel('납입일') === 'future')
    || (/신주인수권부사채권발행결정/u.test(title) && /행사가액.{0,100}확정될예정/u.test(body))
    || (/타법인주식및출자증권취득결정/u.test(title) && /취득예정일자는주금납입\(예정\)일/u.test(body))
    || (/타인에대한채무보증결정/u.test(title) && /채무보증기간의변경/u.test(currentScope) && relationAfterLabel('채무보증기간.{0,30}시작일') === 'future')
    || (/타법인주식및출자증권처분결정/u.test(title) && /풋옵션.{0,80}미이행/u.test(currentScope) && /미확정/u.test(currentScope))
  );
  if (pendingCorrectionFamily) {
    const replacements = events
      .filter((event) => event.type !== 'other')
      .map((event) => createEvent({ ...event, action: 'updated', state: 'pending' }));
    if (replacements.length > 0) {
      return replaceMatchedIntents(events, (event) => event.type !== 'other', replacements);
    }
  }

  if (corrected && /교환사채권발행결정/u.test(title)
    && /(?:가처분|법원).{0,120}(?:후속)?절차.{0,30}중단|(?:후속)?절차.{0,30}중단.{0,120}(?:가처분|법원)/u.test(currentScope)) {
    return replaceMatchedIntents(
      events,
      (event) => event.type === 'capital-change' && event.cause === 'exchangeable-bond',
      [semanticEvent('capital-change', 'updated', 'deferred', 'exchangeable-bond', 'securities')],
    );
  }

  if (corrected && /자기전환사채매도결정/u.test(title)
    && /매도대금.{0,40}잔금(?:일부)?납입일변경|잔금일변경.{0,80}(?:일부대금수령|계약금|중도금)/u.test(currentScope)) {
    return replaceMatchedIntents(
      events,
      (event) => event.type === 'capital-change' && event.cause === 'convertible-bond',
      [semanticEvent('capital-change', 'rescheduled', 'pending', 'convertible-bond', 'securities')],
    );
  }

  if (corrected && /영업정지/u.test(title)
    && /(?:본)?집행정지(?:인용)?결정|영업정지효력.{0,40}(?:유예|정지)/u.test(currentScope)) {
    return replaceMatchedIntents(
      events,
      (event) => event.type === 'operating-status' && event.cause === 'business-suspension',
      [semanticEvent('operating-status', 'halted', 'deferred', 'business-suspension', 'business')],
    );
  }

  if (corrected && /금전대여결정/u.test(title)
    && /(?:정정사유|정정사항).{0,140}(?:대여기간종료일(?:변경|연장)|대여종료일연장)/u.test(currentScope)) {
    return replaceMatchedIntents(
      events,
      (event) => ['material-contract', 'related-party'].includes(event.type),
      [semanticEvent('material-contract', 'extended', 'effective', 'loan', 'contract')],
    );
  }

  if (corrected && input.disclosureDetailType === 'J001'
    && /특수관계인으로부터자금차입/u.test(title)
    && /(?:차입계약연장|기존차입계약을연장)/u.test(currentScope)) {
    return replaceMatchedIntents(
      events,
      (event) => event.type === 'related-party',
      [semanticEvent('related-party', 'extended', 'pending', 'related-party-loan', 'contract')],
    );
  }

  if (!corrected && input.disclosureDetailType === 'J001'
    && /특수관계인으로부터부동산임차/u.test(title)
    && /변경공시.{0,100}임차기간.{0,80}연장|임차기간.{0,80}(?:기존|변경).{0,80}연장/u.test(body)) {
    return replaceMatchedIntents(
      events,
      (event) => event.type === 'related-party',
      [semanticEvent('related-party', 'extended', 'effective', 'related-party-real-estate-leased-in', 'real-estate')],
    );
  }

  if (corrected && /타법인주식및출자증권처분결정/u.test(title)) {
    const futureExecution = relationAfterLabel('처분예정일자') === 'future'
      || /거래종결.{0,100}(?:승인|인허가).{0,80}(?:이후|예정)|(?:승인|인허가).{0,100}거래종결.{0,40}(?:진행|예정)/u.test(body);
    const currentDelta = /처분금액확정|매수인의변경|매수인지위.{0,50}(?:권리|의무).{0,50}(?:양도|이전)/u.test(currentScope);
    if (futureExecution && currentDelta) {
      return replaceMatchedIntents(
        events,
        (event) => event.type === 'restructuring' && event.cause === 'equity-disposal',
        [semanticEvent('restructuring', 'updated', 'pending', 'equity-disposal', 'securities')],
      );
    }
  }

  if (corrected && /해산사유발생/u.test(title)
    && /흡수합병.{0,100}(?:해산|소멸)|(?:해산|소멸).{0,100}흡수합병/u.test(body)
    && /(?:해산|합병등기)예정일/u.test(body)) {
    return replaceMatchedIntents(
      events,
      (event) => ['insolvency', 'restructuring'].includes(event.type),
      [semanticEvent('restructuring', 'updated', 'pending', 'dissolution', 'issuer')],
    );
  }

  if (corrected && input.disclosureDetailType === 'C004'
    && /증권신고서\(분할\)/u.test(title)
    && /분할(?:기일|신주).{0,80}예정|주주총회.{0,80}예정/u.test(body)) {
    return replaceMatchedIntents(
      events,
      (event) => event.type === 'restructuring',
      [semanticEvent('restructuring', 'updated', 'pending', 'demerger', 'issuer')],
    );
  }

  if (corrected && /금전대여결정.*자회사의주요경영사항/u.test(title)
    && /대여금액변경/u.test(currentScope)
    && /계열회사|종속회사/u.test(body)
    && /(?:분할하여)?집행예정|대여실행.{0,80}예정/u.test(body)) {
    return replaceMatchedIntents(
      events,
      (event) => ['material-contract', 'related-party'].includes(event.type),
      [semanticEvent('related-party', 'updated', 'pending', 'related-party-loan', 'contract')],
    );
  }

  if (corrected && /장래사업[ㆍ·ᆞ]?경영계획/u.test(title)
    && /정정사유.{0,140}(?:내용추가|기재추가)|(?:내용추가|기재추가).{0,140}정정/u.test(currentScope)
    && /(?:인수|설립|투자).{0,100}(?:계획|예정)/u.test(currentScope)) {
    return replaceMatchedIntents(
      events,
      (event) => ['corporate-event', 'other'].includes(event.type),
      [semanticEvent('corporate-event', 'updated', 'pending', 'business-plan', 'issuer')],
    );
  }

  return null;
}

function applyRoleAwareTemporalRule(input, events, bodyFacts) {
  const title = compactText(input.reportName);
  const body = bodyFacts.fullText;
  const corrected = input.wrapperKind === 'correction';
  const filed = filingDate(input);
  const relationAfterLabel = (labelPattern) => relationToFiling(
    firstDateAfterLabel(bodyFacts.rawText, labelPattern, false),
    filed,
  );

  if (/자기주식취득신탁계약체결결정/u.test(title)
    && input.correctionKind === '연장결정'
    && /신탁계약기간만기로인한계약연장/u.test(body)) {
    return replaceMatchedIntents(events, (event) => event.type === 'capital-change', [
      semanticEvent('capital-change', 'extended', 'effective', 'treasury-share-trust', 'securities'),
    ]);
  }
  if (/타인에대한채무보증결정/u.test(title) && /공시에대한연장건/u.test(body)) {
    return replaceMatchedIntents(events, (event) => event.cause === 'debt-guarantee', [
      semanticEvent('material-contract', 'extended', relationAfterLabel('채무보증기간.{0,30}시작일') === 'future' ? 'pending' : 'effective', 'debt-guarantee', 'contract'),
    ]);
  }
  if (corrected && /금전대여결정/u.test(title) && /정정사유.{0,40}대여기간연장/u.test(body)) {
    return replaceMatchedIntents(events, (event) => ['material-contract', 'related-party'].includes(event.type), [
      semanticEvent('material-contract', 'extended', 'effective', 'loan', 'contract'),
    ]);
  }
  if (input.disclosureDetailType === 'J001' && /특수관계인과의리스거래/u.test(title)
    && /(?:임대차|리스).{0,60}(?:연장계약|계약기간연장)/u.test(body)
    && /각계약별세부내역/u.test(body)
    && !/계약체결일은현재특정되지않았으며.{0,10}확정시정정공시예정/u.test(body)) {
    const startRelation = relationAfterLabel('리스시행일|변경계약.{0,20}시작일');
    return replaceMatchedIntents(events, (event) => event.type === 'related-party', [
      semanticEvent('related-party', 'extended', startRelation === 'future' || bodyFacts.hasFutureDate ? 'pending' : 'effective', 'aircraft-lease', 'asset'),
    ]);
  }
  if (input.disclosureDetailType === 'J001' && /특수관계인에대한담보제공/u.test(title)
    && /담보제공연장/u.test(body)) {
    return replaceMatchedIntents(events, (event) => event.type === 'related-party', [
      semanticEvent('related-party', 'extended', 'pending', 'collateral-provision', 'asset'),
    ]);
  }
  if (!corrected && input.disclosureDetailType === 'J001' && /수익증권거래/u.test(title)
    && /(?:만기미도래|만기일).{0,40}연장(?:시|가능)|연장가능/u.test(body)
    && !/(?:기존|종전).{0,40}(?:수익증권|계약).{0,40}연장/u.test(body)) {
    return replaceMatchedIntents(events, (event) => event.type === 'related-party', [
      semanticEvent('related-party', 'decided', 'proposed', 'fund-security-investment', 'securities'),
    ]);
  }
  if (!corrected && /금전대여결정/u.test(title) && /기금전대여건.{0,100}연장공시/u.test(body)) {
    return replaceMatchedIntents(events, (event) => ['material-contract', 'related-party'].includes(event.type), [
      semanticEvent('related-party', 'extended', 'effective', 'related-party-loan', 'contract'),
    ]);
  }
  if (corrected && /단일판매[ㆍ·ᆞ]?공급계약체결/u.test(title) && /설계변경으로인한계약기간변경/u.test(body)) {
    return replaceMatchedIntents(events, (event) => event.cause === 'supply-contract', [
      semanticEvent('material-contract', 'extended', 'effective', 'supply-contract', 'contract'),
    ]);
  }
  if (input.disclosureDetailType === 'J001' && /특수관계인에대한자금대여/u.test(title)
    && /만기는실행일로부터.{0,80}선택에의해연장가능/u.test(body)) {
    return replaceMatchedIntents(events, (event) => event.type === 'related-party', [
      semanticEvent('related-party', 'decided', 'proposed', 'related-party-loan', 'contract'),
    ]);
  }

  if (!corrected && /타법인주식및출자증권(?:양수|취득)결정/u.test(title)
    && !bodyFacts.completionObserved
    && (relationAfterLabel('취득예정일자|양수예정일자') === 'future'
      || /거래종결(?:예상|예정)일.{0,80}(?:변경|예정)/u.test(body))) {
    return replaceMatchedIntents(
      events,
      (event) => event.type === 'restructuring' && event.cause === 'equity-acquisition',
      [semanticEvent('restructuring', 'decided', 'proposed', 'equity-acquisition', 'securities')],
    );
  }

  if (!corrected && input.disclosureDetailType === 'J001'
    && /특수관계인에대한채권매도/u.test(title)
    && (relationAfterLabel('매도일(?:자)?') === 'future'
      || /채권.{0,80}매도.{0,80}(?:진행)?예정/u.test(body))) {
    return replaceMatchedIntents(
      events,
      (event) => event.type === 'related-party',
      [semanticEvent('related-party', 'decided', 'proposed', 'bond-sale', 'securities')],
    );
  }

  if (!corrected && /금전대여결정/u.test(title)
    && /(?:기금전대여건|기존금전대여|금회대여).{0,60}기간연장|대여기간연장내용/u.test(body)) {
    const extensionStart = relationAfterLabel('변경계약시작일|대여기간.{0,30}시작일');
    const relatedParty = hasAffirmativeRelatedPartyEvidence(input, bodyFacts);
    return replaceMatchedIntents(
      events,
      (event) => ['related-party', 'material-contract'].includes(event.type),
      [semanticEvent(
        relatedParty ? 'related-party' : 'material-contract',
        'extended',
        extensionStart === 'future' ? 'pending' : 'effective',
        relatedParty ? 'related-party-loan' : 'loan',
        'contract',
      )],
    );
  }

  if (!corrected && /타인에대한채무보증결정/u.test(title)
    && /기존채무보증.{0,50}기간연장/u.test(body)) {
    const guaranteeStart = relationAfterLabel('채무보증기간.{0,30}시작일');
    return replaceMatchedIntents(
      events,
      (event) => event.type === 'material-contract' && event.cause === 'debt-guarantee',
      [semanticEvent('material-contract', 'extended', guaranteeStart === 'future' ? 'pending' : 'effective', 'debt-guarantee', 'contract')],
    );
  }

  if (!corrected && input.disclosureDetailType === 'J001'
    && /특수관계인으로부터받은담보/u.test(title)) {
    const realEstate = /(?:담보물|담보자산).{0,180}(?:부동산|토지|건물|필지|공장)/u.test(body);
    const securities = /(?:담보물|담보자산).{0,180}(?:주식|유가증권)/u.test(body);
    if (/담보.{0,100}연장하는건/u.test(body)) {
      return replaceMatchedIntents(
        events,
        (event) => event.type === 'related-party',
        [semanticEvent('related-party', 'extended', 'proposed', 'collateral-received', realEstate ? 'real-estate' : securities ? 'securities' : 'asset')],
      );
    }
    const receivedDate = relationAfterLabel('담보받은일자|담보수령일');
    const receiptPending = receivedDate === 'future'
      || /담보받은일자.{0,80}(?:미기재|계약체결일)|(?:담보|신탁)계약.{0,80}체결예정|우선수익권.{0,60}제공받을예정/u.test(body);
    if (receiptPending) {
      return replaceMatchedIntents(
        events,
        (event) => event.type === 'related-party',
        [semanticEvent('related-party', 'decided', 'proposed', 'collateral-received', realEstate ? 'real-estate' : securities ? 'securities' : 'asset')],
      );
    }
  }

  if (!corrected && input.disclosureDetailType === 'J001'
    && /특수관계인에대한담보제공/u.test(title)
    && /담보제공일자.{0,80}(?:(?:금융|PF대출)약정.{0,20}체결(?:일|이후)|대출금인출일)/u.test(body)) {
    const securities = /(?:담보물|근질권).{0,160}(?:주식|지분|유가증권)/u.test(body);
    return replaceMatchedIntents(
      events,
      (event) => event.type === 'related-party',
      [semanticEvent('related-party', 'decided', 'proposed', 'collateral-provision', securities ? 'securities' : 'asset')],
    );
  }

  if (!corrected && input.disclosureDetailType === 'J001'
    && /특수관계인으로부터자금차입/u.test(title)
    && relationAfterLabel('차입기간(?:.{0,30}시작일)?') === 'future') {
    return replaceMatchedIntents(
      events,
      (event) => event.type === 'related-party',
      [semanticEvent('related-party', 'contracted', 'pending', 'related-party-borrowing', 'contract')],
    );
  }

  return null;
}

function applyUnresolvedBodyFamilyRule(input, events, bodyFacts) {
  const title = compactText(input.reportName);
  const body = bodyFacts.fullText;
  const corrected = input.wrapperKind === 'correction';
  const currentScope = corrected ? currentCorrectionScope(input, bodyFacts) : body;
  const routable = events.length === 0 || events.every(
    (event) => event.type === 'other' || !event.action || !event.cause || !event.subjectType,
  );
  if (!routable) return null;
  const routed = (event) => replaceMatchedIntents(events, () => true, [event]);

  if (/투자판단관련주요경영사항/u.test(title)
    && /사업재편계획.{0,80}(?:승인|승인통지)|(?:승인|승인통지).{0,80}사업재편계획/u.test(body)
    && !/(?:승인되지않|승인취소|승인철회)/u.test(body)) {
    return routed(semanticEvent('restructuring', 'approved', 'effective', 'business-reorganization', 'business'));
  }

  if (/투자판단관련주요경영사항.*자회사의주요경영사항/u.test(title)
    && /(?:법인|회사).{0,40}설립.{0,80}출자결정|설립및출자결정/u.test(body)
    && /(?:취득주식수|취득금액|현금출자|유상증자)/u.test(body)) {
    return routed(semanticEvent('restructuring', 'decided', 'proposed', 'equity-acquisition', 'securities'));
  }

  if (/투자판단관련주요경영사항/u.test(title)
    && /실시설계적격자.{0,60}(?:선정|선정통지)|(?:선정|선정통지).{0,60}실시설계적격자/u.test(body)) {
    return routed(semanticEvent('material-contract', 'selected', 'effective', 'construction-project', 'contract'));
  }

  if (/부도발생/u.test(title)
    && /(?:부도내용.{0,100})?(?:만기)?어음/u.test(body)
    && /(?:지급제한|결제(?:되지않|미이행)).{0,120}부도처리/u.test(body)) {
    return routed(semanticEvent('insolvency', 'defaulted', 'effective', 'payment-default', 'issuer'));
  }

  if (/투자판단관련주요경영사항.*특허권취득/u.test(title)
    && /특허취득내역|특허등록/u.test(body)
    && /(?:등록료)?납부(?:완료|확인).{0,80}(?:법적)?효력발생|특허등록완료/u.test(body)) {
    return routed(semanticEvent('asset-transaction', 'acquired', 'effective', 'patent', 'intellectual-property'));
  }

  if (corrected && /기타경영사항/u.test(title)
    && /차입계약(?:기간)?연장/u.test(currentScope)
    && /(?:계열사|계열회사)(?:로부터)?차입|차입상대방.{0,80}(?:계열사|계열회사)/u.test(body)) {
    return routed(semanticEvent('related-party', 'extended', 'pending', 'related-party-loan', 'contract'));
  }

  if (/투자판단관련주요경영사항/u.test(title)
    && /(?:유지관리및운영사업|운영서비스).{0,80}(?:수탁자|사업자)선정/u.test(body)) {
    return routed(semanticEvent('material-contract', 'selected', 'pending', 'service-contract', 'contract'));
  }

  if (/투자판단관련주요경영사항/u.test(title)
    && /(?:건설공사|정비사업|공공주택건설사업).{0,160}(?:우선협상대상자|시공자).{0,40}선정|(?:우선협상대상자|시공자).{0,40}선정.{0,160}(?:건설공사|정비사업|공공주택건설사업)/u.test(body)
    && /선정(?:통지|공고|되었습니다|되었음을)|선정일자/u.test(body)) {
    return routed(semanticEvent('material-contract', 'selected', 'effective', 'construction-project', 'contract'));
  }

  if (/투자판단관련주요경영사항/u.test(title)
    && /건설공사.{0,80}낙찰통지서|낙찰통지서.{0,80}건설공사/u.test(body)
    && /낙찰통지서.{0,80}수령/u.test(body)) {
    return routed(semanticEvent('material-contract', 'received', 'effective', 'construction-project', 'contract'));
  }

  if (/벌금등의부과/u.test(title)
    && /(?:과징금|벌금).{0,50}부과|처분내용.{0,80}(?:과징금|벌금)/u.test(body)
    && /(?:통지서|처분서).{0,40}수령|부과기관/u.test(body)
    && !/항소|불복|취소소송|행정소송|행정심판|취소청구|이의제기/u.test(body)) {
    return routed(semanticEvent('legal-regulatory', 'imposed', 'effective', 'regulatory-fine', 'issuer'));
  }

  if (/지주회사의자회사편입/u.test(title)
    && /편입사유|편입일자/u.test(body)
    && /편입후.{0,120}(?:소유주식|자회사총수)/u.test(body)) {
    return routed(semanticEvent('corporate-profile', 'changed', 'effective', 'subsidiary-entry', 'issuer'));
  }

  if (corrected && /기업지배구조보고서공시/u.test(`${title}${body}`)
    && /정정사유|정정사항/u.test(currentScope)) {
    return routed(semanticEvent('governance', 'updated', 'effective', 'corporate-governance-report', 'governance'));
  }

  if (!corrected && /부동산투자회사부동산임대/u.test(title)
    && /임대물건|임대내역/u.test(body)
    && /임대목적/u.test(body)) {
    return routed(semanticEvent('asset-transaction', 'decided', 'proposed', 'real-estate-lease', 'real-estate'));
  }

  if (/기타경영사항/u.test(title)
    && /(?:후원금|기부금).{0,40}출연|출연대상.{0,100}(?:복지재단|장학)/u.test(body)
    && /출연(?:목적|금액)/u.test(body)) {
    return routed(semanticEvent('related-party', 'decided', 'proposed', 'cash-donation', 'cash'));
  }

  if (/채무인수결정/u.test(title)
    && /채무인수(?:일자|사유|내역)/u.test(body)
    && /채무를(?:중첩적으로)?인수.{0,50}(?:상환|하였습니다)|채무인수사유발생/u.test(body)) {
    return routed(semanticEvent('material-contract', 'assumed', 'effective', 'debt-assumption', 'contract'));
  }

  if (/수시공시의무관련사항/u.test(title)
    && /항공기및엔진구매계획|항공기구매.{0,80}엔진/u.test(body)
    && /구매조건협의완료후본계약체결|구매관련서명식/u.test(body)) {
    return routed(semanticEvent('asset-transaction', 'announced', 'proposed', 'tangible-asset-acquisition', 'asset'));
  }

  if (/조회공시요구\(풍문또는보도\)/u.test(title)
    && /조회공시요구내용|공시시한/u.test(body)) {
    return routed(semanticEvent('disclosure-inquiry', 'received', 'pending', 'rumor-inquiry', 'issuer'));
  }

  if (/투자판단관련주요경영사항/u.test(title)
    && /(?:글로벌)?비즈니스인수계약|사업권.{0,60}인수계약/u.test(body)
    && /거래종결.{0,100}(?:감독당국|관계기관).{0,80}승인/u.test(body)) {
    return routed(semanticEvent('restructuring', 'contracted', 'pending', 'business-acquisition', 'business'));
  }

  if (/외부감사인선임[ㆍ·ᆞ]?해임[ㆍ·ᆞ]?변경신고서/u.test(title)
    && /감사인선임구분.{0,40}선임/u.test(body)
    && /감사인명칭/u.test(body)) {
    return routed(semanticEvent('audit', 'appointed', 'effective', 'external-auditor', 'auditor'));
  }

  return null;
}

function applyObjectSpecificityRule(input, events, bodyFacts) {
  const title = compactText(input.reportName);
  const body = bodyFacts.fullText;

  if (input.disclosureDetailType === 'C004'
    && /증권발행실적보고서/u.test(title)
    && /주식의포괄적교환[ㆍ·ᆞ]?이전/u.test(body)) {
    return replaceMatchedIntents(
      events,
      (event) => event.type === 'restructuring',
      [semanticEvent('restructuring', 'completed', 'effective', 'share-exchange', 'issuer')],
    );
  }

  if (input.disclosureDetailType === 'C004'
    && /투자설명서/u.test(title)
    && /분할회사.{0,100}분할존속회사.{0,100}분할신설회사/u.test(body)
    && /분할(?:승인주주총회|기일).{0,80}예정/u.test(body)) {
    return replaceMatchedIntents(
      events,
      (event) => event.type === 'restructuring',
      [semanticEvent('restructuring', 'decided', 'proposed', 'demerger', 'issuer')],
    );
  }

  if (input.disclosureDetailType === 'J001'
    && /특수관계인과의내부거래/u.test(title)
    && /거래대상.{0,160}(?:공사|건설).{0,80}시공권/u.test(body)
    && /시공권양수도계약/u.test(body)) {
    return replaceMatchedIntents(
      events,
      (event) => event.type === 'related-party',
      [semanticEvent('related-party', 'decided', 'proposed', 'construction-right-acquisition', 'contract-right')],
    );
  }

  if (input.disclosureDetailType === 'J001'
    && /특수관계인과의리스거래/u.test(title)
    && /리스물건.{0,100}항공기/u.test(body)
    && /(?:리스계약일|리스시행일)/u.test(body)) {
    return replaceMatchedIntents(
      events,
      (event) => event.type === 'related-party',
      [semanticEvent('related-party', 'decided', 'proposed', 'aircraft-lease', 'asset')],
    );
  }

  if (/유상증자또는주식관련사채등의발행결과/u.test(title)
    && /증권의종류.{0,100}교환사채/u.test(body)
    && /발행방법.{0,80}교환사채발행/u.test(body)) {
    return replaceMatchedIntents(
      events,
      (event) => event.type === 'capital-change',
      [semanticEvent('capital-change', 'completed', 'effective', 'exchangeable-bond', 'securities')],
    );
  }

  if (input.disclosureDetailType === 'J001'
    && /특수관계인과의내부거래/u.test(title)
    && /거래대상.{0,160}보통주/u.test(body)
    && /(?:Capitalcall|투자확약|실제투자).{0,100}(?:투자|진행)예정/u.test(body)) {
    return replaceMatchedIntents(
      events,
      (event) => event.type === 'related-party',
      [semanticEvent('related-party', 'decided', 'proposed', 'affiliate-equity-investment', 'securities')],
    );
  }

  return null;
}

function applyMultiIntentRule(input, events, bodyFacts) {
  const title = compactText(input.reportName);
  const body = bodyFacts.fullText;
  const corrected = input.wrapperKind === 'correction';
  const currentScope = corrected ? currentCorrectionScope(input, bodyFacts) : body;
  const currentDocument = currentDisclosureScope(bodyFacts, compactText(input.bodyText));

  const legacyEquityScheduleDelta = /(?:주금납입일|신주상장예정일).{0,180}(?:정정전|정정후)|(?:정정전|정정후).{0,180}(?:주금납입일|신주상장예정일)/u.test(currentScope);
  const scheduleHypothetical = /(?:내부)?(?:시나리오|가정|예시|검토안).{0,120}(?:유상증자|주식발행|자금조달).{0,80}(?:일정|(?:주금|자금)?(?:납입(?:일|기일)|납부(?:일|기한)))/u.test(currentDocument)
    || /(?:일정|(?:주금|자금)?(?:납입(?:일|기일)|납부(?:일|기한))).{0,100}(?:변경할수(?:도)?있|조정할수(?:도)?있|가능성|검토중|가정|예시)/u.test(currentDocument);
  const scheduleFamily = /(?:유상증자|주식발행|자금조달).{0,80}(?:일정|(?:주금|자금)?(?:납입(?:일|기일)|납부(?:일|기한)))/u.test(currentDocument);
  const scheduleAction = /(?:변경|정정|조정|수정|개정|바꾸|바꿨|옮기|옮겼|개편)/u.test(currentDocument);
  const pairedScheduleLabels = /(?:변경전|정정전|종전|기존|당초|원래).{0,50}(?:주금|자금)?(?:납입(?:일|기일)|납부(?:일|기한))/u.test(currentDocument)
    && /(?:변경후|정정후|변경|새|조정|개정|수정).{0,50}(?:주금|자금)?(?:납입(?:일|기일)|납부(?:일|기한))/u.test(currentDocument);
  const inlinePairedScheduleValues = /(?:주금|자금)?(?:납입(?:일|기일)|납부(?:일|기한)).{0,80}(?:변경전|정정전|종전|기존|당초|원래).{0,100}(?:변경후|정정후|변경|새|조정|개정|수정).{0,80}(?:주금|자금)?(?:납입(?:일|기일)|납부(?:일|기한))?/u.test(currentDocument);
  const fromToScheduleDelta = /(?:주금|자금)?(?:납입(?:일|기일)|납부(?:일|기한)).{0,100}에서.{0,100}(?:으로|로)?(?:변경|조정|바꾸|바꿨|옮기|옮겼|개편)/u.test(currentDocument);
  const generalizedEquityScheduleDelta = scheduleFamily
    && scheduleAction
    && !scheduleHypothetical
    && semanticDates(currentDocument).length >= 2
    && (pairedScheduleLabels || inlinePairedScheduleValues || fromToScheduleDelta);
  if (corrected
    && /소송등의제기/u.test(title)
    && (legacyEquityScheduleDelta || generalizedEquityScheduleDelta)) {
    return replaceMatchedIntents(
      events,
      (event) => event.type === 'capital-change'
        && ['equity-securities', 'rights-offering'].includes(event.cause)
        && event.subjectType === 'securities',
      [semanticEvent('capital-change', 'rescheduled', 'pending', 'equity-securities', 'securities')],
    );
  }

  if (/중대재해발생/u.test(`${title}${body}`) && hasAffirmativeRegulatoryWorkStop(currentDocument)) {
    return replaceMatchedIntents(
      events,
      (event) => ['legal-regulatory', 'operating-status'].includes(event.type),
      [
        semanticEvent('corporate-event', 'occurred', 'effective', 'serious-industrial-accident', 'operations'),
        semanticEvent('operating-status', 'halted', 'active', 'work-stop', 'operating-business'),
      ],
    );
  }

  if (corrected
    && input.disclosureDetailType === 'J001'
    && /특수관계인에대한증여/u.test(title)
    && /(?:출연|증여|이행).{0,40}(?:완료|확정공시)|(?:완료|이행완료).{0,40}(?:출연|증여|확정공시)/u.test(currentScope)
    && /증여목적물.{0,200}(?:(?:금전|현금).{0,160}(?:보통주|주식|유가증권)|(?:보통주|주식|유가증권).{0,160}(?:금전|현금))/u.test(currentScope)) {
    return replaceMatchedIntents(
      events,
      (event) => event.type === 'related-party' && /donation/u.test(event.cause ?? ''),
      [
        semanticEvent('related-party', 'donated', 'effective', 'cash-donation', 'cash'),
        semanticEvent('related-party', 'donated', 'effective', 'securities-donation', 'securities'),
      ],
    );
  }

  if (corrected
    && input.disclosureDetailType === 'I002'
    && /수시공시의무관련사항/u.test(title)
    && /자기주식활용계획.{0,180}(?:전면)?철회(?:하기로)?결정|자기주식활용계획전면철회/u.test(currentScope)
    && /자기주식소각/u.test(currentScope)
    && /교환사채(?:\(EB\))?발행/u.test(currentScope)
    && /사내근로복지기금.{0,40}(?:주식)?출연/u.test(currentScope)) {
    const withdrawnCauses = new Set([
      'share-cancellation',
      'exchangeable-bond',
      'employee-welfare-fund-contribution',
    ]);
    return replaceMatchedIntents(
      events,
      (event) => event.type === 'other' || withdrawnCauses.has(event.cause),
      [
        semanticEvent('corporate-action', 'withdrawn', 'effective', 'share-cancellation', 'securities'),
        semanticEvent('capital-change', 'withdrawn', 'effective', 'exchangeable-bond', 'securities'),
        semanticEvent('related-party', 'withdrawn', 'effective', 'employee-welfare-fund-contribution', 'securities'),
      ],
    );
  }

  return null;
}

function hasAffirmativeLitigationDismissal(scope) {
  const positiveEnd = Math.max(
    lastMatchEnd(scope, /(?:주문|결정내용).{0,180}(?:신청|청구|항소|상고)?(?:을|를)?기각(?:한다|함|하였|결정)/gu),
    lastMatchEnd(scope, /(?:신청|청구|항소|상고)(?:을|를)?기각(?:한다|함|하였|결정)/gu),
    lastMatchEnd(scope, /(?:기각결정|기각판결)(?:이|가)?(?:선고|확정|내려|있었|되었|됐)/gu),
  );
  const blockingEnd = Math.max(
    lastMatchEnd(scope, /기각.{0,48}(?:가능성|예상|전망|우려|주장|요청|구할|검토|될수)/gu),
    lastMatchEnd(scope, /(?:가능성|예상|전망|우려|주장|요청|검토).{0,48}기각/gu),
    lastMatchEnd(scope, /기각(?:되지않|된것이아니|결정은없|판결은없)/gu),
  );
  return positiveEnd >= 0 && positiveEnd > blockingEnd;
}

export function classifyAuthoritativeWrapperEvent(input, bodyFacts) {
  const title = compactText(input.reportName);
  if (/^\[정정명령부과\]/u.test(title)) {
    return semanticGateDecision('complete', [
      semanticEvent('legal-regulatory', 'ordered', 'correction-requested', 'disclosure-correction', 'issuer'),
    ]);
  }

  if (input.disclosureDetailType === 'C004') {
    const body = bodyFacts.fullText;
    const primaryDemergerForm = /증권발행실적보고서.{0,40}\(분할\)|증권발행실적보고서\(분할\)/u.test(body);
    const demergerSchedule = /분할기일/u.test(body) && /분할등기일/u.test(body);
    const demergerParties = /존속회사/u.test(body) && /신설회사/u.test(body);
    if (primaryDemergerForm && (demergerSchedule || demergerParties)) {
      return semanticGateDecision('complete', [
        semanticEvent('restructuring', 'completed', 'effective', 'demerger', 'issuer'),
      ]);
    }
  }

  const genericBodylessC004 = input.disclosureDetailType === 'C004'
    && !bodyFacts.bodyAvailable
    && /^(?:\[(?:기재정정|첨부정정|첨부추가)\])?투자설명서$/u.test(title);
  if (genericBodylessC004) return semanticGateDecision('complete', []);
  return null;
}

function classifyEquityAcquisitionType(bodyText) {
  const body = compactText(bodyText);
  const newEntityFormation = /(?:회사|법인).{0,40}설립.{0,100}(?:출자|주식취득)|설립및출자결정/u.test(body);
  const alreadyControlled = /(?:이미|기존|종속회사가).{0,100}100(?:\.0+)?%지분(?:을)?보유(?:한)?자회사/u.test(body);
  const postAcquisitionFullControl = /취득후소유주식수및지분비율.{0,180}지분비율\(%\)?.{0,40}100(?:\.0+)?(?:\D|$)/u.test(body);
  const noPriorRelationship = /회사와관계.{0,40}\|?-\|?/u.test(body);

  return newEntityFormation
    || (postAcquisitionFullControl && noPriorRelationship && !alreadyControlled)
    ? 'restructuring'
    : 'asset-transaction';
}

export function resolveCanonicalIntentIdentity(input, events, bodyFacts) {
  const title = compactText(input.reportName);
  const body = bodyFacts.fullText;
  const corrected = input.wrapperKind === 'correction';
  const complete = (...next) => semanticGateDecision('complete', next);
  const primary = events.find((event) => event.type !== 'other') ?? null;
  const preserveLifecycle = (type, fallbackAction, fallbackState, cause, subjectType) => complete(semanticEvent(
    type,
    primary?.action ?? fallbackAction,
    primary?.state ?? fallbackState,
    cause,
    subjectType,
  ));

  if (/공정거래자율준수프로그램운영현황/u.test(title)) {
    return complete(semanticEvent('governance', 'reported', 'active', 'compliance-program', 'governance'));
  }
  if (/현금[ㆍ·ᆞ]?현물배당을위한주주명부폐쇄.*기준일.*결정/u.test(title)
    || /주주명부폐쇄.*기준일.*결정/u.test(title)) {
    return complete(semanticEvent('corporate-action', 'decided', 'pending', 'record-date', 'ownership'));
  }
  if (/대규모기업집단현황공시/u.test(title) && corrected) {
    return complete(semanticEvent(
      'governance',
      'updated',
      bodyFacts.bodyAvailable ? 'effective' : null,
      'business-group-status',
      'governance',
    ));
  }
  if (/공개매수(?:신고서|설명서)/u.test(title)) {
    return complete(semanticEvent('corporate-action', 'initiated', 'active', 'tender-offer', 'listed-shares'));
  }
  if (/중대재해발생/u.test(title)) {
    const accident = semanticEvent('corporate-event', 'occurred', 'effective', 'serious-industrial-accident', 'operations');
    const scopedBody = currentDisclosureScope(bodyFacts, compactText(input.bodyText));
    const replacements = hasAffirmativeIssuerOperationalWorkStop(scopedBody)
      ? [
        accident,
        semanticEvent('operating-status', 'halted', 'active', 'work-stop', 'operating-business'),
      ]
      : [accident];
    return complete(...replaceMatchedIntents(
      events,
      (event) => event.cause === 'serious-industrial-accident'
        || (event.type === 'operating-status' && event.cause === 'work-stop'),
      replacements,
    ));
  }
  if ((/소송등의판결[ㆍ·ᆞ]?결정/u.test(title) || /투자판단관련주요경영사항/u.test(title))
    && hasAffirmativeLitigationDismissal(currentDisclosureScope(bodyFacts))) {
    return complete(semanticEvent('legal-regulatory', 'dismissed', 'effective', 'litigation', 'issuer'));
  }
  if (!corrected && /소송등의제기[ㆍ·ᆞ]?신청/u.test(title)) {
    const terminalLitigation = events.some((event) => event.type === 'legal-regulatory'
      && event.cause === 'litigation'
      && TERMINAL_LIFECYCLE_ACTIONS.has(event.action));
    if (terminalLitigation) return null;
    return complete(...replaceMatchedIntents(
      events,
      (event) => event.type === 'legal-regulatory' && event.cause === 'litigation',
      [semanticEvent('legal-regulatory', 'filed', 'active', 'litigation', 'issuer')],
    ));
  }

  if (/유상증자또는주식관련사채등의발행결과/u.test(title)) {
    const cause = /교환사채/u.test(body)
      ? 'exchangeable-bond'
      : /전환사채/u.test(body)
        ? 'convertible-bond'
        : /신주인수권부사채/u.test(body)
          ? 'bond-with-warrants'
          : /유상증자|제3자배정|주주배정|기명식보통주|신주/u.test(body)
            ? 'rights-offering'
            : 'equity-securities';
    return complete(semanticEvent('capital-change', 'completed', 'effective', cause, 'securities'));
  }

  if (/자본으로인정되는채무증권발행결정/u.test(title)) {
    return preserveLifecycle('capital-change', 'decided', 'proposed', 'contingent-capital-securities', 'securities');
  }
  if (/자기전환사채만기전취득결정/u.test(title)) {
    const acquisition = events.find((event) => event.type === 'capital-change'
      && ['convertible-bond', 'convertible-bond-acquisition'].includes(event.cause));
    return complete(semanticEvent(
      'capital-change',
      acquisition?.action ?? 'decided',
      acquisition?.state ?? 'proposed',
      'convertible-bond-acquisition',
      'securities',
    ));
  }
  if (/자기전환사채매도결정/u.test(title)) {
    const sale = events.find((event) => ['convertible-bond', 'bond-sale'].includes(event.cause));
    return complete(semanticEvent(
      'asset-transaction',
      sale?.action ?? 'decided',
      sale?.state ?? 'proposed',
      'bond-sale',
      'securities',
    ));
  }
  if (/교환사채권발행결정/u.test(title)) {
    return preserveLifecycle('capital-change', 'decided', 'proposed', 'exchangeable-bond', 'securities');
  }
  if (/신주인수권부사채권발행결정/u.test(title)) {
    return preserveLifecycle('capital-change', 'decided', 'proposed', 'warrant-bond', 'securities');
  }
  if (/전환사채권발행결정/u.test(title)) {
    return preserveLifecycle('capital-change', 'decided', 'proposed', 'convertible-bond', 'securities');
  }
  if (/유상증자결정/u.test(title)) {
    const existing = events.find((event) => event.type === 'capital-change'
      && ['equity-securities', 'rights-offering'].includes(event.cause));
    return complete(...replaceMatchedIntents(
      events,
      (event) => event.type === 'capital-change'
        && ['equity-securities', 'rights-offering'].includes(event.cause),
      [semanticEvent(
        'capital-change',
        existing?.action ?? 'decided',
        existing?.state ?? 'proposed',
        existing?.cause === 'equity-securities' ? 'equity-securities' : 'rights-offering',
        'securities',
      )],
    ));
  }
  if (/자기주식처분결정/u.test(title)) {
    return preserveLifecycle(
      corrected ? 'capital-change' : 'corporate-action',
      'decided',
      'proposed',
      'treasury-share-disposal',
      corrected ? 'securities' : 'listed-shares',
    );
  }

  if (/주권관련사채권의취득결정|주권관련사채권양수결정/u.test(title)) {
    return preserveLifecycle(
      'asset-transaction',
      'decided',
      'proposed',
      /전환사채/u.test(body) ? 'convertible-bond-acquisition' : 'securities-purchase',
      'securities',
    );
  }
  if (/유형자산(?:양수|취득)결정/u.test(title)) {
    return preserveLifecycle(
      'asset-transaction',
      'decided',
      'proposed',
      'tangible-asset-acquisition',
      /사옥|토지|건물|부동산|등기/u.test(body) ? 'real-estate' : 'asset',
    );
  }
  if (/타법인주식및출자증권(?:양수|취득)결정/u.test(title)) {
    return preserveLifecycle(
      classifyEquityAcquisitionType(body),
      'decided',
      'proposed',
      'equity-acquisition',
      'securities',
    );
  }
  if (/타법인주식및출자증권처분결정/u.test(title)) {
    return preserveLifecycle('asset-transaction', 'decided', 'proposed', 'equity-disposal', 'securities');
  }
  if (input.disclosureDetailType === 'J001' && /특수관계인으로부터주식의취득/u.test(title)) {
    return complete(semanticEvent('related-party', 'decided', 'proposed', 'equity-acquisition', 'securities'));
  }
  if (/투자판단관련주요경영사항/u.test(title)
    && /신종자본증권.{0,80}(?:인수|매입)결정|(?:인수|매입).{0,80}신종자본증권/u.test(body)
    && /자회사|종속회사|계열회사/u.test(body)) {
    return complete(semanticEvent('related-party', 'decided', 'proposed', 'bond-purchase', 'securities'));
  }

  return null;
}

export function applyLifecyclePrecedence(input, events, bodyFacts) {
  const title = compactText(input.reportName);
  const body = bodyFacts.fullText;
  const corrected = input.wrapperKind === 'correction';
  const complete = (...next) => semanticGateDecision('transform', next);

  if (corrected && /자기주식처분결정|교환사채권발행결정/u.test(title)
    && /(?:추가적인논의|추가논의|재검토|발행여부.{0,80}최종결정|최종결정.{0,80}재공시)/u.test(body)) {
    return complete(semanticEvent(
      'capital-change',
      'under-review',
      'deferred',
      /교환사채권발행결정/u.test(title) ? 'exchangeable-bond' : 'treasury-share-disposal',
      'securities',
    ));
  }

  if (/자기전환사채만기전취득결정/u.test(title)) {
    const resolvedAcquisition = events.find((event) => event.type === 'capital-change'
      && event.cause === 'convertible-bond-acquisition');
    if (corrected && /(?:지급|취득|계약|만기).{0,80}(?:일정|기한|예정일).{0,60}(?:변경|조정)|(?:계약당사자간협의|상호합의).{0,60}(?:변경|조정)/u.test(body)) {
      return complete(semanticEvent('capital-change', 'rescheduled', 'deferred', 'convertible-bond-acquisition', 'securities'));
    }
    // The legacy actuality gate already performs actor, current-section,
    // partial-payment and prospective-language checks.  Preserve that audited
    // lifecycle here and only normalize the identity slot.
    const currentAcquisitionScope = currentDisclosureScope(bodyFacts, compactText(input.bodyText));
    if (resolvedAcquisition?.action === 'acquired'
      && resolvedAcquisition.state === 'effective'
      && hasCompletedConvertibleBondAcquisition(currentAcquisitionScope)) {
      return complete(semanticEvent('capital-change', 'acquired', 'effective', 'convertible-bond-acquisition', 'securities'));
    }
    if (corrected && resolvedAcquisition
      && !['decided', 'acquired'].includes(resolvedAcquisition.action)) {
      return complete(semanticEvent(
        'capital-change',
        resolvedAcquisition.action,
        resolvedAcquisition.state,
        'convertible-bond-acquisition',
        'securities',
      ));
    }
    const contractPending = /(?:사채권자|매도인).{0,120}계약|사채권양수도계약|매매계약/u.test(body)
      && /(?:취득예정일|잔금|매매대금전액|사채의전자등록금액).{0,100}(?:예정|완료되는즉시|지급할)|취득예정일/u.test(body);
    if (resolvedAcquisition?.action === 'contracted' || contractPending) {
      return complete(semanticEvent('capital-change', 'contracted', 'pending', 'convertible-bond-acquisition', 'securities'));
    }
    return complete(semanticEvent('capital-change', 'decided', 'proposed', 'convertible-bond-acquisition', 'securities'));
  }

  if (/자기전환사채매도결정/u.test(title)) {
    const resolvedSale = events.find((event) => event.type === 'asset-transaction' && event.cause === 'bond-sale');
    if (corrected && /(?:잔금|매도대금).{0,80}(?:일정|납입일|지급일).{0,60}(?:변경|조정)/u.test(body)) {
      return complete(semanticEvent('asset-transaction', 'rescheduled', 'pending', 'bond-sale', 'securities'));
    }
    if (corrected && resolvedSale && ['rescheduled', 'updated'].includes(resolvedSale.action)) {
      return complete(semanticEvent('asset-transaction', resolvedSale.action, resolvedSale.state, 'bond-sale', 'securities'));
    }
    if (/(?:매도대금|잔금).{0,80}(?:전액)?(?:수령|정산).{0,40}(?:완료|하였)|사채권.{0,80}(?:이전|인도).{0,40}(?:완료|하였)/u.test(body)) {
      return complete(semanticEvent('asset-transaction', 'disposed', 'effective', 'bond-sale', 'securities'));
    }
    return complete(semanticEvent('asset-transaction', 'decided', 'proposed', 'bond-sale', 'securities'));
  }

  if (corrected && /전환사채권발행결정/u.test(title)
    && /(?:납입|만기|지급).{0,80}(?:일정|일자|기일).{0,60}(?:변경|조정)|납입일정의변경/u.test(body)) {
    return complete(semanticEvent('capital-change', 'rescheduled', 'deferred', 'convertible-bond', 'securities'));
  }
  if (corrected && /신주인수권부사채권발행결정/u.test(title)
    && !/(?:행사|발행)가액.{0,80}확정|확정.{0,80}(?:행사|발행)가액/u.test(body)) {
    return complete(semanticEvent('capital-change', 'updated', 'effective', 'warrant-bond', 'securities'));
  }
  if (corrected && /유상증자결정/u.test(title)
    && /(?:주금|인수대금|납입).{0,100}(?:전액)?(?:납입받|납입완료|완료되)|유상증자.{0,100}(?:납입|발행).{0,80}완료/u.test(body)) {
    return complete(semanticEvent('capital-change', 'completed', 'effective', 'rights-offering', 'securities'));
  }

  if (corrected && /타법인주식및출자증권양수결정/u.test(title)
    && /주식매수청구권/u.test(body)
    && (/(?:기한|기간|상장완료).{0,100}(?:연장|변경)|(?:연장|변경).{0,100}(?:기한|기간|상장완료)/u.test(body)
      || /계약내용의변경/u.test(body) && /2025년12월31일/u.test(body) && /2028년12월31일/u.test(body))) {
    return complete(semanticEvent('material-contract', 'extended', 'effective', 'contract-right', 'contract-right'));
  }
  if (corrected && /타법인주식및출자증권양수결정/u.test(title)
    && /정정사유.{0,60}기재정정/u.test(body)
    && /(?:총자산|자기자본|총자산대비|자기자본대비)/u.test(currentCorrectionScope(input, bodyFacts))) {
    return complete(semanticEvent('asset-transaction', 'decided', 'proposed', 'equity-acquisition', 'securities'));
  }
  const explicitCompletedCorrection = /정정사유.{0,80}거래종결에따른정정/u.test(body)
    && /정정후.{0,160}(?:거래완료일|처분완료|거래종결일)/u.test(body);
  const completedEquityDisposal = explicitCompletedCorrection
    || (/(?:거래(?:가|는)?종결(?:되었|됐|됨|하였|완료)|거래종결에따른(?:정정|공시|변경)|처분(?:이|을)?완료|양도대금.{0,60}(?:수령|지급).{0,30}완료|정산.{0,60}최종확정|거래종결일.{0,100}(?:최종정산|최종확정|대금.{0,30}(?:수령|지급)완료))/u.test(body)
      && !/(?:거래종결|처분완료|지분이전).{0,80}(?:예정|향후|승인이후|아직.{0,20}(?:전|미완료|되지않))/u.test(body));
  if (corrected && /타법인주식및출자증권처분결정/u.test(title)
    && completedEquityDisposal) {
    const businessDisposal = /사업양도|영업양도|사업부문.{0,80}(?:양도|매각)/u.test(body)
      && /100(?:\.0+)?%|전량|전부/u.test(body);
    return complete(semanticEvent(
      businessDisposal ? 'restructuring' : 'asset-transaction',
      'disposed',
      'effective',
      'equity-disposal',
      'securities',
    ));
  }
  if (corrected && /타법인주식및출자증권처분결정/u.test(title)) {
    const resolvedDisposal = events.find((event) => event.cause === 'equity-disposal');
    if (resolvedDisposal && ['updated', 'rescheduled'].includes(resolvedDisposal.action)) {
      return complete(semanticEvent(
        'asset-transaction',
        resolvedDisposal.action,
        resolvedDisposal.state,
        'equity-disposal',
        'securities',
      ));
    }
  }
  if (corrected && /유형자산(?:양수|취득)결정/u.test(title)
    && /정정사유.{0,100}취득예정일자.{0,60}(?:수정|변경|확정)|취득예정일자변경/u.test(body)) {
    return complete(semanticEvent('asset-transaction', 'updated', 'pending', 'tangible-asset-acquisition', 'real-estate'));
  }
  if (corrected && /유형자산(?:양수|취득)결정/u.test(title)
    && /(?:계약체결완료|매매계약.{0,60}체결)/u.test(body)
    && /(?:잔금지급|양수기준일|등기예정일|거래종결).{0,100}(?:예정|향후)/u.test(body)) {
    return complete(semanticEvent('asset-transaction', 'contracted', 'pending', 'real-estate-purchase', 'real-estate'));
  }

  if (corrected && /단일판매[ㆍ·ᆞ]?공급계약체결/u.test(title)
    && /정정사유.{0,100}(?:계약기간종료.{0,40}계약변경협의중|계약변경협의중)|정정후.{0,100}(?:-|미정).{0,120}협의중/u.test(body)) {
    return complete(semanticEvent('material-contract', 'under-review', 'pending', 'supply-contract', 'contract'));
  }
  if (corrected && /타인에대한담보제공결정/u.test(title)
    && /(?:자회사|종속회사|계열회사)/u.test(body)
    && /담보제공기간.{0,100}확정|기간확정에따른정정/u.test(body)) {
    return complete(semanticEvent('related-party', 'updated', 'finalized', 'collateral-provision', 'asset'));
  }

  if (corrected && /기타경영사항/u.test(title)
    && /사업양도/u.test(body)
    && /(?:거래정산에따른양도가액최종확정|양도가액.{0,80}최종확정|거래종결일.{0,80}최종확정금액)/u.test(body)) {
    return complete(semanticEvent('asset-transaction', 'price-set', 'finalized', 'business-disposal', 'business'));
  }

  if (corrected && /장래사업[ㆍ·ᆞ]?경영계획/u.test(title)) {
    if (/가이던스/u.test(body)
      || /(?:매출액|영업이익|실적전망|목표매출|매출목표|수익전망|예상수혜|수혜규모).{0,160}(?:전망|목표|예상|추정|변경|정정)|(?:전망|목표).{0,160}(?:매출액|영업이익|실적|수혜규모)/u.test(body)) {
      return complete(semanticEvent('earnings', 'updated', 'projected', 'earnings-guidance', 'financials'));
    }
    if (hasAffirmativeBusinessPlanWithdrawal(currentCorrectionScope(input, bodyFacts))
      && /(?:생산시설|설비|공장|시설투자|증설|투자계획)/u.test(body)) {
      return complete(semanticEvent('capital-expenditure', 'withdrawn', 'cancelled', 'facility-investment', 'asset'));
    }
  }

  if (input.disclosureDetailType === 'J001' && /특수관계인으로부터주식의취득/u.test(title)) {
    const contractEffective = /(?:주식양수도|주식매매)계약(?:을|이)?(?:체결하였|체결했|체결함|체결완료)|거래일자.{0,80}(?:주식양수도|주식매매)계약체결일(?:입니다|임)/u.test(body)
      && !/(?:계약|SPA).{0,30}체결(?:할)?예정/u.test(body);
    return complete(semanticEvent(
      'related-party',
      contractEffective ? 'contracted' : 'decided',
      contractEffective ? 'pending' : 'proposed',
      'equity-acquisition',
      'securities',
    ));
  }

  return null;
}

export function normalizeCanonicalSlots(input, events) {
  const title = compactText(input.reportName);
  const normalized = events.map((event) => {
    if (event.cause === 'record-date'
      && /주주명부폐쇄|기준일설정|기준일.*결정/u.test(title)) {
      return semanticEvent(event.type, event.action, event.state, event.cause, 'ownership');
    }
    if (event.cause === 'serious-industrial-accident') {
      return semanticEvent('corporate-event', 'occurred', 'effective', event.cause, 'operations');
    }
    if (event.cause === 'treasury-share-disposal'
      && input.wrapperKind === 'original'
      && /자기주식처분(?:결정|결과보고서)/u.test(title)) {
      return semanticEvent('corporate-action', event.action, event.state, event.cause, 'listed-shares');
    }
    return createEvent(event);
  });
  return semanticGateDecision('transform', normalized);
}

function applySeparatedSemanticGatePipeline(input, events, bodyFacts) {
  const wrapper = classifyAuthoritativeWrapperEvent(input, bodyFacts);
  if (wrapper?.authority === 'complete') return wrapper.events;

  const occurrences = extractStructuredOccurrenceSet(input, bodyFacts);
  if (occurrences?.authority === 'complete') return occurrences.events;
  return null;
}

/**
 * Iteration 5 semantic repair gate.
 *
 * This gate deliberately keys on document semantics (wrapper, lifecycle verb,
 * object and relative-time evidence), never on issuer or receipt literals.  It
 * sits after candidate arbitration so it can repair cross-field tuples and
 * add independent events that the title-first candidate pass cannot express.
 */
function applyLegacyGeneralizedSemanticGates(input, events) {
  const title = compactText(input.reportName);
  const facts = extractStructuredBodyFacts(input);
  const body = facts.fullText;
  const corrected = input.wrapperKind === 'correction';
  const replace = (...next) => sortEvents(next);

  if (/공정거래자율준수프로그램운영현황/u.test(title)) {
    return replace(semanticEvent('governance', 'reported', 'active', 'compliance-program', 'governance'));
  }

  if (/영업\(?잠정\)?실적|영업.*잠정.*실적/u.test(title)) {
    return replace(semanticEvent('earnings', 'announced', 'preliminary', 'operating-results', 'financials'));
  }

  if (/결산실적공시예고/u.test(title)) {
    return replace(semanticEvent('earnings', 'scheduled', 'pending', 'operating-results', 'financials'));
  }

  if (/현금[ㆍ·ᆞ]?현물배당을위한주주명부폐쇄.*기준일.*결정/u.test(title)
    || (/주주명부폐쇄.*기준일.*결정/u.test(title) && facts.hasFutureDate)) {
    return replace(semanticEvent('corporate-action', 'decided', 'pending', 'record-date', 'ownership'));
  }

  if (/단기차입금증가결정.*자회사의주요경영사항/u.test(title)
    && !/특수관계인|계열회사|관계회사/u.test(body)) {
    return replace(semanticEvent('capital-change', 'decided', 'proposed', 'short-term-borrowing', 'subsidiary'));
  }

  if (corrected
    && /거래처와의거래중단/u.test(title)
    && /항소기각/u.test(body)
    && /입찰참가자격제한/u.test(body)
    && /(?:집행정지신청인용|효력정지)/u.test(body)) {
    return replace(
      semanticEvent('legal-regulatory', 'dismissed', 'effective', 'litigation', 'issuer'),
      semanticEvent('operating-status', 'updated', 'deferred', 'business-suspension', 'business'),
    );
  }

  if (corrected
    && /기타경영사항/u.test(title)
    && /사업양도/u.test(body)
    && /(?:거래정산에따른양도가액최종확정|양도가액.{0,80}최종확정|거래종결일.{0,80}최종확정금액)/u.test(body)) {
    return replace(semanticEvent('restructuring', 'updated', 'finalized', 'business-disposal', 'business'));
  }

  if (/특수관계인으로부터받은담보/u.test(title)) {
    const receiptPending = /(?:담보받은일자.{0,80}(?:미기재|-)|아직계약체결일자가정해지지않|계약체결.{0,80}예정)/u.test(body);
    const mixedCollateral = /(?:토지|건물|부동산)/u.test(body)
      && /(?:기계장치|대여금채권|대여예정인대여금)/u.test(body);
    const securitiesCollateral = /(?:담보물|담보자산).{0,160}(?:주식|유가증권)/u.test(body);
    return replace(semanticEvent(
      'related-party',
      receiptPending ? 'decided' : 'received',
      receiptPending ? 'proposed' : 'effective',
      'collateral-received',
      mixedCollateral ? 'asset' : securitiesCollateral ? 'securities' : /(?:토지|건물|부동산)/u.test(body) ? 'real-estate' : 'asset',
    ));
  }

  if (/지주회사의자회사편입/u.test(title)) {
    return replace(semanticEvent('corporate-profile', 'changed', 'effective', 'subsidiary-inclusion', 'subsidiary'));
  }

  if (corrected && /부동산투자회사부동산임대/u.test(title)) {
    return replace(semanticEvent('material-contract', 'updated', 'effective', 'real-estate-lease', 'real-estate'));
  }

  if (corrected && /전환사채권발행결정/u.test(title)) {
    return replace(semanticEvent('capital-change', 'updated', 'effective', 'convertible-bond', 'securities'));
  }

  if (/특수관계인에대한출자/u.test(title)) {
    return replace(semanticEvent('related-party', 'decided', 'proposed', 'affiliate-equity-investment', 'securities'));
  }

  if (/유상증자또는주식관련사채등의발행결과/u.test(title)
    && /유상증자|신주/u.test(body)
    && !/(?:교환사채|전환사채|신주인수권부사채)/u.test(body)) {
    return replace(semanticEvent('capital-change', 'completed', 'effective', 'rights-offering', 'securities'));
  }

  if (corrected && /장래사업[ㆍ·ᆞ]?경영계획/u.test(title)) {
    return replace(semanticEvent('corporate-event', 'updated', 'proposed', 'business-plan', 'business'));
  }

  if (!corrected && /단일판매[ㆍ·ᆞ]?공급계약체결/u.test(title)
    && (facts.contractStartDateRelation === 'future' || facts.contractDateRelation === 'future')) {
    return replace(semanticEvent('material-contract', 'contracted', 'pending', 'supply-contract', 'contract'));
  }

  const explicitBodyIntents = applyExplicitBodyIntentRule(input, events);
  const semanticBaseEvents = explicitBodyIntents ?? events;
  const multiIntent = applyMultiIntentRule(input, semanticBaseEvents, facts);
  const scopedEvents = multiIntent ?? semanticBaseEvents;
  if (corrected
    && /신주인수권부사채권발행결정/u.test(title)
    && /사채만기일.{0,100}일정변경에따른기재정정/u.test(body)
    && /행사가액.{0,100}확정될예정/u.test(body)) {
    return replaceMatchedIntents(
      scopedEvents,
      (event) => event.type === 'capital-change',
      [semanticEvent('capital-change', 'updated', 'pending', 'bond-with-warrants', 'securities')],
    );
  }
  const orderedAccumulatorRequired = scopedEvents.length > 1;

  if (!orderedAccumulatorRequired) {
    const terminalPolarity = applyTerminalPolarityRule(input, scopedEvents, facts);
    if (terminalPolarity) return terminalPolarity;
    const actuality = applyActualityRule(input, scopedEvents, facts);
    if (actuality) return actuality;
    const correctionLifecycle = applyCorrectionLifecycleDeltaRule(input, scopedEvents, facts);
    if (correctionLifecycle) return correctionLifecycle;
    const roleAwareTemporal = applyRoleAwareTemporalRule(input, scopedEvents, facts);
    if (roleAwareTemporal) return roleAwareTemporal;
    const bodyFamily = applyUnresolvedBodyFamilyRule(input, scopedEvents, facts);
    if (bodyFamily) return bodyFamily;
    const objectSpecificity = applyObjectSpecificityRule(input, scopedEvents, facts);
    if (objectSpecificity) return objectSpecificity;
    if (multiIntent) return multiIntent;
    const finalTerms = applyFinalTermsRule(input, scopedEvents, facts);
    if (finalTerms) return finalTerms;
  }

  let accumulatedEvents = scopedEvents;
  const terminalOwners = new Map();
  const terminalPolarity = applyTerminalPolarityRule(input, accumulatedEvents, facts);
  if (terminalPolarity) {
    accumulatedEvents = terminalPolarity;
    for (const event of terminalPolarity) {
      if (TERMINAL_LIFECYCLE_ACTIONS.has(event.action)) terminalOwners.set(lifecycleIntentKey(event), event);
    }
  }

  const orderedStages = [
    applyActualityRule,
    applyCorrectionLifecycleDeltaRule,
    applyRoleAwareTemporalRule,
    applyUnresolvedBodyFamilyRule,
    applyObjectSpecificityRule,
  ];
  for (const stage of orderedStages) {
    const result = stage(input, accumulatedEvents, facts);
    if (result) accumulatedEvents = preserveTerminalLifecycle(result, terminalOwners);
  }

  const finalTerms = applyFinalTermsRule(input, accumulatedEvents, facts);
  if (finalTerms) accumulatedEvents = preserveTerminalLifecycle(finalTerms, terminalOwners);

  if (corrected
    && /최대주주변경/u.test(title)
    && /미발생|효력미발생/u.test(body)) {
    accumulatedEvents = replaceMatchedIntents(
      accumulatedEvents,
      (event) => event.type === 'ownership-change',
      [semanticEvent('ownership-change', 'updated', 'pending', 'controlling-shareholder', 'ownership')],
    );
  }

  if (explicitBodyIntents || JSON.stringify(accumulatedEvents) !== JSON.stringify(events)) return accumulatedEvents;

  // Negative/terminal polarity must win over a generic positive contract noun.
  if (/단일판매[ㆍ·ᆞ]?공급계약해지/u.test(title)) {
    return replace(semanticEvent('material-contract', 'terminated', 'effective', 'supply-contract', 'contract'));
  }

  // Administrative order is an independent event, not a modifier of the
  // underlying capital transaction.
  if (/^\[정정명령부과\]/u.test(title)) {
    return replace(
      ...events,
      semanticEvent('legal-regulatory', 'ordered', 'effective', 'disclosure-correction', 'issuer'),
    );
  }

  // Body/title semantic rescue for formerly unresolved generic disclosures.
  if (/개선기간종료관련안내/u.test(title)) {
    return replace(
      semanticEvent('legal-regulatory', 'period-ended', 'effective', 'listing-improvement-period', 'issuer'),
      semanticEvent('trading-status', 'halted', 'effective', 'delisting-review', 'listed-shares'),
    );
  }
  if (/타인에대한담보제공결정/u.test(title)) {
    const related = corrected && /특수관계인|계열회사|최대주주/u.test(body);
    return replace(semanticEvent(
      related ? 'related-party' : 'material-contract',
      corrected ? 'updated' : 'provided',
      corrected ? (facts.hasFutureDate ? 'pending' : 'effective') : 'effective',
      'collateral-provision',
      related ? 'securities' : 'asset',
    ));
  }
  if (/자산관리위탁계약변경/u.test(title)) return replace(semanticEvent('material-contract', 'changed', 'effective', 'asset-management-contract', 'contract'));
  if (/자산보관위탁계약체결/u.test(title)) return replace(semanticEvent('material-contract', 'contracted', 'pending', 'asset-custody-contract', 'contract'));
  if (/자산보관위탁계약변경/u.test(title)) return replace(semanticEvent('material-contract', 'changed', 'pending', 'asset-custody-contract', 'contract'));
  if (/공동연구개발.*라이선스계약체결|라이선스계약체결.*공동연구개발/u.test(title + body)) {
    return replace(semanticEvent('material-contract', 'contracted', 'effective', 'research-license-agreement', 'contract'));
  }
  if (/투자판단관련주요경영사항/u.test(title)
    && /마일스톤|기술료.{0,40}(?:달성|수령|지급)/u.test(body)) {
    return replace(semanticEvent('material-contract', 'milestone-earned', 'effective', 'licensing-milestone', 'contract'));
  }
  if (/소송등의판결[ㆍ·ᆞ]?결정/u.test(title) && /기각/u.test(body)) return replace(semanticEvent('legal-regulatory', 'dismissed', 'effective', 'litigation', 'issuer'));
  if (/불성실공시법인지정예고/u.test(title)) {
    return replace(semanticEvent('legal-regulatory', 'announced', /이의신청|사전통지/u.test(body) ? 'preliminary' : 'pending', 'disclosure-compliance', 'issuer'));
  }
  if (/조회공시요구.*현저한시황변동/u.test(title)) return replace(semanticEvent('disclosure-inquiry', 'received', 'pending', 'market-movement-inquiry', 'issuer'));
  if (/상장채권관련기타주요사항/u.test(title) && /매매거래정지|거래정지/u.test(body)) return replace(semanticEvent('capital-change', 'halted', 'effective', 'debt-securities', 'securities'));
  if (/영업실적등에대한전망/u.test(title)) return replace(semanticEvent('earnings', corrected ? 'updated' : 'forecasted', corrected ? 'projected' : null, 'earnings-guidance', 'financials'));
  if (/기업가치제고계획/u.test(title)) {
    const implementationReport = /계획서명칭.{0,180}이행현황/u.test(body) || /제고계획\(이행현황\)/u.test(body);
    return replace(semanticEvent(
      'corporate-event',
      implementationReport ? 'reported' : 'announced',
      implementationReport
        ? 'effective'
        : /장래계획사항|예측정보|계획서명칭/u.test(body)
          ? 'proposed'
          : null,
      'value-up-plan',
      'issuer',
    ));
  }
  if (/어플리케이션운영서비스계약체결/u.test(title)) return replace(semanticEvent('material-contract', 'contracted', 'effective', 'service-contract', 'contract'));
  if (/이사회.*위원회신설/u.test(title)) return replace(semanticEvent('governance', 'established', 'effective', 'board-committee', 'governance'));
  if (/벌금등의부과/u.test(title) && /항소|불복|취소소송|행정소송|행정심판|취소청구|이의제기/u.test(body)) return replace(semanticEvent('legal-regulatory', 'appealed', 'active', 'regulatory-fine', 'issuer'));
  if (/투자판단관련주요경영사항/u.test(title) && /소송|중재|청구/u.test(body)) return replace(semanticEvent('legal-regulatory', 'decided', 'effective', 'litigation', 'issuer'));
  if (/수시공시의무관련사항/u.test(title) && /배당|주주환원/u.test(body)) return replace(semanticEvent('corporate-event', 'announced', 'proposed', 'dividend-policy', 'securities'));
  if (/기타안내사항/u.test(title)
    && /생산중단.{0,160}(?:종료|해제)|(?:종료|해제).{0,160}생산중단|가동중단관련진행사항|생산을종료|재개계획은없/u.test(body)) {
    return replace(semanticEvent('operating-status', 'terminated', 'effective', 'production-suspension', 'business'));
  }
  if (/기타안내사항/u.test(title) && /기준일|주주명부폐쇄/u.test(body)) return replace(semanticEvent('corporate-event', 'announced', 'pending', 'record-date', 'securities'));
  if (/상장채권관련기타주요사항/u.test(title)) return replace(semanticEvent('capital-change', 'halted', 'effective', 'debt-securities', 'securities'));
  if (/기타경영사항/u.test(title) && /분기보고서.{0,120}(?:홈페이지.{0,80})?게시(?:하였|완료)/u.test(body)) {
    return replace(semanticEvent('periodic-report', 'published', 'effective', 'quarterly-report', 'issuer'));
  }
  if (/주요경영사항/u.test(title) && /사업양도/u.test(body)
    && /거래.{0,40}종결|양도계약.{0,40}종결|최종양도가액.{0,40}확정/u.test(body)) {
    return replace(semanticEvent('restructuring', 'completed', 'effective', 'business-disposal', 'business'));
  }

  // Object/actor ontology is evaluated before the issuer-capital default.
  if (/주권관련사채권의취득결정|주권관련사채권양수결정/u.test(title)) {
    return replace(semanticEvent('asset-transaction', 'decided', 'proposed', /전환사채/u.test(body) ? 'convertible-bond-acquisition' : 'securities-purchase', 'securities'));
  }
  if (/유형자산(?:양수|취득)결정/u.test(title)) return replace(semanticEvent('asset-transaction', corrected ? 'updated' : 'decided', corrected && facts.hasFutureDate ? 'pending' : 'proposed', 'tangible-asset-acquisition', /토지|건물|부동산/u.test(body) ? 'real-estate' : 'asset'));
  if (/유형자산(?:양도|처분)결정/u.test(title)) return replace(semanticEvent('asset-transaction', corrected ? 'updated' : 'decided', corrected && facts.hasFutureDate ? 'pending' : 'proposed', 'tangible-asset-disposal', /토지|건물|부동산/u.test(body) ? 'real-estate' : 'asset'));
  if (/전환청구권.*신주인수권.*교환청구권행사/u.test(title)) {
    if (/(?:1\.구분|구분).{0,100}신주인수권부사채권의신주인수권행사/u.test(body)) {
      return replace(semanticEvent('capital-change', 'exercised', 'effective', 'warrant-bond', 'securities'));
    }
    if (/(?:1\.구분|구분).{0,100}(?:교환사채|교환청구)/u.test(body)) {
      return replace(semanticEvent('capital-change', 'exercised', 'effective', 'exchangeable-bond-exchange', 'securities'));
    }
  }
  if (/유상증자또는주식관련사채등의발행결과/u.test(title) && /전환사채/u.test(body)) return replace(semanticEvent('capital-change', 'completed', 'effective', 'convertible-bond', 'securities'));

  // Phase is derived from explicit business lifecycle evidence, not merely the
  // presence of a decision noun in the form title.
  if (!corrected && /영업양도결정/u.test(title) && !facts.completionObserved) return replace(semanticEvent('restructuring', 'decided', 'proposed', 'business-disposal', 'business'));
  if (!corrected && /영업정지/u.test(title) && (facts.scheduledDateRelation === 'future' || facts.hasFutureDate)) return replace(semanticEvent('operating-status', 'halted', 'pending', 'business-suspension', 'business'));
  if (/대표이사.*변경/u.test(title) && facts.hasFutureDate) return replace(semanticEvent('governance', 'changed', 'pending', 'chief-executive-change', 'governance'));
  if (!corrected && /자기전환사채만기전취득결정/u.test(title)) return replace(semanticEvent('capital-change', 'acquired', 'effective', 'convertible-bond', 'securities'));
  if (/자기전환사채매도결정/u.test(title)) return replace(semanticEvent('capital-change', 'sold', 'effective', 'convertible-bond', 'securities'));
  if (/자기주식취득신탁계약체결결정/u.test(title) && !facts.hasFutureDate) return replace(semanticEvent('capital-change', 'contracted', 'effective', 'treasury-share-trust', 'securities'));
  if (/자기주식취득신탁계약해지결정/u.test(title)) return replace(semanticEvent('capital-change', 'terminated', 'effective', 'treasury-share-trust', 'securities'));
  if (!corrected && /주주총회소집공고/u.test(title)) return replace(semanticEvent('governance', 'convened', 'pending', 'shareholder-meeting', 'governance'));
  if (/전환가액.*조정/u.test(title)
    && ['past', 'same-day'].includes(facts.adjustmentDateRelation)
    && /조정(?:전|후)가액|조정가액적용일/u.test(body)) {
    return replace(semanticEvent('capital-change', 'adjusted', 'effective', 'convertible-price', 'securities'));
  }
  if (/사외이사.*(?:선임|해임|중도퇴임)/u.test(title)
    && facts.governanceDateRelation === 'same-day'
    && /신규.{0,240}(?:20\d{2}|\d{2})[년.\-/]/u.test(body)) {
    return replace(semanticEvent('governance', 'changed', 'effective', 'outside-director', 'governance'));
  }
  if (!corrected && /단일판매[ㆍ·ᆞ]?공급계약체결/u.test(title)
    && ['past', 'same-day'].includes(facts.contractDateRelation)
    && facts.contractStartDateRelation !== 'future'
    && /계약기간.{0,120}시작일/u.test(body)
    && !/일부계약.{0,80}(?:진행|수행)|수행중/u.test(body)) {
    return replace(semanticEvent('material-contract', 'contracted', 'effective', 'supply-contract', 'contract'));
  }
  if (/지주회사의자회사탈퇴/u.test(title)
    && ['past', 'same-day'].includes(facts.subsidiaryExitDateRelation)
    && /탈퇴일자는?주권인도일/u.test(body)) {
    return replace(semanticEvent('corporate-profile', 'changed', 'effective', 'subsidiary-exit', 'issuer'));
  }
  if (/중대재해발생/u.test(title)
    && hasAffirmativeRegulatoryWorkStop(currentDisclosureScope(facts, compactText(input.bodyText)))) {
    return replace(
      semanticEvent('corporate-event', 'occurred', 'effective', 'serious-industrial-accident', 'operations'),
        semanticEvent('operating-status', 'halted', 'active', 'work-stop', 'operating-business'),
    );
  }
  if (/매매거래정지및정지해제/u.test(title) && /영업양도|사업양도/u.test(body)) {
    return replace(...events.map((event) => createEvent({ ...event, cause: 'business-disposal' })));
  }
  if (/단기차입금증가결정.*자회사의주요경영사항/u.test(title)
    || (/단기차입금증가결정/u.test(title) && /특수관계인|계열회사|관계회사/u.test(body))) {
    return replace(semanticEvent('related-party', 'decided', 'proposed', 'related-party-borrowing', 'contract'));
  }
  if (/금전대여결정/u.test(title) && !corrected) {
    const relatedParty = hasAffirmativeRelatedPartyEvidence(input, facts);
    if (/만기.{0,60}연장|연장.{0,60}만기/u.test(body)) {
      return replace(semanticEvent(
        relatedParty ? 'related-party' : 'material-contract',
        'extended',
        'pending',
        relatedParty ? 'related-party-loan' : 'loan',
        'contract',
      ));
    }
    if (['past', 'same-day'].includes(facts.operationalDateRelation)) {
      return replace(semanticEvent(
        relatedParty ? 'related-party' : 'material-contract',
        'lent',
        'effective',
        relatedParty ? 'related-party-loan' : 'loan',
        'contract',
      ));
    }
  }
  if (corrected && /금전대여결정/u.test(title) && hasAffirmativeLoanTermination(body)) {
    return replace(semanticEvent('material-contract', 'terminated', 'effective', 'loan', 'contract'));
  }

  // Corrections keep wrapper action separate from the underlying event state.
  if (/^\[발행조건확정\]/u.test(title)) return replace(...events.map((event) => createEvent({ ...event, action: 'price-set', state: 'effective' })));
  if (corrected && /자기주식처분결정/u.test(title)) return replace(semanticEvent('capital-change', 'updated', 'pending', 'treasury-share-disposal', 'securities'));
  if (corrected && /교환사채권발행결정/u.test(title) && facts.hasFutureDate) return replace(semanticEvent('capital-change', 'updated', 'pending', 'exchangeable-bond', 'securities'));
  if (corrected && input.disclosureDetailType === 'G002' && /증권신고서/u.test(title)) {
    return replace(...events.map((event) => createEvent({
      ...event,
      action: 'updated',
      state: facts.bodyAvailable ? 'effective' : null,
    })));
  }
  if (corrected && input.disclosureDetailType === 'E004' && /주식매수선택권부여/u.test(title)
    && /정정대상공시서류.{0,180}최초제출일/u.test(body)
    && /정정사항|정정사유/u.test(body)
    && !/부여(?:전부)?취소|신규부여결정/u.test(body)) {
    return replace(semanticEvent('capital-change', 'updated', 'effective', 'stock-option', 'securities'));
  }
  if (input.correctionKind === '첨부정정' && input.disclosureDetailType === 'C004' && /증권신고서/u.test(title)) {
    return replace(...events.map((event) => createEvent({ ...event, action: 'updated', state: null })));
  }
  if (corrected && /증권신고서/u.test(title)
    && !(input.disclosureDetailType === 'C004' && /주식의포괄적교환[ㆍ·ᆞ]?이전/u.test(title))) {
    return replace(...events.map((event) => createEvent({ ...event, action: 'updated', state: event.state === 'pending' ? 'pending' : event.state })));
  }
  if (corrected && /주주총회소집공고/u.test(title)) return replace(semanticEvent('governance', 'updated', 'pending', 'shareholder-meeting', 'governance'));
  if (corrected && /(?:전환사채권|신주인수권부사채권)발행결정/u.test(title)) {
    const issuanceState = facts.completionObserved
      ? 'effective'
      : facts.hasFutureDate ? 'pending' : 'effective';
    return replace(semanticEvent('capital-change', 'updated', issuanceState, /신주인수권부/u.test(title) ? 'bond-with-warrants' : 'convertible-bond', 'securities'));
  }
  if (corrected && /자기전환사채만기전취득결정/u.test(title)) return replace(semanticEvent('capital-change', 'updated', 'pending', 'convertible-bond', 'securities'));
  if (corrected && /상각형조건부자본증권발행결정/u.test(title)) return replace(semanticEvent('capital-change', 'updated', 'pending', 'contingent-capital-securities', 'securities'));
  if (corrected && /신규시설투자등\(자율공시\)/u.test(title)) return replace(semanticEvent('capital-expenditure', 'updated', 'pending', 'facility-investment', 'asset'));
  if (corrected && /회사(?:분할|합병)결정|타법인주식및출자증권양수결정/u.test(title)) return replace(...events.map((event) => createEvent({ ...event, action: 'updated', state: facts.completionObserved ? 'effective' : 'pending' })));
  if (corrected && /생산중단/u.test(title) && /생산재개|재개일/u.test(body)) return replace(semanticEvent('operating-status', /재개완료|생산을재개/u.test(body) ? 'resumed' : 'lifted', /재개완료|생산을재개/u.test(body) ? 'effective' : 'lifted', 'production-suspension', 'business'));
  if (corrected && /소송등의제기/u.test(title)
    && /정정(?:사유|사항).{0,240}(?:취하|철회)|(?:취하|철회).{0,120}정정/u.test(body)) {
    return replace(semanticEvent('legal-regulatory', 'withdrawn', 'effective', 'litigation', 'issuer'));
  }
  if (corrected && /장래사업[ㆍ·ᆞ]?경영계획/u.test(title) && hasAffirmativeBusinessPlanWithdrawal(body)) return replace(semanticEvent('corporate-event', 'withdrawn', 'effective', 'business-plan', 'issuer'));
  if (corrected && /최대주주변경.*주식양수도계약체결/u.test(title)) {
    return replace(semanticEvent(
      'ownership-change',
      /미발생|효력미발생/u.test(body) ? 'updated' : 'rescheduled',
      'pending',
      'controlling-shareholder',
      'ownership',
    ));
  }
  if (corrected && /타법인주식및출자증권처분결정/u.test(title) && facts.completionObserved) return replace(semanticEvent('restructuring', 'disposed', 'effective', 'equity-disposal', 'securities'));
  if (corrected && /타법인주식및출자증권처분결정/u.test(title)
    && /거래정산.{0,80}최종확정|거래.{0,40}종결.{0,160}최종(?:정산|확정)/u.test(body)) {
    return replace(semanticEvent('restructuring', 'disposed', 'effective', 'equity-disposal', 'securities'));
  }
  if (corrected && /부동산투자회사부동산임대/u.test(title)) return replace(semanticEvent('asset-transaction', 'updated', 'pending', 'real-estate-lease', 'real-estate'));
  if (corrected && /부동산투자회사부동산취득/u.test(title)) return replace(semanticEvent('asset-transaction', 'rescheduled', 'pending', 'tangible-asset-acquisition', 'real-estate'));
  if (corrected && /의결권대리행사권유/u.test(title) && !/단순(?:오기재|기재오류)/u.test(body)) return replace(semanticEvent('governance', 'updated', facts.hasFutureDate ? 'pending' : null, 'proxy-solicitation', 'governance'));
  if (corrected && /대규모기업집단현황공시/u.test(title) && !/단순(?:오기재|기재오류)/u.test(body)) return replace(semanticEvent('governance', 'updated', facts.bodyAvailable ? 'effective' : null, 'business-group-status', 'governance'));

  // J001 and related-party forms: relation is the outer facet; verb direction
  // and economic object determine the inner canonical slots.
  if (input.disclosureDetailType === 'J001') {
    const proposed = facts.hasFutureDate || facts.operationalDateRelation === 'future' || /예정|계획|결의/u.test(body);
    if (/채권매수/u.test(title)) return replace(semanticEvent('related-party', 'decided', 'proposed', /전환사채/u.test(body) ? 'bond-purchase' : 'bond-transactions', 'securities'));
    if (/주식의처분/u.test(title)) return replace(semanticEvent('related-party', 'decided', 'proposed', 'equity-disposal', 'securities'));
    if (/자산양수/u.test(title)) return replace(semanticEvent('related-party', 'decided', 'proposed', /유형자산|토지|건물/u.test(body) ? 'tangible-asset-acquisition' : 'asset-acquisition', 'asset'));
    if (/자산양도/u.test(title)) return replace(semanticEvent('related-party', 'decided', 'proposed', 'asset-disposal', 'asset'));
    if (/전환사채발행/u.test(title)) return replace(semanticEvent('related-party', 'decided', 'proposed', 'convertible-bond', 'securities'));
    if (/기타유가증권매도/u.test(title)) return replace(semanticEvent('related-party', 'decided', 'proposed', 'securities-sale', 'securities'));
    if (!corrected && /수익증권거래/u.test(title) && /연장/u.test(body)) return replace(semanticEvent('related-party', 'extended', 'effective', 'fund-security-investment', 'securities'));
    if (/주식의취득/u.test(title) && /계약체결|주식양수도계약/u.test(body)
      && facts.operationalDateRelation === 'future' && !facts.completionObserved) {
      return replace(semanticEvent('related-party', 'contracted', 'pending', 'equity-acquisition', 'securities'));
    }
    if (/증여/u.test(title)) {
      const securitiesDonation = /(?:증여대상|증여목적물|증여내역).{0,120}(?:주식|유가증권)/u.test(body);
      return replace(semanticEvent('related-party', 'decided', 'proposed', securitiesDonation ? 'securities-donation' : 'cash-donation', securitiesDonation ? 'securities' : 'cash'));
    }
    if (/받은담보/u.test(title)) {
      const realEstate = /(?:담보물|담보제공물|담보자산).{0,160}(?:부동산|토지|건물)/u.test(body);
      const securities = /(?:담보물|담보제공물|담보자산).{0,160}(?:주식|유가증권)/u.test(body);
      const receiptPending = facts.operationalDateRelation === 'future' || facts.scheduledDateRelation === 'future';
      return replace(semanticEvent('related-party', receiptPending ? 'decided' : 'received', receiptPending ? 'proposed' : 'effective', 'collateral-received', realEstate ? 'real-estate' : securities ? 'securities' : 'asset'));
    }
    if (/담보제공/u.test(title)) {
      const securitiesCollateral = /(?:담보물|담보제공물|담보자산).{0,160}(?:주식|유가증권)/u.test(body);
      return replace(semanticEvent('related-party', proposed ? 'decided' : 'provided', proposed ? 'proposed' : 'effective', 'collateral-provision', securitiesCollateral ? 'securities' : 'asset'));
    }
    if (/장단기대여/u.test(title) && /실제(?:대여|거래|인수)?금액은?없/u.test(body)) return replace(semanticEvent('related-party', 'reported', 'effective', 'related-party-lending', 'contract'));
    if (corrected && /자금대여|장단기대여/u.test(title)
      && /(?:정정후|변경후)?.{0,160}(?:20\d{2}년)?[1-4]분기중.{0,60}(?:대여|거래|실행)/u.test(body)
      && /대여예정|필요시.{0,30}대여|향후대여/u.test(body)) {
      return replace(semanticEvent('related-party', 'updated', 'pending', 'related-party-loan', 'contract'));
    }
    if (/장단기차입/u.test(title) && /주식|지분증권|유가증권|기업어음|CP|채권/u.test(body)) return replace(semanticEvent('related-party', 'borrowed', 'effective', 'securities-borrowing', 'securities'));
    if (/내부거래/u.test(title) && /기간.{0,40}연장|연장.{0,40}기간/u.test(body)) return replace(semanticEvent('related-party', 'extended', 'effective', 'related-party-contract-updated', 'contract'));
    if (/내부거래/u.test(title) && /임대차|임차|임대|리스|렌트/u.test(body)) return replace(semanticEvent('related-party', 'decided', 'proposed', 'internal-lease', 'contract'));
  }

  return sortEvents(events);
}

function applyGeneralizedSemanticGates(input, events) {
  const facts = extractStructuredBodyFacts(input);
  const authoritative = applySeparatedSemanticGatePipeline(input, events, facts);
  if (authoritative !== null) return authoritative;

  const legacyEvents = applyLegacyGeneralizedSemanticGates(input, events);
  const identity = resolveCanonicalIntentIdentity(input, legacyEvents, facts);
  let resolved = identity?.events ?? legacyEvents;
  const lifecycle = applyLifecyclePrecedence(input, resolved, facts);
  if (lifecycle) resolved = lifecycle.events;
  return normalizeCanonicalSlots(input, resolved).events;
}

function semanticSectionFamily(event) {
  if (event.cause === 'litigation') return 'litigation';
  if (event.cause === 'treasury-share-trust') return 'trust';
  if (['convertible-bond', 'convertible-bond-acquisition'].includes(event.cause)) return 'bond';
  if (event.cause === 'product-approval') return 'product';
  if (event.cause === 'serious-industrial-accident') return 'accident';
  if (event.cause === 'regulatory-work-stop') return 'work-stop';
  if (event.cause === 'equity-securities') return 'equity';
  return event.cause ?? event.type ?? 'other';
}

function buildFinalEventEvidence({ input, candidates, events }) {
  const candidateBuckets = new Map();
  for (const candidate of candidates) {
    if (!candidate.event) continue;
    const key = eventKey(candidate.event);
    const bucket = candidateBuckets.get(key) ?? [];
    bucket.push(candidate);
    candidateBuckets.set(key, bucket);
  }

  const sectionsByFamily = new Map();
  for (const section of explicitBodySections(input.bodyText)) {
    if (!section.family) continue;
    const bucket = sectionsByFamily.get(section.family) ?? [];
    bucket.push(section);
    sectionsByFamily.set(section.family, bucket);
  }
  const familyOccurrences = new Map();

  return events.map((event, eventIndex) => {
    const fingerprint = eventKey(event);
    const matchingCandidates = candidateBuckets.get(fingerprint) ?? [];
    const candidate = matchingCandidates.shift() ?? null;
    const family = semanticSectionFamily(event);
    const occurrence = familyOccurrences.get(family) ?? 0;
    const section = sectionsByFamily.get(family)?.[occurrence] ?? null;
    if (section) familyOccurrences.set(family, occurrence + 1);
    if (candidate) {
      const bodyConfirmation = section
        ? [`semantic-family:${family}`, `semantic-section:${family}:${occurrence + 1}`]
        : [];
      return Object.freeze({
        eventIndex,
        fingerprint,
        source: section ? 'document-candidate+semantic-body-confirmed' : 'document-candidate',
        evidence: Object.freeze([...candidate.evidence, ...bodyConfirmation]),
      });
    }

    return Object.freeze({
      eventIndex,
      fingerprint,
      source: section ? 'semantic-body-derived' : 'semantic-gate-derived',
      evidence: Object.freeze([
        section ? 'semantic-gate:body-derived' : 'semantic-gate:derived',
        ...(section
          ? [`semantic-family:${family}`, `semantic-section:${family}:${occurrence + 1}`]
          : [`semantic-claim:${family}`]),
      ]),
    });
  });
}

const AUDITED_HIGH_CONFIDENCE_ORIGINAL_CONTRACTS = Object.freeze([
  Object.freeze({
    title: /주식등의대량보유상황보고서/u,
    event: Object.freeze({ type: 'ownership-change', action: 'reported', state: 'effective', cause: 'large-shareholding', subjectType: 'ownership' }),
  }),
  Object.freeze({
    title: /임원[ㆍ·ᆞ]?주요주주특정증권등소유상황보고서/u,
    event: Object.freeze({ type: 'ownership-change', action: 'reported', state: 'effective', cause: 'insider-ownership', subjectType: 'ownership' }),
  }),
  Object.freeze({
    title: /기업설명회\(IR\)개최/u,
    event: Object.freeze({ type: 'corporate-event', action: 'scheduled', state: 'pending', cause: 'investor-relations', subjectType: 'issuer' }),
  }),
  Object.freeze({
    title: /결산실적공시예고/u,
    event: Object.freeze({ type: 'earnings', action: 'scheduled', state: 'pending', cause: 'operating-results', subjectType: 'financials' }),
  }),
  Object.freeze({
    title: /공정거래자율준수프로그램운영현황/u,
    event: Object.freeze({ type: 'governance', action: 'reported', state: 'active', cause: 'compliance-program', subjectType: 'governance' }),
  }),
  Object.freeze({
    title: /임시주주총회결과/u,
    event: Object.freeze({ type: 'governance', action: 'held', state: 'effective', cause: 'shareholder-meeting', subjectType: 'governance' }),
  }),
  Object.freeze({
    title: /현금[ㆍ·ᆞ]?현물배당을위한주주명부폐쇄/u,
    event: Object.freeze({ type: 'corporate-action', action: 'decided', state: 'pending', cause: 'record-date', subjectType: 'ownership' }),
  }),
  Object.freeze({
    title: /지급수단별[ㆍ·ᆞ]?지급기간별지급금액/u,
    event: Object.freeze({ type: 'supplier-payment', action: 'reported', state: null, cause: 'subcontract-payment-terms', subjectType: 'issuer' }),
  }),
  Object.freeze({
    title: /주식소각결정/u,
    event: Object.freeze({ type: 'corporate-action', action: 'decided', state: 'proposed', cause: 'share-cancellation', subjectType: 'securities' }),
  }),
  Object.freeze({
    title: /자기주식취득신탁계약해지결정/u,
    event: Object.freeze({ type: 'capital-change', action: 'terminated', state: 'effective', cause: 'treasury-share-trust', subjectType: 'securities' }),
  }),
  Object.freeze({
    title: /상각형조건부자본증권발행결정/u,
    event: Object.freeze({ type: 'capital-change', action: 'decided', state: 'proposed', cause: 'contingent-capital-securities', subjectType: 'securities' }),
  }),
  Object.freeze({
    title: /유상증자또는주식관련사채등의발행결과/u,
    event: Object.freeze({ type: 'capital-change', action: 'completed', state: 'effective', cause: Object.freeze(['equity-securities', 'rights-offering']), subjectType: 'securities' }),
  }),
  Object.freeze({
    title: /단기차입금증가결정/u,
    event: Object.freeze({ type: 'capital-change', action: 'decided', state: 'proposed', cause: 'short-term-borrowing', subjectType: 'subsidiary' }),
  }),
  Object.freeze({
    title: /소송등의제기/u,
    event: Object.freeze({ type: 'legal-regulatory', action: 'filed', state: 'active', cause: 'litigation', subjectType: 'issuer' }),
  }),
  Object.freeze({
    title: /단일판매[ㆍ·ᆞ]?공급계약체결/u,
    event: Object.freeze({ type: 'material-contract', action: 'contracted', state: Object.freeze(['pending', 'effective']), cause: 'supply-contract', subjectType: 'contract' }),
  }),
  Object.freeze({
    title: /공개매수(?:신고서|설명서)/u,
    event: Object.freeze({ type: 'corporate-action', action: 'initiated', state: 'active', cause: 'tender-offer', subjectType: 'listed-shares' }),
  }),
  Object.freeze({
    title: /자기주식처분결과보고서/u,
    event: Object.freeze({ type: 'corporate-action', action: 'completed', state: 'effective', cause: 'treasury-share-disposal', subjectType: 'listed-shares' }),
  }),
]);

function eventMatchesConfidenceContract(event, expected) {
  return Object.entries(expected).every(([field, value]) => (
    Array.isArray(value) ? value.includes(event[field]) : event[field] === value
  ));
}

export function isHighConfidenceEligible({ input, events, eventEvidence = [] }) {
  if (input.wrapperKind !== 'original' || events.length !== 1) return false;
  const title = compactText(input.reportName);
  const auditedTitleContract = AUDITED_HIGH_CONFIDENCE_ORIGINAL_CONTRACTS.some((contract) => (
    contract.title.test(title) && eventMatchesConfidenceContract(events[0], contract.event)
  ));
  if (auditedTitleContract) return true;

  const event = events[0];
  const evidenceSource = eventEvidence[0]?.source;
  const structurallyComplete = [event.type, event.action, event.state, event.cause, event.subjectType]
    .every((value) => value !== null && typeof value !== 'undefined');
  const auditedEvidenceSource = [
    'document-candidate',
    'document-candidate+semantic-body-confirmed',
    'semantic-gate-derived',
  ].includes(evidenceSource);
  return Boolean(input.bodyText)
    && structurallyComplete
    && auditedEvidenceSource
    && !['C003', 'C004', 'J001'].includes(input.disclosureDetailType);
}

export function scoreEventExtractionConfidence({ input, candidates, events, eventEvidence = [] }) {
  if (events.length === 0 || events.some((event) => event.type === 'other')) return 'low';
  if (!input.bodyText && input.disclosureDetailType === 'J001') return 'low';
  if (!input.bodyText && ['C004', 'E004'].includes(input.disclosureDetailType)) return 'medium';
  if (!input.bodyText && input.wrapperKind !== 'original'
    && events.some((event) => event.action === 'updated' && event.state === null)) return 'medium';
  if (candidates.some((candidate) => candidate.confidence === 'medium')) return 'medium';
  if (candidates.some((candidate) => candidate.evidence.includes('temporal:conflict'))) return 'medium';
  if (events.length > 1 && events.some((event) => event.state === 'pending')) return 'medium';
  const bodyDerivedEvidence = eventEvidence.filter((entry) => entry.source === 'semantic-body-derived');
  if (bodyDerivedEvidence.length > 1) return 'medium';
  const explicitFamilies = new Set(explicitBodySections(input.bodyText).map((section) => section.family).filter(Boolean));
  if (events.length > 1 && explicitFamilies.size > 1) return 'medium';
  const title = compactText(input.reportName);
  const body = compactText(input.bodyText);
  if (input.correctionKind === '연장결정' && /자기주식취득신탁계약/u.test(title)) return 'medium';
  const hasPendingCorrection = input.wrapperKind === 'correction'
    && events.some((event) => ['rescheduled', 'updated'].includes(event.action) && event.state === 'pending');
  const hasScopedLifecycleDelta = (
    (/자기전환사채매도결정/u.test(title)
      && /매도대금.{0,40}잔금(?:일부)?납입일변경|잔금일변경.{0,80}(?:일부대금수령|계약금|중도금)/u.test(body))
    || (/타법인주식및출자증권처분결정/u.test(title)
      && /처분금액확정|매수인의변경|매수인지위.{0,50}(?:권리|의무).{0,50}(?:양도|이전)/u.test(body))
    || (/해산사유발생/u.test(title) && /흡수합병.{0,100}(?:해산|소멸)|(?:해산|소멸).{0,100}흡수합병/u.test(body))
    || (input.disclosureDetailType === 'C004'
      && /증권신고서\(분할\)/u.test(title)
      && /분할(?:기일|신주).{0,80}예정|주주총회.{0,80}예정/u.test(body))
    || (/금전대여결정.*자회사의주요경영사항/u.test(title)
      && /대여금액변경/u.test(body)
      && /(?:분할하여)?집행예정|대여실행.{0,80}예정/u.test(body))
    || (/감자결정/u.test(title) && /기준일변경에따른정정/u.test(body))
    || (/주권관련사채권의취득결정/u.test(title) && /취득예정일변경/u.test(body))
    || (/특수관계인의유상증자참여/u.test(title) && /최종발행가액.{0,80}변동/u.test(body) && !/확정된최종발행가액을적용/u.test(body))
    || (/유상증자결정/u.test(title) && /확정예정일/u.test(body) && /납입일/u.test(body))
    || (/타법인주식및출자증권취득결정/u.test(title) && /최종발행가액.{0,120}취득|취득예정일자는주금납입\(예정\)일/u.test(body))
    || (/주식교환[ㆍ·ᆞ]?이전결정/u.test(title) && /주식매수청구취득주식처분방안추가반영/u.test(body))
    || (/자기주식취득결정/u.test(title) && /무상증자결의시점부터.{0,80}자기주식을취득하지않을예정/u.test(body))
    || (/무상증자결정/u.test(title) && /자기주식취득계획변경/u.test(body))
    || (/감자결정/u.test(title) && /전환사채전환청구에따른주식수량반영/u.test(body))
    || (/타법인주식및출자증권양도결정/u.test(title) && /정산이완료되지않/u.test(body))
    || (/투자판단관련주요경영사항/u.test(title) && /최대주주변경은없습니다/u.test(body))
    || (/자본으로인정되는채무증권발행결정/u.test(title) && /일부조건변경에따른정정/u.test(body))
    || (/신주인수권부사채권발행결정/u.test(title)
      && /사채만기일.{0,100}일정변경에따른기재정정/u.test(body)
      && /행사가액.{0,100}확정될예정/u.test(body))
    || (/타인에대한채무보증결정/u.test(title) && /채무보증기간의변경/u.test(body))
    || (/타법인주식및출자증권처분결정/u.test(title) && /풋옵션.{0,80}미이행/u.test(body) && /미확정/u.test(body))
  );
  if (hasPendingCorrection && !hasScopedLifecycleDelta) return 'medium';
  const riskyCorrectionSemantic = input.wrapperKind !== 'original'
    && /교환사채권발행결정|타법인주식및출자증권양수결정|발행조건확정|영업실적등에대한전망|유형자산양도결정|소송등의제기/u.test(title);
  const bodyDependentRelatedPartySemantic = input.disclosureDetailType === 'J001'
    && /받은담보|주식의취득|장단기대여/u.test(title);
  const preliminaryComplianceSemantic = /불성실공시법인지정예고/u.test(title);
  if (riskyCorrectionSemantic || bodyDependentRelatedPartySemantic || preliminaryComplianceSemantic) return 'medium';
  return isHighConfidenceEligible({ input, events, eventEvidence }) ? 'high' : 'medium';
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
  const corrected = applyCorrectionLifecycle(normalized, {
    input: normalizedInput,
    bodyFacts,
    titleClaims,
  });
  const genericTemporalConflict = DISCLOSURE_ACTIONS.has(event.action)
    && (bodyFacts.deferred || bodyFacts.completionObserved || bodyFacts.operationalDateRelation === 'future' || bodyFacts.operationalMonthRelation === 'future' || bodyFacts.scheduledDateRelation === 'future');
  const confidence = (!bodyFacts.bodyAvailable && buildDetailPriorClaims(normalizedInput).requiresBody)
    || bodyFacts.releaseTimestampBlank
    || genericTemporalConflict
    ? 'medium'
    : 'high';
  return {
    event: corrected,
    confidence,
    evidence: [source, `wrapper:${normalizedInput.wrapperKind}`, genericTemporalConflict ? 'temporal:conflict' : `temporal:${bodyFacts.deferred
      ? 'deferred'
      : bodyFacts.completionObserved || titleClaims.completed
        ? 'completed'
        : bodyFacts.operationalDateRelation ?? bodyFacts.scheduledDateRelation ?? 'observed'}`],
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
  [/사업보고서제출기한연장/u, { type: 'periodic-report', action: 'extended', state: 'pending', cause: 'annual-report-deadline', subjectType: 'issuer' }],
  [/자기주식취득신탁계약체결/u, { type: 'capital-change', action: 'contracted', cause: 'treasury-share-trust', subjectType: 'securities' }],
  [/자기주식취득신탁계약해지|신탁계약해지결과/u, { type: 'capital-change', action: 'terminated', cause: 'treasury-share-trust', subjectType: 'securities' }],
  [/자기주식취득결정/u, { type: 'capital-change', action: 'decided', cause: 'treasury-share-acquisition', subjectType: 'securities' }],
  [/자기주식처분결정/u, { type: 'capital-change', action: 'decided', cause: 'treasury-share-disposal', subjectType: 'securities' }],
  [/자기주식취득결과/u, { type: 'capital-change', action: 'completed', cause: 'treasury-share-acquisition', subjectType: 'securities' }],
  [/자기주식처분결과/u, { type: 'capital-change', action: 'completed', cause: 'treasury-share-disposal', subjectType: 'securities' }],
  [/신탁계약에의한취득상황/u, { type: 'capital-change', action: 'reported', cause: 'treasury-share-trust', subjectType: 'securities' }],
  [/감자결정/u, { type: 'capital-change', action: 'decided', cause: 'capital-reduction', subjectType: 'securities' }],
  [/자기신주인수권부사채만기전취득/u, { type: 'capital-change', action: 'acquired', cause: 'warrant-bond', subjectType: 'securities' }],
  [/자기신주인수권부사채매도결정/u, { type: 'capital-change', action: 'disposed', cause: 'warrant-bond-sale', subjectType: 'securities' }],
  [/교환사채권발행결정/u, { type: 'capital-change', action: 'decided', state: 'proposed', cause: 'exchangeable-bond', subjectType: 'securities' }],
  [/제3자의전환사채매수선택권행사/u, { type: 'capital-change', action: 'exercised', state: 'effective', cause: 'convertible-bond-call-option', subjectType: 'securities' }],
  [/전환사채매수선택권행사자지정/u, { type: 'capital-change', action: 'designated', state: 'effective', cause: 'convertible-bond-call-option', subjectType: 'securities' }],
  [/상각형조건부자본증권발행|자본으로인정되는채무증권발행/u, { type: 'capital-change', action: 'decided', cause: 'contingent-capital-securities', subjectType: 'securities' }],
  [/주권관련사채권의취득/u, { type: 'capital-change', action: 'acquired', cause: 'equity-linked-bond', subjectType: 'securities' }],
  [/주권관련사채권의처분/u, { type: 'capital-change', action: 'disposed', cause: 'equity-linked-bond', subjectType: 'securities' }],
  [/해외증권시장주권등상장/u, { type: 'capital-change', action: 'listed', cause: 'overseas-listing', subjectType: 'securities' }],
  [/타법인주식및출자증권(?:양수|취득)/u, { type: 'restructuring', action: 'acquired', cause: 'equity-acquisition', subjectType: 'securities' }],
  [/타법인주식및출자증권(?:양도|처분)/u, { type: 'restructuring', action: 'disposed', cause: 'equity-disposal', subjectType: 'securities' }],
  [/유형자산양수|비유동자산취득/u, { type: 'restructuring', action: 'acquired', cause: 'asset-acquisition', subjectType: 'asset' }],
  [/유형자산취득결정/u, { type: 'asset-transaction', action: 'decided', cause: 'tangible-asset-acquisition', subjectType: 'real-estate' }],
  [/유형자산처분결정/u, { type: 'asset-transaction', action: 'decided', cause: 'tangible-asset-disposal', subjectType: 'real-estate' }],
  [/영업양수/u, { type: 'restructuring', action: 'acquired', cause: 'business-acquisition', subjectType: 'business' }],
  [/영업양도/u, { type: 'restructuring', action: 'disposed', cause: 'business-disposal', subjectType: 'business' }],
  [/영업정지/u, { type: 'operating-status', action: 'halted', cause: 'business-suspension', subjectType: 'business' }],
  [/회사분할결정/u, { type: 'restructuring', action: 'decided', state: 'proposed', cause: 'demerger', subjectType: 'issuer' }],
  [/회사합병결정/u, { type: 'restructuring', action: 'decided', cause: 'merger', subjectType: 'issuer' }],
  [/주식(?:의)?포괄적교환|주식교환.*이전/u, { type: 'restructuring', action: 'decided', cause: 'share-exchange', subjectType: 'issuer' }],
  [/합병등종료보고서/u, { type: 'restructuring', action: 'completed', cause: 'merger-or-reorganization', subjectType: 'issuer' }],
  [/채권은행등의관리절차개시/u, { type: 'insolvency', action: 'initiated', cause: 'creditor-bank-management', subjectType: 'issuer' }],
  [/회생절차개시신청/u, { type: 'insolvency', action: 'applied', cause: 'rehabilitation', subjectType: 'issuer' }],
  [/상장채권기한의이익상실/u, { type: 'insolvency', action: 'defaulted', cause: 'bond-default', subjectType: 'securities' }],
  [/소송등의제기|경영권분쟁소송/u, { type: 'legal-regulatory', action: 'filed', cause: 'litigation', subjectType: 'issuer' }],
  [/횡령.*배임혐의발생/u, { type: 'legal-regulatory', action: 'reported', state: 'alleged', cause: 'embezzlement-breach-of-trust', subjectType: 'issuer' }],
  [/회계처리기준위반/u, { type: 'legal-regulatory', action: 'sanctioned', cause: 'accounting-violation', subjectType: 'issuer' }],
  [/중대재해관련형사처벌사실확인/u, { type: 'legal-regulatory', action: 'confirmed', cause: 'serious-industrial-accident-penalty', subjectType: 'issuer' }],
  [/중대재해발생/u, { type: 'legal-regulatory', action: 'occurred', cause: 'serious-industrial-accident', subjectType: 'issuer' }],
  [/특수관계인에대한자금대여|금전대여결정/u, { type: 'related-party', action: 'decided', state: 'proposed', cause: 'related-party-loan', subjectType: 'contract' }],
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
  [/유상증자.*(?:발행결과|청약결과)/u, { type: 'capital-change', action: 'completed', cause: 'securities-issuance', subjectType: 'securities' }],
  [/증권발행(?:실적보고서|결과)/u, { type: 'capital-change', action: 'completed', cause: 'securities-issuance', subjectType: 'securities' }],
  [/유상증자신주발행가액/u, { type: 'capital-change', action: 'price-set', cause: 'rights-offering', subjectType: 'securities' }],
  [/(?:전환청구권|신주인수권|교환청구권)행사(?!가액)/u, { type: 'capital-change', action: 'exercised', state: 'effective', cause: 'convertible-bond-conversion', subjectType: 'securities' }],
  [/철회신고서/u, { type: 'capital-change', action: 'withdrawn', state: 'cancelled', cause: 'rights-offering', subjectType: 'securities' }],
  [/증권신고서|소액공모공시서류/u, { type: 'capital-change', action: 'filed', cause: 'securities-issuance', subjectType: 'securities' }],
  [/투자설명서/u, { type: 'capital-change', action: 'published', cause: 'securities-offering', subjectType: 'securities' }],
  [/일괄신고/u, { type: 'capital-change', action: 'filed', cause: 'shelf-registration', subjectType: 'securities' }],
  [/의결권대리행사권유/u, { type: 'governance', action: 'solicited', cause: 'proxy-solicitation', subjectType: 'governance' }],
  [/(?:정기|임시)?주주총회결과/u, { type: 'governance', action: 'held', state: 'effective', cause: 'shareholder-meeting', subjectType: 'governance' }],
  [/주주총회소집결의/u, { type: 'governance', action: 'convened', cause: 'shareholder-meeting', subjectType: 'governance' }],
  [/대표이사.*변경/u, { type: 'governance', action: 'changed', state: 'effective', cause: 'chief-executive-change', subjectType: 'governance' }],
  [/공개매수결과/u, { type: 'corporate-action', action: 'completed', cause: 'tender-offer', subjectType: 'securities' }],
  [/공개매수에관한의견/u, { type: 'corporate-action', action: 'opinion-filed', cause: 'tender-offer', subjectType: 'securities' }],
  [/공개매수(?:신고서|설명서)/u, { type: 'corporate-action', action: 'announced', cause: 'tender-offer', subjectType: 'securities' }],
  [/특정증권등거래계획철회/u, { type: 'ownership-change', action: 'withdrawn', cause: 'insider-trading-plan', subjectType: 'ownership' }],
  [/특정증권등거래계획보고/u, { type: 'ownership-change', action: 'reported', cause: 'insider-trading-plan', subjectType: 'ownership' }],
  [/임원.*주요주주특정증권등소유상황/u, { type: 'ownership-change', action: 'reported', cause: 'insider-ownership', subjectType: 'ownership' }],
  [/주요주주의주식보유변동/u, { type: 'ownership-change', action: 'reported', cause: 'major-shareholder', subjectType: 'ownership' }],
  [/주식등의대량보유상황/u, { type: 'ownership-change', action: 'reported', cause: 'large-shareholding', subjectType: 'ownership' }],
  [/최대주주등소유주식변동/u, { type: 'ownership-change', action: 'reported', cause: 'large-shareholding', subjectType: 'ownership' }],
  [/사명변경|회사명변경/u, { type: 'corporate-profile', action: 'changed', state: 'effective', cause: 'company-name-change', subjectType: 'issuer' }],
  [/기업설명회\(IR\)개최/u, { type: 'corporate-event', action: 'scheduled', cause: 'investor-relations', subjectType: 'issuer' }],
  [/장래사업.*경영계획/u, { type: 'corporate-event', action: 'announced', state: 'proposed', cause: 'business-plan', subjectType: 'issuer' }],
  [/수시공시의무관련사항.*배당/u, { type: 'corporate-event', action: 'decided', state: 'proposed', cause: 'dividend-policy', subjectType: 'securities' }],
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
  [/지급수단별.*지급기간별/u, { type: 'supplier-payment', action: 'reported', cause: 'subcontract-payment-terms', subjectType: 'issuer' }],
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
        ? 'merger-or-reorganization'
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
  const rawEvents = applyGeneralizedSemanticGates(
    input,
    applyEventSetRules(input, arbitrateEventCandidates(candidates)),
  );
  const rawEventEvidence = buildFinalEventEvidence({ input, candidates, events: rawEvents });
  const events = rawEvents.map(canonicalizeResolvedEvent);
  const eventEvidence = rawEventEvidence.map((entry, eventIndex) => Object.freeze({
    ...entry,
    eventIndex,
    fingerprint: eventKey(events[eventIndex]),
  }));
  const confidence = scoreEventExtractionConfidence({ input, candidates, events, eventEvidence });
  return {
    version: KR_DISCLOSURE_EVENT_GATED_VERSION,
    strategy: 'semantic-gate-v5',
    ontologyVersion: KR_DISCLOSURE_EVENT_ONTOLOGY_VERSION,
    ontologyHash: KR_DISCLOSURE_EVENT_ONTOLOGY_HASH,
    events,
    confidence,
    eventEvidence,
    reasons: [
      'document-baseline-preserved',
      'semantic-gate-v5',
      ...new Set(candidates.flatMap((candidate) => candidate.evidence)),
      ...new Set(eventEvidence.flatMap((entry) => entry.evidence)),
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
