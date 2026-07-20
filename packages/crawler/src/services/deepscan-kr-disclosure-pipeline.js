import { createHash } from 'node:crypto';
import { sanitizeForJson } from '../../../deepscan-runtime-core/src/safe-json.js';
import {
  KR_DISCLOSURE_CATEGORY_CONFIG,
  KR_DISCLOSURE_CATEGORY_ORDER,
  KR_DISCLOSURE_CLASSIFICATION_DATASET_VERSION,
  KR_DISCLOSURE_TITLE_RULES,
  OPEN_DART_BROAD_TYPE_DEFAULTS,
  OPEN_DART_DISCLOSURE_DETAIL_TYPES,
  OPEN_DART_DISCLOSURE_TYPES,
} from '../data/kr-disclosure-classification-dataset.js';
import { matchKrDisclosureRiskKeywords } from './deepscan-kr-disclosure-risk-keywords.js';

export const KR_DISCLOSURE_PIPELINE_SCHEMA_VERSION = 'jaroo.deepscan.kr-disclosure-pipeline.v1';

const DEFAULT_SELECTION_LIMIT = 50;
const MAX_SELECTION_LIMIT = 200;
const DEFAULT_MAX_CHARS_PER_FILING = 15_000;
const DEFAULT_MAX_TOTAL_CHARS = 60_000;
const DEFAULT_DOCUMENT_LIMIT = 20;

const CATEGORY_ORDER = KR_DISCLOSURE_CATEGORY_ORDER;
const CATEGORY_CONFIG = KR_DISCLOSURE_CATEGORY_CONFIG;

const RISK_POINTS = Object.freeze({ critical: 30, high: 20, medium: 10, low: 0 });
const RISK_RANK = Object.freeze({ low: 0, medium: 1, high: 2, critical: 3 });
const RELATION_POINTS = Object.freeze({ correction: 4, standalone: 2, primary: 2, ambiguous: 1, attachment: 0 });
const RELATION_PREFERENCE = Object.freeze({ correction: 3, standalone: 2, primary: 2, ambiguous: 1, attachment: 0 });

const DETAIL_TYPE_BY_CODE = new Map(
  OPEN_DART_DISCLOSURE_DETAIL_TYPES.map((entry) => [entry.code, entry]),
);
const TITLE_PATTERNS = KR_DISCLOSURE_TITLE_RULES.map((rule) => Object.freeze({
  ...rule,
  regex: new RegExp(rule.pattern, rule.flags),
}));
const CATEGORY_RISK_PATTERNS = new Map(
  Object.entries(CATEGORY_CONFIG)
    .filter(([, config]) => config.riskEscalationPattern)
    .map(([category, config]) => [category, new RegExp(config.riskEscalationPattern, 'u')]),
);

const RELATION_WRAPPER_PATTERN = /^\s*(?:\[\s*(기재정정|첨부정정|첨부추가|추가첨부|정정|첨부서류|첨부)\s*\]|\(\s*(기재정정|첨부정정|첨부추가|추가첨부|정정|첨부서류|첨부)\s*\)|(기재정정|첨부정정|첨부추가|추가첨부|정정|첨부서류|첨부))(?:\s*[:·\-]?\s*)/u;
const REPORTING_PERIOD_PATTERN = /[\[(]\s*\d{4}\s*(?:[.\-/년]\s*\d{1,2})?(?:\s*(?:[.\-/월]\s*\d{1,2})?\s*일?)?\s*[\])]/gu;
const DATE_TOKEN_PATTERN = /\b\d{4}[.\-/]\d{1,2}(?:[.\-/]\d{1,2})?\b/gu;
const KEY_SECTION_PATTERN = /감사|의견|주요|핵심|위험|리스크|계약|거래정지|정리매매|상장폐지|소송|회생|파산|자본|증자|합병|분할|배당|지배구조|주주총회|이사회|의결권|결론|요약/u;

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeText(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).normalize('NFKC').replace(/\s+/g, ' ').trim();
  return normalized || null;
}

function normalizeDisplayText(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).replace(/\s+/g, ' ').trim();
  return normalized || null;
}

function normalizeCode(value) {
  return normalizeText(value)?.replace(/\s+/g, '') ?? null;
}

function normalizeReceiptDate(value) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const compact = normalized.replace(/[^0-9]/g, '');
  if (!/^\d{8}$/.test(compact)) return null;
  const year = Number(compact.slice(0, 4));
  const month = Number(compact.slice(4, 6));
  const day = Number(compact.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? compact
    : null;
}

