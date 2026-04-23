import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { scoreCommitteeMembers } from '../../../deepscan-runtime-core/src/committee-llm.js';
import { buildKrCommitteeFromMemberScores } from './deepscan-kr-score.js';

export const KR_MEMBER_SPECS = Object.freeze({
  profitability: {
    axis: 'Business Quality',
    shortLabel: '수익성',
    title: '수익성/기본체력',
    role: 'KR profitability analyst',
    focus: 'Judge Korean equity profitability and core business quality from company overview, financial analysis, FnGuide finance evidence, and missing-data warnings.',
  },
  valuation: {
    axis: 'Business Quality',
    shortLabel: '밸류',
    title: '밸류에이션',
    role: 'KR valuation analyst',
    focus: 'Judge Korean equity valuation attractiveness from consensus, opinion, investment indicators, current price context, and missing-data warnings.',
  },
  ownershipStability: {
    axis: 'Business Quality',
    shortLabel: '지배',
    title: '지분/안정성',
    role: 'KR ownership stability analyst',
    focus: 'Judge ownership stability and reporting resilience from shareholding, style analysis, holding context, and company overview evidence.',
  },
  trend: {
    axis: 'Market Timing',
    shortLabel: '트렌드',
    title: '트렌드',
    role: 'KR trend analyst',
    focus: 'Judge Korean equity trend quality from relative return, style analysis, report freshness, and current-price evidence.',
  },
  consensusMomentum: {
    axis: 'Market Timing',
    shortLabel: '컨센',
    title: '컨센서스 모멘텀',
    role: 'KR consensus momentum analyst',
    focus: 'Judge Korean equity consensus momentum from consensus, opinion, and recent report evidence.',
  },
  priceLocation: {
    axis: 'Market Timing',
    shortLabel: '가격',
    title: '가격 위치',
    role: 'KR price-location analyst',
    focus: 'Judge Korean equity current price position versus average price and reported market context.',
  },
  avgPriceGap: {
    axis: 'Position Fit',
    shortLabel: '평단',
    title: '평단 격차',
    role: 'KR average-price-gap analyst',
    focus: 'Judge position fit from current price versus average price and current unrealized position context.',
  },
  upsideBuffer: {
    axis: 'Position Fit',
    shortLabel: '여지',
    title: '상방 버퍼',
    role: 'KR upside buffer analyst',
    focus: 'Judge remaining upside/downside buffer from consensus, opinion, recent reports, and current price evidence.',
  },
  holdingCompleteness: {
    axis: 'Position Fit',
    shortLabel: '입력',
    title: '입력 완성도',
    role: 'KR holding completeness analyst',
    focus: 'Judge how complete and actionable the current holding context is for decision support.',
  },
});

function normalizeText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function ensureLogDir(root) {
  mkdirSync(root, { recursive: true });
}

function writeJson(root, fileName, payload) {
  ensureLogDir(root);
  writeFileSync(join(root, fileName), JSON.stringify(payload, null, 2));
}

function createQuality(availability, reasonCode = [], extra = {}) {
  return {
    availability,
    ...(reasonCode.length > 0 ? { reasonCode } : {}),
    ...extra,
  };
}

function presentValue(value, reasonCode = [], notes) {
  return {
    value,
    quality: createQuality('present', reasonCode, {
      derivationKind: 'direct',
      inputOrigin: 'source',
    }),
    ...(notes ? { notes } : {}),
  };
}

function missingFact(message, reasonCode = ['missing_fact']) {
  return {
    value: null,
    quality: createQuality('missing', reasonCode, {
      severity: 'medium',
      actionability: 'caution',
    }),
    notes: [message],
  };
}

