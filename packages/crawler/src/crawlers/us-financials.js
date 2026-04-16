/**
 * us-financials.js — 미국주식 재무제표 조회
 *
 * - 재무제표 (B/S, I/S, CF): FMP `/stable/` (1차) + Polygon `/vX/reference/financials` (2차)
 * - 재무비율·핵심 지표: FMP `/stable/key-metrics`, `/stable/ratios`
 * - 분기(TTM)/연간 모두 지원
 * - In-memory 캐싱 활용
 */

import { polygonFetch, fmpFetch, finnhubFetch } from './api-clients.js';
import { crawlWiseReportGlobal } from './wisereport-global.js';

const WISE_INCOME_ALIASES = {
  revenues: ['매출액(수익)', '매출액<당기>', '매출액', 'revenue', 'revenues', 'sales'],
  operating_income: ['영업이익<당기>', '영업이익', 'operatingincome', 'operatingprofit'],
  net_income: ['당기순이익<당기>', '당기순이익', '순이익', 'netincome'],
};

const WISE_BALANCE_ALIASES = {
  total_assets: ['자산총계<당기>', '자산총계', '총자산', 'assets'],
  total_liabilities: ['부채총계<당기>', '부채총계', '총부채', 'liabilities'],
  total_equity: ['자본총계<당기>', '자본총계', '자기자본', 'equity'],
};

const WISE_CASHFLOW_ALIASES = {
  operating_cash_flow: ['영업활동현금흐름<당기>', '영업활동현금흐름', '영업현금흐름', '영업활동으로인한현금흐름', 'operatingcashflow'],
};

const WISE_RATIO_ALIASES = {
  roe: ['roe'],
  roa: ['roa'],
  grossProfitMargin: ['매출총이익률', 'grossprofitmargin'],
  operatingProfitMargin: ['영업이익률', 'operatingprofitmargin'],
  netProfitMargin: ['순이익률', 'netprofitmargin'],
};

const WISE_SNAP_ALIASES = {
  marketCap: ['시가총액', 'marketcap'],
};

const STATEMENT_PERIOD_FIELD_ALIASES = Object.freeze({
  fiscalYear: ['fiscal_year', 'calendarYear', 'calendar_year', 'year'],
  fiscalPeriod: ['fiscal_period', 'period', 'quarter'],
  startDate: ['start_date'],
  endDate: ['end_date', 'date', 'periodOfReportDate', 'period_of_report_date'],
});

const STATEMENT_FIELD_ALIASES = Object.freeze({
  incomeStatements: {
    revenues: ['revenue', 'sales', 'salesRevenueNet', 'totalRevenue'],
    operating_income: ['operatingIncome', 'operating_income_loss', 'operatingIncomeLoss'],
    net_income: ['netIncome', 'net_income_loss', 'netIncomeLoss'],
  },
  balanceSheets: {
    total_assets: ['totalAssets', 'assets'],
    total_liabilities: ['totalLiabilities', 'liabilities'],
    total_equity: [
      'totalEquity',
      'equity',
      'stockholdersEquity',
      'totalStockholdersEquity',
      'stockholdersEquityIncludingNoncontrollingInterest',
      'totalEquityGrossMinorityInterest',
    ],
  },
  cashFlows: {
    operating_cash_flow: [
      'operatingCashFlow',
      'netCashProvidedByOperatingActivities',
      'netCashUsedProvidedByOperatingActivities',
      'cashFlowFromOperations',
    ],
  },
});

const KEY_METRIC_FIELD_ALIASES = Object.freeze({
  marketCap: ['market_cap', 'marketCapitalization'],
  roe: ['returnOnEquity', 'returnOnEquityTTM'],
  roa: ['returnOnAssets', 'returnOnAssetsTTM'],
  peRatio: ['pe', 'peTTM', 'priceToEarningsRatio'],
  pbRatio: ['pb', 'priceToBookRatio'],
  dividendYield: ['dividend_yield', 'currentDividendYieldTTM'],
  debtToEquity: ['debtToEquityRatio', 'debtToEquityTTM', 'totalDebtToEquity'],
});

const RATIO_FIELD_ALIASES = Object.freeze({
  currentRatio: ['current_ratio'],
  quickRatio: ['quick_ratio'],
  grossProfitMargin: ['gross_margin', 'grossMargin'],
  operatingProfitMargin: ['operating_margin', 'operatingMargin', 'operatingMarginRatio'],
  netProfitMargin: ['net_margin', 'netMargin', 'netMarginRatio'],
  earningsYield: ['earningYield'],
  roe: ['returnOnEquity', 'returnOnEquityTTM'],
  roa: ['returnOnAssets', 'returnOnAssetsTTM'],
});

