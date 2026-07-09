import { createRequire } from 'node:module';
import { getCurrentQuotes } from '../crawlers/current-quotes.js';
import { buildDartDisclosureDocumentDump, getDartDisclosures } from '../crawlers/dart-filings.js';
import { fetchWiseReportEtfSnapshot } from '../crawlers/wisereport-etf.js';
import { buildDeepScanKrEvidencePacket } from './deepscan-kr-evidence.js';
import { scoreDeepScanKrEvidence, scoreDeepScanKrFromCommittee } from './deepscan-kr-score.js';
import { invokeDeepScanKrPackage } from './deepscan-kr-package-adapter.js';
import {
  buildKrCommitteeAxesFromLlmResults,
  scoreDeepScanKrCommitteeFromDump,
} from './deepscan-kr-committee-runtime.js';
import {
  getDefaultCrawlerCacheFreshTtlMs,
  getDefaultCrawlerCacheStaleTtlMs,
  getDefaultSupabaseCrawlerCacheClient,
  normalizeCrawlerCacheToggle,
  readThroughCrawlerCache,
} from './supabase-crawler-cache.js';

const require = createRequire(import.meta.url);
const {
  WISEREPORT_KR_V12_PAGES,
  getCrawlV12,
} = require('../crawlers/wisereport-kr.cjs');

const DEEP_SCAN_VERSION = 'deepscan-payload-kr-v2';
const MAJOR_BLOCK_KEYS = Object.freeze([
  'hero',
  'committee',
  'insights',
  'strategy',
  'sellNow',
  'portfolioSimulation',
]);
const SOURCE_TYPES = new Set(['ocr', 'holding', 'report', 'news', 'market', 'system']);
const FALLBACK_GENERATED_AT = '1970-01-01T00:00:00.000Z';
const INTERNAL_SERVICE_ERROR_CODE = 'internal-service-error';
const MIN_PACKAGE_REASON_LENGTH = 8;
const WISEREPORT_KR_CACHE_ROUTE = 'wisereport-kr-v12-slim';
const WISEREPORT_KR_CACHE_ROUTE_VERSION = 'v12';
const WISEREPORT_KR_CACHE_SCHEMA_VERSION = 'wisereport-kr-v12-slim-v1';
const OPENROUTER_CHAT_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_COMMENTARY_SUMMARY_TIMEOUT_MS = 2_500;
const DEFAULT_DEEPSCAN_KR_LLM_MODEL = 'deepseek/deepseek-v4-flash';
const DEFAULT_DEEPSCAN_KR_CURRENT_QUOTES_TIMEOUT_MS = 4_500;
const DEFAULT_DEEPSCAN_KR_ETF_SNAPSHOT_TIMEOUT_MS = 4_500;
const DEFAULT_DEEPSCAN_KR_DISCLOSURE_TIMEOUT_MS = 4_500;
const DEFAULT_DEEPSCAN_KR_DISCLOSURE_LOOKBACK_DAYS = 30;
const DEFAULT_DEEPSCAN_KR_DISCLOSURE_LIMIT = 30;
const DEFAULT_DEEPSCAN_KR_DISCLOSURE_DOCUMENT_MAX_CHARS = 15_000;
const DEFAULT_DEEPSCAN_KR_DISCLOSURE_DOCUMENT_LIMIT = 20;
const DEFAULT_DEEPSCAN_KR_DISCLOSURE_DOCUMENT_CONCURRENCY = 4;

function normalizeText(value) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized || undefined;
}

function normalizeSourceType(value) {
  if (value === 'home-handoff') {
    return 'holding';
  }

  return SOURCE_TYPES.has(value) ? value : 'system';
}

function normalizeInput(rawInput = {}) {
  const safeInput = rawInput && typeof rawInput === 'object' ? rawInput : {};
  const rawInstrument = safeInput.instrument && typeof safeInput.instrument === 'object' ? safeInput.instrument : {};
  const rawHolding = safeInput.holding && typeof safeInput.holding === 'object' ? safeInput.holding : null;
  const rawSourceContext = safeInput.sourceContext && typeof safeInput.sourceContext === 'object' ? safeInput.sourceContext : {};
  const sourceFrom = normalizeSourceType(rawSourceContext.from);

  const normalizedHolding = rawHolding
    ? {
        shares: normalizeText(rawHolding.shares),
        averagePrice: normalizeText(rawHolding.averagePrice),
        averagePriceCurrency: normalizeText(rawHolding.averagePriceCurrency),
        currentPrice: normalizeText(rawHolding.currentPrice),
        currentPriceCurrency: normalizeText(rawHolding.currentPriceCurrency),
        currentProfitRate: normalizeText(rawHolding.currentProfitRate),
        evaluationAmount: normalizeText(rawHolding.evaluationAmount),
        usdKrwRate: normalizeText(rawHolding.usdKrwRate),
      }
    : undefined;

  return {
    instrument: {
      name: normalizeText(rawInstrument.name) ?? '알 수 없는 종목',
      code: normalizeText(rawInstrument.code),
      ticker: normalizeText(rawInstrument.ticker),
      market: normalizeText(rawInstrument.market),
      kind: rawInstrument.kind,
    },
    holding: normalizedHolding,
    selectedAt: normalizeText(safeInput.selectedAt),
    sourceContext: {
      from: sourceFrom,
      sessionKey: normalizeText(rawSourceContext.sessionKey),
      appliedAt: normalizeText(rawSourceContext.appliedAt),
    },
  };
}

function safeCloneRawInput(rawInput) {
  try {
    return structuredClone(rawInput);
  } catch {
    return null;
  }
}

function safeNormalizeInput(rawInput = {}) {
  try {
    return normalizeInput(rawInput);
  } catch {
    return normalizeInput({
      selectedAt: safeReadText(rawInput, 'selectedAt'),
      sourceContext: {
        from: safeReadSourceType(rawInput),
        sessionKey: safeReadNestedText(rawInput, 'sourceContext', 'sessionKey'),
        appliedAt: safeReadNestedText(rawInput, 'sourceContext', 'appliedAt'),
      },
    });
  }
}

function safeReadText(target, key) {
  try {
    return normalizeText(target?.[key]);
  } catch {
    return undefined;
  }
}

function safeReadNestedText(target, parentKey, childKey) {
  try {
    const parentValue = target?.[parentKey];

    if (!parentValue || typeof parentValue !== 'object') {
      return undefined;
    }

    return normalizeText(parentValue[childKey]);
  } catch {
    return undefined;
  }
}

function safeReadSourceType(rawInput) {
  try {
    const rawSourceContext = rawInput?.sourceContext;
    return normalizeSourceType(rawSourceContext?.from);
  } catch {
    return 'system';
  }
}

