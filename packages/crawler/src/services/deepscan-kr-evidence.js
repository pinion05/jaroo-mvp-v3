import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  WISEREPORT_KR_PAGES,
  WISEREPORT_KR_V12_PAGES,
} = require('../crawlers/wisereport-kr/page-specs.cjs');

const KNOWN_PAGE_IDS = Object.freeze(WISEREPORT_KR_PAGES.map((page) => page.id));
const KNOWN_V12_PAGE_IDS = Object.freeze(WISEREPORT_KR_V12_PAGES.map((page) => page.id));
const V12_EXTRA_PAGE_IDS = Object.freeze(KNOWN_V12_PAGE_IDS.filter((pageId) => !KNOWN_PAGE_IDS.includes(pageId)));
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

function normalizePercent(value) {
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

  const parenthesizedPercentMatch = normalizedValue.match(/\(([-+]?(?:\d[\d,]*\.?\d*|\.\d+))\s*%?\)/);
  if (parenthesizedPercentMatch) {
    return normalizeNumber(parenthesizedPercentMatch[1]);
  }

  const explicitPercentMatch = normalizedValue.match(/([-+]?(?:\d[\d,]*\.?\d*|\.\d+))\s*%/);
  if (explicitPercentMatch) {
    return normalizeNumber(explicitPercentMatch[1]);
  }

  if (/주/.test(normalizedValue)) {
    return null;
  }

  return normalizeNumber(normalizedValue);
}

