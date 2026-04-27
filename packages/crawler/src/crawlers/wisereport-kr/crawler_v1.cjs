const logger = require('../../utils/logger.cjs');
const { normalizeText, limitText } = require('./helpers.cjs');

const DEFAULT_NAVIGATION_TIMEOUT_MS = 30000;
const DEFAULT_WAIT_AFTER_LOAD_MS = 1200;
const MAX_CAPTURED_TABLES = 32;
const BLOCKED_RESOURCE_TYPES = Object.freeze(['image', 'stylesheet', 'font', 'media']);
const ONE_PIXEL_GIF = Buffer.from('R0lGODlhAQABAPAAAP///wAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');

const NOISE_SELECTORS = Object.freeze([
  '#skipNavi',
  '#skip_navi',
  '.btn_top',
  '.acResults',
  '.searchInputWrap',
  '.search-input-wrap',
  '.search_area',
  '.searchArea',
  '.search',
  '.topBanner',
  '.top_bnr',
  '.top_bnr_wrap',
  '.footer',
  '#footer',
  '.fng_footer',
  '.fng_body .gnb',
  '.fng_header',
  '#header',
  '.header',
  '.gnb',
  '.lnb',
  '.advertise',
  '.ad_box',
  '.adsbygoogle',
  '.promotion',
  '.promo',
  '.popup',
  '.layerPop',
  '.top_fix_banner',
]);

const NOISE_TEXT_PATTERNS = Object.freeze([
  /와이즈리포트\s*5만원\s*페이백/,
  /네이버페이\s*5만원/,
  /^기업명\s*검색\s*바로가기$/,
  /^본문\s*바로가기$/,
  /^메뉴\s*바로가기$/,
  /^서브메뉴\s*바로가기$/,
  /^검색$/,
  /^인쇄(?:인쇄)?$/,
  /^현재페이지\s*최상단으로\s*이동$/,
  /^홈페이지$/,
  /^닫기$/,
  /^FnGuide에서\s*제공하는\s*정보는/,
]);

const SELECTED_RESPONSE_PATTERNS = Object.freeze([
  /\/company\/ajax\//i,
  /\/company\/cF\d+/i,
  /\/company\/chart\//i,
  /\/company\/getFinStatement/i,
  /\/company\/getFinChart/i,
  /\/json\/chart\//i,
  /\/json\/data\//i,
  /BandChart/i,
]);

async function waitForPageReady(page, spec, timeoutMs = 7000) {
  const selectors = Array.isArray(spec.waitForSelectors) ? spec.waitForSelectors.filter(Boolean) : [];
  if (selectors.length === 0) {
    return null;
  }
  try {
    await page.waitForSelector(selectors.join(', '), { timeout: timeoutMs, state: 'attached' });
    for (const selector of selectors) {
      if (await page.$(selector)) {
        return selector;
      }
    }
  } catch (_error) {
    // continue
  }
  return null;
}

function shouldCaptureResponse(url) {
  return SELECTED_RESPONSE_PATTERNS.some((pattern) => pattern.test(url));
}

function sortCapturedResponses(responses) {
  return [...responses]
    .sort((left, right) => Number(left.captureOrder || 0) - Number(right.captureOrder || 0))
    .map(({ captureOrder, ...response }) => response);
}

