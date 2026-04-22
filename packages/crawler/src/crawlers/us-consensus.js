/**
 * consensus.js — 미국주식 컨센서스 / 애널리스트 데이터
 *
 * - 기업 프로필: FMP `/stable/profile?symbol=`
 * - 컨센서스 목표가: FMP `/stable/price-target-consensus`
 * - 애널리스트 추정: FMP `/stable/analyst-estimates`
 * - 애널리스트 추천: FinnHub `/stock/recommendation`
 * - 투자의견: FMP `/stable/rating`
 * - 실적 캘린더: FMP `/stable/earning-calendar`
 */

import { fmpFetch, finnhubFetch, getProviderStatus } from './api-clients.js';
import { crawlWiseReportGlobal } from './wisereport-global.js';

function deriveRatingFromRecommendations(latestRec) {
  if (!latestRec) return null;
  const strongBuy = Number(latestRec.strongBuy || 0);
  const buy = Number(latestRec.buy || 0);
  const hold = Number(latestRec.hold || 0);
  const sell = Number(latestRec.sell || 0);
  const strongSell = Number(latestRec.strongSell || 0);
  const total = strongBuy + buy + hold + sell + strongSell;
  if (!total) return null;

  const score = Number((((strongBuy * 5) + (buy * 4) + (hold * 3) + (sell * 2) + strongSell) / total).toFixed(2));
  const label = score >= 4.5 ? 'Strong Buy'
    : score >= 3.5 ? 'Buy'
    : score >= 2.5 ? 'Hold'
    : score >= 1.5 ? 'Sell'
    : 'Strong Sell';

  return {
    source: 'finnhub-recommendation-derived',
    rating: label,
    score,
    totalAnalysts: total,
    period: latestRec.period ?? null,
  };
}

function firstNonEmptyValue(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== '') {
      return value;
    }
  }
  return null;
}

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeRecommendationSnapshot(latestRec) {
  if (!latestRec) return null;

  const strongBuy = Number(latestRec.strongBuy || 0);
  const buy = Number(latestRec.buy || 0);
  const hold = Number(latestRec.hold || 0);
  const sell = Number(latestRec.sell || 0);
  const strongSell = Number(latestRec.strongSell || 0);
  const totalAnalysts = strongBuy + buy + hold + sell + strongSell;

  return {
    provider: 'finnhub',
    source: 'finnhub-recommendation',
    period: latestRec.period ?? null,
    totalAnalysts,
    strongBuy,
    buy,
    hold,
    sell,
    strongSell,
    distribution: {
      strongBuy,
      buy,
      hold,
      sell,
      strongSell,
      total: totalAnalysts,
    },
    raw: latestRec,
  };
}

function normalizeConsensusRating(ratingRows, latestRec) {
  const rawRating = Array.isArray(ratingRows) && ratingRows.length > 0 ? ratingRows[0] : null;
  const derivedRating = deriveRatingFromRecommendations(latestRec);
  const recommendationSnapshot = normalizeRecommendationSnapshot(latestRec);

  if (!rawRating && !derivedRating && !recommendationSnapshot) return null;

  const label = firstNonEmptyValue(
    rawRating?.ratingRecommendation,
    rawRating?.rating,
    rawRating?.recommendation,
    derivedRating?.rating,
  );
  const score = firstNonEmptyValue(
    toFiniteNumber(rawRating?.ratingScore),
    toFiniteNumber(rawRating?.score),
    toFiniteNumber(derivedRating?.score),
  );
  const totalAnalysts = firstNonEmptyValue(
    toFiniteNumber(rawRating?.ratingCount),
    toFiniteNumber(rawRating?.numberOfAnalysts),
    toFiniteNumber(derivedRating?.totalAnalysts),
    recommendationSnapshot?.totalAnalysts,
  );

  return {
    provider: rawRating ? 'fmp' : 'finnhub',
    source: rawRating ? 'fmp-rating' : (derivedRating?.source ?? 'finnhub-recommendation-derived'),
    label,
    rating: label,
    recommendation: label,
    score,
    scaleMin: score !== null ? 1 : null,
    scaleMax: score !== null ? 5 : null,
    totalAnalysts,
    period: firstNonEmptyValue(rawRating?.date, rawRating?.period, derivedRating?.period, recommendationSnapshot?.period),
    distribution: recommendationSnapshot?.distribution ?? null,
    raw: rawRating ?? derivedRating ?? recommendationSnapshot?.raw ?? null,
  };
}

