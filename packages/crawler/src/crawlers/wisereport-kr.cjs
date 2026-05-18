const logger = require('../utils/logger.cjs');

function getPlaywrightChromium() {
  return require('playwright').chromium;
}
const {
  KR_WISEREPORT_PAGE_SPECS,
  KR_WISEREPORT_V12_PAGE_SPECS,
  WISEREPORT_KR_PAGES,
  WISEREPORT_KR_V12_PAGES,
  getPageSpec,
} = require('./wisereport-kr/page-specs.cjs');
const { runCrawlerV1Stage } = require('./wisereport-kr/crawler_v1.cjs');
const { runCrawlerV2Stage } = require('./wisereport-kr/crawler_v2.cjs');
const { finalizePageResult, buildAggregateResult } = require('./wisereport-kr/crawler_v3.cjs');

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const DEFAULT_CONCURRENCY = parsePositiveInteger(process.env.WISEREPORT_KR_CONCURRENCY, 3);

async function mapWithConcurrency(items, limit, iteratee) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await iteratee(items[index], index);
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function normalizeCode(targetCode) {
  const code = String(targetCode || '').trim().toUpperCase();
  if (!code) {
    throw new Error('code is required');
  }
  return code;
}

async function createBrowserContext() {
  const chromium = getPlaywrightChromium();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    viewport: { width: 1600, height: 1200 },
    locale: 'ko-KR',
  });
  return { browser, context };
}

async function runPagePipeline(context, code, spec, options = {}) {
  const v1 = await runCrawlerV1Stage(context, code, spec, options);
  const v2 = runCrawlerV2Stage({ spec, code, v1, options });
  return finalizePageResult({ spec, code, v1, v2 });
}

async function crawlWiseReportKrPage(targetCode, routeRef, options = {}) {
  const spec = getPageSpec(routeRef);
  if (!spec) {
    throw new Error(`Unknown KR WiseReport/FnGuide page: ${routeRef}`);
  }

  const code = normalizeCode(targetCode);
  const { browser, context } = await createBrowserContext();

  try {
    return await runPagePipeline(context, code, spec, options);
  } finally {
    await context.close();
    await browser.close();
  }
}

async function crawlWiseReportKrWithPageSpecs(targetCode, pageSpecs, options = {}) {
  const code = normalizeCode(targetCode);
  logger.start('Crawler', `WiseReport/FnGuide 구조화 수집 시작 | Code: ${code}`);

  const { browser, context } = await createBrowserContext();

  try {
    const pages = await mapWithConcurrency(
      pageSpecs,
      options.concurrency || DEFAULT_CONCURRENCY,
      async (spec) => runPagePipeline(context, code, spec, options),
    );

    const aggregate = buildAggregateResult({
      code,
      pages,
      pageSpecs,
    });

    logger.summary('Crawler', `구조화 수집 완료 | ${code} | pages:${aggregate.quality.completedPages} | warnings:${aggregate.quality.warningCount}`);
    return aggregate;
  } finally {
    await context.close();
    await browser.close();
  }
}

async function crawlWiseReportKr(targetCode, options = {}) {
  return crawlWiseReportKrWithPageSpecs(targetCode, KR_WISEREPORT_PAGE_SPECS, options);
}

async function crawlWiseReportKrV12(targetCode, options = {}) {
  return crawlWiseReportKrWithPageSpecs(targetCode, KR_WISEREPORT_V12_PAGE_SPECS, options);
}

async function getAggregate(targetCode, options = {}) {
  return crawlWiseReportKr(targetCode, options);
}

async function getCrawl(targetCode, options = {}) {
  return crawlWiseReportKr(targetCode, options);
}

async function getCrawlV12(targetCode, options = {}) {
  return crawlWiseReportKrV12(targetCode, options);
}

async function getCrawlSection(targetCode, routeRef, options = {}) {
  return crawlWiseReportKrPage(targetCode, routeRef, options);
}

async function crawlMarketData() {
  logger.start('Crawler', '시장 데이터 수집 (KOSPI/KOSDAQ)');
  const chromium = getPlaywrightChromium();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  async function getNaverIndex(code) {
    let page;
    try {
      page = await context.newPage();
      await page.goto(`https://finance.naver.com/sise/sise_index.naver?code=${code}`, { waitUntil: 'domcontentloaded' });
      const text = await page.evaluate(() => document.body.innerText.substring(0, 5000));
      return text;
    } catch (error) {
      logger.error('Crawler', `시장 데이터 실패 (${code}) | ${error.message}`);
      return '데이터 없음';
    } finally {
      if (page) {
        await page.close().catch(() => {});
      }
    }
  }

  try {
    const [kospi, kosdaq] = await Promise.all([
      getNaverIndex('KOSPI'),
      getNaverIndex('KOSDAQ'),
    ]);

    return {
      KOSPI: kospi,
      KOSDAQ: kosdaq,
    };
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

module.exports = {
  KR_WISEREPORT_PAGE_SPECS,
  KR_WISEREPORT_V12_PAGE_SPECS,
  WISEREPORT_KR_PAGES,
  WISEREPORT_KR_V12_PAGES,
  getAggregate,
  getCrawl,
  getCrawlV12,
  getCrawlSection,
  crawlWiseReportKr,
  crawlWiseReportKrV12,
  crawlWiseReportKrPage,
  crawlMarketData,
};
