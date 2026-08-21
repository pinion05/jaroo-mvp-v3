import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_COMMITTEE_LLM_MODEL,
  getCommitteeProgress,
  scoreCommitteeMembersProgressive,
} from '../../../deepscan-runtime-core/src/committee-llm.js';
import { safeJsonStringify } from '../../../deepscan-runtime-core/src/safe-json.js';
import {
  createDisclosureDebugProjection,
  KR_DISCLOSURE_PIPELINE_SCHEMA_VERSION,
} from './deepscan-kr-disclosure-pipeline.js';
import { buildKrCommitteeFromMemberScores } from './deepscan-kr-score.js';

export const DEFAULT_KR_LLM_TIMEOUT_MS = 180_000;
export const DEFAULT_KR_LLM_SOFT_DEADLINE_MS = 5_000;
export const DEFAULT_KR_LLM_MODEL = DEFAULT_COMMITTEE_LLM_MODEL;

const EVENT_SCANNER_MAX_STRUCTURED_CHARS = 12_000;
const EVENT_SCANNER_MAX_TEXT_CHARS = 60_000;
const EVENT_SCANNER_MAX_DISCLOSURE_SLICE_CHARS = 72_000;

export const KR_MEMBER_SPECS = Object.freeze({
  profitability: {
    axis: '사업 품질',
    shortLabel: '수익성',
    title: '수익성/기본체력',
    role: 'KR profitability analyst',
    focus: 'Judge Korean equity profitability and core business quality from company overview, financial analysis, and FnGuide finance evidence that is actually present.',
  },
  valuation: {
    axis: '사업 품질',
    shortLabel: '밸류',
    title: '밸류에이션',
    role: 'KR valuation analyst',
    focus: 'Judge Korean equity valuation attractiveness from consensus, opinion, investment indicators, and current price context that is actually present.',
  },
  ownershipStability: {
    axis: '사업 품질',
    shortLabel: '지배',
    title: '지분/안정성',
    role: 'KR ownership stability analyst',
    focus: 'Judge ownership stability and reporting resilience from shareholding, OpenDART disclosures, style analysis, holding context, and company overview evidence.',
  },
  trend: {
    axis: '시장 타이밍',
    shortLabel: '트렌드',
    title: '트렌드',
    role: 'KR trend analyst',
    focus: 'Judge Korean equity trend quality from relative return, style analysis, report/disclosure freshness, and current-price evidence.',
  },
  consensusMomentum: {
    axis: '시장 타이밍',
    shortLabel: '이벤트',
    title: '이벤트 스캐너',
    role: 'KR disclosure and event scanner',
    focus: 'Judge Korean equity event and disclosure risk from OpenDART filings first, then consensus, opinion, recent reports, and market signal freshness that are actually present.',
  },
  priceLocation: {
    axis: '시장 타이밍',
    shortLabel: '가격',
    title: '가격 위치',
    role: 'KR price-location analyst',
    focus: 'Judge Korean equity current price position versus average price and reported market context.',
  },
  avgPriceGap: {
    axis: '포지션 적합도',
    shortLabel: '평단',
    title: '평단 격차',
    role: 'KR average-price-gap analyst',
    focus: 'Judge position fit from current price versus average price and current unrealized position context.',
  },
  upsideBuffer: {
    axis: '포지션 적합도',
    shortLabel: '여지',
    title: '상방 버퍼',
    role: 'KR upside buffer analyst',
    focus: 'Judge remaining upside/downside buffer from consensus, opinion, recent reports, OpenDART disclosure risk, and current price evidence.',
  },
  holdingCompleteness: {
    axis: '포지션 적합도',
    shortLabel: '입력',
    title: '입력 완성도',
    role: 'KR holding completeness analyst',
    focus: 'Judge how complete and actionable the current holding context is for decision support.',
  },
});

const KR_EXCHANGE_PRODUCT_MARKETS = new Set(['ETF', 'ETN']);

const ETF_MEMBER_PRESENTATION_SPECS = Object.freeze({
  profitability: {
    shortLabel: '구조',
    title: '상품 구조/운용 품질',
  },
  valuation: {
    shortLabel: '가격',
    title: '가격/NAV 단서',
  },
  ownershipStability: {
    shortLabel: '분산',
    title: '구성/분산 안정성',
  },
  trend: {
    shortLabel: '흐름',
    title: '지수/가격 흐름',
  },
  consensusMomentum: {
    shortLabel: '정보',
    title: '시장 신호/정보 밀도',
  },
  priceLocation: {
    shortLabel: '위치',
    title: '가격 위치',
  },
  avgPriceGap: {
    shortLabel: '평단',
    title: '평단 격차',
  },
  upsideBuffer: {
    shortLabel: '여지',
    title: '상하방 여지',
  },
  holdingCompleteness: {
    shortLabel: '입력',
    title: '입력 완성도',
  },
});

const KR_MEMBER_PROMPT_GUIDANCE = Object.freeze({
  consensusMomentum: 'For ordinary KR equities, behave as the 이벤트 스캐너 persona: prioritize OpenDART disclosures before generic consensus; explicitly use selected filing counts, latest filing date, material events, risks, and the canonical disclosurePipeline LLM dump when present. Treat key-section excerpts as valid bounded filing evidence and do not infer claims outside their evidence references. If OpenDART disclosures are present, the reason should state whether they are clean, cautionary, or risk-bearing; use analyst consensus/recent reports only as supporting event context.',
});

const ETF_MEMBER_PROMPT_GUIDANCE = Object.freeze({
  profitability: 'For ETF/ETN inputs, reinterpret this member as product structure and operation quality; if etfProductSnapshot is present, use base index, issuer, fee, liquidity, and constituent facts before generic report coverage; never discuss corporate revenue, operating profit, ROE, or business profitability unless such ETF-specific facts are explicitly provided.',
  valuation: 'For ETF/ETN inputs, reinterpret valuation as price/NAV/premium-discount/position evidence; PER, PBR, ROE, analyst target price, and recommendation are not expected ETF facts and must not be treated as negative evidence.',
  ownershipStability: 'For ETF/ETN inputs, reinterpret ownership stability as constituent/sector diversification stability; if etfProductSnapshot.constituents exists, discuss top holding weights and concentration; never infer low risk or high stability from missing shareholder or constituent data.',
  trend: 'For ETF/ETN inputs, focus on index/price flow, relative return, current quote, product return windows, and volume evidence actually present.',
  consensusMomentum: 'For ETF/ETN inputs, analyst consensus is normally out-of-scope; use market signal density, report freshness, index trend, or say the provided facts are insufficient without criticizing missing target prices.',
  priceLocation: 'For ETF/ETN inputs, compare current price, average price, recent return/location, and market context; do not invent a target price.',
  avgPriceGap: 'For ETF/ETN inputs, explain this strictly as the user position gap between current ETF price and average buy price.',
  upsideBuffer: 'For ETF/ETN inputs, describe remaining up/down room from current price, average-price gap, index/market trend, and NAV or 52-week context if present; never equate high unrealized return with future upside.',
  holdingCompleteness: 'For ETF/ETN inputs, judge whether quantity, average price, current price, timestamps, and ETF product facts are complete enough for the current screen.',
});

