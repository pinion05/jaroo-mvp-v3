import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { WISEREPORT_KR_PAGES } = require('../crawlers/wisereport-kr/page-specs.cjs');

const KNOWN_PAGE_IDS = Object.freeze(WISEREPORT_KR_PAGES.map((page) => page.id));
const OCRISH_NUMBER_TEXT_PATTERN = /(shares?|share|stocks?|stock|주|원|krw|usd|eur|jpy|cny|aud|cad|hkd)/gi;
const LABEL_PREFIX_PATTERN = /^(?:펼치기|접기)\s*/;

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

function normalizeLabel(value) {
  const normalized = normalizeText(value);
  return normalized ? normalized.replace(LABEL_PREFIX_PATTERN, '').replace(/\s+/g, '') : null;
}

function normalizeDate(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }

  const slashMatch = normalized.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (slashMatch) {
    return `${slashMatch[1]}-${slashMatch[2]}-${slashMatch[3]}`;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return normalized;
  }

  if (/^\d{4}-\d{2}-\d{2}T/.test(normalized)) {
    return normalized.slice(0, 10);
  }

  return null;
}

function safeDateDistanceInDays(left, right) {
  if (!left || !right) {
    return null;
  }

  const leftDate = new Date(left);
  const rightDate = new Date(right);
  if (Number.isNaN(leftDate.getTime()) || Number.isNaN(rightDate.getTime())) {
    return null;
  }

  return Math.round((leftDate.getTime() - rightDate.getTime()) / (24 * 60 * 60 * 1000));
}

function collectRows(value, bucket = []) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectRows(entry, bucket);
    }
    return bucket;
  }

  if (!value || typeof value !== 'object') {
    return bucket;
  }

  if (Array.isArray(value.rows)) {
    for (const row of value.rows) {
      if (row && typeof row === 'object' && !Array.isArray(row)) {
        bucket.push(row);
      }
    }
  }

  for (const nested of Object.values(value)) {
    if (nested && typeof nested === 'object') {
      collectRows(nested, bucket);
    }
  }

  return bucket;
}

function findNumericColumns(row) {
  if (!row || typeof row !== 'object') {
    return [];
  }

  return Object.entries(row)
    .map(([key, value]) => ({ key, value: normalizeNumber(value) }))
    .filter((entry) => entry.value !== null && !['항목', '구분', '요인', '의견', '일자', 'TRD_DT', 'NM'].includes(entry.key));
}

function pickLatestPrevFromRows(rows, labelPatterns) {
  for (const row of rows) {
    const label = normalizeLabel(row.항목 ?? row.구분 ?? row.요인 ?? row.label);
    if (!label) {
      continue;
    }

    if (!labelPatterns.some((pattern) => pattern.test(label))) {
      continue;
    }

    const numericColumns = findNumericColumns(row);
    if (numericColumns.length === 0) {
      continue;
    }

    return {
      latest: numericColumns[0]?.value ?? null,
      prev: numericColumns[1]?.value ?? null,
    };
  }

  return {
    latest: null,
    prev: null,
  };
}

function computeChangePct(latest, prev) {
  if (latest === null || prev === null || prev === 0) {
    return null;
  }

  return ((latest - prev) / Math.abs(prev)) * 100;
}

function findNamedValue(rows, labelPatterns) {
  for (const row of rows) {
    const label = normalizeLabel(row.항목 ?? row.구분 ?? row.요인 ?? row.label);
    if (!label) {
      continue;
    }

    if (!labelPatterns.some((pattern) => pattern.test(label))) {
      continue;
    }

    for (const [key, value] of Object.entries(row)) {
      if (key === '항목' || key === '구분' || key === '요인' || key === 'label') {
        continue;
      }

      const numeric = normalizeNumber(value);
      if (numeric !== null) {
        return numeric;
      }

      const text = normalizeText(value);
      if (text) {
        return text;
      }
    }
  }

  return null;
}

function extractRecommendation(opinionPage, consensusPage) {
  const opinionRows = collectRows(opinionPage);
  for (const row of opinionRows) {
    const recommendation = normalizeText(row.의견 ?? row.투자의견 ?? row.recommendation);
    if (recommendation) {
      return recommendation;
    }
  }

  const consensusRows = collectRows(consensusPage);
  const value = findNamedValue(consensusRows, [/의견/i, /투자의견/i, /recommend/i]);
  return typeof value === 'string' ? value : null;
}

