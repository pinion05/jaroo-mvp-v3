function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function round(value) {
  return Math.round(value);
}

function roundToTwo(value) {
  return Math.round(value * 100) / 100;
}

function scoreFlag(condition, points) {
  return condition ? points : 0;
}

function hasPage(pageIds, pageId) {
  return Array.isArray(pageIds) && pageIds.includes(pageId);
}

function getGapPct(currentPrice, averagePrice) {
  if (currentPrice === null || averagePrice === null || averagePrice === 0) {
    return null;
  }

  return ((currentPrice - averagePrice) / averagePrice) * 100;
}

function getHeroLabel(score) {
  if (score >= 67) {
    return 'strong';
  }

  if (score >= 55) {
    return 'moderate';
  }

  return 'caution';
}

function getHeroStatusText(score) {
  if (score >= 67) {
    return '우세';
  }

  if (score >= 55) {
    return '보통';
  }

  return '경계';
}

function getPortfolioDelta(decisionBand) {
  switch (decisionBand) {
    case 'hold':
      return 2;
    case 'trim':
      return 6;
    case 'exit-watch':
      return 9;
    case 'exit-now':
      return 12;
    default:
      return null;
  }
}

export const KR_COMMITTEE_MEMBER_KEYS = Object.freeze([
  'profitability',
  'valuation',
  'ownershipStability',
  'trend',
  'consensusMomentum',
  'priceLocation',
  'avgPriceGap',
  'upsideBuffer',
  'holdingCompleteness',
]);

export const KR_AXIS_WEIGHTS = Object.freeze({
  businessQuality: Object.freeze({
    profitability: 0.4,
    valuation: 0.35,
    ownershipStability: 0.25,
  }),
  marketTiming: Object.freeze({
    trend: 0.4,
    consensusMomentum: 0.35,
    priceLocation: 0.25,
  }),
  positionFit: Object.freeze({
    avgPriceGap: 0.45,
    upsideBuffer: 0.3,
    holdingCompleteness: 0.25,
  }),
});

export const KR_HERO_WEIGHTS = Object.freeze({
  businessQuality: 0.4,
  marketTiming: 0.35,
  positionFit: 0.25,
});

export const KR_PORTFOLIO_DELTA_BY_DECISION = Object.freeze({
  hold: 2,
  trim: 6,
  'exit-watch': 9,
  'exit-now': 12,
});

function getHeroPenalties(currentPrice, reportSignals) {
  const penalties = [];
  let penaltyPoints = 0;

  if (currentPrice === null) {
    penalties.push('missing-current-quote');
    penaltyPoints += 8;
  }

  if (reportSignals.consensusAvailable !== true && reportSignals.opinionAvailable !== true) {
    penalties.push('missing-analyst-coverage');
    penaltyPoints += 6;
  }

  if (reportSignals.recentReportsAvailable !== true) {
    penalties.push('missing-recent-reports');
    penaltyPoints += 4;
  }

  return {
    penalties,
    penaltyPoints,
  };
}

function buildSellNowAndSimulation({
  heroScore,
  positionFitScore,
  currentPrice,
  averagePrice,
  shares,
  gapPct,
  hasFullSellNowInputs,
}) {
  const hasSellNowInputs = hasFullSellNowInputs === true;
  const evaluationPnL = hasSellNowInputs && currentPrice !== null && averagePrice !== null && shares !== null
    ? roundToTwo((currentPrice - averagePrice) * shares)
    : null;
  const evaluationPnLPct = hasSellNowInputs && gapPct !== null
    ? roundToTwo(gapPct)
    : null;

  let sellNow;
  if (!hasSellNowInputs) {
    sellNow = {
      available: false,
      decisionBand: 'blocked',
      currentPrice,
      averagePrice,
      evaluationPnL: null,
      evaluationPnLPct: null,
    };
  } else {
    let decisionBand = 'hold';

    if (heroScore < 45 && gapPct !== null && gapPct <= 0) {
      decisionBand = 'exit-now';
    } else if (heroScore < 55 || positionFitScore < 45) {
      decisionBand = 'exit-watch';
    } else if (heroScore < 67 && gapPct !== null && gapPct > 0) {
      decisionBand = 'trim';
    }

    sellNow = {
      available: true,
      decisionBand,
      currentPrice,
      averagePrice,
      evaluationPnL,
      evaluationPnLPct,
    };
  }

  const portfolioSimulation = sellNow.available
    ? (() => {
        const beforeScore = clamp(round(positionFitScore * 0.7 + heroScore * 0.3));
        const delta = getPortfolioDelta(sellNow.decisionBand);
        const afterScore = clamp(beforeScore + delta);

        return {
          available: true,
          beforeScore,
          afterScore,
          delta,
          deltaLabel: `${sellNow.decisionBand}:${delta >= 0 ? '+' : ''}${delta}`,
        };
      })()
    : {
        available: false,
        beforeScore: null,
        afterScore: null,
        delta: null,
        deltaLabel: null,
      };

  return {
    sellNow,
    portfolioSimulation,
  };
}