const FINANCIAL_VALUE_EQUIVALENTS = Object.freeze(buildFinancialValueAliasLookup([
  STATEMENT_FIELD_ALIASES.incomeStatements,
  STATEMENT_FIELD_ALIASES.balanceSheets,
  STATEMENT_FIELD_ALIASES.cashFlows,
  KEY_METRIC_FIELD_ALIASES,
  RATIO_FIELD_ALIASES,
]));

function findConceptValue(items = [], concepts = []) {
  for (const concept of concepts) {
    const match = items.find(item => item?.concept === concept && item?.value != null);
    if (match) return match.value;
  }
  return null;
}

function buildFinancialValueAliasLookup(aliasGroups = []) {
  const lookup = {};
  for (const group of aliasGroups) {
    for (const [canonicalKey, aliases] of Object.entries(group ?? {})) {
      const allKeys = [...new Set([canonicalKey, ...(Array.isArray(aliases) ? aliases : [])])];
      for (const key of allKeys) {
        lookup[key] = [...new Set([...(lookup[key] ?? []), ...allKeys.filter(candidate => candidate !== key)])];
      }
    }
  }
  return lookup;
}

function pickFirstFinancialValue(target = {}, keys = []) {
  for (const key of keys) {
    if (!isMissingFinancialValue(target?.[key])) {
      return target[key];
    }
  }
  return null;
}

function normalizeFiscalYear(value) {
  if (isMissingFinancialValue(value)) {
    return null;
  }
  if (Number.isFinite(value) && value > 0) {
    return value;
  }

  const normalized = String(value).trim();
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }

  return parseWiseReportFiscalYear(normalized);
}

function normalizeFiscalPeriod(value, timeframe = 'annual', fiscalYear = null) {
  if (Number.isFinite(value) && value > 0) {
    return `Q${value}`;
  }

  const raw = String(value ?? '').trim().toUpperCase();
  if (!raw) {
    return timeframe === 'annual' && fiscalYear ? 'FY' : null;
  }
  if (raw === 'ANNUAL') return 'FY';
  if (/^Q[1-4]$/.test(raw)) return raw;
  if (/^[1-4]$/.test(raw)) return `Q${raw}`;
  if (raw === 'FY' || raw === 'TTM') return raw;
  return raw;
}

function normalizeDateValue(value) {
  if (isMissingFinancialValue(value)) {
    return null;
  }
  const next = String(value).trim();
  return next || null;
}

function normalizeStatementRow(row = {}, group, opts = {}) {
  const next = { ...(row ?? {}) };
  const timeframe = opts.timeframe ?? 'annual';
  const source = opts.source ?? null;
  const fieldAliases = STATEMENT_FIELD_ALIASES[group] ?? {};

  const endDate = normalizeDateValue(pickFirstFinancialValue(next, ['endDate', ...STATEMENT_PERIOD_FIELD_ALIASES.endDate]));
  const fiscalYear = normalizeFiscalYear(
    pickFirstFinancialValue(next, ['fiscalYear', ...STATEMENT_PERIOD_FIELD_ALIASES.fiscalYear])
    ?? endDate
  );
  const fiscalPeriod = normalizeFiscalPeriod(
    pickFirstFinancialValue(next, ['fiscalPeriod', ...STATEMENT_PERIOD_FIELD_ALIASES.fiscalPeriod]),
    timeframe,
    fiscalYear,
  );
  const startDate = normalizeDateValue(pickFirstFinancialValue(next, ['startDate', ...STATEMENT_PERIOD_FIELD_ALIASES.startDate]));

  if (isMissingFinancialValue(next.fiscalYear) && Number.isFinite(fiscalYear)) next.fiscalYear = fiscalYear;
  if (isMissingFinancialValue(next.fiscalPeriod) && !isMissingFinancialValue(fiscalPeriod)) next.fiscalPeriod = fiscalPeriod;
  if (isMissingFinancialValue(next.startDate) && startDate) next.startDate = startDate;
  if (isMissingFinancialValue(next.endDate) && endDate) next.endDate = endDate;
  if (isMissingFinancialValue(next.source) && source) next.source = source;

  for (const [canonicalKey, aliases] of Object.entries(fieldAliases)) {
    const value = pickFirstFinancialValue(next, [canonicalKey, ...aliases]);
    if (isMissingFinancialValue(next[canonicalKey]) && !isMissingFinancialValue(value)) {
      next[canonicalKey] = value;
    }
  }

  return next;
}

function normalizeStatementRows(rows = [], group, opts = {}) {
  return Array.isArray(rows)
    ? rows.map(row => normalizeStatementRow(row, group, opts))
    : [];
}