function getInstrumentMarket(evidence) {
  return normalizeText(evidence?.instrument?.market ?? evidence?.market)?.toUpperCase() ?? null;
}

function getInstrumentKind(evidence) {
  return normalizeText(evidence?.instrument?.kind ?? evidence?.kind)?.toLowerCase() ?? null;
}

function isKrExchangeProductEvidence(evidence) {
  const kind = getInstrumentKind(evidence);
  return KR_EXCHANGE_PRODUCT_MARKETS.has(getInstrumentMarket(evidence)) || kind === 'etf' || kind === 'etn';
}

function getMemberPresentationSpec(memberKey, evidence) {
  if (isKrExchangeProductEvidence(evidence)) {
    return {
      ...KR_MEMBER_SPECS[memberKey],
      ...(ETF_MEMBER_PRESENTATION_SPECS[memberKey] ?? {}),
    };
  }

  return KR_MEMBER_SPECS[memberKey];
}

function normalizeText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

function hasFactEvidence(value) {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value);
  }

  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.some((entry) => hasFactEvidence(entry));
  }

  if (typeof value === 'object') {
    return Object.values(value).some((entry) => hasFactEvidence(entry));
  }

  return Boolean(value);
}

function hasMissingLeaf(value) {
  if (value === null || value === undefined) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.some((entry) => hasMissingLeaf(entry));
  }

  if (value && typeof value === 'object') {
    return Object.values(value).some((entry) => hasMissingLeaf(entry));
  }

  return false;
}

function ensureLogDir(root) {
  mkdirSync(root, { recursive: true });
}

function writeJson(root, fileName, payload) {
  try {
    ensureLogDir(root);
    writeFileSync(join(root, fileName), safeJsonStringify(payload, 2));
  } catch {
    // Debug artifacts are best-effort and must never abort DeepScan.
  }
}

function createQuality(availability, reasonCode = [], extra = {}) {
  return {
    availability,
    ...(reasonCode.length > 0 ? { reasonCode } : {}),
    ...extra,
  };
}

function presentValue(value, reasonCode = [], notes) {
  return {
    value,
    quality: createQuality('present', reasonCode, {
      derivationKind: 'direct',
      inputOrigin: 'source',
    }),
    ...(notes ? { notes } : {}),
  };
}

function snapshotValue(value, reasonCode = [], notes) {
  const hasEvidence = hasFactEvidence(value);
  const availability = hasEvidence ? (hasMissingLeaf(value) ? 'partial' : 'present') : 'missing';
  return {
    value: hasEvidence ? value : null,
    quality: createQuality(availability, reasonCode, {
      derivationKind: 'normalized',
      inputOrigin: 'wisereport-kr-slim',
      ...(availability === 'missing' ? { severity: 'medium', actionability: 'caution' } : {}),
    }),
    ...(notes ? { notes } : {}),
  };
}

function missingFact(message, reasonCode = ['missing_fact']) {
  return {
    value: null,
    quality: createQuality('missing', reasonCode, {
      severity: 'medium',
      actionability: 'caution',
    }),
    notes: [message],
  };
}

function optionalFact(value, reasonCode, missingMessage) {
  return value === null || value === undefined
    ? missingFact(missingMessage, reasonCode)
    : presentValue(value, reasonCode);
}

function buildKrFactBank(evidence) {
  return {
    schemaVersion: 'jaroo.deepscan.kr-fact-bank.v2',
    locale: 'KR',
    sourceFlavor: 'wisereport-fnguide-krx-opendart',
    instrument: snapshotValue(evidence.instrument ?? {}, ['instrument']),
    quote: evidence.currentQuote
      ? snapshotValue(evidence.currentQuote, ['current_quote'])
      : missingFact('KR 현재가 원본이 없습니다.', ['current_quote_missing']),
    holding: snapshotValue(evidence.holding ?? {}, ['holding_context']),
    analystConsensus: snapshotValue({
      targetPrice: evidence.consensusSnapshot?.targetPrice ?? null,
      previousTargetPrice: evidence.consensusSnapshot?.previousTargetPrice ?? null,
      targetGapPct: evidence.consensusSnapshot?.targetGapPct ?? null,
      recommendation: evidence.consensusSnapshot?.recommendation ?? null,
      recommendationScore: evidence.consensusSnapshot?.recommendationScore ?? null,
      revisionDirection: evidence.consensusSnapshot?.revisionDirection ?? null,
      revisionPct: evidence.consensusSnapshot?.revisionPct ?? null,
    }, ['opinion_analyst_consensus']),
    profitability: snapshotValue({
      revenueLatest: evidence.financialSnapshot?.revenueLatest ?? null,
      revenuePrev: evidence.financialSnapshot?.revenuePrev ?? null,
      revenueYoY: evidence.financialSnapshot?.revenueYoY ?? null,
      operatingIncomeLatest: evidence.financialSnapshot?.operatingIncomeLatest ?? null,
      operatingIncomePrev: evidence.financialSnapshot?.operatingIncomePrev ?? null,
      operatingIncomeYoY: evidence.financialSnapshot?.operatingIncomeYoY ?? null,
      netIncomeLatest: evidence.financialSnapshot?.netIncomeLatest ?? null,
      netIncomePrev: evidence.financialSnapshot?.netIncomePrev ?? null,
      netIncomeYoY: evidence.financialSnapshot?.netIncomeYoY ?? null,
      operatingMarginLatest: evidence.financialSnapshot?.operatingMarginLatest ?? null,
      netMarginLatest: evidence.financialSnapshot?.netMarginLatest ?? null,
      roe: evidence.valuationSnapshot?.roe ?? null,
    }, ['kr_profitability']),
    valuation: snapshotValue({
      per: evidence.valuationSnapshot?.per ?? null,
      pbr: evidence.valuationSnapshot?.pbr ?? null,
      roe: evidence.valuationSnapshot?.roe ?? null,
      evEbitda: evidence.valuationSnapshot?.evEbitda ?? null,
      targetPrice: evidence.consensusSnapshot?.targetPrice ?? null,
      targetGapPct: evidence.consensusSnapshot?.targetGapPct ?? null,
    }, ['kr_valuation']),
    ownership: snapshotValue(evidence.ownershipSnapshot ?? {}, ['kr_ownership']),
    disclosures: evidence.disclosureAnalysis
      ? snapshotValue(summarizeDisclosureAnalysisCompact(evidence.disclosureAnalysis), ['opendart_disclosures'])
      : missingFact('OpenDART 공시 목록이 없습니다.', ['opendart_disclosures_missing']),
    styleFactors: snapshotValue(evidence.styleAnalysisSnapshot ?? {}, ['kr_style_factors']),
    reports: snapshotValue({
      recentReportCount: evidence.reportSignals?.recentReportCount ?? null,
      recent30dReportCount: evidence.reportSignals?.recent30dReportCount ?? null,
      consensusAvailable: evidence.reportSignals?.consensusAvailable ?? false,
      opinionAvailable: evidence.reportSignals?.opinionAvailable ?? false,
      performanceCommentAvailable: evidence.reportSignals?.performanceCommentAvailable ?? false,
      performanceCommentAsOf: evidence.reportSignals?.performanceCommentAsOf ?? null,
    }, ['kr_reports']),
    businessCommentary: snapshotValue(evidence.businessCommentary ?? {}, ['kr_business_commentary']),
    etfProduct: evidence.etfProductSnapshot
      ? snapshotValue(evidence.etfProductSnapshot, ['wisereport_etf_snapshot'])
      : missingFact('ETF 상품/구성종목 스냅샷이 없습니다.', ['etf_product_snapshot_missing']),
  };
}

