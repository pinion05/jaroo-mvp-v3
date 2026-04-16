import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { WISEREPORT_KR_PAGES } = require('../crawlers/wisereport-kr/page-specs.cjs');

const KNOWN_PAGE_IDS = Object.freeze(WISEREPORT_KR_PAGES.map((page) => page.id));
const OCRISH_NUMBER_TEXT_PATTERN = /(shares?|share|stocks?|stock|주|원|krw|usd|eur|jpy|cny|aud|cad|hkd)/gi;

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeText(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
}

function normalizeCode(value) {
  const normalized = normalizeText(value);
  return normalized || null;
}

function normalizeNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const normalizedValue = value.trim().replace(/[−–—]/g, '-');
  if (!normalizedValue) {
    return null;
  }

  const wrappedNegativeMatch = normalizedValue.match(/^\((.*)\)$/);
  const isWrappedNegative = Boolean(wrappedNegativeMatch);
  const unwrappedValue = wrappedNegativeMatch?.[1] ?? normalizedValue;
  const cleanedValue = unwrappedValue
    .replaceAll(',', '')
    .replace(/\s+/g, '')
    .replace(/[₩$€¥£%]/g, '')
    .replace(OCRISH_NUMBER_TEXT_PATTERN, '');

  if (!cleanedValue || !/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(cleanedValue)) {
    return null;
  }

  const parsed = Number(cleanedValue);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return isWrappedNegative ? -Math.abs(parsed) : parsed;
}

function pickFirst(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined) {
      return value;
    }
  }

  return null;
}

function hasEvidence(value) {
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
    return value.some((item) => hasEvidence(item));
  }

  if (typeof value === 'object') {
    const entries = Object.values(value);
    return entries.length > 0 && entries.some((entry) => hasEvidence(entry));
  }

  return Boolean(value);
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : String(Number(value));
}

function resolveAggregateAsOf(quotes, item) {
  const itemAsOf = normalizeText(item?.asOf);
  if (itemAsOf) {
    return itemAsOf;
  }

  const aggregateAsOf = quotes?.asOf;
  if (typeof aggregateAsOf === 'string') {
    return normalizeText(aggregateAsOf);
  }

  return normalizeText(aggregateAsOf?.kr);
}

function normalizeQuoteRecord(item, aggregate = null) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const price = normalizeNumber(item.price);
  if (price === null) {
    return null;
  }

  return {
    price,
    currency: normalizeText(item.currency),
    asOf: resolveAggregateAsOf(aggregate, item),
    source: normalizeText(item.source),
    status: normalizeText(item.status),
  };
}

function resolveQuoteFromAggregate(quotes, instrumentCode) {
  const items = Array.isArray(quotes?.items) ? quotes.items : [];
  if (items.length === 0) {
    return null;
  }

  if (instrumentCode) {
    const matched = items.find((item) => normalizeCode(item?.code) === instrumentCode);
    return matched ? normalizeQuoteRecord(matched, quotes) : null;
  }

  return normalizeQuoteRecord(items[0], quotes);
}

function resolveCurrentQuote(quotes, instrumentCode) {
  if (!quotes || typeof quotes !== 'object') {
    return null;
  }

  if (Array.isArray(quotes.items)) {
    return resolveQuoteFromAggregate(quotes, instrumentCode);
  }

  return normalizeQuoteRecord(quotes);
}

function countRecentReports(page) {
  const safePage = asObject(page);
  const candidateArrays = [
    safePage.recentReports,
    safePage.reports,
    safePage.items,
    safePage.rows,
    safePage.recentReports?.rows,
  ];

  for (const candidate of candidateArrays) {
    if (Array.isArray(candidate)) {
      return candidate.filter((item) => item !== null && item !== undefined).length;
    }
  }

  const rowCount = normalizeNumber(safePage.rowCount ?? safePage.recentReports?.rowCount);
  return rowCount === null ? null : rowCount;
}

function buildTopFacts({ currentQuote, holding, pageCoverage, reportSignals }) {
  const facts = [];

  if (currentQuote) {
    const priceText = `현재가 ${formatNumber(currentQuote.price)}${currentQuote.currency ? ` ${currentQuote.currency}` : ''} 확인`;
    facts.push(priceText);
  }

  if (holding.hasHoldingContext) {
    if (holding.shares !== null && holding.averagePrice !== null) {
      facts.push(`보유 ${formatNumber(holding.shares)}주 / 평단 ${formatNumber(holding.averagePrice)} 확인`);
    } else {
      facts.push('보유 맥락 일부 확인');
    }
  }

  if (pageCoverage.availableCount > 0) {
    facts.push(`KR 리포트 페이지 ${pageCoverage.availableCount}/${pageCoverage.totalKnownPages} 확보`);
  }

  if (reportSignals.recentReportCount && reportSignals.recentReportCount > 0) {
    facts.push(`최근 리포트 ${reportSignals.recentReportCount}건 확인`);
  }

  return facts.slice(0, 3);
}