function normalizeProviderStatements(statements = null, opts = {}) {
  if (!statements || typeof statements !== 'object') {
    return statements;
  }

  const source = statements.source ?? opts.source ?? null;
  const timeframe = statements.timeframe ?? opts.timeframe ?? 'annual';

  return {
    ...statements,
    source,
    incomeStatements: normalizeStatementRows(statements.incomeStatements, 'incomeStatements', { timeframe, source }),
    balanceSheets: normalizeStatementRows(statements.balanceSheets, 'balanceSheets', { timeframe, source }),
    cashFlows: normalizeStatementRows(statements.cashFlows, 'cashFlows', { timeframe, source }),
  };
}

function normalizeFinancialObjectShape(value = null, aliases = {}, opts = {}) {
  if (!value || typeof value !== 'object') {
    return value;
  }

  const next = { ...value };
  if (isMissingFinancialValue(next.source) && opts.source) {
    next.source = opts.source;
  }

  for (const [canonicalKey, fieldAliases] of Object.entries(aliases)) {
    const fieldValue = pickFirstFinancialValue(next, [canonicalKey, ...fieldAliases]);
    if (isMissingFinancialValue(next[canonicalKey]) && !isMissingFinancialValue(fieldValue)) {
      next[canonicalKey] = fieldValue;
    }
  }

  return compactFinancialObject(next);
}

function getEquivalentFinancialValue(target = {}, key) {
  return pickFirstFinancialValue(target, [key, ...(FINANCIAL_VALUE_EQUIVALENTS[key] ?? [])]);
}

function buildFinnhubStatementBase(entry, timeframe) {
  return {
    fiscalYear: entry?.year ?? null,
    fiscalPeriod: timeframe === 'quarterly' ? (entry?.quarter ? `Q${entry.quarter}` : null) : 'FY',
    startDate: entry?.startDate ?? null,
    endDate: entry?.endDate ?? null,
    source: 'finnhub-financials-reported',
  };
}

function buildFinnhubStatementEntry(entry, timeframe, group) {
  const bs = Array.isArray(entry?.report?.bs) ? entry.report.bs : [];
  const ic = Array.isArray(entry?.report?.ic) ? entry.report.ic : [];
  const cf = Array.isArray(entry?.report?.cf) ? entry.report.cf : [];
  const base = buildFinnhubStatementBase(entry, timeframe);

  if (group === 'income') {
    return {
      ...base,
      revenues: findConceptValue(ic, [
        'us-gaap_Revenues',
        'us-gaap_RevenueFromContractWithCustomerExcludingAssessedTax',
        'us-gaap_SalesRevenueNet',
      ]),
      net_income: findConceptValue(ic, ['us-gaap_NetIncomeLoss']),
      operating_income: findConceptValue(ic, ['us-gaap_OperatingIncomeLoss']),
    };
  }

  if (group === 'balance') {
    return {
      ...base,
      total_assets: findConceptValue(bs, ['us-gaap_Assets']),
      total_liabilities: findConceptValue(bs, ['us-gaap_Liabilities']),
      total_equity: findConceptValue(bs, [
        'us-gaap_StockholdersEquity',
        'us-gaap_StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest',
      ]),
    };
  }

  return {
    ...base,
    operating_cash_flow: findConceptValue(cf, ['us-gaap_NetCashProvidedByUsedInOperatingActivities']),
  };
}

export async function getFinancialStatementsFinnhub(ticker, opts = {}) {
  const { timeframe = 'annual', limit = 4 } = opts;
  const data = await finnhubFetch(
    `/stock/financials-reported?symbol=${encodeURIComponent(ticker)}`,
    { cacheTTL: 15 * 60 * 1000 }
  );
  const rows = Array.isArray(data?.data) ? data.data : [];
  if (!rows.length) return null;

  const filtered = rows.filter(entry => (
    timeframe === 'quarterly' ? Number(entry?.quarter) > 0 : Number(entry?.quarter) === 0
  )).slice(0, limit);
  if (!filtered.length) return null;

  const incomeStatements = filtered
    .map(entry => buildFinnhubStatementEntry(entry, timeframe, 'income'))
    .filter(hasStatementFinancialValues);
  const balanceSheets = filtered
    .map(entry => buildFinnhubStatementEntry(entry, timeframe, 'balance'))
    .filter(hasStatementFinancialValues);
  const cashFlows = filtered
    .map(entry => buildFinnhubStatementEntry(entry, timeframe, 'cashflow'))
    .filter(hasStatementFinancialValues);

  return normalizeProviderStatements({
    ticker,
    timeframe,
    incomeStatements,
    balanceSheets,
    cashFlows,
    source: 'finnhub-financials-reported',
  });
}

