const fs = require('fs');

function getPlaywrightChromium() {
    return require('playwright').chromium;
}

const SOURCES = {
    vkospi: 'https://stockplus.com/m/stocks/KOREA-O2901P',
    adr: 'http://adrinfo.kr/',
    usVix: 'https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?range=5d&interval=1d',
    usVixInvesting: 'https://kr.investing.com/indices/volatility-s-p-500'
};

const MARKET_JSON_HEADERS = {
    accept: 'application/json,text/plain,*/*',
    'user-agent': 'Mozilla/5.0 (compatible; JarooCrawler/1.0; +https://jaroo.local)'
};

const MARKET_JSON_TIMEOUT_MS = 3000;

const USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';

const EXECUTABLE_PATH_CANDIDATES = [
    '/Applications/BrowserOS.app/Contents/MacOS/BrowserOS',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium'
];

function roundTo(value, digits = 2) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

function toNumber(value) {
    if (value == null) {
        return null;
    }

    const normalized = String(value)
        .trim()
        .replace(/,/g, '')
        .replace(/%$/, '');
    if (!normalized) {
        return null;
    }

    const number = Number(normalized);
    return Number.isFinite(number) ? number : null;
}

function normalizeText(text) {
    return String(text || '')
        .replace(/\u00a0/g, ' ')
        .replace(/\r/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{2,}/g, '\n')
        .trim();
}

function toLines(text) {
    return normalizeText(text)
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
}

function requireMatch(match, message) {
    if (!match) {
        throw new Error(message);
    }
    return match;
}

function inferSignedDelta(value, previousValue) {
    const delta = roundTo(value - previousValue, 2);
    const deltaPercent = previousValue === 0 ? 0 : roundTo((delta / previousValue) * 100, 2);
    return { delta, deltaPercent };
}

function toIsoTimestamp(value) {
    if (Number.isFinite(value)) {
        return new Date(value * 1000).toISOString();
    }

    if (typeof value === 'string' && value.trim()) {
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed)) {
            return new Date(parsed).toISOString();
        }
    }

    return new Date().toISOString();
}

async function fetchJsonWithTimeout(url, { fetcher = fetch, timeoutMs = MARKET_JSON_TIMEOUT_MS } = {}) {
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

    try {
        const response = await fetcher(url, {
            headers: MARKET_JSON_HEADERS,
            cache: 'no-store',
            signal: abortController.signal
        });

        if (!response || !response.ok) {
            const status = response?.status ? `HTTP ${response.status}` : 'no response';
            throw new Error(`market indicator upstream failed: ${status}`);
        }

        return await response.json();
    } finally {
        clearTimeout(timeoutId);
    }
}

function findLatestFiniteClose(closes) {
    if (!Array.isArray(closes)) {
        return { value: null, index: -1 };
    }

    for (let index = closes.length - 1; index >= 0; index -= 1) {
        const value = toNumber(closes[index]);
        if (Number.isFinite(value)) {
            return { value, index };
        }
    }

    return { value: null, index: -1 };
}

function findPreviousFiniteClose(closes, beforeIndex) {
    if (!Array.isArray(closes)) {
        return null;
    }

    for (let index = beforeIndex - 1; index >= 0; index -= 1) {
        const value = toNumber(closes[index]);
        if (Number.isFinite(value)) {
            return value;
        }
    }

    return null;
}

function parseYahooVixChart(payload, sourceUrl = SOURCES.usVix) {
    const result = payload?.chart?.result?.[0];
    if (!result) {
        throw new Error('Yahoo VIX chart result not found');
    }

    const meta = result.meta || {};
    const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
    const closes = result.indicators?.quote?.[0]?.close || [];
    const latestClose = findLatestFiniteClose(closes);
    const value = toNumber(meta.regularMarketPrice) ?? latestClose.value;

    if (!Number.isFinite(value)) {
        throw new Error('Yahoo VIX value not found');
    }

    const previousClose = toNumber(meta.previousClose) ?? findPreviousFiniteClose(closes, latestClose.index);
    const { delta, deltaPercent } = Number.isFinite(previousClose)
        ? inferSignedDelta(value, previousClose)
        : { delta: null, deltaPercent: null };

    return {
        name: 'CBOE Volatility Index (VIX)',
        symbol: 'VIX',
        value: roundTo(value, 2),
        change: delta,
        changePercent: deltaPercent,
        status: 'yahoo-chart',
        asOf: toIsoTimestamp(meta.regularMarketTime ?? timestamps[latestClose.index]),
        source: 'yahoo-chart',
        sourceUrl
    };
}

