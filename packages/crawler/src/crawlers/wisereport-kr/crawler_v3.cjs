const { measureCompleteness } = require('./helpers.cjs');

const SOURCE_PRIORITY = Object.freeze({
  network: 0,
  dom: 1,
  iframe: 2,
  text: 3,
  unknown: 9,
});

function sourcePriority(source) {
  return SOURCE_PRIORITY[source] ?? SOURCE_PRIORITY.unknown;
}

function selectPreferredCandidate(candidates) {
  const valid = (candidates || []).filter((candidate) => candidate && candidate.value != null);
  if (!valid.length) {
    return null;
  }
  return [...valid].sort((left, right) => {
    const priorityDiff = sourcePriority(left.source) - sourcePriority(right.source);
    if (priorityDiff !== 0) {
      return priorityDiff;
    }
    const completenessDiff = Number(right.completeness || 0) - Number(left.completeness || 0);
    if (completenessDiff !== 0) {
      return completenessDiff;
    }
    return String(left.field || '').localeCompare(String(right.field || ''));
  })[0];
}

function finalizeNormalizedPayload({ spec, code, v1, v2 }) {
  const normalized = { ...(v2?.base || { company: { code }, sourceType: spec.sourceType, sourceKey: spec.sourceKey, bodyTextHead: '' }) };
  const provenance = {};
  const candidateEntries = Object.entries(v2?.candidates || {});
  const selectedSources = {};
  const fallbackActivatedFields = [];
  const selectedNetworkFields = [];
  const selectedIframeFields = [];

  for (const [field, candidates] of candidateEntries) {
    const selected = selectPreferredCandidate(candidates);
    normalized[field] = selected ? selected.value : null;
    selectedSources[field] = selected?.source || null;
    if (selected?.source === 'network') {
      selectedNetworkFields.push(field);
    }
    if (selected?.source === 'iframe') {
      selectedIframeFields.push(field);
      fallbackActivatedFields.push(field);
    }
    provenance[field] = {
      selectedSource: selected?.source || null,
      selectedCompleteness: selected?.completeness || 0,
      candidateCount: (candidates || []).length,
      candidates: (candidates || []).map((candidate) => ({
        source: candidate.source,
        completeness: candidate.completeness,
        sourceDetail: candidate.sourceDetail || {},
      })),
    };
  }

  const quality = buildQualityAssessment({
    spec,
    capture: v1?.capture || {},
    normalized,
    candidates: v2?.candidates || {},
    provenance,
    source: v1?.source || {},
    fallbackActivatedFields,
    selectedNetworkFields,
    selectedIframeFields,
  });

  const selectedFieldCount = candidateEntries.length;
  const confidence = quality.warnings.length === 0
    ? 'high'
    : quality.warnings.length <= 2
      ? 'medium'
      : 'low';

  return {
    normalized,
    provenance,
    quality,
    stages: {
      crawler_v1: v1?.stage || { ok: false, strategy: 'crawler_v1' },
      crawler_v2: {
        ok: Boolean(v2?.ok),
        strategy: 'crawler_v2',
        candidateFieldCount: v2?.extractionMeta?.candidateFieldCount || 0,
        iframeCandidateCount: v2?.extractionMeta?.iframeCandidateCount || 0,
        networkCandidateCount: v2?.extractionMeta?.networkCandidateCount || 0,
        totalCandidateCount: v2?.extractionMeta?.totalCandidateCount || 0,
        iframeTableCount: v2?.extractionMeta?.iframeTableCount || 0,
      },
      crawler_v3: {
        ok: quality.ok,
        strategy: 'crawler_v3',
        selectedFieldCount,
        selectedSources,
        fallbackActivatedFields,
        selectedNetworkFields,
        selectedIframeFields,
        confidence,
      },
    },
  };
}

