const WISEREPORT_ETF_DETAIL_URL = 'https://comp.wisereport.co.kr/ETF/ETF.aspx';
const DEFAULT_WISEREPORT_ETF_TIMEOUT_MS = 4_500;

function normalizeText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeCode(value) {
  const text = normalizeText(value);
  if (!text) return null;
  const match = text.match(/\d{6}/);
  return match?.[0] ?? text;
}

function normalizeNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const text = String(value ?? '').trim().replace(/[−–—]/g, '-');
  if (!text) return null;

  const parsed = Number(text.replace(/[\s,%₩$]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function getFetchImpl(fetchImpl) {
  if (typeof fetchImpl === 'function') return fetchImpl;
  if (typeof globalThis.fetch === 'function') return globalThis.fetch.bind(globalThis);
  throw new Error('fetch implementation unavailable');
}

async function withFetchTimeout(fetchImpl, url, init, timeoutMs) {
  if (!timeoutMs) return fetchImpl(url, init);

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

  try {
    return await fetchImpl(url, {
      ...init,
      signal: abortController.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function extractJsonVariable(html, variableName) {
  const text = String(html ?? '');
  const marker = `var ${variableName}`;
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) return null;

  const equalsIndex = text.indexOf('=', markerIndex + marker.length);
  if (equalsIndex < 0) return null;

  const firstBraceIndex = text.indexOf('{', equalsIndex + 1);
  if (firstBraceIndex < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = firstBraceIndex; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        const jsonText = text.slice(firstBraceIndex, index + 1);
        return JSON.parse(jsonText);
      }
    }
  }

  return null;
}

function normalizeConstituentRows(cuData) {
  const rows = Array.isArray(cuData?.grid_data) ? cuData.grid_data : [];
  return rows
    .map((row, index) => ({
      rank: index + 1,
      asOf: normalizeText(row?.TRD_DT),
      name: normalizeText(row?.STK_NM_KOR),
      shares: normalizeNumber(row?.AGMT_STK_CNT),
      weightPct: normalizeNumber(row?.ETF_WEIGHT),
    }))
    .filter((row) => row.name || row.weightPct !== null || row.shares !== null)
    .sort((left, right) => (right.weightPct ?? -Infinity) - (left.weightPct ?? -Infinity))
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

function normalizeVolumeRows(volumeChartData) {
  const rows = Array.isArray(volumeChartData?.grid_data) ? volumeChartData.grid_data : [];
  return rows
    .map((row) => ({
      asOf: normalizeText(row?.TRD_DT),
      avgTradingVolume: normalizeNumber(row?.AVG_TRD_QTY),
      avgTradingValue: normalizeNumber(row?.AVG_TRD_AMT),
    }))
    .filter((row) => row.asOf || row.avgTradingVolume !== null || row.avgTradingValue !== null);
}

function normalizeMarketNames(relativeChartData) {
  const names = Array.isArray(relativeChartData?.name) ? relativeChartData.name : [];
  const primary = names[0] && typeof names[0] === 'object' ? names[0] : {};
  return {
    productName: normalizeText(primary.CMP_NM),
    marketName: normalizeText(primary.MKT_NM),
  };
}

export function parseWiseReportEtfSnapshotHtml(html, code) {
  const productSummaryData = extractJsonVariable(html, 'product_summary_data') ?? {};
  const statusData = extractJsonVariable(html, 'status_data') ?? {};
  const constituentData = extractJsonVariable(html, 'CU_data') ?? {};
  const volumeChartData = extractJsonVariable(html, 'volume_chart_data') ?? {};
  const relativeChartData = extractJsonVariable(html, 'stock_price_relative_chart_data') ?? {};
  const rows = normalizeConstituentRows(constituentData);
  const top10 = rows.slice(0, 10);
  const volumeRows = normalizeVolumeRows(volumeChartData);
  const latestVolume = volumeRows.at(-1) ?? null;
  const marketNames = normalizeMarketNames(relativeChartData);
  const asOf = rows.find((row) => row.asOf)?.asOf ?? latestVolume?.asOf ?? null;

  return {
    schemaVersion: 'wisereport-etf-snapshot-v1',
    source: 'wisereport-etf',
    code: normalizeCode(code),
    asOf,
    product: {
      name: marketNames.productName,
      marketName: marketNames.marketName,
      baseIndexName: normalizeText(productSummaryData.BASE_IDX_NM_KOR),
      firstSettleDate: normalizeText(productSummaryData.FIRST_SETTLE_DT),
      listDate: normalizeText(productSummaryData.LIST_DT),
      fundType: normalizeText(productSummaryData.FUND_TYP),
      totalFeePct: normalizeNumber(productSummaryData.TOT_PAY),
      financialPeriod: normalizeText(productSummaryData.FIN_PRD),
      distributionBaseDate: normalizeText(productSummaryData.DIV_BASE_DT),
      liquidityProviders: normalizeText(productSummaryData.LP_NM_KOR),
      issuerName: normalizeText(productSummaryData.ISSUE_NM_KOR),
      issuerUrl: normalizeText(productSummaryData.URL),
    },
    marketStatus: {
      closePrice: normalizeNumber(statusData.CLS_PRC),
      priceChange: normalizeNumber(statusData.PRC_CHG),
      changePct: normalizeNumber(statusData.ADJ_CHG),
      yearHigh: normalizeNumber(statusData.YR_HIGH),
      yearLow: normalizeNumber(statusData.YR_LOW),
      listedShares: normalizeNumber(statusData.LIST_STK_CNT),
      tradingVolume: normalizeNumber(statusData.trD_QTY),
      tradingValue: normalizeNumber(statusData.trD_AMT),
      marketCap: normalizeNumber(statusData.MKT_VAL),
      beta: normalizeNumber(statusData.YR_BETA),
      avgTradingVolume20: normalizeNumber(statusData.AVG_TRD_QTY20),
      avgTradingValue20: normalizeNumber(statusData.AVG_TRD_AMT20),
      foreignRatioPct: normalizeNumber(statusData.FRG_RT),
      returns: {
        oneMonthPct: normalizeNumber(statusData.ERN1),
        threeMonthPct: normalizeNumber(statusData.ERN3),
        sixMonthPct: normalizeNumber(statusData.ERN6),
        twelveMonthPct: normalizeNumber(statusData.ERN12),
      },
    },
    constituents: {
      asOf: rows.find((row) => row.asOf)?.asOf ?? null,
      totalCount: rows.length,
      top10WeightPct: top10.reduce((sum, row) => sum + (row.weightPct ?? 0), 0),
      top10,
      rows,
    },
    liquidity: {
      latestAsOf: latestVolume?.asOf ?? null,
      avgTradingVolume: latestVolume?.avgTradingVolume ?? null,
      avgTradingValue: latestVolume?.avgTradingValue ?? null,
      monthlyRows: volumeRows,
    },
  };
}

export async function fetchWiseReportEtfSnapshot(code, options = {}) {
  const normalizedCode = normalizeCode(code);
  if (!normalizedCode) return null;

  const fetchImpl = getFetchImpl(options.fetchImpl);
  const timeoutMs = options.timeoutMs === null || options.timeoutMs === false
    ? null
    : Number.isFinite(Number(options.timeoutMs)) && Number(options.timeoutMs) > 0
      ? Number(options.timeoutMs)
      : DEFAULT_WISEREPORT_ETF_TIMEOUT_MS;
  const url = `${WISEREPORT_ETF_DETAIL_URL}?cmp_cd=${encodeURIComponent(normalizedCode)}`;
  const response = await withFetchTimeout(fetchImpl, url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'User-Agent': 'Mozilla/5.0',
      Referer: 'https://comp.wisereport.co.kr/ETF/lookup.aspx',
    },
  }, timeoutMs);

  if (!response.ok) {
    throw new Error(`WiseReport ETF snapshot fetch failed: ${response.status}`);
  }

  const html = await response.text();
  const snapshot = parseWiseReportEtfSnapshotHtml(html, normalizedCode);
  if (!snapshot.product.baseIndexName && snapshot.constituents.totalCount === 0 && !snapshot.marketStatus.closePrice) {
    return null;
  }

  return snapshot;
}
