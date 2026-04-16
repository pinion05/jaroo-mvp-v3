let cachedClient = null;
let cachedLib = null;
let cachedTrigger = null;

const DEFAULT_KRX_RETRY_DELAYS_MS = [2000, 5000];
const RETRYABLE_KRX_ERROR_PATTERNS = [
    /\bCD003\b/i,
    /서비스 에러/i,
    /로그인 세션 검증 실패/i,
    /session expired/i,
    /html response - session expired/i,
    /empty response - session expired/i,
    /json parse failed - session expired/i,
    /fetch failed/i,
    /econnreset/i,
    /etimedout/i,
    /eai_again/i,
    /socket hang up/i
];

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function isRetryableKrxError(err) {
    const text = [
        err?.message,
        err?.cause?.message,
        err?.stack,
        typeof err === 'string' ? err : null
    ]
        .filter(Boolean)
        .join('\n');

    return RETRYABLE_KRX_ERROR_PATTERNS.some((pattern) => pattern.test(text));
}

async function withKrxRetry(operation, options = {}) {
    const {
        label = 'KRX request',
        maxRetries = DEFAULT_KRX_RETRY_DELAYS_MS.length,
        retryDelaysMs = DEFAULT_KRX_RETRY_DELAYS_MS,
        sleepFn = sleep
    } = options;

    let attempt = 0;
    while (true) {
        try {
            return await operation();
        } catch (err) {
            if (!isRetryableKrxError(err) || attempt >= maxRetries) {
                throw err;
            }

            const delayMs = retryDelaysMs[Math.min(attempt, retryDelaysMs.length - 1)] ?? 0;
            console.warn(
                `⚠️ [krxClient] ${label} transient failure (${attempt + 1}/${maxRetries + 1}): ${err.message}. ${delayMs}ms 후 재시도합니다.`
            );
            await sleepFn(delayMs);
            attempt += 1;
        }
    }
}

function normalizeYyyymmdd(value) {
    if (!value) {
        return null;
    }

    const text = String(value).trim();
    const digits = text.replace(/[^0-9]/g, '');
    if (/^\d{8}$/.test(digits)) {
        return digits;
    }

    const ms = Date.parse(text);
    if (!Number.isFinite(ms)) {
        return null;
    }

    const date = new Date(ms);
    return [
        String(date.getUTCFullYear()),
        String(date.getUTCMonth() + 1).padStart(2, '0'),
        String(date.getUTCDate()).padStart(2, '0')
    ].join('');
}

function shiftYyyymmdd(dateValue, deltaDays) {
    const normalized = normalizeYyyymmdd(dateValue);
    if (!normalized) {
        return null;
    }

    const year = Number(normalized.slice(0, 4));
    const month = Number(normalized.slice(4, 6)) - 1;
    const day = Number(normalized.slice(6, 8));
    const date = new Date(Date.UTC(year, month, day));
    date.setUTCDate(date.getUTCDate() + Number(deltaDays || 0));

    return [
        String(date.getUTCFullYear()),
        String(date.getUTCMonth() + 1).padStart(2, '0'),
        String(date.getUTCDate()).padStart(2, '0')
    ].join('');
}

function diffYyyymmddDays(laterDate, earlierDate) {
    const later = normalizeYyyymmdd(laterDate);
    const earlier = normalizeYyyymmdd(earlierDate);
    if (!later || !earlier) {
        return null;
    }
    const laterUtc = Date.UTC(
        Number(later.slice(0, 4)),
        Number(later.slice(4, 6)) - 1,
        Number(later.slice(6, 8))
    );
    const earlierUtc = Date.UTC(
        Number(earlier.slice(0, 4)),
        Number(earlier.slice(4, 6)) - 1,
        Number(earlier.slice(6, 8))
    );
    return Math.round((laterUtc - earlierUtc) / 86400000);
}

function toSortableEpoch(dateValue) {
    if (!dateValue) {
        return Number.POSITIVE_INFINITY;
    }

    const text = String(dateValue);
    const ms = Date.parse(text);
    if (Number.isFinite(ms)) {
        return ms;
    }

    const digits = text.replace(/[^0-9]/g, '');
    if (/^\d{8}$/.test(digits)) {
        const iso = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
        const ms2 = Date.parse(iso);
        return Number.isFinite(ms2) ? ms2 : Number.POSITIVE_INFINITY;
    }

    return Number.POSITIVE_INFINITY;
}

