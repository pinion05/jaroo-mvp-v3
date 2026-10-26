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
  const aggregate = await crawlWiseReportKrV12(targetCode, options);

  // 컨센서스 폴백: fnguide 투자의견 페이지가 깨졌거나('페이지가 없습니다') 목표가
  // 데이터가 비어 있으면 네이버 증권 데이터를 opinion 페이지에 주입해 목표주가·
  // 투자의견을 회복한다.
  // 조건 원복(2026-10-13): '정상 로드됐지만 목표가 없음'을 제외했더니 fnguide에
  // 목표가 행이 없는 종목의 유일한 출처가 사라져 리포트에서 애널리스트 목표가
  // 그래프 자체가 증발했다. 폴백 체인 전체에 바디 포함 타임아웃이 걸린 지금은
  // 빗나가는 폴백도 ~6초 안에 끝나므로(실측) 넓은 조건을 유지해도 안전하다.
  try {
    const opinionPage = aggregate?.normalized?.opinion ?? aggregate?.pages?.opinion;
    const opinionText = JSON.stringify(opinionPage?.bodyTextHead ?? opinionPage ?? '');
    const shouldFallback = Boolean(opinionPage)
      && (opinionText.includes('페이지가 없습니다') || !JSON.stringify(opinionPage).includes('목표'));
    if (shouldFallback) {
      const fallbackStartedAtMs = Date.now();
      logger.info('Crawler', `[naver-consensus-fallback] ${targetCode} | fnguide opinion 불충분(장애/목표가 없음) — 네이버 폴백 시도`);
      const { buildNaverConsensusSyntheticRow } = await import('../services/deepscan-kr-naver-consensus.js');
      const synthetic = await buildNaverConsensusSyntheticRow(targetCode);
      logger.info('Crawler', `[naver-consensus-fallback] ${targetCode} | 폴백 완료 elapsed=${Date.now() - fallbackStartedAtMs}ms 결과=${synthetic ? '회복' : '데이터 없음'}`);
      if (synthetic) {
        synthetic.bodyTextHead = '네이버 증권 컨센서스 폴백 데이터';
        if (aggregate.normalized) aggregate.normalized.opinion = synthetic;
        if (aggregate.pages) aggregate.pages.opinion = synthetic;
        logger.info('Crawler', `[naver-consensus-fallback] ${targetCode} | 목표주가 ${synthetic.targetPrice}원 · 점수 ${synthetic['투자의견(점수)']}`);
      }
    }
  } catch (error) {
    logger.warn?.('Crawler', `[naver-consensus-fallback] 실패(무시): ${error?.message}`);
  }

  return aggregate;
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
