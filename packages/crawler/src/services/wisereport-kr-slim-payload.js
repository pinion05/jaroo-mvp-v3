import { createRequire } from 'node:module';
import { buildDeepScanKrEvidencePacket } from './deepscan-kr-evidence.js';

const require = createRequire(import.meta.url);
const {
  WISEREPORT_KR_PAGES,
  WISEREPORT_KR_V12_PAGES,
} = require('../crawlers/wisereport-kr.cjs');

const WISEREPORT_KR_SLIM_DROP_KEYS = new Set([
  'ajaxEvidence',
  'bodyTextHead',
  'capture',
  'capturedResponses',
  'className',
  'headerRows',
  'legacyKey',
  'pagination',
  'popupTable',
  'provenance',
  'quality',
  'requestLog',
  'rowCount',
  'source',
  'sourceKey',
  'sourceType',
  'stages',
  'tableId',
]);

const WISEREPORT_KR_SLIM_COMPANY_KEYS = new Set([
  'code',
  'name',
]);

const WISEREPORT_KR_SLIM_V11_DROP_PAGE_KEYS = new Set([
  'annualOrQuarterly',
  'indicatorTabs',
  'ownershipTabs',
  'statementTabs',
]);

function normalizeSlimV11Text(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeSlimV11ObjectKey(key) {
  return normalizeSlimV11Text(key)
    .replace(/\s*(보기|닫기)\s*$/u, '')
    .trim();
}

function normalizeSlimV11LabelValue(value) {
  return normalizeSlimV11Text(value)
    .replace(/^(?:펼치기|감추기)\s*/u, '')
    .replace(/\s*(?:펼치기|감추기)$/u, '')
    .trim();
}

function isSlimV11SpacerColumn(key, rows) {
  if (!/^column_\d+$/u.test(String(key || ''))) {
    return false;
  }

  return rows.every((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      return true;
    }

    const value = row[key];
    if (value == null) {
      return true;
    }

    if (typeof value === 'string') {
      return value.trim() === '';
    }

    return false;
  });
}

function normalizeWiseReportKrAggregate(aggregate) {
  if (aggregate && typeof aggregate === 'object') {
    if (aggregate.pages && typeof aggregate.pages === 'object') {
      return { ...aggregate, pages: aggregate.pages };
    }

    if (aggregate.normalized && typeof aggregate.normalized === 'object') {
      return { ...aggregate, pages: aggregate.normalized };
    }
  }

  return {
    pages: aggregate && typeof aggregate === 'object' ? aggregate : {},
  };
}

function extractWiseReportKrNormalizedPage(pagePayload) {
  if (pagePayload && typeof pagePayload === 'object' && pagePayload.normalized && typeof pagePayload.normalized === 'object') {
    return pagePayload.normalized;
  }
  return pagePayload;
}

function isWiseReportKrTablePayload(value) {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && Array.isArray(value.rows)
    && (
      Array.isArray(value.headers)
      || 'tableId' in value
      || 'className' in value
      || 'headerRows' in value
      || 'rowCount' in value
      || (value.dataAvailability && typeof value.dataAvailability === 'object')
    );
}