function deriveGeneratedAt(input) {
  return input.sourceContext.appliedAt ?? input.selectedAt ?? FALLBACK_GENERATED_AT;
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

function parseBooleanToggle(value, fallback = false) {
  const normalized = normalizeText(value)?.toLowerCase();
  if (['1', 'true', 'on', 'yes'].includes(normalized ?? '')) {
    return true;
  }
  if (['0', 'false', 'off', 'no'].includes(normalized ?? '')) {
    return false;
  }
  return fallback;
}

function createDebugId(input) {
  const identifier = input.instrument.code ?? input.instrument.ticker ?? 'missing';
  return `deepscan:${input.instrument.market ?? 'NA'}:${identifier}`;
}

function createBlockStatus(blocks) {
  return Object.fromEntries(MAJOR_BLOCK_KEYS.map((key) => [key, blocks[key]?.blockState ?? 'missing']));
}

function createDeepScanSourceRef({ type = 'system', id, label, at, note } = {}) {
  return {
    type: SOURCE_TYPES.has(type) ? type : 'system',
    id: id ?? 'deepscan-source',
    label,
    at,
    note,
  };
}

function createDeepScanBlockError({ code, message, retryable = false } = {}) {
  return {
    code: code ?? 'unknown-error',
    message: message ?? 'unknown error',
    retryable,
  };
}

function createBlockedBlockMeta({ sourceRefs = [], fallback, error } = {}) {
  return {
    blockState: 'blocked',
    sourceRefs: [...sourceRefs],
    fallback: fallback ? { ...fallback } : null,
    error: error ? { ...error } : null,
  };
}

function createErrorBlockMeta({ sourceRefs = [], fallback, error } = {}) {
  return {
    blockState: 'error',
    sourceRefs: [...sourceRefs],
    fallback: fallback ? { ...fallback } : null,
    error: error ? { ...error } : null,
  };
}

function createOkBlockMeta({ sourceRefs = [], fallback = null } = {}) {
  return {
    blockState: 'ok',
    sourceRefs: [...sourceRefs],
    fallback: fallback ? { ...fallback } : null,
    error: null,
  };
}

function createBaseSourceRefs(input) {
  const identifier = input.instrument.code ?? input.instrument.ticker ?? input.instrument.name;
  const sourceRefs = [
    createDeepScanSourceRef({
      type: input.sourceContext.from,
      id: `input:${identifier}`,
      label: '딥스캔 입력값',
      at: input.sourceContext.appliedAt ?? input.selectedAt,
      note: input.sourceContext.sessionKey ? `session:${input.sourceContext.sessionKey}` : undefined,
    }),
    createDeepScanSourceRef({
      type: 'system',
      id: 'deepscan-payload-service',
      label: '크롤러 딥스캔 데이터 조립 서비스',
      note: '국내 근거 기반 분석 데이터 조립',
    }),
  ];

  if (input.holding?.shares || input.holding?.averagePrice || input.holding?.evaluationAmount) {
    sourceRefs.push(
      createDeepScanSourceRef({
        type: 'holding',
        id: `holding:${identifier}`,
        label: '보유 정보 스냅샷',
        at: input.selectedAt,
      }),
    );
  }

  return sourceRefs;
}

function createBlockSourceRefs(input, blockId, additionalSourceRefs = []) {
  return [
    ...createBaseSourceRefs(input),
    ...additionalSourceRefs,
    createDeepScanSourceRef({
      type: 'system',
      id: `deepscan-block:${blockId}`,
      label: `${blockId} payload block`,
    }),
  ];
}

function createInputInvalidPayload(rawInput = {}) {
  const input = normalizeInput(rawInput);
  const generatedAt = deriveGeneratedAt(input);
  const metadataSourceRefs = createBaseSourceRefs(input);
  const invalidError = createDeepScanBlockError({
    code: 'input-invalid',
    message: '종목 코드 또는 티커가 필요합니다',
    retryable: false,
  });
  const invalidFallback = {
    used: true,
    reason: 'input-invalid',
    label: '종목 코드 또는 티커 필요',
  };
  const blocks = {
    hero: {
      ...createBlockedBlockMeta({
        sourceRefs: createBlockSourceRefs(input, 'hero'),
        fallback: invalidFallback,
        error: invalidError,
      }),
      headline: '입력 정보를 확인해주세요',
      body: 'DeepScan 표준 분석 데이터를 만들려면 종목 코드 또는 티커가 필요합니다.',
      statusText: '입력 부족',
      score: 0,
      scoreLabel: 'N/A',
      scoreDelta: '0',
    },
    committee: {
      ...createBlockedBlockMeta({
        sourceRefs: createBlockSourceRefs(input, 'committee'),
        fallback: invalidFallback,
        error: invalidError,
      }),
      axes: [],
    },
    insights: {
      ...createBlockedBlockMeta({
        sourceRefs: createBlockSourceRefs(input, 'insights'),
        fallback: invalidFallback,
        error: invalidError,
      }),
      sectionLabel: '입력 확인 필요',
      items: [],
      summaryTags: [],
    },
    strategy: {
      ...createBlockedBlockMeta({
        sourceRefs: createBlockSourceRefs(input, 'strategy'),
        fallback: invalidFallback,
        error: invalidError,
      }),
      weekSignal: '사용 불가',
      weekSignalTone: 'neutral',
      weekBadgeText: '보류',
      scenarioLabel: '입력 확인 필요',
      scenarioProbability: '0%',
      scenarioPeriod: '정보 없음',
      scenarioCondition: '종목 코드 또는 티커가 누락되었습니다.',
      currentPriceText: '정보 없음',
      targetPriceText: '정보 없음',
      scenarioDetails: [],
      otherScenarios: [],
      otherScenarioTags: [],
    },
    sellNow: {
      ...createBlockedBlockMeta({
        sourceRefs: createBlockSourceRefs(input, 'sellNow'),
        fallback: invalidFallback,
        error: invalidError,
      }),
      realizedText: '입력 정보를 먼저 확인해주세요.',
      rows: [],
    },
    portfolioSimulation: {
      ...createBlockedBlockMeta({
        sourceRefs: createBlockSourceRefs(input, 'portfolioSimulation'),
        fallback: invalidFallback,
        error: invalidError,
      }),
      beforeScore: 0,
      afterScore: 0,
      deltaLabel: '0p',
      caption: '포트폴리오 시뮬레이션을 계산할 수 없습니다.',
    },
  };

  return {
    input,
    ...blocks,
    metadata: {
      generatedAt,
      version: DEEP_SCAN_VERSION,
      degraded: true,
      errorCode: 'input-invalid',
      debugId: createDebugId(input),
      inputValidity: {
        valid: false,
        reason: 'instrument identifier missing',
        missing: ['instrument.code', 'instrument.ticker'],
        raw: safeCloneRawInput(rawInput),
      },
      sourceRefs: metadataSourceRefs,
      blockStatus: createBlockStatus(blocks),
    },
  };
}

function createInternalErrorPayload(rawInput = {}) {
  const input = safeNormalizeInput(rawInput);
  const generatedAt = deriveGeneratedAt(input);
  const metadataSourceRefs = createBaseSourceRefs(input);
  const internalError = createDeepScanBlockError({
    code: INTERNAL_SERVICE_ERROR_CODE,
    message: '예상치 못한 크롤러 서비스 내부 오류',
    retryable: true,
  });
  const internalFallback = {
    used: true,
    reason: INTERNAL_SERVICE_ERROR_CODE,
    label: '표준 내부 오류 데이터',
  };
  const blocks = {
    hero: {
      ...createErrorBlockMeta({
        sourceRefs: createBlockSourceRefs(input, 'hero'),
        fallback: internalFallback,
        error: internalError,
      }),
      headline: 'DeepScan 데이터 생성 중 오류가 발생했습니다',
      body: '크롤러 서비스 내부 오류로 표준 오류 데이터를 반환했습니다.',
      statusText: '서비스 오류',
      score: 0,
      scoreLabel: 'N/A',
      scoreDelta: '0',
    },
    committee: {
      ...createErrorBlockMeta({
        sourceRefs: createBlockSourceRefs(input, 'committee'),
        fallback: internalFallback,
        error: internalError,
      }),
      axes: [],
    },
    insights: {
      ...createErrorBlockMeta({
        sourceRefs: createBlockSourceRefs(input, 'insights'),
        fallback: internalFallback,
        error: internalError,
      }),
      sectionLabel: '서비스 오류',
      items: [],
      summaryTags: [],
    },
    strategy: {
      ...createErrorBlockMeta({
        sourceRefs: createBlockSourceRefs(input, 'strategy'),
        fallback: internalFallback,
        error: internalError,
      }),
      weekSignal: '사용 불가',
      weekSignalTone: 'neutral',
      weekBadgeText: '오류',
      scenarioLabel: '서비스 오류',
      scenarioProbability: '0%',
      scenarioPeriod: '정보 없음',
      scenarioCondition: '내부 오류로 전략 시나리오를 계산할 수 없습니다.',
      currentPriceText: '정보 없음',
      targetPriceText: '정보 없음',
      scenarioDetails: [],
      otherScenarios: [],
      otherScenarioTags: [],
    },
    sellNow: {
      ...createErrorBlockMeta({
        sourceRefs: createBlockSourceRefs(input, 'sellNow'),
        fallback: internalFallback,
        error: internalError,
      }),
      realizedText: '내부 오류로 즉시 매도 판단 블록을 만들 수 없습니다.',
      rows: [],
    },
    portfolioSimulation: {
      ...createErrorBlockMeta({
        sourceRefs: createBlockSourceRefs(input, 'portfolioSimulation'),
        fallback: internalFallback,
        error: internalError,
      }),
      beforeScore: 0,
      afterScore: 0,
      deltaLabel: '0p',
      caption: '내부 오류로 포트폴리오 시뮬레이션을 계산할 수 없습니다.',
    },
  };

  return {
    input,
    ...blocks,
    metadata: {
      generatedAt,
      version: DEEP_SCAN_VERSION,
      degraded: true,
      errorCode: INTERNAL_SERVICE_ERROR_CODE,
      debugId: createDebugId(input),
      inputValidity: {
        valid: false,
        reason: 'internal payload assembly failure',
        raw: safeCloneRawInput(rawInput),
      },
      sourceRefs: metadataSourceRefs,
      blockStatus: createBlockStatus(blocks),
    },
  };
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function hasOwn(target, key) {
  return Object.prototype.hasOwnProperty.call(target, key);
}

function isKrInput(input) {
  const market = normalizeText(input.instrument.market)?.toUpperCase();
  const code = normalizeText(input.instrument.code);
  return market === 'KR' || market === 'KOSPI' || market === 'KOSDAQ' || market === 'ETF' || market === 'ETN' || /^\d{6}$/.test(code ?? '');
}

function isKrExchangeProductInput(input) {
  const market = normalizeText(input.instrument.market)?.toUpperCase();
  const kind = normalizeText(input.instrument.kind)?.toLowerCase();
  return market === 'ETF' || market === 'ETN' || kind === 'etf' || kind === 'etn';
}

function normalizeTradeDate(value) {
  const normalized = normalizeText(value);

  if (!normalized) {
    return undefined;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return normalized;
  }

  if (/^\d{4}-\d{2}-\d{2}T/.test(normalized)) {
    return normalized.slice(0, 10);
  }

  return undefined;
}

function compactDateToDashed(value) {
  const normalized = normalizeText(value)?.replaceAll('-', '');
  if (!normalized || !/^\d{8}$/.test(normalized)) {
    return undefined;
  }

  return `${normalized.slice(0, 4)}-${normalized.slice(4, 6)}-${normalized.slice(6, 8)}`;
}

function shiftIsoDate(value, days) {
  const normalized = normalizeTradeDate(value) ?? compactDateToDashed(value);
  if (!normalized) {
    return undefined;
  }

  const date = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function todayKstIsoDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function hasConfiguredDartApiKey(options = {}) {
  return Boolean(
    normalizeText(options.apiKey)
    || normalizeText(process.env.DART_KEY)
    || normalizeText(process.env.DART_API_KEY)
    || normalizeText(process.env.OPENDART_API_KEY)
    || normalizeText(process.env.OPEN_DART_API_KEY)
    || normalizeText(process.env.API_K_DART)
  );
}

function normalizeWiseReportKrAggregate(rawAggregate) {
  if (rawAggregate && typeof rawAggregate === 'object' && rawAggregate.pages && typeof rawAggregate.pages === 'object') {
    return rawAggregate;
  }

  return {
    pages: rawAggregate && typeof rawAggregate === 'object' ? rawAggregate : {},
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
    && Array.isArray(value.rows);
}

function slimWiseReportKrValue(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => slimWiseReportKrValue(item))
      .filter((item) => item !== undefined);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  if (isWiseReportKrTablePayload(value)) {
    const tablePayload = {
      rows: slimWiseReportKrValue(value.rows),
    };

    if (value.status != null) {
      tablePayload.status = value.status;
    }
    if (value.note != null) {
      tablePayload.note = value.note;
    }
    if (value.dataAvailability && typeof value.dataAvailability === 'object') {
      if (tablePayload.status == null && value.dataAvailability.status != null) {
        tablePayload.status = value.dataAvailability.status;
      }
      if (tablePayload.note == null && value.dataAvailability.note != null) {
        tablePayload.note = value.dataAvailability.note;
      }
    }

    return tablePayload;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, nested]) => nested !== undefined)
      .map(([key, nested]) => [key, slimWiseReportKrValue(nested)]),
  );
}

function pickWiseReportKrCompany(rawAggregate, code, pageDefinitions = WISEREPORT_KR_V12_PAGES) {
  const normalizedAggregate = normalizeWiseReportKrAggregate(rawAggregate);

  for (const page of pageDefinitions) {
    const company = extractWiseReportKrNormalizedPage(normalizedAggregate.pages?.[page.id])?.company;
    if (company && typeof company === 'object') {
      return {
        code: String(company.code || code || ''),
        name: normalizeText(company.name) ?? null,
      };
    }
  }

  return {
    code: String(code || ''),
    name: null,
  };
}

function buildWiseReportKrSlimPayload(rawAggregate, code, pageDefinitions = WISEREPORT_KR_V12_PAGES) {
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

    return [page.id, slimWiseReportKrValue(businessPayload)];
  }));

  return {
    code: String(code || ''),
    company: pickWiseReportKrCompany(rawAggregate, code, pageDefinitions),
    pages: slimPages,
  };
}

function getCrawlerCacheClientFromRawInput(rawInput) {
  const safeRawInput = asObject(rawInput);
  const cacheOptions = asObject(safeRawInput.crawlerCache ?? safeRawInput.supabaseCrawlerCache);
  const enabled = normalizeCrawlerCacheToggle(cacheOptions.enabled);

  if (enabled === false) {
    return null;
  }

  if (Object.hasOwn(cacheOptions, 'client')) {
    return cacheOptions.client ?? null;
  }

  return getDefaultSupabaseCrawlerCacheClient();
}

function getCrawlerCacheOptions(rawInput) {
  const safeRawInput = asObject(rawInput);
  const cacheOptions = asObject(safeRawInput.crawlerCache ?? safeRawInput.supabaseCrawlerCache);

  return {
    freshTtlMs: cacheOptions.freshTtlMs ?? getDefaultCrawlerCacheFreshTtlMs(),
    staleTtlMs: cacheOptions.staleTtlMs ?? getDefaultCrawlerCacheStaleTtlMs(),
    forceRefresh: normalizeCrawlerCacheToggle(cacheOptions.forceRefresh ?? cacheOptions.refresh) === true,
    bypassCache: normalizeCrawlerCacheToggle(cacheOptions.bypassCache ?? cacheOptions.bypass) === true,
  };
}

function buildWiseReportKrCacheDescriptor(input, pageDefinitions = WISEREPORT_KR_V12_PAGES) {
  const pageIds = pageDefinitions.map((page) => page.id);

  return {
    source: 'wisereport',
    market: 'KR',
    targetIdentifier: input.instrument.code,
    targetDisplayName: input.instrument.name,
    targetKind: 'stock',
    route: WISEREPORT_KR_CACHE_ROUTE,
    routeVersion: WISEREPORT_KR_CACHE_ROUTE_VERSION,
    schemaVersion: WISEREPORT_KR_CACHE_SCHEMA_VERSION,
    authScope: 'public',
    request: {
      code: input.instrument.code,
      pages: pageIds,
      payload: 'deep-slim',
    },
    metadata: {
      consumer: 'deepscan',
      crawler: 'wisereport-kr',
      payloadShape: 'slim',
      pageCount: pageIds.length,
    },
    sourceRefs: [
      createDeepScanSourceRef({
        type: 'report',
        id: `wisereport-kr-v12:${input.instrument.code}`,
        label: '와이즈리포트 국내 요약 데이터',
      }),
    ],
  };
}

async function loadWiseReportKrSlimSource(input, options = {}) {
  const loadAggregate = typeof options.loadAggregate === 'function'
    ? options.loadAggregate
    : (code) => getCrawlV12(code);
  const loadSlim = typeof options.loadSlim === 'function'
    ? options.loadSlim
    : async (code, pageDefinitions) => buildWiseReportKrSlimPayload(
      await loadAggregate(code),
      code,
      pageDefinitions,
    );
  const pageDefinitions = options.pageDefinitions ?? WISEREPORT_KR_V12_PAGES;
  const cacheClient = Object.hasOwn(options, 'cacheClient') ? options.cacheClient : getDefaultSupabaseCrawlerCacheClient();
  const descriptor = buildWiseReportKrCacheDescriptor(input, pageDefinitions);

  const result = await readThroughCrawlerCache({
    cacheClient,
    descriptor,
    load: () => loadSlim(input.instrument.code, pageDefinitions),
    freshTtlMs: options.freshTtlMs ?? getDefaultCrawlerCacheFreshTtlMs(),
    staleTtlMs: options.staleTtlMs ?? getDefaultCrawlerCacheStaleTtlMs(),
    allowStaleOnError: options.allowStaleOnError !== false,
    forceRefresh: options.forceRefresh === true,
    bypassCache: options.bypassCache === true,
    ...(options.now ? { now: options.now } : {}),
  });

  return result.value;
}

async function captureSource(sourceId, load) {
  try {
    return {
      value: await load(),
      issue: null,
    };
  } catch (error) {
    return {
      value: null,
      issue: {
        sourceId,
        message: normalizeText(error?.message) ?? `${sourceId} unavailable`,
      },
    };
  }
}