function buildTopRisks({ currentQuote, holding, pageCoverage, sourceCoverage }) {
  const risks = [];

  if (!currentQuote) {
    risks.push('현재가 근거 없음');
  }

  if (holding.hasHoldingContext) {
    if (!holding.hasFullSellNowInputs) {
      risks.push('sell-now 입력 불완전');
    }
  } else {
    risks.push('KR 보유 맥락 없음');
  }

  if (pageCoverage.availableCount === 0) {
    risks.push('KR 리포트 페이지 근거 없음');
  } else if (pageCoverage.missingPageIds.length > 0) {
    risks.push(`미확보 KR 페이지 ${pageCoverage.missingPageIds.length}건`);
  }

  return risks.slice(0, 3);
}

export function buildDeepScanKrEvidencePacket(input = {}, sources = {}) {
  const safeInput = asObject(input);
  const safeSources = asObject(sources);
  const rawInstrument = asObject(safeInput.instrument);
  const rawHolding = asObject(safeInput.holding);
  const slim = asObject(safeSources.slim);
  const slimCompany = asObject(slim.company);
  const slimPages = asObject(slim.pages);
  const packageResult = asObject(safeSources.packageResult);

  const instrument = {
    code: pickFirst(
      normalizeCode(rawInstrument.code),
      normalizeCode(safeInput.code),
      normalizeCode(slim.code),
      normalizeCode(slimCompany.code),
      normalizeCode(packageResult.stockCode),
    ),
    name: pickFirst(
      normalizeText(rawInstrument.name),
      normalizeText(safeInput.name),
      normalizeText(slimCompany.name),
    ),
    market: pickFirst(
      normalizeText(packageResult.listingMarket),
      normalizeText(slimPages['company-overview']?.summary?.market),
      normalizeText(rawInstrument.market),
      normalizeText(safeInput.market),
    ),
  };

  const holding = {
    shares: pickFirst(
      normalizeNumber(rawHolding.shares),
      normalizeNumber(safeInput.shares),
      normalizeNumber(safeInput.holdingQty),
    ),
    averagePrice: pickFirst(
      normalizeNumber(rawHolding.averagePrice),
      normalizeNumber(safeInput.averagePrice),
      normalizeNumber(safeInput.avgPrice),
    ),
    evaluationAmount: pickFirst(
      normalizeNumber(rawHolding.evaluationAmount),
      normalizeNumber(safeInput.evaluationAmount),
    ),
    hasHoldingContext: false,
    hasFullSellNowInputs: false,
  };

  holding.hasHoldingContext = holding.shares !== null || holding.averagePrice !== null || holding.evaluationAmount !== null;

  const currentQuote = resolveCurrentQuote(safeSources.quotes, instrument.code);
  holding.hasFullSellNowInputs = holding.shares !== null && holding.averagePrice !== null && currentQuote !== null;

  const availablePageIds = KNOWN_PAGE_IDS.filter((pageId) => hasEvidence(slimPages[pageId]));
  const missingPageIds = KNOWN_PAGE_IDS.filter((pageId) => !hasEvidence(slimPages[pageId]));
  const pageCoverage = {
    totalKnownPages: KNOWN_PAGE_IDS.length,
    availablePageIds,
    missingPageIds,
    availableCount: availablePageIds.length,
  };

  const reportSignals = {
    consensusAvailable: hasEvidence(slimPages.consensus),
    opinionAvailable: hasEvidence(slimPages.opinion),
    recentReportsAvailable: hasEvidence(slimPages['recent-reports']),
    relativeReturnAvailable: hasEvidence(slimPages['relative-return']),
    styleAnalysisAvailable: hasEvidence(slimPages['style-analysis']),
    recentReportCount: null,
  };

  const recentReportCount = countRecentReports(slimPages['recent-reports']);
  reportSignals.recentReportCount = recentReportCount;
  if (recentReportCount !== null) {
    reportSignals.recentReportsAvailable = recentReportCount > 0;
  }

  const sourceCoverage = {
    hasCurrentQuote: currentQuote !== null,
    hasHolding: holding.hasHoldingContext,
    hasPackageResult: Object.keys(packageResult).length > 0,
    availableReportPages: availablePageIds,
  };

  const missingSources = [];
  if (Object.keys(slim).length === 0) {
    missingSources.push('slim');
  }
  if (!sourceCoverage.hasCurrentQuote) {
    missingSources.push('current-quote');
  }
  if (!sourceCoverage.hasHolding) {
    missingSources.push('holding');
  }

  return {
    instrument,
    holding,
    currentQuote,
    pageCoverage,
    sourceCoverage,
    reportSignals,
    missingSources,
    topFacts: buildTopFacts({ currentQuote, holding, pageCoverage, reportSignals }),
    topRisks: buildTopRisks({ currentQuote, holding, pageCoverage, sourceCoverage }),
  };
}