function normalizeConsensusEarningsItem(item, { provider, source } = {}) {
  if (!item || typeof item !== 'object') return null;

  const epsActual = firstNonEmptyValue(
    toFiniteNumber(item.eps),
    toFiniteNumber(item.actual),
    toFiniteNumber(item.epsActual),
  );
  const epsEstimate = firstNonEmptyValue(
    toFiniteNumber(item.epsEstimated),
    toFiniteNumber(item.estimate),
    toFiniteNumber(item.epsEstimate),
  );
  const revenueActual = firstNonEmptyValue(
    toFiniteNumber(item.revenue),
    toFiniteNumber(item.revenueActual),
  );
  const revenueEstimate = firstNonEmptyValue(
    toFiniteNumber(item.revenueEstimated),
    toFiniteNumber(item.revenueEstimate),
  );

  return {
    provider: provider ?? null,
    source: source ?? null,
    date: firstNonEmptyValue(item.date, item.period, item.fiscalDateEnding),
    period: item.period ?? null,
    fiscalDateEnding: item.fiscalDateEnding ?? null,
    quarter: toFiniteNumber(item.quarter),
    year: toFiniteNumber(item.year),
    time: item.time ?? null,
    epsActual,
    epsEstimate,
    actual: epsActual,
    estimate: epsEstimate,
    revenueActual,
    revenueEstimate,
    surprise: toFiniteNumber(item.surprise),
    surprisePercent: toFiniteNumber(item.surprisePercent),
    updatedFromDate: item.updatedFromDate ?? null,
    raw: item,
  };
}

function normalizeConsensusEarnings(earningsCalendar, earningsHistory) {
  if (Array.isArray(earningsCalendar) && earningsCalendar.length > 0) {
    return earningsCalendar
      .slice(0, 4)
      .map(item => normalizeConsensusEarningsItem(item, {
        provider: 'fmp',
        source: 'fmp-earning-calendar',
      }))
      .filter(Boolean);
  }

  if (Array.isArray(earningsHistory) && earningsHistory.length > 0) {
    return earningsHistory
      .slice(0, 4)
      .map(item => normalizeConsensusEarningsItem(item, {
        provider: 'finnhub',
        source: 'finnhub-earnings-history',
      }))
      .filter(Boolean);
  }

  return null;
}

function hasUsableConsensusData(data = {}) {
  return Boolean(
    data?.consensus
    || (Array.isArray(data?.analystEstimates) && data.analystEstimates.length > 0)
    || (data?.recommendations && (data.recommendations.totalAnalysts > 0 || data.recommendations.period))
    || (data?.rating && (data.rating.label || data.rating.score !== null || data.rating.totalAnalysts > 0))
    || (Array.isArray(data?.earnings) && data.earnings.length > 0)
  );
}

function buildWiseReportConsensusMeta(status, extra = {}) {
  return {
    attempted: status !== 'not_requested',
    source: 'wisereport-global',
    status,
    ...extra,
  };
}

export async function getFinnhubEarningsHistory(ticker, limit = 4) {
  const data = await finnhubFetch(
    `/stock/earnings?symbol=${encodeURIComponent(ticker)}`,
    { cacheTTL: 60 * 60 * 1000 }
  );
  if (!Array.isArray(data)) return null;
  return data.slice(0, limit).map(item => ({
    actual: item.actual ?? null,
    estimate: item.estimate ?? null,
    surprise: item.surprise ?? null,
    surprisePercent: item.surprisePercent ?? null,
    period: item.period ?? null,
    quarter: item.quarter ?? null,
    year: item.year ?? null,
  }));
}

// ── 기업 프로필 ───────────────────────────────────────

/**
 * 기업 프로필 조회 (FMP)
 * @param {string} ticker - 종목 심볼
 * @returns {Promise<Object|null>}
 */