function summarizeDisclosureAnalysisCompact(disclosureAnalysis) {
  if (!disclosureAnalysis?.available) {
    return {
      available: false,
      reason: 'OpenDART disclosure analysis is unavailable.',
    };
  }

  return {
    available: true,
    source: disclosureAnalysis.source ?? 'opendart',
    periodFrom: disclosureAnalysis.periodFrom ?? null,
    periodTo: disclosureAnalysis.periodTo ?? null,
    latestReceiptDate: disclosureAnalysis.latestReceiptDate ?? null,
    totalCount: disclosureAnalysis.totalCount ?? disclosureAnalysis.count ?? 0,
    displayedCount: disclosureAnalysis.count ?? 0,
    ownershipCount: disclosureAnalysis.ownershipCount ?? 0,
    periodicReportCount: disclosureAnalysis.periodicReportCount ?? 0,
    correctionCount: disclosureAnalysis.correctionCount ?? 0,
    dilutionCount: disclosureAnalysis.dilutionCount ?? 0,
    materialEventCount: disclosureAnalysis.materialEventCount ?? 0,
    riskCount: disclosureAnalysis.riskCount ?? 0,
    mediumRiskCount: disclosureAnalysis.mediumRiskCount ?? 0,
    categoryCounts: disclosureAnalysis.categoryCounts ?? {},
    topReportTypes: Array.isArray(disclosureAnalysis.topReportTypes) ? disclosureAnalysis.topReportTypes.slice(0, 6) : [],
    summary: disclosureAnalysis.summary ?? null,
  };
}

function codePointLength(value) {
  return [...String(value ?? '')].length;
}

function truncateCodePoints(value, limit) {
  return [...String(value ?? '')].slice(0, Math.max(0, limit)).join('');
}

function buildEventScannerDisclosureContext(disclosureAnalysis, disclosureSource) {
  const source = disclosureSource && typeof disclosureSource === 'object' ? disclosureSource : {};
  const canonical = source.disclosurePipeline?.schemaVersion === KR_DISCLOSURE_PIPELINE_SCHEMA_VERSION
    ? source.disclosurePipeline
    : null;
  const analysis = canonical?.analysis ?? disclosureAnalysis;
  const documentDump = canonical?.llmDump ?? source.documentDump ?? null;
  const compact = summarizeDisclosureAnalysisCompact(analysis);
  const structured = {
    schemaVersion: canonical?.schemaVersion ?? KR_DISCLOSURE_PIPELINE_SCHEMA_VERSION,
    collection: canonical?.collection
      ? {
          state: canonical.collection.state ?? null,
          providerTotalCount: canonical.collection.providerTotalCount ?? compact.totalCount ?? 0,
          collectedCount: canonical.collection.collectedCount ?? compact.displayedCount ?? 0,
          truncated: canonical.collection.truncated ?? false,
          pageCountFetched: canonical.collection.pageCountFetched ?? null,
        }
      : {
          state: compact.available ? 'complete' : 'unavailable',
          providerTotalCount: compact.totalCount ?? 0,
          collectedCount: compact.displayedCount ?? 0,
          truncated: false,
          pageCountFetched: null,
        },
    selected: Array.isArray(canonical?.selected)
      ? canonical.selected.map((filing) => ({
          rceptNo: filing.rceptNo ?? null,
          receiptDate: filing.receiptDate ?? null,
          reportName: filing.reportName ?? null,
          filerName: filing.filerName ?? null,
          documentUrl: filing.documentUrl ?? null,
          primaryCategory: filing.primaryCategory ?? null,
          categories: filing.categories ?? [],
          materialityLevel: filing.materialityLevel ?? null,
          riskLevel: filing.riskLevel ?? null,
          dumpPolicy: filing.dumpPolicy ?? null,
          selectionRank: filing.selectionRank ?? null,
          selectionReasonCodes: filing.selectionReasonCodes ?? [],
        }))
      : [],
    analysis: {
      ...compact,
      materialEvents: Array.isArray(analysis?.materialEvents) ? [...analysis.materialEvents] : [],
      risks: Array.isArray(analysis?.risks) ? [...analysis.risks] : [],
    },
    llmDump: documentDump
      ? {
          state: documentDump.state ?? (documentDump.available ? 'complete' : 'unavailable'),
          available: Boolean(documentDump.available),
          policy: documentDump.policy ?? null,
          maxCharsPerFiling: documentDump.maxCharsPerFiling ?? null,
          maxTotalChars: documentDump.maxTotalChars ?? 60_000,
          includedCount: documentDump.includedCount ?? 0,
          failedCount: documentDump.failedCount ?? documentDump.skippedUnavailableCount ?? 0,
          policyExcludedCount: documentDump.policyExcludedCount ?? 0,
          budgetExcludedCount: documentDump.budgetExcludedCount ?? 0,
          included: Array.isArray(documentDump.included)
            ? [...documentDump.included]
            : Array.isArray(documentDump.filings)
              ? documentDump.filings.map(({ text: _text, ...metadata }) => metadata)
              : [],
          excluded: Array.isArray(documentDump.excluded)
            ? [...documentDump.excluded]
            : Array.isArray(documentDump.skipped)
              ? [...documentDump.skipped]
              : [],
        }
      : { state: 'unavailable', available: false },
  };

  const recordRef = (record) => record?.rceptNo ?? record?.canonicalKey ?? null;
  let combinedText = truncateCodePoints(documentDump?.combinedText ?? '', EVENT_SCANNER_MAX_TEXT_CHARS);
  structured.llmDump.combinedCharCount = codePointLength(combinedText);
  const originals = {
    selected: structured.selected,
    materialEvents: structured.analysis.materialEvents,
    risks: structured.analysis.risks,
    included: structured.llmDump.included ?? [],
    excluded: structured.llmDump.excluded ?? [],
  };
  const rankByRef = new Map(originals.selected.map((record, index) => [recordRef(record), index + 1]));
  const retainThroughRank = (items, retainedRank) => items.filter((item) => {
    const rank = rankByRef.get(recordRef(item));
    return rank === undefined || rank <= retainedRank;
  });
  const applyRankCutoff = (retainedRank) => {
    structured.selected = originals.selected.slice(0, retainedRank);
    structured.analysis.materialEvents = retainThroughRank(originals.materialEvents, retainedRank);
    structured.analysis.risks = retainThroughRank(originals.risks, retainedRank);
    structured.llmDump.included = retainThroughRank(originals.included, retainedRank);
    structured.llmDump.excluded = retainThroughRank(originals.excluded, retainedRank);
    const retainedCount = structured.selected.length
      + structured.analysis.materialEvents.length
      + structured.analysis.risks.length
      + structured.llmDump.included.length
      + structured.llmDump.excluded.length;
    const originalCount = originals.selected.length
      + originals.materialEvents.length
      + originals.risks.length
      + originals.included.length
      + originals.excluded.length;
    const removedCount = originalCount - retainedCount;
    if (removedCount > 0) structured.structuredTruncatedCount = removedCount;
    else delete structured.structuredTruncatedCount;
    return removedCount;
  };

  let retainedFloor = 0;
  let retainedCeiling = originals.selected.length;
  let bestRetainedRank = -1;
  while (retainedFloor <= retainedCeiling) {
    const candidate = Math.floor((retainedFloor + retainedCeiling) / 2);
    applyRankCutoff(candidate);
    if (codePointLength(JSON.stringify(structured)) <= EVENT_SCANNER_MAX_STRUCTURED_CHARS) {
      bestRetainedRank = candidate;
      retainedFloor = candidate + 1;
    } else {
      retainedCeiling = candidate - 1;
    }
  }

  let trimmedCount = applyRankCutoff(Math.max(0, bestRetainedRank));
  while (codePointLength(JSON.stringify(structured)) > EVENT_SCANNER_MAX_STRUCTURED_CHARS) {
    const fallbackArrays = [
      structured.analysis.materialEvents,
      structured.analysis.risks,
      structured.llmDump.included ?? [],
      structured.llmDump.excluded ?? [],
      structured.analysis.topReportTypes ?? [],
    ];
    const target = fallbackArrays.find((items) => items.length > 0);
    if (!target) break;
    target.pop();
    trimmedCount += 1;
    structured.structuredTruncatedCount = trimmedCount;
  }

  structured.llmDump.combinedText = combinedText;
  while (combinedText && codePointLength(JSON.stringify(structured)) > EVENT_SCANNER_MAX_DISCLOSURE_SLICE_CHARS) {
    const overflow = codePointLength(JSON.stringify(structured)) - EVENT_SCANNER_MAX_DISCLOSURE_SLICE_CHARS;
    combinedText = truncateCodePoints(combinedText, codePointLength(combinedText) - Math.max(1, overflow));
    structured.llmDump.combinedText = combinedText;
    structured.llmDump.combinedCharCount = codePointLength(combinedText);
  }

  return { disclosurePipeline: structured };
}

