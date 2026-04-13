/**
 * news.js — 미국주식 뉴스 / 감성 분석
 *
 * - 뉴스: Polygon `/v2/reference/news?ticker=`
 * - 뉴스 보완: FinnHub `/api/v1/news?symbol=` (company news)
 * - 감성 분석: FinnHub `/api/v1/news-sentiment?symbol=`
 */

import { polygonFetch, finnhubFetch, getProviderStatus } from './api-clients.js';
import { crawlWiseReportGlobal } from './wisereport-global.js';

// ── 뉴스 (Polygon) ───────────────────────────────────

/**
 * Polygon 뉴스 조회
 * @param {string} ticker - 종목 심볼
 * @param {number} [limit=10] - 최대 뉴스 수
 * @returns {Promise<Array|null>}
 */
export async function getPolygonNews(ticker, limit = 10) {
  const data = await polygonFetch(
    `/v2/reference/news?ticker=${encodeURIComponent(ticker)}&limit=${limit}&order=desc`,
    { cacheTTL: 10 * 60 * 1000 }  // 10분 캐시
  );
  if (!data?.results?.length) return null;
  return data.results.map(normalizePolygonNews);
}

/**
 * Polygon 뉴스 정규화
 */
function normalizePolygonNews(item) {
  return {
    source: item.publisher?.name ?? 'Polygon',
    title: item.title ?? '',
    summary: item.description ?? '',
    url: item.article_url ?? item.url ?? null,
    image: item.image_url ?? null,
    publishedAt: item.published_utc ?? null,
    tickers: item.tickers ?? [],
  };
}

// ── 뉴스 (FinnHub) ───────────────────────────────────

/**
 * FinnHub 기업 뉴스 조회
 * @param {string} ticker - 종목 심볼
 * @param {string} [from] - 시작일 (YYYY-MM-DD, 기본 7일 전)
 * @param {string} [to] - 종료일 (YYYY-MM-DD, 기본 오늘)
 * @returns {Promise<Array|null>}
 */
export async function getFinnhubNews(ticker, from, to) {
  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const fromStr = from ?? weekAgo.toISOString().split('T')[0];
  const toStr = to ?? today.toISOString().split('T')[0];

  const data = await finnhubFetch(
    `/company-news?symbol=${encodeURIComponent(ticker)}&from=${fromStr}&to=${toStr}`,
    { cacheTTL: 10 * 60 * 1000 }
  );
  if (!Array.isArray(data)) return null;
  return data.slice(0, 15).map(normalizeFinnhubNews);
}

/**
 * FinnHub 뉴스 정규화
 */
function normalizeFinnhubNews(item) {
  return {
    source: item.source ?? 'FinnHub',
    title: item.headline ?? '',
    summary: item.summary ?? '',
    url: item.url ?? null,
    image: item.image ?? null,
    publishedAt: item.datetime
      ? new Date(item.datetime * 1000).toISOString()
      : null,
    related: item.related ?? '',
  };
}

// ── 감성 분석 (FinnHub) ───────────────────────────────

/**
 * 뉴스 감성 분석 조회 (FinnHub)
 * @param {string} ticker - 종목 심볼
 * @returns {Promise<Object|null>}
 *   { bearishPercent, bullishPercent, buzz, sectorAverageBullishPercent, ... }
 */
export async function getNewsSentiment(ticker) {
  const data = await finnhubFetch(
    `/news-sentiment?symbol=${encodeURIComponent(ticker)}`,
    { cacheTTL: 15 * 60 * 1000 }  // 15분 캐시
  );
  if (!data) return null;

  return {
    // 전체 감성 지표
    bearishPercent: data.bearishPercent ?? null,
    bullishPercent: data.bullishPercent ?? null,

    // 버즈 (관심도)
    buzz: data.buzz ? {
      articlesInLastWeek: data.buzz.articlesInLastWeek ?? 0,
      buzz: data.buzz.buzz ?? 0,
      weeklyAverage: data.buzz.weeklyAverage ?? 0,
    } : null,

    // 섹터 평균
    sectorAverageBullishPercent: data.sectorAverageBullishPercent ?? null,
    sectorAverageNewsScore: data.sectorAverageNewsScore ?? null,

    // 감성 스코어 (0~1 범위 정규화)
    sentimentScore: calculateSentimentScore(data),
    source: 'finnhub-news-sentiment',
    status: 'ok',
  };
}

/**
 * 감성 스코어 계산 (0=매우 부정, 0.5=중립, 1=매우 긍정)
 */
function calculateSentimentScore(data) {
  const bullish = data.bullishPercent;
  const bearish = data.bearishPercent;

  if (bullish == null || bearish == null) return null;

  // bullishPercent - bearishPercent를 0~1로 정규화
  // 원래 범위: -1 ~ +1 → 0 ~ 1로 변환
  const raw = bullish - bearish;
  return Math.round((raw + 1) / 2 * 100) / 100;
}

// ── 통합 뉴스 데이터 ──────────────────────────────────

/**
 * 종합 뉴스 + 감성 데이터 조회
 * @param {string} ticker - 종목 심볼
 * @param {number} [newsLimit=10] - 뉴스 최대 수
 * @returns {Promise<Object>}
 */