function sortRowsByDateAsc(rows) {
    if (!Array.isArray(rows) || rows.length <= 1) {
        return rows || [];
    }
    return rows.slice().sort((a, b) => {
        const aKey = toSortableEpoch(a?.date);
        const bKey = toSortableEpoch(b?.date);
        if (aKey !== bKey) {
            return aKey - bKey;
        }
        return String(a?.date || '').localeCompare(String(b?.date || ''));
    });
}

async function loadLib() {
    try {
        if (!cachedLib) {
            cachedLib = await import('krx-js-client');
        }
        return cachedLib;
    } catch (err) {
        console.error('⚠️ [krxClient] Failed to load krx-js-client:', err);
        throw err;
    }
}

async function loadTrigger() {
    try {
        if (!cachedTrigger) {
            cachedTrigger = await import('krx-js-client/trigger_batch.js');
        }
        return cachedTrigger;
    } catch (err) {
        console.error('⚠️ [krxClient] Failed to load trigger_batch:', err);
        throw err;
    }
}

async function getClient() {
    try {
        if (cachedClient) {
            return cachedClient;
        }
        const { KRXDataClient } = await loadLib();
        cachedClient = new KRXDataClient();
        return cachedClient;
    } catch (err) {
        console.error('⚠️ [krxClient] Failed to init client:', err);
        throw err;
    }
}

function toNumber(value) {
    if (value == null) {
        return null;
    }
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }
    const text = String(value).trim();
    if (!text) {
        return null;
    }
    const cleaned = text
        .replace(/[\s,]/g, '')
        .replace(/%$/, '');
    const num = Number(cleaned);
    return Number.isFinite(num) ? num : null;
}

function isUsableTriggerSnapshot(rows, options = {}) {
    if (!Array.isArray(rows) || rows.length === 0) {
        return false;
    }

    const { minFiniteRatio = 0.1, minFiniteCount = 20 } = options;
    let usableCount = 0;

    for (const row of rows) {
        const close = toNumber(row?.Close ?? row?.close ?? row?.['종가']);
        const volume = toNumber(row?.Volume ?? row?.volume ?? row?.['거래량']);
        if (Number.isFinite(close) && Number.isFinite(volume)) {
            usableCount += 1;
        }
    }

    return usableCount >= minFiniteCount && (usableCount / rows.length) >= minFiniteRatio;
}

function getSnapshotTradeDate(rows, fallbackDate) {
    const fallback = normalizeYyyymmdd(fallbackDate);
    if (!Array.isArray(rows) || rows.length === 0) {
        return fallback;
    }

    const dateKeys = ['date', 'Date', '날짜', '일자', 'tradeDate', 'trade_date', 'TRD_DD', 'TRD_DATE'];
    const counts = new Map();

    for (const row of rows) {
        if (!row || typeof row !== 'object') {
            continue;
        }

        for (const key of dateKeys) {
            const parsed = normalizeYyyymmdd(row[key]);
            if (parsed) {
                counts.set(parsed, (counts.get(parsed) || 0) + 1);
                break;
            }
        }
    }

    if (counts.size === 0) {
        return fallback;
    }

    const ranked = Array.from(counts.entries()).sort((a, b) => {
        if (b[1] !== a[1]) {
            return b[1] - a[1];
        }
        if (fallback) {
            const aDistance = Math.abs(diffYyyymmddDays(a[0], fallback) ?? Number.MAX_SAFE_INTEGER);
            const bDistance = Math.abs(diffYyyymmddDays(b[0], fallback) ?? Number.MAX_SAFE_INTEGER);
            if (aDistance !== bDistance) {
                return aDistance - bDistance;
            }
        }
        return String(a[0]).localeCompare(String(b[0]));
    });

    const total = Array.from(counts.values()).reduce((sum, count) => sum + count, 0);
    const [candidateDate, candidateCount] = ranked[0];
    if (candidateCount > (total / 2)) {
        return candidateDate;
    }

    return fallback;
}

async function findNearestUsableSnapshotDate(baseDate, fetchSnapshot, options = {}) {
    if (typeof fetchSnapshot !== 'function') {
        return null;
    }

    const normalizedBase = normalizeYyyymmdd(baseDate);
    if (!normalizedBase) {
        return null;
    }

    const { startOffsetDays = 0, maxBacktrackDays = 10, usabilityOptions = {} } = options;
    const firstOffset = Math.max(0, Number(startOffsetDays) || 0);
    const maxOffset = firstOffset + Math.max(0, Number(maxBacktrackDays) || 0);

    for (let offset = firstOffset; offset <= maxOffset; offset += 1) {
        const candidate = shiftYyyymmdd(normalizedBase, -offset);
        if (!candidate) {
            continue;
        }

        let rows = [];
        try {
            rows = await fetchSnapshot(candidate);
        } catch (_err) {
            continue;
        }

        const resolvedDate = getSnapshotTradeDate(rows, candidate);
        if (isUsableTriggerSnapshot(rows, usabilityOptions)) {
            return {
                date: resolvedDate,
                rows,
                skippedDays: offset - firstOffset
            };
        }
    }

    return null;
}