function normalizeShareCount(value) {
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

  const shareMatch = normalizedValue.match(/([-+]?(?:\d[\d,]*\.?\d*|\.\d+))\s*주/);
  if (shareMatch) {
    return normalizeNumber(shareMatch[1]);
  }

  if (/%/.test(normalizedValue)) {
    return null;
  }

  return normalizeNumber(normalizedValue);
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

function resolveKnownPageIds(slimSource, slimPages) {
  const schemaVersion = normalizeText(slimSource?.schemaVersion);
  const declaredTotalPages = slimSource?.sourceCoverage?.pageCoverage?.totalKnownPages;
  const hasV12Extras = V12_EXTRA_PAGE_IDS.some((pageId) => hasEvidence(slimPages?.[pageId]));

  if (
    /v1\.2/i.test(schemaVersion ?? '')
    || hasV12Extras
    || (typeof declaredTotalPages === 'number' && declaredTotalPages > KNOWN_PAGE_IDS.length)
  ) {
    return KNOWN_V12_PAGE_IDS;
  }

  return KNOWN_PAGE_IDS;
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

  const dotMatch = normalized.match(/^(\d{4})\.(\d{2})\.(\d{2})$/);
  if (dotMatch) {
    return `${dotMatch[1]}-${dotMatch[2]}-${dotMatch[3]}`;
  }

  const shortSlashMatch = normalized.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  if (shortSlashMatch) {
    const year = Number(shortSlashMatch[1]);
    const century = year >= 70 ? 1900 : 2000;
    return `${century + year}-${shortSlashMatch[2]}-${shortSlashMatch[3]}`;
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

function getRowLabel(row) {
  if (!row || typeof row !== 'object') {
    return null;
  }

  return normalizeLabel(
    row.항목
      ?? row.구분
      ?? row.key
      ?? row.요인
      ?? row.label
      ?? row.항목명
      ?? row['IFRS (연결) | 연간'],
  );
}

function isLabelMatch(row, labelPatterns) {
  const label = getRowLabel(row);
  return Boolean(label && labelPatterns.some((pattern) => pattern.test(label)));
}

function isLabelKey(key) {
  return ['항목', '구분', 'key', '요인', '의견', '일자', 'TRD_DT', 'NM', 'label', '항목명', '상세기준', '분류'].includes(key);
}

function parsePeriodColumnKey(key) {
  if (typeof key !== 'string') {
    return null;
  }

  const trimmedKey = key.trim();
  const periodMatch = trimmedKey.match(/^(\d{4})[./-](\d{2})(?![./-]\d{2})/);
  if (!periodMatch) {
    return null;
  }

  const year = Number(periodMatch[1]);
  const month = Number(periodMatch[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }

  return {
    year,
    month,
    order: year * 12 + month,
    isEstimate: /\(E\)|\bE\b|컨센서스/.test(trimmedKey),
    isAnnual: month === 12 || /연간/.test(trimmedKey),
    isQuarter: /분기|최근분기/.test(trimmedKey) || month !== 12,
  };
}

function findNumericColumns(row) {
  if (!row || typeof row !== 'object') {
    return [];
  }

  return Object.entries(row)
    .map(([key, value]) => ({ key, value: normalizeNumber(value) }))
    .filter((entry) => entry.value !== null && !isLabelKey(entry.key));
}

function findPeriodNumericColumns(row) {
  return findNumericColumns(row)
    .map((entry) => ({
      ...entry,
      period: parsePeriodColumnKey(entry.key),
    }))
    .filter((entry) => entry.period);
}

function sortPeriodColumnsDesc(left, right) {
  if (left.period.order !== right.period.order) {
    return right.period.order - left.period.order;
  }

  if (left.period.isEstimate !== right.period.isEstimate) {
    return left.period.isEstimate ? -1 : 1;
  }

  return left.key.localeCompare(right.key);
}

function pickPreferredNumericValueFromRow(row) {
  const periodColumns = findPeriodNumericColumns(row);
  if (periodColumns.length > 0) {
    const annualColumns = periodColumns.filter((entry) => entry.period.isAnnual);
    const preferredColumns = annualColumns.length > 0 ? annualColumns : periodColumns;
    return [...preferredColumns].sort(sortPeriodColumnsDesc)[0]?.value ?? null;
  }

  return findNumericColumns(row)[0]?.value ?? null;
}

function pickLatestPrevFromRows(rows, labelPatterns) {
  for (const row of rows) {
    if (!isLabelMatch(row, labelPatterns)) {
      continue;
    }

    const periodColumns = findPeriodNumericColumns(row);
    if (periodColumns.length > 0) {
      const annualColumns = periodColumns.filter((entry) => entry.period.isAnnual);
      const preferredColumns = (annualColumns.length > 0 ? annualColumns : periodColumns).sort(sortPeriodColumnsDesc);
      if (preferredColumns.length > 0) {
        return {
          latest: preferredColumns[0]?.value ?? null,
          prev: preferredColumns[1]?.value ?? null,
        };
      }
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
  let textFallback = null;

  for (const row of rows) {
    if (!isLabelMatch(row, labelPatterns)) {
      continue;
    }

    const numeric = pickPreferredNumericValueFromRow(row);
    if (numeric !== null) {
      return numeric;
    }

    for (const [key, value] of Object.entries(row)) {
      if (isLabelKey(key)) {
        continue;
      }

      const text = normalizeText(value);
      if (text && textFallback === null) {
        textFallback = text;
      }
    }
  }

  return textFallback;
}

function findFirstKeyValue(rows, keyPatterns) {
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      continue;
    }

    for (const [key, value] of Object.entries(row)) {
      const normalizedKey = normalizeLabel(key) ?? key;
      if (keyPatterns.some((pattern) => pattern.test(normalizedKey)) && hasEvidence(value)) {
        return value;
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

function pickOpinionConsensusRow(opinionPage) {
  const opinionRows = collectRows(opinionPage);
  return opinionRows.find((row) => normalizeText(row.추정기관)?.toLowerCase() === 'consensus' && normalizeNumber(row.적정주가) !== null)
    ?? opinionRows.find((row) => normalizeNumber(row.적정주가 ?? row.목표주가 ?? row.목표가) !== null)
    ?? null;
}

function readTargetPriceFromRow(row) {
  if (!row || typeof row !== 'object') {
    return null;
  }

  for (const [key, value] of Object.entries(row)) {
    const normalizedKey = normalizeLabel(key) ?? key;
    if (
      /(적정주가|목표주가|목표가|targetprice)/i.test(normalizedKey)
      && !/(직전|증감|변동|전일|previous|revision)/i.test(normalizedKey)
    ) {
      const numeric = normalizeNumber(value);
      if (numeric !== null) {
        return numeric;
      }
    }
  }

  return null;
}

function readPreviousTargetPriceFromRow(row) {
  if (!row || typeof row !== 'object') {
    return null;
  }

  for (const [key, value] of Object.entries(row)) {
    const normalizedKey = normalizeLabel(key) ?? key;
    if (/(직전|previous).*(적정주가|목표주가|목표가|targetprice)|(적정주가|목표주가|목표가|targetprice).*(직전|previous)/i.test(normalizedKey)) {
      const numeric = normalizeNumber(value);
      if (numeric !== null) {
        return numeric;
      }
    }
  }

  return null;
}

function readRevisionPctFromRow(row) {
  if (!row || typeof row !== 'object') {
    return null;
  }

  for (const [key, value] of Object.entries(row)) {
    const normalizedKey = normalizeLabel(key) ?? key;
    if (/(증감율|증감률|변동률|revision)/i.test(normalizedKey)) {
      const numeric = normalizePercent(value);
      if (numeric !== null) {
        return numeric;
      }
    }
  }

  return null;
}

function resolveRevisionDirection(revisionPct) {
  if (revisionPct === null) {
    return 'unknown';
  }

  if (revisionPct > 0) {
    return 'up';
  }

  if (revisionPct < 0) {
    return 'down';
  }

  return 'flat';
}

function extractConsensusSnapshot(consensusPage, opinionPage, currentPrice) {
  const consensusRows = collectRows(consensusPage);
  const opinionConsensusRow = pickOpinionConsensusRow(opinionPage);
  const opinionRows = opinionConsensusRow ? [opinionConsensusRow] : [];
  const targetPrice = pickFirst(
    readTargetPriceFromRow(opinionConsensusRow),
    normalizeNumber(findFirstKeyValue(consensusRows, [/목표주가/i, /목표가/i, /targetprice/i])),
    normalizeNumber(findNamedValue(consensusRows, [/목표주가/i, /목표가/i, /targetprice/i])),
  );
  const previousTargetPrice = pickFirst(
    readPreviousTargetPriceFromRow(opinionConsensusRow),
    normalizeNumber(findFirstKeyValue(consensusRows, [/직전.*목표/i, /previous.*target/i])),
  );
  const revisionPct = pickFirst(
    readRevisionPctFromRow(opinionConsensusRow),
    previousTargetPrice !== null && targetPrice !== null && previousTargetPrice !== 0
      ? ((targetPrice - previousTargetPrice) / Math.abs(previousTargetPrice)) * 100
      : null,
  );
  const recommendation = extractRecommendation(opinionPage, consensusPage);
  return {
    targetPrice,
    previousTargetPrice,
    targetGapPct: currentPrice !== null && targetPrice !== null && currentPrice !== 0
      ? ((targetPrice - currentPrice) / currentPrice) * 100
      : null,
    recommendation,
    recommendationScore: normalizeNumber(findFirstKeyValue(opinionRows, [/투자의견/i])),
    recommendationCounts: null,
    revisionDirection: resolveRevisionDirection(revisionPct),
    revisionPct,
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
  const chartHeaders = Array.isArray(stylePage?.factorScores?.CHART_H) ? stylePage.factorScores.CHART_H : [];
  const chartRows = Array.isArray(stylePage?.factorScores?.CHART_D) ? stylePage.factorScores.CHART_D : [];
  if (chartRows.length > 0) {
    const companySeries = chartHeaders[0]?.ID ?? 'VAL1';
    const peerSeries = chartHeaders[1]?.ID ?? 'VAL2';
    const companyName = normalizeText(chartHeaders[0]?.NAME);
    const peerName = normalizeText(chartHeaders[1]?.NAME);
    return {
      companyName,
      peerName,
      factorScores: chartRows
        .map((entry) => ({
          name: normalizeText(entry?.NM ?? entry?.name),
          value: normalizeNumber(entry?.[companySeries] ?? entry?.VAL1 ?? entry?.VAL ?? entry?.value),
          peerValue: normalizeNumber(entry?.[peerSeries] ?? entry?.VAL2 ?? entry?.peerValue),
        }))
        .filter((entry) => entry.name || entry.value !== null || entry.peerValue !== null)
        .slice(0, 12),
    };
  }

  const legacyRows = chartHeaders;
  return {
    factorScores: legacyRows
      .map((entry) => ({
        name: normalizeText(entry?.NM ?? entry?.name),
        value: normalizeNumber(entry?.VAL ?? entry?.value),
      }))
      .filter((entry) => entry.name || entry.value !== null)
      .slice(0, 5),
  };
}

function extractForeignOwnershipHistory(foreignOwnershipChartPage) {
  const chartRows = Array.isArray(foreignOwnershipChartPage?.chartJson?.CHART)
    ? foreignOwnershipChartPage.chartJson.CHART
    : [];

  return chartRows
    .map((row) => ({
      date: normalizeDate(row?.TRD_DT),
      foreignOwnershipPct: normalizePercent(row?.FRG_RT),
      closePrice: normalizeNumber(row?.J_PRC),
      marketCap: normalizeNumber(row?.MKT_CAP),
    }))
    .filter((row) => row.date && row.foreignOwnershipPct !== null)
    .sort((left, right) => left.date.localeCompare(right.date));
}

function extractAssetManagerHoldings(snapshotPage) {
  const rows = Array.isArray(snapshotPage?.assetManagerHoldings?.rows)
    ? snapshotPage.assetManagerHoldings.rows
    : [];

  return rows
    .map((row) => ({
      name: normalizeText(row.운용사명 ?? row.name),
      shares: normalizeNumber(row.보유수량 ?? row.shares),
      marketValue: normalizeNumber(row.시가평가액 ?? row.marketValue),
      listedSharePct: normalizePercent(row.상장주식수내비중 ?? row.listedSharePct),
      managerPortfolioPct: normalizePercent(row.운용사내비중 ?? row.managerPortfolioPct),
    }))
    .filter((row) => row.name || row.shares !== null || row.listedSharePct !== null)
    .slice(0, 10);
}

function extractFnguideShareholderDetails(shareAnalysisPage, snapshotPage) {
  const jsonRows = Array.isArray(shareAnalysisPage?.shareholderDetailsJson?.comp)
    ? shareAnalysisPage.shareholderDetailsJson.comp
    : [];
  const tableRows = Array.isArray(shareAnalysisPage?.shareholderDetails?.rows)
    ? shareAnalysisPage.shareholderDetails.rows
    : [];
  const snapshotRows = Array.isArray(snapshotPage?.snapshotMajorShareholders?.rows)
    ? snapshotPage.snapshotMajorShareholders.rows
    : [];

  return [...jsonRows, ...tableRows, ...snapshotRows]
    .map((row) => ({
      groupCode: normalizeText(row.SHER_GB_1),
      groupName: normalizeText(row.SHER_TYPE_NM ?? row.주주구분 ?? row.항목),
      representative: normalizeText(row.MAJ_SHER_NM ?? row.대표주주 ?? row.항목),
      name: normalizeText(row.SHER_NM ?? row.주주명 ?? row.변동주주 ?? row.항목),
      relationship: normalizeText(row.MAJ_REL_NM ?? row.관계),
      shares: normalizeShareCount(row.COMM_STK_QTY ?? row.보통주),
      pct: normalizePercent(row.SHER_RT ?? row.지분율),
      groupShares: normalizeShareCount(row.COMM_STK_QTY_SUM),
      groupPct: normalizePercent(row.SHER_RT_SUM),
      lastChangeDate: normalizeDate(row.CHG_DT ?? row.MAX_CHG_DT ?? row.최종변동일),
    }))
    .filter((row) => row.name || row.representative || row.pct !== null || row.shares !== null);
}

function extractFnguideShareholderChanges(shareAnalysisPage) {
  const jsonRows = Array.isArray(shareAnalysisPage?.shareholderChangesJson?.comp)
    ? shareAnalysisPage.shareholderChangesJson.comp.map((row) => ({
        row,
        sourcePath: 'fnguide-shareanalysis.shareholderChangesJson.comp',
      }))
    : [];
  const tableRows = Array.isArray(shareAnalysisPage?.shareholderChanges?.rows)
    ? shareAnalysisPage.shareholderChanges.rows.map((row) => ({
        row,
        sourcePath: 'fnguide-shareanalysis.shareholderChanges.rows',
      }))
    : [];

  return [...jsonRows, ...tableRows]
    .map(({ row, sourcePath }) => ({
      holderType: normalizeText(row.주주구분 ?? row.holderType),
      representative: normalizeText(row.대표주주 ?? row.representative),
      name: normalizeText(row.변동주주 ?? row.주주명 ?? row.name),
      tradeDate: normalizeDate(row.변동일 ?? row.거래일 ?? row.tradeDate),
      changeReason: normalizeText(row.변동사유 ?? row.changeReason),
      shareClass: normalizeText(row.주식종류 ?? row.shareClass),
      previousShares: normalizeShareCount(row.변동전주 ?? row.previousShares),
      changeShares: normalizeShareCount(row.증감주 ?? row.변동주식수 ?? row.changeShares),
      shares: normalizeShareCount(row.변동후주 ?? row['변동후 보유주식수'] ?? row.shares),
      pct: normalizePercent(row.지분율 ?? row['변동후 보유지분율(%)'] ?? row.pct),
      changePct: normalizePercent(row['지분 변동율(%)'] ?? row['변동지분 (%)'] ?? row.changePct),
      sourcePath,
    }))
    .filter((row) => row.name || row.representative || row.pct !== null || row.shares !== null || row.changeShares !== null);
}

function extractFnguideShareholderCategories(shareAnalysisPage, snapshotPage) {
  const rows = [
    ...(Array.isArray(shareAnalysisPage?.shareholderCategories?.rows) ? shareAnalysisPage.shareholderCategories.rows : []),
    ...(Array.isArray(snapshotPage?.shareholderCategories?.rows) ? snapshotPage.shareholderCategories.rows : []),
  ];

  return rows
    .map((row) => ({
      category: normalizeText(row.주주구분 ?? row.NM),
      representativeCount: normalizeNumber(row['대표 주주수'] ?? row.대표주주수),
      shares: normalizeShareCount(row.보통주),
      pct: normalizePercent(row.지분율 ?? row.STK_RT),
      lastChangeDate: normalizeDate(row.최종변동일),
    }))
    .filter((row) => row.category || row.pct !== null || row.shares !== null)
    .reduce((acc, row) => {
      if (!acc.some((item) => item.category === row.category)) {
        acc.push(row);
      }
      return acc;
    }, []);
}

function extractOwnershipSnapshot(shareholdingPage, snapshotPage = null, shareAnalysisPage = null, foreignOwnershipChartPage = null) {
  const rows = collectRows(shareholdingPage);
  const snapshotRows = collectRows(snapshotPage);
  const summaryRows = Array.isArray(shareholdingPage?.ownershipSummary?.rows) ? shareholdingPage.ownershipSummary.rows : [];
  const summaryValueRows = summaryRows.length > 0 ? summaryRows : rows;
  const majorHolderValue = findFirstKeyValue(summaryValueRows, [/최대주주.*보유지분/i]);
  const freeFloatShareValue = findFirstKeyValue(summaryValueRows, [/유동주식.*주식수/i]);
  const freeFloatPctValue = findFirstKeyValue(summaryValueRows, [/유동주식.*비율/i]);
  const fivePctHolderValue = findFirstKeyValue(summaryValueRows, [/5%이상주주.*보유지분/i]);
  const foreignOwnershipHistory = extractForeignOwnershipHistory(foreignOwnershipChartPage);
  const latestForeignOwnershipPoint = foreignOwnershipHistory.at(-1) ?? null;
  const snapshotForeignOwnershipPct = normalizePercent(findNamedValue(snapshotRows, [/외국인.*지분율/i, /외국인지분율/i]));
  const foreignOwnershipPct = pickFirst(
    latestForeignOwnershipPoint?.foreignOwnershipPct ?? null,
    snapshotForeignOwnershipPct,
    normalizePercent(findFirstKeyValue(rows, [/외국인.*(지분|보유|비율)/i])),
  );
  const institutionalOwnershipPct = normalizePercent(findFirstKeyValue([...rows, ...snapshotRows], [/(기관|연기금|투신|보험).*?(지분|보유|비율)/i]));
  const majorShareholderRows = Array.isArray(shareholdingPage?.majorShareholders?.rows) ? shareholdingPage.majorShareholders.rows : [];
  const shareholderChangeRows = Array.isArray(shareholdingPage?.shareholderChanges?.rows) ? shareholdingPage.shareholderChanges.rows : [];
  const fnguideShareholderDetails = extractFnguideShareholderDetails(shareAnalysisPage, snapshotPage);
  const fnguideShareholderChanges = extractFnguideShareholderChanges(shareAnalysisPage);
  const fnguideShareholderCategories = extractFnguideShareholderCategories(shareAnalysisPage, snapshotPage);
  const assetManagerHoldings = extractAssetManagerHoldings(snapshotPage);
  const assetManagerOwnershipPctSum = assetManagerHoldings.length > 0
    ? Math.round(assetManagerHoldings.reduce((sum, row) => sum + (row.listedSharePct ?? 0), 0) * 100) / 100
    : null;
  const majorShareholders = majorShareholderRows
    .map((row) => ({
      name: normalizeText(row.대표주주) ?? normalizeText(row.보고자) ?? normalizeText(row.주주명),
      reporter: normalizeText(row.보고자) ?? normalizeText(row.대표주주) ?? normalizeText(row.주주명),
      shares: normalizeShareCount(row.보유주식수 ?? row['변동후 보유주식수']),
      pct: normalizePercent(row['보유지분 (%)'] ?? row['변동후 보유지분율(%)']),
      lastTradeDate: normalizeDate(row.최종거래일 ?? row.거래일),
      changeShares: normalizeNumber(row.변동주식수),
      changePct: normalizePercent(row['변동지분 (%)'] ?? row['지분 변동율(%)']),
      changeReason: normalizeText(row.변동사유),
    }))
    .filter((entry) => entry.name || entry.reporter || entry.pct !== null || entry.shares !== null)
    .concat(fnguideShareholderDetails
      .map((row) => ({
        name: row.representative ?? row.name,
        reporter: row.name ?? row.representative,
        shares: row.groupShares ?? row.shares,
        pct: row.groupPct ?? row.pct,
        lastTradeDate: row.lastChangeDate,
        changeShares: null,
        changePct: null,
        changeReason: null,
      }))
      .filter((entry) => entry.name || entry.reporter || entry.pct !== null || entry.shares !== null))
    .reduce((acc, entry) => {
      const key = `${entry.name ?? ''}|${entry.reporter ?? ''}|${entry.pct ?? ''}`;
      if (!acc.some((item) => `${item.name ?? ''}|${item.reporter ?? ''}|${item.pct ?? ''}` === key)) {
        acc.push(entry);
      }
      return acc;
    }, [])
    .slice(0, 10);

  const institutionalNamePattern = /(국민연금|연기금|공무원연금|사학연금|자산운용|투자신탁|투신|보험|은행|캐피탈|증권|기관)/;
  const knownInstitutionalMajorHolderCandidates = [
    ...fnguideShareholderChanges.map((row) => ({
      name: row.name ?? row.representative,
      pct: row.pct,
      shares: row.shares,
      lastTradeDate: row.tradeDate,
      changePct: row.changePct,
      changeReason: row.changeReason,
      sourcePath: row.sourcePath,
    })),
    ...majorShareholderRows.map((row) => ({
      name: normalizeText(row.주주명) ?? normalizeText(row.보고자) ?? normalizeText(row.대표주주),
      pct: normalizePercent(row['변동후 보유지분율(%)'] ?? row['보유지분 (%)']),
      shares: normalizeShareCount(row['변동후 보유주식수'] ?? row.보유주식수),
      lastTradeDate: normalizeDate(row.거래일 ?? row.최종거래일),
      changePct: normalizePercent(row['지분 변동율(%)'] ?? row['변동지분 (%)']),
      changeReason: normalizeText(row.변동사유),
      sourcePath: 'shareholding.majorShareholders.rows',
    })),
    ...shareholderChangeRows.map((row) => ({
      name: normalizeText(row.주주명) ?? normalizeText(row.보고자) ?? normalizeText(row.대표주주),
      pct: normalizePercent(row['변동후 보유지분율(%)'] ?? row['보유지분 (%)']),
      shares: normalizeShareCount(row['변동후 보유주식수'] ?? row.보유주식수),
      lastTradeDate: normalizeDate(row.거래일 ?? row.최종거래일),
      changePct: normalizePercent(row['지분 변동율(%)'] ?? row['변동지분 (%)']),
      changeReason: normalizeText(row.변동사유),
      sourcePath: 'shareholding.shareholderChanges.rows',
    })),
    ...fnguideShareholderDetails.map((row) => ({
      name: row.representative ?? row.name,
      pct: row.groupPct ?? row.pct,
      shares: row.groupShares ?? row.shares,
      lastTradeDate: row.lastChangeDate,
      changePct: null,
      changeReason: null,
      sourcePath: 'fnguide-shareanalysis.shareholderDetailsJson.comp',
    })),
  ];
  const knownInstitutionalMajorHoldersWithSources = knownInstitutionalMajorHolderCandidates
    .map((row) => ({
      name: row.name,
      pct: row.pct,
      shares: row.shares,
      lastTradeDate: row.lastTradeDate,
      changePct: row.changePct,
      changeReason: row.changeReason,
      sourcePath: row.sourcePath,
    }))
    .filter((entry) => entry.name && institutionalNamePattern.test(entry.name))
    .reduce((acc, entry) => {
      const existing = acc.find((item) => item.name === entry.name);
      if (existing) {
        for (const key of ['pct', 'shares', 'lastTradeDate', 'changePct', 'changeReason']) {
          if (existing[key] === null || existing[key] === undefined) {
            existing[key] = entry[key];
          }
        }
      } else {
        acc.push(entry);
      }
      return acc;
    }, [])
    .slice(0, 5);
  const knownInstitutionalMajorHolders = knownInstitutionalMajorHoldersWithSources
    .map(({ sourcePath: _sourcePath, ...entry }) => entry);
  const knownInstitutionalMajorHolderSourcePaths = [
    ...new Set(knownInstitutionalMajorHoldersWithSources.map((entry) => entry.sourcePath).filter(Boolean)),
  ];
  const ownershipChanges = [
    ...fnguideShareholderChanges.map((row) => ({ ...row })),
    ...shareholderChangeRows.map((row) => ({
      holderType: normalizeText(row.주주구분 ?? row.holderType),
      representative: normalizeText(row.대표주주 ?? row.보고자 ?? row.representative),
      name: normalizeText(row.변동주주 ?? row.주주명 ?? row.name),
      tradeDate: normalizeDate(row.변동일 ?? row.거래일 ?? row.tradeDate),
      changeReason: normalizeText(row.변동사유 ?? row.changeReason),
      shareClass: normalizeText(row.주식종류 ?? row.shareClass),
      previousShares: normalizeShareCount(row.변동전주 ?? row.previousShares),
      changeShares: normalizeShareCount(row.증감주 ?? row.변동주식수 ?? row.changeShares),
      shares: normalizeShareCount(row.변동후주 ?? row['변동후 보유주식수'] ?? row.shares),
      pct: normalizePercent(row.지분율 ?? row['변동후 보유지분율(%)'] ?? row.pct),
      changePct: normalizePercent(row['지분 변동율(%)'] ?? row['변동지분 (%)'] ?? row.changePct),
      sourcePath: 'shareholding.shareholderChanges.rows',
    })),
  ]
    .filter((row) => row.name || row.representative || row.pct !== null || row.shares !== null || row.changeShares !== null)
    .slice(0, 10);

  const sourceLimitations = [];
  if (foreignOwnershipPct === null) {
    sourceLimitations.push({
      fact: 'foreignOwnershipPct',
      reasonCode: 'not_provided_by_wisereport_fnguide_dump',
      message: 'WiseReport/FnGuide KR 원본 덤프에 외국인 보유율 집계 필드가 없습니다.',
    });
  }
  if (institutionalOwnershipPct === null) {
    sourceLimitations.push({
      fact: 'institutionalOwnershipPct',
      reasonCode: 'aggregate_not_provided_by_wisereport_fnguide_dump',
      message: 'WiseReport/FnGuide KR 원본 덤프에는 기관 전체 보유율 aggregate가 없고 운용사별 보유/5% 이상 보유자/변동 내역만 있습니다.',
    });
  }

  const latestFnguideChangeRow = fnguideShareholderChanges.find((row) => hasEvidence(row));
  const latestChangeRow = latestFnguideChangeRow ?? shareholderChangeRows.find((row) => hasEvidence(row));
  const firstSummaryRow = latestChangeRow ?? summaryRows.find((row) => hasEvidence(row)) ?? rows.find((row) => hasEvidence(row));
  return {
    majorHolderPct: normalizePercent(majorHolderValue),
    majorHolderShares: normalizeShareCount(majorHolderValue),
    fivePctHolderPct: normalizePercent(fivePctHolderValue),
    fivePctHolderShares: normalizeShareCount(fivePctHolderValue),
    freeFloatPct: normalizePercent(freeFloatPctValue),
    freeFloatShares: normalizeShareCount(freeFloatShareValue),
    foreignOwnershipPct,
    foreignOwnershipAsOf: latestForeignOwnershipPoint?.date ?? null,
    foreignOwnershipHistory,
    institutionalOwnershipPct,
    majorShareholders,
    knownInstitutionalMajorHolders,
    knownInstitutionalMajorHolderSourcePaths,
    ownershipChanges,
    assetManagerHoldings,
    assetManagerOwnershipPctSum,
    shareholderCategories: fnguideShareholderCategories,
    sourceLimitations,
    latestOwnershipChangeSummary: firstSummaryRow
      ? Object.entries(firstSummaryRow)
        .filter(([key]) => key !== '구분' && key !== '항목' && key !== 'sourcePath')
        .map(([key, value]) => `${key} ${normalizeText(value) ?? normalizeNumber(value) ?? ''}`.trim())
        .filter(Boolean)
        .join(' · ') || null
      : null,
  };
}

function extractFinancialSnapshot(financialAnalysisPage, financePage, indicatorsPage, consensusPage) {
  const rows = [...collectRows(financialAnalysisPage), ...collectRows(financePage), ...collectRows(consensusPage)];
  const indicatorRows = collectRows(indicatorsPage);
  const revenue = pickLatestPrevFromRows(rows, [/매출/i, /매출액/i, /수익/i]);
  const operatingIncome = pickLatestPrevFromRows(rows, [/영업이익/i]);
  const netIncome = pickLatestPrevFromRows(rows, [/순이익/i, /당기순이익/i]);
  const operatingMarginLatest = normalizeNumber(findNamedValue(indicatorRows, [/영업이익률/i]));
  const netMarginLatest = normalizeNumber(findNamedValue(indicatorRows, [/순이익률/i]));

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

function getRecentReportRows(page) {
  const safePage = asObject(page);
  const candidateArrays = [
    safePage.recentReports?.rows,
    safePage.recentReports,
    safePage.reports?.rows,
    safePage.reports,
    safePage.items,
    safePage.rows,
  ];

  for (const candidate of candidateArrays) {
    if (Array.isArray(candidate)) {
      return candidate.filter((item) => item && typeof item === 'object' && !Array.isArray(item));
    }
  }

  return [];
}

function countRecentReportsWithinDays(page, asOf, days) {
  const normalizedAsOf = normalizeDate(asOf);
  if (!normalizedAsOf) {
    return null;
  }

  const rows = getRecentReportRows(page);
  if (rows.length === 0) {
    return null;
  }

  let datedRows = 0;
  let count = 0;
  for (const row of rows) {
    const reportDate = normalizeDate(row.date ?? row.일자 ?? row.작성일 ?? row.publishedAt);
    const distance = safeDateDistanceInDays(normalizedAsOf, reportDate);
    if (distance === null) {
      continue;
    }
    datedRows += 1;
    if (distance >= 0 && distance <= days) {
      count += 1;
    }
  }

  return datedRows === 0 ? null : count;
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

  const knownPageIds = resolveKnownPageIds(safeSources.slim, slimPages);
  const availablePageIds = knownPageIds.filter((pageId) => hasEvidence(slimPages[pageId]));
  const missingPageIds = knownPageIds.filter((pageId) => !hasEvidence(slimPages[pageId]));
  const pageCoverage = {
    totalKnownPages: knownPageIds.length,
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
    recent30dReportCount: null,
  };

  const recentReportCount = countRecentReports(slimPages['recent-reports']);
  reportSignals.recentReportCount = recentReportCount;
  reportSignals.recent30dReportCount = countRecentReportsWithinDays(
    slimPages['recent-reports'],
    quoteAsOf ?? selectedAt ?? reportAsOf,
    30,
  );
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
  const ownershipSnapshot = extractOwnershipSnapshot(
    slimPages.shareholding,
    slimPages['fnguide-snapshot'],
    slimPages['fnguide-shareanalysis'],
    slimPages['fnguide-foreign-ownership-chart'],
  );
  const financialSnapshot = extractFinancialSnapshot(
    slimPages['financial-analysis'],
    slimPages['fnguide-finance'],
    slimPages['investment-indicators'],
    slimPages.consensus,
  );
  const packageContext = buildPackageContext(packageResult);
  const sourceLimitations = [
    ...(Array.isArray(ownershipSnapshot.sourceLimitations) ? ownershipSnapshot.sourceLimitations : []),
    ...(!packageContext.available
      ? [{
          fact: 'packageContext',
          reasonCode: 'package_result_not_attached_to_sources',
          message: '입력 sources에 packageResult가 없어 보조 패키지 문맥은 사용할 수 없습니다.',
        }]
      : []),
  ];

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
    sourceLimitations,
    missingSources,
    topFacts: buildTopFacts({ currentQuote, holding, pageCoverage, reportSignals }),
    topRisks: buildTopRisks({ currentQuote, holding, pageCoverage, sourceCoverage }),
  };
}