export function buildKrCommitteeFromMemberScores(memberScores = {}) {
  const scoreOf = (key) => clamp(asFiniteNumber(memberScores[key]) ?? 0);

  const profitability = scoreOf('profitability');
  const valuation = scoreOf('valuation');
  const ownershipStability = scoreOf('ownershipStability');
  const trend = scoreOf('trend');
  const consensusMomentum = scoreOf('consensusMomentum');
  const priceLocation = scoreOf('priceLocation');
  const avgPriceGap = scoreOf('avgPriceGap');
  const upsideBuffer = scoreOf('upsideBuffer');
  const holdingCompleteness = scoreOf('holdingCompleteness');

  const businessQualityScore = clamp(round(
    profitability * KR_AXIS_WEIGHTS.businessQuality.profitability
      + valuation * KR_AXIS_WEIGHTS.businessQuality.valuation
      + ownershipStability * KR_AXIS_WEIGHTS.businessQuality.ownershipStability,
  ));

  const marketTimingScore = clamp(round(
    trend * KR_AXIS_WEIGHTS.marketTiming.trend
      + consensusMomentum * KR_AXIS_WEIGHTS.marketTiming.consensusMomentum
      + priceLocation * KR_AXIS_WEIGHTS.marketTiming.priceLocation,
  ));

  const positionFitScore = clamp(round(
    avgPriceGap * KR_AXIS_WEIGHTS.positionFit.avgPriceGap
      + upsideBuffer * KR_AXIS_WEIGHTS.positionFit.upsideBuffer
      + holdingCompleteness * KR_AXIS_WEIGHTS.positionFit.holdingCompleteness,
  ));

  return {
    businessQuality: {
      score: businessQualityScore,
      profitability,
      valuation,
      ownershipStability,
    },
    marketTiming: {
      score: marketTimingScore,
      trend,
      consensusMomentum,
      priceLocation,
    },
    positionFit: {
      score: positionFitScore,
      avgPriceGap,
      upsideBuffer,
      holdingCompleteness,
    },
  };
}

export function scoreDeepScanKrFromCommittee(evidence = {}, committee) {
  const safeEvidence = asObject(evidence);
  const reportSignals = asObject(safeEvidence.reportSignals);
  const holding = asObject(safeEvidence.holding);
  const currentQuote = asObject(safeEvidence.currentQuote);
  const currentPrice = asFiniteNumber(currentQuote.price);
  const averagePrice = asFiniteNumber(holding.averagePrice);
  const shares = asFiniteNumber(holding.shares);
  const gapPct = getGapPct(currentPrice, averagePrice);
  const safeCommittee = asObject(committee);
  const businessQualityScore = asFiniteNumber(asObject(safeCommittee.businessQuality)?.score) ?? 0;
  const marketTimingScore = asFiniteNumber(asObject(safeCommittee.marketTiming)?.score) ?? 0;
  const positionFitScore = asFiniteNumber(asObject(safeCommittee.positionFit)?.score) ?? 0;

  const baseHeroScore = clamp(round(
    businessQualityScore * KR_HERO_WEIGHTS.businessQuality
      + marketTimingScore * KR_HERO_WEIGHTS.marketTiming
      + positionFitScore * KR_HERO_WEIGHTS.positionFit,
  ));
  const { penalties, penaltyPoints } = getHeroPenalties(currentPrice, reportSignals);
  const heroScore = clamp(baseHeroScore - penaltyPoints);
  const { sellNow, portfolioSimulation } = buildSellNowAndSimulation({
    heroScore,
    positionFitScore,
    currentPrice,
    averagePrice,
    shares,
    gapPct,
    hasFullSellNowInputs: holding.hasFullSellNowInputs,
  });

  return {
    committee: safeCommittee,
    hero: {
      score: heroScore,
      scoreLabel: getHeroLabel(heroScore),
      statusText: getHeroStatusText(heroScore),
      penalties,
    },
    sellNow,
    portfolioSimulation,
  };
}