function buildSharedDump(input, evidence, sources) {
  const packageResult = sources.packageResult && typeof sources.packageResult === 'object' ? sources.packageResult : null;
  return {
    instrument: {
      code: presentValue(input.instrument.code ?? null, ['instrument_code']),
      name: presentValue(input.instrument.name ?? null, ['instrument_name']),
      market: presentValue(input.instrument.market ?? evidence.instrument?.market ?? null, ['instrument_market']),
    },
    sourceCoverage: presentValue(evidence.sourceCoverage ?? {}, ['source_coverage']),
    pageCoverage: presentValue(evidence.pageCoverage ?? {}, ['page_coverage']),
    reportSignals: presentValue(evidence.reportSignals ?? {}, ['report_signals']),
    holding: presentValue(evidence.holding ?? {}, ['holding_context']),
    currentQuote: evidence.currentQuote
      ? presentValue(evidence.currentQuote, ['current_quote'])
      : missingFact('현재가 근거가 없습니다.', ['current_quote_missing']),
    topFacts: presentValue(Array.isArray(evidence.topFacts) ? evidence.topFacts : [], ['top_facts']),
    topRisks: presentValue(Array.isArray(evidence.topRisks) ? evidence.topRisks : [], ['top_risks']),
    packageContext: packageResult
      ? presentValue({
          listingMarket: normalizeText(packageResult.listingMarket) ?? null,
          timestamp: normalizeText(packageResult.timestamp) ?? null,
          reportContent: normalizeText(packageResult.reportContent) ?? null,
          marketScoreSnapshot: packageResult.marketScoreSnapshot ?? null,
          boardOpinions: packageResult.boardAnalysis?.boardOpinions ?? null,
        }, ['package_context'], ['Supplemental only; not numeric truth.'])
      : missingFact('패키지 보조 컨텍스트가 없습니다.', ['package_context_missing']),
  };
}

function buildMemberDump(memberKey, input, evidence, sources) {
  const shared = buildSharedDump(input, evidence, sources);
  const common = {
    instrument: shared.instrument,
    holding: shared.holding,
    currentQuote: shared.currentQuote,
    pageCoverage: shared.pageCoverage,
    reportSignals: shared.reportSignals,
    sourceCoverage: shared.sourceCoverage,
    topFacts: shared.topFacts,
    topRisks: shared.topRisks,
    packageContext: shared.packageContext,
  };

  switch (memberKey) {
    case 'profitability':
      return {
        member: memberKey,
        facts: {
          ...common,
          financialCoverage: presentValue({
            hasCompanyOverview: evidence.pageCoverage?.availablePageIds?.includes('company-overview') === true,
            hasFinancialAnalysis: evidence.pageCoverage?.availablePageIds?.includes('financial-analysis') === true,
            hasFnGuideFinance: evidence.pageCoverage?.availablePageIds?.includes('fnguide-finance') === true,
            recentReportCount: evidence.reportSignals?.recentReportCount ?? null,
          }, ['profitability_inputs']),
        },
      };
    case 'valuation':
      return {
        member: memberKey,
        facts: {
          ...common,
          valuationInputs: presentValue({
            consensusAvailable: evidence.reportSignals?.consensusAvailable === true,
            opinionAvailable: evidence.reportSignals?.opinionAvailable === true,
            investmentIndicatorsAvailable: evidence.pageCoverage?.availablePageIds?.includes('investment-indicators') === true,
            currentPrice: evidence.currentQuote?.price ?? null,
          }, ['valuation_inputs']),
        },
      };
    case 'ownershipStability':
      return {
        member: memberKey,
        facts: {
          ...common,
          ownershipInputs: presentValue({
            shareholdingAvailable: evidence.pageCoverage?.availablePageIds?.includes('shareholding') === true,
            styleAnalysisAvailable: evidence.reportSignals?.styleAnalysisAvailable === true,
            holdingContext: evidence.holding?.hasHoldingContext === true,
          }, ['ownership_inputs']),
        },
      };
    case 'trend':
      return {
        member: memberKey,
        facts: {
          ...common,
          momentumInputs: presentValue({
            relativeReturnAvailable: evidence.reportSignals?.relativeReturnAvailable === true,
            styleAnalysisAvailable: evidence.reportSignals?.styleAnalysisAvailable === true,
            recentReportsAvailable: evidence.reportSignals?.recentReportsAvailable === true,
          }, ['trend_inputs']),
        },
      };
    case 'consensusMomentum':
      return {
        member: memberKey,
        facts: {
          ...common,
          consensusInputs: presentValue({
            consensusAvailable: evidence.reportSignals?.consensusAvailable === true,
            opinionAvailable: evidence.reportSignals?.opinionAvailable === true,
            recentReportCount: evidence.reportSignals?.recentReportCount ?? null,
          }, ['consensus_inputs']),
        },
      };
    case 'priceLocation':
      return {
        member: memberKey,
        facts: {
          ...common,
          priceInputs: presentValue({
            currentPrice: evidence.currentQuote?.price ?? null,
            averagePrice: evidence.holding?.averagePrice ?? null,
          }, ['price_location_inputs']),
        },
      };
    case 'avgPriceGap':
      return {
        member: memberKey,
        facts: {
          ...common,
          avgPriceGapInputs: presentValue({
            currentPrice: evidence.currentQuote?.price ?? null,
            averagePrice: evidence.holding?.averagePrice ?? null,
            shares: evidence.holding?.shares ?? null,
          }, ['avg_price_gap_inputs']),
        },
      };
    case 'upsideBuffer':
      return {
        member: memberKey,
        facts: {
          ...common,
          upsideInputs: presentValue({
            consensusAvailable: evidence.reportSignals?.consensusAvailable === true,
            opinionAvailable: evidence.reportSignals?.opinionAvailable === true,
            recentReportsAvailable: evidence.reportSignals?.recentReportsAvailable === true,
            styleAnalysisAvailable: evidence.reportSignals?.styleAnalysisAvailable === true,
          }, ['upside_inputs']),
        },
      };
    case 'holdingCompleteness':
      return {
        member: memberKey,
        facts: {
          ...common,
          holdingInputs: presentValue({
            hasHoldingContext: evidence.holding?.hasHoldingContext === true,
            hasFullSellNowInputs: evidence.holding?.hasFullSellNowInputs === true,
            shares: evidence.holding?.shares ?? null,
            averagePrice: evidence.holding?.averagePrice ?? null,
            evaluationAmount: evidence.holding?.evaluationAmount ?? null,
          }, ['holding_completeness_inputs']),
        },
      };
    default:
      return { member: memberKey, facts: common };
  }
}