function shouldInvokeKrPackage(rawInput, input) {
  const safeRawInput = asObject(rawInput);
  const packageOptions = asObject(safeRawInput.packageOptions ?? safeRawInput.deepscanPackageOptions);
  const packageInput = buildKrPackageInvocationInput(input);
  const explicitToggle = normalizeText(process.env.DEEPSCAN_KR_PACKAGE_ENABLE)?.toLowerCase();
  const explicitEnable = safeRawInput.invokePackage === true || packageOptions.invoke === true || explicitToggle === '1' || explicitToggle === 'true';
  const explicitDisable = safeRawInput.invokePackage === false || packageOptions.invoke === false || explicitToggle === '0' || explicitToggle === 'false' || explicitToggle === 'off' || explicitToggle === 'no';

  if (explicitDisable) {
    return false;
  }

  if (!packageInput) {
    return false;
  }

  const sshHost = normalizeText(packageOptions.sshHost) ?? normalizeText(process.env.DEEPSCAN_KR_PACKAGE_SSH_HOST);
  const identityPath = normalizeText(packageOptions.identityPath) ?? normalizeText(process.env.DEEPSCAN_KR_PACKAGE_SSH_IDENTITY);
  const knownHostsPath = normalizeText(packageOptions.knownHostsPath) ?? normalizeText(process.env.DEEPSCAN_KR_PACKAGE_SSH_KNOWN_HOSTS);
  const remoteDir = normalizeText(packageOptions.remoteDir) ?? normalizeText(process.env.DEEPSCAN_KR_PACKAGE_REMOTE_DIR);
  const runtimeConfigured = Boolean(sshHost && identityPath && knownHostsPath && remoteDir);

  return explicitEnable || runtimeConfigured;
}

function buildKrPackageInvocationInput(input) {
  if (!isKrInput(input) || !input.instrument.code) {
    return null;
  }

  const evidenceSeed = buildDeepScanKrEvidencePacket(input, {});
  if (evidenceSeed.holding.shares === null || evidenceSeed.holding.averagePrice === null) {
    return null;
  }

  return {
    stockCode: input.instrument.code,
    holdingQty: String(evidenceSeed.holding.shares),
    avgPrice: String(evidenceSeed.holding.averagePrice),
  };
}

async function maybeResolveKrPackageResult(rawInput, input) {
  const packageInput = buildKrPackageInvocationInput(input);
  if (!shouldInvokeKrPackage(rawInput, input)) {
    return {
      value: null,
      issue: null,
    };
  }

  const safeRawInput = asObject(rawInput);
  const packageOptions = asObject(safeRawInput.packageOptions ?? safeRawInput.deepscanPackageOptions);

  try {
    const result = await invokeDeepScanKrPackage(
      packageInput,
      {
        timeoutMs: 1_500,
        maxRetries: 0,
        enableSnapshots: false,
        ...packageOptions,
      },
    );

    if (!result?.ok) {
      return {
        value: null,
        issue: {
          sourceId: 'package-result',
          message: normalizeText(result?.error?.code) ?? 'package-result unavailable',
        },
      };
    }

    return {
      value: result.data,
      issue: null,
    };
  } catch (error) {
    return {
      value: null,
      issue: {
        sourceId: 'package-result',
        message: normalizeText(error?.message) ?? 'package-result unavailable',
      },
    };
  }
}

function shouldInvokeKrDisclosures(rawInput, input) {
  if (!isKrInput(input) || isKrExchangeProductInput(input) || !input.instrument.code) {
    return false;
  }

  const safeRawInput = asObject(rawInput);
  const disclosureOptions = asObject(safeRawInput.disclosureOptions ?? safeRawInput.dartOptions ?? safeRawInput.opendartOptions);
  const explicitToggle = normalizeText(process.env.DEEPSCAN_KR_DISCLOSURES_ENABLE)?.toLowerCase();
  const explicitEnable = safeRawInput.invokeDisclosures === true
    || disclosureOptions.invoke === true
    || ['1', 'true', 'on', 'yes'].includes(explicitToggle ?? '');
  const explicitDisable = safeRawInput.invokeDisclosures === false
    || disclosureOptions.invoke === false
    || ['0', 'false', 'off', 'no'].includes(explicitToggle ?? '');

  if (explicitDisable) {
    return false;
  }

  return explicitEnable || hasConfiguredDartApiKey(disclosureOptions);
}

function buildKrDisclosureRequest(rawInput, input) {
  const safeRawInput = asObject(rawInput);
  const disclosureOptions = asObject(safeRawInput.disclosureOptions ?? safeRawInput.dartOptions ?? safeRawInput.opendartOptions);
  const lookbackDays = parsePositiveInteger(
    disclosureOptions.lookbackDays ?? process.env.DEEPSCAN_KR_DISCLOSURE_LOOKBACK_DAYS,
    DEFAULT_DEEPSCAN_KR_DISCLOSURE_LOOKBACK_DAYS,
  );
  const endDate = normalizeTradeDate(disclosureOptions.to ?? disclosureOptions.endDate)
    ?? normalizeTradeDate(input.sourceContext.appliedAt)
    ?? normalizeTradeDate(input.selectedAt)
    ?? todayKstIsoDate();
  const fromDate = normalizeTradeDate(disclosureOptions.from ?? disclosureOptions.startDate)
    ?? (endDate ? shiftIsoDate(endDate, -lookbackDays) : undefined);

  return {
    code: input.instrument.code,
    ...(fromDate ? { from: fromDate } : {}),
    ...(endDate ? { to: endDate } : {}),
    finalOnly: disclosureOptions.finalOnly ?? disclosureOptions.lastReprtAt ?? 'N',
    pageCount: parsePositiveInteger(
      disclosureOptions.pageCount ?? disclosureOptions.limit ?? process.env.DEEPSCAN_KR_DISCLOSURE_LIMIT,
      DEFAULT_DEEPSCAN_KR_DISCLOSURE_LIMIT,
    ),
    sort: disclosureOptions.sort ?? 'date',
    sortMth: disclosureOptions.sortMth ?? disclosureOptions.sort_mth ?? 'desc',
  };
}

async function maybeResolveKrDisclosures(rawInput, input) {
  if (!shouldInvokeKrDisclosures(rawInput, input)) {
    return {
      value: null,
      issue: null,
    };
  }

  const safeRawInput = asObject(rawInput);
  const disclosureOptions = asObject(safeRawInput.disclosureOptions ?? safeRawInput.dartOptions ?? safeRawInput.opendartOptions);

  try {
    const result = await getDartDisclosures(
      buildKrDisclosureRequest(rawInput, input),
      {
        timeoutMs: parsePositiveInteger(
          disclosureOptions.timeoutMs ?? process.env.DEEPSCAN_KR_DISCLOSURE_TIMEOUT_MS,
          DEFAULT_DEEPSCAN_KR_DISCLOSURE_TIMEOUT_MS,
        ),
        ...(disclosureOptions.apiKey ? { apiKey: disclosureOptions.apiKey } : {}),
        ...(disclosureOptions.fetchImpl ? { fetchImpl: disclosureOptions.fetchImpl } : {}),
      },
    );

    const includeDocumentDump = parseBooleanToggle(
      disclosureOptions.includeDocumentDump
        ?? disclosureOptions.documentDump
        ?? process.env.DEEPSCAN_KR_DISCLOSURE_DOCUMENT_DUMP_ENABLE,
      true,
    );
    if (includeDocumentDump && Array.isArray(result.filings) && result.filings.length > 0) {
      try {
        const documentDump = await buildDartDisclosureDocumentDump(result.filings, {
          maxCharsPerFiling: parsePositiveInteger(
            disclosureOptions.documentMaxChars
              ?? disclosureOptions.documentMaxCharsPerFiling
              ?? process.env.DEEPSCAN_KR_DISCLOSURE_DOCUMENT_MAX_CHARS,
            DEFAULT_DEEPSCAN_KR_DISCLOSURE_DOCUMENT_MAX_CHARS,
          ),
          limit: parsePositiveInteger(
            disclosureOptions.documentLimit
              ?? process.env.DEEPSCAN_KR_DISCLOSURE_DOCUMENT_LIMIT,
            DEFAULT_DEEPSCAN_KR_DISCLOSURE_DOCUMENT_LIMIT,
          ),
          fetchLimit: parsePositiveInteger(
            disclosureOptions.documentFetchLimit
              ?? process.env.DEEPSCAN_KR_DISCLOSURE_DOCUMENT_FETCH_LIMIT,
            result.filings.length,
          ),
          concurrency: parsePositiveInteger(
            disclosureOptions.documentConcurrency
              ?? process.env.DEEPSCAN_KR_DISCLOSURE_DOCUMENT_CONCURRENCY,
            DEFAULT_DEEPSCAN_KR_DISCLOSURE_DOCUMENT_CONCURRENCY,
          ),
          timeoutMs: parsePositiveInteger(
            disclosureOptions.documentTimeoutMs
              ?? disclosureOptions.timeoutMs
              ?? process.env.DEEPSCAN_KR_DISCLOSURE_DOCUMENT_TIMEOUT_MS
              ?? process.env.DEEPSCAN_KR_DISCLOSURE_TIMEOUT_MS,
            DEFAULT_DEEPSCAN_KR_DISCLOSURE_TIMEOUT_MS,
          ),
          ...(disclosureOptions.apiKey ? { apiKey: disclosureOptions.apiKey } : {}),
          ...(disclosureOptions.fetchImpl ? { fetchImpl: disclosureOptions.fetchImpl } : {}),
        });
        return {
          value: {
            ...result,
            documentDump,
          },
          issue: null,
        };
      } catch (error) {
        return {
          value: {
            ...result,
            documentDump: {
              available: false,
              source: 'opendart-document',
              error: normalizeText(error?.message) ?? 'OpenDART document dump unavailable',
            },
          },
          issue: null,
        };
      }
    }

    return {
      value: result,
      issue: null,
    };
  } catch (error) {
    if (error?.code === 'provider_unconfigured') {
      return {
        value: null,
        issue: null,
      };
    }

    return {
      value: null,
      issue: {
        sourceId: 'disclosures',
        message: normalizeText(error?.message) ?? 'OpenDART disclosures unavailable',
      },
    };
  }
}

function shouldInvokeKrCommitteeLlm() {
  const explicitToggle = normalizeText(process.env.DEEPSCAN_KR_LLM_ENABLE)?.toLowerCase();
  if (['0', 'false', 'off', 'no'].includes(explicitToggle ?? '')) {
    return false;
  }

  if (process.env.OPENROUTER_API_KEY) {
    return true;
  }

  return ['1', 'true', 'on', 'yes'].includes(explicitToggle ?? '');
}

async function resolveKrSourceBundle(rawInput, input) {
  const safeRawInput = asObject(rawInput);

  if (hasOwn(safeRawInput, 'sources')) {
    return {
      sources: asObject(safeRawInput.sources),
      sourceIssues: [],
    };
  }

  if (!isKrInput(input) || !input.instrument.code) {
    return {
      sources: {},
      sourceIssues: [],
    };
  }

  const tradeDate = normalizeTradeDate(input.selectedAt ?? input.sourceContext.appliedAt);
  const cacheClient = getCrawlerCacheClientFromRawInput(rawInput);
  const cacheOptions = getCrawlerCacheOptions(rawInput);
  const [slimResult, quotesResult, packageResult, etfSnapshotResult, disclosuresResult] = await Promise.all([
    captureSource('slim', async () => loadWiseReportKrSlimSource(input, {
      cacheClient,
      ...cacheOptions,
    })),
    captureSource('current-quote', async () => getCurrentQuotes({
      codes: input.instrument.code ? [input.instrument.code] : [],
      tickers: input.instrument.ticker ? [input.instrument.ticker] : [],
      ...(tradeDate ? { tradeDate } : {}),
    }, {
      enrichKrVolumeFromKrx: false,
      naverCurrentQuotesTimeoutMs: parsePositiveInteger(
        process.env.DEEPSCAN_KR_CURRENT_QUOTES_TIMEOUT_MS
          ?? process.env.NAVER_CURRENT_QUOTES_TIMEOUT_MS
          ?? process.env.QUOTES_CURRENT_PROXY_TIMEOUT_MS,
        DEFAULT_DEEPSCAN_KR_CURRENT_QUOTES_TIMEOUT_MS,
      ),
    })),
    maybeResolveKrPackageResult(rawInput, input),
    captureSource('etf-snapshot', async () => (isKrExchangeProductInput(input)
      ? fetchWiseReportEtfSnapshot(input.instrument.code, {
          timeoutMs: parsePositiveInteger(
            process.env.DEEPSCAN_KR_ETF_SNAPSHOT_TIMEOUT_MS
              ?? process.env.WISEREPORT_ETF_SNAPSHOT_TIMEOUT_MS,
            DEFAULT_DEEPSCAN_KR_ETF_SNAPSHOT_TIMEOUT_MS,
          ),
        })
      : null)),
    maybeResolveKrDisclosures(rawInput, input),
  ]);

  return {
    sources: {
      ...(slimResult.value ? { slim: slimResult.value } : {}),
      ...(quotesResult.value ? { quotes: quotesResult.value } : {}),
      ...(packageResult.value ? { packageResult: packageResult.value } : {}),
      ...(etfSnapshotResult.value ? { etfSnapshot: etfSnapshotResult.value } : {}),
      ...(disclosuresResult.value ? { disclosures: disclosuresResult.value } : {}),
    },
    sourceIssues: [
      slimResult.issue,
      quotesResult.issue,
      packageResult.issue,
      etfSnapshotResult.issue,
      disclosuresResult.issue,
    ].filter(Boolean),
  };
}