function slimWiseReportKrValue(value, parentKey = null) {
  if (Array.isArray(value)) {
    return value
      .map((item) => slimWiseReportKrValue(item, parentKey))
      .filter((item) => item !== undefined);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  if (parentKey === 'company') {
    return Object.fromEntries(
      Object.entries(value).filter(([key, nested]) => WISEREPORT_KR_SLIM_COMPANY_KEYS.has(key) && nested != null),
    );
  }

  if (isWiseReportKrTablePayload(value)) {
    const tablePayload = {
      rows: slimWiseReportKrValue(value.rows, 'rows'),
    };
    const dataAvailability = value.dataAvailability && typeof value.dataAvailability === 'object'
      ? value.dataAvailability
      : null;

    if (value.status != null || dataAvailability?.status != null) {
      tablePayload.status = value.status ?? dataAvailability?.status;
    }
    if (value.note != null || dataAvailability?.note != null) {
      tablePayload.note = value.note ?? dataAvailability?.note;
    }

    return tablePayload;
  }

  const entries = Object.entries(value)
    .filter(([key, nested]) => !WISEREPORT_KR_SLIM_DROP_KEYS.has(key) && nested !== undefined)
    .map(([key, nested]) => [key, slimWiseReportKrValue(nested, key)]);

  return Object.fromEntries(entries);
}

function pickWiseReportKrCompany(rawAggregate, code, pageDefinitions = WISEREPORT_KR_PAGES) {
  const normalizedAggregate = normalizeWiseReportKrAggregate(rawAggregate);

  for (const page of pageDefinitions) {
    const company = extractWiseReportKrNormalizedPage(normalizedAggregate.pages?.[page.id])?.company;
    if (company && typeof company === 'object') {
      return {
        code: String(company.code || code || ''),
        name: company.name ?? null,
      };
    }
  }

  return {
    code: String(code || ''),
    name: null,
  };
}

function buildWiseReportKrSlimPayload(rawAggregate, code) {
  const normalizedAggregate = normalizeWiseReportKrAggregate(rawAggregate);
  const slimPages = Object.fromEntries(WISEREPORT_KR_PAGES.map((page) => {
    const pagePayload = normalizedAggregate.pages?.[page.id];
    const normalizedPage = extractWiseReportKrNormalizedPage(pagePayload);

    if (!normalizedPage || typeof normalizedPage !== 'object') {
      return [page.id, null];
    }

    const {
      company: _company,
      sourceType: _sourceType,
      sourceKey: _sourceKey,
      bodyTextHead: _bodyTextHead,
      ...businessPayload
    } = normalizedPage;

    return [page.id, slimWiseReportKrValue(businessPayload)];
  }));

  return {
    code: String(code || ''),
    company: pickWiseReportKrCompany(rawAggregate, code),
    pages: slimPages,
  };
}

function slimWiseReportKrValueV11(value, parentKey = null) {
  if (Array.isArray(value)) {
    return value
      .map((item) => slimWiseReportKrValueV11(item, parentKey))
      .filter((item) => item !== undefined);
  }

  if (typeof value === 'string') {
    return parentKey === '항목' ? normalizeSlimV11LabelValue(value) : value;
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  if (parentKey === 'company') {
    return Object.fromEntries(
      Object.entries(value).filter(([key, nested]) => WISEREPORT_KR_SLIM_COMPANY_KEYS.has(key) && nested != null),
    );
  }

  if (isWiseReportKrTablePayload(value)) {
    const slimRows = (value.rows || [])
      .map((row) => slimWiseReportKrValueV11(row, 'rows'))
      .filter((row) => row !== undefined);

    const removableSpacerKeys = new Set(
      [...new Set(slimRows.flatMap((row) => (row && typeof row === 'object' && !Array.isArray(row) ? Object.keys(row) : [])))]
        .filter((key) => isSlimV11SpacerColumn(key, slimRows)),
    );

    const normalizedRows = slimRows.map((row) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        return row;
      }

      return Object.fromEntries(
        Object.entries(row).filter(([key]) => !removableSpacerKeys.has(key)),
      );
    });

    const tablePayload = {
      rows: normalizedRows,
    };
    const dataAvailability = value.dataAvailability && typeof value.dataAvailability === 'object'
      ? value.dataAvailability
      : null;

    if (value.status != null || dataAvailability?.status != null) {
      tablePayload.status = value.status ?? dataAvailability?.status;
    }
    if (value.note != null || dataAvailability?.note != null) {
      tablePayload.note = value.note ?? dataAvailability?.note;
    }

    return tablePayload;
  }

  const entries = Object.entries(value)
    .filter(([key, nested]) => !WISEREPORT_KR_SLIM_DROP_KEYS.has(key) && nested !== undefined)
    .map(([key, nested]) => {
      const normalizedKey = normalizeSlimV11ObjectKey(key);
      return [normalizedKey, slimWiseReportKrValueV11(nested, normalizedKey)];
    })
    .filter(([key, nested]) => key && nested !== undefined);

  return Object.fromEntries(entries);
}