function buildQualityAssessment({ spec, capture, normalized, candidates, source, fallbackActivatedFields, selectedNetworkFields, selectedIframeFields }) {
  const warnings = [];
  const normalizedSectionCount = Object.entries(normalized || {})
    .filter(([key, value]) => !['company', 'sourceType', 'sourceKey', 'bodyTextHead'].includes(key) && value != null)
    .length;

  if (!(capture?.tables || []).length) {
    warnings.push('no tables captured');
  }
  if (!(capture?.bodyTextLength || 0)) {
    warnings.push('body text was empty after noise removal');
  }
  if (spec.sourceType === 'fnguide' && spec.id === 'relative-return' && !normalized.chartJson) {
    warnings.push('expected direct chart JSON capture was not present');
  }
  if (spec.sourceType === 'fnguide' && spec.id === 'style-analysis' && !normalized.factorScores) {
    warnings.push('expected direct factor score JSON capture was not present');
  }

  const missingFields = Object.entries(candidates || {})
    .filter(([field]) => normalized[field] == null)
    .map(([field]) => field);
  if (missingFields.length) {
    warnings.push(`missing normalized fields: ${missingFields.join(', ')}`);
  }

  return {
    ok: warnings.length === 0,
    warnings,
    removedNoiseCount: (capture?.removedNoise || []).length,
    removedNoiseSelectors: Array.from(new Set((capture?.removedNoise || []).map((item) => item.selector))).sort(),
    requestCount: (source?.requestLog || []).length,
    responseCaptureCount: (source?.capturedResponses || []).length,
    iframeCount: (source?.iframes || []).length,
    tableCount: (capture?.tables || []).length,
    chartAssetCount: (capture?.chartAssets || []).length,
    normalizedSectionCount,
    hasBodyText: (capture?.bodyTextLength || 0) > 0,
    fallbackActivatedFields,
    selectedNetworkFields,
    selectedIframeFields,
  };
}

function finalizePageResult({ spec, code, v1, v2 }) {
  const finalized = finalizeNormalizedPayload({ spec, code, v1, v2 });
  return {
    id: spec.id,
    legacyKey: spec.legacyKey,
    sourceKey: spec.sourceKey,
    sourceType: spec.sourceType,
    title: spec.title,
    source: v1.source,
    capture: v1.capture,
    normalized: finalized.normalized,
    provenance: finalized.provenance,
    quality: finalized.quality,
    stages: finalized.stages,
  };
}

function buildAggregateResult({ code, pages, pageSpecs }) {
  const pagesById = Object.fromEntries(pages.map((page) => [page.id, page]));
  const pagesBySourceKey = Object.fromEntries(pages.map((page) => [page.sourceKey, page]));
  const pagesByLegacyKey = Object.fromEntries(pages.map((page) => [page.legacyKey, page]));
  const summary = {
    requestedPages: pageSpecs.length,
    completedPages: pages.length,
    pageIds: pages.map((page) => page.id),
    pageSourceKeys: pages.map((page) => page.sourceKey),
    warningCount: pages.reduce((count, page) => count + (page.quality?.warnings?.length || 0), 0),
  };

  return {
    source: {
      code,
      collectedAt: new Date().toISOString(),
      provider: 'wisereport-kr-structured-v123',
      routeCount: pageSpecs.length,
    },
    capture: {
      pageOrder: pageSpecs.map((page) => page.id),
      pageIds: pages.map((page) => page.id),
      pageSourceKeys: pages.map((page) => page.sourceKey),
      pageLegacyKeys: pages.map((page) => page.legacyKey).filter(Boolean),
      pagesBySourceKey,
      pagesByLegacyKey,
    },
    normalized: pagesById,
    pages: pagesById,
    quality: {
      ...summary,
      pages: Object.fromEntries(pages.map((page) => [page.id, page.quality])),
    },
    stages: {
      crawler_v1: {
        ok: pages.every((page) => page.stages?.crawler_v1?.ok),
        completedPages: pages.filter((page) => page.stages?.crawler_v1?.ok).length,
      },
      crawler_v2: {
        ok: pages.every((page) => page.stages?.crawler_v2?.ok),
        totalCandidateFields: pages.reduce((sum, page) => sum + (page.stages?.crawler_v2?.candidateFieldCount || 0), 0),
      },
      crawler_v3: {
        ok: pages.every((page) => page.stages?.crawler_v3?.ok),
        highConfidencePages: pages.filter((page) => page.stages?.crawler_v3?.confidence === 'high').length,
      },
    },
  };
}

module.exports = {
  selectPreferredCandidate,
  finalizeNormalizedPayload,
  finalizePageResult,
  buildAggregateResult,
};