export async function getCompanyProfile(ticker) {
  const data = await fmpFetch(
    `/stable/profile?symbol=${encodeURIComponent(ticker)}`,
    { cacheTTL: 60 * 60 * 1000 }  // 1시간 캐시
  );
  if (Array.isArray(data) && data.length) return data[0];

  const finnhubProfile = await finnhubFetch(
    `/stock/profile2?symbol=${encodeURIComponent(ticker)}`,
    { cacheTTL: 60 * 60 * 1000 }
  );
  if (!finnhubProfile || typeof finnhubProfile !== 'object' || !Object.keys(finnhubProfile).length) {
    return null;
  }

  return {
    companyName: finnhubProfile.name ?? null,
    industry: finnhubProfile.finnhubIndustry ?? null,
    sector: finnhubProfile.finnhubIndustry ?? null,
    description: null,
    ceo: null,
    website: finnhubProfile.weburl ?? null,
    exchange: finnhubProfile.exchange ?? null,
    mktCap: finnhubProfile.marketCapitalization ?? null,
    price: null,
    beta: null,
    lastDiv: null,
    image: finnhubProfile.logo ?? null,
    source: 'finnhub-profile2',
  };
}

// ── 컨센서스 / 목표가 ─────────────────────────────────

/**
 * 애널리스트 목표가 컨센서스 조회 (FMP v4)
 * @param {string} ticker - 종목 심볼
 * @returns {Promise<Object|null>}
 */
export async function getPriceTargetConsensus(ticker) {
  const data = await fmpFetch(
    `/stable/price-target-consensus?symbol=${encodeURIComponent(ticker)}`,
    { cacheTTL: 30 * 60 * 1000 }
  );
  if (!Array.isArray(data) || !data.length) return null;
  return data[0];
}

/**
 * 애널리스트 추정치 조회 (FMP)
 * @param {string} ticker - 종목 심볼
 * @param {'annual'|'quarter'} [period='annual']
 * @returns {Promise<Array|null>}
 */
export async function getAnalystEstimates(ticker, period = 'annual') {
  const data = await fmpFetch(
    `/stable/analyst-estimates?symbol=${encodeURIComponent(ticker)}&period=${period}`,
    { cacheTTL: 30 * 60 * 1000 }
  );
  return Array.isArray(data) ? data : null;
}

// ── 애널리스트 추천 ───────────────────────────────────

/**
 * 애널리스트 추천 등급 조회 (FinnHub)
 * @param {string} ticker - 종목 심볼
 * @returns {Promise<Array|null>} 최근 추천 배열 (시간 역순)
 */
export async function getAnalystRecommendations(ticker) {
  const data = await finnhubFetch(
    `/stock/recommendation?symbol=${encodeURIComponent(ticker)}`,
    { cacheTTL: 30 * 60 * 1000 }
  );
  return Array.isArray(data) ? data : null;
}

// ── 투자의견 (FMP Rating) ──────────────────────────────

/**
 * 종목 투자의견 등급 조회 (FMP)
 * @param {string} ticker - 종목 심볼
 * @returns {Promise<Array|null>}
 */
export async function getStockRating(ticker) {
  const data = await fmpFetch(
    `/stable/rating?symbol=${encodeURIComponent(ticker)}`,
    { cacheTTL: 15 * 60 * 1000 }
  );
  return Array.isArray(data) ? data : null;
}

// ── 실적 캘린더 ───────────────────────────────────────

/**
 * 실적 발표 캘린더 조회 (FMP)
 * @param {string} ticker - 종목 심볼
 * @param {number} [limit=4] - 조회할 분기 수
 * @returns {Promise<Array|null>}
 */
export async function getEarningsCalendar(ticker, limit = 4) {
  const data = await fmpFetch(
    `/stable/earning-calendar?symbol=${encodeURIComponent(ticker)}&limit=${limit}`,
    { cacheTTL: 60 * 60 * 1000 }
  );
  return Array.isArray(data) ? data : null;
}

// ── 통합 컨센서스 데이터 ──────────────────────────────

/**
 * 종목의 통합 컨센서스/애널리스트 데이터 조회
 * 모든 API를 병렬 호출, graceful degradation
 *
 * @param {string} ticker - 종목 심볼
 * @returns {Promise<Object>}
 */
