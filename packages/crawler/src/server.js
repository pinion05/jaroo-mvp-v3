import express from 'express';
import { fileURLToPath } from 'node:url';
import {
  WISEREPORT_GLOBAL_ROUTES,
  WISEREPORT_KR_PAGES,
  crawlWiseReportGlobal,
  crawlWiseReportGlobalDomainData,
  crawlWiseReportKrPage,
  crawlMarketData,
  fetchAdr,
  fetchAllMarketIndicators,
  fetchUsdKrwRate,
  fetchUsVix,
  fetchVkospi,
  getCompanyFacts,
  getCompanyFactsConcept,
  getCompanyFactsTaxonomies,
  getCompanyFactsTaxonomyConcepts,
  getCrawl,
  getKrx,
  getIndexData,
  getInvestorVolume,
  getMarketCap,
  getMarketSnapshot,
  getTickerNames,
  getUSConsensus,
  getUSFilings,
  getUSFinancials,
  getUSMarketIndicators,
  getUSNews,
  getUSStockReportData,
  runTriggerBatch,
} from './index.js';

const SERVICE_NAME = 'jaroo-mvp-v3-crawler';
const SERVICE_VERSION = '0.1.0';
const RESPONSE_ENVELOPE_KEYS = ['ok', 'data', 'count', 'request', 'meta'];

const app = express();
const port = Number(process.env.PORT || 3040);

app.use(express.json());

class HttpError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

function normalizeValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, normalizeValue(nested)]));
  }
  if (value == null) {
    return null;
  }
  return String(value);
}

function normalizeObject(input = {}) {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, normalizeValue(value)]));
}

function inferCount(data) {
  if (Array.isArray(data)) {
    return data.length;
  }
  if (data && typeof data === 'object') {
    return Object.keys(data).length;
  }
  if (data == null) {
    return 0;
  }
  return 1;
}

function resolveCount(definition, data) {
  if (typeof definition.count === 'function') {
    return definition.count(data);
  }
  if (Number.isFinite(definition.count)) {
    return definition.count;
  }
  return inferCount(data);
}

function parseCsvQuery(value) {
  if (value == null) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => parseCsvQuery(item));
  }
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseSingleQueryValue(value) {
  const normalizedValue = Array.isArray(value) ? value[0] : value;
  return normalizedValue == null ? undefined : String(normalizedValue).trim() || undefined;
}

function isValidIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split('-').map((item) => Number(item));
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function parseOptionalIsoDateQuery(req, key) {
  const value = parseSingleQueryValue(req.query[key]);
  if (value == null) {
    return undefined;
  }

  if (!isValidIsoDate(value)) {
    throw new HttpError(400, `invalid query: ${key}`, {
      key,
      value,
      expected: 'YYYY-MM-DD',
    });
  }

  return value;
}

function requireQueryValues(req, keys) {
  const values = {};
  const missing = [];

  for (const key of keys) {
    const rawValue = req.query[key];
    const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
    const normalized = value == null ? '' : String(value).trim();

    if (!normalized) {
      missing.push(key);
      continue;
    }

    values[key] = normalized;
  }

  if (missing.length > 0) {
    throw new HttpError(400, `missing query: ${missing.join(', ')}`, { missing });
  }

  return values;
}

function buildRequestInfo(req, definition, matchedPath) {
  return {
    method: req.method,
    path: req.originalUrl,
    primaryPath: definition.primaryPath,
    aliasOf: matchedPath === definition.primaryPath ? null : definition.primaryPath,
    params: normalizeObject(req.params),
    query: normalizeObject(req.query),
  };
}

function resolveMetaExtra(definition, data) {
  if (typeof definition.meta === 'function') {
    return definition.meta(data);
  }
  return definition.meta || {};
}

function buildMeta(definition, matchedPath, data) {
  return {
    service: SERVICE_NAME,
    version: SERVICE_VERSION,
    resource: definition.resource,
    routeId: definition.id,
    description: definition.description,
    generatedAt: new Date().toISOString(),
    aliases: definition.aliases,
    deprecatedAliasUsed: matchedPath === definition.primaryPath ? null : matchedPath,
    ...resolveMetaExtra(definition, data),
  };
}

function sendSuccess(req, res, definition, matchedPath, data) {
  if (definition.rawSuccess === true) {
    res.json(data);
    return;
  }

  res.json({
    ok: true,
    data,
    count: resolveCount(definition, data),
    request: buildRequestInfo(req, definition, matchedPath),
    meta: buildMeta(definition, matchedPath, data),
  });
}

function sendFailure(req, res, definition, matchedPath, error) {
  const status = Number(error?.status) || 500;
  res.status(status).json({
    ok: false,
    data: null,
    count: 0,
    request: buildRequestInfo(req, definition, matchedPath),
    meta: buildMeta(definition, matchedPath, null),
    error: {
      message: error?.message || 'unknown error',
      details: error instanceof HttpError ? error.details : null,
    },
  });
}

function buildCatalogEntries() {
  return endpointDefinitions.map((definition) => ({
    id: definition.id,
    resource: definition.resource,
    description: definition.description,
    primaryPath: definition.primaryPath,
    aliases: definition.aliases,
    params: definition.params,
    query: definition.query,
  }));
}

const WISEREPORT_KR_ROUTE_DESCRIPTIONS = Object.freeze({
  'company-overview': '한국 상장사 WiseReport 기업개요 구조화 데이터를 반환합니다.',
  'financial-analysis': '한국 상장사 WiseReport 재무분석 구조화 데이터를 반환합니다.',
  'investment-indicators': '한국 상장사 WiseReport 투자지표 구조화 데이터를 반환합니다.',
  consensus: '한국 상장사 WiseReport 컨센서스 구조화 데이터를 반환합니다.',
  shareholding: '한국 상장사 WiseReport 지분현황 구조화 데이터를 반환합니다.',
  'recent-reports': '한국 상장사 WiseReport 최근리포트 구조화 데이터를 반환합니다.',
  'fnguide-finance': '한국 상장사 FnGuide 재무제표 구조화 데이터를 반환합니다.',
  'relative-return': '한국 상장사 FnGuide 상대수익률 구조화 데이터를 반환합니다.',
  opinion: '한국 상장사 FnGuide 투자의견 구조화 데이터를 반환합니다.',
  'style-analysis': '한국 상장사 FnGuide 스타일분석 구조화 데이터를 반환합니다.',
});

const WISEREPORT_KR_PAGE_ROUTES = Object.freeze(WISEREPORT_KR_PAGES.map((page) => ({
  id: `wisereport-kr-${page.id}`,
  resource: `wisereport.kr.${page.id}`,
  description: WISEREPORT_KR_ROUTE_DESCRIPTIONS[page.id] || `${page.sourceType} ${page.title} 구조화 데이터를 반환합니다.`,
  slug: page.id,
  pageKey: page.id,
  sourceKey: page.sourceKey,
})));

const WISEREPORT_KR_SLIM_DROP_KEYS = new Set([
  'ajaxEvidence',
  'bodyTextHead',
  'capture',
  'capturedResponses',
  'className',
  'headerRows',
  'legacyKey',
  'pagination',
  'popupTable',
  'provenance',
  'quality',
  'requestLog',
  'rowCount',
  'source',
  'sourceKey',
  'sourceType',
  'stages',
  'tableId',
]);

const WISEREPORT_KR_SLIM_COMPANY_KEYS = new Set([
  'code',
  'name',
]);

const WISEREPORT_KR_SLIM_V11_DROP_PAGE_KEYS = new Set([
  'annualOrQuarterly',
  'indicatorTabs',
  'ownershipTabs',
  'statementTabs',
]);

function normalizeSlimV11Text(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeSlimV11ObjectKey(key) {
  return normalizeSlimV11Text(key)
    .replace(/\s*(보기|닫기)\s*$/u, '')
    .trim();
}

function normalizeSlimV11LabelValue(value) {
  return normalizeSlimV11Text(value)
    .replace(/^(?:펼치기|감추기)\s*/u, '')
    .replace(/\s*(?:펼치기|감추기)$/u, '')
    .trim();
}

function isSlimV11SpacerColumn(key, rows) {
  if (!/^column_\d+$/u.test(String(key || ''))) {
    return false;
  }

  return rows.every((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      return true;
    }

    const value = row[key];
    if (value == null) {
      return true;
    }

    if (typeof value === 'string') {
      return value.trim() === '';
    }

    return false;
  });
}

function normalizeWiseReportKrAggregate(aggregate) {
  if (aggregate && typeof aggregate === 'object') {
    if (aggregate.pages && typeof aggregate.pages === 'object') {
      return { ...aggregate, pages: aggregate.pages };
    }

    if (aggregate.normalized && typeof aggregate.normalized === 'object') {
      return { ...aggregate, pages: aggregate.normalized };
    }
  }

  return {
    pages: aggregate && typeof aggregate === 'object' ? aggregate : {},
  };
}

function resolveWiseReportKrPagePayload(aggregate, pageKey, req) {
  const normalizedAggregate = normalizeWiseReportKrAggregate(aggregate);
  const pagePayload = normalizedAggregate.pages?.[pageKey];

  if (pagePayload == null) {
    throw new HttpError(502, `missing wisereport kr page payload: ${pageKey}`, {
      code: req.params.code,
      pageKey,
      availablePageKeys: Object.keys(normalizedAggregate.pages || {}),
    });
  }

  return pagePayload;
}

function extractWiseReportKrNormalizedPage(pagePayload) {
  if (pagePayload && typeof pagePayload === 'object' && pagePayload.normalized && typeof pagePayload.normalized === 'object') {
    return pagePayload.normalized;
  }
  return pagePayload;
}

function isWiseReportKrTablePayload(value) {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && Array.isArray(value.rows)
    && (
      Array.isArray(value.headers)
      || 'tableId' in value
      || 'className' in value
      || 'headerRows' in value
      || 'rowCount' in value
      || (value.dataAvailability && typeof value.dataAvailability === 'object')
    );
}