function deriveFinnhubKeyMetrics(metric = null) {
  if (!metric || typeof metric !== 'object') return null;
  return compactFinancialObject({
    marketCap: metric.marketCapitalization ?? null,
    peRatio: metric.peTTM ?? metric.peBasicExclExtraTTM ?? metric.peAnnual ?? null,
    pbRatio: metric.pb ?? metric.pbQuarterly ?? metric.pbAnnual ?? null,
    dividendYield: metric.currentDividendYieldTTM ?? metric.dividendYieldIndicatedAnnual ?? null,
    roe: metric.roeTTM ?? metric.roeRfy ?? null,
    roa: metric.roaTTM ?? metric.roaRfy ?? null,
    debtToEquity: metric['totalDebt/totalEquityQuarterly'] ?? metric['totalDebt/totalEquityAnnual'] ?? null,
    source: 'finnhub-metric',
  });
}

function deriveFinnhubRatios(metric = null) {
  if (!metric || typeof metric !== 'object') return null;
  const pe = metric.peTTM ?? metric.peBasicExclExtraTTM ?? null;
  return compactFinancialObject({
    currentRatio: metric.currentRatioQuarterly ?? metric.currentRatioAnnual ?? null,
    quickRatio: metric.quickRatioQuarterly ?? metric.quickRatioAnnual ?? null,
    grossProfitMargin: metric.grossMarginTTM ?? metric.grossMarginAnnual ?? null,
    operatingProfitMargin: metric.operatingMarginTTM ?? metric.operatingMarginAnnual ?? null,
    netProfitMargin: metric.netProfitMarginTTM ?? metric.netProfitMarginAnnual ?? null,
    earningsYield: Number.isFinite(pe) && pe !== 0 ? 1 / pe : null,
    source: 'finnhub-metric',
  });
}

async function getFinnhubMetrics(ticker) {
  const data = await finnhubFetch(
    `/stock/metric?symbol=${encodeURIComponent(ticker)}&metric=all`,
    { cacheTTL: 30 * 60 * 1000 }
  );
  return data?.metric ?? null;
}

// ── 재무제표 (FMP stable — 1차) ────────────────────────

/**
 * FMP stable 재무제표 조회 (무료 티어 호환)
 * @param {string} ticker - 종목 심볼 (예: AAPL)
 * @param {Object} [opts]
 * @param {'annual'|'quarterly'} [opts.timeframe='annual'] - 연간/분기
 * @returns {Promise<Object|null>}
 */
export async function getFinancialStatementsFMP(ticker, opts = {}) {
  const { timeframe = 'annual' } = opts;
  const period = timeframe === 'quarterly' ? 'quarter' : 'annual';

  const [incomeData, bsData, cfData] = await Promise.all([
    fmpFetch(`/stable/income-statement?symbol=${encodeURIComponent(ticker)}&period=${period}`, { cacheTTL: 15 * 60 * 1000 }).catch(() => null),
    fmpFetch(`/stable/balance-sheet-statement?symbol=${encodeURIComponent(ticker)}&period=${period}`, { cacheTTL: 15 * 60 * 1000 }).catch(() => null),
    fmpFetch(`/stable/cash-flow-statement?symbol=${encodeURIComponent(ticker)}&period=${period}`, { cacheTTL: 15 * 60 * 1000 }).catch(() => null),
  ]);

  return normalizeProviderStatements({
    ticker,
    timeframe,
    incomeStatements: Array.isArray(incomeData) ? incomeData : [],
    balanceSheets: Array.isArray(bsData) ? bsData : [],
    cashFlows: Array.isArray(cfData) ? cfData : [],
    source: 'fmp-stable',
  });
}

// ── 재무제표 (Polygon — 2차) ────────────────────────────

/**
 * Polygon 재무제표 조회 (FMP 실패 시 대안)
 */
export async function getFinancialStatementsPolygon(ticker, opts = {}) {
  const { timeframe = 'annual', limit = 4 } = opts;

  const data = await polygonFetch(
    `/vX/reference/financials?ticker=${encodeURIComponent(ticker)}&timeframe=${timeframe}&limit=${limit}&order=desc&sort=period_of_report_date`,
    { cacheTTL: 15 * 60 * 1000 }
  );

  if (!data?.results?.length) return null;

  const results = data.results;
  const balanceSheets = [];
  const incomeStatements = [];
  const cashFlows = [];

  for (const entry of results) {
    const period = {
      fiscalYear: entry.fiscal_year,
      fiscalPeriod: entry.fiscal_period,
      startDate: entry.start_date,
      endDate: entry.end_date,
    };
    if (entry.financials?.balance_sheet) {
      balanceSheets.push({ ...period, ...flattenFinancialData(entry.financials.balance_sheet) });
    }
    if (entry.financials?.income_statement) {
      incomeStatements.push({ ...period, ...flattenFinancialData(entry.financials.income_statement) });
    }
    if (entry.financials?.cash_flow_statement) {
      cashFlows.push({ ...period, ...flattenFinancialData(entry.financials.cash_flow_statement) });
    }
  }

  return normalizeProviderStatements({ ticker, timeframe, balanceSheets, incomeStatements, cashFlows, source: 'polygon' });
}