function parseVkospiText(text) {
    const normalized = normalizeText(text);
    const lines = toLines(text);
    const titleIndex = lines.findIndex((line) => line.includes('코스피200 변동성지수'));
    requireMatch(titleIndex === -1 ? null : [true], 'VKOSPI name not found');

    const asOfLine = requireMatch(
        lines.find((line, index) =>
            index > titleIndex
            && /(?:\d{2}:\d{2}|\d{2}\.\d{2})\s*(?:장중|마감|장마감|장종료)/.test(line)
        ),
        'VKOSPI as-of not found'
    );
    const valueLines = lines.slice(titleIndex + 1, lines.indexOf(asOfLine));
    const valueLine = valueLines.find((line) => /^\d{1,3}(?:\.\d{1,2})?$/.test(line));
    const nearbyChunk = valueLines.join(' ');
    const fallbackValueMatch = /(^|[^\d])(\d{1,3}(?:\.\d{1,2})?)(?=\s|[^\d]|$)/.exec(nearbyChunk);

    const previousCloseMatch = requireMatch(
        /전일(?:지수|종가)\s*([0-9]+\.[0-9]+)/.exec(normalized),
        'VKOSPI previous close not found'
    );

    const value = toNumber(valueLine || fallbackValueMatch?.[2]);
    requireMatch(Number.isFinite(value) ? [true] : null, 'VKOSPI current value not found');
    const previousClose = toNumber(previousCloseMatch[1]);
    const { delta, deltaPercent } = inferSignedDelta(value, previousClose);

    return {
        name: '코스피200 변동성지수',
        value,
        change: delta,
        changePercent: deltaPercent,
        asOf: asOfLine.trim(),
        sourceUrl: SOURCES.vkospi
    };
}

function parseSignedChange(directionToken, magnitudeToken) {
    const changeMagnitude = toNumber(magnitudeToken);
    let direction = 1;

    if (directionToken === '▼' || directionToken === '-') {
        direction = -1;
    }
    if (changeMagnitude === 0) {
        direction = 1;
    }

    return roundTo(direction * changeMagnitude);
}

function parseAdrCurrentSnapshot(blockLines, market) {
    for (let index = 0; index < blockLines.length - 1; index += 1) {
        const asOfMatch = /^(\d{4}-\d{2}-\d{2})(?:\s*\(\d{2}:\d{2}\))?$/.exec(blockLines[index]);
        if (!asOfMatch) {
            continue;
        }

        const valueMatch = /^([0-9]+(?:\.[0-9]+)?)%?\s+\(\s*([▲▼+-])?\s*([0-9]+(?:\.[0-9]+)?)\s*\)$/u.exec(blockLines[index + 1]);
        if (!valueMatch) {
            continue;
        }

        return {
            market,
            value: toNumber(valueMatch[1]),
            change: parseSignedChange(valueMatch[2], valueMatch[3]),
            asOf: asOfMatch[1]
        };
    }

    return null;
}

function parseAdrBlock(text, market) {
    const lines = normalizeText(text)
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

    const marketIndex = lines.findIndex((line) => line === market);
    requireMatch(marketIndex === -1 ? null : [true], `${market} ADR block not found`);

    const nextMarketIndex = lines.findIndex((line, index) => index > marketIndex && (line === 'KOSPI' || line === 'KOSDAQ'));
    const blockLines = lines.slice(
        marketIndex + 1,
        nextMarketIndex === -1 ? undefined : nextMarketIndex
    );

    const currentSnapshot = parseAdrCurrentSnapshot(blockLines, market);
    if (currentSnapshot) {
        return currentSnapshot;
    }

    const previousLine = requireMatch(
        blockLines.find((line) => /^\d{4}-\d{2}-\d{2}\s+[0-9]+(?:\.[0-9]+)?%?\s+\(\s*([▲▼+-])?\s*[0-9]+(?:\.[0-9]+)?\s*\)$/u.test(line)),
        `${market} ADR snapshot line not found`
    );

    const match = requireMatch(
        /^(\d{4}-\d{2}-\d{2})\s+([0-9]+(?:\.[0-9]+)?)%?\s+\(\s*([▲▼+-])?\s*([0-9]+(?:\.[0-9]+)?)\s*\)$/u.exec(previousLine),
        `${market} ADR snapshot parse failed`
    );

    return {
        market,
        value: toNumber(match[2]),
        change: parseSignedChange(match[3], match[4]),
        asOf: match[1]
    };
}