function slimWiseReportKrValue(value, parentKey = null) {
  if (Array.isArray(value)) {
    return value
      .map((item) => slimWiseReportKrValue(item, parentKey))
      .filter((item) => item !== undefined);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  if (parentKey === 'company') {
    return Object.fromEntries(
      Object.entries(value).filter(([key, nested]) => WISEREPORT_KR_SLIM_COMPANY_KEYS.has(key) && nested != null),
    );
  }

  if (isWiseReportKrTablePayload(value)) {
    const tablePayload = {
      rows: slimWiseReportKrValue(value.rows, 'rows'),
    };
    const dataAvailability = value.dataAvailability && typeof value.dataAvailability === 'object'
      ? value.dataAvailability
      : null;

    if (value.status != null || dataAvailability?.status != null) {
      tablePayload.status = value.status ?? dataAvailability?.status;
    }
    if (value.note != null || dataAvailability?.note != null) {
      tablePayload.note = value.note ?? dataAvailability?.note;
    }

    return tablePayload;
  }

  const entries = Object.entries(value)
    .filter(([key, nested]) => !WISEREPORT_KR_SLIM_DROP_KEYS.has(key) && nested !== undefined)
    .map(([key, nested]) => [key, slimWiseReportKrValue(nested, key)]);

  return Object.fromEntries(entries);
}

function pickWiseReportKrCompany(rawAggregate, code) {
  const normalizedAggregate = normalizeWiseReportKrAggregate(rawAggregate);

  for (const page of WISEREPORT_KR_PAGES) {
    const company = extractWiseReportKrNormalizedPage(normalizedAggregate.pages?.[page.id])?.company;
    if (company && typeof company === 'object') {
      return {
        code: String(company.code || code || ''),
        name: company.name ?? null,
      };
    }
  }

  return {
    code: String(code || ''),
    name: null,
  };
}

function buildWiseReportKrSlimPayload(rawAggregate, code) {
  const normalizedAggregate = normalizeWiseReportKrAggregate(rawAggregate);
  const slimPages = Object.fromEntries(WISEREPORT_KR_PAGES.map((page) => {
    const pagePayload = normalizedAggregate.pages?.[page.id];
    const normalizedPage = extractWiseReportKrNormalizedPage(pagePayload);

    if (!normalizedPage || typeof normalizedPage !== 'object') {
      return [page.id, null];
    }

    const {
      company: _company,
      sourceType: _sourceType,
      sourceKey: _sourceKey,
      bodyTextHead: _bodyTextHead,
      ...businessPayload
    } = normalizedPage;

    return [page.id, slimWiseReportKrValue(businessPayload)];
  }));

  return {
    code: String(code || ''),
    company: pickWiseReportKrCompany(rawAggregate, code),
    pages: slimPages,
  };
}

function slimWiseReportKrValueV11(value, parentKey = null) {
  if (Array.isArray(value)) {
    return value
      .map((item) => slimWiseReportKrValueV11(item, parentKey))
      .filter((item) => item !== undefined);
  }

  if (typeof value === 'string') {
    return parentKey === '항목' ? normalizeSlimV11LabelValue(value) : value;
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  if (parentKey === 'company') {
    return Object.fromEntries(
      Object.entries(value).filter(([key, nested]) => WISEREPORT_KR_SLIM_COMPANY_KEYS.has(key) && nested != null),
    );
  }

  if (isWiseReportKrTablePayload(value)) {
    const slimRows = (value.rows || [])
      .map((row) => slimWiseReportKrValueV11(row, 'rows'))
      .filter((row) => row !== undefined);

    const removableSpacerKeys = new Set(
      [...new Set(slimRows.flatMap((row) => (row && typeof row === 'object' && !Array.isArray(row) ? Object.keys(row) : [])))]
        .filter((key) => isSlimV11SpacerColumn(key, slimRows)),
    );

    const normalizedRows = slimRows.map((row) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        return row;
      }

      return Object.fromEntries(
        Object.entries(row).filter(([key]) => !removableSpacerKeys.has(key)),
      );
    });

    const tablePayload = {
      rows: normalizedRows,
    };
    const dataAvailability = value.dataAvailability && typeof value.dataAvailability === 'object'
      ? value.dataAvailability
      : null;

    if (value.status != null || dataAvailability?.status != null) {
      tablePayload.status = value.status ?? dataAvailability?.status;
    }
    if (value.note != null || dataAvailability?.note != null) {
      tablePayload.note = value.note ?? dataAvailability?.note;
    }

    return tablePayload;
  }

  const entries = Object.entries(value)
    .filter(([key, nested]) => !WISEREPORT_KR_SLIM_DROP_KEYS.has(key) && nested !== undefined)
    .map(([key, nested]) => {
      const normalizedKey = normalizeSlimV11ObjectKey(key);
      return [normalizedKey, slimWiseReportKrValueV11(nested, normalizedKey)];
    })
    .filter(([key, nested]) => key && nested !== undefined);

  return Object.fromEntries(entries);
}

function buildWiseReportKrSlimPayloadV11(rawAggregate, code) {
  const normalizedAggregate = normalizeWiseReportKrAggregate(rawAggregate);
  const slimPages = Object.fromEntries(WISEREPORT_KR_PAGES.map((page) => {
    const pagePayload = normalizedAggregate.pages?.[page.id];
    const normalizedPage = extractWiseReportKrNormalizedPage(pagePayload);

    if (!normalizedPage || typeof normalizedPage !== 'object') {
      return [page.id, null];
    }

    const {
      company: _company,
      sourceType: _sourceType,
      sourceKey: _sourceKey,
      bodyTextHead: _bodyTextHead,
      ...businessPayload
    } = normalizedPage;

    const filteredPayload = Object.fromEntries(
      Object.entries(businessPayload).filter(([key]) => !WISEREPORT_KR_SLIM_V11_DROP_PAGE_KEYS.has(key)),
    );

    return [page.id, slimWiseReportKrValueV11(filteredPayload)];
  }));

  return {
    code: String(code || ''),
    company: pickWiseReportKrCompany(rawAggregate, code),
    pages: slimPages,
  };
}

function buildWiseReportKrAggregatePayload(rawAggregate, code) {
  const normalizedAggregate = normalizeWiseReportKrAggregate(rawAggregate);
  const pages = normalizedAggregate.pages || {};
  const routeEntries = WISEREPORT_KR_PAGES.map((page) => ({
    id: page.id,
    sourceKey: page.sourceKey,
    title: page.title,
    sourceType: page.sourceType,
  }));

  return {
    source: {
      code,
      routeCount: routeEntries.length,
      routes: routeEntries,
    },
    capture: {
      provider: 'wisereport-kr-aggregate',
      pageCount: Object.keys(pages).length,
      order: Array.isArray(rawAggregate?.order) ? rawAggregate.order : Object.keys(pages),
    },
    normalized: pages,
    pages,
    quality: rawAggregate?.quality || {
      requestedPages: routeEntries.length,
      completedPages: Object.keys(pages).length,
      pageIds: Object.keys(pages),
      warningCount: 0,
      pages: Object.fromEntries(Object.entries(pages).map(([pageId, page]) => [pageId, page?.quality || null])),
    },
  };
}


const WISEREPORT_GLOBAL_COMPANY_SLIM_V1_ROUTES = Object.freeze([
  ['company-snap', 'snap'],
  ['company-finance', 'finance'],
  ['company-invest', 'invest'],
  ['company-consensus', 'consensus'],
  ['company-analysis', 'analysis'],
]);

const WISEREPORT_GLOBAL_COMPANY_SLIM_V1_ROUTE_IDS = Object.freeze(
  WISEREPORT_GLOBAL_COMPANY_SLIM_V1_ROUTES.map(([routeId]) => routeId),
);

function unwrapWiseReportGlobalDomainData(domainData) {
  if (domainData && typeof domainData === 'object' && domainData.data && typeof domainData.data === 'object') {
    return domainData.data;
  }
  return domainData ?? {};
}

function decodeSlimHtmlEntities(value) {
  return String(value ?? '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function normalizeGlobalSlimText(value) {
  const normalized = decodeSlimHtmlEntities(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || null;
}

function normalizeGlobalSlimScalar(value) {
  if (value == null) {
    return null;
  }
  if (typeof value === 'string') {
    const normalized = decodeSlimHtmlEntities(value).replace(/\s+/g, ' ').trim();
    return normalized || null;
  }
  return value;
}

function normalizeGlobalSlimDate(value) {
  const normalized = normalizeGlobalSlimScalar(value);
  if (typeof normalized !== 'string') {
    return normalized;
  }

  const dotNetMatch = normalized.match(/^\/Date\((\d+)\)\/$/);
  if (dotNetMatch) {
    const date = new Date(Number(dotNetMatch[1]));
    return Number.isNaN(date.getTime()) ? normalized : date.toISOString();
  }

  if (/^\d{4}\/\d{2}\/\d{2}$/.test(normalized)) {
    return normalized.replaceAll('/', '-');
  }

  return normalized;
}

function compactDefinedObject(input = {}) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value != null));
}

function hasSlimBusinessValue(value) {
  if (value == null) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === 'object') {
    return Object.keys(value).length > 0;
  }
  return true;
}

function finalizeGlobalSlimPage(page) {
  if (!page || typeof page !== 'object') {
    return null;
  }

  const entries = Object.entries(page).filter(([, value]) => hasSlimBusinessValue(value));
  return entries.length ? Object.fromEntries(entries) : null;
}

const globalPrefixedMatcherCache = new Map();

function getGlobalPrefixedKeyMatcher(prefix) {
  if (!globalPrefixedMatcherCache.has(prefix)) {
    globalPrefixedMatcherCache.set(prefix, new RegExp(`^${prefix}\\d+$`));
  }
  return globalPrefixedMatcherCache.get(prefix);
}

function getOrderedGlobalPrefixedKeys(record, prefix, matcher = getGlobalPrefixedKeyMatcher(prefix)) {
  return Object.keys(record ?? {})
    .filter((key) => key.startsWith(prefix) && matcher.test(key))
    .sort((left, right) => Number(left.slice(prefix.length)) - Number(right.slice(prefix.length)));
}

function getGlobalPeriodLabels(headerData, prefix = 'YYMM') {
  return getOrderedGlobalPrefixedKeys(headerData, prefix)
    .map((key) => normalizeGlobalSlimScalar(headerData?.[key]))
    .filter((value) => value != null);
}

function collectGlobalPrefixedValues(record, prefix, opts = {}) {
  const { labels = [], matcher = getGlobalPrefixedKeyMatcher(prefix), fallbackPrefix = prefix.toLowerCase() } = opts;
  const entries = getOrderedGlobalPrefixedKeys(record, prefix, matcher)
    .map((key, index) => [labels[index] ?? `${fallbackPrefix}${index + 1}`, normalizeGlobalSlimScalar(record?.[key])])
    .filter(([, value]) => value != null);
  return Object.fromEntries(entries);
}