function normalizePositiveInteger(value, fallback, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(maximum, Math.max(1, Math.round(parsed)));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function compareLexical(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareReceiptNo(left, right) {
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return compareLexical(left, right);
}

function codePointLength(value) {
  return [...String(value ?? '')].length;
}

function truncateCodePoints(value, limit) {
  if (limit <= 0) return '';
  const points = [...String(value ?? '')];
  return points.length <= limit ? points.join('') : points.slice(0, limit).join('');
}

function stableHash(parts) {
  return createHash('sha1').update(parts.map((part) => part ?? '').join('\u001f')).digest('hex').slice(0, 24);
}

function normalizeIdentityParts(reportName) {
  let identityName = normalizeText(reportName) ?? '';
  const wrapperKinds = [];
  let match = identityName.match(RELATION_WRAPPER_PATTERN);
  while (match) {
    wrapperKinds.push(match[1] ?? match[2] ?? match[3]);
    identityName = identityName.slice(match[0].length).trim();
    match = identityName.match(RELATION_WRAPPER_PATTERN);
  }

  const isAttachmentCorrection = wrapperKinds.includes('첨부정정');
  const isAttachment = isAttachmentCorrection
    || wrapperKinds.some((wrapper) => ['첨부추가', '추가첨부', '첨부서류', '첨부'].includes(wrapper));
  const isCorrection = isAttachmentCorrection
    || wrapperKinds.some((wrapper) => ['기재정정', '정정'].includes(wrapper));
  const relationKind = isAttachmentCorrection
    ? 'attachment_correction'
    : isAttachment
      ? 'attachment'
      : isCorrection
        ? 'correction'
        : 'primary';
  const normalizedIdentityName = identityName
    .replace(/\s+/g, ' ')
    .replace(/\(\s*/g, '(')
    .replace(/\s*\)/g, ')')
    .replace(/\[\s*/g, '[')
    .replace(/\s*\]/g, ']')
    .replace(/\s*([·,:;])\s*/g, '$1 ')
    .trim();
  const matchName = normalizedIdentityName
    .replace(REPORTING_PERIOD_PATTERN, ' ')
    .replace(DATE_TOKEN_PATTERN, ' ')
    .replace(/[()[\]{}·,:;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    identityName: normalizedIdentityName,
    matchName,
    isAttachment,
    isCorrection,
    relationKind,
    relationWrappers: wrapperKinds,
  };
}

export function normalizeDisclosureFiling(entry = {}) {
  const filing = asObject(entry);
  const reportName = normalizeDisplayText(filing.reportName ?? filing.report_nm) ?? '';
  const identity = normalizeIdentityParts(reportName);
  const rceptNo = normalizeText(filing.rceptNo ?? filing.rcept_no);
  const receiptDate = normalizeReceiptDate(filing.receiptDate ?? filing.rcept_dt ?? filing.reportDate);
  const corpCode = normalizeCode(filing.corpCode ?? filing.corp_code);
  const stockCodeCandidate = normalizeCode(filing.stockCode ?? filing.stock_code);
  const stockCode = stockCodeCandidate && /^\d{6}$/.test(stockCodeCandidate) ? stockCodeCandidate : null;
  const filerName = normalizeText(filing.filerName ?? filing.flr_nm);
  const disclosureType = normalizeText(filing.disclosureType ?? filing.pblntf_ty)?.toUpperCase() ?? null;
  const disclosureDetailType = normalizeText(filing.disclosureDetailType ?? filing.pblntfDetailTy ?? filing.pblntf_detail_ty)?.toUpperCase() ?? null;
  const detailTypeDefinition = disclosureDetailType ? DETAIL_TYPE_BY_CODE.get(disclosureDetailType) : null;
  const issuerIdentity = corpCode ? `corp:${corpCode}` : stockCode ? `stock:${stockCode}` : null;
  const canonicalKey = `dart:${stableHash([
    issuerIdentity,
    identity.identityName,
    filerName,
    receiptDate,
    reportName,
  ])}`;

  return {
    rceptNo,
    receiptDate,
    reportDate: receiptDate,
    reportName,
    normalizedReportName: identity.matchName,
    baseReportName: identity.identityName,
    matchName: identity.matchName,
    identityName: identity.identityName,
    corpCode,
    corpName: normalizeText(filing.corpName ?? filing.corp_name),
    stockCode,
    corpCls: normalizeText(filing.corpCls ?? filing.corp_cls),
    corpClsLabel: normalizeText(filing.corpClsLabel ?? filing.corp_cls_label),
    filerName,
    disclosureType,
    disclosureTypeLabel: normalizeText(filing.disclosureTypeLabel ?? filing.pblntf_ty_label)
      ?? OPEN_DART_DISCLOSURE_TYPES[disclosureType]
      ?? null,
    disclosureDetailType,
    disclosureDetailTypeLabel: normalizeText(filing.disclosureDetailTypeLabel ?? filing.pblntf_detail_ty_label)
      ?? detailTypeDefinition?.label
      ?? null,
    remarks: normalizeText(filing.remarks ?? filing.rm),
    documentUrl: normalizeText(filing.documentUrl),
    source: normalizeText(filing.source) ?? 'opendart-list',
    issuerIdentity,
    canonicalKey,
    isCorrection: identity.isCorrection,
    isAttachment: identity.isAttachment,
    relationKind: identity.relationKind,
    relationWrappers: identity.relationWrappers,
    relatedRceptNos: [],
    supersedesRceptNos: [],
  };
}

function addPatternCategories(text, prefix, categories, reasons) {
  let matchCount = 0;
  for (const rule of TITLE_PATTERNS) {
    if (rule.regex.test(text)) {
      categories.add(rule.category);
      reasons.push(`${prefix}_rule:${rule.id}`);
      matchCount += 1;
    }
  }
  return matchCount;
}

function resolveDetailCategory(disclosureType, disclosureDetailType) {
  if (!disclosureDetailType) return { category: null, recognized: false };
  const definition = DETAIL_TYPE_BY_CODE.get(disclosureDetailType);
  if (!definition) return { category: null, recognized: false, disclosureType, definition: null };
  return {
    category: definition.defaultCategory,
    recognized: true,
    disclosureType,
    definition,
    typeMismatch: Boolean(disclosureType && definition.type !== disclosureType),
  };
}

function broadTypeCategory(disclosureType) {
  return OPEN_DART_BROAD_TYPE_DEFAULTS[disclosureType] ?? null;
}

function maxRisk(...levels) {
  return levels.filter(Boolean).reduce(
    (highest, level) => (RISK_RANK[level] > RISK_RANK[highest] ? level : highest),
    'low',
  );
}

function categoryRisk(category, combinedText) {
  const baseRisk = CATEGORY_CONFIG[category]?.risk ?? 'low';
  const escalationPattern = CATEGORY_RISK_PATTERNS.get(category);
  return escalationPattern?.test(combinedText) ? 'high' : baseRisk;
}

function resolveDumpPolicy(categories) {
  if (categories.has('audit') || categories.has('periodic')) return 'key_sections';
  if ([...categories].some((category) => CATEGORY_CONFIG[category]?.dumpPolicy === 'full_text')) return 'full_text';
  if ([...categories].some((category) => CATEGORY_CONFIG[category]?.dumpPolicy === 'key_sections')) return 'key_sections';
  return 'metadata_only';
}

export function classifyDisclosureFiling(entry = {}) {
  const filing = entry?.canonicalKey ? { ...entry } : normalizeDisclosureFiling(entry);
  const titleText = filing.matchName ?? '';
  const remarksText = filing.remarks ?? '';
  const combinedText = `${titleText} ${remarksText}`.trim();
  const categories = new Set();
  const reasons = [];
  const riskMatch = matchKrDisclosureRiskKeywords(combinedText);

  if (riskMatch.matched && RISK_RANK[riskMatch.maxSeverity] >= RISK_RANK.high) {
    categories.add('high-risk');
    for (const group of riskMatch.groups) reasons.push(`risk_keyword:${group}`);
  }

  const titleRuleMatchCount = addPatternCategories(titleText, 'title', categories, reasons);
  const remarksRuleMatchCount = addPatternCategories(remarksText, 'remarks', categories, reasons);
  const semanticRuleMatchCount = titleRuleMatchCount + remarksRuleMatchCount;

  const detail = resolveDetailCategory(filing.disclosureType, filing.disclosureDetailType);
  let broadCategory = null;
  if (detail.recognized) {
    reasons.push(`detail_type:${detail.definition.code}:${detail.definition.mode}`);
    if (detail.typeMismatch) reasons.push(`detail_type_mismatch:${filing.disclosureType}:${detail.definition.type}`);
    if (detail.category) categories.add(detail.category);
  } else {
    broadCategory = broadTypeCategory(filing.disclosureType);
    if (broadCategory) {
      categories.add(broadCategory);
      reasons.push(`disclosure_type:${filing.disclosureType}:${broadCategory}`);
    } else if (filing.disclosureDetailType) {
      reasons.push(`unknown_detail_type:${filing.disclosureDetailType}`);
    }
  }

  const deterministicRiskMatch = riskMatch.matched
    && RISK_RANK[riskMatch.maxSeverity] >= RISK_RANK.high;
  const needsClassifier = detail.definition?.mode === 'title_required'
    ? semanticRuleMatchCount === 0 && !deterministicRiskMatch
    : !detail.recognized
      && !broadCategory
      && semanticRuleMatchCount === 0
      && !deterministicRiskMatch;

  if (categories.size === 0) {
    categories.add('other');
    reasons.push('fallback:other');
  }
  if (needsClassifier) reasons.push('review:ambiguous_classification');

  const baseCategories = CATEGORY_ORDER.filter((category) => categories.has(category));
  const primaryCategory = baseCategories[0] ?? 'other';
  const materialityScore = Math.max(...baseCategories.map((category) => CATEGORY_CONFIG[category].materiality));
  const materialityLevel = materialityScore >= 95
    ? 'critical'
    : materialityScore >= 75
      ? 'high'
      : materialityScore >= 50
        ? 'medium'
        : 'low';
  const categoryRiskLevels = baseCategories.map((category) => categoryRisk(category, combinedText));
  const riskLevel = maxRisk(riskMatch.maxSeverity, ...categoryRiskLevels);
  const compatibilityCategories = [
    ...(filing.isCorrection ? ['correction'] : []),
    ...(baseCategories.some((category) => [
      'legal-regulatory',
      'restructuring',
      'capital-change',
      'material-contract',
      'corporate-action',
      'earnings',
      'related-party',
    ].includes(category)) ? ['material-event'] : []),
  ];
  const relationReason = filing.relationKind === 'attachment_correction'
    ? 'relation:attachment_correction'
    : filing.isAttachment
      ? 'relation:attachment'
      : filing.isCorrection
        ? 'relation:correction'
        : null;

  return {
    ...filing,
    disclosureTypeLabel: filing.disclosureTypeLabel
      ?? OPEN_DART_DISCLOSURE_TYPES[filing.disclosureType]
      ?? null,
    disclosureDetailTypeLabel: filing.disclosureDetailTypeLabel
      ?? detail.definition?.label
      ?? null,
    categories: [...baseCategories, ...compatibilityCategories],
    primaryCategory,
    materialityScore,
    materialityLevel,
    riskLevel,
    riskLabel: riskLevel === 'critical'
      ? '치명적 리스크'
      : riskLevel === 'high'
        ? '중요 리스크'
        : riskLevel === 'medium'
          ? '확인 필요'
          : primaryCategory === 'ownership'
            ? '지분 변동'
            : '일반',
    dumpPolicy: resolveDumpPolicy(categories),
    classificationDatasetVersion: KR_DISCLOSURE_CLASSIFICATION_DATASET_VERSION,
    classificationConfidence: needsClassifier
      ? 'ambiguous'
      : detail.recognized || semanticRuleMatchCount > 0 || deterministicRiskMatch
        ? 'deterministic'
        : broadCategory
          ? 'broad'
          : 'fallback',
    needsClassifier,
    classificationReasons: unique([...reasons, relationReason]),
    riskKeywordGroups: riskMatch.groups,
    riskKeywords: riskMatch.keywords,
    riskKeywordSeverity: riskMatch.maxSeverity,
  };
}

function compareReceiptAscending(left, right) {
  const dateCompare = compareLexical(left.receiptDate ?? '99999999', right.receiptDate ?? '99999999');
  if (dateCompare !== 0) return dateCompare;
  const receiptCompare = compareReceiptNo(left.rceptNo, right.rceptNo);
  if (receiptCompare !== 0) return receiptCompare;
  return compareLexical(left.canonicalKey, right.canonicalKey);
}

function compareStableMetadata(left, right) {
  const receiptCompare = compareReceiptNo(left.rceptNo, right.rceptNo);
  if (receiptCompare !== 0) return receiptCompare;
  const keyCompare = compareLexical(left.canonicalKey, right.canonicalKey);
  if (keyCompare !== 0) return keyCompare;
  return compareLexical(JSON.stringify(left), JSON.stringify(right));
}

function recordRef(record) {
  return record.rceptNo ?? record.canonicalKey;
}

function collapseDuplicateReceipts(filings) {
  const byReceipt = new Map();
  const receiptless = [];
  const excluded = [];

  for (const filing of filings) {
    if (!filing.rceptNo) {
      receiptless.push(filing);
      continue;
    }
    const bucket = byReceipt.get(filing.rceptNo) ?? [];
    bucket.push(filing);
    byReceipt.set(filing.rceptNo, bucket);
  }

  const retained = [];
  for (const [rceptNo, bucket] of byReceipt.entries()) {
    const sorted = [...bucket].sort((left, right) => {
      const leftCompleteness = Object.values(left).filter((value) => value !== null && value !== '' && (!Array.isArray(value) || value.length > 0)).length;
      const rightCompleteness = Object.values(right).filter((value) => value !== null && value !== '' && (!Array.isArray(value) || value.length > 0)).length;
      return rightCompleteness - leftCompleteness || compareStableMetadata(left, right);
    });
    retained.push(sorted[0]);
    for (const duplicate of sorted.slice(1)) {
      excluded.push({
        rceptNo,
        canonicalKey: duplicate.canonicalKey,
        reasonCode: 'duplicate_receipt',
        reason: '동일 접수번호의 중복 행을 제거했습니다.',
      });
    }
  }

  return {
    retained: [...retained, ...receiptless].sort(compareStableMetadata),
    excluded: excluded.sort((left, right) => compareReceiptNo(left.rceptNo, right.rceptNo)),
  };
}

function relationshipIdentity(record) {
  if (!record.issuerIdentity || !record.filerName || !record.identityName) return null;
  return `${record.issuerIdentity}\u001f${record.filerName}\u001f${record.identityName}`;
}

function inferRelationships(records, duplicateExclusions) {
  const groupsByIdentity = new Map();
  const ungrouped = [];
  for (const record of records) {
    const identity = relationshipIdentity(record);
    if (!identity) {
      ungrouped.push(record);
      continue;
    }
    const group = groupsByIdentity.get(identity) ?? [];
    group.push(record);
    groupsByIdentity.set(identity, group);
  }

  const classified = records.map((record) => ({ ...record }));
  const byRef = new Map(classified.map((record) => [recordRef(record), record]));
  const excluded = [...duplicateExclusions];
  const excludedRefs = new Set();
  const groups = [];

  function exclude(record, reasonCode, reason) {
    const ref = recordRef(record);
    if (excludedRefs.has(ref)) return;
    excludedRefs.add(ref);
    excluded.push({
      ...record,
      reasonCode,
      reason,
    });
  }

  for (const members of groupsByIdentity.values()) {
    const sorted = [...members].sort(compareReceiptAscending);
    const originals = sorted.filter((record) => !record.isCorrection && !record.isAttachment);
    const corrections = sorted.filter((record) => record.isCorrection && !record.isAttachment);
    const attachments = sorted.filter((record) => record.isAttachment);
    const uniquePrimary = originals.length === 1;

    if (uniquePrimary) {
      const original = originals[0];
      const relatedCorrections = corrections
        .filter((record) => compareReceiptAscending(original, record) < 0)
        .sort(compareReceiptAscending);
      const standaloneCorrections = corrections
        .filter((record) => compareReceiptAscending(original, record) >= 0)
        .sort(compareReceiptAscending);
      const chain = [original, ...relatedCorrections];
      const representativeSource = chain.at(-1);
      const representative = byRef.get(recordRef(representativeSource));
      const related = [...chain.slice(0, -1), ...attachments].sort(compareReceiptAscending);
      representative.relationState = representative.isCorrection ? 'correction' : 'primary';
      representative.supersedesRceptNos = chain.slice(0, -1).map((record) => record.rceptNo).filter(Boolean);
      representative.relatedRceptNos = related.map((record) => record.rceptNo).filter(Boolean);

      for (const prior of chain.slice(0, -1)) {
        const target = byRef.get(recordRef(prior));
        target.relationState = target.isCorrection ? 'correction' : 'primary';
        target.relatedRceptNos = unique([representative.rceptNo, ...representative.relatedRceptNos].filter((rceptNo) => rceptNo !== target.rceptNo));
        exclude(target, 'superseded_original', '최신 정정 공시가 동일 사건의 대표 공시로 선택되었습니다.');
      }

      for (const attachmentSource of attachments) {
        const attachment = byRef.get(recordRef(attachmentSource));
        attachment.relationState = 'attachment';
        attachment.relatedRceptNos = unique([representative.rceptNo, ...representative.supersedesRceptNos]);
        exclude(attachment, 'related_attachment', '대표 공시에 연결된 첨부 공시는 별도 선택하지 않습니다.');
      }

      groups.push({
        canonicalKey: representative.canonicalKey,
        representativeRceptNo: representative.rceptNo,
        memberRceptNos: [...chain, ...attachments].sort(compareReceiptAscending).map((record) => record.rceptNo).filter(Boolean),
        relatedRceptNos: representative.relatedRceptNos,
        relationState: representative.relationState,
      });

      for (const standaloneSource of standaloneCorrections) {
        const standalone = byRef.get(recordRef(standaloneSource));
        standalone.relationState = 'correction';
        standalone.relationshipReasons = ['correction_precedes_primary'];
        groups.push({
          canonicalKey: standalone.canonicalKey,
          representativeRceptNo: standalone.rceptNo,
          memberRceptNos: standalone.rceptNo ? [standalone.rceptNo] : [],
          relatedRceptNos: [],
          relationState: standalone.relationState,
          reasonCode: 'correction_precedes_primary',
        });
      }
      continue;
    }

    const ambiguous = originals.length > 1 && (corrections.length > 0 || attachments.length > 0)
      || originals.length === 0 && corrections.length > 1;
    for (const source of sorted) {
      const target = byRef.get(recordRef(source));
      target.relationState = ambiguous
        ? 'ambiguous'
        : target.isAttachment
          ? 'attachment'
          : target.isCorrection
            ? 'correction'
            : 'standalone';
      if (ambiguous) {
        target.relationshipReasons = ['possible_relation_ambiguous'];
      }
      groups.push({
        canonicalKey: target.canonicalKey,
        representativeRceptNo: target.rceptNo,
        memberRceptNos: target.rceptNo ? [target.rceptNo] : [],
        relatedRceptNos: [],
        relationState: target.relationState,
        ...(ambiguous ? { reasonCode: 'possible_relation_ambiguous' } : {}),
      });
    }
  }

  for (const source of ungrouped) {
    const target = byRef.get(recordRef(source));
    target.relationState = target.isAttachment
      ? 'attachment'
      : target.isCorrection
        ? 'correction'
        : 'standalone';
    groups.push({
      canonicalKey: target.canonicalKey,
      representativeRceptNo: target.rceptNo,
      memberRceptNos: target.rceptNo ? [target.rceptNo] : [],
      relatedRceptNos: [],
      relationState: target.relationState,
    });
  }

  return {
    classified: classified.sort(compareStableMetadata),
    eligible: classified.filter((record) => !excludedRefs.has(recordRef(record))),
    relationships: {
      groups: groups.sort((left, right) => compareLexical(left.representativeRceptNo ?? left.canonicalKey, right.representativeRceptNo ?? right.canonicalKey)),
      excluded: excluded.sort((left, right) => compareLexical(left.rceptNo ?? left.canonicalKey, right.rceptNo ?? right.canonicalKey)),
    },
  };
}

function resolveAsOf(source, options, records) {
  const requested = asObject(source.requested);
  return normalizeReceiptDate(requested.to)
    ?? normalizeReceiptDate(options.selectedAt)
    ?? normalizeReceiptDate(asObject(options.sourceContext).appliedAt)
    ?? records.map((record) => record.receiptDate).filter(Boolean).sort().at(-1)
    ?? null;
}

function calendarDistanceInDays(asOf, receiptDate) {
  if (!asOf || !receiptDate) return null;
  const asOfTime = Date.UTC(Number(asOf.slice(0, 4)), Number(asOf.slice(4, 6)) - 1, Number(asOf.slice(6, 8)));
  const receiptTime = Date.UTC(Number(receiptDate.slice(0, 4)), Number(receiptDate.slice(4, 6)) - 1, Number(receiptDate.slice(6, 8)));
  return Math.floor((asOfTime - receiptTime) / 86_400_000);
}

function relationScoreKey(record) {
  if (record.relationState === 'ambiguous') return 'ambiguous';
  if (record.isAttachment) return 'attachment';
  if (record.isCorrection && record.supersedesRceptNos.length > 0) return 'correction';
  return record.relationState === 'primary' ? 'primary' : 'standalone';
}

function scoreRecord(record, asOf, diversity = 0) {
  const days = calendarDistanceInDays(asOf, record.receiptDate);
  const freshness = days === null ? 0 : Math.max(0, 30 - Math.min(30, Math.max(0, days)));
  const relationKey = relationScoreKey(record);
  const materiality = record.materialityScore;
  const risk = RISK_POINTS[record.riskLevel] ?? 0;
  const finality = RELATION_POINTS[relationKey] ?? 0;
  return {
    tier: CATEGORY_CONFIG[record.primaryCategory]?.tier ?? 5,
    scoreBreakdown: {
      materiality,
      risk,
      correctionFinality: finality,
      freshness,
      diversity,
      effectiveScore: materiality + risk + finality + freshness + diversity,
      freshnessDays: days,
      asOf,
    },
    relationPreference: RELATION_PREFERENCE[relationKey] ?? 0,
  };
}

function compareScored(left, right) {
  if (left.tier !== right.tier) return left.tier - right.tier;
  if (left.scoreBreakdown.effectiveScore !== right.scoreBreakdown.effectiveScore) {
    return right.scoreBreakdown.effectiveScore - left.scoreBreakdown.effectiveScore;
  }
  const dateCompare = compareLexical(right.receiptDate ?? '00000000', left.receiptDate ?? '00000000');
  if (dateCompare !== 0) return dateCompare;
  if (left.relationPreference !== right.relationPreference) return right.relationPreference - left.relationPreference;
  const receiptCompare = compareReceiptNo(left.rceptNo, right.rceptNo);
  if (receiptCompare !== 0) return receiptCompare;
  return compareLexical(left.canonicalKey, right.canonicalKey);
}

function buildSelectionReasonCodes(record) {
  const codes = [];
  if (record.tier === 0) codes.push('critical_priority');
  codes.push('materiality_rank');
  if (RISK_RANK[record.riskLevel] >= RISK_RANK.medium) codes.push('risk_signal');
  if (record.isCorrection && record.supersedesRceptNos.length > 0) codes.push('latest_correction');
  codes.push(record.scoreBreakdown.freshnessDays === null ? 'freshness_unavailable' : 'freshness');
  if (record.scoreBreakdown.diversity > 0) codes.push('category_diversity');
  codes.push('stable_tiebreak');
  return codes;
}

function humanSelectionReason(record) {
  return `${record.primaryCategory} 중요도 ${record.materialityScore}, ${record.riskLevel} 위험도, tier ${record.tier} 기준으로 선택했습니다.`;
}

function selectRecords(eligible, relationshipExclusions, source, options) {
  const selectionLimit = normalizePositiveInteger(options.selectionLimit, DEFAULT_SELECTION_LIMIT, MAX_SELECTION_LIMIT);
  const asOf = resolveAsOf(source, options, eligible);
  const base = eligible.map((record) => ({ ...record, ...scoreRecord(record, asOf) }));
  const selected = [];
  const excluded = relationshipExclusions.map((record) => {
    const original = record.primaryCategory
      ? record
      : record.rceptNo
        ? eligible.find((entry) => entry.rceptNo === record.rceptNo)
        : null;
    const scored = original ? scoreRecord(original, asOf) : {
      tier: null,
      scoreBreakdown: null,
      relationPreference: null,
    };
    return { ...record, ...scored };
  });

  for (let tier = 0; tier <= 5; tier += 1) {
    let tierRecords = base.filter((record) => record.tier === tier);
    const selectedCategories = new Set();
    while (tierRecords.length > 0) {
      const rescored = tierRecords.map((record) => ({
        ...record,
        ...scoreRecord(record, asOf, tier > 0 && !selectedCategories.has(record.primaryCategory) ? 6 : 0),
      })).sort(compareScored);
      const next = rescored[0];
      tierRecords = tierRecords.filter((record) => recordRef(record) !== recordRef(next));

      if (selected.length < selectionLimit) {
        const selectionReasonCodes = buildSelectionReasonCodes(next);
        selected.push({
          ...next,
          selectionRank: selected.length + 1,
          selectionReasonCodes,
          selectionReason: humanSelectionReason(next),
        });
        selectedCategories.add(next.primaryCategory);
      } else {
        const reasonCode = tier === 0 ? 'critical_overflow' : 'selection_limit';
        excluded.push({
          ...next,
          reasonCode,
          reason: reasonCode === 'critical_overflow'
            ? '중대 공시가 메타데이터 선택 한도를 초과했습니다.'
            : '메타데이터 선택 한도를 초과했습니다.',
        });
      }
    }
  }

  const criticalOverflowCount = excluded.filter((record) => record.reasonCode === 'critical_overflow').length;
  return {
    asOf,
    selectionLimit,
    criticalOverflowCount,
    selectionState: criticalOverflowCount > 0 ? 'truncated_critical' : 'complete',
    selected,
    excluded: excluded.sort((left, right) => {
      const leftTier = Number.isFinite(left.tier) ? left.tier : 99;
      const rightTier = Number.isFinite(right.tier) ? right.tier : 99;
      return leftTier - rightTier || compareLexical(left.rceptNo ?? left.canonicalKey, right.rceptNo ?? right.canonicalKey);
    }),
  };
}

function normalizeCategoryCounts(filings) {
  return filings.reduce((counts, filing) => {
    for (const category of filing.categories ?? []) {
      counts[category] = (counts[category] ?? 0) + 1;
    }
    return counts;
  }, {});
}

function countByReportName(filings) {
  const counts = new Map();
  for (const filing of filings) {
    const key = filing.identityName || filing.reportName || '기타 공시';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reportName, count]) => ({ reportName, count }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 8);
}

function eventDirection(filing) {
  const text = `${filing.matchName ?? ''} ${filing.remarks ?? ''}`;
  const categories = filing.categories ?? [];
  if (categories.some((category) => ['audit', 'trading-status', 'legal-regulatory', 'insolvency'].includes(category))) return 'negative';
  if (categories.includes('material-contract')) return /계약해지/u.test(text) ? 'negative' : 'positive';
  if (categories.some((category) => ['restructuring', 'capital-change', 'corporate-action'].includes(category))) return 'mixed';
  if (categories.includes('ownership')) return 'neutral';
  return 'unknown';
}

function eventVerificationCategory(filing) {
  return (filing.categories ?? []).find((category) => [
    'audit',
    'trading-status',
    'legal-regulatory',
    'insolvency',
    'restructuring',
    'capital-change',
    'material-contract',
    'corporate-action',
    'ownership',
  ].includes(category)) ?? filing.primaryCategory;
}

function verificationConditions(category) {
  const conditions = {
    'material-contract': ['계약 금액·상대방 확인', '계약 기간·조건 확인', '해지·변경 조건 확인'],
    'capital-change': ['발행 조건 확인', '희석 효과 확인', '납입일 확인'],
    'legal-regulatory': ['청구·제재 내용 확인', '절차 단계 확인', '회사 대응 확인'],
    'trading-status': ['거래정지 사유 확인', '적용 기간 확인'],
    audit: ['감사의견 확인', '의견 근거 확인', '계속기업 문단 확인'],
    insolvency: ['법원·채무 내용 확인', '절차 단계 확인'],
    restructuring: ['거래 조건 확인', '효력 발생일 확인', '승인 조건 확인'],
    ownership: ['변동 주체 확인', '수량·비율 확인'],
  };
  return conditions[category] ?? ['원문에서 주요 조건 확인'];
}

function buildMaterialEvent(filing) {
  const observedFact = [filing.reportName, filing.remarks].filter(Boolean).join(' · ');
  const hasObservedFact = Boolean(observedFact);
  return {
    rceptNo: filing.rceptNo,
    receiptDate: filing.receiptDate,
    reportName: filing.reportName,
    filerName: filing.filerName,
    documentUrl: filing.documentUrl,
    eventType: filing.primaryCategory,
    materialityLevel: filing.materialityLevel,
    riskLevel: filing.riskLevel,
    keyFact: hasObservedFact ? truncateCodePoints(observedFact, 240) : null,
    impactDirection: hasObservedFact ? eventDirection(filing) : 'unknown',
    verificationConditions: verificationConditions(eventVerificationCategory(filing)).slice(0, 3),
    evidenceScope: hasObservedFact ? 'filing_metadata' : 'unavailable',
    evidenceRefs: [filing.rceptNo ? `opendart:${filing.rceptNo}` : `opendart:${filing.canonicalKey}`],
    reasonCodes: filing.classificationReasons,
    analysisState: hasObservedFact ? 'metadata_only' : 'unanalysable',
  };
}

function buildAnalysis(collection, selection, source) {
  const selected = selection.selected;
  const categoryCounts = normalizeCategoryCounts(selected);
  const providerTotalCount = collection.providerTotalCount;
  const latestFilings = [...selected]
    .sort((left, right) => compareLexical(right.receiptDate ?? '00000000', left.receiptDate ?? '00000000')
      || compareReceiptNo(left.rceptNo, right.rceptNo))
    .slice(0, 8);
  const materialEvents = selected.filter((filing) => filing.materialityScore >= 50).map(buildMaterialEvent);
  const risks = selected
    .filter((filing) => RISK_RANK[filing.riskLevel] >= RISK_RANK.medium)
    .map((filing) => ({
      rceptNo: filing.rceptNo,
      reportName: filing.reportName,
      riskLevel: filing.riskLevel,
      riskLabel: filing.riskLabel,
      categories: filing.categories,
      evidenceScope: filing.reportName || filing.remarks ? 'filing_metadata' : 'unavailable',
      evidenceRefs: [filing.rceptNo ? `opendart:${filing.rceptNo}` : `opendart:${filing.canonicalKey}`],
      reasonCodes: filing.classificationReasons,
    }));
  const available = collection.state !== 'unavailable';
  const state = !available
    ? 'unavailable'
    : collection.state === 'empty'
      ? 'empty'
      : collection.state === 'truncated' || selection.criticalOverflowCount > 0
        ? 'truncated'
        : 'complete';
  const summary = {
    providerTotalCount,
    collectedCount: collection.collectedCount,
    canonicalRecordCount: collection.canonicalRecordCount,
    relationshipGroupCount: collection.relationshipGroupCount,
    selectionEligibleCount: collection.selectionEligibleCount,
    selectedCount: selected.length,
    criticalOverflowCount: selection.criticalOverflowCount,
    categoryCounts,
    riskCount: selected.filter((filing) => ['critical', 'high'].includes(filing.riskLevel)).length,
    mediumRiskCount: selected.filter((filing) => filing.riskLevel === 'medium').length,
    ambiguousCount: selected.filter((filing) => filing.needsClassifier).length,
  };

  return {
    state,
    available,
    source: normalizeText(source.source) ?? 'opendart',
    periodFrom: normalizeReceiptDate(asObject(source.requested).from),
    periodTo: normalizeReceiptDate(asObject(source.requested).to),
    asOf: selection.asOf,
    latestReceiptDate: latestFilings[0]?.receiptDate ?? null,
    totalCount: providerTotalCount,
    count: selected.length,
    filings: selected,
    selectedFilings: selected,
    latestFilings,
    topReportTypes: countByReportName(selected),
    riskCount: summary.riskCount,
    mediumRiskCount: summary.mediumRiskCount,
    ambiguousCount: summary.ambiguousCount,
    correctionCount: categoryCounts.correction ?? 0,
    dilutionCount: categoryCounts['capital-change'] ?? 0,
    ownershipCount: categoryCounts.ownership ?? 0,
    periodicReportCount: categoryCounts.periodic ?? 0,
    materialEventCount: categoryCounts['material-event'] ?? 0,
    categoryCounts,
    materialEvents,
    risks,
    summary,
  };
}

function buildCollection(source, collectedCount, canonicalRecordCount, relationshipGroupCount, selectionEligibleCount) {
  const summary = asObject(source.summary);
  const explicit = asObject(source.collection);
  const providerTotal = Number(explicit.providerTotalCount ?? summary.totalCount ?? summary.total_count);
  const providerTotalCount = Number.isFinite(providerTotal) ? providerTotal : collectedCount;
  const pageCountFetchedValue = Number(explicit.pageCountFetched ?? (collectedCount >= 0 ? 1 : 0));
  const pageCountFetched = Number.isFinite(pageCountFetchedValue) ? pageCountFetchedValue : 1;
  const hasMore = Boolean(explicit.hasMore ?? summary.hasMore);
  const truncated = Boolean(explicit.truncated ?? hasMore);
  const state = explicit.state
    ?? (explicit.unavailable ? 'unavailable' : collectedCount === 0 ? 'empty' : truncated ? 'truncated' : 'complete');
  return {
    state,
    requested: sanitizeForJson(asObject(source.requested)),
    providerTotalCount,
    collectedCount,
    canonicalRecordCount,
    relationshipGroupCount,
    selectionEligibleCount,
    pageCountFetched,
    hasMore,
    truncated,
    maxCollectedFilings: explicit.maxCollectedFilings ?? null,
    issues: Array.isArray(explicit.issues) ? sanitizeForJson(explicit.issues) : [],
  };
}

export function createUnavailableKrDisclosurePipeline({ requested = {}, issue = null } = {}) {
  const collection = {
    state: 'unavailable',
    requested: sanitizeForJson(requested),
    providerTotalCount: 0,
    collectedCount: 0,
    canonicalRecordCount: 0,
    relationshipGroupCount: 0,
    selectionEligibleCount: 0,
    pageCountFetched: 0,
    hasMore: false,
    truncated: false,
    maxCollectedFilings: null,
    issues: issue ? [sanitizeForJson(issue)] : [],
  };
  const selection = { asOf: normalizeReceiptDate(requested.to), criticalOverflowCount: 0, selected: [] };
  return {
    schemaVersion: KR_DISCLOSURE_PIPELINE_SCHEMA_VERSION,
    classificationDatasetVersion: KR_DISCLOSURE_CLASSIFICATION_DATASET_VERSION,
    collection,
    collected: [],
    classified: [],
    relationships: { groups: [], excluded: [] },
    selected: [],
    excluded: [],
    analysis: buildAnalysis(collection, selection, { requested, source: 'opendart' }),
    llmDump: {
      ...createDisabledKrDisclosureDump(),
      state: 'unavailable',
    },
  };
}

export function buildKrDisclosurePipeline(rawSource = {}, options = {}) {
  const source = Array.isArray(rawSource) ? { filings: rawSource } : asObject(rawSource);
  const rawFilings = Array.isArray(source.filings)
    ? source.filings
    : Array.isArray(source.list)
      ? source.list
      : [];
  const normalized = rawFilings.map(normalizeDisclosureFiling);
  const collapsed = collapseDuplicateReceipts(normalized);
  const classifiedInput = collapsed.retained.map(classifyDisclosureFiling);
  const relation = inferRelationships(classifiedInput, collapsed.excluded);
  const provisionalCollection = buildCollection(
    source,
    rawFilings.length,
    relation.classified.length,
    relation.relationships.groups.length,
    relation.eligible.length,
  );
  const selection = selectRecords(relation.eligible, relation.relationships.excluded, source, options);
  const collection = {
    ...provisionalCollection,
    selectionLimit: selection.selectionLimit,
    selectionState: selection.selectionState,
  };
  const analysis = buildAnalysis(collection, selection, source);

  return {
    schemaVersion: KR_DISCLOSURE_PIPELINE_SCHEMA_VERSION,
    classificationDatasetVersion: KR_DISCLOSURE_CLASSIFICATION_DATASET_VERSION,
    collection,
    collected: relation.classified.map((record) => {
      const {
        categories: _categories,
        primaryCategory: _primaryCategory,
        materialityScore: _materialityScore,
        materialityLevel: _materialityLevel,
        riskLevel: _riskLevel,
        riskLabel: _riskLabel,
        dumpPolicy: _dumpPolicy,
        classificationDatasetVersion: _classificationDatasetVersion,
        classificationConfidence: _classificationConfidence,
        needsClassifier: _needsClassifier,
        classificationReasons: _classificationReasons,
        riskKeywordGroups: _riskKeywordGroups,
        riskKeywords: _riskKeywords,
        riskKeywordSeverity: _riskKeywordSeverity,
        ...metadata
      } = record;
      return metadata;
    }),
    classified: relation.classified,
    relationships: relation.relationships,
    selected: selection.selected,
    excluded: selection.excluded,
    analysis,
    llmDump: createDisabledKrDisclosureDump(selection.selected),
  };
}

export function createDisabledKrDisclosureDump(selectedFilings = []) {
  const selected = Array.isArray(selectedFilings) ? selectedFilings : [];
  const excluded = selected.map((filing) => ({
    rceptNo: filing.rceptNo ?? null,
    canonicalKey: filing.canonicalKey ?? null,
    reportName: filing.reportName ?? '',
    receiptDate: filing.receiptDate ?? null,
    reason: 'not_requested',
    reasonCode: 'dump_disabled',
  }));
  return {
    state: 'disabled',
    available: false,
    source: 'opendart-document',
    policy: 'selected_materiality_with_key_section_fallback',
    policyConfig: null,
    maxCharsPerFiling: DEFAULT_MAX_CHARS_PER_FILING,
    maxTotalChars: DEFAULT_MAX_TOTAL_CHARS,
    limit: DEFAULT_DOCUMENT_LIMIT,
    fetchLimit: DEFAULT_DOCUMENT_LIMIT,
    fetchedCount: 0,
    includedCount: 0,
    failedCount: 0,
    policyExcludedCount: 0,
    budgetExcludedCount: 0,
    skippedCount: excluded.length,
    skippedTooLongCount: 0,
    skippedUnavailableCount: 0,
    extractedLongCount: 0,
    totalCharCount: 0,
    combinedCharCount: 0,
    included: [],
    excluded,
    filings: [],
    skipped: excluded,
    combinedText: '',
  };
}

function extractKeySections(text, limit) {
  const source = String(text ?? '').replace(/\r\n?/g, '\n').trim();
  if (codePointLength(source) <= limit) return source;
  const points = [...source];
  const matches = [];
  const regex = new RegExp(KEY_SECTION_PATTERN.source, 'gu');
  let match;
  while ((match = regex.exec(source)) && matches.length < 12) {
    matches.push([...source.slice(0, match.index)].length);
  }

  if (matches.length === 0) {
    const headLength = Math.max(1, Math.floor((limit - 5) * 0.65));
    const tailLength = Math.max(0, limit - headLength - 5);
    return truncateCodePoints(`${points.slice(0, headLength).join('')}\n…\n${points.slice(-tailLength).join('')}`, limit);
  }

  const separator = '\n…\n';
  const separatorLength = codePointLength(separator);
  const perWindow = Math.max(24, Math.floor((limit - separatorLength * (matches.length - 1)) / matches.length));
  const windows = [];
  for (const position of matches) {
    const start = Math.max(0, position - Math.floor(perWindow * 0.25));
    const end = Math.min(points.length, start + perWindow);
    if (windows.some(([existingStart, existingEnd]) => start <= existingEnd && end >= existingStart)) continue;
    windows.push([start, end]);
  }
  const excerpt = windows.map(([start, end]) => points.slice(start, end).join('')).join(separator);
  return truncateCodePoints(excerpt, limit);
}

function normalizeDocumentResult(entry) {
  const result = asObject(entry);
  const document = asObject(result.document);
  const error = result.error ? sanitizeForJson(result.error) : null;
  return {
    rceptNo: normalizeText(result.rceptNo ?? document.rceptNo),
    document: document.text !== undefined
      ? {
          text: String(document.text ?? ''),
          charCount: Number.isFinite(Number(document.charCount)) ? Number(document.charCount) : codePointLength(document.text),
          wordishCount: Number.isFinite(Number(document.wordishCount)) ? Number(document.wordishCount) : String(document.text ?? '').split(/\s+/).filter(Boolean).length,
          fileCount: Number.isFinite(Number(document.fileCount)) ? Number(document.fileCount) : null,
          documentBytes: Number.isFinite(Number(document.documentBytes)) ? Number(document.documentBytes) : null,
        }
      : null,
    error,
  };
}

function classifyDocumentError(error) {
  const code = normalizeText(error?.code) ?? '';
  if (/resource|limit|too_large|archive/i.test(code)) return 'resource_limited';
  if (/extract|xml|zip|document_format|decode/i.test(code)) return 'extraction_failed';
  return 'fetch_failed';
}

function buildDumpHeader(filing, index, textCharCount) {
  return `[${index}] ${filing.receiptDate ?? 'date-unknown'} · ${filing.reportName || '제목 없음'}${filing.filerName ? ` · 제출:${filing.filerName}` : ''} · ${filing.rceptNo ?? filing.canonicalKey} · ${textCharCount}자`;
}

export function buildKrDisclosureLlmDump(selectedFilings = [], documentResults = [], options = {}) {
  const selected = Array.isArray(selectedFilings) ? selectedFilings : [];
  if (options.enabled === false) return createDisabledKrDisclosureDump(selected);
  const maxCharsPerFiling = normalizePositiveInteger(options.maxCharsPerFiling, DEFAULT_MAX_CHARS_PER_FILING, 500_000);
  const maxTotalChars = normalizePositiveInteger(options.maxTotalChars, DEFAULT_MAX_TOTAL_CHARS, 500_000);
  const limit = normalizePositiveInteger(options.limit ?? options.fetchLimit, DEFAULT_DOCUMENT_LIMIT, 100);
  const normalizedResults = (Array.isArray(documentResults) ? documentResults : []).map(normalizeDocumentResult);
  const resultByReceipt = new Map(normalizedResults.filter((entry) => entry.rceptNo).map((entry) => [entry.rceptNo, entry]));
  const included = [];
  const filings = [];
  const excluded = [];
  const combinedParts = [];
  let totalCharCount = 0;
  let extractedLongCount = 0;
  let eligibleIndex = 0;

  for (const filing of selected) {
    if (filing.dumpPolicy === 'metadata_only') {
      excluded.push({
        rceptNo: filing.rceptNo,
        canonicalKey: filing.canonicalKey,
        reportName: filing.reportName,
        receiptDate: filing.receiptDate,
        reason: 'metadata_only_policy',
        reasonCode: 'metadata_only_policy',
      });
      continue;
    }

    eligibleIndex += 1;
    if (eligibleIndex > limit) {
      excluded.push({
        rceptNo: filing.rceptNo,
        canonicalKey: filing.canonicalKey,
        reportName: filing.reportName,
        receiptDate: filing.receiptDate,
        reason: 'budget_excluded',
        reasonCode: 'document_limit',
      });
      continue;
    }

    const result = filing.rceptNo ? resultByReceipt.get(filing.rceptNo) : null;
    if (!result?.document) {
      const reason = classifyDocumentError(result?.error);
      excluded.push({
        rceptNo: filing.rceptNo,
        canonicalKey: filing.canonicalKey,
        reportName: filing.reportName,
        receiptDate: filing.receiptDate,
        reason,
        reasonCode: reason,
        ...(result?.error ? { error: result.error } : {}),
      });
      continue;
    }

    const sourceText = result.document.text.replace(/\r\n?/g, '\n').trim();
    if (!sourceText) {
      excluded.push({
        rceptNo: filing.rceptNo,
        canonicalKey: filing.canonicalKey,
        reportName: filing.reportName,
        receiptDate: filing.receiptDate,
        reason: 'extraction_failed',
        reasonCode: 'empty_document_text',
      });
      continue;
    }

    const sourceCharCount = codePointLength(sourceText);
    const needsKeySections = filing.dumpPolicy === 'key_sections' || sourceCharCount > maxCharsPerFiling;
    const appliedPolicy = needsKeySections ? 'key_sections' : 'full_text';
    let text = needsKeySections
      ? extractKeySections(sourceText, maxCharsPerFiling)
      : truncateCodePoints(sourceText, maxCharsPerFiling);
    const separator = combinedParts.length > 0 ? '\n\n---\n\n' : '';
    const provisionalHeader = buildDumpHeader(filing, filings.length + 1, codePointLength(text));
    const overhead = codePointLength(separator) + codePointLength(provisionalHeader) + 1;
    const used = codePointLength(combinedParts.join(''));
    const remainingForText = maxTotalChars - used - overhead;
    if (remainingForText <= 0) {
      excluded.push({
        rceptNo: filing.rceptNo,
        canonicalKey: filing.canonicalKey,
        reportName: filing.reportName,
        receiptDate: filing.receiptDate,
        reason: 'budget_excluded',
        reasonCode: 'total_char_budget',
      });
      continue;
    }
    text = truncateCodePoints(text, remainingForText);
    if (!text) {
      excluded.push({
        rceptNo: filing.rceptNo,
        canonicalKey: filing.canonicalKey,
        reportName: filing.reportName,
        receiptDate: filing.receiptDate,
        reason: 'budget_excluded',
        reasonCode: 'total_char_budget',
      });
      continue;
    }

    const textCharCount = codePointLength(text);
    const header = buildDumpHeader(filing, filings.length + 1, textCharCount);
    const block = `${separator}${header}\n${text}`;
    if (used + codePointLength(block) > maxTotalChars) {
      const exactRemaining = Math.max(0, maxTotalChars - used - codePointLength(separator) - codePointLength(header) - 1);
      text = truncateCodePoints(text, exactRemaining);
    }
    if (!text) {
      excluded.push({
        rceptNo: filing.rceptNo,
        canonicalKey: filing.canonicalKey,
        reportName: filing.reportName,
        receiptDate: filing.receiptDate,
        reason: 'budget_excluded',
        reasonCode: 'total_char_budget',
      });
      continue;
    }

    let finalTextCharCount = codePointLength(text);
    let finalHeader = buildDumpHeader(filing, filings.length + 1, finalTextCharCount);
    let finalBlock = `${separator}${finalHeader}\n${text}`;
    while (used + codePointLength(finalBlock) > maxTotalChars && text) {
      const overflow = used + codePointLength(finalBlock) - maxTotalChars;
      text = truncateCodePoints(text, Math.max(0, codePointLength(text) - overflow));
      finalTextCharCount = codePointLength(text);
      finalHeader = buildDumpHeader(filing, filings.length + 1, finalTextCharCount);
      finalBlock = `${separator}${finalHeader}\n${text}`;
    }
    if (!text) {
      excluded.push({
        rceptNo: filing.rceptNo,
        canonicalKey: filing.canonicalKey,
        reportName: filing.reportName,
        receiptDate: filing.receiptDate,
        reason: 'budget_excluded',
        reasonCode: 'total_char_budget',
      });
      continue;
    }
    combinedParts.push(finalBlock);
    totalCharCount += finalTextCharCount;
    if (sourceCharCount > maxCharsPerFiling && appliedPolicy === 'key_sections') extractedLongCount += 1;
    const metadata = {
      rceptNo: filing.rceptNo,
      canonicalKey: filing.canonicalKey,
      reportName: filing.reportName,
      receiptDate: filing.receiptDate,
      filerName: filing.filerName,
      documentUrl: filing.documentUrl,
      primaryCategory: filing.primaryCategory,
      materialityLevel: filing.materialityLevel,
      riskLevel: filing.riskLevel,
      requestedPolicy: filing.dumpPolicy,
      appliedPolicy,
      sourceCharCount,
      charCount: finalTextCharCount,
      wordishCount: result.document.wordishCount,
      evidenceScope: 'document_excerpt',
      evidenceRefs: [filing.rceptNo ? `opendart:${filing.rceptNo}` : `opendart:${filing.canonicalKey}`],
    };
    included.push(metadata);
    filings.push({ ...metadata, text });
  }

  const combinedText = combinedParts.join('');
  const failedCount = excluded.filter((entry) => ['fetch_failed', 'extraction_failed', 'resource_limited'].includes(entry.reason)).length;
  const policyExcludedCount = excluded.filter((entry) => entry.reason === 'metadata_only_policy').length;
  const budgetExcludedCount = excluded.filter((entry) => entry.reason === 'budget_excluded').length;
  const eligibleCount = selected.filter((filing) => filing.dumpPolicy !== 'metadata_only').length;
  const state = included.length > 0
    ? failedCount > 0 || budgetExcludedCount > 0 ? 'partial' : 'complete'
    : eligibleCount === 0
      ? 'metadata_only'
      : failedCount > 0
        ? 'unavailable'
        : budgetExcludedCount > 0
          ? 'partial'
          : 'metadata_only';

  return {
    state,
    available: Boolean(combinedText),
    source: 'opendart-document',
    policy: 'selected_materiality_with_key_section_fallback',
    policyConfig: {
      maxCharsPerFiling,
      maxTotalChars,
      documentLimit: limit,
      selectionOrder: 'canonical_selection_rank',
      longDocumentPolicy: 'key_sections',
    },
    maxCharsPerFiling,
    maxTotalChars,
    limit,
    fetchLimit: limit,
    fetchedCount: Math.min(eligibleCount, limit),
    includedCount: included.length,
    failedCount,
    policyExcludedCount,
    budgetExcludedCount,
    skippedCount: excluded.length,
    skippedTooLongCount: 0,
    skippedUnavailableCount: failedCount,
    extractedLongCount,
    totalCharCount,
    combinedCharCount: codePointLength(combinedText),
    included,
    excluded,
    filings,
    skipped: excluded,
    combinedText,
  };
}

export function attachKrDisclosureLlmDump(pipeline, llmDump) {
  return {
    ...pipeline,
    llmDump,
    analysis: {
      ...pipeline.analysis,
      dumpState: llmDump.state,
      dumpAvailable: llmDump.available,
      summary: {
        ...pipeline.analysis.summary,
        includedCount: llmDump.includedCount,
        failedCount: llmDump.failedCount,
        policyExcludedCount: llmDump.policyExcludedCount,
        budgetExcludedCount: llmDump.budgetExcludedCount,
      },
    },
  };
}

export function createDisclosureDebugProjection(source) {
  const sourceObject = source && typeof source === 'object' && !Array.isArray(source)
    ? { ...source }
    : source;
  if (sourceObject?.disclosurePipeline?.schemaVersion === KR_DISCLOSURE_PIPELINE_SCHEMA_VERSION) {
    delete sourceObject.documentDump;
  }
  const projected = sanitizeForJson(sourceObject);
  if (!projected || typeof projected !== 'object' || Array.isArray(projected)) return projected;
  return projected;
}

export {
  CATEGORY_CONFIG as KR_DISCLOSURE_CATEGORY_CONFIG,
  CATEGORY_ORDER as KR_DISCLOSURE_CATEGORY_ORDER,
  KR_DISCLOSURE_CLASSIFICATION_DATASET_VERSION,
  codePointLength,
  extractKeySections,
};