function sanitizeOwnershipSnapshotForLlm(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    return snapshot ?? {};
  }

  const sanitized = { ...snapshot };
  delete sanitized.sourceLimitations;

  if (sanitized.institutionalOwnershipPct === null || sanitized.institutionalOwnershipPct === undefined) {
    delete sanitized.institutionalOwnershipPct;
  }
  if (sanitized.foreignOwnershipPct === null || sanitized.foreignOwnershipPct === undefined) {
    delete sanitized.foreignOwnershipPct;
  }

  return sanitized;
}

function buildMemberKrFacts(memberKey, evidence) {
  const ownershipSnapshotForLlm = sanitizeOwnershipSnapshotForLlm(evidence.ownershipSnapshot);
  const etfProductSnapshot = evidence.etfProductSnapshot ?? null;
  const disclosureSummary = summarizeDisclosureAnalysisCompact(evidence.disclosureAnalysis);
  const base = {
    schemaVersion: 'jaroo.deepscan.kr-member-slice.v2',
    locale: 'KR',
    sourceFlavor: 'wisereport-fnguide-krx-opendart',
    ...(evidence.disclosureAnalysis ? { disclosureAnalysis: disclosureSummary } : {}),
    ...(etfProductSnapshot ? { etfProductSnapshot } : {}),
  };

  switch (memberKey) {
    case 'profitability':
      return {
        ...base,
        profitability: evidence.financialSnapshot ?? {},
        valuationCrossChecks: {
          roe: evidence.valuationSnapshot?.roe ?? null,
          operatingMarginLatest: evidence.financialSnapshot?.operatingMarginLatest ?? null,
          netMarginLatest: evidence.financialSnapshot?.netMarginLatest ?? null,
        },
        reports: {
          recentReportCount: evidence.reportSignals?.recentReportCount ?? null,
          recent30dReportCount: evidence.reportSignals?.recent30dReportCount ?? null,
          performanceComment: evidence.businessCommentary?.performanceComment ?? null,
        },
      };
    case 'valuation':
      return {
        ...base,
        market: evidence.marketSnapshot ?? {},
        consensus: evidence.consensusSnapshot ?? {},
        valuation: evidence.valuationSnapshot ?? {},
      };
    case 'ownershipStability':
      return {
        ...base,
        ownership: ownershipSnapshotForLlm,
        disclosures: disclosureSummary,
        styleFactors: evidence.styleAnalysisSnapshot ?? {},
        pageCoverage: evidence.pageCoverage ?? {},
      };
    case 'trend':
      return {
        ...base,
        market: evidence.marketSnapshot ?? {},
        relativeReturn: evidence.relativeReturnSnapshot ?? {},
        styleFactors: evidence.styleAnalysisSnapshot ?? {},
        disclosures: disclosureSummary,
        reports: evidence.reportSignals ?? {},
        businessCommentary: evidence.businessCommentary ?? {},
      };
    case 'consensusMomentum':
      return {
        ...base,
        eventScanner: {
          disclosures: disclosureSummary,
          consensus: evidence.consensusSnapshot ?? {},
          reports: evidence.reportSignals ?? {},
          topFacts: Array.isArray(evidence.topFacts) ? evidence.topFacts : [],
          topRisks: Array.isArray(evidence.topRisks) ? evidence.topRisks : [],
        },
        disclosures: disclosureSummary,
        consensus: evidence.consensusSnapshot ?? {},
        reports: evidence.reportSignals ?? {},
        businessCommentary: evidence.businessCommentary ?? {},
      };
    case 'priceLocation':
      return {
        ...base,
        market: evidence.marketSnapshot ?? {},
        consensus: {
          targetPrice: evidence.consensusSnapshot?.targetPrice ?? null,
          targetGapPct: evidence.consensusSnapshot?.targetGapPct ?? null,
        },
        relativeReturn: evidence.relativeReturnSnapshot ?? {},
      };
    case 'avgPriceGap':
      return {
        ...base,
        holding: evidence.holding ?? {},
        market: evidence.marketSnapshot ?? {},
      };
    case 'upsideBuffer':
      return {
        ...base,
        market: evidence.marketSnapshot ?? {},
        consensus: evidence.consensusSnapshot ?? {},
        valuation: evidence.valuationSnapshot ?? {},
        reports: evidence.reportSignals ?? {},
        disclosures: disclosureSummary,
        businessCommentary: evidence.businessCommentary ?? {},
      };
    case 'holdingCompleteness':
      return {
        ...base,
        holding: evidence.holding ?? {},
        quote: evidence.currentQuote ?? null,
        timestamps: evidence.timestamps ?? {},
        pageCoverage: evidence.pageCoverage ?? {},
      };
    default:
      return base;
  }
}