function formatNumber(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'N/A';
  }

  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

function formatSignedNumber(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'N/A';
  }

  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${formatNumber(Math.abs(value))}`;
}

function formatSignedPercent(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'N/A';
  }

  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${formatNumber(Math.abs(value))}%`;
}

function formatCurrencyValue(value, currency) {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${formatNumber(value)}${currency ? ` ${currency}` : ''}`
    : 'N/A';
}

function resolveConsensusOpinionSummary(consensusSnapshot) {
  const score = consensusSnapshot?.recommendationScore;
  if (typeof score === 'number' && Number.isFinite(score)) {
    if (score >= 4.2) {
      return '모두 매수 의견이에요';
    }

    if (score >= 3.5) {
      return '매수 의견이 우세해요';
    }

    if (score >= 2.5) {
      return '의견이 갈리고 있어요';
    }

    return '신중한 의견이 많아요';
  }

  const recommendation = typeof consensusSnapshot?.recommendation === 'string'
    ? consensusSnapshot.recommendation.trim()
    : '';
  if (/strong\s*buy|매수|buy/i.test(recommendation)) {
    return '매수 의견이 우세해요';
  }

  if (/hold|neutral|중립/i.test(recommendation)) {
    return '의견이 갈리고 있어요';
  }

  if (/sell|underperform|매도/i.test(recommendation)) {
    return '신중한 의견이 많아요';
  }

  return null;
}

function resolveTargetPriceText(evidence) {
  if (isKrExchangeProductEvidence(evidence)) {
    return 'NAV·기초지수·구성종목 기준';
  }

  const consensusSnapshot = evidence?.consensusSnapshot ?? {};
  const targetPrice = typeof consensusSnapshot.targetPrice === 'number' && Number.isFinite(consensusSnapshot.targetPrice) && consensusSnapshot.targetPrice > 0
    ? consensusSnapshot.targetPrice
    : null;

  if (targetPrice !== null) {
    return formatCurrencyValue(targetPrice, evidence.currentQuote?.currency ?? evidence.marketSnapshot?.currency ?? 'KRW');
  }

  if (consensusSnapshot.targetPriceStatus === 'source_unavailable' || evidence.missingSources?.includes('slim')) {
    return '목표가 조회 실패';
  }

  return '목표가 미제공';
}

function getScoreTone(score) {
  if (score >= 70) {
    return 'positive';
  }
  if (score >= 55) {
    return 'neutral';
  }
  return 'warning';
}

function getScoreIconTone(score) {
  if (score >= 70) {
    return 'green';
  }
  if (score >= 55) {
    return 'blue';
  }
  return 'amber';
}

function getWeekSignal(decisionBand, heroScore) {
  switch (decisionBand) {
    case 'hold':
      return heroScore >= 70 ? '관찰 지속' : '보유 유지';
    case 'trim':
      return '일부 차익 검토';
    case 'exit-watch':
      return '이탈 준비';
    case 'exit-now':
      return '축소 우선';
    default:
      return '근거 보강 필요';
  }
}

function getWeekSignalTone(decisionBand) {
  switch (decisionBand) {
    case 'hold':
      return 'positive';
    case 'trim':
      return 'neutral';
    case 'exit-watch':
      return 'warning';
    case 'exit-now':
      return 'danger';
    default:
      return 'neutral';
  }
}

function getScenarioLabel(decisionBand) {
  switch (decisionBand) {
    case 'hold':
      return '보유 유지 시나리오';
    case 'trim':
      return '일부 차익 시나리오';
    case 'exit-watch':
      return '축소 대기 시나리오';
    case 'exit-now':
      return '즉시 축소 시나리오';
    default:
      return '근거 부족 시나리오';
  }
}

function getDecisionBandLabel(decisionBand) {
  switch (decisionBand) {
    case 'hold':
      return '보유 유지';
    case 'trim':
      return '일부 축소';
    case 'exit-watch':
      return '축소 대기';
    case 'exit-now':
      return '즉시 축소';
    case 'blocked':
      return '보류';
    default:
      return '근거 부족';
  }
}

function createCommitteeMember(shortLabel, title, score, reason, memberKey) {
  return {
    ...(memberKey ? { memberKey } : {}),
    shortLabel,
    title,
    status: 'success',
    reason,
    score,
    scoreLabel: String(score),
    tone: getScoreTone(score),
    iconTone: getScoreIconTone(score),
    error: null,
  };
}

function collectStructuredStrings(value, bucket = []) {
  if (typeof value === 'string') {
    const normalized = normalizeText(value);
    if (normalized) {
      bucket.push(normalized);
    }
    return bucket;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectStructuredStrings(item, bucket);
    }
    return bucket;
  }

  if (value && typeof value === 'object') {
    for (const nestedValue of Object.values(value)) {
      collectStructuredStrings(nestedValue, bucket);
    }
  }

  return bucket;
}

function splitNarrativeText(value) {
  return collectStructuredStrings(value)
    .flatMap((entry) => entry.split(/[\n\r]+|(?<=[.!?。])\s+/))
    .map((entry) => normalizeText(entry))
    .filter((entry) => entry && entry.length >= MIN_PACKAGE_REASON_LENGTH);
}

function createKrBusinessQualityReasonOverrides(packageResult) {
  if (!packageResult || typeof packageResult !== 'object') {
    return [];
  }

  const candidateTexts = [
    ...splitNarrativeText(packageResult.boardAnalysis?.boardOpinions),
    ...splitNarrativeText(packageResult.marketScoreSnapshot),
    ...splitNarrativeText(packageResult.reportContent),
  ];

  const uniqueTexts = [];
  const seen = new Set();

  for (const text of candidateTexts) {
    if (!text || seen.has(text)) {
      continue;
    }

    seen.add(text);
    uniqueTexts.push(text);
  }

  return uniqueTexts;
}

function isKrExchangeProductEvidence(evidence) {
  const market = normalizeText(evidence?.instrument?.market ?? evidence?.market)?.toUpperCase();
  const kind = normalizeText(evidence?.instrument?.kind ?? evidence?.kind)?.toLowerCase();
  return market === 'ETF' || market === 'ETN' || kind === 'etf' || kind === 'etn';
}

function createEtfCommitteeAxes(evidence, scored) {
  const quoteText = evidence.currentQuote
    ? `현재가 ${formatCurrencyValue(evidence.currentQuote.price, evidence.currentQuote.currency)}`
    : '현재가 근거 없음';
  const avgPriceText = evidence.holding.averagePrice !== null
    ? `평단 ${formatNumber(evidence.holding.averagePrice)}`
    : '평단 근거 없음';
  const reportCount = evidence.reportSignals.recentReportCount ?? 0;
  const etfSnapshot = evidence.etfProductSnapshot ?? null;
  const baseIndexName = normalizeText(etfSnapshot?.product?.baseIndexName);
  const issuerName = normalizeText(etfSnapshot?.product?.issuerName);
  const totalFeePct = etfSnapshot?.product?.totalFeePct;
  const top10WeightPct = etfSnapshot?.constituents?.top10WeightPct;
  const topHoldings = Array.isArray(etfSnapshot?.constituents?.top10)
    ? etfSnapshot.constituents.top10.slice(0, 3).map((row) => `${row.name}${typeof row.weightPct === 'number' ? ` ${formatNumber(row.weightPct)}%` : ''}`).filter(Boolean).join(', ')
    : '';
  const recentReturn1m = etfSnapshot?.marketStatus?.returns?.oneMonthPct;
  const avgVolume20 = etfSnapshot?.marketStatus?.avgTradingVolume20 ?? etfSnapshot?.liquidity?.avgTradingVolume;
  const pageCoverageText = etfSnapshot
    ? `ETF 스냅샷 반영 · TOP10 ${typeof top10WeightPct === 'number' ? `${formatNumber(top10WeightPct)}%` : '확인'}`
    : `${evidence.pageCoverage.availableCount}/${evidence.pageCoverage.totalKnownPages} KR 페이지 반영`;

  return [
    {
      label: 'ETF 구조 품질',
      score: scored.committee.businessQuality.score,
      scoreText: `${scored.committee.businessQuality.score} / 100`,
      axisStatusText: pageCoverageText,
      subtitle: '추종지수·구성·유동성 연결 범위를 반영한 ETF 품질 점수',
      avgLabel: `위원 평균 ${scored.committee.businessQuality.score}`,
      members: [
        createCommitteeMember(
          '구조',
          '상품 구조/운용 품질',
          scored.committee.businessQuality.profitability,
          etfSnapshot
            ? `기초지수 ${baseIndexName ?? '확인'}, 운용사 ${issuerName ?? '확인'}, 총보수 ${typeof totalFeePct === 'number' ? `${formatNumber(totalFeePct)}%` : '확인'}까지 ETF 상품 구조 근거를 반영했습니다.`
            : `ETF는 기업 실적 대신 추종지수·운용 구조·유동성을 봐야 하며 현재 입력은 ${quoteText}와 보유 맥락 중심입니다.`,
          'profitability',
        ),
        createCommitteeMember(
          '가격',
          '가격/NAV 단서',
          scored.committee.businessQuality.valuation,
          `ETF는 NAV 괴리와 가격 위치가 중요하며 현재 입력은 ${quoteText} 기준으로 계산했습니다.`,
          'valuation',
        ),
        createCommitteeMember(
          '분산',
          '구성/분산 안정성',
          scored.committee.businessQuality.ownershipStability,
          topHoldings
            ? `상위 구성 ${topHoldings}${typeof top10WeightPct === 'number' ? `, TOP10 ${formatNumber(top10WeightPct)}%` : ''}를 분산 안정성 근거로 반영했습니다.`
            : `구성종목·섹터 비중 데이터는 아직 연결되지 않아 분산 안정성은 ${pageCoverageText} 범위에서 보수적으로 봅니다.`,
          'ownershipStability',
        ),
      ],
    },
    {
      label: '지수/가격 흐름',
      score: scored.committee.marketTiming.score,
      scoreText: `${scored.committee.marketTiming.score} / 100`,
      axisStatusText: evidence.currentQuote ? '현재가·ETF 정보 밀도 반영' : '현재가 근거 부족',
      subtitle: '현재가, 지수/가격 흐름, 정보 밀도를 반영한 ETF 신호',
      avgLabel: `위원 평균 ${scored.committee.marketTiming.score}`,
      members: [
        createCommitteeMember(
          '흐름',
          '지수/가격 흐름',
          scored.committee.marketTiming.trend,
          typeof recentReturn1m === 'number'
            ? `ETF 스냅샷의 1개월 수익률 ${formatSignedPercent(recentReturn1m)}와 ${quoteText}를 지수/가격 흐름에 반영했습니다.`
            : `상대수익률 ${evidence.reportSignals.relativeReturnAvailable ? '확보' : '없음'}, 스타일 분석 ${evidence.reportSignals.styleAnalysisAvailable ? '확보' : '없음'}, ${quoteText} 기준입니다.`,
          'trend',
        ),
        createCommitteeMember(
          '정보',
          '시장 신호/정보 밀도',
          scored.committee.marketTiming.consensusMomentum,
          avgVolume20
            ? `ETF는 시장·지수 정보와 유동성이 중요해서 20일 평균 거래량 ${formatNumber(avgVolume20)}와 현재가 근거를 중심으로 봅니다.`
            : `ETF는 시장·지수 정보와 유동성이 중요해서 최근 리포트 ${reportCount}건과 현재가 근거를 중심으로 봅니다.`,
          'consensusMomentum',
        ),
        createCommitteeMember(
          '위치',
          '가격 위치',
          scored.committee.marketTiming.priceLocation,
          evidence.currentQuote
            ? `${quoteText}와 ${avgPriceText}의 간격을 현재 ETF 가격 위치 판단에 반영했습니다.`
            : '현재가가 없어 ETF 가격 위치 점수는 보수적으로 계산했습니다.',
          'priceLocation',
        ),
      ],
    },
    {
      label: '내 포지션 적합도',
      score: scored.committee.positionFit.score,
      scoreText: `${scored.committee.positionFit.score} / 100`,
      axisStatusText: evidence.holding.hasHoldingContext ? '보유 맥락 반영' : '보유 맥락 부족',
      subtitle: '평단, 수량, 현재가 등 내 ETF 보유 맥락을 반영한 점수',
      avgLabel: `위원 평균 ${scored.committee.positionFit.score}`,
      members: [
        createCommitteeMember(
          '평단',
          '평단 격차',
          scored.committee.positionFit.avgPriceGap,
          evidence.currentQuote && evidence.holding.averagePrice !== null
            ? `${quoteText}와 ${avgPriceText}의 차이를 보유 ETF의 현재 위치로 반영했습니다.`
            : '현재가 또는 평단이 부족해 ETF 평단 격차 점수를 보수적으로 계산했습니다.',
          'avgPriceGap',
        ),
        createCommitteeMember(
          '여지',
          '상하방 여지',
          scored.committee.positionFit.upsideBuffer,
          typeof recentReturn1m === 'number'
            ? `ETF의 상하방 여지는 기초지수 흐름과 최근 1개월 수익률 ${formatSignedPercent(recentReturn1m)}를 중심으로 봅니다.`
            : `ETF의 추가 여지는 지수 흐름과 현재 가격대가 핵심이라 현재 입력 범위에서만 보수적으로 봅니다.`,
          'upsideBuffer',
        ),
        createCommitteeMember(
          '입력',
          '입력 완성도',
          scored.committee.positionFit.holdingCompleteness,
          evidence.holding.hasFullSellNowInputs
            ? '보유 수량, 평단, 현재가가 모두 확인되어 ETF 포지션 계산이 가능합니다.'
            : '보유 수량·평단·현재가 중 일부가 없어 ETF 포지션 계산이 제한됩니다.',
          'holdingCompleteness',
        ),
      ],
    },
  ];
}

function buildEventScannerReason(evidence) {
  const disclosureAnalysis = evidence.disclosureAnalysis;
  const reportCount = evidence.reportSignals?.recentReportCount ?? 0;
  if (disclosureAnalysis?.available) {
    const totalCount = disclosureAnalysis.totalCount ?? disclosureAnalysis.count ?? 0;
    const disclosureParts = [
      `OpenDART 공시 ${formatNumber(totalCount)}건`,
      disclosureAnalysis.ownershipCount > 0 ? `지분공시 ${formatNumber(disclosureAnalysis.ownershipCount)}건` : null,
      disclosureAnalysis.correctionCount > 0 ? `정정 ${formatNumber(disclosureAnalysis.correctionCount)}건` : null,
      disclosureAnalysis.dilutionCount > 0 ? `자본변동 ${formatNumber(disclosureAnalysis.dilutionCount)}건` : null,
      disclosureAnalysis.materialEventCount > 0 ? `주요 이벤트 ${formatNumber(disclosureAnalysis.materialEventCount)}건` : null,
      disclosureAnalysis.riskCount > 0 ? `고위험 ${formatNumber(disclosureAnalysis.riskCount)}건` : '고위험 공시 없음',
    ].filter(Boolean);
    return `${disclosureParts.join(', ')}을 확인했고 최근 리포트 ${formatNumber(reportCount)}건과 함께 이벤트 신호로 반영했습니다.`;
  }

  return `OpenDART 공시 근거는 없고 컨센서스 ${evidence.reportSignals?.consensusAvailable ? '확보' : '없음'}, 의견 ${evidence.reportSignals?.opinionAvailable ? '확보' : '없음'}, 최근 리포트 ${formatNumber(reportCount)}건을 이벤트 신호로 반영했습니다.`;
}

function createCommitteeAxes(evidence, scored, packageResult) {
  if (isKrExchangeProductEvidence(evidence)) {
    return createEtfCommitteeAxes(evidence, scored);
  }

  const disclosureText = evidence.disclosureAnalysis?.available
    ? `, 최근 공시 ${formatNumber(evidence.disclosureAnalysis.totalCount ?? evidence.disclosureAnalysis.count ?? 0)}건`
    : '';
  const disclosureRiskText = evidence.disclosureAnalysis?.available && evidence.disclosureAnalysis.riskCount > 0
    ? `, 주의 공시 ${formatNumber(evidence.disclosureAnalysis.riskCount)}건`
    : '';
  const businessQualityReason = evidence.sourceCoverage.hasPackageResult
    ? `회사개요·재무·리포트·공시 근거를 합산했습니다. 최근 리포트 ${evidence.reportSignals.recentReportCount ?? 0}건${disclosureText}, package-result 확보 기준입니다.`
    : `회사개요·재무·리포트·공시 근거를 합산했습니다. 최근 리포트 ${evidence.reportSignals.recentReportCount ?? 0}건${disclosureText} 기준입니다.`;
  const businessQualityReasonOverrides = createKrBusinessQualityReasonOverrides(packageResult);
  let businessQualityReasonIndex = 0;
  const nextBusinessQualityReason = (fallbackReason) => businessQualityReasonOverrides[businessQualityReasonIndex++] ?? fallbackReason;

  return [
    {
      label: '사업 품질',
      score: scored.committee.businessQuality.score,
      scoreText: `${scored.committee.businessQuality.score} / 100`,
      axisStatusText: `${evidence.pageCoverage.availableCount}/${evidence.pageCoverage.totalKnownPages} KR 페이지 반영`,
      subtitle: '기업 체력과 리포트 확보 범위를 반영한 점수',
      avgLabel: `위원 평균 ${scored.committee.businessQuality.score}`,
      members: [
        createCommitteeMember(
          '수익성',
          '수익성/기본체력',
          scored.committee.businessQuality.profitability,
          nextBusinessQualityReason(businessQualityReason),
          'profitability',
        ),
        createCommitteeMember(
          '밸류',
          '밸류에이션',
          scored.committee.businessQuality.valuation,
          nextBusinessQualityReason(`컨센서스 ${evidence.reportSignals.consensusAvailable ? '확보' : '없음'}, 의견 ${evidence.reportSignals.opinionAvailable ? '확보' : '없음'}, 현재가 ${evidence.currentQuote ? '확보' : '없음'}를 반영했습니다.`),
          'valuation',
        ),
        createCommitteeMember(
          '지배',
          '지분/안정성',
          scored.committee.businessQuality.ownershipStability,
          nextBusinessQualityReason(`보유 맥락 ${evidence.holding.hasHoldingContext ? '확인' : '없음'}, 스타일/지분 페이지 ${evidence.reportSignals.styleAnalysisAvailable || evidence.pageCoverage.availablePageIds.includes('shareholding') ? '일부 확보' : '부족'}${disclosureText}${disclosureRiskText} 상태입니다.`),
          'ownershipStability',
        ),
      ],
    },
    {
      label: '시장 타이밍',
      score: scored.committee.marketTiming.score,
      scoreText: `${scored.committee.marketTiming.score} / 100`,
      axisStatusText: evidence.currentQuote ? '현재가·리포트 모멘텀 반영' : '현재가 근거 부족',
      subtitle: '현재가, 컨센서스, 최근 리포트 흐름 기반 신호',
      avgLabel: `위원 평균 ${scored.committee.marketTiming.score}`,
      members: [
        createCommitteeMember(
          '트렌드',
          '트렌드',
          scored.committee.marketTiming.trend,
          `상대수익률 ${evidence.reportSignals.relativeReturnAvailable ? '확보' : '없음'}, 스타일 분석 ${evidence.reportSignals.styleAnalysisAvailable ? '확보' : '없음'}, 최근 리포트 ${evidence.reportSignals.recentReportsAvailable ? '확보' : '없음'}${disclosureText} 기준입니다.`,
          'trend',
        ),
        createCommitteeMember(
          '이벤트',
          '이벤트 스캐너',
          scored.committee.marketTiming.consensusMomentum,
          buildEventScannerReason(evidence),
          'consensusMomentum',
        ),
        createCommitteeMember(
          '가격',
          '가격 위치',
          scored.committee.marketTiming.priceLocation,
          evidence.currentQuote
            ? `현재가 ${formatCurrencyValue(evidence.currentQuote.price, evidence.currentQuote.currency)}와 평단 ${formatNumber(evidence.holding.averagePrice)} 비교 기준입니다.`
            : '현재가가 없어 가격 위치 점수는 보수적으로 계산했습니다.',
          'priceLocation',
        ),
      ],
    },
    {
      label: '포지션 적합도',
      score: scored.committee.positionFit.score,
      scoreText: `${scored.committee.positionFit.score} / 100`,
      axisStatusText: evidence.holding.hasHoldingContext ? '보유 맥락 반영' : '보유 맥락 부족',
      subtitle: '현재 포지션의 손익과 입력 완성도를 반영한 점수',
      avgLabel: `위원 평균 ${scored.committee.positionFit.score}`,
      members: [
        createCommitteeMember(
          '평단',
          '평단 격차',
          scored.committee.positionFit.avgPriceGap,
          evidence.currentQuote && evidence.holding.averagePrice !== null
            ? `현재가 ${formatNumber(evidence.currentQuote.price)} 대비 평단 ${formatNumber(evidence.holding.averagePrice)} 간격을 반영했습니다.`
            : '현재가 또는 평단이 부족해 평단 격차 점수를 보수적으로 계산했습니다.',
          'avgPriceGap',
        ),
        createCommitteeMember(
          '여지',
          '상방 버퍼',
          scored.committee.positionFit.upsideBuffer,
          `컨센서스 ${evidence.reportSignals.consensusAvailable ? '확보' : '없음'}, 의견 ${evidence.reportSignals.opinionAvailable ? '확보' : '없음'}, 최근 리포트 ${evidence.reportSignals.recentReportsAvailable ? '확보' : '없음'}${disclosureRiskText} 반영입니다.`,
          'upsideBuffer',
        ),
        createCommitteeMember(
          '입력',
          '입력 완성도',
          scored.committee.positionFit.holdingCompleteness,
          evidence.holding.hasFullSellNowInputs
            ? '보유 수량, 평단, 현재가가 모두 확인되어 즉시 매도 계산이 가능합니다.'
            : '보유 수량·평단·현재가 중 일부가 없어 즉시 매도 계산이 제한됩니다.',
          'holdingCompleteness',
        ),
      ],
    },
  ];
}

function createEvidenceFallback(evidence, sourceIssues) {
  const missingSources = evidence.missingSources.filter((sourceId) => sourceId !== 'package-result');
  const blockingSourceIssues = sourceIssues.filter((issue) => issue.sourceId !== 'package-result');

  if (missingSources.length === 0 && blockingSourceIssues.length === 0) {
    return null;
  }

  const labels = [...missingSources, ...blockingSourceIssues.map((issue) => issue.sourceId)].filter(Boolean);
  return {
    used: true,
    reason: 'missing-sources',
    label: labels.length > 0 ? `missing:${labels.join(',')}` : 'missing-sources',
  };
}

function createEvidenceSourceRefs(input, evidence, sources, sourceIssues) {
  const sourceRefs = [];
  const identifier = input.instrument.code ?? input.instrument.ticker ?? input.instrument.name;

  if (sources.slim) {
    sourceRefs.push(createDeepScanSourceRef({
      type: 'report',
      id: `wisereport-kr-slim:${identifier}`,
      label: '국내 요약 리포트 근거',
      note: `페이지 ${evidence.pageCoverage.availableCount}/${evidence.pageCoverage.totalKnownPages}`,
    }));
  }

  if (evidence.currentQuote) {
    sourceRefs.push(createDeepScanSourceRef({
      type: 'market',
      id: `current-quote:${identifier}`,
      label: '현재가',
      at: evidence.currentQuote.asOf ?? input.selectedAt,
      note: evidence.currentQuote.source ?? undefined,
    }));
  } else if (sources.quotes) {
    sourceRefs.push(createDeepScanSourceRef({
      type: 'market',
      id: `current-quote:${identifier}`,
      label: '현재가 조회',
      note: '일치하는 현재가 없음',
    }));
  }

  if (sources.packageResult) {
    sourceRefs.push(createDeepScanSourceRef({
      type: 'report',
      id: `package-result:${identifier}`,
      label: '국내 패키지 보조 근거',
      at: sources.packageResult.timestamp,
      note: normalizeText(sources.packageResult.listingMarket) ?? undefined,
    }));
  }

  if (sources.disclosures) {
    const totalCount = Number(evidence.disclosureAnalysis?.totalCount ?? sources.disclosures?.summary?.totalCount);
    sourceRefs.push(createDeepScanSourceRef({
      type: 'report',
      id: `opendart-disclosures:${identifier}`,
      label: 'OpenDART 공시 목록',
      at: evidence.disclosureAnalysis?.latestReceiptDate ?? sources.disclosures?.summary?.latestReceiptDate ?? undefined,
      note: Number.isFinite(totalCount) ? `최근 공시 ${totalCount}건` : '공시 목록 분석',
    }));
  }

  for (const missingSource of evidence.missingSources) {
    sourceRefs.push(createDeepScanSourceRef({
      type: 'system',
      id: `missing-source:${missingSource}:${identifier}`,
      label: `${missingSource} 누락`,
    }));
  }

  for (const issue of sourceIssues) {
    sourceRefs.push(createDeepScanSourceRef({
      type: 'system',
      id: `source-issue:${issue.sourceId}:${identifier}`,
      label: `${issue.sourceId} 사용 불가`,
      note: issue.message,
    }));
  }

  return sourceRefs;
}


function shouldSummarizePerformanceCommentWithLlm() {
  const explicitToggle = normalizeText(process.env.DEEPSCAN_COMMENTARY_SUMMARY_ENABLE)?.toLowerCase();
  if (['0', 'false', 'off', 'no'].includes(explicitToggle ?? '')) {
    return false;
  }

  if (!process.env.OPENROUTER_API_KEY) {
    return false;
  }

  if (['1', 'true', 'on', 'yes'].includes(explicitToggle ?? '')) {
    return true;
  }

  return shouldInvokeKrCommitteeLlm();
}

function createCommentarySummarySchema() {
  return {
    name: 'jaroo_performance_comment_summary',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        lines: {
          type: 'array',
          minItems: 3,
          maxItems: 3,
          items: {
            type: 'string',
            minLength: 1,
            maxLength: 90,
          },
        },
      },
      required: ['lines'],
    },
  };
}

function extractTextContent(content) {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .join('')
      .trim();
  }

  return '';
}

function normalizeSummaryLines(value) {
  const lines = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/\n+/)
      : [];

  return lines
    .map((line) => normalizeText(String(line ?? '').replace(/^\s*(?:[-•]|\d+[.)])\s+/, '')))
    .filter(Boolean)
    .slice(0, 3);
}

function extractNumericCores(value) {
  const text = normalizeText(value) ?? '';
  const matches = text.match(/(?<![A-Za-z가-힣])[+\-−]?\d+(?:[.,]\d+)*/gu) ?? [];
  return [...new Set(matches.map((token) => token.replace('−', '-').replace(/,/g, '')).filter(Boolean))];
}

function summaryPreservesNumbers(sourceText, summaryLines) {
  const sourceNumbers = extractNumericCores(sourceText);
  if (sourceNumbers.length === 0) {
    return true;
  }

  const summaryText = summaryLines.join(' ').replace(/,/g, '');
  return sourceNumbers.every((number) => summaryText.includes(number));
}

function simplifyCommentaryText(text) {
  return text
    .replace(/전년동기\s*대비/g, '작년 같은 때보다')
    .replace(/연결기준/g, '')
    .replace(/매출액/g, '매출')
    .replace(/영업이익/g, '본업 이익')
    .replace(/당기순이익/g, '순이익')
    .replace(/CAPEX/gi, '투자')
    .replace(/서버향/g, '서버용')
    .replace(/공급량을 초과하여/g, '물건이 모자랄 만큼 많아져')
    .replace(/공급량을 초과/g, '물건이 모자랄 만큼 많아져')
    .replace(/실적이 개선됨/g, '실적이 좋아졌어요')
    .replace(/전망됨/g, '예상돼요')
    .replace(/예상됨/g, '예상돼요')
    .replace(/확대가 전망/g, '늘어날 것으로 보여요')
    .replace(/\s+/g, ' ')
    .trim();
}

function trimLine(value, maxLength = 74) {
  const normalized = normalizeText(value.replace(/\s+/g, ' ')) ?? '';
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trim()}…`;
}

