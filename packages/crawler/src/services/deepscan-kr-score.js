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
      + Math.min(recentReportCount * 3, 15)
      + scoreFlag(sourceCoverage.hasPackageResult === true, 5),
  );

  const valuation = clamp(
    20
      + scoreFlag(reportSignals.consensusAvailable === true, 25)
      + scoreFlag(reportSignals.opinionAvailable === true, 15)
      + scoreFlag(hasPage(availablePageIds, 'investment-indicators'), 15)
      + scoreFlag(reportSignals.relativeReturnAvailable === true, 10)
      + scoreFlag(currentPrice !== null, 10)
      + scoreFlag(sourceCoverage.hasPackageResult === true, 5),
  );

  const ownershipStability = clamp(
    20
      + scoreFlag(hasPage(availablePageIds, 'shareholding'), 25)
      + scoreFlag(reportSignals.styleAnalysisAvailable === true, 15)
      + scoreFlag(reportSignals.opinionAvailable === true, 10)
      + scoreFlag(sourceCoverage.hasHolding === true || holding.hasHoldingContext === true, 10)
      + scoreFlag(sourceCoverage.hasPackageResult === true, 5)
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
      + Math.min(recentReportCount * 3, 10)
      + scoreFlag(sourceCoverage.hasPackageResult === true, 5),
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

  const baseHeroScore = clamp(round(
    businessQualityScore * 0.4 + marketTimingScore * 0.35 + positionFitScore * 0.25,
  ));

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

  const heroScore = clamp(baseHeroScore - penaltyPoints);

  const hasSellNowInputs = holding.hasFullSellNowInputs === true;
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
    committee: {
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
    },
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