function buildSharedDump(input, evidence, sources) {
  return {
    schemaVersion: 'jaroo.deepscan.runtime.shared.v2',
    locale: 'KR',
    sourceFlavor: 'wisereport-fnguide-krx-opendart',
    instrument: {
      code: presentValue(input.instrument.code ?? null, ['instrument_code']),
      name: presentValue(input.instrument.name ?? null, ['instrument_name']),
      market: presentValue(input.instrument.market ?? evidence.instrument?.market ?? null, ['instrument_market']),
      kind: presentValue(input.instrument.kind ?? evidence.instrument?.kind ?? null, ['instrument_kind']),
    },
    timestamps: presentValue(evidence.timestamps ?? {}, ['timestamps']),
    sourceCoverage: presentValue(evidence.sourceCoverage ?? {}, ['source_coverage']),
    pageCoverage: presentValue(evidence.pageCoverage ?? {}, ['page_coverage']),
    reportSignals: presentValue(evidence.reportSignals ?? {}, ['report_signals']),
    holding: presentValue(evidence.holding ?? {}, ['holding_context']),
    currentQuote: evidence.currentQuote
      ? presentValue(evidence.currentQuote, ['current_quote'])
      : missingFact('현재가 근거가 없습니다.', ['current_quote_missing']),
    marketSnapshot: presentValue(evidence.marketSnapshot ?? {}, ['market_snapshot']),
    consensusSnapshot: presentValue(evidence.consensusSnapshot ?? {}, ['consensus_snapshot']),
    valuationSnapshot: presentValue(evidence.valuationSnapshot ?? {}, ['valuation_snapshot']),
    relativeReturnSnapshot: presentValue(evidence.relativeReturnSnapshot ?? {}, ['relative_return_snapshot']),
    styleAnalysisSnapshot: presentValue(evidence.styleAnalysisSnapshot ?? {}, ['style_analysis_snapshot']),
    ownershipSnapshot: presentValue(sanitizeOwnershipSnapshotForLlm(evidence.ownershipSnapshot), ['ownership_snapshot']),
    financialSnapshot: presentValue(evidence.financialSnapshot ?? {}, ['financial_snapshot']),
    businessCommentary: presentValue(evidence.businessCommentary ?? {}, ['business_commentary']),
    disclosureAnalysis: evidence.disclosureAnalysis
      ? presentValue(summarizeDisclosureAnalysisCompact(evidence.disclosureAnalysis), ['opendart_disclosures'])
      : missingFact('OpenDART 공시 목록이 없습니다.', ['opendart_disclosures_missing']),
    etfProductSnapshot: evidence.etfProductSnapshot
      ? presentValue(evidence.etfProductSnapshot, ['wisereport_etf_snapshot'])
      : missingFact('ETF 상품/구성종목 스냅샷이 없습니다.', ['etf_product_snapshot_missing']),
    topFacts: presentValue(Array.isArray(evidence.topFacts) ? evidence.topFacts : [], ['top_facts']),
    topRisks: presentValue(Array.isArray(evidence.topRisks) ? evidence.topRisks : [], ['top_risks']),
    packageContext: presentValue(evidence.packageContext ?? { available: false, summaryFacts: [], marketView: null, boardHighlights: [] }, ['package_context'], ['Supplemental only; not numeric truth.']),
  };
}