function buildWiseReportKrSlimPayloadV11(rawAggregate, code, pageDefinitions = WISEREPORT_KR_PAGES) {
  const normalizedAggregate = normalizeWiseReportKrAggregate(rawAggregate);
  const slimPages = Object.fromEntries(pageDefinitions.map((page) => {
    const pagePayload = normalizedAggregate.pages?.[page.id];
    const normalizedPage = extractWiseReportKrNormalizedPage(pagePayload);

    if (!normalizedPage || typeof normalizedPage !== 'object') {
      return [page.id, null];
    }

    const {
      company: _company,
      sourceType: _sourceType,
      sourceKey: _sourceKey,
      bodyTextHead: _bodyTextHead,
      ...businessPayload
    } = normalizedPage;

    const filteredPayload = Object.fromEntries(
      Object.entries(businessPayload).filter(([key]) => !WISEREPORT_KR_SLIM_V11_DROP_PAGE_KEYS.has(key)),
    );

    return [page.id, slimWiseReportKrValueV11(filteredPayload)];
  }));

  return {
    code: String(code || ''),
    company: pickWiseReportKrCompany(rawAggregate, code, pageDefinitions),
    pages: slimPages,
  };
}

function hasSlimV12Value(value) {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.some((item) => hasSlimV12Value(item));
  }
  if (typeof value === 'object') {
    return Object.values(value).some((nested) => hasSlimV12Value(nested));
  }
  return Boolean(value);
}

function makeSlimV12Source({ provider = 'wisereport', pageId = null, fieldPath = null, checkedSources = null } = {}) {
  return {
    provider,
    ...(pageId ? { pageId } : {}),
    ...(fieldPath ? { fieldPath } : {}),
    ...(Array.isArray(checkedSources) ? { checkedSources } : {}),
  };
}

function makeSlimV12Fact(value, {
  availability,
  provider = 'wisereport',
  pageId = null,
  fieldPath = null,
  checkedSources = null,
  reasonCode = null,
  message = null,
  asOf = null,
} = {}) {
  const resolvedAvailability = availability ?? (hasSlimV12Value(value) ? 'present' : 'missing');
  return {
    value: value ?? null,
    availability: resolvedAvailability,
    source: makeSlimV12Source({ provider, pageId, fieldPath, checkedSources }),
    ...(reasonCode ? { reasonCode } : {}),
    ...(message ? { message } : {}),
    ...(asOf ? { asOf } : {}),
  };
}

function makeSlimV12MissingFact({ provider = 'wisereport', pageId = null, fieldPath = null, checkedSources = [], reasonCode, message }) {
  return makeSlimV12Fact(null, {
    availability: 'missing',
    provider,
    pageId,
    fieldPath,
    checkedSources,
    reasonCode,
    message,
  });
}

function makeSlimV12NotApplicableFact({ provider = 'internal', checkedSources = [], reasonCode, message }) {
  return makeSlimV12Fact(null, {
    availability: 'not_applicable',
    provider,
    checkedSources,
    reasonCode,
    message,
  });
}

function inferWiseReportKrInstrumentKind(slimPayload) {
  const haystack = [
    slimPayload?.company?.name,
    slimPayload?.company?.market,
    slimPayload?.pages?.['company-overview']?.summary?.market,
    slimPayload?.pages?.['company-overview']?.profile,
  ]
    .map((value) => (typeof value === 'string' ? value : JSON.stringify(value ?? '')))
    .join(' ');

  if (/(^|[^A-Z])ETN([^A-Z]|$)|상장지수증권|파생결합증권/i.test(haystack)) {
    return 'etn';
  }
  if (/(^|[^A-Z])ETF([^A-Z]|$)|상장지수펀드|KODEX|TIGER|ACE|SOL|RISE|KBSTAR|HANARO|PLUS|히어로즈/i.test(haystack)) {
    return 'etf';
  }
  if (slimPayload?.company?.name || slimPayload?.code) {
    return 'stock';
  }
  return 'unknown';
}

function makeSlimV12FinancialFact(value, options, instrumentKind) {
  if (instrumentKind === 'etf' || instrumentKind === 'etn') {
    return makeSlimV12NotApplicableFact({
      reasonCode: 'corporate_financials_not_applicable',
      message: 'ETF/ETN에는 일반 상장사 재무제표 기반 수익성 지표를 적용하지 않습니다.',
      checkedSources: ['instrumentKind'],
    });
  }
  return makeSlimV12Fact(value, options);
}

