/**
 * us-sec-filings.js — 미국주식 SEC 공시 조회
 *
 * - 공시 목록: FinnHub `/api/v1/filings?symbol=`
 * - 공시 상세/팩트: SEC EDGAR `data.sec.gov` (`secEdgarFetch` 경유)
 * - 8-K, 10-K, 10-Q 등 주요 공시 필터링
 */

import { finnhubFetch, secEdgarFetch } from './api-clients.js';

const SEC_WWW_BASE_URL = 'https://www.sec.gov';

/** 주요 공시 유형 정의 */
export const FILING_TYPES = Object.freeze({
  '10-K': '연간 보고서 (Annual Report)',
  '10-Q': '분기 보고서 (Quarterly Report)',
  '8-K': '주요 이벤트 보고서 (Current Report)',
  '10-K/A': '연간 보고서 수정',
  '10-Q/A': '분기 보고서 수정',
  '8-K/A': '주요 이벤트 보고서 수정',
  '20-F': '외국기업 연간 보고서 (ADR 등)',
  '6-K': '외국기업 주요 이벤트 보고서',
  'S-1': '신규 상장 등록 (IPO)',
  'S-3': '유가증권 등록',
  'DEF 14A': '주주총회 위임장',
  'SC 13D': '지분 5% 이상 공시',
  'SC 13G': '지분 5% 이상 공시 (수동)',
});

const HIGH_PRIORITY_TYPES = new Set(['8-K', '10-K', '10-Q']);
const HIGH_PRIORITY_TYPE_LIST = ['10-K', '10-Q', '8-K'];
const KEY_FILING_TYPES = ['10-K', '10-Q', '8-K', '10-K/A', '10-Q/A', '8-K/A'];

function normalizeFilingOptions(opts = {}) {
  const filingTypes = Array.isArray(opts.filingTypes)
    ? [...new Set(opts.filingTypes
      .map(type => String(type ?? '').trim())
      .filter(Boolean))]
    : [];
  const from = typeof opts.from === 'string' ? opts.from.trim() || undefined : undefined;
  const to = typeof opts.to === 'string' ? opts.to.trim() || undefined : undefined;

  return {
    filingTypes,
    from,
    to,
  };
}

function resolveRequestedKeyFilingTypes(filingTypes = []) {
  if (!filingTypes.length) return [...KEY_FILING_TYPES];

  const requestedTypes = new Set(filingTypes);
  return KEY_FILING_TYPES.filter(type => requestedTypes.has(type));
}

function pickFirstNonEmpty(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'string' && !value.trim()) continue;
    return value;
  }
  return null;
}

function normalizeFilingUrl(value) {
  const nextValue = pickFirstNonEmpty(value);
  if (!nextValue) return null;

  const url = String(nextValue).trim();
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('/')) return `${SEC_WWW_BASE_URL}${url}`;
  return url;
}

function normalizeFiledDate(value) {
  const nextValue = pickFirstNonEmpty(value);
  if (!nextValue) return null;

  const text = String(nextValue).trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return text.slice(0, 10);
  return text;
}

function getBaseFilingType(type) {
  return String(type || '').replace(/\/A$/, '');
}

function getFilingIdentity(filing = {}) {
  const accessionNumber = pickFirstNonEmpty(filing.accessionNumber, filing.accessNumber, filing.raw?.accessNumber, filing.raw?.accessionNumber);
  if (accessionNumber) return `accession:${String(accessionNumber)}`;
  if (filing.url) return `url:${filing.url}`;

  return [
    filing.source || '',
    filing.type || '',
    filing.filedDate || '',
    filing.acceptedDate || '',
    filing.reportDate || '',
    filing.title || '',
  ].join('|');
}