function parseAdrText(text) {
    const normalized = normalizeText(text);

    return {
        kospi: parseAdrBlock(normalized, 'KOSPI'),
        kosdaq: parseAdrBlock(normalized, 'KOSDAQ'),
        sourceUrl: SOURCES.adr
    };
}

function parseUsVixText(text) {
    const lines = toLines(text);
    const titleIndex = lines.findIndex((line) => line.includes('CBOE Volatility Index (VIX)'));
    requireMatch(titleIndex === -1 ? null : [true], 'US VIX title not found');

    const usdIndex = lines.findIndex((line, index) => index > titleIndex && line === 'USD');
    requireMatch(usdIndex === -1 ? null : [true], 'US VIX USD marker not found');

    const blockLines = lines.slice(usdIndex + 1, usdIndex + 12);
    const valueLine = requireMatch(
        blockLines.find((line) => /^\d{1,3}(?:\.\d{1,2})$/.test(line)),
        'US VIX current value not found'
    );
    const changeLine = requireMatch(
        blockLines.find((line) => /^[+-]\d{1,3}(?:\.\d{1,2})$/.test(line)),
        'US VIX change not found'
    );
    const changePercentLine = requireMatch(
        blockLines.find((line) => /^\([+-]\d{1,3}(?:\.\d{1,2})%\)$/.test(line)),
        'US VIX change percent not found'
    );
    const statusIndex = blockLines.findIndex((line) => /^(?:닫음|실시간|실시간 데이터|개장중|폐장)$/.test(line));
    const statusLine = requireMatch(
        statusIndex === -1 ? null : blockLines[statusIndex],
        'US VIX status not found'
    );
    const asOfLine = requireMatch(
        blockLines
            .slice(statusIndex + 1)
            .find((line) => /^(?:\d{2}:\d{2}:\d{2}|\d{2}\/\d{2})$/.test(line)),
        'US VIX as-of not found'
    );

    return {
        name: 'CBOE Volatility Index (VIX)',
        symbol: 'VIX',
        value: toNumber(valueLine),
        change: toNumber(changeLine),
        changePercent: toNumber(changePercentLine.replace(/[()%]/g, '')),
        status: statusLine === '실시간 데이터' ? '실시간' : statusLine,
        asOf: asOfLine,
        sourceUrl: SOURCES.usVixInvesting
    };
}

function getFallbackExecutablePath() {
    for (const candidate of EXECUTABLE_PATH_CANDIDATES) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return null;
}

async function launchBrowser() {
    const chromium = getPlaywrightChromium();
    const attempts = [{ headless: true }];
    const fallbackExecutablePath = getFallbackExecutablePath();

    if (fallbackExecutablePath) {
        attempts.push({
            headless: true,
            executablePath: fallbackExecutablePath
        });
    }

    let lastError = null;
    for (const options of attempts) {
        try {
            return await chromium.launch(options);
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError || new Error('Unable to launch browser');
}

async function waitForMarkers(page, markers) {
    if (!Array.isArray(markers) || markers.length === 0) {
        return;
    }

    await page.waitForFunction(
        (expectedMarkers) => {
            const text = document.body?.innerText || '';
            return expectedMarkers.every((marker) => text.includes(marker));
        },
        markers,
        { timeout: 15000 }
    );
}

async function waitForPatterns(page, patterns) {
    if (!Array.isArray(patterns) || patterns.length === 0) {
        return;
    }

    await page.waitForFunction(
        (expectedPatterns) => {
            const text = document.body?.innerText || '';
            return expectedPatterns.every((pattern) => {
                try {
                    return new RegExp(pattern, 'u').test(text);
                } catch (_error) {
                    return false;
                }
            });
        },
        patterns,
        { timeout: 15000 }
    );
}

async function collectPageText(page, url, options = {}) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForMarkers(page, options.readyMarkers);
    await waitForPatterns(page, options.readyPatterns);
    await page.waitForTimeout(1000);

    const text = await page.evaluate(() => document.body.innerText || '');
    const normalized = normalizeText(text);

    if (normalized.length < 50) {
        throw new Error(`Collected text too short for ${url}`);
    }

    return normalized;
}

async function withBrowser(callback) {
    const browser = await launchBrowser();

    try {
        const context = await browser.newContext({
            userAgent: USER_AGENT,
            locale: 'ko-KR',
            viewport: { width: 1440, height: 1200 }
        });

        await context.route('**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf,otf}', (route) => route.abort());

        try {
            return await callback(context);
        } finally {
            await context.close();
        }
    } finally {
        await browser.close();
    }
}

async function fetchIndicator(context, url, parser, options = {}) {
    const attempts = Math.max(1, Number(options.attempts) || 1);
    let lastError = null;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const page = await context.newPage();

        try {
            const rawText = await collectPageText(page, url, options);
            return {
                ...parser(rawText),
                rawText
            };
        } catch (error) {
            lastError = error;
            if (attempt < attempts) {
                await page.waitForTimeout(1500);
            }
        } finally {
            await page.close();
        }
    }

    throw lastError || new Error(`Failed to fetch indicator from ${url}`);
}