/**
 * 통합 재무제표 조회 — FMP 1차, Polygon 2차
 */
export async function getFinancialStatements(ticker, opts = {}) {
  const fmp = await getFinancialStatementsFMP(ticker, opts);
  if (fmp.balanceSheets.length > 0 || fmp.incomeStatements.length > 0) return fmp;

  const polygon = await getFinancialStatementsPolygon(ticker, opts);
  if (polygon?.balanceSheets?.length || polygon?.incomeStatements?.length) return polygon;

  return getFinancialStatementsFinnhub(ticker, opts);
}

/**
 * Polygon 재무데이터를 flat 객체로 변환
 * { revenues: { value: 100, unit: 'USD' } } → { revenues: 100 }
 */
function flattenFinancialData(financialSection) {
  const flat = {};
  for (const [key, detail] of Object.entries(financialSection)) {
    if (detail && typeof detail === 'object' && 'value' in detail) {
      flat[key] = detail.value;
      if (detail.unit) flat[`${key}_unit`] = detail.unit;
    }
  }
  return flat;
}

// ── 재무 비율 (FMP) ──────────────────────────────────

/**
 * 핵심 재무 지표 조회 (FMP key-metrics)
 * @param {string} ticker - 종목 심볼
 * @param {'annual'|'quarter'} [period='annual']
 * @returns {Promise<Array|null>}
 */
export async function getKeyMetrics(ticker, period = 'annual') {
  const data = await fmpFetch(
    `/stable/key-metrics?symbol=${encodeURIComponent(ticker)}&period=${period}`,
    { cacheTTL: 30 * 60 * 1000 }
  );
  if (Array.isArray(data) && data.length) return data;

  const finnhubMetric = await getFinnhubMetrics(ticker).catch(() => null);
  const derived = deriveFinnhubKeyMetrics(finnhubMetric);
  return derived ? [derived] : null;
}

/**
 * 재무 비율 조회 (FMP ratios)
 * @param {string} ticker - 종목 심볼
 * @param {'annual'|'quarter'} [period='annual']
 * @returns {Promise<Array|null>}
 */
export async function getFinancialRatios(ticker, period = 'annual') {
  const data = await fmpFetch(
    `/stable/ratios?symbol=${encodeURIComponent(ticker)}&period=${period}`,
    { cacheTTL: 30 * 60 * 1000 }
  );
  if (Array.isArray(data) && data.length) return data;

  const finnhubMetric = await getFinnhubMetrics(ticker).catch(() => null);
  const derived = deriveFinnhubRatios(finnhubMetric);
  return derived ? [derived] : null;
}

// ── 통합 재무 데이터 ──────────────────────────────────

/**
 * 종목의 통합 재무 데이터 조회
 * 재무제표 + 핵심 지표 + 재무 비율을 모두 가져와 통합 반환
 * 각 API 실패 시 graceful degradation
 *
 * @param {string} ticker - 종목 심볼
 * @param {Object} [opts]
 * @param {'annual'|'quarterly'} [opts.timeframe='annual']
 * @returns {Promise<Object>} 통합 재무 데이터
 */
export async function getUSFinancials(ticker, opts = {}) {
  const { timeframe = 'annual' } = opts;
  const fmpPeriod = timeframe === 'quarterly' ? 'quarter' : 'annual';

  const [statements, metrics, ratios] = await Promise.all([
    getFinancialStatements(ticker, { timeframe }).catch(() => null),
    getKeyMetrics(ticker, fmpPeriod).catch(() => null),
    getFinancialRatios(ticker, fmpPeriod).catch(() => null),
  ]);

  let result = {
    ticker,
    timeframe,
    statements: normalizeProviderStatements(statements),
    keyMetrics: normalizeFinancialObjectShape(
      Array.isArray(metrics) && metrics.length > 0 ? metrics[0] : null,
      KEY_METRIC_FIELD_ALIASES,
      { source: 'fmp-stable-key-metrics' },
    ),
    ratios: normalizeFinancialObjectShape(
      Array.isArray(ratios) && ratios.length > 0 ? ratios[0] : null,
      RATIO_FIELD_ALIASES,
      { source: 'fmp-stable-ratios' },
    ),
    wisereportMeta: null,
  };

  if (timeframe === 'annual' && needsWiseReportFinancialAugment(result)) {
    try {
      const wisereport = await resolveWiseReportFinancialData(ticker, opts);
      if (wisereport) {
        result = augmentUSFinancialsWithWiseReport(result, wisereport);
      } else {
        result.wisereportMeta = { attempted: true, source: 'wisereport-global', status: 'unavailable', reason: 'empty' };
      }
    } catch (error) {
      result.wisereportMeta = {
        attempted: true,
        source: 'wisereport-global',
        status: 'unavailable',
        reason: error?.message ?? 'wisereport-error',
      };
    }
  }

  return {
    ticker,
    timeframe,
    statements: result.statements,
    keyMetrics: result.keyMetrics,
    ratios: result.ratios,
    meta: result.wisereportMeta ? { wisereport: result.wisereportMeta } : undefined,
  };
}