function extractConsensusSnapshot(consensusPage, opinionPage, currentPrice) {
  const rows = collectRows(consensusPage);
  const targetPrice = normalizeNumber(findNamedValue(rows, [/목표주가/i, /targetprice/i]));
  const recommendation = extractRecommendation(opinionPage, consensusPage);
  return {
    targetPrice,
    targetGapPct: currentPrice !== null && targetPrice !== null && currentPrice !== 0
      ? ((targetPrice - currentPrice) / currentPrice) * 100
      : null,
    recommendation,
    recommendationCounts: null,
    revisionDirection: 'unknown',
    revisionPct: null,
  };
}

function extractValuationSnapshot(indicatorsPage, financePage) {
  const indicatorRows = collectRows(indicatorsPage);
  const financeRows = collectRows(financePage);
  return {
    per: normalizeNumber(findNamedValue(indicatorRows, [/per/i])),
    pbr: normalizeNumber(findNamedValue(indicatorRows, [/pbr/i])),
    roe: normalizeNumber(findNamedValue(indicatorRows, [/roe/i])) ?? normalizeNumber(findNamedValue(financeRows, [/roe/i])),
    evEbitda: normalizeNumber(findNamedValue(indicatorRows, [/evebitda/i, /ev\/ebitda/i])),
  };
}

function extractRelativeReturnSnapshot(relativeReturnPage) {
  const chart = Array.isArray(relativeReturnPage?.chartJson?.CHART) ? relativeReturnPage.chartJson.CHART : [];
  const points = chart
    .map((entry) => ({
      date: normalizeDate(entry?.TRD_DT ?? entry?.date ?? entry?.일자),
      value: normalizeNumber(entry?.J_PRC ?? entry?.close ?? entry?.전일종가 ?? entry?.종가 ?? entry?.value),
    }))
    .filter((entry) => entry.date && entry.value !== null)
    .sort((left, right) => left.date.localeCompare(right.date));

  if (points.length < 2) {
    return {
      return1w: null,
      return1m: null,
      return3m: null,
      return6m: null,
      return1y: null,
    };
  }

  const latest = points.at(-1);
  const computeWindowReturn = (days) => {
    const candidate = [...points].reverse().find((point) => {
      const distance = safeDateDistanceInDays(latest.date, point.date);
      return distance !== null && distance >= days;
    }) ?? points[0];

    return candidate && candidate.value !== null && latest.value !== null && candidate.value !== 0
      ? ((latest.value - candidate.value) / candidate.value) * 100
      : null;
  };

  return {
    return1w: computeWindowReturn(7),
    return1m: computeWindowReturn(30),
    return3m: computeWindowReturn(90),
    return6m: computeWindowReturn(180),
    return1y: computeWindowReturn(365),
  };
}

function extractStyleAnalysisSnapshot(stylePage) {
  const chartRows = Array.isArray(stylePage?.factorScores?.CHART_H) ? stylePage.factorScores.CHART_H : [];
  return {
    factorScores: chartRows
      .map((entry) => ({
        name: normalizeText(entry?.NM ?? entry?.name),
        value: normalizeNumber(entry?.VAL ?? entry?.value),
      }))
      .filter((entry) => entry.name || entry.value !== null)
      .slice(0, 5),
  };
}

function extractOwnershipSnapshot(shareholdingPage) {
  const rows = collectRows(shareholdingPage);
  const majorHolderPct = normalizeNumber(findNamedValue(rows, [/최대주주/i]));
  const foreignOwnershipPct = normalizeNumber(findNamedValue(rows, [/외국인/i]));
  const institutionalOwnershipPct = normalizeNumber(findNamedValue(rows, [/기관/i]));
  const firstSummaryRow = rows.find((row) => hasEvidence(row));
  return {
    majorHolderPct,
    foreignOwnershipPct,
    institutionalOwnershipPct,
    latestOwnershipChangeSummary: firstSummaryRow
      ? Object.entries(firstSummaryRow)
        .filter(([key]) => key !== '구분' && key !== '항목')
        .map(([key, value]) => `${key} ${normalizeText(value) ?? normalizeNumber(value) ?? ''}`.trim())
        .filter(Boolean)
        .join(' · ') || null
      : null,
  };
}

function extractFinancialSnapshot(financialAnalysisPage, financePage) {
  const rows = [...collectRows(financialAnalysisPage), ...collectRows(financePage)];
  const revenue = pickLatestPrevFromRows(rows, [/매출/i, /매출액/i, /수익/i]);
  const operatingIncome = pickLatestPrevFromRows(rows, [/영업이익/i]);
  const netIncome = pickLatestPrevFromRows(rows, [/순이익/i, /당기순이익/i]);
  const operatingMarginLatest = normalizeNumber(findNamedValue(rows, [/영업이익률/i]));
  const netMarginLatest = normalizeNumber(findNamedValue(rows, [/순이익률/i, /순이익률/i]));

  return {
    revenueLatest: revenue.latest,
    revenuePrev: revenue.prev,
    revenueYoY: computeChangePct(revenue.latest, revenue.prev),
    operatingIncomeLatest: operatingIncome.latest,
    operatingIncomePrev: operatingIncome.prev,
    operatingIncomeYoY: computeChangePct(operatingIncome.latest, operatingIncome.prev),
    netIncomeLatest: netIncome.latest,
    netIncomePrev: netIncome.prev,
    netIncomeYoY: computeChangePct(netIncome.latest, netIncome.prev),
    operatingMarginLatest,
    netMarginLatest,
  };
}