async function fetchIndicatorSafe(context, label, url, parser, options = {}) {
    try {
        return await fetchIndicator(context, url, parser, options);
    } catch (error) {
        console.warn(`⚠️ [marketIndicators] ${label} 조회 실패: ${error.message}`);
        return null;
    }
}

async function fetchVkospi() {
    return withBrowser((context) =>
        fetchIndicator(context, SOURCES.vkospi, parseVkospiText, {
            attempts: 2,
            readyMarkers: ['코스피200 변동성지수'],
            readyPatterns: [
                '코스피200 변동성지수',
                '(?:\\d{2}:\\d{2}|\\d{2}\\.\\d{2})\\s*(?:장중|마감|장마감|장종료)',
                '전일(?:지수|종가)'
            ]
        })
    );
}

async function fetchAdr() {
    return withBrowser((context) =>
        fetchIndicator(context, SOURCES.adr, parseAdrText, {
            attempts: 2,
            readyMarkers: ['KOSPI', 'KOSDAQ']
        })
    );
}

async function fetchUsVix({ fetcher = fetch, timeoutMs = MARKET_JSON_TIMEOUT_MS } = {}) {
    const payload = await fetchJsonWithTimeout(SOURCES.usVix, { fetcher, timeoutMs });
    return parseYahooVixChart(payload, SOURCES.usVix);
}

function buildSourceStatus(label, sourceUrl, value, error = null) {
    if (value) {
        return { status: 'ok', sourceUrl };
    }

    return {
        status: label === 'vkospi' ? 'blocked' : 'error',
        sourceUrl,
        reason: error instanceof Error ? error.message : error || (label === 'vkospi' ? 'source-blocked-on-oci' : 'source-unavailable')
    };
}

async function fetchAllMarketIndicators() {
    const vkospi = null;
    const vkospiStatus = buildSourceStatus('vkospi', SOURCES.vkospi, vkospi, 'stockplus-cloudfront-blocked-on-oci');

    const [adrResult, usVixResult] = await Promise.allSettled([
        fetchAdr(),
        fetchUsVix()
    ]);

    const adr = adrResult.status === 'fulfilled' ? adrResult.value : null;
    const usVix = usVixResult.status === 'fulfilled' ? usVixResult.value : null;

    if (adrResult.status === 'rejected') {
        console.warn(`⚠️ [marketIndicators] ADR 조회 실패: ${adrResult.reason?.message || adrResult.reason}`);
    }
    if (usVixResult.status === 'rejected') {
        console.warn(`⚠️ [marketIndicators] US VIX 조회 실패: ${usVixResult.reason?.message || usVixResult.reason}`);
    }

    return {
        vkospi,
        adr,
        usVix,
        partial: !vkospi || !adr || !usVix,
        sourceStatus: {
            vkospi: vkospiStatus,
            adr: buildSourceStatus('adr', SOURCES.adr, adr, adrResult.status === 'rejected' ? adrResult.reason : null),
            usVix: buildSourceStatus('usVix', SOURCES.usVix, usVix, usVixResult.status === 'rejected' ? usVixResult.reason : null)
        }
    };
}

module.exports = {
    SOURCES,
    parseVkospiText,
    parseAdrText,
    parseUsVixText,
    parseYahooVixChart,
    fetchVkospi,
    fetchAdr,
    fetchUsVix,
    fetchAllMarketIndicators
};