function normalizeGlobalChartPayload(chart) {
  if (!chart || typeof chart !== 'object') {
    return null;
  }

  const periods = Array.isArray(chart.categories?.YYMM)
    ? chart.categories.YYMM.map((value) => normalizeGlobalSlimScalar(value)).filter((value) => value != null)
    : [];
  const series = Array.isArray(chart.series)
    ? chart.series.map((item) => compactDefinedObject({
      name: normalizeGlobalSlimText(item?.name),
      type: normalizeGlobalSlimScalar(item?.type),
      unit: normalizeGlobalSlimText(item?.unit),
      yAxis: item?.yAxis ?? undefined,
      values: Array.isArray(item?.data) ? item.data.map((value) => normalizeGlobalSlimScalar(value)) : [],
    })).filter((item) => hasSlimBusinessValue(item.name) || hasSlimBusinessValue(item.values))
    : [];

  return finalizeGlobalSlimPage(compactDefinedObject({
    title: normalizeGlobalSlimText(chart.title),
    periods,
    yAxisTitles: Array.isArray(chart.yAxis_title)
      ? chart.yAxis_title.map((value) => normalizeGlobalSlimText(value)).filter((value) => value != null)
      : undefined,
    series,
  }));
}

function normalizeGlobalStatementRows(itemData) {
  const periods = getGlobalPeriodLabels(itemData?.HeaderData);
  const rows = Array.isArray(itemData?.BodyData)
    ? itemData.BodyData.map((row) => {
      const values = collectGlobalPrefixedValues(row, 'DATA', {
        labels: periods,
        matcher: /^DATA\d+$/,
        fallbackPrefix: 'period',
      });
      const entry = compactDefinedObject({
        label: normalizeGlobalSlimText(row?.ACC_NM || row?.ITEM_NM),
        key: row?.ACCODE ?? row?.ITEM_SMB ?? undefined,
        level: row?.LVL ?? undefined,
        unit: normalizeGlobalSlimText(row?.UNIT),
        values,
      });
      return hasSlimBusinessValue(entry.label) || hasSlimBusinessValue(entry.values) ? entry : undefined;
    }).filter((row) => row !== undefined)
    : [];

  return finalizeGlobalSlimPage(compactDefinedObject({ periods, rows }));
}

function normalizeGlobalNews(route) {
  const newsItems = [];

  for (const itemId of ['news-company-1', 'news-company-2']) {
    const rows = route?.items?.[itemId]?.data?.Data;
    if (!Array.isArray(rows)) {
      continue;
    }

    for (const row of rows) {
      const storyId = normalizeGlobalSlimScalar(row?.STORYID || row?.M_STORYID);
      const normalized = compactDefinedObject({
        publishedAt: normalizeGlobalSlimDate(row?.PUBLISHTIME),
        storyId: storyId ?? undefined,
        title: normalizeGlobalSlimText(row?.TEXT),
        titleKo: normalizeGlobalSlimText(row?.T_TEXT),
      });
      if (hasSlimBusinessValue(normalized.storyId) || hasSlimBusinessValue(normalized.title)) {
        newsItems.push(normalized);
      }
    }
  }

  const deduped = Array.from(new Map(
    newsItems.map((item) => [item.storyId ?? item.title, item]),
  ).values());

  deduped.sort((left, right) => String(right.publishedAt ?? '').localeCompare(String(left.publishedAt ?? '')));
  return deduped;
}

function normalizeGlobalBand(itemData) {
  if (!itemData || typeof itemData !== 'object') {
    return null;
  }

  const history = Array.isArray(itemData.Data1)
    ? itemData.Data1.map((row) => compactDefinedObject({
      date: normalizeGlobalSlimDate(row?.TRD_DT),
      price: normalizeGlobalSlimScalar(row?.ADJ_PRC),
      p1: normalizeGlobalSlimScalar(row?.DATA1),
      p2: normalizeGlobalSlimScalar(row?.DATA2),
      p3: normalizeGlobalSlimScalar(row?.DATA3),
      p4: normalizeGlobalSlimScalar(row?.DATA4),
    })).filter((row) => hasSlimBusinessValue(row.date) || hasSlimBusinessValue(row.price))
    : [];

  return finalizeGlobalSlimPage(compactDefinedObject({
    history,
    levels: compactDefinedObject({
      p1: normalizeGlobalSlimScalar(itemData.Data2?.P1),
      p2: normalizeGlobalSlimScalar(itemData.Data2?.P2),
      p3: normalizeGlobalSlimScalar(itemData.Data2?.P3),
      p4: normalizeGlobalSlimScalar(itemData.Data2?.P4),
      currency: normalizeGlobalSlimText(itemData.Data2?.CURRENCY),
    }),
  }));
}

function normalizeGlobalFinancialSummary(itemData) {
  const periods = getGlobalPeriodLabels(itemData?.Data1);
  const rows = Array.isArray(itemData?.Data2)
    ? itemData.Data2.map((row) => {
      const values = collectGlobalPrefixedValues(row, 'VAL', {
        labels: periods,
        fallbackPrefix: 'period',
      });
      const entry = compactDefinedObject({
        label: normalizeGlobalSlimText(row?.ITEM_NM),
        key: normalizeGlobalSlimScalar(row?.ITEM_SMB),
        level: row?.LVL ?? undefined,
        unit: normalizeGlobalSlimText(row?.UNIT),
        values,
      });
      return hasSlimBusinessValue(entry.label) || hasSlimBusinessValue(entry.values) ? entry : undefined;
    }).filter((row) => row !== undefined)
    : [];

  return finalizeGlobalSlimPage(compactDefinedObject({ periods, rows }));
}

function normalizeGlobalPriceVolume(itemData) {
  if (!itemData || typeof itemData !== 'object') {
    return null;
  }

  const meta = itemData.Data1 ?? {};
  const rows = Array.isArray(itemData.Data2)
    ? itemData.Data2.map((row) => compactDefinedObject({
      date: normalizeGlobalSlimDate(row?.TRD_DT),
      close: normalizeGlobalSlimScalar(row?.CMP_CLS),
      benchmarkClose: normalizeGlobalSlimScalar(row?.CMP_KOSPI),
      volume: normalizeGlobalSlimScalar(row?.TRD_QTY),
      turnover: normalizeGlobalSlimScalar(row?.TRD_AMT),
    })).filter((row) => hasSlimBusinessValue(row.date) || hasSlimBusinessValue(row.close))
    : [];

  return finalizeGlobalSlimPage(compactDefinedObject({
    currency: normalizeGlobalSlimText(meta.CURRENCY),
    market: normalizeGlobalSlimText(meta.MKT_NM),
    benchmark: normalizeGlobalSlimText(meta.KRX_NM),
    rows,
  }));
}

function normalizeGlobalEsg(route) {
  const scoreData = route?.items?.['snap-esg-json']?.data;
  const chartData = route?.items?.['snap-esg-chart']?.data;
  const periods = getGlobalPeriodLabels(Array.isArray(scoreData?.Data1) ? scoreData.Data1[0] : scoreData?.Data1);
  const rows = Array.isArray(scoreData?.Data2)
    ? scoreData.Data2.map((row) => {
      const values = collectGlobalPrefixedValues(row, 'DATA', {
        labels: periods,
        fallbackPrefix: 'period',
      });
      const entry = compactDefinedObject({
        label: normalizeGlobalSlimText(row?.ITEM),
        labelEn: normalizeGlobalSlimText(row?.ITEM_ENG),
        values,
      });
      return hasSlimBusinessValue(entry.label) || hasSlimBusinessValue(entry.values) ? entry : undefined;
    }).filter((row) => row !== undefined)
    : [];

  const summary = Array.isArray(chartData?.Data1) && chartData.Data1[0]
    ? compactDefinedObject({
      companyName: normalizeGlobalSlimText(chartData.Data1[0].COMP_NM),
      esgScore: normalizeGlobalSlimScalar(chartData.Data1[0].ESG_SCORE),
      eScore: normalizeGlobalSlimScalar(chartData.Data1[0].E_SCORE),
      sScore: normalizeGlobalSlimScalar(chartData.Data1[0].S_SCORE),
      gScore: normalizeGlobalSlimScalar(chartData.Data1[0].G_SCORE),
    })
    : undefined;
  const peerComparison = Array.isArray(chartData?.Data2)
    ? chartData.Data2.map((row) => compactDefinedObject({
      sectorCode: normalizeGlobalSlimScalar(row?.SEC_CD),
      sectorType: normalizeGlobalSlimScalar(row?.SEC_TYP),
      year: normalizeGlobalSlimScalar(row?.YYYY),
      esgAvg: normalizeGlobalSlimScalar(row?.ESG_AVG),
      esgMin: normalizeGlobalSlimScalar(row?.ESG_MIN),
      esgMinName: normalizeGlobalSlimText(row?.ESG_MIN_NM),
      esgMax: normalizeGlobalSlimScalar(row?.ESG_MAX),
      esgMaxName: normalizeGlobalSlimText(row?.ESG_MAX_NM),
      eAvg: normalizeGlobalSlimScalar(row?.E_AVG),
      sAvg: normalizeGlobalSlimScalar(row?.S_AVG),
      gAvg: normalizeGlobalSlimScalar(row?.G_AVG),
    })).filter((row) => hasSlimBusinessValue(row.year) || hasSlimBusinessValue(row.sectorCode))
    : [];

  return finalizeGlobalSlimPage(compactDefinedObject({
    periods,
    rows,
    summary,
    peerComparison,
  }));
}

function buildWiseReportGlobalSnapPage(route) {
  return finalizeGlobalSlimPage({
    news: normalizeGlobalNews(route),
    band1: normalizeGlobalBand(route?.items?.['snap-band-1']?.data),
    band2: normalizeGlobalBand(route?.items?.['snap-band-2']?.data),
    financialSummary: normalizeGlobalFinancialSummary(route?.items?.['snap-financial-summary']?.data),
    priceVolume: normalizeGlobalPriceVolume(route?.items?.['snap-summary-chart']?.data),
    esg: normalizeGlobalEsg(route),
  });
}

function buildWiseReportGlobalFinancePage(route) {
  const charts = ['chartData1', 'chartData2']
    .map((key) => normalizeGlobalChartPayload(route?.items?.['fin-chart']?.data?.[key]))
    .filter((item) => item != null);

  return finalizeGlobalSlimPage({
    incomeStatement: normalizeGlobalStatementRows(route?.items?.['fin-statement']?.data),
    balanceSheet: normalizeGlobalStatementRows(route?.items?.['fin-balance-sheet']?.data),
    cashFlow: normalizeGlobalStatementRows(route?.items?.['fin-cash-flow']?.data),
    charts,
  });
}