function systemPrompt(memberKey) {
  const spec = KR_MEMBER_SPECS[memberKey];
  return [
    `You are Jaroo KR DeepScan committee member: ${spec.role}.`,
    spec.focus,
    'Use only the provided sharedContext/memberContext JSON generated from KR evidence and dump inputs.',
    'Treat package-derived context as supplemental only, never as silent numeric truth.',
    'Missing or unavailable facts must lower confidence and can lower the score.',
    'Return only valid JSON matching the schema. Write the reason in concise Korean.',
    'Score semantics: 0 extremely negative, 50 mixed/unclear, 100 extremely positive.',
  ].join(' ');
}

function rollupAxis(axisKey, memberKeys, results) {
  const validMembers = memberKeys.filter((memberKey) => results[memberKey]);
  if (validMembers.length === 0) {
    return {
      axisKey,
      validMembers,
      omitted: true,
      score: null,
      memberScores: {},
    };
  }

  const memberScores = Object.fromEntries(validMembers.map((memberKey) => [memberKey, results[memberKey].score]));
  const committee = buildKrCommitteeFromMemberScores(memberScores);
  const score = axisKey === 'businessQuality'
    ? committee.businessQuality.score
    : axisKey === 'marketTiming'
      ? committee.marketTiming.score
      : committee.positionFit.score;

  return {
    axisKey,
    validMembers,
    omitted: false,
    score,
    memberScores,
  };
}