function extractMetricPercent(text, metricName) {
  const escapedMetric = metricName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`${escapedMetric}[^0-9+\\-−]{0,20}([+\\-−]?\\d+(?:\\.\\d+)?%)`));
  return match?.[1]?.replace('−', '-') ?? null;
}

function createLocalPerformanceCommentSummary(comment) {
  const text = String(comment?.text ?? '');
  const sourceSentences = Array.isArray(comment?.sentences) && comment.sentences.length > 0
    ? comment.sentences
    : text.split(/(?<=[.!?。]|다\.|요\.)\s+/);
  const year = text.match(/(?<![A-Za-z가-힣])(\d{4}년)/u)?.[1] ?? null;
  const sales = extractMetricPercent(text, '매출액') ?? extractMetricPercent(text, '매출');
  const operatingProfit = extractMetricPercent(text, '영업이익');
  const netProfit = extractMetricPercent(text, '당기순이익') ?? extractMetricPercent(text, '순이익');
  const metricLines = [];

  if (sales) {
    metricLines.push(`${year ? `${year} 기준, ` : ''}매출은 ${sales} 늘었어요.`);
  }
  if (operatingProfit || netProfit) {
    metricLines.push([
      operatingProfit ? `본업 이익은 ${operatingProfit} 늘었어요.` : null,
      netProfit ? `순이익은 ${netProfit} 늘었어요.` : null,
    ].filter(Boolean).join(' '));
  }

  const simplified = sourceSentences
    .filter((sentence) => metricLines.length === 0 || !/(매출액|매출|영업이익|당기순이익|순이익)/.test(sentence))
    .map((sentence) => trimLine(simplifyCommentaryText(sentence)))
    .filter(Boolean)
    .filter((line) => !metricLines.some((metricLine) => metricLine.includes(line) || line.includes(metricLine)));
  const lines = [...metricLines, ...simplified].map((line) => trimLine(line)).slice(0, 3);

  if (lines.length === 2) {
    lines.push('어려운 말보다 숫자와 수요 변화를 먼저 보면 돼요.');
  }

  return lines.length === 3 ? lines : [];
}