function buildWiseReportGlobalInvestPage(route) {
  const charts = ['chartData1', 'chartData2']
    .map((key) => normalizeGlobalChartPayload(route?.items?.['invest-chart']?.data?.[key]))
    .filter((item) => item != null);

  return finalizeGlobalSlimPage({
    metrics: normalizeGlobalStatementRows(route?.items?.['invest-statement']?.data),
    charts,
  });
}

function buildWiseReportGlobalConsensusPage(route) {
  const itemData = route?.items?.['consensus-trend-chart']?.data;
  const periods = getGlobalPeriodLabels(itemData?.Data1);
  const rows = Array.isArray(itemData?.Data2)
    ? itemData.Data2.map((row) => compactDefinedObject({
      date: normalizeGlobalSlimDate(row?.TRD_DT),
      period: normalizeGlobalSlimScalar(row?.YYMM),
      values: collectGlobalPrefixedValues(row, 'VAL', { fallbackPrefix: 'val' }),
    })).filter((row) => hasSlimBusinessValue(row.date) || hasSlimBusinessValue(row.period))
    : [];

  return finalizeGlobalSlimPage(compactDefinedObject({
    periods,
    currency: normalizeGlobalSlimText(itemData?.Data1?.CURRENCY),
    rows,
  }));
}

function normalizeGlobalAnalysisPeers(route) {
  const rows = route?.items?.['compare-list']?.data?.data;
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows.map((row) => compactDefinedObject({
    ticker: normalizeGlobalSlimScalar(row?.TICKER),
    name: normalizeGlobalSlimText(row?.PROPER_NAME),
    exchange: normalizeGlobalSlimText(row?.EX_NM),
    market: normalizeGlobalSlimText(row?.ISO_CD),
  })).filter((row) => hasSlimBusinessValue(row.ticker) || hasSlimBusinessValue(row.name));
}

function normalizeGlobalAnalysisMetrics(route) {
  const rows = route?.items?.['metric-chart']?.data?.data;
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows.map((row) => compactDefinedObject({
    ticker: normalizeGlobalSlimScalar(row?.CMP_CD),
    name: normalizeGlobalSlimText(row?.CMP_NM),
    per: normalizeGlobalSlimScalar(row?.PER),
    epsGw: normalizeGlobalSlimScalar(row?.EPS_GW),
    pbr: normalizeGlobalSlimScalar(row?.PBR),
    roe: normalizeGlobalSlimScalar(row?.ROE),
    eps: normalizeGlobalSlimScalar(row?.EPS),
    evEbitda: normalizeGlobalSlimScalar(row?.EV_EBITDA),
  })).filter((row) => hasSlimBusinessValue(row.ticker) || hasSlimBusinessValue(row.name));
}

function normalizeGlobalAnalysisReturns(route) {
  const rows = route?.items?.['return-list']?.data?.data;
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows.map((row) => compactDefinedObject({
    ticker: normalizeGlobalSlimScalar(row?.CMP_CD),
    name: normalizeGlobalSlimText(row?.CMP_NM),
    '1d': normalizeGlobalSlimScalar(row?.VAL_1D),
    '1w': normalizeGlobalSlimScalar(row?.VAL_1W),
    '3m': normalizeGlobalSlimScalar(row?.VAL_3M),
    '6m': normalizeGlobalSlimScalar(row?.VAL_6M),
    '1y': normalizeGlobalSlimScalar(row?.VAL_1Y),
    '3y': normalizeGlobalSlimScalar(row?.VAL_3Y),
  })).filter((row) => hasSlimBusinessValue(row.ticker) || hasSlimBusinessValue(row.name));
}

function buildWiseReportGlobalAnalysisPage(route) {
  return finalizeGlobalSlimPage({
    peers: normalizeGlobalAnalysisPeers(route),
    metrics: normalizeGlobalAnalysisMetrics(route),
    returns: normalizeGlobalAnalysisReturns(route),
  });
}

function pickWiseReportGlobalCompany(domainData, ticker) {
  const normalized = unwrapWiseReportGlobalDomainData(domainData);
  const snapMeta = normalized.routes?.['company-snap']?.items?.['snap-summary-chart']?.data?.Data1 ?? {};
  const compareMeta = normalized.routes?.['company-analysis']?.items?.['compare-list']?.data?.data?.[0] ?? {};
  const bandMeta = normalized.routes?.['company-snap']?.items?.['snap-band-1']?.data?.Data2 ?? {};
  const consensusMeta = normalized.routes?.['company-consensus']?.items?.['consensus-trend-chart']?.data?.Data1 ?? {};

  const cmpCode = String(normalized.cmpCode || compareMeta.TICKER || `${ticker || normalized.ticker || ''}-US` || '');
  const fallbackTicker = cmpCode.includes('-') ? cmpCode.split('-')[0] : cmpCode;

  return {
    ticker: String(normalized.ticker || ticker || fallbackTicker || ''),
    cmpCode,
    name: normalizeGlobalSlimText(snapMeta.CMP_NM || compareMeta.PROPER_NAME),
    exchange: normalizeGlobalSlimText(snapMeta.MKT_NM || compareMeta.EX_NM),
    market: normalizeGlobalSlimText(compareMeta.ISO_CD || cmpCode.split('-').pop()),
    currency: normalizeGlobalSlimText(snapMeta.CURRENCY || bandMeta.CURRENCY || consensusMeta.CURRENCY),
  };
}

function buildWiseReportGlobalSlimPayloadV1(domainData, ticker) {
  const normalized = unwrapWiseReportGlobalDomainData(domainData);
  const company = pickWiseReportGlobalCompany(normalized, ticker);
  const pages = Object.fromEntries(WISEREPORT_GLOBAL_COMPANY_SLIM_V1_ROUTES.map(([routeId, pageKey]) => {
    const route = normalized.routes?.[routeId];
    switch (routeId) {
      case 'company-snap':
        return [pageKey, buildWiseReportGlobalSnapPage(route)];
      case 'company-finance':
        return [pageKey, buildWiseReportGlobalFinancePage(route)];
      case 'company-invest':
        return [pageKey, buildWiseReportGlobalInvestPage(route)];
      case 'company-consensus':
        return [pageKey, buildWiseReportGlobalConsensusPage(route)];
      case 'company-analysis':
        return [pageKey, buildWiseReportGlobalAnalysisPage(route)];
      default:
        return [pageKey, null];
    }
  }));

  return {
    ticker: company.ticker,
    cmpCode: company.cmpCode,
    company,
    pages,
  };
}


function compactDefinedKeepNull(input = {}) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function normalizeGlobalSecurityId(value) {
  return normalizeGlobalSlimScalar(value);
}

function normalizeGlobalTickerSymbol(value) {
  const normalized = normalizeGlobalSecurityId(value);
  if (!normalized) {
    return null;
  }
  return String(normalized).split('-')[0] || null;
}

function normalizeGlobalMarketCode(value) {
  const normalized = normalizeGlobalSlimText(value);
  return normalized ? normalized.toUpperCase() : null;
}

function normalizeGlobalExchangeCode(value) {
  const normalized = normalizeGlobalSlimText(value);
  return normalized ? normalized.toUpperCase() : null;
}