export async function getUSConsensus(ticker, opts = {}) {
  const [profile, targetConsensus, estimates, recommendations, rating, earnings, earningsHistory] = await Promise.all([
    getCompanyProfile(ticker).catch(() => null),
    getPriceTargetConsensus(ticker).catch(() => null),
    getAnalystEstimates(ticker).catch(() => null),
    getAnalystRecommendations(ticker).catch(() => null),
    getStockRating(ticker).catch(() => null),
    getEarningsCalendar(ticker).catch(() => null),
    getFinnhubEarningsHistory(ticker).catch(() => null),
  ]);

  const fmpStatus = getProviderStatus('fmp');
  const latestRec = Array.isArray(recommendations) && recommendations.length > 0
    ? recommendations[0]
    : null;
  const normalizedRecommendations = normalizeRecommendationSnapshot(latestRec);
  const normalizedRating = normalizeConsensusRating(rating, latestRec);
  const normalizedEarnings = normalizeConsensusEarnings(earnings, earningsHistory);

  let result = {
    ticker,
    profile: profile ? {
      companyName: profile.companyName ?? profile.name ?? null,
      industry: profile.industry ?? null,
      sector: profile.sector ?? null,
      description: profile.description ?? null,
      ceo: profile.ceo ?? null,
      website: profile.website ?? null,
      exchange: profile.exchange ?? null,
      mktCap: profile.mktCap ?? null,
      price: profile.price ?? null,
      beta: profile.beta ?? null,
      dividendYield: profile.lastDiv ?? null,
      image: profile.image ?? null,
      source: profile.source ?? 'fmp-profile',
    } : null,
    consensus: targetConsensus ? {
      targetHigh: targetConsensus.targetHigh ?? null,
      targetLow: targetConsensus.targetLow ?? null,
      targetConsensus: targetConsensus.targetConsensus ?? null,
      targetMedian: targetConsensus.targetMedian ?? null,
    } : null,
    analystEstimates: Array.isArray(estimates) ? estimates.slice(0, 4) : null,
    recommendations: normalizedRecommendations,
    rating: normalizedRating,
    earnings: normalizedEarnings,
    peers: null,
    references: null,
    meta: {
      target: {
        source: targetConsensus ? 'fmp-price-target-consensus' : null,
        status: targetConsensus ? 'ok' : (fmpStatus.exhausted ? 'provider_exhausted' : 'unavailable'),
      },
      estimates: {
        source: Array.isArray(estimates) && estimates.length > 0 ? 'fmp-analyst-estimates' : null,
        status: Array.isArray(estimates) && estimates.length > 0 ? 'ok' : (fmpStatus.exhausted ? 'provider_exhausted' : 'unavailable'),
      },
      peers: buildWiseReportConsensusMeta('not_requested', { count: 0 }),
      references: buildWiseReportConsensusMeta('not_requested'),
    },
  };

  if (needsWiseReportConsensusAugment(result, opts)) {
    try {
      const wisereport = await resolveWiseReportConsensusData(ticker, opts);
      if (wisereport) {
        result = augmentUSConsensusWithWiseReport(result, wisereport);
      } else {
        const unavailableMeta = buildWiseReportConsensusMeta('unavailable', { reason: 'empty' });
        result.meta.profile = unavailableMeta;
        result.meta.peers = { ...unavailableMeta, count: 0 };
        result.meta.references = unavailableMeta;
      }
    } catch (error) {
      const unavailableMeta = buildWiseReportConsensusMeta('unavailable', {
        reason: error?.message ?? 'wisereport-error',
      });
      result.meta.profile = unavailableMeta;
      result.meta.peers = { ...unavailableMeta, count: 0 };
      result.meta.references = unavailableMeta;
    }
  }

  return result;
}

export function augmentUSConsensusWithWiseReport(base = {}, wisereport = null) {
  const selfPeer = extractWiseReportSelfPeer(wisereport, base.ticker);
  const profileFallback = compactConsensusObject({
    companyName: selfPeer?.companyName ?? null,
    exchange: selfPeer?.exchange ?? null,
    mktCap: extractWiseReportSnapMetric(wisereport, ['시가총액', 'marketcap']),
    price: extractWiseReportSnapMetric(wisereport, ['보통주주가', '주가', 'price']),
    source: 'wisereport-global',
  });

  const nextProfile = mergeConsensusProfile(base.profile, profileFallback);
  const peers = extractWiseReportPeers(wisereport);
  const references = extractWiseReportConsensusReferences(wisereport);

  return {
    ...base,
    profile: nextProfile,
    peers,
    references,
    meta: {
      ...(base.meta ?? {}),
      profile: {
        attempted: true,
        source: 'wisereport-global',
        status: nextProfile ? 'ok' : 'unavailable',
        filledFields: Object.keys(profileFallback ?? {}).filter(key => key !== 'source' && !base?.profile?.[key] && nextProfile?.[key] != null),
      },
      peers: {
        attempted: true,
        source: 'wisereport-global',
        status: peers?.items?.length ? 'ok' : 'unavailable',
        count: peers?.items?.length ?? 0,
      },
      references: {
        attempted: true,
        source: 'wisereport-global',
        status: references ? 'ok' : 'unavailable',
      },
    },
  };
}