function createCachedSnapshotFetcher(fetchSnapshot) {
    const cache = new Map();
    const canonicalByRequested = new Map();
    const inflightByRequested = new Map();

    const findPossibleAliasInflight = (normalizedDate) => {
        if (!/^\d{8}$/.test(normalizedDate)) {
            return null;
        }
        let nearest = null;
        for (const [requested, pending] of inflightByRequested.entries()) {
            if (requested === normalizedDate || !/^\d{8}$/.test(requested)) {
                continue;
            }
            const diff = diffYyyymmddDays(requested, normalizedDate);
            if (!Number.isFinite(diff) || diff < 0 || diff > 31) {
                continue;
            }
            if (!nearest || diff < nearest.diff) {
                nearest = { diff, pending };
            }
        }
        return nearest?.pending || null;
    };

    const getCachedByDate = (normalizedDate) => {
        const cacheKey = canonicalByRequested.get(normalizedDate) || normalizedDate;
        return cache.get(cacheKey) || cache.get(normalizedDate) || null;
    };

    const rememberCanonicalAlias = (requestedDate, canonicalDate) => {
        canonicalByRequested.set(canonicalDate, canonicalDate);
        canonicalByRequested.set(requestedDate, canonicalDate);
        if (canonicalDate <= requestedDate) {
            let cursor = requestedDate;
            for (let i = 0; i < 31 && cursor && cursor >= canonicalDate; i += 1) {
                canonicalByRequested.set(cursor, canonicalDate);
                cursor = shiftYyyymmdd(cursor, -1);
            }
        }
    };

    return async (dateValue) => {
        const normalized = normalizeYyyymmdd(dateValue) || String(dateValue || '');
        if (!normalized) {
            return [];
        }

        const cached = getCachedByDate(normalized);
        if (cached) {
            return cached;
        }

        const sameDateInflight = inflightByRequested.get(normalized);
        if (sameDateInflight) {
            return sameDateInflight;
        }

        const aliasInflight = findPossibleAliasInflight(normalized);
        if (aliasInflight) {
            try {
                await aliasInflight;
            } catch (_err) {
                // Retry path below should run when alias request failed.
            }
            const cachedAfterAlias = getCachedByDate(normalized);
            if (cachedAfterAlias) {
                return cachedAfterAlias;
            }
        }

        const pending = (async () => {
            try {
                const rows = await fetchSnapshot(normalized);
                const canonicalDate = getSnapshotTradeDate(rows, normalized) || normalized;

                rememberCanonicalAlias(normalized, canonicalDate);
                cache.set(canonicalDate, Promise.resolve(rows));
                cache.set(normalized, Promise.resolve(rows));
                return rows;
            } catch (err) {
                cache.delete(normalized);
                throw err;
            } finally {
                inflightByRequested.delete(normalized);
            }
        })();

        inflightByRequested.set(normalized, pending);
        cache.set(normalized, pending);
        return pending;
    };
}

function normalizeDateValue(value) {
    if (!value) {
        return null;
    }
    if (value instanceof Date) {
        return value.toISOString().slice(0, 10);
    }
    const text = String(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        return text;
    }
    if (/^\d{8}$/.test(text)) {
        return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
    }
    return text;
}

function pickFirstValue(row, candidates, fallback = 0) {
    for (const key of candidates) {
        if (row[key] != null) {
            return row[key];
        }
    }
    return fallback;
}

function normalizeOhlcvRows(rows) {
    const normalized = (rows || []).map((row) => ({
        date: normalizeDateValue(row.date || row.Date || row['날짜']),
        close: toNumber(row.Close ?? row.close ?? row['종가']),
        volume: toNumber(row.Volume ?? row.volume ?? row['거래량'])
    }));

    return sortRowsByDateAsc(normalized);
}

function normalizeIndexRows(rows) {
    const normalized = (rows || []).map((row) => ({
        date: normalizeDateValue(row.date || row.Date || row['날짜']),
        open: toNumber(row.Open ?? row.open ?? row['시가']),
        high: toNumber(row.High ?? row.high ?? row['고가']),
        low: toNumber(row.Low ?? row.low ?? row['저가']),
        close: toNumber(row.Close ?? row.close ?? row['종가']),
        volume: toNumber(row.Volume ?? row.volume ?? row['거래량']),
        value: toNumber(row.Amount ?? row.value ?? row['거래대금']),
        change: toNumber(row.change ?? row.Change ?? row['등락률'])
    }));

    const sorted = sortRowsByDateAsc(normalized);

    for (let i = 1; i < sorted.length; i += 1) {
        const prev = sorted[i - 1];
        const cur = sorted[i];
        if (cur.change == null && Number.isFinite(prev.close) && Number.isFinite(cur.close)) {
            cur.change = ((cur.close / prev.close) - 1) * 100;
        }
    }

    return sorted;
}