export async function scoreDeepScanKrCommitteeFromDump(rawInput, input, evidence, sources) {
  const requestId = `kr-committee-${input.instrument.code ?? input.instrument.name ?? randomUUID()}-${Date.now()}`;
  const shared = buildSharedDump(input, evidence, sources);
  const members = Object.fromEntries(Object.keys(KR_MEMBER_SPECS).map((memberKey) => [memberKey, buildMemberDump(memberKey, input, evidence, sources)]));
  const logDir = join(process.cwd(), '.omx', 'context', 'committee-debug-logs', requestId);
  writeJson(logDir, 'runtime-shape.json', { shared, members });

  const enabled = normalizeText(process.env.DEEPSCAN_KR_LLM_ENABLE)?.toLowerCase();
  if (!process.env.OPENROUTER_API_KEY && !['1', 'true', 'yes', 'on'].includes(enabled ?? '')) {
    return {
      requestId,
      runtimeShape: { shared, members },
      results: {},
      errors: [{ member: 'all', error: 'OPENROUTER_API_KEY is not configured.' }],
    };
  }

  const { results, errors } = await scoreCommitteeMembers({
    memberKeys: Object.keys(KR_MEMBER_SPECS),
    shared,
    members,
    options: {
      schemaName: 'jaroo_kr_committee_member',
      title: 'jaroo-mvp-v3 KR DeepScan Committee',
      model: process.env.DEEPSCAN_KR_LLM_MODEL ?? process.env.DEEPSCAN_LLM_MODEL ?? process.env.OCR_MODEL ?? 'qwen/qwen3.5-flash-02-23',
      summaryKey: input.instrument.code ?? input.instrument.name ?? 'kr',
      logDir,
      systemPrompt,
    },
  });

  writeJson(logDir, 'summary.json', { requestId, errors, results });

  return {
    requestId,
    runtimeShape: { shared, members },
    results,
    errors,
  };
}

export function buildKrCommitteeAxesFromLlmResults(evidence, llmResults) {
  const byAxis = {
    businessQuality: ['profitability', 'valuation', 'ownershipStability'],
    marketTiming: ['trend', 'consensusMomentum', 'priceLocation'],
    positionFit: ['avgPriceGap', 'upsideBuffer', 'holdingCompleteness'],
  };

  const businessAxis = rollupAxis('businessQuality', byAxis.businessQuality, llmResults);
  const marketAxis = rollupAxis('marketTiming', byAxis.marketTiming, llmResults);
  const positionAxis = rollupAxis('positionFit', byAxis.positionFit, llmResults);

  const axes = [businessAxis, marketAxis, positionAxis]
    .filter((axis) => !axis.omitted)
    .map((axis) => ({
      label: axis.axisKey === 'businessQuality' ? 'Business Quality' : axis.axisKey === 'marketTiming' ? 'Market Timing' : 'Position Fit',
      score: axis.score,
      scoreText: `${axis.score} / 100`,
      axisStatusText: `LLM 위원 ${axis.validMembers.length}/3명 반영`,
      subtitle: axis.axisKey === 'businessQuality'
        ? '덤프 기반 KR 기업 체력 점수'
        : axis.axisKey === 'marketTiming'
          ? '덤프 기반 KR 타이밍 신호 점수'
          : '덤프 기반 KR 포지션 적합도 점수',
      avgLabel: `위원 평균 ${axis.score}`,
      members: axis.validMembers.map((memberKey) => ({
        shortLabel: KR_MEMBER_SPECS[memberKey].shortLabel,
        title: KR_MEMBER_SPECS[memberKey].title,
        reason: llmResults[memberKey].reason,
        score: llmResults[memberKey].score,
        scoreLabel: String(llmResults[memberKey].score),
        tone: llmResults[memberKey].score >= 70 ? 'positive' : llmResults[memberKey].score >= 55 ? 'neutral' : 'warning',
        iconTone: llmResults[memberKey].score >= 70 ? 'green' : llmResults[memberKey].score >= 55 ? 'blue' : 'amber',
      })),
    }));

  const committeeScores = buildKrCommitteeFromMemberScores(Object.fromEntries(Object.entries(llmResults).map(([key, value]) => [key, value.score])));
  return {
    axes,
    committeeScores,
    coverage: {
      businessQuality: businessAxis,
      marketTiming: marketAxis,
      positionFit: positionAxis,
    },
  };
}
