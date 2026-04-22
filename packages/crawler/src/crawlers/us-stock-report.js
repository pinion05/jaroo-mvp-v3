/**
 * us-stock-report.js — 미국주식 리포트용 원시 데이터 집계
 *
 * - 재무, 컨센서스, 뉴스, 공시, 시장지표를 병렬 조회
 * - 보드 스코어 및 LLM 로직 제외
 * - 엔드포인트에서 바로 사용할 수 있는 원시 집계 응답 제공
 */

import { getUSFinancials } from './us-financials.js';
import { getUSConsensus } from './us-consensus.js';
import { getUSNews } from './us-news.js';
import { getUSFilings } from './us-sec-filings.js';
import { getUSMarketIndicators } from './us-market-indicators.js';

function buildReportResponse({
  ticker = null,
  financials = null,
  consensus = null,
  news = null,
  filings = null,
  marketIndicators = null,
  companyInfo = null,
  metadata = null,
} = {}) {
  return {
    ticker,
    market: 'us',
    financials,
    consensus,
    news,
    filings,
    marketIndicators,
    companyInfo,
    metadata,
  };
}

/**
 * 미국주식 리포트용 통합 원시 데이터 조회
 *
 * @param {string} ticker - 미국 종목 심볼 (예: AAPL, MSFT)
 * @param {Object} [opts]
 * @param {boolean} [opts.includeFinancials=true]
 * @param {boolean} [opts.includeConsensus=true]
 * @param {boolean} [opts.includeNews=true]
 * @param {boolean} [opts.includeFilings=true]
 * @param {boolean} [opts.includeMarketIndicators=true]
 * @param {number} [opts.newsLimit=10]
 * @param {number} [opts.filingsLimit=10]
 * @returns {Promise<Object>}
 */
export async function getUSStockReportData(ticker, opts = {}) {
  const {
    includeFinancials = true,
    includeConsensus = true,
    includeNews = true,
    includeFilings = true,
    includeMarketIndicators = true,
    newsLimit = 10,
    filingsLimit = 10,
  } = opts;

  const startTime = Date.now();
  const upperTicker = String(ticker ?? '').trim().toUpperCase();
  const requested = {
    financials: includeFinancials,
    consensus: includeConsensus,
    news: includeNews,
    filings: includeFilings,
    marketIndicators: includeMarketIndicators,
  };

  if (!upperTicker) {
    return buildReportResponse({
      ticker: null,
      metadata: buildMetadata(startTime, {}, requested, { error: 'ticker_required' }),
    });
  }

  const tasks = {};

  if (includeFinancials) {
    tasks.financials = getUSFinancials(upperTicker).catch(error => ({ error: error?.message ?? '조회 실패' }));
  }
  if (includeConsensus) {
    tasks.consensus = getUSConsensus(upperTicker).catch(error => ({ error: error?.message ?? '조회 실패' }));
  }
  if (includeNews) {
    tasks.news = getUSNews(upperTicker, newsLimit).catch(error => ({ error: error?.message ?? '조회 실패' }));
  }
  if (includeFilings) {
    tasks.filings = getUSFilings(upperTicker, { limit: filingsLimit }).catch(error => ({ error: error?.message ?? '조회 실패' }));
  }
  if (includeMarketIndicators) {
    tasks.marketIndicators = getUSMarketIndicators().catch(error => ({ error: error?.message ?? '조회 실패' }));
  }

  const results = {};
  const entries = Object.entries(tasks);
  const settled = await Promise.allSettled(entries.map(([, task]) => task));

  for (let index = 0; index < entries.length; index += 1) {
    const [key] = entries[index];
    const result = settled[index];
    results[key] = result.status === 'fulfilled'
      ? result.value
      : { error: result.reason?.message ?? '조회 실패' };
  }

  return buildReportResponse({
    ticker: upperTicker,
    financials: results.financials ?? null,
    consensus: results.consensus ?? null,
    news: results.news ?? null,
    filings: results.filings ?? null,
    marketIndicators: results.marketIndicators ?? null,
    companyInfo: extractCompanyInfo(results.consensus),
    metadata: buildMetadata(startTime, results, requested),
  });
}