export async function getUSNews(ticker, newsLimit = 10, opts = {}) {
  const [polygonNews, finnhubNews, sentiment] = await Promise.all([
    getPolygonNews(ticker, newsLimit).catch(() => null),
    getFinnhubNews(ticker).catch(() => null),
    getNewsSentiment(ticker).catch(() => null),
  ]);

  const mergedNews = mergeNews(polygonNews, finnhubNews, newsLimit);
  const finnhubStatus = getProviderStatus('finnhub');

  let result = {
    ticker,
    news: mergedNews,
    sentiment,
    totalFetched: mergedNews.length,
    meta: {
      sentiment: {
        attempted: true,
        source: sentiment?.source ?? 'finnhub-news-sentiment',
        status: sentiment?.status ?? (finnhubStatus.exhausted ? 'provider_exhausted' : 'unavailable'),
      },
    },
  };

  if (needsWiseReportNewsAugment(mergedNews)) {
    try {
      const wisereport = await resolveWiseReportNewsData(ticker, opts);
      if (wisereport) {
        result = augmentUSNewsWithWiseReport(result, wisereport, newsLimit);
      } else {
        result.meta.newsText = { attempted: true, source: 'wisereport-global', status: 'unavailable', reason: 'empty' };
      }
    } catch (error) {
      result.meta.newsText = {
        attempted: true,
        source: 'wisereport-global',
        status: 'unavailable',
        reason: error?.message ?? 'wisereport-error',
      };
    }
  }

  return result;
}

export function augmentUSNewsWithWiseReport(base = {}, wisereport = null, newsLimit = 10) {
  const nextNews = Array.isArray(base.news) ? base.news.map(item => ({ ...item })) : [];
  const candidates = extractWiseReportNewsCandidates(wisereport);
  let matched = 0;
  let augmented = 0;
  let skippedExisting = 0;

  for (const candidate of candidates) {
    const index = nextNews.findIndex(item => normalizeTitle(item?.title) === normalizeTitle(candidate.title));
    if (index < 0) continue;

    matched += 1;
    const current = { ...nextNews[index] };
    let changed = false;

    if (!current.summary && candidate.summary) {
      current.summary = candidate.summary;
      changed = true;
    } else if (current.summary) {
      skippedExisting += 1;
    }

    if (!current.bodyText && candidate.bodyText) {
      current.bodyText = candidate.bodyText;
      changed = true;
    }

    if (changed) {
      current.textSource = 'wisereport-global';
      current.textStatus = 'augmented';
      nextNews[index] = current;
      augmented += 1;
    }
  }

  return {
    ...base,
    news: nextNews.slice(0, newsLimit),
    totalFetched: Math.min(nextNews.length, newsLimit),
    meta: {
      ...(base.meta ?? {}),
      newsText: {
        attempted: true,
        source: 'wisereport-global',
        status: candidates.length ? (augmented > 0 ? 'ok' : 'no_change') : 'unavailable',
        matched,
        augmented,
        skippedExisting,
      },
    },
  };
}

function needsWiseReportNewsAugment(news = []) {
  return Array.isArray(news) && news.some(item => !item?.summary || !item?.bodyText);
}

async function resolveWiseReportNewsData(ticker, opts = {}) {
  if (opts.wisereportRawData) {
    return opts.wisereportRawData;
  }
  if (typeof opts.wisereportFetcher === 'function') {
    return opts.wisereportFetcher(ticker, opts);
  }
  return crawlWiseReportGlobal(ticker, {
    ...opts,
    routes: ['company-snap'],
  });
}

function extractWiseReportNewsCandidates(wisereport = null) {
  const rows = [
    ...(getWiseReportNewsRows(wisereport, 'news-company-1')),
    ...(getWiseReportNewsRows(wisereport, 'news-company-2')),
  ];

  return rows.map(row => normalizeWiseReportNewsRow(row)).filter(item => item?.title && (item.summary || item.bodyText));
}

function getWiseReportNewsRows(wisereport = null, itemId) {
  const payload = wisereport?.pages?.['company-snap']?.auxiliary?.find(item => item.id === itemId && item.ok)?.data;
  return Array.isArray(payload?.Data) ? payload.Data : [];
}

function normalizeWiseReportNewsRow(row = {}) {
  const title = String(row.TEXT ?? row.TITLE ?? '').trim();
  const bodyText = cleanWiseReportBody(row.BODY ?? row.HTMLBODY ?? '');
  return {
    source: 'WiseReport',
    title,
    summary: bodyText ? bodyText.slice(0, 280) : null,
    bodyText: bodyText || null,
    publishedAt: parseWiseReportDate(row.PUBLISHTIME ?? row.VERSIONCREATED),
  };
}

function cleanWiseReportBody(value = '') {
  const text = String(value ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text || null;
}

function parseWiseReportDate(value) {
  const match = String(value ?? '').match(/\/(?:Date)?\(?([0-9]{10,13})\)?\//);
  if (!match) return null;
  const millis = Number(match[1].length === 10 ? `${match[1]}000` : match[1]);
  return Number.isFinite(millis) ? new Date(millis).toISOString() : null;
}

/**
 * 두 소스의 뉴스를 병합 (중복 제거)
 */
function mergeNews(polygonNews, finnhubNews, limit = 10) {
  const seen = new Set();
  const merged = [];

  // Polygon 우선 추가
  for (const item of polygonNews || []) {
    const key = normalizeTitle(item.title);
    if (key && !seen.has(key)) {
      seen.add(key);
      merged.push(item);
    }
  }

  // FinnHub로 보완
  for (const item of finnhubNews || []) {
    const key = normalizeTitle(item.title);
    if (key && !seen.has(key)) {
      seen.add(key);
      merged.push(item);
    }
  }

  return merged.slice(0, limit);
}

/**
 * 제목 정규화 (중복 판별용)
 */
function normalizeTitle(title) {
  return String(title || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 80);
}