function needsWiseReportConsensusAugment(data = {}, opts = {}) {
  if (opts.forceWiseReportConsensusAugment) return true;
  return !data?.profile?.companyName || !hasUsableConsensusData(data);
}

async function resolveWiseReportConsensusData(ticker, opts = {}) {
  if (opts.wisereportRawData) {
    return opts.wisereportRawData;
  }
  if (typeof opts.wisereportFetcher === 'function') {
    return opts.wisereportFetcher(ticker, opts);
  }
  return crawlWiseReportGlobal(ticker, {
    ...opts,
    routes: ['company-snap', 'company-analysis', 'company-consensus'],
  });
}

function extractWiseReportPeers(wisereport = null) {
  const payload = getWiseReportConsensusAuxData(wisereport, 'company-analysis', 'compare-list')?.data;
  const items = Array.isArray(payload?.data) ? payload.data : (Array.isArray(payload) ? payload : []);
  if (!items.length) return null;

  return {
    source: 'wisereport-global',
    items: items.map(item => ({
      ticker: item.TICKER ?? null,
      companyName: item.PROPER_NAME ?? null,
      exchange: item.EX_NM ?? null,
      cmpCode: item.CMP_CD ?? null,
    })),
  };
}

function extractWiseReportSelfPeer(wisereport = null, ticker = '') {
  const upperTicker = String(ticker ?? '').trim().toUpperCase();
  const peers = extractWiseReportPeers(wisereport)?.items ?? [];
  return peers.find(item => String(item.ticker ?? '').toUpperCase().startsWith(`${upperTicker}-`)) ?? peers[0] ?? null;
}

function extractWiseReportConsensusReferences(wisereport = null) {
  const compareList = getWiseReportConsensusAuxData(wisereport, 'company-analysis', 'compare-list');
  const metricChart = getWiseReportConsensusAuxData(wisereport, 'company-analysis', 'metric-chart');
  const returnList = getWiseReportConsensusAuxData(wisereport, 'company-analysis', 'return-list');
  const trend = getWiseReportConsensusAuxData(wisereport, 'company-consensus', 'consensus-trend-chart');

  const references = compactConsensusObject({
    peers: compactConsensusObject({
      compareList: compareList?.data ?? null,
      metricChart: metricChart?.data ?? null,
      returnList: returnList?.data ?? null,
    }),
    estimates: compactConsensusObject({
      wisereportConsensusTrend: trend?.data ?? null,
    }),
  });

  return references;
}

function mergeConsensusProfile(base = null, fallback = null) {
  if (!fallback) return base;
  const next = { ...(base ?? {}) };
  for (const [key, value] of Object.entries(fallback)) {
    if ((next[key] === null || next[key] === undefined || next[key] === '') && value != null && value !== '') {
      next[key] = value;
    }
  }
  return next;
}

function getWiseReportConsensusAuxData(wisereport = null, routeId, itemId) {
  return wisereport?.pages?.[routeId]?.auxiliary?.find(item => item.id === itemId && item.ok) ?? null;
}

function extractWiseReportSnapMetric(wisereport = null, aliases = []) {
  const rows = getWiseReportConsensusAuxData(wisereport, 'company-snap', 'snap-financial-summary')?.data?.Data2 ?? [];
  const normalizedAliases = aliases.map(normalizeConsensusLabel).filter(Boolean);
  const row = rows.find(item => normalizedAliases.some(alias => normalizeConsensusLabel(item?.ITEM_NM).includes(alias)));
  if (!row) return null;
  for (let index = 10; index >= 1; index -= 1) {
    const value = row[`VAL${index}`];
    if (value !== null && value !== undefined && value !== '') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : value;
    }
  }
  return null;
}

function normalizeConsensusLabel(value = '') {
  return String(value ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[^0-9a-z가-힣]/gi, '')
    .trim()
    .toLowerCase();
}

function compactConsensusObject(value = {}) {
  const entries = Object.entries(value).filter(([, field]) => field != null && field !== '');
  return entries.length ? Object.fromEntries(entries) : null;
}
