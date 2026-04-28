/**
 * wisereport-global.js — COMPANY GLOBAL direct HTTP crawler
 *
 * Browser automation 없이 COMPANY GLOBAL 미국주식 페이지를 쿠키 기반 직접 HTTP로 수집합니다.
 * 티커는 기본적으로 US suffix를 붙여 cmp_cd 형식(예: NVDA-US)으로 정규화합니다.
 */

import { readFile } from 'node:fs/promises';
import cacheModule from './wisereport-cache.cjs';

export const WISEREPORT_GLOBAL_BASE_URL = 'https://compglobal.wisereport.co.kr';
export const WISEREPORT_GLOBAL_DEFAULT_TIMEOUT_MS = 20_000;
export const WISEREPORT_GLOBAL_DEFAULT_CONCURRENCY = 4;

const { createReadThroughCache } = cacheModule;
const wisereportGlobalCache = createReadThroughCache({ name: 'wisereport-global' });

const DEFAULT_USER_AGENT = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  'AppleWebKit/537.36 (KHTML, like Gecko)',
  'Chrome/124.0.0.0 Safari/537.36',
].join(' ');

const BLOCK_TAGS = [
  'address', 'article', 'aside', 'blockquote', 'br', 'caption', 'dd', 'div', 'dl', 'dt',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'tbody', 'td',
  'tfoot', 'th', 'thead', 'tr', 'ul',
];

const LOGIN_PATTERNS = [
  /\blog\s?in\b/i,
  /\bsign\s?in\b/i,
  /로그인/i,
  /회원\s*로그인/i,
  /아이디/i,
  /비밀번호/i,
  /session expired/i,
];

const ACCESS_DENIED_PATTERNS = [
  /access denied/i,
  /unauthorized/i,
  /forbidden/i,
  /권한이 없습니다/i,
  /접근이 제한/i,
  /이용이 제한/i,
  /permission denied/i,
];

const COOKIE_HEADER_ENV_KEYS = [
  'WISEREPORT_GLOBAL_COOKIE_HEADER',
  'COMPANY_GLOBAL_COOKIE_HEADER',
];

const COOKIE_JSON_ENV_KEYS = [
  'WISEREPORT_GLOBAL_COOKIES_JSON',
  'COMPANY_GLOBAL_COOKIES_JSON',
];

const COOKIE_FILE_ENV_KEYS = [
  'WISEREPORT_GLOBAL_COOKIES_FILE',
  'COMPANY_GLOBAL_COOKIES_FILE',
  'WISEREPORT_GLOBAL_COOKIE_FILE',
  'COMPANY_GLOBAL_COOKIE_FILE',
];

export const WISEREPORT_GLOBAL_ROUTES = Object.freeze([
  { id: 'company-snap', category: 'Company', name: 'Snap', path: '/Company/Snap' },
  { id: 'company-finance', category: 'Company', name: 'Finance', path: '/Company/Finance' },
  { id: 'company-invest', category: 'Company', name: 'Invest', path: '/Company/Invest' },
  { id: 'company-consensus', category: 'Company', name: 'Consensus', path: '/Company/Consensus' },
  { id: 'company-analysis', category: 'Company', name: 'Analysis', path: '/Company/Analysis' },
  { id: 'earnings-breaking-news', category: 'Earnings', name: 'BreakingNews', path: '/Earnings/BreakingNews' },
  { id: 'earnings-earning-surprise', category: 'Earnings', name: 'EarningSurprise', path: '/Earnings/EarningSurprise' },
  { id: 'earnings-dividend-news', category: 'Earnings', name: 'DividendNews', path: '/Earnings/DividendNews' },
  { id: 'earnings-turnaround', category: 'Earnings', name: 'Turnaround', path: '/Earnings/Turnaround' },
  { id: 'earnings-consensus', category: 'Earnings', name: 'Consensus', path: '/Earnings/Consensus' },
  { id: 'earnings-guide', category: 'Earnings', name: 'Guide', path: '/Earnings/Guide' },
  { id: 'earnings-capital-event', category: 'Earnings', name: 'CapitalEvent', path: '/Earnings/CapitalEvent' },
  { id: 'screener-ranking', category: 'Screener', name: 'Ranking', path: '/Screener/Ranking' },
  { id: 'screener-index', category: 'Screener', name: 'Index', path: '/Screener/Index' },
  { id: 'news-news', category: 'News', name: 'News', path: '/News/News' },
  { id: 'theme-theme-list', category: 'Theme', name: 'ThemeList', path: '/Theme/ThemeList' },
  { id: 'global-economy-synthesis', category: 'GlobalEconomy', name: 'Synthesis', path: '/GlobalEconomy/Synthesis' },
  { id: 'global-economy-overview', category: 'GlobalEconomy', name: 'Overview', path: '/GlobalEconomy/Overview' },
  { id: 'global-economy-compare', category: 'GlobalEconomy', name: 'Compare', path: '/GlobalEconomy/Compare' },
]);

const ROUTE_MAP = new Map(WISEREPORT_GLOBAL_ROUTES.map(route => [route.id, route]));