async function captureFrame(frame) {
  try {
    return await frame.evaluate(() => {
      const clean = (value) => String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
      const extractTableRows = (table) => {
        const grid = [];
        const domRows = Array.from(table.rows || []);
        domRows.forEach((row, rowIndex) => {
          if (!grid[rowIndex]) {
            grid[rowIndex] = [];
          }
          let columnIndex = 0;
          Array.from(row.cells || []).forEach((cell) => {
            while (grid[rowIndex][columnIndex] !== undefined) {
              columnIndex += 1;
            }
            const text = clean(cell.innerText || cell.textContent || '');
            const colspan = Math.max(1, Number(cell.getAttribute('colspan')) || cell.colSpan || 1);
            const rowspan = Math.max(1, Number(cell.getAttribute('rowspan')) || cell.rowSpan || 1);
            for (let rowOffset = 0; rowOffset < rowspan; rowOffset += 1) {
              if (!grid[rowIndex + rowOffset]) {
                grid[rowIndex + rowOffset] = [];
              }
              for (let columnOffset = 0; columnOffset < colspan; columnOffset += 1) {
                grid[rowIndex + rowOffset][columnIndex + columnOffset] = text;
              }
            }
            columnIndex += colspan;
          });
        });
        const columnCount = Math.max(0, ...grid.map((row) => row.length));
        return grid.map((row) => Array.from({ length: columnCount }, (_, index) => clean(row[index] || '')));
      };
      const extractTable = (table) => ({
        id: table.id || null,
        className: table.className || null,
        rows: extractTableRows(table),
      });
      return {
        title: document.title,
        url: location.href,
        bodyTextHead: clean(document.body?.innerText || '').slice(0, 1200),
        tables: Array.from(document.querySelectorAll('table')).slice(0, 16).map(extractTable),
      };
    });
  } catch (error) {
    return {
      error: error?.message || 'unable to access iframe content',
    };
  }
}

async function capturePageDom(page, spec, code) {
  return page.evaluate(({ noiseSelectors, code, spec, noisePatterns, maxCapturedTables }) => {
    const clean = (value) => String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    const noiseRegexes = noisePatterns.map((pattern) => new RegExp(pattern.source, pattern.flags));

    const removeNoise = () => {
      const removed = [];
      noiseSelectors.forEach((selector) => {
        document.querySelectorAll(selector).forEach((element) => {
          removed.push({ selector, text: clean(element.textContent).slice(0, 160) });
          element.remove();
        });
      });
      return removed;
    };

    const extractTableRows = (table) => {
      const grid = [];
      const domRows = Array.from(table.rows || []);
      domRows.forEach((row, rowIndex) => {
        if (!grid[rowIndex]) {
          grid[rowIndex] = [];
        }
        let columnIndex = 0;
        Array.from(row.cells || []).forEach((cell) => {
          while (grid[rowIndex][columnIndex] !== undefined) {
            columnIndex += 1;
          }
          const text = clean(cell.innerText || cell.textContent || '');
          const colspan = Math.max(1, Number(cell.getAttribute('colspan')) || cell.colSpan || 1);
          const rowspan = Math.max(1, Number(cell.getAttribute('rowspan')) || cell.rowSpan || 1);
          for (let rowOffset = 0; rowOffset < rowspan; rowOffset += 1) {
            if (!grid[rowIndex + rowOffset]) {
              grid[rowIndex + rowOffset] = [];
            }
            for (let columnOffset = 0; columnOffset < colspan; columnOffset += 1) {
              grid[rowIndex + rowOffset][columnIndex + columnOffset] = text;
            }
          }
          columnIndex += colspan;
        });
      });
      const columnCount = Math.max(0, ...grid.map((row) => row.length));
      return grid.map((row) => Array.from({ length: columnCount }, (_, index) => clean(row[index] || '')));
    };

    const extractTable = (table) => {
      const rows = extractTableRows(table);
      return {
        id: table.id || null,
        className: table.className || null,
        summary: table.getAttribute('summary') || null,
        caption: clean(table.caption ? table.caption.innerText || table.caption.textContent : ''),
        rowCount: rows.length,
        columnCount: Math.max(0, ...rows.map((row) => row.length)),
        rows,
      };
    };

    const removedNoise = removeNoise();
    const allTables = Array.from(document.querySelectorAll('table'));
    const capturedTables = allTables.slice(0, maxCapturedTables).map(extractTable);
    const rawBodyText = String(document.body?.innerText || '').replace(/\u00a0/g, ' ');
    const bodyLines = rawBodyText
      .split('\n')
      .map((line) => clean(line))
      .filter((line) => line && !noiseRegexes.some((pattern) => pattern.test(line)));
    const bodyText = bodyLines.join(' ');
    const companyHeader = clean((document.querySelector('#comInfo') || document.querySelector('#comInfoSection'))?.innerText || '');

    const chartAssets = Array.from(document.querySelectorAll('img, svg, canvas, [id*="chart"], [class*="chart"]'))
      .slice(0, 80)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        id: element.id || null,
        className: element.className || null,
        src: element.getAttribute('src') || null,
        alt: element.getAttribute('alt') || null,
      }))
      .filter((item) => item.id || item.src || item.className);

    const scriptEvidence = Array.from(document.querySelectorAll('script'))
      .map((script) => ({
        id: script.id || null,
        type: script.getAttribute('type') || null,
        snippet: clean(script.textContent).slice(0, 400),
      }))
      .filter((script) => script.id || /chartData|template|ajax|json|highcharts|BandChart|c1050001|c1080001/i.test(script.snippet))
      .slice(0, 30);

    return {
      title: document.title,
      finalUrl: location.href,
      company: {
        code,
        title: document.title,
        name: clean(document.title).split('-')[0].split('(')[0].trim(),
        headerText: companyHeader || bodyLines.slice(0, 8).join(' | ').slice(0, 300),
      },
      removedNoise,
      bodyTextHead: bodyLines.slice(0, 40).join(' | ').slice(0, 1500),
      bodyTextLength: bodyText.length,
      tables: capturedTables,
      tableCapture: {
        totalCount: allTables.length,
        capturedCount: capturedTables.length,
        truncated: allTables.length > capturedTables.length,
      },
      chartAssets,
      scriptEvidence,
      rootBlocks: Array.from(document.body.children || []).slice(0, 20).map((element) => ({
        tag: element.tagName.toLowerCase(),
        id: element.id || null,
        className: element.className || null,
        text: clean(element.innerText || element.textContent || '').slice(0, 180),
      })),
      spec: {
        id: spec.id,
        sourceKey: spec.sourceKey,
        sourceType: spec.sourceType,
      },
    };
  }, {
    noiseSelectors: NOISE_SELECTORS,
    code,
    spec: { id: spec.id, sourceKey: spec.sourceKey, sourceType: spec.sourceType },
    noisePatterns: NOISE_TEXT_PATTERNS.map((pattern) => ({ source: pattern.source, flags: pattern.flags })),
    maxCapturedTables: MAX_CAPTURED_TABLES,
  });
}