function slugifyGlobalSlimId(value, fallback = 'value') {
  const normalized = String(value ?? '')
    .toLowerCase()
    .replace(/\(e\)/g, ' est ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function inferGlobalPeriodFrequency(label) {
  if (typeof label !== 'string') {
    return null;
  }
  if (/^fwd\.?/i.test(label)) {
    return 'forward';
  }
  return null;
}

function buildGlobalPeriodDescriptors(labels, options = {}) {
  const { fallbackPrefix = 'period' } = options;
  const seen = new Map();

  return labels.map((rawLabel, index) => {
    const label = normalizeGlobalSlimScalar(rawLabel) ?? `${fallbackPrefix}${index + 1}`;
    const estimate = typeof label === 'string' ? /\(E\)$/i.test(label.trim()) : false;
    const canonicalLabel = typeof label === 'string' ? label.replace(/\(E\)$/i, '').trim() : label;
    const frequency = inferGlobalPeriodFrequency(canonicalLabel);
    const dedupeKey = String(canonicalLabel || label || `${fallbackPrefix}${index + 1}`);
    const occurrence = (seen.get(dedupeKey) || 0) + 1;
    seen.set(dedupeKey, occurrence);

    const prefix = frequency === 'forward' ? 'fwd' : fallbackPrefix;
    const slug = slugifyGlobalSlimId(canonicalLabel || label || `${fallbackPrefix}-${index + 1}`, `${fallbackPrefix}-${index + 1}`);
    const id = occurrence == 1 ? `${prefix}:${slug}` : `${prefix}:${slug}:${occurrence}`;

    return {
      id,
      label,
      frequency,
      estimate,
      sequence: index + 1,
      sourceIndex: index + 1,
    };
  });
}

function buildGlobalCellsFromPrefixedValues(record, prefix, columns, opts = {}) {
  const { matcher = getGlobalPrefixedKeyMatcher(prefix) } = opts;
  const keys = getOrderedGlobalPrefixedKeys(record, prefix, matcher);
  return Object.fromEntries(keys
    .map((key, index) => [columns[index]?.id ?? `${prefix.toLowerCase()}:${index + 1}`, normalizeGlobalSlimScalar(record?.[key])])
    .filter(([, value]) => value != null));
}

function getGlobalBodyValueColumnCount(rows, prefix, matcher) {
  return Array.isArray(rows)
    ? rows.reduce((maxCount, row) => {
      const keys = getOrderedGlobalPrefixedKeys(row, prefix, matcher);
      const lastNonNullIndex = keys.reduce((foundIndex, key, index) => {
        const value = normalizeGlobalSlimScalar(row?.[key]);
        return value != null ? index + 1 : foundIndex;
      }, 0);
      return Math.max(maxCount, lastNonNullIndex);
    }, 0)
    : 0;
}

function buildGlobalTableBlockFromRows(headerData, bodyRows, config = {}) {
  const {
    headerPrefix = 'YYMM',
    valuePrefix = 'DATA',
    valueMatcher = /^DATA\d+$/,
    rowIdField,
    labelField,
    unitField,
    levelField,
    metaBuilder,
    sectionRowMatcher,
  } = config;
  const labels = getGlobalPeriodLabels(headerData, headerPrefix);
  const bodyValueColumnCount = getGlobalBodyValueColumnCount(bodyRows, valuePrefix, valueMatcher);
  const effectiveLabels = bodyValueColumnCount > 0 ? labels.slice(0, bodyValueColumnCount) : labels;
  const columns = buildGlobalPeriodDescriptors(effectiveLabels, { fallbackPrefix: 'period' });
  const normalizedRows = Array.isArray(bodyRows)
    ? bodyRows.map((row, index) => {
      const cells = buildGlobalCellsFromPrefixedValues(row, valuePrefix, columns, { matcher: valueMatcher });
      const label = normalizeGlobalSlimText(row?.[labelField]);
      const rowId = normalizeGlobalSlimScalar(row?.[rowIdField]) ?? `row:${index + 1}`;
      const unit = unitField ? normalizeGlobalSlimText(row?.[unitField]) : null;
      const level = levelField ? (row?.[levelField] ?? null) : null;
      const isSection = typeof sectionRowMatcher === 'function'
        ? sectionRowMatcher(row, { index, cells, label, rowId }) === true
        : false;
      const meta = compactDefinedKeepNull({
        rowType: isSection ? 'section' : 'metric',
        level,
        unit,
        ...(metaBuilder ? metaBuilder(row, { index, cells, label, rowId, isSection }) : {}),
      });

      return compactDefinedKeepNull({
        rowId: String(rowId),
        label,
        meta,
        cells,
      });
    }).filter((row) => row.label != null || Object.keys(row.cells).length > 0)
    : [];
  const rows = normalizedRows.filter((row) => row.meta?.rowType !== 'section');
  const sectionRows = normalizedRows.filter((row) => row.meta?.rowType === 'section');

  return compactDefinedKeepNull({
    columns,
    rows,
    sectionRows: sectionRows.length ? sectionRows : undefined,
    availability: {
      status: columns.length || normalizedRows.length ? 'ok' : 'empty',
      note: null,
    },
  });
}

function buildGlobalChartBlockV11(chartId, chart) {
  if (!chart || typeof chart !== 'object') {
    return null;
  }

  const xPoints = buildGlobalPeriodDescriptors(
    Array.isArray(chart.categories?.YYMM)
      ? chart.categories.YYMM.map((value) => normalizeGlobalSlimScalar(value)).filter((value) => value != null)
      : [],
    { fallbackPrefix: 'point' },
  );

  const yAxes = Array.isArray(chart.yAxis_title)
    ? chart.yAxis_title.map((label, index) => ({
      id: index === 0 ? 'left' : index === 1 ? 'right' : `axis${index + 1}`,
      label: normalizeGlobalSlimText(label),
    }))
    : [];

  const series = Array.isArray(chart.series)
    ? chart.series.map((item, index) => ({
      id: `series:${slugifyGlobalSlimId(item?.name, String(index + 1))}`,
      name: normalizeGlobalSlimText(item?.name),
      type: normalizeGlobalSlimScalar(item?.type),
      unit: normalizeGlobalSlimText(item?.unit),
      axisId: item?.yAxis == 1 ? 'right' : item?.yAxis == 0 ? 'left' : (yAxes[item?.yAxis] ? yAxes[item.yAxis].id : 'left'),
      points: Array.isArray(item?.data)
        ? item.data.map((value, pointIndex) => ({
          x: xPoints[pointIndex]?.id ?? `point:${pointIndex + 1}`,
          y: normalizeGlobalSlimScalar(value),
        })).filter((point) => point.y != null)
        : [],
    })).filter((item) => item.name != null || item.points.length)
    : [];

  return {
    id: chartId,
    title: normalizeGlobalSlimText(chart.title),
    xAxis: {
      type: 'period',
      points: xPoints,
    },
    yAxes,
    series,
    availability: {
      status: xPoints.length || series.length ? 'ok' : 'empty',
      note: null,
    },
  };
}

function buildGlobalChartMapV11(itemData, chartIds = ['chartData1', 'chartData2']) {
  return Object.fromEntries(chartIds.map((chartId) => [chartId, buildGlobalChartBlockV11(chartId, itemData?.[chartId]) ?? null]));
}

function buildGlobalBandV11(itemData, bandId) {
  const history = Array.isArray(itemData?.Data1)
    ? itemData.Data1.map((row) => ({
      date: normalizeGlobalSlimDate(row?.TRD_DT),
      price: normalizeGlobalSlimScalar(row?.ADJ_PRC),
      isForecast: normalizeGlobalSlimScalar(row?.ADJ_PRC) == null,
      bands: {
        p1: normalizeGlobalSlimScalar(row?.DATA1),
        p2: normalizeGlobalSlimScalar(row?.DATA2),
        p3: normalizeGlobalSlimScalar(row?.DATA3),
        p4: normalizeGlobalSlimScalar(row?.DATA4),
      },
    })).filter((row) => row.date != null || row.price != null)
    : [];

  return {
    id: bandId,
    legend: null,
    bandDefinitions: ['p1', 'p2', 'p3', 'p4'].map((key) => ({
      id: key,
      label: null,
      semanticStatus: 'source-opaque',
    })),
    levels: {
      p1: normalizeGlobalSlimScalar(itemData?.Data2?.P1),
      p2: normalizeGlobalSlimScalar(itemData?.Data2?.P2),
      p3: normalizeGlobalSlimScalar(itemData?.Data2?.P3),
      p4: normalizeGlobalSlimScalar(itemData?.Data2?.P4),
      currency: normalizeGlobalSlimText(itemData?.Data2?.CURRENCY),
    },
    history,
    availability: {
      status: history.length ? 'ok' : 'empty',
      note: null,
    },
  };
}

function buildWiseReportGlobalSnapPageV11(route) {
  const news = normalizeGlobalNews(route).map((item) => ({
    id: item.storyId ?? null,
    publishedAt: item.publishedAt ?? null,
    titles: {
      en: item.title ?? null,
      ko: item.titleKo ?? null,
    },
  }));
  const priceVolume = route?.items?.['snap-summary-chart']?.data;
  const priceVolumeRows = Array.isArray(priceVolume?.Data2)
    ? priceVolume.Data2.map((row) => ({
      date: normalizeGlobalSlimDate(row?.TRD_DT),
      close: normalizeGlobalSlimScalar(row?.CMP_CLS),
      benchmarkRelative: normalizeGlobalSlimScalar(row?.CMP_KOSPI),
      volume: normalizeGlobalSlimScalar(row?.TRD_QTY),
      turnover: normalizeGlobalSlimScalar(row?.TRD_AMT),
    })).filter((row) => row.date != null || row.close != null)
    : [];
  const esgSummarySource = route?.items?.['snap-esg-chart']?.data?.Data1?.[0] ?? null;
  const esgPeerComparisonSource = route?.items?.['snap-esg-chart']?.data?.Data2;

  return {
    news,
    valuationBands: {
      primary: buildGlobalBandV11(route?.items?.['snap-band-1']?.data, 'band1'),
      secondary: buildGlobalBandV11(route?.items?.['snap-band-2']?.data, 'band2'),
    },
    financialSummary: buildGlobalTableBlockFromRows(route?.items?.['snap-financial-summary']?.data?.Data1, route?.items?.['snap-financial-summary']?.data?.Data2, {
      valuePrefix: 'VAL',
      valueMatcher: /^VAL\d+$/,
      rowIdField: 'ITEM_SMB',
      labelField: 'ITEM_NM',
      unitField: 'UNIT',
      levelField: 'LVL',
      sectionRowMatcher: (row) => row?.ITEM_SMB == null && row?.POINT_CNT === -1,
      metaBuilder: (row) => ({
        pointCount: row?.POINT_CNT ?? null,
      }),
    }),
    priceVolume: {
      samplingInterval: 'weekly_or_source_defined',
      currency: normalizeGlobalSlimText(priceVolume?.Data1?.CURRENCY),
      market: normalizeGlobalExchangeCode(priceVolume?.Data1?.MKT_NM),
      benchmark: {
        label: normalizeGlobalSlimText(priceVolume?.Data1?.KRX_NM),
        semanticType: 'relative_performance',
      },
      units: {
        close: normalizeGlobalSlimText(priceVolume?.Data1?.CURRENCY),
        benchmarkRelative: '%',
        volume: null,
        turnover: null,
      },
      rows: priceVolumeRows,
      availability: {
        status: priceVolumeRows.length ? 'ok' : 'empty',
        note: null,
      },
    },
    esg: {
      ratings: buildGlobalTableBlockFromRows(
        Array.isArray(route?.items?.['snap-esg-json']?.data?.Data1) ? route.items['snap-esg-json'].data.Data1[0] : route?.items?.['snap-esg-json']?.data?.Data1,
        route?.items?.['snap-esg-json']?.data?.Data2,
        {
          valuePrefix: 'DATA',
          valueMatcher: /^DATA\d+$/,
          rowIdField: 'ITEM',
          labelField: 'ITEM',
          metaBuilder: (row) => ({ labelEn: normalizeGlobalSlimText(row?.ITEM_ENG) ?? null }),
        },
      ),
      summary: {
        companyName: normalizeGlobalSlimText(esgSummarySource?.COMP_NM),
        esgScore: normalizeGlobalSlimScalar(esgSummarySource?.ESG_SCORE),
        eScore: normalizeGlobalSlimScalar(esgSummarySource?.E_SCORE),
        sScore: normalizeGlobalSlimScalar(esgSummarySource?.S_SCORE),
        gScore: normalizeGlobalSlimScalar(esgSummarySource?.G_SCORE),
      },
      peerComparison: Array.isArray(esgPeerComparisonSource)
        ? esgPeerComparisonSource.map((row) => ({
          sectorCode: normalizeGlobalSlimScalar(row?.SEC_CD),
          sectorType: normalizeGlobalSlimScalar(row?.SEC_TYP),
          year: normalizeGlobalSlimScalar(row?.YYYY),
          esgAvg: normalizeGlobalSlimScalar(row?.ESG_AVG),
          esgMin: normalizeGlobalSlimScalar(row?.ESG_MIN),
          esgMinName: normalizeGlobalSlimText(row?.ESG_MIN_NM),
          esgMax: normalizeGlobalSlimScalar(row?.ESG_MAX),
          esgMaxName: normalizeGlobalSlimText(row?.ESG_MAX_NM),
          eAvg: normalizeGlobalSlimScalar(row?.E_AVG),
          sAvg: normalizeGlobalSlimScalar(row?.S_AVG),
          gAvg: normalizeGlobalSlimScalar(row?.G_AVG),
        }))
        : [],
    },
  };
}

function buildWiseReportGlobalFinancePageV11(route) {
  return {
    statements: {
      income: buildGlobalTableBlockFromRows(route?.items?.['fin-statement']?.data?.HeaderData, route?.items?.['fin-statement']?.data?.BodyData, {
        valuePrefix: 'DATA',
        valueMatcher: /^DATA\d+$/,
        rowIdField: 'ACCODE',
        labelField: 'ACC_NM',
        unitField: 'UNIT',
        levelField: 'LVL',
      }),
      balanceSheet: buildGlobalTableBlockFromRows(route?.items?.['fin-balance-sheet']?.data?.HeaderData, route?.items?.['fin-balance-sheet']?.data?.BodyData, {
        valuePrefix: 'DATA',
        valueMatcher: /^DATA\d+$/,
        rowIdField: 'ACCODE',
        labelField: 'ACC_NM',
        unitField: 'UNIT',
        levelField: 'LVL',
      }),
      cashFlow: buildGlobalTableBlockFromRows(route?.items?.['fin-cash-flow']?.data?.HeaderData, route?.items?.['fin-cash-flow']?.data?.BodyData, {
        valuePrefix: 'DATA',
        valueMatcher: /^DATA\d+$/,
        rowIdField: 'ACCODE',
        labelField: 'ACC_NM',
        unitField: 'UNIT',
        levelField: 'LVL',
      }),
    },
    charts: buildGlobalChartMapV11(route?.items?.['fin-chart']?.data),
  };
}

function buildWiseReportGlobalInvestPageV11(route) {
  return {
    metrics: buildGlobalTableBlockFromRows(route?.items?.['invest-statement']?.data?.HeaderData, route?.items?.['invest-statement']?.data?.BodyData, {
      valuePrefix: 'DATA',
      valueMatcher: /^DATA\d+$/,
      rowIdField: 'ACCODE',
      labelField: 'ACC_NM',
      unitField: 'UNIT',
      levelField: 'LVL',
    }),
    charts: buildGlobalChartMapV11(route?.items?.['invest-chart']?.data),
  };
}

function buildWiseReportGlobalConsensusPageV11(route) {
  const itemData = route?.items?.['consensus-trend-chart']?.data;
  const targetPeriods = buildGlobalPeriodDescriptors(getGlobalPeriodLabels(itemData?.Data1), { fallbackPrefix: 'period' });
  const metricKeys = Array.from(new Set((Array.isArray(itemData?.Data2) ? itemData.Data2 : []).flatMap((row) => getOrderedGlobalPrefixedKeys(row, 'VAL', /^VAL\d+$/))));
  const metricDefinitions = metricKeys.map((sourceField) => ({
    id: sourceField.toLowerCase(),
    sourceField,
    label: null,
  }));

  return {
    currency: normalizeGlobalSlimText(itemData?.Data1?.CURRENCY),
    targetPeriods,
    metricDefinitions,
    observations: Array.isArray(itemData?.Data2)
      ? itemData.Data2.map((row) => {
        const targetPeriodLabel = normalizeGlobalSlimScalar(row?.YYMM);
        const targetPeriod = targetPeriods.find((period) => period.label === targetPeriodLabel) ?? null;
        return {
          asOfDate: normalizeGlobalSlimDate(row?.TRD_DT),
          targetPeriodId: targetPeriod?.id ?? null,
          targetPeriodLabel: targetPeriodLabel ?? null,
          metrics: Object.fromEntries(metricKeys
            .map((sourceField) => [sourceField.toLowerCase(), normalizeGlobalSlimScalar(row?.[sourceField])])
            .filter(([, value]) => value != null)),
        };
      })
      : [],
    availability: {
      status: Array.isArray(itemData?.Data2) && itemData.Data2.length ? 'ok' : 'empty',
      note: null,
    },
  };
}

function buildGlobalAnalysisPeerMembers(route, parsed = {}) {
  const peers = parsed.peers ?? normalizeGlobalAnalysisPeers(route);
  const metrics = parsed.metrics ?? normalizeGlobalAnalysisMetrics(route);
  const returns = parsed.returns ?? normalizeGlobalAnalysisReturns(route);

  const peerMap = new Map();

  for (const peer of peers) {
    const securityId = normalizeGlobalSecurityId(peer.ticker);
    if (!securityId) {
      continue;
    }
    peerMap.set(securityId, {
      company: {
        securityId,
        ticker: normalizeGlobalTickerSymbol(securityId),
        exchange: normalizeGlobalExchangeCode(peer.exchange),
        market: normalizeGlobalMarketCode(peer.market),
        name: peer.name ?? null,
      },
      metrics: {
        per: null,
        epsGw: null,
        pbr: null,
        roe: null,
        eps: null,
        evEbitda: null,
      },
      returns: {
        return1dPct: null,
        return1wPct: null,
        return3mPct: null,
        return6mPct: null,
        return1yPct: null,
        return3yPct: null,
      },
    });
  }

  for (const metric of metrics) {
    const securityId = normalizeGlobalSecurityId(metric.ticker);
    if (!securityId) {
      continue;
    }
    const member = peerMap.get(securityId) ?? {
      company: {
        securityId,
        ticker: normalizeGlobalTickerSymbol(securityId),
        exchange: null,
        market: null,
        name: metric.name ?? null,
      },
      metrics: {
        per: null,
        epsGw: null,
        pbr: null,
        roe: null,
        eps: null,
        evEbitda: null,
      },
      returns: {
        return1dPct: null,
        return1wPct: null,
        return3mPct: null,
        return6mPct: null,
        return1yPct: null,
        return3yPct: null,
      },
    };
    member.company.name = member.company.name ?? metric.name ?? null;
    member.metrics = {
      per: metric.per ?? null,
      epsGw: metric.epsGw ?? null,
      pbr: metric.pbr ?? null,
      roe: metric.roe ?? null,
      eps: metric.eps ?? null,
      evEbitda: metric.evEbitda ?? null,
    };
    peerMap.set(securityId, member);
  }

  for (const value of returns) {
    const securityId = normalizeGlobalSecurityId(value.ticker);
    if (!securityId) {
      continue;
    }
    const member = peerMap.get(securityId) ?? {
      company: {
        securityId,
        ticker: normalizeGlobalTickerSymbol(securityId),
        exchange: null,
        market: null,
        name: value.name ?? null,
      },
      metrics: {
        per: null,
        epsGw: null,
        pbr: null,
        roe: null,
        eps: null,
        evEbitda: null,
      },
      returns: {
        return1dPct: null,
        return1wPct: null,
        return3mPct: null,
        return6mPct: null,
        return1yPct: null,
        return3yPct: null,
      },
    };
    member.company.name = member.company.name ?? value.name ?? null;
    member.returns = {
      return1dPct: value['1d'] ?? null,
      return1wPct: value['1w'] ?? null,
      return3mPct: value['3m'] ?? null,
      return6mPct: value['6m'] ?? null,
      return1yPct: value['1y'] ?? null,
      return3yPct: value['3y'] ?? null,
    };
    peerMap.set(securityId, member);
  }

  return Array.from(peerMap.values());
}

function buildWiseReportGlobalAnalysisPageV11(route) {
  const peers = normalizeGlobalAnalysisPeers(route);
  const metrics = normalizeGlobalAnalysisMetrics(route);
  const returns = normalizeGlobalAnalysisReturns(route);

  return {
    peerGroup: {
      members: buildGlobalAnalysisPeerMembers(route, { peers, metrics, returns }),
      availability: {
        status: peers.length || metrics.length || returns.length ? 'ok' : 'empty',
        note: null,
      },
    },
    peers,
    metrics,
    returns,
  };
}

function buildWiseReportGlobalSlimPayloadV11(domainData, ticker) {
  const normalized = unwrapWiseReportGlobalDomainData(domainData);
  const companyV1 = pickWiseReportGlobalCompany(normalized, ticker);
  const securityId = normalizeGlobalSecurityId(companyV1.cmpCode);
  const company = {
    securityId,
    ticker: normalizeGlobalTickerSymbol(companyV1.ticker || securityId),
    market: normalizeGlobalMarketCode(companyV1.market),
    exchange: normalizeGlobalExchangeCode(companyV1.exchange),
    name: companyV1.name ?? null,
    currency: companyV1.currency ?? null,
  };

  return {
    schemaVersion: '1.1',
    company,
    pages: {
      snap: buildWiseReportGlobalSnapPageV11(normalized.routes?.['company-snap']),
      finance: buildWiseReportGlobalFinancePageV11(normalized.routes?.['company-finance']),
      invest: buildWiseReportGlobalInvestPageV11(normalized.routes?.['company-invest']),
      consensus: buildWiseReportGlobalConsensusPageV11(normalized.routes?.['company-consensus']),
      analysis: buildWiseReportGlobalAnalysisPageV11(normalized.routes?.['company-analysis']),
    },
    ticker: company.ticker,
    cmpCode: securityId,
  };
}

const endpointDefinitions = [
  {
    id: 'health',
    resource: 'system.health',
    description: '서버 생존 상태와 기본 런타임 정보를 반환합니다.',
    primaryPath: '/health',
    aliases: [],
    params: [],
    query: [],
    count: 1,
    handler: async () => ({
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      status: 'ok',
      node: process.version,
      uptimeSec: Math.round(process.uptime()),
      responseEnvelope: RESPONSE_ENVELOPE_KEYS,
    }),
  },
  {
    id: 'catalog',
    resource: 'system.catalog',
    description: '이 서버가 제공하는 data provider API 카탈로그를 반환합니다.',
    primaryPath: '/api/catalog',
    aliases: ['/crawlers'],
    params: [],
    query: [],
    count: (data) => Array.isArray(data?.endpoints) ? data.endpoints.length : 0,
    meta: () => ({ wisereportGlobalRouteCount: WISEREPORT_GLOBAL_ROUTES.length }),
    handler: async () => ({
      responseEnvelope: RESPONSE_ENVELOPE_KEYS,
      endpoints: buildCatalogEntries(),
      wisereportGlobalRoutes: WISEREPORT_GLOBAL_ROUTES,
    }),
  },
  {
    id: 'wisereport-kr',
    resource: 'wisereport.kr.aggregate',
    description: '한국 상장사 WiseReport/FnGuide 10개 페이지의 구조화 aggregate 데이터를 반환합니다.',
    primaryPath: '/api/wisereport/kr/:code',
    aliases: ['/crawl/wisereport/kr/:code'],
    params: ['code'],
    query: [],
    count: (data) => Object.keys(normalizeWiseReportKrAggregate(data).pages || {}).length,
    meta: (data) => ({
      pageRouteCount: WISEREPORT_KR_PAGE_ROUTES.length,
      pageKeys: Object.keys(normalizeWiseReportKrAggregate(data).pages || {}),
      aliasNotice: 'The /crawl/wisereport/kr/:code alias remains supported for backward compatibility and now returns the structured aggregate payload.',
    }),
    handler: async (req) => buildWiseReportKrAggregatePayload(await getCrawl(req.params.code), req.params.code),
  },
  {
    id: 'wisereport-kr-slim-v1',
    resource: 'wisereport.kr.aggregate.slim.v1',
    description: '한국 상장사 WiseReport/FnGuide 10개 페이지의 비즈니스 전용 slim aggregate 데이터를 raw JSON으로 반환합니다.',
    primaryPath: '/api/wisereport/kr/:code/slim/v1',
    aliases: [],
    params: ['code'],
    query: [],
    rawSuccess: true,
    handler: async (req) => buildWiseReportKrSlimPayload(await getCrawl(req.params.code), req.params.code),
  },
  {
    id: 'wisereport-kr-slim-v1.1',
    resource: 'wisereport.kr.aggregate.slim.v1.1',
    description: '한국 상장사 WiseReport/FnGuide 10개 페이지의 slim v1.1 데이터를 raw JSON으로 반환합니다. parser-created spacer column, UI control text, non-business tab sections를 정리합니다.',
    primaryPath: '/api/wisereport/kr/:code/slim/v1.1',
    aliases: [],
    params: ['code'],
    query: [],
    rawSuccess: true,
    handler: async (req) => buildWiseReportKrSlimPayloadV11(await getCrawl(req.params.code), req.params.code),
  },
  ...WISEREPORT_KR_PAGE_ROUTES.map((route) => ({
    id: route.id,
    resource: route.resource,
    description: route.description,
    primaryPath: `/api/wisereport/kr/:code/${route.slug}`,
    aliases: [],
    params: ['code'],
    query: [],
    count: 1,
    meta: () => ({
      aggregateRoute: '/api/wisereport/kr/:code',
      pageKey: route.pageKey,
      pageSlug: route.slug,
    }),
    handler: async (req) => crawlWiseReportKrPage(req.params.code, route.pageKey),
  })),
  {
    id: 'market-overview-kr',
    resource: 'market.overview.kr',
    description: '국내 시장 요약 텍스트(KOSPI/KOSDAQ)를 반환합니다.',
    primaryPath: '/api/market/overview/kr',
    aliases: ['/crawl/market'],
    params: [],
    query: [],
    handler: async () => crawlMarketData(),
  },
  {
    id: 'market-fx-usd-krw',
    resource: 'market.fx.usd-krw',
    description: 'USD/KRW 환율 스냅샷을 반환합니다.',
    primaryPath: '/api/market/fx/usd-krw',
    aliases: ['/crawl/usd-krw'],
    params: [],
    query: [],
    count: 1,
    handler: async () => fetchUsdKrwRate(),
  },
  {
    id: 'market-indicators',
    resource: 'market.indicators',
    description: 'VKOSPI, ADR, US VIX를 한 번에 반환합니다.',
    primaryPath: '/api/market/indicators',
    aliases: ['/crawl/indicators/all'],
    params: [],
    query: [],
    handler: async () => fetchAllMarketIndicators(),
  },
  {
    id: 'market-indicators-vkospi',
    resource: 'market.indicators.vkospi',
    description: 'VKOSPI 단일 지표를 반환합니다.',
    primaryPath: '/api/market/indicators/vkospi',
    aliases: ['/crawl/indicators/vkospi'],
    params: [],
    query: [],
    count: 1,
    handler: async () => fetchVkospi(),
  },
  {
    id: 'market-indicators-adr',
    resource: 'market.indicators.adr',
    description: 'ADR 선행 지표를 반환합니다.',
    primaryPath: '/api/market/indicators/adr',
    aliases: ['/crawl/indicators/adr'],
    params: [],
    query: [],
    count: 1,
    handler: async () => fetchAdr(),
  },
  {
    id: 'market-indicators-us-vix',
    resource: 'market.indicators.us-vix',
    description: 'US VIX 단일 지표를 반환합니다.',
    primaryPath: '/api/market/indicators/us-vix',
    aliases: ['/crawl/indicators/us-vix'],
    params: [],
    query: [],
    count: 1,
    handler: async () => fetchUsVix(),
  },
  {
    id: 'wisereport-global',
    resource: 'wisereport.global.company',
    description: 'WiseReport Global 미국주식 페이지 원문/보조 데이터를 수집합니다.',
    primaryPath: '/api/wisereport/global/:ticker',
    aliases: ['/crawl/wisereport/global/:ticker'],
    params: ['ticker'],
    query: ['routes(optional, comma-separated)'],
    meta: () => ({ wisereportGlobalRouteCount: WISEREPORT_GLOBAL_ROUTES.length }),
    handler: async (req) => {
      const routes = parseCsvQuery(req.query.routes);
      return crawlWiseReportGlobal(req.params.ticker, routes.length > 0 ? { routes } : {});
    },
  },
  {
    id: 'wisereport-global-domain',
    resource: 'wisereport.global.domain',
    description: 'WiseReport Global 미국주식 도메인 정규화 데이터를 반환합니다.',
    primaryPath: '/api/wisereport/global/:ticker/domain',
    aliases: ['/crawl/wisereport/global/:ticker/domain'],
    params: ['ticker'],
    query: [],
    handler: async (req) => crawlWiseReportGlobalDomainData(req.params.ticker),
  },
  {
    id: 'wisereport-global-slim-v1',
    resource: 'wisereport.global.company.slim.v1',
    description: 'WiseReport Global 미국주식 Company 5개 route의 비즈니스 전용 slim aggregate 데이터를 raw JSON으로 반환합니다.',
    primaryPath: '/api/wisereport/global/:ticker/slim/v1',
    aliases: [],
    params: ['ticker'],
    query: [],
    rawSuccess: true,
    handler: async (req) => buildWiseReportGlobalSlimPayloadV1(
      await crawlWiseReportGlobalDomainData(req.params.ticker, { routes: WISEREPORT_GLOBAL_COMPANY_SLIM_V1_ROUTE_IDS }),
      req.params.ticker,
    ),
  },
  {
    id: 'wisereport-global-slim-v1.1',
    resource: 'wisereport.global.company.slim.v1.1',
    description: 'WiseReport Global 미국주식 Company 5개 route의 계약형 slim v1.1 aggregate 데이터를 raw JSON으로 반환합니다.',
    primaryPath: '/api/wisereport/global/:ticker/slim/v1.1',
    aliases: [],
    params: ['ticker'],
    query: [],
    rawSuccess: true,
    handler: async (req) => buildWiseReportGlobalSlimPayloadV11(
      await crawlWiseReportGlobalDomainData(req.params.ticker, { routes: WISEREPORT_GLOBAL_COMPANY_SLIM_V1_ROUTE_IDS }),
      req.params.ticker,
    ),
  },
  {
    id: 'us-stock-financials',
    resource: 'us-stock.financials',
    description: '미국주식 통합 재무 데이터를 반환합니다.',
    primaryPath: '/api/us-stock/financials/:ticker',
    aliases: [],
    params: ['ticker'],
    query: [],
    handler: async (req) => getUSFinancials(req.params.ticker),
  },
  {
    id: 'us-stock-consensus',
    resource: 'us-stock.consensus',
    description: '미국주식 통합 컨센서스/애널리스트 데이터를 반환합니다.',
    primaryPath: '/api/us-stock/consensus/:ticker',
    aliases: [],
    params: ['ticker'],
    query: [],
    handler: async (req) => getUSConsensus(req.params.ticker),
  },
  {
    id: 'us-stock-news',
    resource: 'us-stock.news',
    description: '미국주식 뉴스 및 감성 데이터를 반환합니다.',
    primaryPath: '/api/us-stock/news/:ticker',
    aliases: [],
    params: ['ticker'],
    query: ['limit(optional, default=10)'],
    handler: async (req) => {
      const rawLimit = req.query.limit;
      const limitValue = Array.isArray(rawLimit) ? rawLimit[0] : rawLimit;
      const normalizedLimit = limitValue == null ? '' : String(limitValue).trim();
      let limit;

      if (normalizedLimit) {
        limit = Number(normalizedLimit);
        if (!Number.isInteger(limit) || limit < 1) {
          throw new HttpError(400, 'invalid query: limit', {
            key: 'limit',
            value: normalizedLimit,
            expected: 'positive integer',
          });
        }
      }

      return getUSNews(req.params.ticker, limit);
    },
  },
  {
    id: 'us-stock-filings',
    resource: 'us-stock.filings',
    description: '미국주식 공시 데이터를 반환합니다.',
    primaryPath: '/api/us-stock/filings/:ticker',
    aliases: [],
    params: ['ticker'],
    query: [
      'limit(optional, default=10)',
      'filingTypes(optional, comma-separated)',
      'from(optional, YYYY-MM-DD)',
      'to(optional, YYYY-MM-DD)',
    ],
    handler: async (req) => {
      const rawLimit = req.query.limit;
      const limitValue = Array.isArray(rawLimit) ? rawLimit[0] : rawLimit;
      const normalizedLimit = limitValue == null ? '' : String(limitValue).trim();
      let limit;

      if (normalizedLimit) {
        limit = Number(normalizedLimit);
        if (!Number.isInteger(limit) || limit < 1) {
          throw new HttpError(400, 'invalid query: limit', {
            key: 'limit',
            value: normalizedLimit,
            expected: 'positive integer',
          });
        }
      }

      const filingTypes = parseCsvQuery(req.query.filingTypes);
      const from = parseOptionalIsoDateQuery(req, 'from');
      const to = parseOptionalIsoDateQuery(req, 'to');

      if (from && to && from > to) {
        throw new HttpError(400, 'invalid query: from/to', {
          keys: ['from', 'to'],
          from,
          to,
          expected: 'from <= to',
        });
      }

      return getUSFilings(req.params.ticker, {
        ...(limit == null ? {} : { limit }),
        ...(filingTypes.length > 0 ? { filingTypes } : {}),
        ...(from == null ? {} : { from }),
        ...(to == null ? {} : { to }),
      });
    },
  },
  {
    id: 'us-stock-company-facts',
    resource: 'us-stock.company-facts',
    description: '미국주식 SEC company facts 데이터를 반환합니다.',
    primaryPath: '/api/us-stock/company-facts/:ticker',
    aliases: [],
    params: ['ticker'],
    query: [],
    handler: async (req) => getCompanyFacts(req.params.ticker),
  },
  {
    id: 'us-stock-company-facts-taxonomies',
    resource: 'us-stock.company-facts.taxonomies',
    description: '미국주식 SEC company facts에서 사용 가능한 taxonomy 목록을 반환합니다.',
    primaryPath: '/api/us-stock/company-facts/:ticker/taxonomies',
    aliases: [],
    params: ['ticker'],
    query: [],
    count: (data) => Array.isArray(data?.taxonomies) ? data.taxonomies.length : 0,
    handler: async (req) => getCompanyFactsTaxonomies(req.params.ticker),
  },
  {
    id: 'us-stock-company-facts-taxonomy-concepts',
    resource: 'us-stock.company-facts.taxonomy-concepts',
    description: '미국주식 SEC company facts의 taxonomy별 concept 목록을 반환합니다.',
    primaryPath: '/api/us-stock/company-facts/:ticker/taxonomies/:taxonomy/concepts',
    aliases: [],
    params: ['ticker', 'taxonomy'],
    query: [],
    count: (data) => Array.isArray(data?.concepts) ? data.concepts.length : 0,
    handler: async (req) => {
      const data = await getCompanyFactsTaxonomyConcepts(req.params.ticker, req.params.taxonomy);
      if (data == null) {
        throw new HttpError(404, 'company facts taxonomy not found', {
          ticker: req.params.ticker,
          taxonomy: req.params.taxonomy,
        });
      }
      return data;
    },
  },
  {
    id: 'us-stock-company-facts-concept',
    resource: 'us-stock.company-facts.concept',
    description: '미국주식 SEC company facts의 단일 concept 상세 데이터를 반환합니다.',
    primaryPath: '/api/us-stock/company-facts/:ticker/taxonomies/:taxonomy/concepts/:concept',
    aliases: [],
    params: ['ticker', 'taxonomy', 'concept'],
    query: [],
    count: 1,
    handler: async (req) => {
      const data = await getCompanyFactsConcept(req.params.ticker, req.params.taxonomy, req.params.concept);
      if (data == null) {
        throw new HttpError(404, 'company facts concept not found', {
          ticker: req.params.ticker,
          taxonomy: req.params.taxonomy,
          concept: req.params.concept,
        });
      }
      return data;
    },
  },
  {
    id: 'us-market-indicators',
    resource: 'us-market.indicators',
    description: '미국 시장 지표(S&P 500, NASDAQ, VIX, SMA)를 반환합니다.',
    primaryPath: '/api/us-market/indicators',
    aliases: [],
    params: [],
    query: [],
    handler: async () => getUSMarketIndicators(),
  },
  {
    id: 'us-stock-report',
    resource: 'us-stock.report',
    description: '미국주식 리포트용 통합 원시 데이터를 반환합니다.',
    primaryPath: '/api/us-stock/report/:ticker',
    aliases: [],
    params: ['ticker'],
    query: [
      'includeFinancials(optional, default=true)',
      'includeConsensus(optional, default=true)',
      'includeNews(optional, default=true)',
      'includeFilings(optional, default=true)',
      'includeMarketIndicators(optional, default=true)',
      'newsLimit(optional, default=10)',
      'filingsLimit(optional, default=10)',
    ],
    handler: async (req) => {
      const options = {};

      for (const key of [
        'includeFinancials',
        'includeConsensus',
        'includeNews',
        'includeFilings',
        'includeMarketIndicators',
      ]) {
        const rawValue = req.query[key];
        const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
        const normalized = value == null ? '' : String(value).trim();

        if (!normalized) {
          continue;
        }

        const lowered = normalized.toLowerCase();
        if (lowered === 'true' || lowered === '1') {
          options[key] = true;
          continue;
        }
        if (lowered === 'false' || lowered === '0') {
          options[key] = false;
          continue;
        }

        throw new HttpError(400, `invalid query: ${key}`, {
          key,
          value: normalized,
          expected: 'boolean',
        });
      }

      for (const key of ['newsLimit', 'filingsLimit']) {
        const rawValue = req.query[key];
        const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
        const normalized = value == null ? '' : String(value).trim();

        if (!normalized) {
          continue;
        }

        const parsed = Number(normalized);
        if (!Number.isInteger(parsed) || parsed < 1) {
          throw new HttpError(400, `invalid query: ${key}`, {
            key,
            value: normalized,
            expected: 'positive integer',
          });
        }

        options[key] = parsed;
      }

      return getUSStockReportData(req.params.ticker, options);
    },
  },
  {
    id: 'krx-ohlcv',
    resource: 'krx.ohlcv',
    description: 'KRX 종목 OHLCV 시계열을 반환합니다.',
    primaryPath: '/api/krx/ohlcv/:ticker',
    aliases: ['/crawl/krx/ohlcv/:ticker'],
    params: ['ticker'],
    query: ['startDate(required, YYYYMMDD)', 'endDate(required, YYYYMMDD)'],
    handler: async (req) => {
      const { startDate, endDate } = requireQueryValues(req, ['startDate', 'endDate']);
      return getKrx(req.params.ticker, startDate, endDate);
    },
  },
  {
    id: 'krx-index',
    resource: 'krx.index.ohlcv',
    description: 'KRX 지수 OHLCV 시계열을 반환합니다.',
    primaryPath: '/api/krx/index/:indexCode',
    aliases: ['/crawl/krx/index/:indexCode'],
    params: ['indexCode'],
    query: ['startDate(required, YYYYMMDD)', 'endDate(required, YYYYMMDD)'],
    handler: async (req) => {
      const { startDate, endDate } = requireQueryValues(req, ['startDate', 'endDate']);
      return getIndexData(req.params.indexCode, startDate, endDate);
    },
  },
  {
    id: 'krx-investor-volume',
    resource: 'krx.investor-volume',
    description: 'KRX 투자자별 거래량 시계열을 반환합니다.',
    primaryPath: '/api/krx/investor-volume/:ticker',
    aliases: ['/crawl/krx/investor-volume/:ticker'],
    params: ['ticker'],
    query: ['startDate(required, YYYYMMDD)', 'endDate(required, YYYYMMDD)'],
    handler: async (req) => {
      const { startDate, endDate } = requireQueryValues(req, ['startDate', 'endDate']);
      return getInvestorVolume(req.params.ticker, startDate, endDate);
    },
  },
  {
    id: 'krx-market-snapshot',
    resource: 'krx.market.snapshot',
    description: '특정 거래일의 KRX 시장 스냅샷을 반환합니다.',
    primaryPath: '/api/krx/market/snapshot',
    aliases: ['/crawl/krx/market-snapshot'],
    params: [],
    query: ['tradeDate(required, YYYYMMDD)', 'market(optional, default=ALL)'],
    handler: async (req) => {
      const { tradeDate } = requireQueryValues(req, ['tradeDate']);
      const market = req.query.market ? String(req.query.market).trim() : 'ALL';
      return getMarketSnapshot(tradeDate, market);
    },
  },
  {
    id: 'krx-market-cap',
    resource: 'krx.market.cap',
    description: '특정 거래일의 KRX 시가총액 데이터를 반환합니다.',
    primaryPath: '/api/krx/market/cap',
    aliases: ['/crawl/krx/market-cap'],
    params: [],
    query: ['tradeDate(required, YYYYMMDD)', 'market(optional, default=ALL)'],
    handler: async (req) => {
      const { tradeDate } = requireQueryValues(req, ['tradeDate']);
      const market = req.query.market ? String(req.query.market).trim() : 'ALL';
      return getMarketCap(tradeDate, market);
    },
  },
  {
    id: 'krx-tickers',
    resource: 'krx.tickers',
    description: 'KRX 시장별 티커-종목명 맵을 반환합니다.',
    primaryPath: '/api/krx/tickers',
    aliases: ['/crawl/krx/ticker-names'],
    params: [],
    query: ['market(optional, default=ALL)'],
    handler: async (req) => {
      const market = req.query.market ? String(req.query.market).trim() : 'ALL';
      return getTickerNames(market);
    },
  },
  {
    id: 'krx-trigger-batch',
    resource: 'krx.batches.trigger',
    description: 'krx-js-client trigger batch를 실행한 결과를 반환합니다.',
    primaryPath: '/api/krx/batches/trigger',
    aliases: ['/crawl/krx/trigger-batch'],
    params: [],
    query: ['mode(optional, default=morning)'],
    handler: async (req) => {
      const mode = req.query.mode ? String(req.query.mode).trim() : 'morning';
      return runTriggerBatch(mode);
    },
  },
];

for (const definition of endpointDefinitions) {
  const paths = [definition.primaryPath, ...definition.aliases];

  for (const matchedPath of paths) {
    app.get(matchedPath, async (req, res) => {
      try {
        const data = await definition.handler(req);
        sendSuccess(req, res, definition, matchedPath, data);
      } catch (error) {
        sendFailure(req, res, definition, matchedPath, error);
      }
    });
  }
}

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    data: null,
    count: 0,
    request: {
      method: req.method,
      path: req.originalUrl,
      primaryPath: null,
      aliasOf: null,
      params: normalizeObject(req.params),
      query: normalizeObject(req.query),
    },
    meta: {
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      resource: 'system.not-found',
      routeId: 'not-found',
      description: '등록되지 않은 엔드포인트입니다.',
      generatedAt: new Date().toISOString(),
      aliases: [],
      deprecatedAliasUsed: null,
    },
    error: {
      message: 'not found',
      details: null,
    },
  });
});

app.use((error, req, res, _next) => {
  const status = Number(error?.status) || 500;
  res.status(status).json({
    ok: false,
    data: null,
    count: 0,
    request: {
      method: req.method,
      path: req.originalUrl,
      primaryPath: null,
      aliasOf: null,
      params: normalizeObject(req.params),
      query: normalizeObject(req.query),
    },
    meta: {
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      resource: 'system.error',
      routeId: 'unhandled-error',
      description: '처리되지 않은 서버 오류입니다.',
      generatedAt: new Date().toISOString(),
      aliases: [],
      deprecatedAliasUsed: null,
    },
    error: {
      message: error?.message || 'unknown error',
      details: error instanceof HttpError ? error.details : null,
    },
  });
});

const isDirectExecution = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectExecution) {
  app.listen(port, () => {
    console.log(`[${SERVICE_NAME}] listening on :${port}`);
  });
}

export {
  app,
  buildWiseReportGlobalSlimPayloadV1,
  buildWiseReportGlobalSlimPayloadV11,
  buildWiseReportKrSlimPayload,
  buildWiseReportKrSlimPayloadV11,
  endpointDefinitions,
  slimWiseReportKrValue,
  slimWiseReportKrValueV11,
};