async function summarizePerformanceCommentForLoading(input, performanceComment) {
  if (!performanceComment?.text) {
    return null;
  }

  const fallbackLines = createLocalPerformanceCommentSummary(performanceComment);
  if (!shouldSummarizePerformanceCommentWithLlm()) {
    return fallbackLines.length === 3 ? { lines: fallbackLines, method: 'local' } : null;
  }

  const model = process.env.DEEPSCAN_COMMENTARY_SUMMARY_MODEL
    ?? process.env.DEEPSCAN_KR_LLM_MODEL
    ?? process.env.DEEPSCAN_LLM_MODEL
    ?? DEFAULT_DEEPSCAN_KR_LLM_MODEL;
  const timeoutMs = parsePositiveInteger(
    process.env.DEEPSCAN_COMMENTARY_SUMMARY_TIMEOUT_MS ?? process.env.DEEPSCAN_LLM_TIMEOUT_MS,
    DEFAULT_COMMENTARY_SUMMARY_TIMEOUT_MS,
  );

  try {
    const upstreamResponse = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.DEEPSCAN_OPENROUTER_REFERER ?? 'http://localhost:3000',
        'X-Title': 'jaroo-mvp-v3 DeepScan Commentary Summary',
      },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model,
        temperature: 0.1,
        provider: { require_parameters: true },
        response_format: {
          type: 'json_schema',
          json_schema: createCommentarySummarySchema(),
        },
        messages: [
          {
            role: 'system',
            content: [
              '너는 한국 주식 리포트를 중학생도 이해할 수 있게 쉬운 한국어로 바꾸는 편집자다.',
              '전문용어는 쉬운 말로 풀어쓰고, 원문에 나온 숫자/연도/퍼센트는 절대 빼거나 바꾸지 마라.',
              '정확히 3줄로 요약하라. 각 줄은 짧고 자연스러운 문장이어야 한다.',
            ].join(' '),
          },
          {
            role: 'user',
            content: JSON.stringify({
              company: input.instrument.name,
              code: input.instrument.code,
              asOf: performanceComment.asOf,
              sourceText: performanceComment.text,
            }),
          },
        ],
      }),
    });

    const result = await upstreamResponse.json().catch(() => null);
    if (!upstreamResponse.ok || result?.error) {
      return fallbackLines.length === 3 ? { lines: fallbackLines, method: 'local-fallback' } : null;
    }

    const rawContent = extractTextContent(result?.choices?.[0]?.message?.content);
    const parsed = rawContent ? JSON.parse(rawContent) : null;
    const lines = normalizeSummaryLines(parsed?.lines);
    if (lines.length !== 3 || !summaryPreservesNumbers(performanceComment.text, lines)) {
      return fallbackLines.length === 3 ? { lines: fallbackLines, method: 'local-fallback' } : null;
    }

    return { lines, method: 'llm' };
  } catch {
    return fallbackLines.length === 3 ? { lines: fallbackLines, method: 'local-fallback' } : null;
  }
}

function buildDisclosureInsightBody(disclosureAnalysis) {
  if (!disclosureAnalysis?.available) {
    return null;
  }

  const periodLabel = [disclosureAnalysis.periodFrom, disclosureAnalysis.periodTo]
    .filter(Boolean)
    .join('~');
  const leadingType = Array.isArray(disclosureAnalysis.topReportTypes)
    ? disclosureAnalysis.topReportTypes[0]
    : null;
  const parts = [
    `${periodLabel ? `${periodLabel} ` : ''}공시 ${formatNumber(disclosureAnalysis.totalCount ?? disclosureAnalysis.count ?? 0)}건`,
    leadingType ? `${leadingType.reportName} ${formatNumber(leadingType.count)}건` : null,
    disclosureAnalysis.ownershipCount > 0 ? `지분/주요주주 ${formatNumber(disclosureAnalysis.ownershipCount)}건` : null,
    disclosureAnalysis.periodicReportCount > 0 ? `정기보고서 ${formatNumber(disclosureAnalysis.periodicReportCount)}건` : null,
    disclosureAnalysis.correctionCount > 0 ? `정정 ${formatNumber(disclosureAnalysis.correctionCount)}건` : null,
    disclosureAnalysis.dilutionCount > 0 ? `자본변동 ${formatNumber(disclosureAnalysis.dilutionCount)}건` : null,
    disclosureAnalysis.riskCount > 0 ? `주요 리스크 ${formatNumber(disclosureAnalysis.riskCount)}건` : '주요 리스크 공시 없음',
  ].filter(Boolean);

  return parts.join(' · ');
}

function buildDisclosureInsightSourceBody(disclosureAnalysis) {
  if (!Array.isArray(disclosureAnalysis?.latestFilings) || disclosureAnalysis.latestFilings.length === 0) {
    return undefined;
  }

  return disclosureAnalysis.latestFilings
    .slice(0, 8)
    .map((filing) => [
      filing.receiptDate,
      filing.reportName,
      filing.filerName ? `제출:${filing.filerName}` : null,
      filing.riskLabel,
    ].filter(Boolean).join(' · '))
    .join('\n');
}