function normalizeInvestorRows(rows) {
    const foreignCandidates = ['외국인', '외국인합계', '외국계', '외국계합계'];
    const institutionCandidates = [
        '기관합계',
        '금융투자',
        '보험',
        '투신',
        '사모',
        '은행',
        '기타금융',
        '연기금등',
        '기타법인',
        '기관',
        '기관계'
    ];

    const normalized = (rows || []).map((row) => ({
        date: normalizeDateValue(row.date || row.Date || row['날짜']),
        individual: toNumber(pickFirstValue(row, ['개인', '개인합계', 'individual'], 0)) || 0,
        foreigner: toNumber(pickFirstValue(row, foreignCandidates, row.foreigner ?? 0)) || 0,
        institution: toNumber(pickFirstValue(row, institutionCandidates, row.institution ?? 0)) || 0
    }));

    return sortRowsByDateAsc(normalized);
}

function normalizeSnapshotRows(rows) {
    return (rows || []).map((row) => ({
        code: row.ticker || row.code || row['티커'] || row['종목코드'],
        '시가': toNumber(row.Open ?? row['시가']),
        '고가': toNumber(row.High ?? row['고가']),
        '저가': toNumber(row.Low ?? row['저가']),
        '종가': toNumber(row.Close ?? row['종가']),
        '거래량': toNumber(row.Volume ?? row['거래량']),
        '거래대금': toNumber(
            row.Amount ?? row['거래대금'] ?? ((row.Volume ?? 0) * (row.Close ?? 0))
        )
    }));
}

function normalizeMarketCapRows(rows) {
    return (rows || []).map((row) => ({
        code: row.ticker || row.code || row['티커'] || row['종목코드'],
        '시가총액': toNumber(row.MarketCap ?? row['시가총액'])
    }));
}

async function getOhlcv(ticker, startDate, endDate) {
    try {
        const client = await getClient();
        const rows = await withKrxRetry(
            () => client.get_market_ohlcv_by_date(startDate, endDate, ticker, true),
            { label: `getOhlcv(${ticker}, ${startDate}, ${endDate})` }
        );
        return normalizeOhlcvRows(rows);
    } catch (err) {
        console.error('⚠️ [krxClient] getOhlcv failed:', err);
        throw err;
    }
}

async function getIndexOhlcv(indexCode, startDate, endDate) {
    try {
        const client = await getClient();
        const rows = await withKrxRetry(
            () => client.get_index_ohlcv_by_date(startDate, endDate, indexCode),
            { label: `getIndexOhlcv(${indexCode}, ${startDate}, ${endDate})` }
        );
        return normalizeIndexRows(rows);
    } catch (err) {
        console.error('⚠️ [krxClient] getIndexOhlcv failed:', err);
        throw err;
    }
}

async function getInvestorVolume(ticker, startDate, endDate) {
    try {
        const client = await getClient();
        const rows = await withKrxRetry(
            () => client.get_market_trading_volume_by_date(startDate, endDate, ticker, false),
            { label: `getInvestorVolume(${ticker}, ${startDate}, ${endDate})` }
        );
        return normalizeInvestorRows(rows);
    } catch (err) {
        console.error('⚠️ [krxClient] getInvestorVolume failed:', err);
        throw err;
    }
}

async function getMarketSnapshot(tradeDate, market = 'ALL') {
    try {
        const client = await getClient();
        const rows = await withKrxRetry(
            () => client.get_market_ohlcv_by_ticker(tradeDate, market),
            { label: `getMarketSnapshot(${tradeDate}, ${market})` }
        );
        return normalizeSnapshotRows(rows);
    } catch (err) {
        console.error('⚠️ [krxClient] getMarketSnapshot failed:', err);
        throw err;
    }
}

async function getMarketCap(tradeDate, market = 'ALL') {
    try {
        const client = await getClient();
        const rows = await withKrxRetry(
            () => client.get_market_cap_by_ticker(tradeDate, market),
            { label: `getMarketCap(${tradeDate}, ${market})` }
        );
        return normalizeMarketCapRows(rows);
    } catch (err) {
        console.error('⚠️ [krxClient] getMarketCap failed:', err);
        throw err;
    }
}