function buildMemberDump(memberKey, input, evidence, sources) {
  const shared = buildSharedDump(input, evidence, sources);
  const common = {
    instrument: shared.instrument,
    timestamps: shared.timestamps,
    holding: shared.holding,
    currentQuote: shared.currentQuote,
    marketSnapshot: shared.marketSnapshot,
    consensusSnapshot: shared.consensusSnapshot,
    valuationSnapshot: shared.valuationSnapshot,
    relativeReturnSnapshot: shared.relativeReturnSnapshot,
    styleAnalysisSnapshot: shared.styleAnalysisSnapshot,
    ownershipSnapshot: shared.ownershipSnapshot,
    financialSnapshot: shared.financialSnapshot,
    businessCommentary: shared.businessCommentary,
    etfProductSnapshot: shared.etfProductSnapshot,
    pageCoverage: shared.pageCoverage,
    reportSignals: shared.reportSignals,
    sourceCoverage: shared.sourceCoverage,
    topFacts: shared.topFacts,
    topRisks: shared.topRisks,
    packageContext: shared.packageContext,
  };
  const krFacts = snapshotValue(buildMemberKrFacts(memberKey, evidence), ['kr_member_fact_slice']);
  const eventScannerDisclosureContext = buildEventScannerDisclosureContext(evidence.disclosureAnalysis, sources?.disclosures);

  switch (memberKey) {
    case 'profitability':
      return {
        member: memberKey,
        facts: {
          krFacts,
          etfProductSnapshot: common.etfProductSnapshot,
          instrument: common.instrument,
          financialSnapshot: presentValue({
            revenueLatest: evidence.financialSnapshot?.revenueLatest ?? null,
            revenueYoY: evidence.financialSnapshot?.revenueYoY ?? null,
            operatingIncomeLatest: evidence.financialSnapshot?.operatingIncomeLatest ?? null,
            operatingIncomeYoY: evidence.financialSnapshot?.operatingIncomeYoY ?? null,
            netIncomeLatest: evidence.financialSnapshot?.netIncomeLatest ?? null,
            netIncomeYoY: evidence.financialSnapshot?.netIncomeYoY ?? null,
            operatingMarginLatest: evidence.financialSnapshot?.operatingMarginLatest ?? null,
            netMarginLatest: evidence.financialSnapshot?.netMarginLatest ?? null,
            roe: evidence.valuationSnapshot?.roe ?? null,
            recentReportCount: evidence.reportSignals?.recentReportCount ?? null,
          }, ['profitability_inputs']),
          packageSummaryFacts: presentValue(evidence.packageContext?.summaryFacts ?? [], ['package_summary_facts']),
        },
      };
    case 'valuation':
      return {
        member: memberKey,
        facts: {
          krFacts,
          etfProductSnapshot: common.etfProductSnapshot,
          instrument: common.instrument,
          marketSnapshot: common.marketSnapshot,
          consensusSnapshot: presentValue({
            targetPrice: evidence.consensusSnapshot?.targetPrice ?? null,
            targetGapPct: evidence.consensusSnapshot?.targetGapPct ?? null,
            recommendation: evidence.consensusSnapshot?.recommendation ?? null,
            revisionDirection: evidence.consensusSnapshot?.revisionDirection ?? null,
            revisionPct: evidence.consensusSnapshot?.revisionPct ?? null,
          }, ['consensus_snapshot']),
          valuationSnapshot: presentValue({
            per: evidence.valuationSnapshot?.per ?? null,
            pbr: evidence.valuationSnapshot?.pbr ?? null,
            roe: evidence.valuationSnapshot?.roe ?? null,
            evEbitda: evidence.valuationSnapshot?.evEbitda ?? null,
          }, ['valuation_inputs']),
          packageSummaryFacts: presentValue(evidence.packageContext?.summaryFacts ?? [], ['package_summary_facts']),
        },
      };
    case 'ownershipStability':
      return {
        member: memberKey,
        facts: {
          krFacts,
          etfProductSnapshot: common.etfProductSnapshot,
          instrument: common.instrument,
          ownershipSnapshot: presentValue(sanitizeOwnershipSnapshotForLlm(evidence.ownershipSnapshot), ['ownership_inputs']),
          styleAnalysisSnapshot: presentValue(evidence.styleAnalysisSnapshot ?? {}, ['style_analysis_snapshot']),
          holding: common.holding,
          packageSummaryFacts: presentValue(evidence.packageContext?.summaryFacts ?? [], ['package_summary_facts']),
        },
      };
    case 'trend':
      return {
        member: memberKey,
        facts: {
          krFacts,
          etfProductSnapshot: common.etfProductSnapshot,
          instrument: common.instrument,
          marketSnapshot: common.marketSnapshot,
          relativeReturnSnapshot: presentValue(evidence.relativeReturnSnapshot ?? {}, ['relative_return_snapshot']),
          styleAnalysisSnapshot: presentValue(evidence.styleAnalysisSnapshot ?? {}, ['style_analysis_snapshot']),
          recent30dReportCount: optionalFact(evidence.reportSignals?.recent30dReportCount ?? null, ['recent_report_count'], '최근 30일 리포트 수가 없습니다.'),
          packageMarketView: optionalFact(evidence.packageContext?.marketView ?? null, ['package_market_view'], '패키지 시장 뷰가 없습니다.'),
        },
      };
    case 'consensusMomentum':
      return {
        member: memberKey,
        facts: {
          krFacts,
          etfProductSnapshot: common.etfProductSnapshot,
          instrument: common.instrument,
          eventScannerContext: presentValue({
            ...eventScannerDisclosureContext,
            topFacts: Array.isArray(evidence.topFacts) ? evidence.topFacts : [],
            topRisks: Array.isArray(evidence.topRisks) ? evidence.topRisks : [],
          }, ['event_scanner_context']),
          consensusSnapshot: common.consensusSnapshot,
          recentReportCount: optionalFact(evidence.reportSignals?.recentReportCount ?? null, ['recent_report_count'], '최근 리포트 수가 없습니다.'),
          recent30dReportCount: optionalFact(evidence.reportSignals?.recent30dReportCount ?? null, ['recent_30d_report_count'], '최근 30일 리포트 수가 없습니다.'),
          packageMarketView: optionalFact(evidence.packageContext?.marketView ?? null, ['package_market_view'], '패키지 시장 뷰가 없습니다.'),
        },
      };
    case 'priceLocation':
      return {
        member: memberKey,
        facts: {
          krFacts,
          etfProductSnapshot: common.etfProductSnapshot,
          instrument: common.instrument,
          marketSnapshot: common.marketSnapshot,
          consensusSnapshot: common.consensusSnapshot,
          relativeReturnSnapshot: presentValue({
            return1m: evidence.relativeReturnSnapshot?.return1m ?? null,
            return3m: evidence.relativeReturnSnapshot?.return3m ?? null,
          }, ['price_location_inputs']),
        },
      };
    case 'avgPriceGap':
      return {
        member: memberKey,
        facts: {
          krFacts,
          etfProductSnapshot: common.etfProductSnapshot,
          instrument: common.instrument,
          holding: common.holding,
          marketSnapshot: common.marketSnapshot,
        },
      };
    case 'upsideBuffer':
      return {
        member: memberKey,
        facts: {
          krFacts,
          etfProductSnapshot: common.etfProductSnapshot,
          instrument: common.instrument,
          marketSnapshot: common.marketSnapshot,
          consensusSnapshot: common.consensusSnapshot,
          recent30dReportCount: optionalFact(evidence.reportSignals?.recent30dReportCount ?? null, ['recent_30d_report_count'], '최근 30일 리포트 수가 없습니다.'),
          packageMarketView: optionalFact(evidence.packageContext?.marketView ?? null, ['package_market_view'], '패키지 시장 뷰가 없습니다.'),
        },
      };
    case 'holdingCompleteness':
      return {
        member: memberKey,
        facts: {
          krFacts,
          etfProductSnapshot: common.etfProductSnapshot,
          instrument: common.instrument,
          holding: common.holding,
          marketSnapshot: common.marketSnapshot,
          timestamps: common.timestamps,
          pageCoverage: presentValue({
            coverageRatio: evidence.pageCoverage?.totalKnownPages
              ? evidence.pageCoverage.availableCount / evidence.pageCoverage.totalKnownPages
              : 0,
          }, ['holding_completeness_inputs']),
        },
      };
    default:
      return { member: memberKey, facts: { krFacts, ...common } };
  }
}