function parseFilingTimestamp(filing = {}) {
  const candidate = pickFirstNonEmpty(filing.acceptedDate, filing.filedDate, filing.reportDate);
  if (!candidate) return 0;

  const timestamp = Date.parse(String(candidate));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function sortFilingsNewestFirst(filings = []) {
  return [...filings].sort((a, b) => parseFilingTimestamp(b) - parseFilingTimestamp(a));
}

function dedupeFilings(filings = []) {
  const seen = new Set();
  const result = [];

  for (const filing of filings) {
    if (!filing || typeof filing !== 'object') continue;
    const key = getFilingIdentity(filing);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(filing);
  }

  return result;
}

function mergeRecentFilings(primary = [], fallback = []) {
  return sortFilingsNewestFirst(dedupeFilings([
    ...primary,
    ...fallback,
  ]));
}

function hasMissingHighPriorityTypes(filings = []) {
  const presentTypes = new Set(
    filings
      .map(filing => getBaseFilingType(filing?.type))
      .filter(Boolean),
  );

  return HIGH_PRIORITY_TYPE_LIST.some(type => !presentTypes.has(type));
}

function getFilingFilterDate(filing = {}) {
  return normalizeFiledDate(pickFirstNonEmpty(
    filing.filedDate,
    filing.acceptedDate,
    filing.reportDate,
    filing.raw?.filedDate,
    filing.raw?.filingDate,
    filing.raw?.acceptanceDate,
    filing.raw?.acceptedDate,
    filing.raw?.acceptanceDateTime,
    filing.raw?.reportDate,
  ));
}

function matchesFilingFilters(filing = {}, filters = {}) {
  const { filingTypes = [], from, to } = filters;

  if (filingTypes.length > 0 && !filingTypes.includes(filing?.type)) {
    return false;
  }

  if (!from && !to) {
    return true;
  }

  const filingDate = getFilingFilterDate(filing);
  if (!filingDate) {
    return false;
  }

  if (from && filingDate < from) {
    return false;
  }

  if (to && filingDate > to) {
    return false;
  }

  return true;
}

function filterFilings(filings = [], filters = {}) {
  return Array.isArray(filings)
    ? filings.filter(filing => matchesFilingFilters(filing, filters))
    : [];
}

function mergeKeyFilings(primary = [], fallback = [], limit = 10) {
  if (limit <= 0) return [];

  const primaryKeyFilings = sortFilingsNewestFirst(primary);
  const fallbackKeyFilings = sortFilingsNewestFirst(
    (fallback || []).filter(filing => KEY_FILING_TYPES.includes(filing?.type)),
  );

  const presentTypes = new Set(
    primaryKeyFilings
      .map(filing => getBaseFilingType(filing?.type))
      .filter(Boolean),
  );

  const supplements = HIGH_PRIORITY_TYPE_LIST
    .filter(type => !presentTypes.has(type))
    .map(type => fallbackKeyFilings.find(filing => getBaseFilingType(filing?.type) === type))
    .filter(Boolean);

  const merged = dedupeFilings([
    ...primaryKeyFilings,
    ...supplements,
    ...fallbackKeyFilings,
  ]);

  const selected = [];
  const selectedKeys = new Set();

  for (const filing of supplements) {
    if (selected.length >= limit) break;
    const key = getFilingIdentity(filing);
    if (selectedKeys.has(key)) continue;
    selectedKeys.add(key);
    selected.push(filing);
  }

  for (const filing of merged) {
    if (selected.length >= limit) break;
    const key = getFilingIdentity(filing);
    if (selectedKeys.has(key)) continue;
    selectedKeys.add(key);
    selected.push(filing);
  }

  return sortFilingsNewestFirst(selected).slice(0, limit);
}

/**
 * SEC 공시 목록 조회 (FinnHub)
 * @param {string} ticker - 종목 심볼
 * @param {Object} [opts]
 * @param {string[]} [opts.filingTypes] - 필터링할 공시 유형
 * @param {number} [opts.limit=20] - 최대 조회 수
 * @param {string} [opts.from] - 시작일 (YYYY-MM-DD)
 * @param {string} [opts.to] - 종료일 (YYYY-MM-DD)
 * @returns {Promise<Array|null>}
 */
export async function getFilings(ticker, opts = {}) {
  const { filingTypes, limit = 20, from, to } = opts;

  let path = `/filings?symbol=${encodeURIComponent(ticker)}`;
  if (from) path += `&from=${from}`;
  if (to) path += `&to=${to}`;

  const data = await finnhubFetch(path, { cacheTTL: 30 * 60 * 1000 });
  if (!Array.isArray(data)) return null;

  let filings = data.map(normalizeFinnhubFiling);

  if (filingTypes?.length) {
    const typeSet = new Set(filingTypes);
    filings = filings.filter(filing => typeSet.has(filing.type));
  }

  return filings.slice(0, limit);
}

function normalizeFinnhubFiling(item = {}) {
  const filingType = item.form || item.filingType || '';
  const acceptedDate = pickFirstNonEmpty(item.acceptedDate, item.acceptanceDate, item.acceptanceDateTime);
  const reportDate = pickFirstNonEmpty(item.reportDate, item.periodOfReport, item.report?.reportDate);
  const accessionNumber = pickFirstNonEmpty(item.accessionNumber, item.accessionNo, item.accessNo, item.accessNumber);
  const cik = pickFirstNonEmpty(item.cik, item.report?.cik);

  return {
    type: filingType,
    typeLabel: FILING_TYPES[filingType] ?? filingType,
    title: item.title || item.description || filingType || '',
    description: item.description || item.title || '',
    filedDate: normalizeFiledDate(pickFirstNonEmpty(item.filedDate, item.filingDate, acceptedDate)),
    acceptedDate: pickFirstNonEmpty(acceptedDate, null),
    reportDate,
    fiscalYear: item.fiscalYear ?? null,
    fiscalPeriod: item.fiscalPeriod ?? null,
    url: buildFinnhubFilingUrl(item),
    priority: HIGH_PRIORITY_TYPES.has(filingType) ? 'high' : 'normal',
    provider: 'finnhub',
    source: 'finnhub-filings',
    accessionNumber: accessionNumber ?? null,
    cik: cik ?? null,
    raw: item,
  };
}

function buildFinnhubFilingUrl(item = {}) {
  const directUrl = normalizeFilingUrl(pickFirstNonEmpty(
    item.filingUrl,
    item.reportUrl,
    item.report?.filingUrl,
    item.report?.reportUrl,
    item.report?.fileUrl,
    item.report?.instanceUrl,
  ));
  if (directUrl) return directUrl;

  const accessionNumber = pickFirstNonEmpty(item.accessionNumber, item.accessionNo, item.accessNo, item.accessNumber);
  const cik = pickFirstNonEmpty(item.cik, item.report?.cik);
  const primaryDocument = pickFirstNonEmpty(item.primaryDocument, item.document, item.report?.primaryDocument);

  if (cik && accessionNumber) {
    return buildSecArchiveUrl(cik, accessionNumber, primaryDocument);
  }

  return null;
}

/**
 * 주요 공시만 필터링 (10-K, 10-Q, 8-K 계열)
 * @param {string} ticker - 종목 심볼
 * @param {number|Object} [limitOrOpts=10] - 최대 수 또는 옵션
 * @returns {Promise<Array|null>}
 */
export async function getKeyFilings(ticker, limitOrOpts = 10) {
  const opts = typeof limitOrOpts === 'number'
    ? { limit: limitOrOpts }
    : (limitOrOpts || {});
  const { limit = 10 } = opts;
  const filters = normalizeFilingOptions(opts);
  const filingTypes = resolveRequestedKeyFilingTypes(filters.filingTypes);

  if (!filingTypes.length) {
    return [];
  }

  return getFilings(ticker, {
    filingTypes,
    limit,
    ...(filters.from ? { from: filters.from } : {}),
    ...(filters.to ? { to: filters.to } : {}),
  });
}

async function resolveCIK(ticker) {
  const upperTicker = String(ticker ?? '').trim().toUpperCase();
  if (!upperTicker) return null;

  const tickerMap = await secEdgarFetch('/files/company_tickers.json', {
    baseUrl: SEC_WWW_BASE_URL,
    cacheTTL: 24 * 60 * 60 * 1000,
    cacheKey: 'sec:company_tickers.json',
  });
  if (!tickerMap || typeof tickerMap !== 'object') return null;

  for (const entry of Object.values(tickerMap)) {
    if (entry?.ticker === upperTicker) {
      return String(entry.cik_str);
    }
  }

  return null;
}

function buildSecArchiveUrl(cik, accessionNumber, primaryDocument) {
  if (!cik || !accessionNumber) return null;

  const numericCik = String(cik).replace(/^0+/, '');
  const accessionNoDash = String(accessionNumber).replace(/-/g, '');

  if (primaryDocument) {
    return `https://www.sec.gov/Archives/edgar/data/${numericCik}/${accessionNoDash}/${primaryDocument}`;
  }

  return `https://www.sec.gov/Archives/edgar/data/${numericCik}/${accessionNoDash}/`;
}

async function getSecRecentFilings(ticker, limit = 20) {
  const cik = await resolveCIK(ticker);
  if (!cik) return null;

  const paddedCik = String(cik).padStart(10, '0');
  const data = await secEdgarFetch(`/submissions/CIK${paddedCik}.json`, {
    cacheTTL: 30 * 60 * 1000,
  });
  const recent = data?.filings?.recent;
  const accessionNumbers = Array.isArray(recent?.accessionNumber) ? recent.accessionNumber : [];
  if (!accessionNumbers.length) return null;

  const filings = accessionNumbers.map((accessionNumber, index) => {
    const filingType = recent.form?.[index] || '';
    const description = recent.primaryDocDescription?.[index] || '';

    return {
      type: filingType,
      typeLabel: FILING_TYPES[filingType] ?? filingType,
      title: description || filingType || '',
      description,
      filedDate: recent.filingDate?.[index] || null,
      acceptedDate: recent.acceptanceDateTime?.[index] || null,
      reportDate: recent.reportDate?.[index] || null,
      fiscalYear: null,
      fiscalPeriod: null,
      url: buildSecArchiveUrl(cik, accessionNumber, recent.primaryDocument?.[index]),
      priority: HIGH_PRIORITY_TYPES.has(filingType) ? 'high' : 'normal',
      provider: 'sec',
      source: 'sec-submissions',
      accessionNumber,
      cik,
      raw: {
        accessionNumber,
        filingDate: recent.filingDate?.[index] || null,
        acceptanceDateTime: recent.acceptanceDateTime?.[index] || null,
        reportDate: recent.reportDate?.[index] || null,
        form: filingType,
        primaryDocument: recent.primaryDocument?.[index] || null,
        primaryDocDescription: description,
      },
    };
  }).filter(filing => filing.type || filing.filedDate || filing.url);

  return filings.slice(0, limit);
}

function normalizeCompanyFactsTicker(ticker) {
  return String(ticker ?? '').trim().toUpperCase();
}

function compareCompanyFactsKeys(a, b) {
  return String(a).localeCompare(String(b));
}

function getSortedCompanyFactsKeys(value) {
  return Object.keys(value || {}).sort(compareCompanyFactsKeys);
}

function buildCompanyFactsTaxonomySubset(facts = {}) {
  return {
    'us-gaap': facts['us-gaap'] || {},
    'ifrs-full': facts['ifrs-full'] || {},
  };
}

async function loadCompanyFactsData(ticker) {
  const normalizedTicker = normalizeCompanyFactsTicker(ticker);
  const cik = await resolveCIK(normalizedTicker);
  if (!cik) {
    console.warn(`[SEC] CIK 변환 실패: ${ticker}`);
    return null;
  }

  const paddedCik = cik.padStart(10, '0');
  const data = await secEdgarFetch(`/api/xbrl/companyfacts/CIK${paddedCik}.json`, {
    cacheTTL: 60 * 60 * 1000,
  });
  if (!data?.facts || typeof data.facts !== 'object') return null;

  return {
    ticker: normalizedTicker,
    cik: data.cik ?? cik,
    entityName: data.entityName ?? null,
    facts: data.facts,
    taxonomies: buildCompanyFactsTaxonomySubset(data.facts),
  };
}

function getCompanyFactsTaxonomyData(companyFacts = {}, taxonomy) {
  const normalizedTaxonomy = String(taxonomy ?? '').trim();
  if (!normalizedTaxonomy) return null;

  const facts = companyFacts?.facts;
  if (!facts || typeof facts !== 'object') return null;
  if (!Object.prototype.hasOwnProperty.call(facts, normalizedTaxonomy)) return null;

  const taxonomyFacts = facts[normalizedTaxonomy];
  return taxonomyFacts && typeof taxonomyFacts === 'object'
    ? { taxonomy: normalizedTaxonomy, data: taxonomyFacts }
    : null;
}

function getCompanyFactsConceptData(companyFacts = {}, taxonomy, concept) {
  const taxonomyEntry = getCompanyFactsTaxonomyData(companyFacts, taxonomy);
  if (!taxonomyEntry) return null;

  const normalizedConcept = String(concept ?? '').trim();
  if (!normalizedConcept) return null;
  if (!Object.prototype.hasOwnProperty.call(taxonomyEntry.data, normalizedConcept)) return null;

  const conceptData = taxonomyEntry.data[normalizedConcept];
  return conceptData && typeof conceptData === 'object'
    ? {
      taxonomy: taxonomyEntry.taxonomy,
      concept: normalizedConcept,
      data: conceptData,
    }
    : null;
}

/**
 * SEC EDGAR에서 기업 facts 조회
 * @param {string} ticker - 종목 심볼
 * @returns {Promise<Object|null>} { cik, entityName, facts }
 */
export async function getCompanyFacts(ticker) {
  const companyFacts = await loadCompanyFactsData(ticker);
  if (!companyFacts) return null;

  return {
    cik: companyFacts.cik,
    entityName: companyFacts.entityName,
    facts: companyFacts.facts,
    taxonomies: companyFacts.taxonomies,
  };
}

export async function getCompanyFactsTaxonomies(ticker) {
  const companyFacts = await loadCompanyFactsData(ticker);
  if (!companyFacts) return null;

  const taxonomyNames = getSortedCompanyFactsKeys(companyFacts.facts);
  return {
    ticker: companyFacts.ticker,
    cik: companyFacts.cik,
    entityName: companyFacts.entityName,
    taxonomyCount: taxonomyNames.length,
    taxonomies: taxonomyNames.map((taxonomyName) => ({
      taxonomy: taxonomyName,
      conceptCount: getSortedCompanyFactsKeys(companyFacts.facts[taxonomyName]).length,
    })),
  };
}

export async function getCompanyFactsTaxonomyConcepts(ticker, taxonomy) {
  const companyFacts = await loadCompanyFactsData(ticker);
  if (!companyFacts) return null;

  const taxonomyEntry = getCompanyFactsTaxonomyData(companyFacts, taxonomy);
  if (!taxonomyEntry) return null;

  const conceptNames = getSortedCompanyFactsKeys(taxonomyEntry.data);
  return {
    ticker: companyFacts.ticker,
    cik: companyFacts.cik,
    entityName: companyFacts.entityName,
    taxonomy: taxonomyEntry.taxonomy,
    conceptCount: conceptNames.length,
    concepts: conceptNames,
  };
}

export async function getCompanyFactsConcept(ticker, taxonomy, concept) {
  const companyFacts = await loadCompanyFactsData(ticker);
  if (!companyFacts) return null;

  const conceptEntry = getCompanyFactsConceptData(companyFacts, taxonomy, concept);
  if (!conceptEntry) return null;

  return {
    ticker: companyFacts.ticker,
    cik: companyFacts.cik,
    entityName: companyFacts.entityName,
    taxonomy: conceptEntry.taxonomy,
    concept: conceptEntry.concept,
    label: conceptEntry.data.label ?? null,
    description: conceptEntry.data.description ?? null,
    unitCount: getSortedCompanyFactsKeys(conceptEntry.data.units).length,
    units: conceptEntry.data.units || {},
  };
}

/**
 * 종합 공시 데이터 조회
 * @param {string} ticker - 종목 심볼
 * @param {Object} [opts]
 * @param {number} [opts.limit=10] - 공시 최대 수
 * @param {string[]} [opts.filingTypes] - 필터링할 공시 유형
 * @param {string} [opts.from] - 시작일 (YYYY-MM-DD)
 * @param {string} [opts.to] - 종료일 (YYYY-MM-DD)
 * @returns {Promise<Object>}
 */
export async function getUSFilings(ticker, opts = {}) {
  const { limit = 10 } = opts;
  const filters = normalizeFilingOptions(opts);
  const requestedKeyFilingTypes = resolveRequestedKeyFilingTypes(filters.filingTypes);

  const [keyFilings, allFilings] = await Promise.all([
    requestedKeyFilingTypes.length > 0
      ? getKeyFilings(ticker, { limit, ...filters }).catch(() => null)
      : Promise.resolve([]),
    getFilings(ticker, {
      limit: limit * 2,
      ...(filters.filingTypes.length > 0 ? { filingTypes: filters.filingTypes } : {}),
      ...(filters.from ? { from: filters.from } : {}),
      ...(filters.to ? { to: filters.to } : {}),
    }).catch(() => null),
  ]);

  const shouldFetchSecFallback = !allFilings?.length
    || (requestedKeyFilingTypes.length > 0 && (!keyFilings?.length || hasMissingHighPriorityTypes(keyFilings || [])));

  const secFallback = shouldFetchSecFallback
    ? filterFilings(
      await getSecRecentFilings(ticker, Math.max(limit * 2, 100)).catch(() => null),
      filters,
    )
    : null;

  const resolvedKeyFilings = requestedKeyFilingTypes.length > 0
    ? mergeKeyFilings(
      keyFilings || [],
      secFallback || [],
      limit,
    )
    : [];
  const resolvedAllFilings = filterFilings(mergeRecentFilings(
    allFilings || [],
    secFallback || [],
  ), filters);

  return {
    ticker,
    keyFilings: resolvedKeyFilings,
    recentFilings: resolvedAllFilings.slice(0, limit),
    summary: buildFilingsSummary(resolvedKeyFilings),
  };
}

function buildFilingsSummary(filings) {
  if (!Array.isArray(filings) || !filings.length) {
    return { count: 0, latestFiling: null, typeCounts: {} };
  }

  const typeCounts = {};
  for (const filing of filings) {
    const baseType = getBaseFilingType(filing?.type);
    if (!baseType) continue;
    typeCounts[baseType] = (typeCounts[baseType] || 0) + 1;
  }

  return {
    count: filings.length,
    latestFiling: filings[0] ?? null,
    typeCounts,
  };
}