async function runCrawlerV1Stage(context, code, spec, options = {}) {
  const page = await context.newPage();
  const requestLog = [];
  const capturedResponses = [];
  const responseCaptureTasks = [];
  let responseCaptureOrder = 0;
  const startedAt = Date.now();

  const waitForCapturedResponses = async () => {
    await Promise.allSettled(responseCaptureTasks);
    return sortCapturedResponses(capturedResponses);
  };

  await page.route('**/*', (route) => {
    const resourceType = route.request().resourceType();
    if (resourceType === 'image') {
      return route.fulfill({
        status: 200,
        contentType: 'image/gif',
        body: ONE_PIXEL_GIF,
      });
    }
    if (BLOCKED_RESOURCE_TYPES.includes(resourceType)) {
      return route.abort();
    }
    return route.continue();
  });

  page.on('request', (request) => {
    const url = request.url();
    if (url.startsWith('data:')) {
      return;
    }
    requestLog.push({
      method: request.method(),
      resourceType: request.resourceType(),
      url,
    });
  });

  page.on('response', (response) => {
    const captureOrder = responseCaptureOrder;
    responseCaptureOrder += 1;
    const task = (async () => {
      try {
        const request = response.request();
        const url = response.url();
        if (!shouldCaptureResponse(url)) {
          return;
        }
        const contentType = response.headers()['content-type'] || null;
        const isJson = /json/i.test(contentType || '') || /\/json\//i.test(url);
        let parsedBody = null;
        let bodyText = null;
        if (isJson) {
          try {
            parsedBody = await response.json();
          } catch (_error) {
            bodyText = limitText(await response.text());
          }
        } else {
          bodyText = limitText(await response.text());
        }
        capturedResponses.push({
          captureOrder,
          url,
          status: response.status(),
          resourceType: request.resourceType(),
          contentType,
          bodyType: parsedBody ? 'json' : 'text',
          parsedBody,
          bodyText,
        });
      } catch (error) {
        capturedResponses.push({
          captureOrder,
          url: response.url(),
          status: response.status(),
          resourceType: response.request().resourceType(),
          contentType: response.headers()['content-type'] || null,
          bodyType: 'error',
          error: error?.message || 'response capture failed',
        });
      }
    })();
    responseCaptureTasks.push(task);
  });

  try {
    logger.start('Crawler', `${spec.sourceKey} 요청 | ${spec.url(code)}`);
    await page.goto(spec.url(code), {
      waitUntil: 'domcontentloaded',
      timeout: options.navigationTimeoutMs || DEFAULT_NAVIGATION_TIMEOUT_MS,
    });
    const readySelector = await waitForPageReady(page, spec, options.waitForSelectorTimeoutMs || 8000);
    await page.waitForTimeout(options.waitAfterLoadMs || DEFAULT_WAIT_AFTER_LOAD_MS);

    const iframeEntries = await Promise.all(page.frames()
      .filter((frame) => frame !== page.mainFrame())
      .map(async (frame) => ({
        name: frame.name() || null,
        url: frame.url() || null,
        title: await frame.title().catch(() => null),
        content: await captureFrame(frame),
      })));

    const capture = await capturePageDom(page, spec, code);
    const finalizedResponses = await waitForCapturedResponses();
    const durationMs = Date.now() - startedAt;

    logger.done('Crawler', `${spec.sourceKey} | ${durationMs}ms | tables:${capture.tables.length} | requests:${requestLog.length}`);

    return {
      ok: true,
      source: {
        provider: spec.sourceType,
        url: spec.url(code),
        finalUrl: capture.finalUrl,
        fetchedAt: new Date().toISOString(),
        durationMs,
        requestLog,
        capturedResponses: finalizedResponses,
        iframes: iframeEntries,
      },
      capture,
      stage: {
        ok: true,
        strategy: 'crawler_v1',
        readySelector,
        requestCount: requestLog.length,
        responseCaptureCount: finalizedResponses.length,
        iframeCount: iframeEntries.length,
        tableCount: capture.tables.length,
      },
    };
  } catch (error) {
    const finalizedResponses = await waitForCapturedResponses();
    const durationMs = Date.now() - startedAt;
    logger.error('Crawler', `${spec.sourceKey} 실패 | ${durationMs}ms | ${error?.message || error}`);
    return {
      ok: false,
      source: {
        provider: spec.sourceType,
        url: spec.url(code),
        fetchedAt: new Date().toISOString(),
        durationMs,
        requestLog,
        capturedResponses: finalizedResponses,
        iframes: [],
      },
      capture: {
        title: '',
        finalUrl: spec.url(code),
        company: { code },
        removedNoise: [],
        bodyTextHead: '',
        bodyTextLength: 0,
        tables: [],
        tableCapture: {
          totalCount: 0,
          capturedCount: 0,
          truncated: false,
        },
        chartAssets: [],
        scriptEvidence: [],
        rootBlocks: [],
      },
      stage: {
        ok: false,
        strategy: 'crawler_v1',
        error: error?.message || 'crawl failed',
        requestCount: requestLog.length,
        responseCaptureCount: finalizedResponses.length,
        iframeCount: 0,
        tableCount: 0,
      },
    };
  } finally {
    await page.close();
  }
}

module.exports = {
  runCrawlerV1Stage,
  waitForPageReady,
  shouldCaptureResponse,
  sortCapturedResponses,
};