function systemPrompt(memberKey) {
  const spec = KR_MEMBER_SPECS[memberKey];
  return [
    `You are Jaroo KR DeepScan committee member: ${spec.role}.`,
    spec.focus,
    'Use only the provided sharedContext/memberContext JSON generated from KR WiseReport/FnGuide/KRX/OpenDART evidence and dump inputs.',
    'Prefer memberContext.facts.krFacts when present; it is the source-specific normalized KR slice and should override generic global-shaped assumptions.',
    'Treat package-derived context as supplemental only, never as silent numeric truth.',
    'Treat absent fields as out-of-scope rather than negative evidence; do not request, infer, or mention data that is not present in sharedContext/memberContext.',
    'Lead with the strongest numeric or concrete evidence that is actually present.',
    'If sharedContext.instrument.market or memberContext.facts.instrument.market is ETF or ETN, or sharedContext.instrument.kind/memberContext.facts.instrument.kind is etf/etn, treat the instrument as an exchange-traded product, not an operating company.',
    'For ETF/ETN, do not mention missing individual-stock facts such as PER, PBR, ROE, corporate profitability, shareholder stability, analyst recommendation, or target price unless the input explicitly provides those facts as applicable.',
    'For ETF/ETN, absence of shareholder, constituent, or analyst-target data is not positive or negative evidence by itself; say only what can be judged from current quote, average-price gap, trend, liquidity, page coverage, NAV/premium-discount, constituents, or sector weights that are actually present.',
    'For ETF/ETN, when sharedContext.etfProductSnapshot or memberContext.facts.etfProductSnapshot is present, use its product, marketStatus, constituents.top10/top10WeightPct, and liquidity fields directly instead of saying constituent data is unavailable.',
    KR_MEMBER_PROMPT_GUIDANCE[memberKey] ?? '',
    ETF_MEMBER_PROMPT_GUIDANCE[memberKey] ?? '',
    'Return only valid JSON matching the schema.',
    'Write reason as exactly one readable Korean sentence for a mobile chat bubble: no bullet, no newline, no colon label, no member name prefix, and no multi-sentence paragraph.',
    'Keep reason focused on one strongest evidence-to-judgment flow; prefer about 70-140 Korean characters and avoid cramming every metric into a long comma chain.',
    'Score semantics: 0 extremely negative, 50 mixed/unclear, 100 extremely positive.',
  ].join(' ');
}

function normalizeLlmMemberErrors(errors, memberKeys) {
  const direct = new Map();
  const globalErrors = [];

  for (const error of Array.isArray(errors) ? errors : []) {
    const member = normalizeText(error?.member);
    if (!member || member === 'all') {
      globalErrors.push(error);
      continue;
    }
    direct.set(member, error);
  }

  const fallbackGlobalError = globalErrors[0] ?? null;
  return Object.fromEntries(memberKeys.map((memberKey) => [
    memberKey,
    direct.get(memberKey) ?? fallbackGlobalError,
  ]));
}

function getAxisScore(axisKey, memberScores) {
  const committee = buildKrCommitteeFromMemberScores(memberScores);
  if (axisKey === 'businessQuality') {
    return committee.businessQuality.score;
  }
  if (axisKey === 'marketTiming') {
    return committee.marketTiming.score;
  }
  return committee.positionFit.score;
}

function averageCompletedScore(memberScores) {
  const scores = Object.values(memberScores).filter((score) => Number.isFinite(Number(score))).map((score) => Number(score));
  if (scores.length === 0) {
    return null;
  }

  return Math.max(0, Math.min(100, Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)));
}

function rollupAxis(axisKey, memberKeys, results, errorsByMember, pendingMembers) {
  const validMembers = memberKeys.filter((memberKey) => results[memberKey]);
  const pendingSet = new Set(Array.isArray(pendingMembers) ? pendingMembers : []);
  const pendingAxisMembers = memberKeys.filter((memberKey) => pendingSet.has(memberKey));
  const errorMembers = memberKeys.filter((memberKey) => !results[memberKey] && !pendingSet.has(memberKey));
  const memberScores = Object.fromEntries(validMembers.map((memberKey) => [memberKey, results[memberKey].score]));
  const hasErrors = errorMembers.length > 0;
  const hasPending = pendingAxisMembers.length > 0;
  const isComplete = validMembers.length === memberKeys.length;

  return {
    axisKey,
    validMembers,
    errorMembers,
    pendingMembers: pendingAxisMembers,
    errorsByMember,
    omitted: false,
    hasErrors,
    hasPending,
    score: validMembers.length === 0 ? null : isComplete && !hasErrors ? getAxisScore(axisKey, memberScores) : averageCompletedScore(memberScores),
    memberScores,
  };
}

export function getDeepScanKrCommitteeProgress(requestId) {
  return getCommitteeProgress(requestId);
}

export async function scoreDeepScanKrCommitteeFromDump(rawInput, input, evidence, sources) {
  const requestId = `kr-committee-${input.instrument.code ?? input.instrument.name ?? randomUUID()}-${Date.now()}`;
  const shared = buildSharedDump(input, evidence, sources);
  const factBank = buildKrFactBank(evidence);
  const memberKeys = Object.keys(KR_MEMBER_SPECS);
  const members = Object.fromEntries(memberKeys.map((memberKey) => [memberKey, buildMemberDump(memberKey, input, evidence, sources)]));
  const logDir = join(process.cwd(), '.omx', 'context', 'committee-debug-logs', requestId);
  const debugSources = sources?.disclosures
    ? { ...sources, disclosures: createDisclosureDebugProjection(sources.disclosures) }
    : sources;
  writeJson(logDir, 'source-input.json', { rawInput, input, evidence, sources: debugSources });
  writeJson(logDir, 'prompt-map.json', Object.fromEntries(memberKeys.map((memberKey) => [memberKey, systemPrompt(memberKey)])));
  writeJson(logDir, 'runtime-shape.json', {
    schemaVersion: 'jaroo.deepscan.runtime.v2',
    locale: 'KR',
    sourceFlavor: 'wisereport-fnguide-krx',
    factBank,
    shared,
    members,
  });

  const enabled = normalizeText(process.env.DEEPSCAN_KR_LLM_ENABLE)?.toLowerCase();
  if (!process.env.OPENROUTER_API_KEY && !['1', 'true', 'yes', 'on'].includes(enabled ?? '')) {
    return {
      requestId,
      runtimeShape: {
        schemaVersion: 'jaroo.deepscan.runtime.v2',
        locale: 'KR',
        sourceFlavor: 'wisereport-fnguide-krx',
        factBank,
        shared,
        members,
      },
      results: {},
      errors: [{ member: 'all', error: 'OPENROUTER_API_KEY is not configured.' }],
      pending: [],
      status: 'disabled',
      completed: 0,
      softDeadlineMs: 0,
    };
  }

  const softDeadlineMs = parsePositiveInteger(process.env.DEEPSCAN_KR_LLM_SOFT_DEADLINE_MS ?? process.env.DEEPSCAN_LLM_SOFT_DEADLINE_MS, DEFAULT_KR_LLM_SOFT_DEADLINE_MS);
  const { results, errors, pending, status, completed } = await scoreCommitteeMembersProgressive({
    memberKeys,
    shared,
    members,
    options: {
      requestId,
      schemaName: 'jaroo_kr_committee_member',
      title: 'jaroo-mvp-v3 KR DeepScan Committee',
      model: process.env.DEEPSCAN_KR_LLM_MODEL ?? process.env.DEEPSCAN_LLM_MODEL ?? DEFAULT_KR_LLM_MODEL,
      timeoutMs: parsePositiveInteger(process.env.DEEPSCAN_KR_LLM_TIMEOUT_MS ?? process.env.DEEPSCAN_LLM_TIMEOUT_MS, DEFAULT_KR_LLM_TIMEOUT_MS),
      concurrency: parsePositiveInteger(process.env.DEEPSCAN_KR_LLM_CONCURRENCY ?? process.env.DEEPSCAN_LLM_CONCURRENCY, 4),
      softDeadlineMs,
      summaryKey: input.instrument.code ?? input.instrument.name ?? 'kr',
      logDir,
      systemPrompt,
    },
  });

  writeJson(logDir, 'summary.json', { requestId, errors, results });

  return {
    requestId,
    runtimeShape: {
      schemaVersion: 'jaroo.deepscan.runtime.v2',
      locale: 'KR',
      sourceFlavor: 'wisereport-fnguide-krx',
      factBank,
      shared,
      members,
    },
    results,
    errors,
    pending,
    status,
    completed,
    softDeadlineMs,
  };
}

