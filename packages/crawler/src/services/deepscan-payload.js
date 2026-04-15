const DEEP_SCAN_VERSION = 'deepscan-payload-baseline-v1';
const PLACEHOLDER_FALLBACK = Object.freeze({
  used: true,
  reason: 'baseline-placeholder',
  label: 'temporary deterministic content',
});
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

function normalizeText(value) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized || undefined;
}

function normalizeInput(rawInput = {}) {
  const safeInput = rawInput && typeof rawInput === 'object' ? rawInput : {};
  const rawInstrument = safeInput.instrument && typeof safeInput.instrument === 'object' ? safeInput.instrument : {};
  const rawHolding = safeInput.holding && typeof safeInput.holding === 'object' ? safeInput.holding : null;
  const rawSourceContext = safeInput.sourceContext && typeof safeInput.sourceContext === 'object' ? safeInput.sourceContext : {};
  const sourceFrom = SOURCE_TYPES.has(rawSourceContext.from) ? rawSourceContext.from : 'system';

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
    return rawSourceContext && SOURCE_TYPES.has(rawSourceContext.from) ? rawSourceContext.from : 'system';
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

function createOkBlockMeta({ sourceRefs = [], fallback = PLACEHOLDER_FALLBACK } = {}) {
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
      id: 'deepscan-payload-baseline',
      label: 'crawler baseline payload service',
      note: 'Task 2 deterministic placeholder content',
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

function createBlockSourceRefs(input, blockId) {
  return [
    ...createBaseSourceRefs(input),
    createDeepScanSourceRef({
      type: 'system',
      id: `deepscan-block:${blockId}`,
      label: `${blockId} baseline block`,
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

function createCommitteeAxes(input) {
  const instrumentLabel = input.instrument.code ?? input.instrument.ticker ?? input.instrument.name;
  return [
    {
      label: 'Business Quality',
      score: 63,
      scoreText: '63 / 100',
      axisStatusText: 'Baseline placeholder view',
      subtitle: `${instrumentLabel} 기본 체력 신호`,
      avgLabel: '위원 평균 63',
      members: [
        {
          shortLabel: '제품력',
          title: '제품/서비스 경쟁력',
          reason: `${input.instrument.name}의 제품 경쟁력 평가는 baseline placeholder로 고정되었습니다.`,
          score: 64,
          scoreLabel: '64',
          tone: 'positive',
          iconTone: 'green',
        },
        {
          shortLabel: '이익체력',
          title: '이익 체력',
          reason: '실제 재무 파이프라인 연결 전까지는 deterministic placeholder 의견만 제공합니다.',
          score: 61,
          scoreLabel: '61',
          tone: 'neutral',
          iconTone: 'blue',
        },
        {
          shortLabel: '리스크',
          title: '사업 리스크 통제',
          reason: '리포트/뉴스 결합 전이라 리스크 사유는 canonical placeholder 문구로 제한됩니다.',
          score: 63,
          scoreLabel: '63',
          tone: 'warning',
          iconTone: 'amber',
        },
      ],
    },
    {
      label: 'Market Timing',
      score: 58,
      scoreText: '58 / 100',
      axisStatusText: 'Need live market wiring',
      subtitle: '시장 타이밍 신호 대기',
      avgLabel: '위원 평균 58',
      members: [
        {
          shortLabel: '수급',
          title: '수급 흐름',
          reason: '실시간 수급 연결 전이라 baseline 방향성만 표시합니다.',
          score: 57,
          scoreLabel: '57',
          tone: 'neutral',
          iconTone: 'teal',
        },
        {
          shortLabel: '변동성',
          title: '변동성 압력',
          reason: '시장 변동성은 향후 canonical endpoint에서 실측치로 교체됩니다.',
          score: 56,
          scoreLabel: '56',
          tone: 'warning',
          iconTone: 'red',
        },
        {
          shortLabel: '모멘텀',
          title: '모멘텀 확인',
          reason: '페이지 heuristic 없이 crawler 내부 placeholder만 사용합니다.',
          score: 61,
          scoreLabel: '61',
          tone: 'positive',
          iconTone: 'purple',
        },
      ],
    },
    {
      label: 'Position Fit',
      score: 66,
      scoreText: '66 / 100',
      axisStatusText: 'Holding-aware baseline',
      subtitle: '보유 맥락 반영 placeholder',
      avgLabel: '위원 평균 66',
      members: [
        {
          shortLabel: '보유량',
          title: '보유 수량 적합도',
          reason: `현재 보유 수량 ${input.holding?.shares ?? 'N/A'} 기준 baseline 의견입니다.`,
          score: 68,
          scoreLabel: '68',
          tone: 'positive',
          iconTone: 'green',
        },
        {
          shortLabel: '평단',
          title: '평균 단가 부담',
          reason: `평균 단가 ${input.holding?.averagePrice ?? 'N/A'} 기준 placeholder 평가입니다.`,
          score: 64,
          scoreLabel: '64',
          tone: 'neutral',
          iconTone: 'blue',
        },
        {
          shortLabel: '집중도',
          title: '포지션 집중도',
          reason: '포트폴리오 맥락 연동 전이라 고정 문구를 사용합니다.',
          score: 66,
          scoreLabel: '66',
          tone: 'warning',
          iconTone: 'amber',
        },
      ],
    },
  ];
}

export async function buildJarooDeepScanPayload(rawInput = {}) {
  try {
    const input = normalizeInput(rawInput);

    if (!input.instrument.code && !input.instrument.ticker) {
      return createInputInvalidPayload(rawInput);
    }

    const generatedAt = deriveGeneratedAt(input);
    const dateLabel = (input.selectedAt ?? generatedAt).slice(0, 10);
    const instrumentIdentifier = input.instrument.code ?? input.instrument.ticker;
    const blocks = {
      hero: {
        ...createOkBlockMeta({ sourceRefs: createBlockSourceRefs(input, 'hero') }),
        headline: `${input.instrument.name} baseline DeepScan summary`,
        body: `Crawler baseline placeholder payload for ${instrumentIdentifier}. Live endpoint wiring lands in Task 3.`,
        statusText: 'Baseline placeholder content',
        score: 61,
        scoreLabel: '61 / 100',
        scoreDelta: '+0',
      },
      committee: {
        ...createOkBlockMeta({ sourceRefs: createBlockSourceRefs(input, 'committee') }),
        axes: createCommitteeAxes(input),
      },
      insights: {
        ...createOkBlockMeta({ sourceRefs: createBlockSourceRefs(input, 'insights') }),
        sectionLabel: 'Baseline insights',
        items: [
          {
            sourceType: input.sourceContext.from,
            sourceLabel: 'Input context',
            date: dateLabel,
            label: '입력',
            title: `${input.instrument.name} 보유 맥락`,
            body: '입력 컨텍스트를 canonical payload에 고정 형식으로 담았습니다.',
          },
          {
            sourceType: 'system',
            sourceLabel: 'Crawler baseline',
            date: generatedAt.slice(0, 10),
            label: '서비스',
            title: 'Deterministic placeholder synthesis',
            body: 'Task 2 baseline service emits deterministic placeholders only inside the crawler service.',
          },
          {
            sourceType: 'market',
            sourceLabel: 'Market placeholder',
            date: dateLabel,
            label: '시장',
            title: `${input.instrument.market ?? 'Unknown'} market stub`,
            body: '실제 시장/뉴스/리포트 연결 전까지는 canonical fallback 문구만 제공합니다.',
          },
        ],
        summaryTags: ['baseline', 'deterministic', 'crawler-owned'],
      },
      strategy: {
        ...createOkBlockMeta({ sourceRefs: createBlockSourceRefs(input, 'strategy') }),
        weekSignal: 'Hold and verify',
        weekSignalTone: 'neutral',
        weekBadgeText: 'Baseline',
        scenarioLabel: 'Endpoint wiring pending',
        scenarioProbability: '62%',
        scenarioPeriod: '1-2 weeks',
        scenarioCondition: 'Canonical payload is available, but live crawler synthesis is not connected yet.',
        currentPriceText: `Average price ${input.holding?.averagePrice ?? 'N/A'}`,
        targetPriceText: 'Target TBD',
        scenarioDetails: [
          'Crawler service owns the canonical schema and placeholder copy.',
          'No page heuristic text is reused in this baseline payload.',
          'Task 3 will attach an endpoint to deliver this payload over HTTP.',
        ],
        otherScenarios: [
          {
            label: 'Conservative follow-up',
            probability: '24%',
            condition: 'Keep the current position until live data sources are connected.',
          },
          {
            label: 'Fast re-check',
            probability: '14%',
            condition: 'Rebuild the canonical payload after endpoint and upstream integrations land.',
          },
        ],
        otherScenarioTags: ['baseline', 'integration pending'],
      },
      sellNow: {
        ...createOkBlockMeta({ sourceRefs: createBlockSourceRefs(input, 'sellNow') }),
        realizedText: 'Baseline sell-now block uses deterministic placeholders and holding fields only.',
        rows: [
          {
            label: '보유 수량',
            value: input.holding?.shares ?? 'N/A',
            tag: 'holding',
            tagTone: 'positive',
            emphasis: true,
          },
          {
            label: '평균 단가',
            value: input.holding?.averagePrice ?? 'N/A',
            tag: 'avg',
            tagTone: 'danger',
            valueTone: 'danger',
          },
          {
            label: '평가 금액',
            value: input.holding?.evaluationAmount ?? 'N/A',
            tag: 'snapshot',
            tagTone: 'positive',
          },
        ],
      },
      portfolioSimulation: {
        ...createOkBlockMeta({ sourceRefs: createBlockSourceRefs(input, 'portfolioSimulation') }),
        beforeScore: 58,
        afterScore: 64,
        deltaLabel: '+6p',
        caption: 'Baseline simulation placeholder: removing the position would slightly improve diversification in this stub.',
      },
    };

    return {
      input,
      ...blocks,
      metadata: {
        generatedAt,
        version: DEEP_SCAN_VERSION,
        degraded: true,
        debugId: createDebugId(input),
        inputValidity: {
          valid: true,
          raw: safeCloneRawInput(rawInput),
        },
        sourceRefs: createBaseSourceRefs(input),
        blockStatus: createBlockStatus(blocks),
      },
    };
  } catch {
    return createInternalErrorPayload(rawInput);
  }
}

export {
  createDeepScanSourceRef,
  createDeepScanBlockError,
  createBlockedBlockMeta,
  createErrorBlockMeta,
  createOkBlockMeta,
  createInputInvalidPayload,
  MAJOR_BLOCK_KEYS,
};