function splitNarratives(value, bucket = []) {
  if (typeof value === 'string') {
    const parts = value.split(/[\n\r]+|(?<=[.!?。])\s+/).map((entry) => normalizeText(entry)).filter(Boolean);
    bucket.push(...parts);
    return bucket;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      splitNarratives(entry, bucket);
    }
    return bucket;
  }

  if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) {
      splitNarratives(entry, bucket);
    }
  }

  return bucket;
}

function buildPackageContext(packageResult) {
  const available = Object.keys(packageResult).length > 0;
  if (!available) {
    return {
      available: false,
      summaryFacts: [],
      marketView: null,
      boardHighlights: [],
    };
  }

  const summaryFacts = splitNarratives([
    packageResult.reportContent,
    packageResult.marketScoreSnapshot?.summary,
    packageResult.boardAnalysis?.boardOpinions,
  ]).slice(0, 3);

  const boardHighlights = splitNarratives(packageResult.boardAnalysis?.boardOpinions).slice(0, 3);

  return {
    available: true,
    summaryFacts,
    marketView: normalizeText(packageResult.boardAnalysis?.boardMarketEvaluation) ?? normalizeText(packageResult.marketScoreSnapshot?.summary),
    boardHighlights,
  };
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
  const quoteAsOf = normalizeDate(currentQuote?.asOf);
  const selectedAt = normalizeDate(safeInput.selectedAt);
  const recentReportsPage = slimPages['recent-reports'];
  const recentReportRows = collectRows(recentReportsPage);
  const reportAsOf = recentReportRows
    .map((row) => normalizeDate(row.date ?? row.일자 ?? row.작성일 ?? row.publishedAt))
    .find(Boolean) ?? null;

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

  const marketSnapshot = {
    currentPrice: currentQuote?.price ?? null,
    currency: currentQuote?.currency ?? 'KRW',
    averagePriceGapPct: currentQuote && holding.averagePrice !== null && holding.averagePrice !== 0
      ? ((currentQuote.price - holding.averagePrice) / holding.averagePrice) * 100
      : null,
    evaluationPnL: currentQuote && holding.averagePrice !== null && holding.shares !== null
      ? (currentQuote.price - holding.averagePrice) * holding.shares
      : null,
    evaluationPnLPct: currentQuote && holding.averagePrice !== null && holding.averagePrice !== 0
      ? ((currentQuote.price - holding.averagePrice) / holding.averagePrice) * 100
      : null,
  };

  const consensusSnapshot = extractConsensusSnapshot(slimPages.consensus, slimPages.opinion, marketSnapshot.currentPrice);
  const valuationSnapshot = extractValuationSnapshot(slimPages['investment-indicators'], slimPages['fnguide-finance']);
  const relativeReturnSnapshot = extractRelativeReturnSnapshot(slimPages['relative-return']);
  const styleAnalysisSnapshot = extractStyleAnalysisSnapshot(slimPages['style-analysis']);
  const ownershipSnapshot = extractOwnershipSnapshot(slimPages.shareholding);
  const financialSnapshot = extractFinancialSnapshot(slimPages['financial-analysis'], slimPages['fnguide-finance']);
  const packageContext = buildPackageContext(packageResult);

  return {
    instrument,
    timestamps: {
      selectedAt,
      quoteAsOf,
      reportAsOf,
      hasFutureDateMismatch: Boolean(selectedAt && quoteAsOf && quoteAsOf > selectedAt),
      hasStaleQuote: Boolean(selectedAt && quoteAsOf && safeDateDistanceInDays(selectedAt, quoteAsOf) !== null && safeDateDistanceInDays(selectedAt, quoteAsOf) > 7),
    },
    holding,
    currentQuote,
    marketSnapshot,
    pageCoverage,
    sourceCoverage,
    reportSignals,
    consensusSnapshot,
    valuationSnapshot,
    relativeReturnSnapshot,
    styleAnalysisSnapshot,
    ownershipSnapshot,
    financialSnapshot,
    packageContext,
    missingSources,
    topFacts: buildTopFacts({ currentQuote, holding, pageCoverage, reportSignals }),
    topRisks: buildTopRisks({ currentQuote, holding, pageCoverage, sourceCoverage }),
  };
}