export function scoreDeepScanKrEvidence(evidence = {}) {
  const safeEvidence = asObject(evidence);
  const pageCoverage = asObject(safeEvidence.pageCoverage);
  const sourceCoverage = asObject(safeEvidence.sourceCoverage);
  const reportSignals = asObject(safeEvidence.reportSignals);
  const holding = asObject(safeEvidence.holding);
  const currentQuote = asObject(safeEvidence.currentQuote);
  const availablePageIds = Array.isArray(pageCoverage.availablePageIds) ? pageCoverage.availablePageIds : [];
  const currentPrice = asFiniteNumber(currentQuote.price);
  const averagePrice = asFiniteNumber(holding.averagePrice);
  const shares = asFiniteNumber(holding.shares);
  const recentReportCount = Math.max(0, asFiniteNumber(reportSignals.recentReportCount) ?? 0);
  const gapPct = getGapPct(currentPrice, averagePrice);

  const profitability = clamp(
    20
      + scoreFlag(hasPage(availablePageIds, 'company-overview'), 20)
      + scoreFlag(hasPage(availablePageIds, 'financial-analysis'), 20)
      + scoreFlag(hasPage(availablePageIds, 'fnguide-finance'), 15)
      + scoreFlag(reportSignals.recentReportsAvailable === true, 10)
      + Math.min(recentReportCount * 3, 15),
  );

  const valuation = clamp(
    20
      + scoreFlag(reportSignals.consensusAvailable === true, 25)
      + scoreFlag(reportSignals.opinionAvailable === true, 15)
      + scoreFlag(hasPage(availablePageIds, 'investment-indicators'), 15)
      + scoreFlag(reportSignals.relativeReturnAvailable === true, 10)
      + scoreFlag(currentPrice !== null, 10),
  );

  const ownershipStability = clamp(
    20
      + scoreFlag(hasPage(availablePageIds, 'shareholding'), 25)
      + scoreFlag(reportSignals.styleAnalysisAvailable === true, 15)
      + scoreFlag(reportSignals.opinionAvailable === true, 10)
      + scoreFlag(sourceCoverage.hasHolding === true || holding.hasHoldingContext === true, 10)
      + scoreFlag(hasPage(availablePageIds, 'company-overview'), 5),
  );

  const businessQualityScore = clamp(round(
    profitability * 0.4 + valuation * 0.35 + ownershipStability * 0.25,
  ));

  const trend = clamp(
    20
      + scoreFlag(reportSignals.relativeReturnAvailable === true, 30)
      + scoreFlag(reportSignals.styleAnalysisAvailable === true, 20)
      + scoreFlag(reportSignals.recentReportsAvailable === true, 10)
      + scoreFlag(currentPrice !== null, 10),
  );

  const consensusMomentum = clamp(
    15
      + scoreFlag(reportSignals.consensusAvailable === true, 30)
      + scoreFlag(reportSignals.opinionAvailable === true, 20)
      + scoreFlag(reportSignals.recentReportsAvailable === true, 10)
      + Math.min(recentReportCount * 3, 10),
  );

  const priceLocation = clamp(
    gapPct === null
      ? 20 + scoreFlag(currentPrice !== null, 15) + scoreFlag(reportSignals.relativeReturnAvailable === true, 20) + scoreFlag(reportSignals.consensusAvailable === true, 10)
      : round(55 + gapPct),
  );

  const marketTimingScore = clamp(round(
    trend * 0.4 + consensusMomentum * 0.35 + priceLocation * 0.25,
  ));

  const holdingCompleteness = clamp(
    holding.hasFullSellNowInputs === true
      ? 90
      : holding.hasHoldingContext === true || sourceCoverage.hasHolding === true
        ? 45
        : 20,
  );

  const avgPriceGap = clamp(
    gapPct === null
      ? (holding.hasHoldingContext === true || sourceCoverage.hasHolding === true ? 35 : 20)
      : round(50 + (gapPct * 1.5)),
  );

  const upsidePenalty = gapPct !== null && gapPct > 25 ? 10 : gapPct !== null && gapPct > 15 ? 5 : 0;
  const upsideBuffer = clamp(
    25
      + scoreFlag(reportSignals.consensusAvailable === true, 25)
      + scoreFlag(reportSignals.opinionAvailable === true, 15)
      + scoreFlag(reportSignals.recentReportsAvailable === true, 10)
      + scoreFlag(reportSignals.styleAnalysisAvailable === true, 10)
      + scoreFlag(currentPrice !== null, 5)
      - upsidePenalty,
  );

  const positionFitScore = clamp(round(
    avgPriceGap * 0.45 + upsideBuffer * 0.3 + holdingCompleteness * 0.25,
  ));

  const committee = {
    businessQuality: {
      score: businessQualityScore,
      profitability,
      valuation,
      ownershipStability,
    },
    marketTiming: {
      score: marketTimingScore,
      trend,
      consensusMomentum,
      priceLocation,
    },
    positionFit: {
      score: positionFitScore,
      avgPriceGap,
      upsideBuffer,
      holdingCompleteness,
    },
  };

  return scoreDeepScanKrFromCommittee(evidence, committee);
}