async function getTickerNames(market = 'ALL') {
    try {
        const { get_market_ticker_name_map } = await loadLib();
        return withKrxRetry(
            () => get_market_ticker_name_map(null, market),
            { label: `getTickerNames(${market})` }
        );
    } catch (err) {
        console.error('⚠️ [krxClient] getTickerNames failed:', err);
        throw err;
    }
}

async function getNearestBusinessDay(date) {
    try {
        const client = await getClient();
        return withKrxRetry(
            () => client.get_nearest_business_day(date),
            { label: `getNearestBusinessDay(${date})` }
        );
    } catch (err) {
        console.error('⚠️ [krxClient] getNearestBusinessDay failed:', err);
        throw err;
    }
}

async function getNearestBusinessDayInAWeek(date, prev = true) {
    try {
        const client = await getClient();
        return withKrxRetry(
            () => client.get_nearest_business_day_in_a_week(date, prev),
            { label: `getNearestBusinessDayInAWeek(${date}, ${prev})` }
        );
    } catch (err) {
        console.error('⚠️ [krxClient] getNearestBusinessDayInAWeek failed:', err);
        throw err;
    }
}

async function runTriggerBatch(requestedMode = 'morning', options = {}) {
    try {
        const { logLevel = 'INFO' } = options;
        const { runBatch, getSnapshot } = await loadTrigger();
        const injectedFunctions = {};

        if (typeof getSnapshot === 'function') {
            const fetchSnapshotCached = createCachedSnapshotFetcher(getSnapshot);
            injectedFunctions.getSnapshotFn = async (targetDate) => fetchSnapshotCached(targetDate);

            injectedFunctions.getNearestBusinessDayFn = async (targetDate) => {
                const resolved = await findNearestUsableSnapshotDate(
                    targetDate,
                    fetchSnapshotCached,
                    { startOffsetDays: 0, maxBacktrackDays: 10 }
                );

                return resolved?.date || normalizeYyyymmdd(targetDate) || targetDate;
            };

            injectedFunctions.getPreviousSnapshotFn = async (tradeDate) => {
                const resolved = await findNearestUsableSnapshotDate(
                    tradeDate,
                    fetchSnapshotCached,
                    { startOffsetDays: 1, maxBacktrackDays: 10 }
                );

                if (resolved) {
                    if (resolved.skippedDays > 0) {
                        console.log(
                            `ℹ️ [krxClient] 전일 스냅샷 보정: ${resolved.skippedDays}일 건너뛰고 ${resolved.date} 사용`
                        );
                    }
                    return { rows: resolved.rows, prevDate: resolved.date };
                }

                const fallbackDate = shiftYyyymmdd(tradeDate, -1) || tradeDate;
                let rows = [];
                try {
                    rows = await fetchSnapshotCached(fallbackDate);
                } catch (_err) {
                    rows = [];
                }
                return { rows, prevDate: fallbackDate };
            };
        }

        const rawData = await withKrxRetry(
            () => runBatch(requestedMode, logLevel, null, injectedFunctions),
            { label: `runTriggerBatch(${requestedMode})` }
        );

        if (rawData?.metadata) {
            rawData.metadata.trigger_mode = requestedMode;
        }

        const stocks = [];
        for (const [triggerType, rows] of Object.entries(rawData || {})) {
            if (triggerType === 'metadata' || !Array.isArray(rows)) {
                continue;
            }
            rows.forEach((row) => {
                stocks.push({
                    code: row.code || row.ticker || '',
                    name: row.name || row['종목명'] || ''
                });
            });
        }

        return {
            stocks,
            raw_data: rawData,
            timestamp: rawData?.metadata?.run_time || new Date().toISOString()
        };
    } catch (err) {
        console.error('⚠️ [krxClient] runTriggerBatch failed:', err);
        throw err;
    }
}

module.exports = {
    getOhlcv,
    getIndexOhlcv,
    getInvestorVolume,
    getMarketSnapshot,
    getMarketCap,
    getTickerNames,
    getNearestBusinessDay,
    getNearestBusinessDayInAWeek,
    runTriggerBatch,
    __test: {
        normalizeYyyymmdd,
        shiftYyyymmdd,
        isUsableTriggerSnapshot,
        findNearestUsableSnapshotDate,
        createCachedSnapshotFetcher,
        isRetryableKrxError,
        withKrxRetry,
        normalizeDateValue,
        setCachedTrigger(moduleValue) {
            cachedTrigger = moduleValue;
        },
        resetCachedTrigger() {
            cachedTrigger = null;
        }
    }
};