function buildInsights(input, evidence, scored, generatedAt, sourceIssues, options = {}) {
  const dateLabel = (input.selectedAt ?? generatedAt).slice(0, 10);
  const performanceComment = evidence.businessCommentary?.performanceComment ?? null;
  const performanceCommentSummary = options.performanceCommentSummary ?? null;
  const performanceCommentBody = Array.isArray(performanceCommentSummary?.lines) && performanceCommentSummary.lines.length === 3
    ? performanceCommentSummary.lines.join('\n')
    : performanceComment?.text;
  const quoteVolume = typeof evidence.currentQuote?.volume === 'number' && Number.isFinite(evidence.currentQuote.volume)
    ? evidence.currentQuote.volume
    : null;
  const consensusSnapshot = evidence.consensusSnapshot ?? {};
  const consensusTargetPrice = typeof consensusSnapshot.targetPrice === 'number' && Number.isFinite(consensusSnapshot.targetPrice) && consensusSnapshot.targetPrice > 0
    ? consensusSnapshot.targetPrice
    : null;
  const consensusTargetGapPct = typeof consensusSnapshot.targetGapPct === 'number' && Number.isFinite(consensusSnapshot.targetGapPct)
    ? consensusSnapshot.targetGapPct
    : null;
  const consensusRecommendation = typeof consensusSnapshot.recommendation === 'string' && consensusSnapshot.recommendation.trim()
    ? consensusSnapshot.recommendation.trim()
    : null;
  const consensusOpinionSummary = resolveConsensusOpinionSummary(consensusSnapshot);
  const consensusRecommendationScore = typeof consensusSnapshot.recommendationScore === 'number' && Number.isFinite(consensusSnapshot.recommendationScore)
    ? consensusSnapshot.recommendationScore
    : null;
  const consensusAnalystCount = typeof consensusSnapshot.analystCount === 'number' && Number.isFinite(consensusSnapshot.analystCount)
    ? consensusSnapshot.analystCount
    : null;
  const consensusHighestTargetPrice = typeof consensusSnapshot.highestTargetPrice === 'number' && Number.isFinite(consensusSnapshot.highestTargetPrice)
    ? consensusSnapshot.highestTargetPrice
    : null;
  const consensusLowestTargetPrice = typeof consensusSnapshot.lowestTargetPrice === 'number' && Number.isFinite(consensusSnapshot.lowestTargetPrice)
    ? consensusSnapshot.lowestTargetPrice
    : null;
  const disclosureAnalysis = evidence.disclosureAnalysis ?? null;
  const disclosureInsightBody = buildDisclosureInsightBody(disclosureAnalysis);
  const items = [
    {
      sourceType: evidence.currentQuote ? 'market' : 'system',
      sourceLabel: '현재가',
      date: evidence.currentQuote?.asOf ?? dateLabel,
      label: '현재가',
      title: `${input.instrument.name} 현재가 근거`,
      body: evidence.currentQuote
        ? `${formatCurrencyValue(evidence.currentQuote.price, evidence.currentQuote.currency)} 확인`
        : '현재가 근거 없음',
    },
    ...(quoteVolume !== null
      ? [{
          sourceType: 'market',
          sourceLabel: '거래량',
          date: evidence.currentQuote?.asOf ?? dateLabel,
          label: '거래량',
          title: `${input.instrument.name} 거래량`,
          body: `거래량 ${formatNumber(quoteVolume)}주 확인`,
        }]
      : []),
    ...(consensusTargetPrice !== null || consensusRecommendation
      ? [{
          sourceType: 'report',
          sourceLabel: '증권사 의견',
          date: dateLabel,
          label: '컨센서스',
          title: `${input.instrument.name} 증권사 컨센서스`,
          body: [
            consensusTargetPrice !== null
              ? `${consensusAnalystCount !== null ? `증권사 ${consensusAnalystCount}곳 ` : ''}평균 목표가 ${formatCurrencyValue(consensusTargetPrice, evidence.currentQuote?.currency ?? 'KRW')}`
              : null,
            consensusTargetGapPct !== null
              ? `현재가 대비 ${formatSignedPercent(consensusTargetGapPct)}`
              : null,
            consensusOpinionSummary,
            consensusRecommendationScore !== null
              ? `투자의견 ${formatNumber(consensusRecommendationScore)}`
              : (consensusRecommendation ? `투자의견 ${consensusRecommendation}` : null),
            consensusHighestTargetPrice !== null && consensusLowestTargetPrice !== null
              ? `최고 ${formatCurrencyValue(consensusHighestTargetPrice, evidence.currentQuote?.currency ?? 'KRW')} / 최저 ${formatCurrencyValue(consensusLowestTargetPrice, evidence.currentQuote?.currency ?? 'KRW')}`
              : null,
          ].filter(Boolean).join(' · '),
          // Structured mirror of the above body so the web client can read
          // the exact numbers instead of reverse-parsing `body`.
          consensus: {
            targetPrice: consensusTargetPrice,
            targetGapPct: consensusTargetGapPct,
            analystCount: consensusAnalystCount,
            recommendation: consensusRecommendation,
            recommendationScore: consensusRecommendationScore,
            highestTargetPrice: consensusHighestTargetPrice,
            lowestTargetPrice: consensusLowestTargetPrice,
            opinionSummary: consensusOpinionSummary,
            currency: evidence.currentQuote?.currency ?? 'KRW',
          },
        }]
      : []),
    {
      sourceType: 'report',
      sourceLabel: '국내 리포트',
      date: dateLabel,
      label: '리포트',
      title: '국내 리포트 페이지 범위',
      body: evidence.pageCoverage.availableCount > 0
        ? `국내 리포트 페이지 ${evidence.pageCoverage.availableCount}/${evidence.pageCoverage.totalKnownPages} 확보`
        : '국내 리포트 페이지 근거 없음',
    },
    ...(performanceComment?.text
      ? [{
          sourceType: 'report',
          sourceLabel: '기업실적코멘트',
          date: performanceComment.asOf ?? dateLabel,
          label: '실적',
          title: '기업실적코멘트 쉽게 보기',
          body: performanceCommentBody,
          sourceBody: performanceComment.text,
        }]
      : []),
    ...(disclosureInsightBody
      ? [{
          sourceType: 'report',
          sourceLabel: '공시 분석',
          date: disclosureAnalysis.latestReceiptDate ?? dateLabel,
          label: disclosureAnalysis.riskCount > 0 || disclosureAnalysis.correctionCount > 0 || disclosureAnalysis.dilutionCount > 0 ? '공시주의' : '공시',
          title: `${input.instrument.name} 최근 OpenDART 공시 흐름`,
          body: disclosureInsightBody,
          ...(buildDisclosureInsightSourceBody(disclosureAnalysis) ? { sourceBody: buildDisclosureInsightSourceBody(disclosureAnalysis) } : {}),
        }]
      : []),
    {
      sourceType: evidence.holding.hasHoldingContext ? 'holding' : 'system',
      sourceLabel: '보유 맥락',
      date: dateLabel,
      label: '보유',
      title: '보유 포지션 맥락',
      body: evidence.holding.hasHoldingContext
        ? (evidence.holding.hasFullSellNowInputs
          ? `보유 ${formatNumber(evidence.holding.shares)}주 / 평단 ${formatNumber(evidence.holding.averagePrice)} 확인`
          : '보유 맥락 일부 확인')
        : '국내 보유 맥락 없음',
    },
  ];

  if (sourceIssues.length > 0 || evidence.missingSources.length > 0) {
    items.push({
      sourceType: 'system',
      sourceLabel: '소스 범위',
      date: generatedAt.slice(0, 10),
      label: '소스',
      title: '누락 또는 실패한 소스',
      body: [
        ...evidence.missingSources.map((sourceId) => `${sourceId} 없음`),
        ...sourceIssues.map((issue) => `${issue.sourceId} 실패`),
      ].join(' / '),
    });
  }

  return {
    sectionLabel: '국내 근거 스냅샷',
    items,
    summaryTags: [
      `점수 ${scored.hero.score}`,
      `리포트 ${evidence.pageCoverage.availableCount}/${evidence.pageCoverage.totalKnownPages}`,
      ...(disclosureAnalysis?.available ? [`공시 ${formatNumber(disclosureAnalysis.totalCount ?? disclosureAnalysis.count ?? 0)}건`] : []),
      `판단 ${getDecisionBandLabel(scored.sellNow.decisionBand)}`,
    ],
  };
}


function clampNumber(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return min;
  }
  return Math.min(max, Math.max(min, numeric));
}

function buildNormalizedScenarioProbabilities(heroScore, hasExplicitRisk, riskSignalCount) {
  const primary = Math.round(clampNumber(heroScore, 5, hasExplicitRisk ? 90 : 95));
  if (!hasExplicitRisk) {
    return {
      primary,
      support: Math.max(0, 100 - primary),
      risk: null,
    };
  }

  const desiredRisk = Math.round(clampNumber(riskSignalCount > 0 ? riskSignalCount * 10 : 10, 10, 30));
  const risk = Math.min(desiredRisk, Math.max(0, 100 - primary));
  return {
    primary,
    support: Math.max(0, 100 - primary - risk),
    risk,
  };
}

function buildStrategy(input, evidence, scored) {
  const decisionBand = scored.sellNow.decisionBand;
  const hasExplicitRisk = evidence.topRisks.length > 0 || evidence.missingSources.length > 0;
  const currentPriceText = evidence.currentQuote
    ? formatCurrencyValue(evidence.currentQuote.price, evidence.currentQuote.currency)
    : '현재가 근거 없음';
  const scenarioDetails = [
    ...evidence.topFacts,
    ...evidence.topRisks.slice(0, 2),
    ...scored.hero.penalties.map((penalty) => `패널티: ${penalty}`),
  ].slice(0, 4);

  const probabilities = buildNormalizedScenarioProbabilities(
    scored.hero.score,
    hasExplicitRisk,
    Math.max(evidence.missingSources.length, evidence.topRisks.length),
  );

  return {
    weekSignal: getWeekSignal(decisionBand, scored.hero.score),
    weekSignalTone: getWeekSignalTone(decisionBand),
    weekBadgeText: scored.hero.statusText,
    scenarioLabel: getScenarioLabel(decisionBand),
    scenarioProbability: `${probabilities.primary}%`,
    scenarioPeriod: evidence.currentQuote?.asOf ? `${evidence.currentQuote.asOf} 기준 1-2주` : '1~2주',
    scenarioCondition: evidence.topRisks[0] ?? '추가 리스크 없음',
    currentPriceText,
    targetPriceText: resolveTargetPriceText(evidence),
    scenarioDetails: scenarioDetails.length > 0 ? scenarioDetails : ['확보된 근거가 부족합니다.'],
    otherScenarios: [
      {
        label: '근거 유지',
        probability: `${probabilities.support}%`,
        condition: evidence.topFacts[0] ?? '핵심 근거를 다시 확보합니다.',
      },
      ...(hasExplicitRisk ? [{
        label: '리스크 재점검',
        probability: `${probabilities.risk ?? 0}%`,
        condition: evidence.topRisks[0] ?? '추가 리스크를 다시 확인합니다.',
      }] : []),
    ],
    otherScenarioTags: [getDecisionBandLabel(decisionBand), evidence.currentQuote ? '현재가 확인' : '현재가 없음'],
  };
}

function buildSellNow(evidence, scored) {
  if (!scored.sellNow.available) {
    return {
      realizedText: '현재가 또는 보유 평단 근거가 부족해 즉시 매도 판단을 계산하지 못했습니다.',
      rows: [
        {
          label: '판단 상태',
          value: '판단 보류',
          tag: '판단',
          tagTone: 'warning',
          emphasis: true,
        },
        {
          label: '현재가',
          value: evidence.currentQuote ? formatCurrencyValue(evidence.currentQuote.price, evidence.currentQuote.currency) : '현재가 근거 없음',
          tag: '현재가',
          tagTone: evidence.currentQuote ? 'positive' : 'warning',
        },
        {
          label: '평단',
          value: evidence.holding.averagePrice !== null ? formatNumber(evidence.holding.averagePrice) : '평단 근거 없음',
          tag: '평단',
          tagTone: evidence.holding.averagePrice !== null ? 'neutral' : 'warning',
        },
      ],
    };
  }

  const currency = evidence.currentQuote?.currency ?? 'KRW';
  const decisionBandLabel = getDecisionBandLabel(scored.sellNow.decisionBand);
  return {
    realizedText: `현재가 기준 평가손익 ${formatSignedNumber(scored.sellNow.evaluationPnL)} ${currency} (${formatSignedPercent(scored.sellNow.evaluationPnLPct)}). 즉시 매도 판단은 ${decisionBandLabel}입니다.`,
    rows: [
      {
        label: '판단 밴드',
        value: decisionBandLabel,
        tag: '판단',
        tagTone: 'positive',
        emphasis: true,
      },
      {
        label: '현재가',
        value: formatCurrencyValue(scored.sellNow.currentPrice, currency),
        tag: '현재가',
        tagTone: 'positive',
      },
      {
        label: '평단',
        value: formatNumber(scored.sellNow.averagePrice),
        tag: '평단',
        tagTone: 'neutral',
      },
      {
        label: '평가손익',
        value: `${formatSignedNumber(scored.sellNow.evaluationPnL)} ${currency} / ${formatSignedPercent(scored.sellNow.evaluationPnLPct)}`,
        tag: '손익',
        tagTone: scored.sellNow.evaluationPnL >= 0 ? 'positive' : 'danger',
      },
    ],
  };
}