function buildWiseReportKrSlimFactsV12(slimPayload, evidence, instrumentKind) {
  const noQuoteMessage = 'KR slim v1.2 builder는 WiseReport/FnGuide payload만으로 현재가를 보장하지 않습니다. DeepScan에서는 별도 quotes source를 결합해야 합니다.';
  const noFlowMessage = 'WiseReport/FnGuide KR 내부 source는 외국인 지분율·대차잔고·공매도·지분공시는 제공하지만 개인/외국인/기관 순매수 3분류 집계는 제공하지 않습니다.';
  const notCorporate = instrumentKind === 'etf' || instrumentKind === 'etn';
  const financialSource = { pageId: 'financial-analysis', checkedSources: ['wisereport.financial-analysis', 'wisereport.consensus'] };
  const indicatorSource = { pageId: 'investment-indicators', checkedSources: ['wisereport.investment-indicators'] };
  const ownershipCheckedSources = ['wisereport.shareholding', 'fnguide.snapshot', 'fnguide.shareanalysis', 'fnguide.foreign-ownership-chart'];

  const foreignOwnershipFact = evidence.ownershipSnapshot?.foreignOwnershipPct !== null && evidence.ownershipSnapshot?.foreignOwnershipPct !== undefined
    ? makeSlimV12Fact(evidence.ownershipSnapshot.foreignOwnershipPct, {
        provider: 'fnguide',
        pageId: evidence.ownershipSnapshot.foreignOwnershipHistory?.length ? 'fnguide-foreign-ownership-chart' : 'fnguide-snapshot',
        fieldPath: evidence.ownershipSnapshot.foreignOwnershipHistory?.length ? 'fnguide-foreign-ownership-chart.chartJson.CHART[].FRG_RT' : 'fnguide-snapshot.marketSnapshot.rows[외국인 지분율]',
        checkedSources: ownershipCheckedSources,
        asOf: evidence.ownershipSnapshot.foreignOwnershipAsOf,
      })
    : makeSlimV12MissingFact({
        provider: 'fnguide',
        pageId: 'fnguide-snapshot',
        checkedSources: ownershipCheckedSources,
        reasonCode: 'not_available_in_wisereport_fnguide_sources',
        message: 'WiseReport/FnGuide KR source에서 외국인 보유율 집계 필드를 찾지 못했습니다.',
      });
  const institutionalOwnershipFact = evidence.ownershipSnapshot?.institutionalOwnershipPct !== null && evidence.ownershipSnapshot?.institutionalOwnershipPct !== undefined
    ? makeSlimV12Fact(evidence.ownershipSnapshot.institutionalOwnershipPct, {
        provider: 'fnguide',
        pageId: 'fnguide-shareanalysis',
        fieldPath: 'fnguide-shareanalysis.institutionalOwnershipPct',
        checkedSources: ownershipCheckedSources,
      })
    : makeSlimV12MissingFact({
        provider: 'fnguide',
        pageId: 'fnguide-shareanalysis',
        checkedSources: ownershipCheckedSources,
        reasonCode: 'institutional_aggregate_not_available_in_wisereport_fnguide_sources',
        message: 'WiseReport/FnGuide KR source에는 기관 전체 보유율 aggregate가 없습니다. 운용사별 보유/국민연금/5% 이상 rows를 aggregate로 대체하지 않습니다.',
      });
  const assetManagerOwnershipPctSum = evidence.ownershipSnapshot?.assetManagerOwnershipPctSum ?? null;
  const assetManagerHoldings = evidence.ownershipSnapshot?.assetManagerHoldings ?? [];
  const assetManagerFactOptions = {
    provider: 'fnguide',
    pageId: 'fnguide-snapshot',
    checkedSources: ownershipCheckedSources,
    reasonCode: 'top_asset_managers_only',
    message: 'FnGuide Snapshot의 운용사별 보유 현황은 상위 운용사/공모펀드 보고서 기반 partial context이며 기관 전체 보유율 aggregate가 아닙니다.',
  };

  return {
    quote: {
      currentPrice: evidence.currentQuote
        ? makeSlimV12Fact(evidence.currentQuote.price, { provider: 'krx', fieldPath: 'quotes.currentPrice', asOf: evidence.currentQuote.asOf })
        : makeSlimV12MissingFact({ provider: 'krx', checkedSources: ['quotes'], reasonCode: 'quote_source_not_attached', message: noQuoteMessage }),
      currency: makeSlimV12Fact(evidence.currentQuote?.currency ?? 'KRW', { provider: evidence.currentQuote ? 'krx' : 'internal', fieldPath: 'quote.currency' }),
      asOf: evidence.currentQuote?.asOf
        ? makeSlimV12Fact(evidence.currentQuote.asOf, { provider: 'krx', fieldPath: 'quotes.asOf' })
        : makeSlimV12MissingFact({ provider: 'krx', checkedSources: ['quotes'], reasonCode: 'quote_asof_not_attached', message: noQuoteMessage }),
    },
    consensus: {
      targetPrice: makeSlimV12Fact(evidence.consensusSnapshot?.targetPrice ?? null, { provider: 'fnguide', pageId: 'opinion', fieldPath: 'opinion.analystOpinions[].적정주가', checkedSources: ['fnguide.opinion', 'wisereport.consensus'] }),
      previousTargetPrice: makeSlimV12Fact(evidence.consensusSnapshot?.previousTargetPrice ?? null, { provider: 'fnguide', pageId: 'opinion', fieldPath: 'opinion.analystOpinions[].적정주가(직전 적정주가)' }),
      targetRevisionPct: makeSlimV12Fact(evidence.consensusSnapshot?.revisionPct ?? null, { provider: 'fnguide', pageId: 'opinion', fieldPath: 'opinion.analystOpinions[].적정주가(증감율)' }),
      targetGapPct: evidence.consensusSnapshot?.targetGapPct !== null && evidence.consensusSnapshot?.targetGapPct !== undefined
        ? makeSlimV12Fact(evidence.consensusSnapshot.targetGapPct, { provider: 'internal', fieldPath: 'computed.targetGapPct', checkedSources: ['targetPrice', 'quotes.currentPrice'] })
        : makeSlimV12MissingFact({ provider: 'internal', checkedSources: ['targetPrice', 'quotes.currentPrice'], reasonCode: 'target_gap_requires_quote', message: '목표가 괴리율 계산에는 현재가 source가 필요합니다.' }),
      recommendation: makeSlimV12Fact(evidence.consensusSnapshot?.recommendationScore ?? evidence.consensusSnapshot?.recommendation ?? null, { provider: 'fnguide', pageId: 'opinion', fieldPath: 'opinion.analystOpinions[].투자의견' }),
      analystOpinionRows: makeSlimV12Fact(slimPayload.pages?.opinion?.analystOpinions?.rows ?? [], { provider: 'fnguide', pageId: 'opinion', fieldPath: 'opinion.analystOpinions.rows' }),
    },
    profitability: {
      revenueLatest: makeSlimV12FinancialFact(evidence.financialSnapshot?.revenueLatest ?? null, financialSource, instrumentKind),
      revenuePrev: makeSlimV12FinancialFact(evidence.financialSnapshot?.revenuePrev ?? null, financialSource, instrumentKind),
      revenueYoY: makeSlimV12FinancialFact(evidence.financialSnapshot?.revenueYoY ?? null, { ...financialSource, provider: 'internal', fieldPath: 'computed.revenueYoY' }, instrumentKind),
      operatingIncomeLatest: makeSlimV12FinancialFact(evidence.financialSnapshot?.operatingIncomeLatest ?? null, financialSource, instrumentKind),
      operatingIncomePrev: makeSlimV12FinancialFact(evidence.financialSnapshot?.operatingIncomePrev ?? null, financialSource, instrumentKind),
      operatingIncomeYoY: makeSlimV12FinancialFact(evidence.financialSnapshot?.operatingIncomeYoY ?? null, { ...financialSource, provider: 'internal', fieldPath: 'computed.operatingIncomeYoY' }, instrumentKind),
      netIncomeLatest: makeSlimV12FinancialFact(evidence.financialSnapshot?.netIncomeLatest ?? null, financialSource, instrumentKind),
      netIncomePrev: makeSlimV12FinancialFact(evidence.financialSnapshot?.netIncomePrev ?? null, financialSource, instrumentKind),
      netIncomeYoY: makeSlimV12FinancialFact(evidence.financialSnapshot?.netIncomeYoY ?? null, { ...financialSource, provider: 'internal', fieldPath: 'computed.netIncomeYoY' }, instrumentKind),
      operatingMarginLatest: makeSlimV12FinancialFact(evidence.financialSnapshot?.operatingMarginLatest ?? null, { ...indicatorSource, fieldPath: 'investment-indicators.metrics[].영업이익률' }, instrumentKind),
      netMarginLatest: makeSlimV12FinancialFact(evidence.financialSnapshot?.netMarginLatest ?? null, { ...indicatorSource, fieldPath: 'investment-indicators.metrics[].순이익률' }, instrumentKind),
      roe: makeSlimV12FinancialFact(evidence.valuationSnapshot?.roe ?? null, { ...indicatorSource, fieldPath: 'investment-indicators.metrics[].ROE' }, instrumentKind),
    },
    valuation: {
      per: makeSlimV12FinancialFact(evidence.valuationSnapshot?.per ?? null, { ...indicatorSource, fieldPath: 'investment-indicators.metrics[].PER' }, instrumentKind),
      pbr: makeSlimV12FinancialFact(evidence.valuationSnapshot?.pbr ?? null, { ...indicatorSource, fieldPath: 'investment-indicators.metrics[].PBR' }, instrumentKind),
      roe: makeSlimV12FinancialFact(evidence.valuationSnapshot?.roe ?? null, { ...indicatorSource, fieldPath: 'investment-indicators.metrics[].ROE' }, instrumentKind),
      evEbitda: makeSlimV12FinancialFact(evidence.valuationSnapshot?.evEbitda ?? null, { ...indicatorSource, fieldPath: 'investment-indicators.metrics[].EV/EBITDA' }, instrumentKind),
      forwardPer: makeSlimV12FinancialFact(evidence.valuationSnapshot?.per ?? null, { ...indicatorSource, fieldPath: 'investment-indicators.metrics[].PER' }, instrumentKind),
      forwardPbr: makeSlimV12FinancialFact(evidence.valuationSnapshot?.pbr ?? null, { ...indicatorSource, fieldPath: 'investment-indicators.metrics[].PBR' }, instrumentKind),
    },
    ownership: {
      majorHolderPct: makeSlimV12Fact(evidence.ownershipSnapshot?.majorHolderPct ?? null, { pageId: 'shareholding', fieldPath: 'shareholding.ownershipSummary.최대주주(보유지분)' }),
      majorHolderShares: makeSlimV12Fact(evidence.ownershipSnapshot?.majorHolderShares ?? null, { pageId: 'shareholding', fieldPath: 'shareholding.ownershipSummary.최대주주(보유지분)' }),
      freeFloatPct: makeSlimV12Fact(evidence.ownershipSnapshot?.freeFloatPct ?? null, { pageId: 'shareholding', fieldPath: 'shareholding.ownershipSummary.유동주식(유동주식비율)' }),
      freeFloatShares: makeSlimV12Fact(evidence.ownershipSnapshot?.freeFloatShares ?? null, { pageId: 'shareholding', fieldPath: 'shareholding.ownershipSummary.유동주식(유동주식수)' }),
      majorShareholders: makeSlimV12Fact(evidence.ownershipSnapshot?.majorShareholders ?? [], { pageId: 'shareholding', fieldPath: 'shareholding.majorShareholders.rows' }),
      knownInstitutionalMajorHolders: makeSlimV12Fact(evidence.ownershipSnapshot?.knownInstitutionalMajorHolders ?? [], { pageId: 'shareholding', fieldPath: 'shareholding.shareholderChanges.rows' }),
    },
    investorFlow: {
      foreignOwnershipPct: foreignOwnershipFact,
      institutionalOwnershipPct: institutionalOwnershipFact,
      foreignOwnershipHistory: makeSlimV12Fact(evidence.ownershipSnapshot?.foreignOwnershipHistory ?? [], { provider: 'fnguide', pageId: 'fnguide-foreign-ownership-chart', fieldPath: 'fnguide-foreign-ownership-chart.chartJson.CHART', checkedSources: ownershipCheckedSources }),
      assetManagerOwnershipPctSum: assetManagerOwnershipPctSum !== null
        ? makeSlimV12Fact(assetManagerOwnershipPctSum, { ...assetManagerFactOptions, availability: 'partial', fieldPath: 'fnguide-snapshot.assetManagerHoldings.rows[].상장주식수내비중' })
        : makeSlimV12MissingFact({ ...assetManagerFactOptions, fieldPath: 'fnguide-snapshot.assetManagerHoldings.rows[].상장주식수내비중' }),
      assetManagerHoldings: assetManagerHoldings.length > 0
        ? makeSlimV12Fact(assetManagerHoldings, { ...assetManagerFactOptions, availability: 'partial', fieldPath: 'fnguide-snapshot.assetManagerHoldings.rows' })
        : makeSlimV12MissingFact({ ...assetManagerFactOptions, fieldPath: 'fnguide-snapshot.assetManagerHoldings.rows' }),
      shareholderCategories: makeSlimV12Fact(evidence.ownershipSnapshot?.shareholderCategories ?? [], { provider: 'fnguide', pageId: 'fnguide-shareanalysis', fieldPath: 'fnguide-shareanalysis.shareholderCategories.rows', checkedSources: ownershipCheckedSources }),
      retailNetBuy: makeSlimV12MissingFact({ provider: 'fnguide', checkedSources: ownershipCheckedSources, reasonCode: 'investor_net_buy_not_provided_by_wisereport_fnguide', message: noFlowMessage }),
      foreignNetBuy: makeSlimV12MissingFact({ provider: 'fnguide', checkedSources: ownershipCheckedSources, reasonCode: 'investor_net_buy_not_provided_by_wisereport_fnguide', message: noFlowMessage }),
      institutionalNetBuy: makeSlimV12MissingFact({ provider: 'fnguide', checkedSources: ownershipCheckedSources, reasonCode: 'investor_net_buy_not_provided_by_wisereport_fnguide', message: noFlowMessage }),
      flowWindow: makeSlimV12MissingFact({ provider: 'fnguide', checkedSources: ownershipCheckedSources, reasonCode: 'investor_net_buy_not_provided_by_wisereport_fnguide', message: noFlowMessage }),
      flowRows: makeSlimV12MissingFact({ provider: 'fnguide', checkedSources: ownershipCheckedSources, reasonCode: 'investor_net_buy_not_provided_by_wisereport_fnguide', message: noFlowMessage }),
    },
    reports: {
      totalCount: makeSlimV12Fact(evidence.reportSignals?.recentReportCount ?? null, { pageId: 'recent-reports', fieldPath: 'recent-reports.recentReports.rows' }),
      recent30dCount: makeSlimV12Fact(evidence.reportSignals?.recent30dReportCount ?? null, { provider: 'internal', pageId: 'recent-reports', fieldPath: 'computed.recent30dReportCount', checkedSources: ['recent-reports.recentReports.rows', 'quotes.asOf'] }),
      latestReportDate: makeSlimV12Fact(evidence.timestamps?.reportAsOf ?? null, { pageId: 'recent-reports', fieldPath: 'recent-reports.recentReports.rows[0].일자' }),
      recentItems: makeSlimV12Fact(slimPayload.pages?.['recent-reports']?.recentReports?.rows ?? [], { pageId: 'recent-reports', fieldPath: 'recent-reports.recentReports.rows' }),
    },
    styleFactors: {
      companyName: makeSlimV12Fact(evidence.styleAnalysisSnapshot?.companyName ?? null, { provider: 'fnguide', pageId: 'style-analysis', fieldPath: 'style-analysis.factorScores.CHART_H[0].NAME' }),
      peerName: makeSlimV12Fact(evidence.styleAnalysisSnapshot?.peerName ?? null, { provider: 'fnguide', pageId: 'style-analysis', fieldPath: 'style-analysis.factorScores.CHART_H[1].NAME' }),
      factors: makeSlimV12Fact(evidence.styleAnalysisSnapshot?.factorScores ?? [], { provider: 'fnguide', pageId: 'style-analysis', fieldPath: 'style-analysis.factorScores.CHART_D' }),
    },
    sourceLimitations: [
      ...(Array.isArray(evidence.sourceLimitations) ? evidence.sourceLimitations.map((limitation) => ({
        factPath: limitation.fact,
        reasonCode: limitation.reasonCode,
        checkedSources: /ownership/i.test(String(limitation.fact || '')) ? ownershipCheckedSources : ['wisereport.shareholding'],
        message: limitation.message,
      })) : []),
      {
        factPath: 'investorFlow.*NetBuy',
        reasonCode: 'investor_net_buy_not_provided_by_wisereport_fnguide',
        checkedSources: ownershipCheckedSources,
        message: noFlowMessage,
      },
      ...(notCorporate ? [{
        factPath: 'profitability.*',
        reasonCode: 'corporate_financials_not_applicable',
        checkedSources: ['instrumentKind'],
        message: 'ETF/ETN instrument kind uses product-specific analysis rather than corporate financial statements.',
      }] : []),
    ],
  };
}