function augmentUSFinancialsWithWiseReport(base = {}, wisereport = null) {
  const fallbackStatements = extractWiseReportStatements(wisereport);
  const fallbackKeyMetrics = extractWiseReportKeyMetrics(wisereport);
  const fallbackRatios = extractWiseReportRatios(wisereport);

  const nextStatements = mergeWiseReportStatements(base.statements, fallbackStatements);
  const nextKeyMetrics = mergeMissingObject(base.keyMetrics, fallbackKeyMetrics);
  const nextRatios = mergeMissingObject(base.ratios, fallbackRatios);

  const used = {
    statements: countNewStatementValues(base.statements, nextStatements),
    keyMetrics: countFilledObjectFields(base.keyMetrics, nextKeyMetrics),
    ratios: countFilledObjectFields(base.ratios, nextRatios),
  };
  const touched = used.statements + used.keyMetrics + used.ratios;

  return {
    ...base,
    statements: nextStatements,
    keyMetrics: nextKeyMetrics,
    ratios: nextRatios,
    wisereportMeta: {
      attempted: true,
      source: 'wisereport-global',
      status: touched > 0 ? 'ok' : 'no_change',
      used,
    },
  };
}

function needsWiseReportFinancialAugment(data = {}) {
  const latestIncome = data?.statements?.incomeStatements?.[0] ?? null;
  const latestBalance = data?.statements?.balanceSheets?.[0] ?? null;
  const latestCashFlow = data?.statements?.cashFlows?.[0] ?? null;

  return [
    getEquivalentFinancialValue(latestIncome, 'revenues'),
    getEquivalentFinancialValue(latestIncome, 'operating_income'),
    getEquivalentFinancialValue(latestIncome, 'net_income'),
    getEquivalentFinancialValue(latestBalance, 'total_assets'),
    getEquivalentFinancialValue(latestBalance, 'total_liabilities'),
    getEquivalentFinancialValue(latestBalance, 'total_equity'),
    getEquivalentFinancialValue(latestCashFlow, 'operating_cash_flow'),
    getEquivalentFinancialValue(data?.keyMetrics, 'marketCap') ?? getEquivalentFinancialValue(data?.ratios, 'marketCap'),
    getEquivalentFinancialValue(data?.keyMetrics, 'roe') ?? getEquivalentFinancialValue(data?.ratios, 'roe'),
    getEquivalentFinancialValue(data?.keyMetrics, 'roa') ?? getEquivalentFinancialValue(data?.ratios, 'roa'),
    getEquivalentFinancialValue(data?.ratios, 'grossProfitMargin'),
    getEquivalentFinancialValue(data?.ratios, 'operatingProfitMargin'),
    getEquivalentFinancialValue(data?.ratios, 'netProfitMargin'),
  ].some(isMissingFinancialValue);
}

async function resolveWiseReportFinancialData(ticker, opts = {}) {
  if (opts.wisereportRawData) {
    return opts.wisereportRawData;
  }
  if (typeof opts.wisereportFetcher === 'function') {
    return opts.wisereportFetcher(ticker, opts);
  }
  return crawlWiseReportGlobal(ticker, {
    ...opts,
    routes: ['company-snap', 'company-finance', 'company-invest'],
  });
}

function extractWiseReportStatements(wisereport = null) {
  const statementGroups = normalizeWiseReportStatementGroups({
    incomeStatements: extractWiseStatementRows(getWiseReportAuxiliaryData(wisereport, 'company-finance', 'fin-statement'), WISE_INCOME_ALIASES),
    balanceSheets: extractWiseStatementRows(getWiseReportAuxiliaryData(wisereport, 'company-finance', 'fin-balance-sheet'), WISE_BALANCE_ALIASES),
    cashFlows: extractWiseStatementRows(getWiseReportAuxiliaryData(wisereport, 'company-finance', 'fin-cash-flow'), WISE_CASHFLOW_ALIASES),
  });

  return {
    ticker: wisereport?.ticker ?? null,
    timeframe: 'annual',
    ...statementGroups,
    source: 'wisereport-global',
  };
}

