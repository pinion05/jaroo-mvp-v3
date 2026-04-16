import {
  getCrawl,
  crawlMarketData,
  fetchUsdKrwRate,
  fetchVkospi,
  fetchAdr,
  fetchUsVix,
  fetchAllMarketIndicators,
  crawlWiseReportGlobal,
  crawlWiseReportGlobalDomainData,
  getKrx,
  getIndexData,
  getInvestorVolume,
} from '../src/index.js';

const tests = [
  {
    name: 'getCrawl(005930)',
    run: () => getCrawl('005930'),
    summarize: (data) => ({
      code: data?.code ?? null,
      pageCount: Object.keys(data?.pages || {}).length,
      pageIds: Object.keys(data?.pages || {}),
      warningCount: data?.summary?.warningCount ?? null,
    }),
  },
  {
    name: 'crawlMarketData()',
    run: () => crawlMarketData(),
    summarize: (data) => ({
      keys: Object.keys(data || {}),
      lengths: Object.fromEntries(Object.entries(data || {}).map(([k, v]) => [k, typeof v === 'string' ? v.length : null])),
    }),
  },
  {
    name: 'fetchUsdKrwRate()',
    run: () => fetchUsdKrwRate(),
    summarize: (data) => data,
  },
  {
    name: 'fetchVkospi()',
    run: () => fetchVkospi(),
    summarize: (data) => ({
      name: data?.name,
      value: data?.value,
      change: data?.change,
      changePercent: data?.changePercent,
      asOf: data?.asOf,
      sourceUrl: data?.sourceUrl,
      rawTextLength: data?.rawText?.length,
    }),
  },
  {
    name: 'fetchAdr()',
    run: () => fetchAdr(),
    summarize: (data) => ({
      kospi: data?.kospi,
      kosdaq: data?.kosdaq,
      sourceUrl: data?.sourceUrl,
      rawTextLength: data?.rawText?.length,
    }),
  },
  {
    name: 'fetchUsVix()',
    run: () => fetchUsVix(),
    summarize: (data) => ({
      name: data?.name,
      value: data?.value,
      change: data?.change,
      changePercent: data?.changePercent,
      asOf: data?.asOf,
      sourceUrl: data?.sourceUrl,
      rawTextLength: data?.rawText?.length,
    }),
  },
  {
    name: 'fetchAllMarketIndicators()',
    run: () => fetchAllMarketIndicators(),
    summarize: (data) => ({
      vkospi: data?.vkospi ? { value: data.vkospi.value, asOf: data.vkospi.asOf } : null,
      adr: data?.adr ? { kospi: data.adr.kospi, kosdaq: data.adr.kosdaq } : null,
      usVix: data?.usVix ? { value: data.usVix.value, asOf: data.usVix.asOf } : null,
    }),
  },
  {
    name: 'crawlWiseReportGlobal(NVDA)',
    run: () => crawlWiseReportGlobal('NVDA'),
    summarize: (data) => {
      const pages = Object.values(data?.pages || {});
      return {
        cmpCode: data?.cmpCode,
        routeCount: data?.routeCount,
        coverage: data?.coverage,
        firstRoutes: pages.slice(0, 3).map((page) => ({
          id: page?.id,
          access: page?.access,
          statusCode: page?.statusCode,
          auxiliaryCount: Array.isArray(page?.auxiliary) ? page.auxiliary.length : 0,
        })),
      };
    },
  },
  {
    name: 'crawlWiseReportGlobalDomainData(NVDA)',
    run: () => crawlWiseReportGlobalDomainData('NVDA'),
    summarize: (data) => ({
      keys: Object.keys(data || {}),
      companyKeys: data?.company ? Object.keys(data.company).slice(0, 10) : null,
      marketKeys: data?.market ? Object.keys(data.market).slice(0, 10) : null,
    }),
  },
  {
    name: 'getKrx(005930,20250301,20250330)',
    run: () => getKrx('005930', '20250301', '20250330'),
    summarize: (data) => ({
      count: Array.isArray(data) ? data.length : null,
      first: Array.isArray(data) ? data[0] : null,
      last: Array.isArray(data) ? data[data.length - 1] : null,
    }),
  },
  {
    name: 'getIndexData(1001,20250301,20250330)',
    run: () => getIndexData('1001', '20250301', '20250330'),
    summarize: (data) => ({
      count: Array.isArray(data) ? data.length : null,
      first: Array.isArray(data) ? data[0] : null,
      last: Array.isArray(data) ? data[data.length - 1] : null,
    }),
  },
  {
    name: 'getInvestorVolume(005930,20250301,20250330)',
    run: () => getInvestorVolume('005930', '20250301', '20250330'),
    summarize: (data) => ({
      count: Array.isArray(data) ? data.length : null,
      first: Array.isArray(data) ? data[0] : null,
      last: Array.isArray(data) ? data[data.length - 1] : null,
    }),
  },
];

function timeoutWrap(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

const results = [];
for (const test of tests) {
  const startedAt = Date.now();
  try {
    const data = await timeoutWrap(Promise.resolve().then(() => test.run()), 240000, test.name);
    results.push({
      name: test.name,
      ok: true,
      durationMs: Date.now() - startedAt,
      summary: test.summarize(data),
    });
  } catch (error) {
    results.push({
      name: test.name,
      ok: false,
      durationMs: Date.now() - startedAt,
      error: {
        name: error?.name,
        message: error?.message,
        stackTop: error?.stack?.split('\n')?.slice(0, 8),
      },
    });
  }
}

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  node: process.version,
  env: {
    hasWiseReportGlobalCookieHeader: Boolean(process.env.WISEREPORT_GLOBAL_COOKIE_HEADER),
    hasWiseReportGlobalCookiesJson: Boolean(process.env.WISEREPORT_GLOBAL_COOKIES_JSON),
    hasWiseReportGlobalCookiesFile: Boolean(process.env.WISEREPORT_GLOBAL_COOKIES_FILE),
    wiseReportGlobalCookiesFile: process.env.WISEREPORT_GLOBAL_COOKIES_FILE || null,
  },
  results,
}, null, 2));