function buildWiseReportKrSlimPayloadV12(rawAggregate, code) {
  const slimV11 = buildWiseReportKrSlimPayloadV11(rawAggregate, code, WISEREPORT_KR_V12_PAGES);
  const evidence = buildDeepScanKrEvidencePacket({
    instrument: {
      code: slimV11.company?.code ?? slimV11.code,
      name: slimV11.company?.name,
      market: slimV11.company?.market,
    },
  }, {
    slim: slimV11,
  });
  const instrumentKind = inferWiseReportKrInstrumentKind(slimV11);
  const availableV12PageIds = WISEREPORT_KR_V12_PAGES
    .map((page) => page.id)
    .filter((pageId) => hasSlimV12Value(slimV11.pages?.[pageId]));
  const missingV12PageIds = WISEREPORT_KR_V12_PAGES
    .map((page) => page.id)
    .filter((pageId) => !hasSlimV12Value(slimV11.pages?.[pageId]));
  const v12PageCoverage = {
    totalKnownPages: WISEREPORT_KR_V12_PAGES.length,
    availablePageIds: availableV12PageIds,
    missingPageIds: missingV12PageIds,
    availableCount: availableV12PageIds.length,
  };

  return {
    schemaVersion: 'wisereport-kr-slim-v1.2',
    market: 'KR',
    code: slimV11.code,
    company: {
      code: slimV11.company?.code ?? slimV11.code,
      name: slimV11.company?.name ?? null,
      market: evidence.instrument?.market ?? slimV11.company?.market ?? null,
      instrumentKind,
    },
    sourceCoverage: {
      pageCoverage: v12PageCoverage,
      sourceCoverage: {
        ...evidence.sourceCoverage,
        availableReportPages: availableV12PageIds,
      },
      checkedSources: [
        'wisereport.company-overview',
        'wisereport.financial-analysis',
        'wisereport.investment-indicators',
        'wisereport.consensus',
        'wisereport.shareholding',
        'wisereport.recent-reports',
        'fnguide.snapshot',
        'fnguide.shareanalysis',
        'fnguide.foreign-ownership-chart',
        'fnguide.finance',
        'fnguide.relative-return',
        'fnguide.opinion',
        'fnguide.style-analysis',
      ],
    },
    pages: slimV11.pages,
    krFacts: buildWiseReportKrSlimFactsV12(slimV11, evidence, instrumentKind),
  };
}

export {
  buildWiseReportKrSlimPayload,
  buildWiseReportKrSlimPayloadV11,
  buildWiseReportKrSlimPayloadV12,
  extractWiseReportKrNormalizedPage,
  normalizeWiseReportKrAggregate,
  slimWiseReportKrValue,
  slimWiseReportKrValueV11,
};