function buildSuccessMember(memberKey, result, evidence) {
  const spec = getMemberPresentationSpec(memberKey, evidence);
  return {
    memberKey,
    shortLabel: spec.shortLabel,
    title: spec.title,
    status: 'success',
    reason: result.reason,
    score: result.score,
    scoreLabel: String(result.score),
    tone: result.score >= 70 ? 'positive' : result.score >= 55 ? 'neutral' : 'warning',
    iconTone: result.score >= 70 ? 'green' : result.score >= 55 ? 'blue' : 'amber',
    confidence: result.confidence,
    error: null,
  };
}

function buildErrorMember(memberKey, error, evidence) {
  const attempts = Number.isFinite(Number(error?.attempts)) ? Number(error.attempts) : 4;
  const kind = normalizeText(error?.errorKind) ?? 'llm-unknown';
  const spec = getMemberPresentationSpec(memberKey, evidence);
  return {
    memberKey,
    shortLabel: spec.shortLabel,
    title: spec.title,
    status: 'error',
    reason: null,
    score: null,
    scoreLabel: 'Error',
    tone: 'warning',
    iconTone: 'red',
    error: {
      kind,
      message: `LLM 응답 실패 · ${attempts}회 시도`,
      attempts,
      retryable: Boolean(error?.retryable),
    },
  };
}

function buildPendingMember(memberKey, evidence) {
  const spec = getMemberPresentationSpec(memberKey, evidence);
  return {
    memberKey,
    shortLabel: spec.shortLabel,
    title: spec.title,
    status: 'pending',
    reason: '이 위원은 추가 LLM 응답을 기다리는 중입니다.',
    score: null,
    scoreLabel: '고민중...',
    tone: 'neutral',
    iconTone: 'blue',
    error: null,
  };
}

function axisLabel(axisKey, evidence) {
  if (isKrExchangeProductEvidence(evidence)) {
    if (axisKey === 'businessQuality') {
      return 'ETF 구조 품질';
    }
    if (axisKey === 'marketTiming') {
      return '지수/가격 흐름';
    }
    return '내 포지션 적합도';
  }
  return axisKey === 'businessQuality' ? '사업 품질' : axisKey === 'marketTiming' ? '시장 타이밍' : '포지션 적합도';
}

function axisSubtitle(axisKey, hasErrors, hasPending, evidence) {
  if (hasErrors) {
    return '일부 LLM 위원 응답 실패로 축 점수를 보류했습니다.';
  }
  if (hasPending) {
    return '일부 LLM 위원이 아직 고민 중이라 완료 위원 점수만 임시 반영했습니다.';
  }
  if (isKrExchangeProductEvidence(evidence)) {
    return axisKey === 'businessQuality'
      ? '추종지수·구성·유동성 연결 범위를 반영한 ETF 품질 점수'
      : axisKey === 'marketTiming'
        ? '현재가, 지수/가격 흐름, 정보 밀도를 반영한 ETF 신호'
        : '평단, 수량, 현재가 등 내 ETF 보유 맥락을 반영한 점수';
  }
  return axisKey === 'businessQuality'
    ? '덤프 기반 KR 기업 체력 점수'
    : axisKey === 'marketTiming'
      ? '덤프 기반 KR 타이밍 신호 점수'
      : '덤프 기반 KR 포지션 적합도 점수';
}

export function buildKrCommitteeAxesFromLlmResults(evidence, llmResults, llmErrors = [], llmPending = []) {
  const byAxis = {
    businessQuality: ['profitability', 'valuation', 'ownershipStability'],
    marketTiming: ['trend', 'consensusMomentum', 'priceLocation'],
    positionFit: ['avgPriceGap', 'upsideBuffer', 'holdingCompleteness'],
  };
  const allMemberKeys = Object.values(byAxis).flat();
  const errorsByMember = normalizeLlmMemberErrors(llmErrors, allMemberKeys);

  const businessAxis = rollupAxis('businessQuality', byAxis.businessQuality, llmResults, errorsByMember, llmPending);
  const marketAxis = rollupAxis('marketTiming', byAxis.marketTiming, llmResults, errorsByMember, llmPending);
  const positionAxis = rollupAxis('positionFit', byAxis.positionFit, llmResults, errorsByMember, llmPending);

  const axes = [businessAxis, marketAxis, positionAxis]
    .map((axis) => ({
      label: axisLabel(axis.axisKey, evidence),
      score: axis.score,
      scoreText: axis.score === null ? 'N/A' : `${axis.score} / 100`,
      axisStatusText: axis.hasErrors
        ? `LLM ${axis.validMembers.length}/3 · 오류 ${axis.errorMembers.length}/3`
        : axis.hasPending
          ? axis.validMembers.length === 0
            ? `LLM 위원 응답 대기 중 · ${axis.pendingMembers.length}명 고민중`
            : `LLM 위원 ${axis.validMembers.length}/3명 반영 · ${axis.pendingMembers.length}명 고민중`
          : 'LLM 위원 3/3명 반영',
      subtitle: axisSubtitle(axis.axisKey, axis.hasErrors, axis.hasPending, evidence),
      avgLabel: axis.score === null ? '위원 평균 N/A' : `위원 평균 ${axis.score}`,
      members: byAxis[axis.axisKey].map((memberKey) => (
        llmResults[memberKey]
          ? buildSuccessMember(memberKey, llmResults[memberKey], evidence)
          : axis.pendingMembers.includes(memberKey)
            ? buildPendingMember(memberKey, evidence)
            : buildErrorMember(memberKey, errorsByMember[memberKey], evidence)
      )),
    }));

  const hasMemberErrors = [businessAxis, marketAxis, positionAxis].some((axis) => axis.hasErrors);
  const hasPendingMembers = [businessAxis, marketAxis, positionAxis].some((axis) => axis.hasPending);
  const committeeScores = hasMemberErrors
    || hasPendingMembers
    ? null
    : buildKrCommitteeFromMemberScores(Object.fromEntries(Object.entries(llmResults).map(([key, value]) => [key, value.score])));
  return {
    axes,
    committeeScores,
    hasMemberErrors,
    hasPendingMembers,
    coverage: {
      businessQuality: businessAxis,
      marketTiming: marketAxis,
      positionFit: positionAxis,
    },
  };
}
