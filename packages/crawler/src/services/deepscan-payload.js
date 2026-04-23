import { createRequire } from 'node:module';
import { getCurrentQuotes } from '../crawlers/current-quotes.js';
import { buildDeepScanKrEvidencePacket } from './deepscan-kr-evidence.js';
import { scoreDeepScanKrEvidence, scoreDeepScanKrFromCommittee } from './deepscan-kr-score.js';
import { invokeDeepScanKrPackage } from './deepscan-kr-package-adapter.js';
import { buildKrCommitteeAxesFromLlmResults, scoreDeepScanKrCommitteeFromDump } from './deepscan-kr-committee-runtime.js';

const require = createRequire(import.meta.url);
const { WISEREPORT_KR_PAGES, getCrawl } = require('../crawlers/wisereport-kr.cjs');

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
        evaluationAmount: normalizeText(rawHolding.evaluationAmount),
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
      label: 'deepscan input',
      at: input.sourceContext.appliedAt ?? input.selectedAt,
      note: input.sourceContext.sessionKey ? `session:${input.sourceContext.sessionKey}` : undefined,
    }),
    createDeepScanSourceRef({
      type: 'system',
      id: 'deepscan-payload-service',
      label: 'crawler deepscan payload service',
      note: 'KR evidence-backed payload assembly',
    }),
  ];

  if (input.holding?.shares || input.holding?.averagePrice || input.holding?.evaluationAmount) {
    sourceRefs.push(
      createDeepScanSourceRef({
        type: 'holding',
        id: `holding:${identifier}`,
        label: 'holding snapshot',
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
    message: 'instrument code or ticker is required',
    retryable: false,
  });
  const invalidFallback = {
    used: true,
    reason: 'input-invalid',
    label: 'instrument code or ticker required',
  };
  const blocks = {
    hero: {
      ...createBlockedBlockMeta({
        sourceRefs: createBlockSourceRefs(input, 'hero'),
        fallback: invalidFallback,
        error: invalidError,
      }),
      headline: '입력 정보를 확인해주세요',
      body: 'DeepScan canonical payload를 만들려면 종목 코드 또는 티커가 필요합니다.',
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
      weekSignal: 'Unavailable',
      weekSignalTone: 'neutral',
      weekBadgeText: 'Blocked',
      scenarioLabel: '입력 확인 필요',
      scenarioProbability: '0%',
      scenarioPeriod: 'N/A',
      scenarioCondition: '종목 코드 또는 티커가 누락되었습니다.',
      currentPriceText: 'N/A',
      targetPriceText: 'N/A',
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
    message: 'unexpected internal crawler service failure',
    retryable: true,
  });
  const internalFallback = {
    used: true,
    reason: INTERNAL_SERVICE_ERROR_CODE,
    label: 'canonical internal error payload',
  };
  const blocks = {
    hero: {
      ...createErrorBlockMeta({
        sourceRefs: createBlockSourceRefs(input, 'hero'),
        fallback: internalFallback,
        error: internalError,
      }),
      headline: 'DeepScan payload 생성 중 오류가 발생했습니다',
      body: 'Crawler 서비스 내부 오류로 canonical error payload를 반환했습니다.',
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
      weekSignal: 'Unavailable',
      weekSignalTone: 'neutral',
      weekBadgeText: 'Error',
      scenarioLabel: '서비스 오류',
      scenarioProbability: '0%',
      scenarioPeriod: 'N/A',
      scenarioCondition: '내부 오류로 전략 시나리오를 계산할 수 없습니다.',
      currentPriceText: 'N/A',
      targetPriceText: 'N/A',
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
      realizedText: '내부 오류로 sell-now canonical block을 만들 수 없습니다.',
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
  return market === 'KR' || market === 'KOSPI' || market === 'KOSDAQ' || /^\d{6}$/.test(code ?? '');
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

function pickWiseReportKrCompany(rawAggregate, code) {
  const normalizedAggregate = normalizeWiseReportKrAggregate(rawAggregate);

  for (const page of WISEREPORT_KR_PAGES) {
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
  const [slimResult, quotesResult, packageResult] = await Promise.all([
    captureSource('slim', async () => buildWiseReportKrSlimPayload(await getCrawl(input.instrument.code), input.instrument.code)),
    captureSource('current-quote', async () => getCurrentQuotes({
      codes: input.instrument.code ? [input.instrument.code] : [],
      tickers: input.instrument.ticker ? [input.instrument.ticker] : [],
      ...(tradeDate ? { tradeDate } : {}),
    })),
    maybeResolveKrPackageResult(rawInput, input),
  ]);

  return {
    sources: {
      ...(slimResult.value ? { slim: slimResult.value } : {}),
      ...(quotesResult.value ? { quotes: quotesResult.value } : {}),
      ...(packageResult.value ? { packageResult: packageResult.value } : {}),
    },
    sourceIssues: [slimResult.issue, quotesResult.issue, packageResult.issue].filter(Boolean),
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

function createCommitteeMember(shortLabel, title, score, reason) {
  return {
    shortLabel,
    title,
    reason,
    score,
    scoreLabel: String(score),
    tone: getScoreTone(score),
    iconTone: getScoreIconTone(score),
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

function createCommitteeAxes(evidence, scored, packageResult) {
  const businessQualityReason = evidence.sourceCoverage.hasPackageResult
    ? `회사개요·재무·리포트 근거를 합산했습니다. 최근 리포트 ${evidence.reportSignals.recentReportCount ?? 0}건, package-result 확보 기준입니다.`
    : `회사개요·재무·리포트 근거를 합산했습니다. 최근 리포트 ${evidence.reportSignals.recentReportCount ?? 0}건 기준입니다.`;
  const businessQualityReasonOverrides = createKrBusinessQualityReasonOverrides(packageResult);
  let businessQualityReasonIndex = 0;
  const nextBusinessQualityReason = (fallbackReason) => businessQualityReasonOverrides[businessQualityReasonIndex++] ?? fallbackReason;

  return [
    {
      label: 'Business Quality',
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
        ),
        createCommitteeMember(
          '밸류',
          '밸류에이션',
          scored.committee.businessQuality.valuation,
          nextBusinessQualityReason(`컨센서스 ${evidence.reportSignals.consensusAvailable ? '확보' : '없음'}, 의견 ${evidence.reportSignals.opinionAvailable ? '확보' : '없음'}, 현재가 ${evidence.currentQuote ? '확보' : '없음'}를 반영했습니다.`),
        ),
        createCommitteeMember(
          '지배',
          '지분/안정성',
          scored.committee.businessQuality.ownershipStability,
          nextBusinessQualityReason(`보유 맥락 ${evidence.holding.hasHoldingContext ? '확인' : '없음'}, 스타일/지분 페이지 ${evidence.reportSignals.styleAnalysisAvailable || evidence.pageCoverage.availablePageIds.includes('shareholding') ? '일부 확보' : '부족'} 상태입니다.`),
        ),
      ],
    },
    {
      label: 'Market Timing',
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
          `상대수익률 ${evidence.reportSignals.relativeReturnAvailable ? '확보' : '없음'}, 스타일 분석 ${evidence.reportSignals.styleAnalysisAvailable ? '확보' : '없음'}, 최근 리포트 ${evidence.reportSignals.recentReportsAvailable ? '확보' : '없음'} 기준입니다.`,
        ),
        createCommitteeMember(
          '컨센',
          '컨센서스 모멘텀',
          scored.committee.marketTiming.consensusMomentum,
          `컨센서스 ${evidence.reportSignals.consensusAvailable ? '확보' : '없음'}, 의견 ${evidence.reportSignals.opinionAvailable ? '확보' : '없음'}, 최근 리포트 ${evidence.reportSignals.recentReportCount ?? 0}건을 반영했습니다.`,
        ),
        createCommitteeMember(
          '가격',
          '가격 위치',
          scored.committee.marketTiming.priceLocation,
          evidence.currentQuote
            ? `현재가 ${formatCurrencyValue(evidence.currentQuote.price, evidence.currentQuote.currency)}와 평단 ${formatNumber(evidence.holding.averagePrice)} 비교 기준입니다.`
            : '현재가가 없어 가격 위치 점수는 보수적으로 계산했습니다.',
        ),
      ],
    },
    {
      label: 'Position Fit',
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
        ),
        createCommitteeMember(
          '여지',
          '상방 버퍼',
          scored.committee.positionFit.upsideBuffer,
          `컨센서스 ${evidence.reportSignals.consensusAvailable ? '확보' : '없음'}, 의견 ${evidence.reportSignals.opinionAvailable ? '확보' : '없음'}, 최근 리포트 ${evidence.reportSignals.recentReportsAvailable ? '확보' : '없음'} 반영입니다.`,
        ),
        createCommitteeMember(
          '입력',
          '입력 완성도',
          scored.committee.positionFit.holdingCompleteness,
          evidence.holding.hasFullSellNowInputs
            ? '보유 수량, 평단, 현재가가 모두 확인되어 sell-now 계산이 가능합니다.'
            : '보유 수량·평단·현재가 중 일부가 없어 sell-now 계산이 제한됩니다.',
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
      label: 'KR slim report evidence',
      note: `pages:${evidence.pageCoverage.availableCount}/${evidence.pageCoverage.totalKnownPages}`,
    }));
  }

  if (evidence.currentQuote) {
    sourceRefs.push(createDeepScanSourceRef({
      type: 'market',
      id: `current-quote:${identifier}`,
      label: 'current quote',
      at: evidence.currentQuote.asOf ?? input.selectedAt,
      note: evidence.currentQuote.source ?? undefined,
    }));
  } else if (sources.quotes) {
    sourceRefs.push(createDeepScanSourceRef({
      type: 'market',
      id: `current-quote:${identifier}`,
      label: 'current quote lookup',
      note: 'no matching current quote',
    }));
  }

  if (sources.packageResult) {
    sourceRefs.push(createDeepScanSourceRef({
      type: 'report',
      id: `package-result:${identifier}`,
      label: 'KR package supplemental evidence',
      at: sources.packageResult.timestamp,
      note: normalizeText(sources.packageResult.listingMarket) ?? undefined,
    }));
  }

  for (const missingSource of evidence.missingSources) {
    sourceRefs.push(createDeepScanSourceRef({
      type: 'system',
      id: `missing-source:${missingSource}:${identifier}`,
      label: `${missingSource} missing`,
    }));
  }

  for (const issue of sourceIssues) {
    sourceRefs.push(createDeepScanSourceRef({
      type: 'system',
      id: `source-issue:${issue.sourceId}:${identifier}`,
      label: `${issue.sourceId} unavailable`,
      note: issue.message,
    }));
  }

  return sourceRefs;
}

function buildInsights(input, evidence, scored, generatedAt, sourceIssues) {
  const dateLabel = (input.selectedAt ?? generatedAt).slice(0, 10);
  const items = [
    {
      sourceType: evidence.currentQuote ? 'market' : 'system',
      sourceLabel: 'Current quote',
      date: evidence.currentQuote?.asOf ?? dateLabel,
      label: '현재가',
      title: `${input.instrument.name} 현재가 근거`,
      body: evidence.currentQuote
        ? `${formatCurrencyValue(evidence.currentQuote.price, evidence.currentQuote.currency)} 확인`
        : '현재가 근거 없음',
    },
    {
      sourceType: 'report',
      sourceLabel: 'KR report pages',
      date: dateLabel,
      label: '리포트',
      title: 'KR 리포트 페이지 범위',
      body: evidence.pageCoverage.availableCount > 0
        ? `KR 리포트 페이지 ${evidence.pageCoverage.availableCount}/${evidence.pageCoverage.totalKnownPages} 확보`
        : 'KR 리포트 페이지 근거 없음',
    },
    {
      sourceType: evidence.holding.hasHoldingContext ? 'holding' : 'system',
      sourceLabel: 'Holding context',
      date: dateLabel,
      label: '보유',
      title: '보유 포지션 맥락',
      body: evidence.holding.hasHoldingContext
        ? (evidence.holding.hasFullSellNowInputs
          ? `보유 ${formatNumber(evidence.holding.shares)}주 / 평단 ${formatNumber(evidence.holding.averagePrice)} 확인`
          : '보유 맥락 일부 확인')
        : 'KR 보유 맥락 없음',
    },
  ];

  if (sourceIssues.length > 0 || evidence.missingSources.length > 0) {
    items.push({
      sourceType: 'system',
      sourceLabel: 'Source coverage',
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
    sectionLabel: 'KR evidence snapshot',
    items,
    summaryTags: [
      `score:${scored.hero.score}`,
      `reports:${evidence.pageCoverage.availableCount}/${evidence.pageCoverage.totalKnownPages}`,
      `decision:${scored.sellNow.decisionBand}`,
    ],
  };
}

function buildStrategy(input, evidence, scored) {
  const decisionBand = scored.sellNow.decisionBand;
  const currentPriceText = evidence.currentQuote
    ? formatCurrencyValue(evidence.currentQuote.price, evidence.currentQuote.currency)
    : '현재가 근거 없음';
  const scenarioDetails = [
    ...evidence.topFacts,
    ...evidence.topRisks.slice(0, 2),
    ...scored.hero.penalties.map((penalty) => `패널티: ${penalty}`),
  ].slice(0, 4);

  return {
    weekSignal: getWeekSignal(decisionBand, scored.hero.score),
    weekSignalTone: getWeekSignalTone(decisionBand),
    weekBadgeText: scored.hero.statusText,
    scenarioLabel: getScenarioLabel(decisionBand),
    scenarioProbability: `${Math.max(5, scored.hero.score)}%`,
    scenarioPeriod: evidence.currentQuote?.asOf ? `${evidence.currentQuote.asOf} 기준 1-2주` : '1-2 weeks',
    scenarioCondition: evidence.topRisks[0] ?? '추가 리스크 없음',
    currentPriceText,
    targetPriceText: evidence.reportSignals.consensusAvailable || evidence.sourceCoverage.hasPackageResult
      ? '컨센서스/패키지 보조 근거 확인'
      : '목표가 근거 없음',
    scenarioDetails: scenarioDetails.length > 0 ? scenarioDetails : ['확보된 근거가 부족합니다.'],
    otherScenarios: [
      {
        label: '근거 유지',
        probability: `${Math.max(10, 100 - scored.hero.score)}%`,
        condition: evidence.topFacts[0] ?? '핵심 근거를 다시 확보합니다.',
      },
      {
        label: '리스크 재점검',
        probability: `${Math.max(10, evidence.missingSources.length * 10)}%`,
        condition: evidence.topRisks[0] ?? '추가 리스크를 다시 확인합니다.',
      },
    ],
    otherScenarioTags: [decisionBand, evidence.currentQuote ? 'quote:ok' : 'quote:missing'],
  };
}

function buildSellNow(evidence, scored) {
  if (!scored.sellNow.available) {
    return {
      realizedText: '현재가 또는 보유 평단 근거가 부족해 즉시 매도 판단을 계산하지 못했습니다.',
      rows: [
        {
          label: '판단 상태',
          value: 'blocked',
          tag: 'decision',
          tagTone: 'warning',
          emphasis: true,
        },
        {
          label: '현재가',
          value: evidence.currentQuote ? formatCurrencyValue(evidence.currentQuote.price, evidence.currentQuote.currency) : '현재가 근거 없음',
          tag: 'quote',
          tagTone: evidence.currentQuote ? 'positive' : 'warning',
        },
        {
          label: '평단',
          value: evidence.holding.averagePrice !== null ? formatNumber(evidence.holding.averagePrice) : '평단 근거 없음',
          tag: 'avg',
          tagTone: evidence.holding.averagePrice !== null ? 'neutral' : 'warning',
        },
      ],
    };
  }

  const currency = evidence.currentQuote?.currency ?? 'KRW';
  return {
    realizedText: `현재가 기준 평가손익 ${formatSignedNumber(scored.sellNow.evaluationPnL)} ${currency} (${formatSignedPercent(scored.sellNow.evaluationPnLPct)}). 즉시 매도 판단은 ${scored.sellNow.decisionBand} 입니다.`,
    rows: [
      {
        label: '판단 밴드',
        value: scored.sellNow.decisionBand,
        tag: 'decision',
        tagTone: 'positive',
        emphasis: true,
      },
      {
        label: '현재가',
        value: formatCurrencyValue(scored.sellNow.currentPrice, currency),
        tag: 'quote',
        tagTone: 'positive',
      },
      {
        label: '평단',
        value: formatNumber(scored.sellNow.averagePrice),
        tag: 'avg',
        tagTone: 'neutral',
      },
      {
        label: '평가손익',
        value: `${formatSignedNumber(scored.sellNow.evaluationPnL)} ${currency} / ${formatSignedPercent(scored.sellNow.evaluationPnLPct)}`,
        tag: 'pnl',
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
    deltaLabel: scored.portfolioSimulation.deltaLabel,
    caption: `${scored.sellNow.decisionBand} 판단 기준 포지션 제거 시 포트폴리오 점수 ${scored.portfolioSimulation.beforeScore} → ${scored.portfolioSimulation.afterScore}.`,
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
    let llmCommitteeBlocked = false;
    let committeeAxes = createCommitteeAxes(evidence, deterministicScored, sources.packageResult);
    const llmAttempted = isKrInput(input) && shouldInvokeKrCommitteeLlm();

    if (llmAttempted) {
      const llmCommittee = await scoreDeepScanKrCommitteeFromDump(rawInput, input, evidence, sources);
      llmCommitteeErrors = llmCommittee.errors;
      llmSourceRefs.push(createDeepScanSourceRef({
        type: 'system',
        id: `kr-llm:${input.instrument.code ?? input.instrument.name}`,
        label: 'KR LLM committee runtime',
        note: llmCommittee.requestId,
      }));

      if (Object.keys(llmCommittee.results).length > 0) {
        const llmCommitteeShape = buildKrCommitteeAxesFromLlmResults(evidence, llmCommittee.results);
        committeeAxes = llmCommitteeShape.axes;
        scored = scoreDeepScanKrFromCommittee(evidence, llmCommitteeShape.committeeScores);
        llmCommitteeBlocked = Object.values(llmCommitteeShape.coverage).some((axis) => axis.omitted === true);
      } else {
        committeeAxes = [];
        llmCommitteeBlocked = true;
      }
    }

    const combinedSourceRefs = [...evidenceSourceRefs, ...llmSourceRefs];
    const llmFallback = llmCommitteeErrors.length > 0 || llmCommitteeBlocked
      ? {
          used: true,
          reason: llmCommitteeBlocked ? 'kr-committee-coverage-blocked' : 'weak-data-degradation',
          label: llmCommitteeBlocked ? '일부 KR 위원 축 근거가 부족합니다.' : `일부 KR 위원 실패 ${llmCommitteeErrors.length}건`,
        }
      : null;
    const blockFallback = llmFallback ?? createEvidenceFallback(evidence, sourceIssues);
    const insights = buildInsights(input, evidence, scored, generatedAt, sourceIssues);
    const strategy = buildStrategy(input, evidence, scored);
    const sellNow = buildSellNow(evidence, scored);
    const portfolioSimulation = buildPortfolioSimulation(scored);
    const heroBodyParts = [...evidence.topFacts];

    for (const risk of evidence.topRisks.slice(0, 2)) {
      heroBodyParts.push(`주의: ${risk}`);
    }
    if (evidence.pageCoverage.availableCount === 0 && !heroBodyParts.some((part) => part.includes('KR 리포트 페이지 근거 없음'))) {
      heroBodyParts.push('주의: KR 리포트 페이지 근거 없음');
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
              message: 'KR hero block is blocked because committee axis coverage is insufficient.',
              retryable: true,
            }),
          })
        : createOkBlockMeta({ sourceRefs: createBlockSourceRefs(input, 'hero', combinedSourceRefs), fallback: blockFallback })),
      headline: llmCommitteeBlocked ? `${input.instrument.name} KR DeepScan 위원회 재시도 필요` : `${input.instrument.name} KR DeepScan ${scored.hero.score}점`,
      body: llmCommitteeBlocked ? 'KR committee axis coverage가 부족해 상위 점수를 계산하지 않았습니다.' : heroBodyParts.join(' · '),
      statusText: llmCommitteeBlocked ? '재시도 필요' : scored.hero.statusText,
      score: llmCommitteeBlocked ? 0 : scored.hero.score,
      scoreLabel: llmCommitteeBlocked ? 'N/A' : `${scored.hero.scoreLabel} · ${scored.hero.score} / 100`,
      scoreDelta: llmCommitteeBlocked ? '0' : (scored.hero.penalties.length > 0 ? `-${scored.hero.penalties.length}` : '+0'),
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
                message: 'KR committee axis coverage is insufficient for downstream computation.',
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
                message: 'KR strategy block is blocked because committee axis coverage is insufficient.',
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
              currentPriceText: 'N/A',
              targetPriceText: 'N/A',
              scenarioDetails: ['KR LLM committee 재시도가 필요합니다.'],
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
                message: 'KR sell-now block is blocked because committee axis coverage is insufficient.',
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
                message: 'KR portfolio simulation is blocked because committee axis coverage is insufficient.',
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

    return {
      input,
      ...blocks,
      metadata: {
        generatedAt,
        version: DEEP_SCAN_VERSION,
        degraded: blockFallback !== null || llmCommitteeErrors.length > 0 || llmCommitteeBlocked,
        debugId: createDebugId(input),
        inputValidity: {
          valid: true,
          raw: safeCloneRawInput(rawInput),
        },
        sourceRefs: [...createBaseSourceRefs(input), ...combinedSourceRefs],
        blockStatus: createBlockStatus(blocks),
      },
    };
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
  maybeResolveKrPackageResult,
  MAJOR_BLOCK_KEYS,
};