function extractWiseReportKeyMetrics(wisereport = null) {
  const investRows = getWiseReportAuxiliaryData(wisereport, 'company-invest', 'invest-statement')?.BodyData ?? [];
  const snapRows = getWiseReportAuxiliaryData(wisereport, 'company-snap', 'snap-financial-summary')?.Data2 ?? [];

  return compactFinancialObject({
    marketCap: extractWiseLatestRowValue(snapRows, WISE_SNAP_ALIASES.marketCap, 'VAL'),
    roe: extractWiseLatestRowValue(investRows, WISE_RATIO_ALIASES.roe, 'DATA'),
    roa: extractWiseLatestRowValue(investRows, WISE_RATIO_ALIASES.roa, 'DATA'),
    source: 'wisereport-global',
  });
}

function extractWiseReportRatios(wisereport = null) {
  const investRows = getWiseReportAuxiliaryData(wisereport, 'company-invest', 'invest-statement')?.BodyData ?? [];
  const next = compactFinancialObject({
    grossProfitMargin: extractWiseLatestRowValue(investRows, WISE_RATIO_ALIASES.grossProfitMargin, 'DATA'),
    operatingProfitMargin: extractWiseLatestRowValue(investRows, WISE_RATIO_ALIASES.operatingProfitMargin, 'DATA'),
    netProfitMargin: extractWiseLatestRowValue(investRows, WISE_RATIO_ALIASES.netProfitMargin, 'DATA'),
    source: 'wisereport-global',
  }) ?? {};

  return compactFinancialObject(next);
}

function extractWiseStatementRows(payload, aliases) {
  const header = payload?.HeaderData;
  const rows = payload?.BodyData;
  if (!header || !Array.isArray(rows) || !rows.length) {
    return [];
  }

  const fieldRows = Object.fromEntries(
    Object.entries(aliases).map(([field, fieldAliases]) => [field, findWiseRowByAliases(rows, fieldAliases)]),
  );

  const series = [];
  for (let index = 12; index >= 1; index -= 1) {
    const periodLabel = header[`YYMM${index}`];
    const fiscalYear = parseWiseReportFiscalYear(periodLabel);
    const entry = {
      fiscalYear,
      fiscalPeriod: fiscalYear ? 'FY' : null,
      endDate: typeof periodLabel === 'string' ? periodLabel : null,
      source: 'wisereport-global',
    };

    let hasValue = false;
    for (const [field, row] of Object.entries(fieldRows)) {
      const value = toFinancialNumber(row?.[`DATA${index}`]);
      if (!isMissingFinancialValue(value)) {
        entry[field] = value;
        hasValue = true;
      }
    }

    if (hasValue) {
      series.push(entry);
    }
  }

  return series;
}

function normalizeWiseReportStatementGroups(groups = {}) {
  const entries = Object.entries(groups).map(([group, rows]) => [group, Array.isArray(rows) ? rows : []]);
  const nonEmptyEntries = entries.filter(([, rows]) => rows.length > 0);
  if (nonEmptyEntries.length < 2) {
    return Object.fromEntries(entries);
  }

  let commonPeriodKeys = null;
  for (const [, rows] of nonEmptyEntries) {
    const rowKeys = new Set(rows.map(getStatementPeriodKey).filter(Boolean));
    commonPeriodKeys = commonPeriodKeys == null
      ? rowKeys
      : new Set([...commonPeriodKeys].filter(key => rowKeys.has(key)));

    if (commonPeriodKeys.size === 0) {
      return Object.fromEntries(entries);
    }
  }

  return Object.fromEntries(
    entries.map(([group, rows]) => [group, rows.filter(row => commonPeriodKeys.has(getStatementPeriodKey(row)))]),
  );
}

function getStatementPeriodKey(row = {}) {
  const fiscalYear = normalizeFiscalYear(row?.fiscalYear ?? row?.fiscal_year ?? row?.calendarYear ?? row?.calendar_year ?? row?.endDate);
  const fiscalPeriod = normalizeFiscalPeriod(row?.fiscalPeriod ?? row?.fiscal_period ?? row?.period, 'annual', fiscalYear);
  return fiscalYear && fiscalPeriod ? `${fiscalYear}:${fiscalPeriod}` : null;
}

function mergeWiseReportStatements(baseStatements = null, fallbackStatements = null) {
  if (!fallbackStatements) {
    return baseStatements;
  }

  const normalizedBase = normalizeProviderStatements(baseStatements);
  const normalizedFallback = normalizeProviderStatements(fallbackStatements);

  return {
    ...(normalizedBase ?? {}),
    ticker: normalizedBase?.ticker ?? normalizedFallback.ticker ?? null,
    timeframe: normalizedBase?.timeframe ?? normalizedFallback.timeframe ?? 'annual',
    source: normalizedBase?.source ?? normalizedFallback.source ?? null,
    incomeStatements: mergeWiseReportSeries(normalizedBase?.incomeStatements, normalizedFallback.incomeStatements),
    balanceSheets: mergeWiseReportSeries(normalizedBase?.balanceSheets, normalizedFallback.balanceSheets),
    cashFlows: mergeWiseReportSeries(normalizedBase?.cashFlows, normalizedFallback.cashFlows),
  };
}