function buildPortfolioSimulation(scored) {
  if (!scored.portfolioSimulation.available) {
    return {
      beforeScore: 0,
      afterScore: 0,
      deltaLabel: 'N/A',
      caption: '현재가 또는 보유 근거가 부족해 포트폴리오 시뮬레이션을 계산할 수 없습니다.',
    };
  }

  return {
    beforeScore: scored.portfolioSimulation.beforeScore,
    afterScore: scored.portfolioSimulation.afterScore,
    deltaLabel: scored.portfolioSimulation.deltaLabel
      .replace(/^hold:/, '보유:')
      .replace(/^trim:/, '축소:')
      .replace(/^exit-watch:/, '축소대기:')
      .replace(/^exit-now:/, '즉시축소:'),
    caption: `${getDecisionBandLabel(scored.sellNow.decisionBand)} 판단 기준 포지션 제거 시 포트폴리오 점수 ${scored.portfolioSimulation.beforeScore} → ${scored.portfolioSimulation.afterScore}.`,
  };
}

export async function buildJarooDeepScanPayload(rawInput = {}) {
  try {
    const input = normalizeInput(rawInput);

    if (!input.instrument.code && !input.instrument.ticker) {
      return createInputInvalidPayload(rawInput);
    }

    const generatedAt = deriveGeneratedAt(input);
    const { sources, sourceIssues } = await resolveKrSourceBundle(rawInput, input);
    const evidence = isKrInput(input)
      ? buildDeepScanKrEvidencePacket(input, sources)
      : buildDeepScanKrEvidencePacket(input, {});
    const deterministicScored = scoreDeepScanKrEvidence(evidence);
    let scored = deterministicScored;
    const evidenceSourceRefs = createEvidenceSourceRefs(input, evidence, sources, sourceIssues);
    const llmSourceRefs = [];
    let llmCommitteeErrors = [];
    let llmCommitteePending = [];
    let llmCommitteeMetadata = null;
    let llmCommitteeBlocked = false;
    let llmCommitteePartialError = false;
    let llmCommitteePartialPending = false;
    let committeeAxes = createCommitteeAxes(evidence, deterministicScored, sources.packageResult);
    const performanceCommentSummaryPromise = summarizePerformanceCommentForLoading(input, evidence.businessCommentary?.performanceComment);
    const llmAttempted = isKrInput(input) && shouldInvokeKrCommitteeLlm();

    if (llmAttempted) {
      const llmCommittee = await scoreDeepScanKrCommitteeFromDump(rawInput, input, evidence, sources);
      llmCommitteeErrors = llmCommittee.errors;
      llmCommitteePending = Array.isArray(llmCommittee.pending) ? llmCommittee.pending : [];
      llmCommitteeMetadata = {
        requestId: llmCommittee.requestId,
        status: llmCommittee.status ?? (llmCommitteePending.length > 0 ? 'partial' : llmCommitteeErrors.length > 0 ? 'error' : 'complete'),
        completed: Number.isFinite(Number(llmCommittee.completed)) ? Number(llmCommittee.completed) : Object.keys(llmCommittee.results ?? {}).length,
        pending: llmCommitteePending.length,
        errors: llmCommitteeErrors.length,
        softDeadlineMs: llmCommittee.softDeadlineMs,
      };
      llmSourceRefs.push(createDeepScanSourceRef({
        type: 'system',
        id: `kr-llm:${input.instrument.code ?? input.instrument.name}`,
        label: '국내 LLM 위원회 실행 기록',
        note: llmCommittee.requestId,
      }));

      const llmCommitteeShape = buildKrCommitteeAxesFromLlmResults(evidence, llmCommittee.results, llmCommittee.errors, llmCommitteePending);
      committeeAxes = llmCommitteeShape.axes;
      llmCommitteePartialError = llmCommitteeShape.hasMemberErrors === true;
      llmCommitteePartialPending = llmCommitteeShape.hasPendingMembers === true;
      if (!llmCommitteePartialError && llmCommitteeShape.committeeScores) {
        scored = scoreDeepScanKrFromCommittee(evidence, llmCommitteeShape.committeeScores);
      }
    }

    const combinedSourceRefs = [...evidenceSourceRefs, ...llmSourceRefs];
    const llmFallback = llmCommitteeErrors.length > 0 || llmCommitteeBlocked || llmCommitteePartialError || llmCommitteePartialPending
      ? {
          used: true,
          reason: llmCommitteePartialError
            ? 'kr-committee-member-errors'
            : llmCommitteePartialPending
              ? 'kr-committee-members-pending'
              : llmCommitteeBlocked ? 'kr-committee-coverage-blocked' : 'weak-data-degradation',
          label: llmCommitteePartialError
            ? `일부 국내 위원 응답 실패 ${llmCommitteeErrors.length}건`
            : llmCommitteePartialPending
              ? `일부 국내 위원 분석 보강 중 ${llmCommitteePending.length}명`
              : llmCommitteeBlocked ? '일부 국내 위원 축 근거가 부족합니다.' : `일부 국내 위원 실패 ${llmCommitteeErrors.length}건`,
        }
      : null;
    const blockFallback = llmFallback ?? createEvidenceFallback(evidence, sourceIssues);
    const performanceCommentSummary = await performanceCommentSummaryPromise;
    const insights = buildInsights(input, evidence, scored, generatedAt, sourceIssues, { performanceCommentSummary });
    const strategy = buildStrategy(input, evidence, scored);
    const sellNow = buildSellNow(evidence, scored);
    const portfolioSimulation = buildPortfolioSimulation(scored);
    const heroBodyParts = [...evidence.topFacts];

    for (const risk of evidence.topRisks.slice(0, 2)) {
      heroBodyParts.push(`주의: ${risk}`);
    }
    if (evidence.pageCoverage.availableCount === 0 && !heroBodyParts.some((part) => part.includes('국내 리포트 페이지 근거 없음'))) {
      heroBodyParts.push('주의: 국내 리포트 페이지 근거 없음');
    }
    if (heroBodyParts.length === 0 && evidence.missingSources.length > 0) {
      heroBodyParts.push(`누락 소스: ${evidence.missingSources.join(', ')}`);
    }

    const hero = {
      ...(llmCommitteeBlocked
        ? createBlockedBlockMeta({
            sourceRefs: createBlockSourceRefs(input, 'hero', combinedSourceRefs),
            fallback: blockFallback,
            error: createDeepScanBlockError({
              code: 'kr-committee-coverage-blocked',
              message: '위원회 축 근거가 부족해 대표 분석 블록이 보류되었습니다.',
              retryable: true,
            }),
          })
        : createOkBlockMeta({ sourceRefs: createBlockSourceRefs(input, 'hero', combinedSourceRefs), fallback: blockFallback })),
      headline: llmCommitteeBlocked || llmCommitteePartialError ? `${input.instrument.name} 국내 DeepScan 위원회 재시도 필요` : `${input.instrument.name} 국내 DeepScan ${scored.hero.score}점`,
      body: llmCommitteeBlocked || llmCommitteePartialError ? '일부 국내 위원이 LLM 응답 확보에 실패해 축/종합 점수를 보류했습니다. 성공한 위원 판단과 실패 슬롯을 함께 확인하세요.' : heroBodyParts.join(' · '),
      statusText: llmCommitteeBlocked || llmCommitteePartialError ? '부분 오류' : scored.hero.statusText,
      score: llmCommitteeBlocked || llmCommitteePartialError ? 0 : scored.hero.score,
      scoreLabel: llmCommitteeBlocked || llmCommitteePartialError ? 'N/A' : `${scored.hero.scoreLabel} · ${scored.hero.score} / 100`,
      scoreDelta: llmCommitteeBlocked || llmCommitteePartialError ? '재시도 필요' : (scored.hero.penalties.length > 0 ? `-${scored.hero.penalties.length}` : '+0'),
    };
    const blocks = {
      hero,
      committee: {
        ...(llmCommitteeBlocked
          ? createBlockedBlockMeta({
              sourceRefs: createBlockSourceRefs(input, 'committee', combinedSourceRefs),
              fallback: blockFallback,
              error: createDeepScanBlockError({
                code: 'kr-committee-coverage-blocked',
                message: '위원회 축 근거가 부족해 후속 계산이 보류되었습니다.',
                retryable: true,
              }),
            })
          : createOkBlockMeta({ sourceRefs: createBlockSourceRefs(input, 'committee', combinedSourceRefs), fallback: blockFallback })),
        axes: committeeAxes,
      },
      insights: {
        ...createOkBlockMeta({ sourceRefs: createBlockSourceRefs(input, 'insights', combinedSourceRefs), fallback: blockFallback }),
        ...insights,
      },
      strategy: {
        ...(llmCommitteeBlocked
          ? createBlockedBlockMeta({
              sourceRefs: createBlockSourceRefs(input, 'strategy', combinedSourceRefs),
              fallback: blockFallback,
              error: createDeepScanBlockError({
                code: 'kr-committee-coverage-blocked',
                message: '위원회 축 근거가 부족해 전략 블록이 보류되었습니다.',
                retryable: true,
              }),
            })
          : createOkBlockMeta({ sourceRefs: createBlockSourceRefs(input, 'strategy', combinedSourceRefs), fallback: blockFallback })),
        ...(llmCommitteeBlocked
          ? {
              weekSignal: '근거 부족',
              weekSignalTone: 'neutral',
              weekBadgeText: '위원회 재계산 필요',
              scenarioLabel: '근거 부족 시나리오',
              scenarioProbability: '0%',
              scenarioPeriod: '대기',
              scenarioCondition: '위원회 축 근거가 부족해 전략 시나리오를 계산하지 않았습니다.',
              currentPriceText: '정보 없음',
              targetPriceText: '정보 없음',
              scenarioDetails: ['국내 LLM 위원회 재시도가 필요합니다.'],
              otherScenarios: [],
              otherScenarioTags: [],
            }
          : strategy),
      },
      sellNow: {
        ...(llmCommitteeBlocked
          ? createBlockedBlockMeta({
              sourceRefs: createBlockSourceRefs(input, 'sellNow', combinedSourceRefs),
              fallback: blockFallback,
              error: createDeepScanBlockError({
                code: 'kr-committee-coverage-blocked',
                message: '위원회 축 근거가 부족해 즉시 매도 판단 블록이 보류되었습니다.',
                retryable: true,
              }),
            })
          : createOkBlockMeta({ sourceRefs: createBlockSourceRefs(input, 'sellNow', combinedSourceRefs), fallback: blockFallback })),
        ...(llmCommitteeBlocked
          ? {
              realizedText: '위원회 축 근거가 부족해 즉시 매도 판단을 계산하지 않았습니다.',
              rows: [],
            }
          : sellNow),
      },
      portfolioSimulation: {
        ...(llmCommitteeBlocked
          ? createBlockedBlockMeta({
              sourceRefs: createBlockSourceRefs(input, 'portfolioSimulation', combinedSourceRefs),
              fallback: blockFallback,
              error: createDeepScanBlockError({
                code: 'kr-committee-coverage-blocked',
                message: '위원회 축 근거가 부족해 포트폴리오 시뮬레이션이 보류되었습니다.',
                retryable: true,
              }),
            })
          : createOkBlockMeta({ sourceRefs: createBlockSourceRefs(input, 'portfolioSimulation', combinedSourceRefs), fallback: blockFallback })),
        ...(llmCommitteeBlocked
          ? {
              beforeScore: 0,
              afterScore: 0,
              deltaLabel: 'N/A',
              caption: '위원회 축 근거가 부족해 포트폴리오 시뮬레이션을 계산하지 않았습니다.',
            }
          : portfolioSimulation),
      },
    };

    const payload = {
      input,
      ...blocks,
      metadata: {
        generatedAt,
        version: DEEP_SCAN_VERSION,
        degraded: blockFallback !== null || llmCommitteeErrors.length > 0 || llmCommitteeBlocked || llmCommitteePartialError || llmCommitteePartialPending,
        debugId: createDebugId(input),
        inputValidity: {
          valid: true,
          raw: safeCloneRawInput(rawInput),
        },
        sourceRefs: [...createBaseSourceRefs(input), ...combinedSourceRefs],
        blockStatus: createBlockStatus(blocks),
        ...(llmCommitteeMetadata ? { llmCommittee: llmCommitteeMetadata } : {}),
      },
    };

    return payload;
  } catch {
    return createInternalErrorPayload(rawInput);
  }
}

export {
  buildKrPackageInvocationInput,
  createDeepScanSourceRef,
  createDeepScanBlockError,
  createBlockedBlockMeta,
  createErrorBlockMeta,
  createOkBlockMeta,
  createInputInvalidPayload,
  buildWiseReportKrCacheDescriptor,
  getCrawlerCacheClientFromRawInput,
  getCrawlerCacheOptions,
  loadWiseReportKrSlimSource,
  maybeResolveKrPackageResult,
  resolveKrSourceBundle,
  MAJOR_BLOCK_KEYS,
};