function formatWiseReportDate(value = Date.now(), opts = {}) {
  const date = value instanceof Date ? value : new Date(value);
  const useUTC = Boolean(opts.useUTC);
  const year = useUTC ? date.getUTCFullYear() : date.getFullYear();
  const month = String((useUTC ? date.getUTCMonth() : date.getMonth()) + 1).padStart(2, '0');
  const day = String(useUTC ? date.getUTCDate() : date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function normalizeWiseReportBasedate(opts = {}) {
  if (opts.basedate != null) {
    const value = String(opts.basedate).replace(/[^0-9]/g, '');
    if (/^\d{8}$/.test(value)) {
      return value;
    }
    throw new Error(`Invalid basedate: ${opts.basedate}`);
  }

  return formatWiseReportDate(opts.now, { useUTC: opts.useUTCDate });
}

function buildAuxiliaryUrl(pathAndQuery, opts = {}) {
  return new URL(pathAndQuery, opts.baseUrl ?? WISEREPORT_GLOBAL_BASE_URL).toString();
}

function buildWiseReportAuxiliaryRequests(route, cmpCode, opts = {}) {
  const basedate = normalizeWiseReportBasedate(opts);

  switch (route.id) {
    case 'company-snap':
      return [
        { id: 'news-company-1', scope: 'company', url: buildAuxiliaryUrl(`/Company/GetNewsCompanyListHts?ticker=${cmpCode}&news_typ=1`, opts) },
        { id: 'snap-band-1', scope: 'company', url: buildAuxiliaryUrl(`/company/get_snap_band?ticker=${cmpCode}&typ=1`, opts) },
        { id: 'snap-band-2', scope: 'company', url: buildAuxiliaryUrl(`/company/get_snap_band?ticker=${cmpCode}&typ=2`, opts) },
        { id: 'snap-financial-summary', scope: 'company', url: buildAuxiliaryUrl(`/company/get_snap_financial_summary?ticker=${cmpCode}&freq_typ=A&curr=LOC`, opts) },
        { id: 'snap-summary-chart', scope: 'company', url: buildAuxiliaryUrl(`/company/get_snap_summary_chart?ticker=${cmpCode}&freq_typ=Y`, opts) },
        { id: 'snap-esg-json', scope: 'company', url: buildAuxiliaryUrl(`/company/get_snap_esg_json?cmp_cd=${cmpCode}`, opts) },
        { id: 'snap-esg-chart', scope: 'company', url: buildAuxiliaryUrl(`/company/get_snap_esg_chart?cmp_cd=${cmpCode}`, opts) },
        { id: 'news-company-2', scope: 'company', url: buildAuxiliaryUrl(`/Company/GetNewsCompanyListHts?ticker=${cmpCode}&news_typ=2`, opts) },
      ];
    case 'company-finance':
      return [
        { id: 'fin-statement', scope: 'company', url: buildAuxiliaryUrl(`/company/getFinStatement?cmp_cd=${cmpCode}&term=A&typ=IS&curr=LOC`, opts) },
        { id: 'fin-balance-sheet', scope: 'company', url: buildAuxiliaryUrl(`/company/getFinStatement?cmp_cd=${cmpCode}&term=A&typ=BS&curr=LOC`, opts) },
        { id: 'fin-cash-flow', scope: 'company', url: buildAuxiliaryUrl(`/company/getFinStatement?cmp_cd=${cmpCode}&term=A&typ=CF&curr=LOC`, opts) },
        { id: 'fin-chart', scope: 'company', url: buildAuxiliaryUrl(`/Company/getFinChart?cmp_cd=${cmpCode}&term=A&typ=IS&curr=LOC`, opts) },
      ];
    case 'company-invest':
      return [
        { id: 'invest-statement', scope: 'company', url: buildAuxiliaryUrl(`/company/getFinStatement?cmp_cd=${cmpCode}&term=A&typ=PR`, opts) },
        { id: 'invest-chart', scope: 'company', url: buildAuxiliaryUrl(`/Company/getFinChart?cmp_cd=${cmpCode}&term=A&typ=PR`, opts) },
      ];
    case 'company-consensus':
      return [
        { id: 'consensus-trend-chart', scope: 'company', url: buildAuxiliaryUrl(`/company/cns_trend_chart?ticker=${cmpCode}&type=1`, opts) },
      ];
    case 'company-analysis':
      return [
        { id: 'compare-list', scope: 'peer-group', url: buildAuxiliaryUrl(`/Company/getCmpList?cmp_cd=${cmpCode}&iso=1&svc_iso_typ=0`, opts) },
      ];
    case 'earnings-breaking-news':
      return [
        { id: 'earnings-basic-market', scope: 'market', url: buildAuxiliaryUrl(`/Earnings/GetEarningsBasic?type=M&svc_iso=0`, opts) },
        { id: 'earnings-basic-sector', scope: 'market', url: buildAuxiliaryUrl(`/Earnings/GetEarningsBasic?type=S&svc_iso=0`, opts) },
        { id: 'earnings-daily-calendar', scope: 'market', url: buildAuxiliaryUrl(`/Earnings/GetEarningsBasicDaily?type=C&svc_iso=0`, opts) },
        { id: 'breaking-news-list', scope: 'market', url: buildAuxiliaryUrl(`/Earnings/GetBreakingNews?iso_typ=0&mkt=US&sec=WI000&condType=Q4&curr=USD&basedate=${basedate}&cmp_cd=&cap_chk=1&curpage=1&perpage=20`, opts) },
      ];
    case 'earnings-earning-surprise':
      return [
        { id: 'earnings-basic-market', scope: 'market', url: buildAuxiliaryUrl(`/Earnings/GetEarningsBasic?type=M&svc_iso=0`, opts) },
        { id: 'earnings-basic-sector', scope: 'market', url: buildAuxiliaryUrl(`/Earnings/GetEarningsBasic?type=S&svc_iso=0`, opts) },
        { id: 'earnings-basic-event', scope: 'market', url: buildAuxiliaryUrl(`/Earnings/GetEarningsBasic?type=E&svc_iso=0`, opts) },
        { id: 'earnings-basic-year', scope: 'market', url: buildAuxiliaryUrl(`/Earnings/GetEarningsBasic?type=Y&svc_iso=0`, opts) },
        { id: 'earnings-surprise-list', scope: 'market', url: buildAuxiliaryUrl(`/Earnings/GetEarnings?iso_typ=0&mkt=A&sec=WI000&condType=S1&curr=USD&yymm=CPQ&condItem=P&ordItem=4&ordDirect=D&curpage=1&perpage=20`, opts) },
      ];
    case 'earnings-dividend-news':
      return [
        { id: 'earnings-basic-market', scope: 'market', url: buildAuxiliaryUrl(`/Earnings/GetEarningsBasic?type=M&svc_iso=0`, opts) },
        { id: 'earnings-basic-sector', scope: 'market', url: buildAuxiliaryUrl(`/Earnings/GetEarningsBasic?type=S&svc_iso=0`, opts) },
        { id: 'dividend-news-list', scope: 'market', url: buildAuxiliaryUrl(`/Earnings/GetDividendNews?iso_typ=0&mkt=US&sec=WI000&curr=USD&basedate=${basedate}&cmp_cd=&cap_chk=1&curpage=1&perpage=20`, opts) },
      ];
    case 'earnings-turnaround':
      return [
        { id: 'earnings-basic-market', scope: 'market', url: buildAuxiliaryUrl(`/Earnings/GetEarningsBasic?type=M&svc_iso=0`, opts) },
        { id: 'earnings-basic-sector', scope: 'market', url: buildAuxiliaryUrl(`/Earnings/GetEarningsBasic?type=S&svc_iso=0`, opts) },
        { id: 'earnings-basic-turnaround', scope: 'market', url: buildAuxiliaryUrl(`/Earnings/GetEarningsBasic?type=T&svc_iso=0`, opts) },
        { id: 'earnings-basic-year', scope: 'market', url: buildAuxiliaryUrl(`/Earnings/GetEarningsBasic?type=Y&svc_iso=0`, opts) },
        { id: 'turnaround-list', scope: 'market', url: buildAuxiliaryUrl(`/Earnings/GetEarnings?iso_typ=0&mkt=A&sec=WI000&curr=USD&condType=T&yymm=FQ1&condItem=PC&ordItem=4&ordDirect=D&curpage=1&perpage=20`, opts) },
      ];
    case 'earnings-consensus':
      return [
        { id: 'earnings-basic-market', scope: 'market', url: buildAuxiliaryUrl(`/Earnings/GetEarningsBasic?type=M&svc_iso=0`, opts) },
        { id: 'earnings-basic-sector', scope: 'market', url: buildAuxiliaryUrl(`/Earnings/GetEarningsBasic?type=S&svc_iso=0`, opts) },
        { id: 'earnings-basic-consensus', scope: 'market', url: buildAuxiliaryUrl(`/Earnings/GetEarningsBasic?type=C&svc_iso=0`, opts) },
        { id: 'earnings-basic-year', scope: 'market', url: buildAuxiliaryUrl(`/Earnings/GetEarningsBasic?type=Y&svc_iso=0`, opts) },
        { id: 'earnings-consensus-list', scope: 'market', url: buildAuxiliaryUrl(`/Earnings/GetEarnings?iso_typ=0&mkt=A&sec=WI000&curr=LOC&condType=C3&yymm=FY1&condItem=U&ordItem=3&ordDirect=D&curpage=1&perpage=20`, opts) },
      ];
    case 'earnings-guide':
      return [
        { id: 'earnings-guide-basic-market', scope: 'market', url: buildAuxiliaryUrl(`/Earnings/GetEarningsGuideBasic?type=M&svc_iso=0`, opts) },
        { id: 'earnings-guide-basic-sector', scope: 'market', url: buildAuxiliaryUrl(`/Earnings/GetEarningsGuideBasic?type=S&svc_iso=0`, opts) },
      ];
    case 'earnings-capital-event':
      return [
        { id: 'earnings-basic-market', scope: 'market', url: buildAuxiliaryUrl(`/Earnings/GetEarningsBasic?type=M&svc_iso=0`, opts) },
        { id: 'capital-event-market-gubun', scope: 'market', url: buildAuxiliaryUrl(`/Earnings/GetCaEventGubun?type=M&svc_iso=0&debug_flag=1`, opts) },
        { id: 'earnings-basic-sector', scope: 'market', url: buildAuxiliaryUrl(`/Earnings/GetEarningsBasic?type=S&svc_iso=0`, opts) },
        { id: 'capital-event-sector-gubun', scope: 'market', url: buildAuxiliaryUrl(`/Earnings/GetCaEventGubun?type=S&svc_iso=0&debug_flag=1`, opts) },
        { id: 'capital-event-list', scope: 'market', url: buildAuxiliaryUrl(`/Earnings/GetCapitalEvent?iso_typ=0&mkt=A&event_grp=1&curpage=1&perpage=20&cap_chk=0&debug_flag=1`, opts) },
      ];
    case 'screener-ranking':
      return [
        { id: 'rank-basic-market', scope: 'market', url: buildAuxiliaryUrl(`/Screener/GetRankidxBasic?type=M&svc_iso=0`, opts) },
        { id: 'rank-basic-sector', scope: 'market', url: buildAuxiliaryUrl(`/Screener/GetRankidxBasic?type=S&svc_iso=0`, opts) },
        { id: 'rank-basic-cond', scope: 'market', url: buildAuxiliaryUrl(`/Screener/GetRankidxBasic?type=C&svc_iso=0`, opts) },
        { id: 'rank-basic-year', scope: 'market', url: buildAuxiliaryUrl(`/Screener/GetRankidxBasic?type=Y&svc_iso=0`, opts) },
        { id: 'rank-list', scope: 'market', url: buildAuxiliaryUrl(`/Screener/GetRankIdx?iso_typ=0&mkt=A&sec=WI000&condType=M&baseyear=CPD&ordItem=2&ordDirect=D&cap_chk=1&curpage=1&perpage=22&curr=USD`, opts) },
      ];
    case 'news-news':
      return [
        { id: 'earnings-basic-market', scope: 'market', url: buildAuxiliaryUrl(`/Earnings/GetEarningsBasic?type=M&svc_iso=0`, opts) },
        { id: 'news-category-list', scope: 'market', url: buildAuxiliaryUrl(`/company/GetNewsCategoryList`, opts) },
      ];
    case 'theme-theme-list':
      return [
        { id: 'theme-top-list', scope: 'market', url: buildAuxiliaryUrl(`/Theme/GetThemeTopList?term=9`, opts) },
      ];
    case 'global-economy-overview':
      return [
        { id: 'economy-overview-help', scope: 'market', url: buildAuxiliaryUrl(`/GlobalEconomy/GetEconomyOverview1Help?cntry_cd=840&section_cd=49`, opts) },
      ];
    case 'global-economy-compare':
      return [
        { id: 'economy-basic-market', scope: 'market', url: buildAuxiliaryUrl(`/GlobalEconomy/GetEconomyBasic?type=M&level=0&gb=1`, opts) },
        { id: 'economy-basic-event', scope: 'market', url: buildAuxiliaryUrl(`/GlobalEconomy/GetEconomyBasic?type=E&level=1&gb=1`, opts) },
        { id: 'economy-basic-year', scope: 'market', url: buildAuxiliaryUrl(`/GlobalEconomy/GetEconomyBasic?type=Y&level=2&gb=1`, opts) },
        { id: 'economy-compare-data', scope: 'market', url: buildAuxiliaryUrl(`/GlobalEconomy/GetCntryCompareData?mkt_cd=840%2C156%2C392&symbol_no=2&ymd=1&ord_direct=D`, opts) },
      ];
    default:
      return [];
  }
}

export function normalizeWiseReportGlobalCmpCode(ticker, opts = {}) {
  const { defaultSuffix = 'US' } = opts;
  const value = String(ticker ?? '').trim().toUpperCase();

  if (!value) {
    throw new TypeError('ticker is required');
  }

  if (/^[A-Z0-9._-]+-[A-Z]{2,}$/.test(value)) {
    return value;
  }

  return `${value}-${String(defaultSuffix || 'US').trim().toUpperCase()}`;
}

export function getWiseReportGlobalRoute(routeRef) {
  if (!routeRef) {
    throw new TypeError('routeRef is required');
  }

  if (typeof routeRef === 'string') {
    const route = ROUTE_MAP.get(routeRef);
    if (!route) {
      throw new Error(`Unknown WiseReport Global route: ${routeRef}`);
    }
    return route;
  }

  if (typeof routeRef === 'object' && typeof routeRef.path === 'string') {
    return routeRef;
  }

  throw new TypeError('routeRef must be a route id or route object');
}

export function resolveWiseReportGlobalRoutes(routeRefs) {
  if (!routeRefs) {
    return WISEREPORT_GLOBAL_ROUTES;
  }

  if (!Array.isArray(routeRefs) || routeRefs.length === 0) {
    throw new TypeError('routes must be a non-empty array when provided');
  }

  return routeRefs.map(getWiseReportGlobalRoute);
}

export function buildWiseReportGlobalUrl(routeRef, ticker, opts = {}) {
  const route = getWiseReportGlobalRoute(routeRef);
  const baseUrl = opts.baseUrl ?? WISEREPORT_GLOBAL_BASE_URL;
  const cmpCode = opts.cmpCode ?? normalizeWiseReportGlobalCmpCode(ticker, opts);
  const url = new URL(route.path, baseUrl);
  url.searchParams.set('cmp_cd', cmpCode);
  return url.toString();
}

export function buildCookieHeader(cookies, opts = {}) {
  const { targetHost = 'compglobal.wisereport.co.kr', now = Date.now() } = opts;

  if (!cookies) {
    return null;
  }

  if (typeof cookies === 'string') {
    const value = cookies.trim();
    return value || null;
  }

  const cookieList = normalizeCookieInput(cookies);
  if (!cookieList.length) {
    return null;
  }

  const seen = new Map();

  for (const cookie of cookieList) {
    const normalized = normalizeCookie(cookie);
    if (!normalized || !shouldIncludeCookie(normalized, { targetHost, now })) {
      continue;
    }
    seen.set(normalized.name, `${normalized.name}=${normalized.value}`);
  }

  return seen.size ? Array.from(seen.values()).join('; ') : null;
}

export async function resolveWiseReportGlobalCookieHeader(opts = {}) {
  const env = opts.env ?? process.env;

  if (opts.cookieHeader) {
    return buildCookieHeader(opts.cookieHeader, opts);
  }

  if (opts.cookies) {
    return buildCookieHeader(opts.cookies, opts);
  }

  if (opts.cookieFile) {
    return readCookieHeaderFromFile(opts.cookieFile, opts);
  }

  for (const key of COOKIE_HEADER_ENV_KEYS) {
    const value = env?.[key];
    if (value?.trim()) {
      return buildCookieHeader(value, opts);
    }
  }

  for (const key of COOKIE_JSON_ENV_KEYS) {
    const value = env?.[key];
    if (value?.trim()) {
      return buildCookieHeader(parseCookieJson(value, key), opts);
    }
  }

  for (const key of COOKIE_FILE_ENV_KEYS) {
    const value = env?.[key];
    if (value?.trim()) {
      return readCookieHeaderFromFile(value, opts);
    }
  }

  return null;
}

export async function readCookieHeaderFromFile(filePath, opts = {}) {
  const contents = await readFile(filePath, 'utf8');
  const trimmed = contents.trim();
  if (!trimmed) {
    return null;
  }

  if (looksLikeJson(trimmed)) {
    return buildCookieHeader(parseCookieJson(trimmed, filePath), opts);
  }

  return buildCookieHeader(trimmed, opts);
}

export function detectWiseReportGlobalAccess(page = {}) {
  const statusCode = Number.isFinite(page.statusCode) ? page.statusCode : null;
  const title = String(page.title ?? '');
  const text = String(page.text ?? '');
  const html = String(page.html ?? page.rawHtml ?? '');
  const finalUrl = String(page.finalUrl ?? page.url ?? '');
  const combined = `${title}\n${text}\n${finalUrl}`;

  if (statusCode === 401) {
    return buildAccessResult('login', 'http-401');
  }

  if (statusCode === 403) {
    return buildAccessResult('denied', 'http-403');
  }

  const loginPattern = LOGIN_PATTERNS.find(pattern => pattern.test(combined));
  const deniedPattern = ACCESS_DENIED_PATTERNS.find(pattern => pattern.test(combined));

  if (/type=["']password["']/i.test(html) || /\/login/i.test(finalUrl) || loginPattern) {
    return buildAccessResult('login', loginPattern?.source ?? 'login-marker');
  }

  if (deniedPattern) {
    return buildAccessResult('denied', deniedPattern.source);
  }

  if (statusCode != null && statusCode >= 400) {
    return buildAccessResult('http-error', `http-${statusCode}`);
  }

  return buildAccessResult('ok', 'content');
}

export async function crawlWiseReportGlobal(ticker, opts = {}) {
  const cmpCode = opts.cmpCode ?? normalizeWiseReportGlobalCmpCode(ticker, opts);
  const routes = resolveWiseReportGlobalRoutes(opts.routes);
  const routeIds = routes.map(route => route.id || route.path).join(',');
  const includeHtml = Boolean(opts.includeHtml);
  const includeAuxiliary = opts.includeAuxiliary !== false;
  const basedate = normalizeWiseReportBasedate(opts);
  const maxTextLength = Number.isFinite(opts.maxTextLength) && opts.maxTextLength > 0
    ? Number(opts.maxTextLength)
    : 'full';
  const cacheKey = `global:${cmpCode}:${routeIds}:aux=${includeAuxiliary}:html=${includeHtml}:text=${maxTextLength}:date=${basedate}:base=${opts.baseUrl ?? WISEREPORT_GLOBAL_BASE_URL}`;
  const cookieHeader = await resolveWiseReportGlobalCookieHeader(opts);

  if (!cookieHeader) {
    throw new Error('WiseReport Global cookies are required. Provide opts.cookieHeader, opts.cookies, opts.cookieFile, or the WISEREPORT_GLOBAL_* / COMPANY_GLOBAL_* environment variables.');
  }

  return wisereportGlobalCache.readThrough(cacheKey, async () => {
    const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    const concurrency = Math.max(1, Math.min(Number(opts.concurrency) || WISEREPORT_GLOBAL_DEFAULT_CONCURRENCY, routes.length));
    const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : WISEREPORT_GLOBAL_DEFAULT_TIMEOUT_MS;

    if (typeof fetchImpl !== 'function') {
      throw new TypeError('fetch implementation is required');
    }

    const startedAt = Date.now();
    const pageResults = await mapWithConcurrency(routes, concurrency, route => fetchWiseReportGlobalPage(route, cmpCode, {
      ...opts,
      fetchImpl,
      cookieHeader,
      includeHtml,
      timeoutMs,
    }));

    const pages = Object.fromEntries(pageResults.map(page => [page.id, page]));
    const coverage = buildCoverageSummary(pageResults);

    return {
      ticker: String(ticker ?? '').trim().toUpperCase() || null,
      cmpCode,
      fetchedAt: new Date().toISOString(),
      elapsedMs: Date.now() - startedAt,
      baseUrl: opts.baseUrl ?? WISEREPORT_GLOBAL_BASE_URL,
      routeCount: routes.length,
      coverage,
      pages,
    };
  }, {
    ...opts,
    isCacheable: (value) => value && value.coverage?.failed !== value.routeCount,
  });
}

export function clearWiseReportGlobalCache(key) {
  wisereportGlobalCache.clear(key);
}

export function getWiseReportGlobalCacheStats() {
  return wisereportGlobalCache.getStats();
}

export async function crawlWiseReportGlobalDomainData(ticker, opts = {}) {
  const crawlResult = await crawlWiseReportGlobal(ticker, opts);
  return extractWiseReportGlobalDomainData(crawlResult, opts.domainDataOptions ?? opts.domainOptions ?? {});
}

export function extractWiseReportGlobalDomainData(crawlResult, opts = {}) {
  const includeIdentifiers = opts.includeIdentifiers !== false;
  const includeEmptyRoutes = Boolean(opts.includeEmptyRoutes);
  const routes = {};

  for (const [routeId, page] of Object.entries(crawlResult?.pages ?? {})) {
    if (!page?.ok) {
      continue;
    }

    const items = {};
    for (const auxiliary of page.auxiliary ?? []) {
      if (!auxiliary?.ok || auxiliary.data == null) {
        continue;
      }
      items[auxiliary.id] = {
        scope: auxiliary.scope ?? 'unknown',
        data: auxiliary.data,
      };
    }

    if (!includeEmptyRoutes && Object.keys(items).length === 0) {
      continue;
    }

    routes[routeId] = {
      category: page.category,
      name: page.name,
      items,
    };
  }

  const result = { routes };
  if (includeIdentifiers) {
    result.ticker = crawlResult?.ticker ?? null;
    result.cmpCode = crawlResult?.cmpCode ?? null;
  }
  return result;
}

export function formatWiseReportGlobalDomainTsv(domainData, opts = {}) {
  const header = [
    'ticker',
    'cmp_code',
    'route_id',
    'route_category',
    'route_name',
    'item_id',
    'scope',
    'field_path',
    'value_type',
    'value',
  ];
  const rows = [header.join('\t')];
  const ticker = domainData?.ticker ?? '';
  const cmpCode = domainData?.cmpCode ?? '';

  for (const [routeId, route] of Object.entries(domainData?.routes ?? {})) {
    for (const [itemId, item] of Object.entries(route?.items ?? {})) {
      const flattened = flattenDomainScalarEntries(item?.data);
      for (const entry of flattened) {
        rows.push([
          normalizeTsvCell(ticker),
          normalizeTsvCell(cmpCode),
          normalizeTsvCell(routeId),
          normalizeTsvCell(route?.category ?? ''),
          normalizeTsvCell(route?.name ?? ''),
          normalizeTsvCell(itemId),
          normalizeTsvCell(item?.scope ?? ''),
          normalizeTsvCell(entry.path),
          normalizeTsvCell(entry.valueType),
          normalizeTsvCell(entry.value),
        ].join('\t'));
      }
    }
  }

  if (opts.trailingNewline === false) {
    return rows.join('\n');
  }
  return `${rows.join('\n')}\n`;
}

async function fetchWiseReportGlobalPage(route, cmpCode, opts) {
  const url = buildWiseReportGlobalUrl(route, cmpCode, { ...opts, cmpCode });
  const headers = {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9,ko-KR;q=0.8',
    'Cache-Control': 'no-cache',
    'Cookie': opts.cookieHeader,
    'Pragma': 'no-cache',
    'Referer': `${opts.baseUrl ?? WISEREPORT_GLOBAL_BASE_URL}/`,
    'User-Agent': opts.userAgent ?? DEFAULT_USER_AGENT,
    ...(opts.headers ?? {}),
  };

  const startedAt = Date.now();

  try {
    const response = await opts.fetchImpl(url, {
      method: 'GET',
      headers,
      redirect: opts.redirect ?? 'follow',
      signal: opts.signal ?? AbortSignal.timeout(opts.timeoutMs),
    });

    const html = await response.text();
    const title = extractHtmlTitle(html);
    const text = normalizeTextLength(htmlToText(html), opts.maxTextLength);
    const access = detectWiseReportGlobalAccess({
      statusCode: response.status,
      title,
      text,
      html,
      url,
      finalUrl: response.url || url,
    });

    const page = {
      id: route.id,
      category: route.category,
      name: route.name,
      path: route.path,
      url,
      finalUrl: response.url || url,
      title,
      text,
      textLength: text.length,
      htmlLength: html.length,
      statusCode: response.status,
      ok: response.ok && access.classification === 'ok',
      loginDetected: access.loginDetected,
      accessDeniedDetected: access.accessDeniedDetected,
      access: access.classification,
      accessReason: access.reason,
      dataUrls: extractDataUrls(html),
      elapsedMs: Date.now() - startedAt,
    };

    if (opts.includeHtml) {
      page.rawHtml = html;
    }

    const auxiliary = opts.includeAuxiliary === false
      ? []
      : await fetchWiseReportAuxiliary(route, cmpCode, opts, page);
    if (auxiliary.length) {
      page.auxiliary = auxiliary;
      page.auxiliaryCount = auxiliary.length;
      page.auxiliaryAccessible = auxiliary.filter(item => item.ok).length;
      page.auxiliaryFailedCount = auxiliary.filter(item => !item.ok).length;
      page.degraded = page.auxiliaryFailedCount > 0;
      page.health = page.degraded ? 'degraded' : 'ok';
    } else {
      page.auxiliary = [];
      page.auxiliaryCount = 0;
      page.auxiliaryAccessible = 0;
      page.auxiliaryFailedCount = 0;
      page.degraded = false;
      page.health = 'ok';
    }

    return page;
  } catch (error) {
    return {
      id: route.id,
      category: route.category,
      name: route.name,
      path: route.path,
      url,
      finalUrl: url,
      title: null,
      text: '',
      textLength: 0,
      htmlLength: 0,
      statusCode: null,
      ok: false,
      loginDetected: false,
      accessDeniedDetected: false,
      access: 'network-error',
      accessReason: error?.name === 'TimeoutError' ? 'timeout' : 'network-error',
      error: error?.message ?? String(error),
      dataUrls: [],
      auxiliary: [],
      auxiliaryCount: 0,
      auxiliaryAccessible: 0,
      auxiliaryFailedCount: 0,
      degraded: false,
      health: 'error',
      elapsedMs: Date.now() - startedAt,
    };
  }
}

async function fetchWiseReportAuxiliary(route, cmpCode, opts, page) {
  const requests = buildWiseReportAuxiliaryRequests(route, cmpCode, opts);
  if (!requests.length) {
    return [];
  }

  const baseResults = await Promise.all(requests.map(request => fetchWiseReportAuxiliaryItem(request, opts)));

  if (route.id !== 'company-analysis') {
    return baseResults;
  }

  const compareList = baseResults.find(item => item.id === 'compare-list' && item.ok && Array.isArray(item.data?.data));
  const selfTicker = String(cmpCode || '').toUpperCase();
  const uniqueTickers = [];
  for (const item of compareList?.data?.data ?? []) {
    const ticker = String(item?.TICKER ?? '').trim().toUpperCase();
    if (!ticker || uniqueTickers.includes(ticker)) {
      continue;
    }
    uniqueTickers.push(ticker);
  }

  const normalizedTickers = uniqueTickers.includes(selfTicker)
    ? uniqueTickers
    : [selfTicker, ...uniqueTickers].filter(Boolean);
  const cmpCandidates = normalizedTickers.slice(0, 5);

  if (cmpCandidates.length < 2) {
    return baseResults;
  }

  const encoded = encodeURIComponent(`${cmpCandidates.join('|')}|`);
  const followUps = [
    { id: 'metric-chart', scope: 'peer-group', url: buildAuxiliaryUrl(`/Company/getMtrChart?cmp_cd=${cmpCode}&iso=1&cmp_list=${encoded}&curr=USD`, opts) },
    { id: 'return-list', scope: 'peer-group', url: buildAuxiliaryUrl(`/Company/getRtnList?cmp_cd=${cmpCode}&iso=1&cmp_list=${encoded}`, opts) },
  ];
  const followUpResults = await Promise.all(followUps.map(request => fetchWiseReportAuxiliaryItem(request, opts)));
  return [...baseResults, ...followUpResults];
}

async function fetchWiseReportAuxiliaryItem(request, opts) {
  const headers = {
    'Accept': 'application/json,text/plain,text/html;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9,ko-KR;q=0.8',
    'Cache-Control': 'no-cache',
    'Cookie': opts.cookieHeader,
    'Pragma': 'no-cache',
    'Referer': `${opts.baseUrl ?? WISEREPORT_GLOBAL_BASE_URL}/`,
    'User-Agent': opts.userAgent ?? DEFAULT_USER_AGENT,
    'X-Requested-With': 'XMLHttpRequest',
    ...(opts.headers ?? {}),
  };
  const startedAt = Date.now();

  try {
    const response = await opts.fetchImpl(request.url, {
      method: 'GET',
      headers,
      redirect: opts.redirect ?? 'follow',
      signal: opts.signal ?? AbortSignal.timeout(opts.timeoutMs),
    });

    const rawBody = await response.text();
    const parsed = parseAuxiliaryBody(rawBody, response.headers.get('content-type'));
    const access = detectWiseReportGlobalAccess({
      statusCode: response.status,
      title: parsed.title,
      text: parsed.accessText,
      html: parsed.html,
      url: request.url,
      finalUrl: response.url || request.url,
    });
    return {
      id: request.id,
      scope: request.scope ?? 'unknown',
      url: request.url,
      finalUrl: response.url || request.url,
      statusCode: response.status,
      ok: response.ok && access.classification === 'ok',
      contentType: response.headers.get('content-type') ?? null,
      bodyType: parsed.bodyType,
      access: access.classification,
      accessReason: access.reason,
      loginDetected: access.loginDetected,
      accessDeniedDetected: access.accessDeniedDetected,
      data: parsed.data,
      textLength: parsed.textLength,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      id: request.id,
      scope: request.scope ?? 'unknown',
      url: request.url,
      finalUrl: request.url,
      statusCode: null,
      ok: false,
      contentType: null,
      bodyType: 'error',
      access: 'network-error',
      accessReason: error?.name === 'TimeoutError' ? 'timeout' : 'network-error',
      loginDetected: false,
      accessDeniedDetected: false,
      data: null,
      textLength: 0,
      elapsedMs: Date.now() - startedAt,
      error: error?.message ?? String(error),
    };
  }
}

function parseAuxiliaryBody(rawBody, contentType = '') {
  const source = String(rawBody ?? '');
  const normalizedType = String(contentType || '').toLowerCase();

  if (normalizedType.includes('json') || looksLikeJson(source.trim())) {
    try {
      const data = JSON.parse(source);
      const serialized = JSON.stringify(data);
      return {
        bodyType: 'json',
        data,
        html: source,
        title: null,
        accessText: serialized,
        textLength: serialized.length,
      };
    } catch {
      // fall through to text/html handling
    }
  }

  if (normalizedType.includes('html')) {
    const text = htmlToText(source);
    return {
      bodyType: 'html',
      data: { text },
      html: source,
      title: extractHtmlTitle(source),
      accessText: text,
      textLength: text.length,
    };
  }

  return {
    bodyType: 'text',
    data: { text: source },
    html: '',
    title: null,
    accessText: source,
    textLength: source.length,
  };
}

function buildCoverageSummary(pageResults) {
  const httpStatusCounts = {};
  const accessCounts = {};
  let accessible = 0;
  let loginDetected = 0;
  let accessDenied = 0;
  let failed = 0;
  let withText = 0;
  let degraded = 0;
  let auxiliaryRequested = 0;
  let auxiliaryAccessible = 0;
  let auxiliaryFailed = 0;

  for (const page of pageResults) {
    const statusKey = page.statusCode == null ? 'null' : String(page.statusCode);
    httpStatusCounts[statusKey] = (httpStatusCounts[statusKey] ?? 0) + 1;
    accessCounts[page.access] = (accessCounts[page.access] ?? 0) + 1;

    if (page.textLength > 0) withText += 1;
    if (page.access === 'ok') accessible += 1;
    if (page.loginDetected) loginDetected += 1;
    if (page.accessDeniedDetected) accessDenied += 1;
    if (!page.ok) failed += 1;
    if (page.degraded) degraded += 1;
    if (Array.isArray(page.auxiliary)) {
      auxiliaryRequested += page.auxiliary.length;
      auxiliaryAccessible += page.auxiliary.filter(item => item.ok).length;
      auxiliaryFailed += page.auxiliary.filter(item => !item.ok).length;
    }
  }

  return {
    requested: pageResults.length,
    completed: pageResults.length,
    accessible,
    loginDetected,
    accessDenied,
    failed,
    degraded,
    withText,
    auxiliaryRequested,
    auxiliaryAccessible,
    auxiliaryFailed,
    httpStatusCounts,
    accessCounts,
  };
}

function flattenDomainScalarEntries(value, path = 'data', rows = []) {
  if (value == null) {
    rows.push({ path, valueType: 'null', value: '' });
    return rows;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => flattenDomainScalarEntries(item, `${path}[${index}]`, rows));
    return rows;
  }

  if (typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      flattenDomainScalarEntries(nested, `${path}.${key}`, rows);
    }
    return rows;
  }

  rows.push({
    path,
    valueType: typeof value,
    value: typeof value === 'string' ? value : String(value),
  });
  return rows;
}

function normalizeTsvCell(value) {
  return String(value ?? '')
    .replace(/\t/g, ' ')
    .replace(/\r?\n/g, ' ')
    .trim();
}

function buildAccessResult(classification, reason) {
  return {
    classification,
    reason,
    loginDetected: classification === 'login',
    accessDeniedDetected: classification === 'denied',
  };
}

function normalizeCookieInput(cookies) {
  if (Array.isArray(cookies)) {
    return cookies;
  }

  if (cookies && typeof cookies === 'object') {
    if (Array.isArray(cookies.cookies)) {
      return cookies.cookies;
    }

    if (cookies.origins || cookies.cookies) {
      return Array.isArray(cookies.cookies) ? cookies.cookies : [];
    }

    return Object.entries(cookies).map(([name, value]) => ({ name, value }));
  }

  return [];
}

function normalizeCookie(cookie) {
  if (!cookie || typeof cookie !== 'object') {
    return null;
  }

  const name = String(cookie.name ?? '').trim();
  const value = cookie.value == null ? '' : String(cookie.value);
  if (!name) {
    return null;
  }

  return {
    name,
    value,
    domain: typeof cookie.domain === 'string' ? cookie.domain.trim() : '',
    expires: normalizeCookieExpiry(cookie),
  };
}

function normalizeCookieExpiry(cookie) {
  const value = cookie.expires ?? cookie.expirationDate ?? cookie.expiry;
  if (value == null || value === -1) {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function shouldIncludeCookie(cookie, opts) {
  if (!cookie.name) {
    return false;
  }

  if (cookie.expires != null) {
    const expiryMs = cookie.expires > 1e12 ? cookie.expires : cookie.expires * 1000;
    if (expiryMs <= opts.now) {
      return false;
    }
  }

  if (!cookie.domain) {
    return true;
  }

  const normalizedDomain = cookie.domain.replace(/^\./, '').toLowerCase();
  const targetHost = String(opts.targetHost || '').replace(/^\./, '').toLowerCase();

  return normalizedDomain === targetHost || targetHost.endsWith(`.${normalizedDomain}`);
}

function parseCookieJson(source, label = 'cookies') {
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`Unable to parse cookie JSON from ${label}: ${error.message}`);
  }
}

function looksLikeJson(value) {
  return value.startsWith('[') || value.startsWith('{');
}

function extractHtmlTitle(html) {
  const match = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeHtmlEntities(match[1]).replace(/\s+/g, ' ').trim() : null;
}

function extractDataUrls(html) {
  const matches = String(html || '').matchAll(/data-url=(['"])(.*?)\1/gi);
  const urls = new Set();

  for (const match of matches) {
    const value = String(match[2] || '').trim();
    if (value) {
      urls.add(value);
    }
  }

  return Array.from(urls);
}

function htmlToText(html) {
  const source = String(html || '');
  if (!source) {
    return '';
  }

  const blockTagPattern = new RegExp(`</?(?:${BLOCK_TAGS.join('|')})\\b[^>]*>`, 'gi');

  const text = source
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg|canvas|iframe)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(blockTagPattern, '\n')
    .replace(/<[^>]+>/g, ' ');

  return decodeHtmlEntities(text)
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function normalizeTextLength(text, maxTextLength) {
  if (!Number.isFinite(maxTextLength) || maxTextLength <= 0) {
    return text;
  }
  return text.slice(0, maxTextLength);
}

function decodeHtmlEntities(input) {
  const named = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
    '#39': "'",
  };

  return String(input || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    const key = String(entity).toLowerCase();
    if (named[key] != null) {
      return named[key];
    }

    if (key.startsWith('#x')) {
      const codePoint = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }

    if (key.startsWith('#')) {
      const codePoint = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }

    return match;
  });
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const currentIndex = cursor;
      cursor += 1;

      if (currentIndex >= items.length) {
        return;
      }

      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(workers);
  return results;
}