function mergeWiseReportSeries(baseRows = [], fallbackRows = []) {
  if (!Array.isArray(baseRows) || baseRows.length === 0) {
    return Array.isArray(fallbackRows) ? fallbackRows : [];
  }
  if (!Array.isArray(fallbackRows) || fallbackRows.length === 0) {
    return baseRows;
  }

  return baseRows.map(baseRow => {
    const basePeriodKey = getStatementPeriodKey(baseRow);
    if (!basePeriodKey) {
      return baseRow;
    }

    const matched = fallbackRows.find(candidate => getStatementPeriodKey(candidate) === basePeriodKey) ?? null;
    if (!matched) {
      return baseRow;
    }

    return mergeMissingObject(baseRow, matched);
  });
}

function mergeMissingObject(base = null, fallback = null) {
  if (!fallback) {
    return base;
  }

  const next = { ...(base ?? {}) };
  for (const [key, value] of Object.entries(fallback)) {
    if (hasEquivalentFinancialValue(next, key)) {
      continue;
    }
    if (isMissingFinancialValue(next[key]) && !isMissingFinancialValue(value)) {
      next[key] = value;
    }
  }
  return next;
}

function hasEquivalentFinancialValue(target = {}, key) {
  return !isMissingFinancialValue(getEquivalentFinancialValue(target, key));
}

function extractWiseLatestRowValue(rows, aliases, valuePrefix = 'DATA') {
  const row = findWiseRowByAliases(rows, aliases);
  if (!row) {
    return null;
  }

  for (let index = 12; index >= 1; index -= 1) {
    const value = toFinancialNumber(row[`${valuePrefix}${index}`]);
    if (!isMissingFinancialValue(value)) {
      return value;
    }
  }

  return null;
}

function findWiseRowByAliases(rows = [], aliases = []) {
  const normalizedAliases = aliases.map(normalizeWiseLabel).filter(Boolean);
  return rows.find(row => {
    const name = normalizeWiseLabel(row?.ACC_NM ?? row?.ITEM_NM ?? '');
    return normalizedAliases.some(alias => name.includes(alias));
  }) ?? null;
}

function normalizeWiseLabel(value) {
  return String(value ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^0-9a-z가-힣]/gi, '')
    .trim()
    .toLowerCase();
}

function getWiseReportAuxiliaryData(wisereport = null, routeId, itemId) {
  return wisereport?.pages?.[routeId]?.auxiliary?.find(item => item.id === itemId && item.ok)?.data ?? null;
}

function parseWiseReportFiscalYear(periodLabel) {
  const match = String(periodLabel ?? '').match(/(19|20)\d{2}/);
  return match ? Number(match[0]) : null;
}

function toFinancialNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isMissingFinancialValue(value) {
  return value === null || value === undefined || value === '' || Number.isNaN(value);
}

function hasStatementFinancialValues(row = {}) {
  return Object.entries(row).some(([key, value]) => (
    !['fiscalYear', 'fiscalPeriod', 'startDate', 'endDate', 'source'].includes(key)
    && !isMissingFinancialValue(value)
  ));
}

function compactFinancialObject(value = {}) {
  const entries = Object.entries(value).filter(([key, field]) => key === 'source' || !isMissingFinancialValue(field));
  const hasFinancialField = entries.some(([key]) => key !== 'source');
  return hasFinancialField ? Object.fromEntries(entries) : null;
}

function countFilledObjectFields(before = null, after = null) {
  return Object.keys(after ?? {}).filter(key => key !== 'source' && isMissingFinancialValue(before?.[key]) && !isMissingFinancialValue(after?.[key])).length;
}

function countNewStatementValues(before = null, after = null) {
  const groups = ['incomeStatements', 'balanceSheets', 'cashFlows'];
  let count = 0;
  for (const group of groups) {
    const nextRows = after?.[group] ?? [];
    const prevRows = before?.[group] ?? [];
    const prevByPeriod = new Map(prevRows.map(row => [getStatementPeriodKey(row) ?? Symbol('statement-period'), row]));
    nextRows.forEach((row, index) => {
      const prevRow = prevByPeriod.get(getStatementPeriodKey(row)) ?? prevRows[index] ?? null;
      for (const [key, value] of Object.entries(row ?? {})) {
        if (['fiscalYear', 'fiscalPeriod', 'startDate', 'endDate', 'source'].includes(key)) continue;
        if (isMissingFinancialValue(prevRow?.[key]) && !isMissingFinancialValue(value)) {
          count += 1;
        }
      }
    });
  }
  return count;
}