export function extractCompanyInfo(consensus) {
  if (!consensus?.profile) return null;

  const profile = consensus.profile;
  return {
    name: profile.companyName ?? null,
    sector: profile.sector ?? null,
    industry: profile.industry ?? null,
    marketCap: profile.mktCap ?? null,
    price: profile.price ?? null,
    beta: profile.beta ?? null,
    exchange: profile.exchange ?? null,
  };
}

export function buildMetadata(startTime, results = {}, requested = {}, extra = {}) {
  const elapsedMs = Date.now() - startTime;

  return {
    fetchedAt: new Date().toISOString(),
    elapsedMs,
    dataSources: {
      financials: requested.financials ? classifyDataSource('financials', results.financials) : 'not_requested',
      consensus: requested.consensus ? classifyDataSource('consensus', results.consensus) : 'not_requested',
      news: requested.news ? classifyDataSource('news', results.news) : 'not_requested',
      filings: requested.filings ? classifyDataSource('filings', results.filings) : 'not_requested',
      marketIndicators: requested.marketIndicators ? classifyDataSource('marketIndicators', results.marketIndicators) : 'not_requested',
    },
    ...extra,
  };
}

export function classifyDataSource(key, value) {
  if (value?.error) return `error: ${value.error}`;
  if (value == null) return 'missing';

  switch (key) {
    case 'financials':
      return classifyFinancialsSource(value);
    case 'consensus':
      return classifyConsensusSource(value);
    case 'news':
      return classifyNewsSource(value);
    case 'filings':
      return classifyFilingsSource(value);
    case 'marketIndicators':
      return classifyMarketIndicatorsSource(value);
    default:
      return 'ok';
  }
}

function formatMissingStatus(missing = []) {
  if (!missing.length) return 'ok';
  return `partial: missing ${missing.join(', ')}`;
}

export function classifyFinancialsSource(value = {}) {
  const missing = [];
  const hasStatements = Boolean(
    value?.statements?.incomeStatements?.length
    || value?.statements?.balanceSheets?.length
    || value?.statements?.cashFlows?.length
  );

  if (!hasStatements) missing.push('statements');
  if (!value?.keyMetrics) missing.push('keyMetrics');
  if (!value?.ratios) missing.push('ratios');

  return missing.length === 3 ? 'missing' : formatMissingStatus(missing);
}

export function classifyConsensusSource(value = {}) {
  const missing = [];

  if (!value?.profile) missing.push('profile');
  if (!value?.consensus) missing.push('target');
  if (!value?.analystEstimates?.length) missing.push('estimates');
  if (!value?.recommendations) missing.push('recommendations');
  if (!value?.rating) missing.push('rating');
  if (!value?.earnings?.length) missing.push('earnings');

  return missing.length === 6 ? 'missing' : formatMissingStatus(missing);
}

export function classifyNewsSource(value = {}) {
  const missing = [];

  if (!value?.news?.length) missing.push('news');
  if (!value?.sentiment) missing.push('sentiment');

  return missing.length === 2 ? 'missing' : formatMissingStatus(missing);
}

export function classifyFilingsSource(value = {}) {
  const hasKeyFilings = Boolean(value?.keyFilings?.length);
  const hasRecentFilings = Boolean(value?.recentFilings?.length);

  if (!hasKeyFilings && !hasRecentFilings) return 'missing';
  if (!hasKeyFilings) return 'partial: missing keyFilings';
  if (!hasRecentFilings) return 'partial: missing recentFilings';

  return 'ok';
}

export function classifyMarketIndicatorsSource(value = {}) {
  const missing = [];

  if (!value?.sp500) missing.push('sp500');
  if (!value?.nasdaq) missing.push('nasdaq');
  if (!value?.vix) missing.push('vix');
  if (!value?.sp500Sma200) missing.push('sp500Sma200');

  return missing.length === 4 ? 'missing' : formatMissingStatus(missing);
}
