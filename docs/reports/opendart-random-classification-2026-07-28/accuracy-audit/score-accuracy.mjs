import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  CANONICAL_DISCLOSURE_EVENT_FIELDS,
  KR_DISCLOSURE_EVENT_ONTOLOGY_HASH,
  KR_DISCLOSURE_EVENT_ONTOLOGY_VERSION,
  validateCanonicalDisclosureEvent,
} from '../../../../packages/crawler/src/services/deepscan-kr-disclosure-event-ontology.js';

const here = dirname(fileURLToPath(import.meta.url));
const reportDir = resolve(here, '..');

function canonicalEvent(event) {
  return Object.fromEntries(
    CANONICAL_DISCLOSURE_EVENT_FIELDS.map((field) => [field, event?.[field]]),
  );
}

function eventKey(event) {
  return JSON.stringify(canonicalEvent(event));
}

function sortedEventKeys(events) {
  return events.map(eventKey).sort();
}

export function eventMultisetEqual(left, right) {
  if (left.length !== right.length) return false;
  const leftKeys = sortedEventKeys(left);
  const rightKeys = sortedEventKeys(right);
  return leftKeys.every((key, index) => key === rightKeys[index]);
}

function exactTupleIntersection(left, right) {
  const rightCounts = new Map();
  for (const key of sortedEventKeys(right)) {
    rightCounts.set(key, (rightCounts.get(key) ?? 0) + 1);
  }
  let matches = 0;
  for (const key of sortedEventKeys(left)) {
    const remaining = rightCounts.get(key) ?? 0;
    if (remaining <= 0) continue;
    matches += 1;
    rightCounts.set(key, remaining - 1);
  }
  return matches;
}

function pairFieldMatches(gold, prediction) {
  return Object.fromEntries(CANONICAL_DISCLOSURE_EVENT_FIELDS.map((field) => [
    field,
    Boolean(gold && prediction && gold[field] === prediction[field]) ? 1 : 0,
  ]));
}

function totalMatches(matches) {
  return CANONICAL_DISCLOSURE_EVENT_FIELDS.reduce((sum, field) => sum + matches[field], 0);
}

function compareAlignment(left, right) {
  if (!right) return 1;
  if (left.total !== right.total) return left.total - right.total;
  return JSON.stringify(right.pairs).localeCompare(JSON.stringify(left.pairs));
}

export function bestAlignment(goldEvents, predictedEvents) {
  const size = Math.max(goldEvents.length, predictedEvents.length);
  if (size === 0) return { pairs: [], fieldMatches: {}, total: 0 };
  if (size > 16) throw new Error(`Too many events for deterministic audit alignment: ${size}`);

  const gold = [...goldEvents, ...Array(size - goldEvents.length).fill(null)];
  const predictions = [
    ...predictedEvents,
    ...Array(size - predictedEvents.length).fill(null),
  ];
  const memo = new Map();

  function solve(goldIndex, usedMask) {
    if (goldIndex === size) return { pairs: [], total: 0 };
    const memoKey = `${goldIndex}:${usedMask}`;
    if (memo.has(memoKey)) return memo.get(memoKey);

    let best = null;
    for (let predictedIndex = 0; predictedIndex < size; predictedIndex += 1) {
      if (usedMask & (1 << predictedIndex)) continue;
      const matches = pairFieldMatches(gold[goldIndex], predictions[predictedIndex]);
      const tail = solve(goldIndex + 1, usedMask | (1 << predictedIndex));
      const candidate = {
        total: totalMatches(matches) + tail.total,
        pairs: [{
          goldIndex: goldIndex < goldEvents.length ? goldIndex : null,
          predictedIndex: predictedIndex < predictedEvents.length ? predictedIndex : null,
          matches,
        }, ...tail.pairs],
      };
      if (compareAlignment(candidate, best) > 0) best = candidate;
    }
    memo.set(memoKey, best);
    return best;
  }

  const result = solve(0, 0);
  const fieldMatches = Object.fromEntries(
    CANONICAL_DISCLOSURE_EVENT_FIELDS.map((field) => [
      field,
      result.pairs.reduce((sum, pair) => sum + pair.matches[field], 0),
    ]),
  );
  return { ...result, fieldMatches };
}

export function wilsonInterval(successes, total, z = 1.959963984540054) {
  if (!total) return { lower: null, upper: null };
  const proportion = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = (proportion + (z * z) / (2 * total)) / denominator;
  const margin = (z / denominator) * Math.sqrt(
    (proportion * (1 - proportion)) / total + (z * z) / (4 * total * total),
  );
  return { lower: center - margin, upper: center + margin };
}

function ratio(numerator, denominator) {
  return denominator ? numerator / denominator : null;
}

function f1(precision, recall) {
  return precision != null && recall != null && precision + recall
    ? (2 * precision * recall) / (precision + recall)
    : null;
}

function predictionDisposition(extraction) {
  if (!extraction) return 'unresolved';
  return extraction.disposition ?? (
    extraction.events?.length ? 'canonical-events-present' : 'no-canonical-events'
  );
}

function isCorrection(result) {
  return /^\[[^\]]*정정/u.test(result.source.reportName.trim());
}

function summarizeStratum(rows) {
  const exact = rows.filter((row) => row.exact).length;
  return {
    total: rows.length,
    exact,
    accuracy: ratio(exact, rows.length),
  };
}

function groupSummary(rows, selector) {
  const groups = new Map();
  for (const row of rows) {
    const key = String(selector(row));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return Object.fromEntries(
    [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, values]) => [key, summarizeStratum(values)]),
  );
}

export function scoreCases({ goldCases, sourceResults }) {
  const goldByReceipt = new Map(goldCases.map((entry) => [entry.rceptNo, entry]));
  const caseResults = [];

  for (const [index, result] of sourceResults.entries()) {
    const gold = goldByReceipt.get(result.source.rceptNo);
    if (!gold) throw new Error(`Missing gold case for ${result.source.rceptNo}`);
    const predictedEvents = (result.eventExtraction?.events ?? []).map(canonicalEvent);
    const goldEvents = Array.isArray(gold.goldEvents) ? gold.goldEvents.map(canonicalEvent) : null;
    const assessable = Boolean(gold.assessable && goldEvents);
    const predictionPresent = Boolean(result.eventExtraction);
    const predictionShapeValid = predictionPresent
      ? predictedEvents.every((event) => validateCanonicalDisclosureEvent(event).valid)
      : null;
    const predictionValid = Boolean(predictionPresent && predictionShapeValid);

    if (!assessable) {
      caseResults.push({
        index,
        rceptNo: result.source.rceptNo,
        corpName: result.source.corpName,
        reportName: result.source.reportName.trim(),
        assessable: false,
        originalDocumentAvailable: Boolean(result.document),
        exact: false,
        endToEndUsableExact: false,
        predictionPresent,
        predictionResolved: Boolean(result.eventExtraction?.resolved),
        predictionShapeValid,
        predictionValid,
        predictedEvents,
        goldEvents: null,
        goldConfidence: gold.confidence,
      });
      continue;
    }

    const goldDisposition = goldEvents.length
      ? 'canonical-events-present'
      : 'no-canonical-events';
    const exact = Boolean(
      predictionValid &&
      result.eventExtraction?.resolved &&
      predictionDisposition(result.eventExtraction) === goldDisposition &&
      eventMultisetEqual(goldEvents, predictedEvents)
    );
    const toleranceExact = exact || Boolean(
      predictionValid &&
      result.eventExtraction?.resolved &&
      (gold.acceptableAlternatives ?? []).some((alternative) => {
        const alternativeDisposition = alternative.length
          ? 'canonical-events-present'
          : 'no-canonical-events';
        return predictionDisposition(result.eventExtraction) === alternativeDisposition &&
          eventMultisetEqual(alternative, predictedEvents);
      })
    );
    const alignment = bestAlignment(goldEvents, predictedEvents);
    const fieldDenominator = Math.max(goldEvents.length, predictedEvents.length);
    const mismatchedFields = fieldDenominator
      ? CANONICAL_DISCLOSURE_EVENT_FIELDS.filter(
        (field) => (alignment.fieldMatches[field] ?? 0) < fieldDenominator,
      )
      : [];

    caseResults.push({
      index,
      rceptNo: result.source.rceptNo,
      corpName: result.source.corpName,
      reportName: result.source.reportName.trim(),
      detailType: result.source.disclosureDetailType,
      assessable: true,
      originalDocumentAvailable: Boolean(result.document),
      bodyTruncated: Boolean(result.document?.bodyTruncated),
      correction: isCorrection(result),
      predictionConfidence: result.eventExtraction?.confidence ?? 'unresolved',
      predictionPresent,
      predictionResolved: Boolean(result.eventExtraction?.resolved),
      predictionShapeValid,
      predictionValid,
      predictedEvents,
      goldEvents,
      goldConfidence: gold.confidence,
      acceptableAlternatives: gold.acceptableAlternatives ?? [],
      exact,
      toleranceExact,
      endToEndUsableExact: Boolean(result.document && exact),
      cardinalityExact: goldEvents.length === predictedEvents.length,
      goldEventCount: goldEvents.length,
      predictedEventCount: predictedEvents.length,
      exactTupleMatches: exactTupleIntersection(goldEvents, predictedEvents),
      fieldDenominator,
      fieldMatches: alignment.fieldMatches,
      mismatchedFields,
      evidenceSummary: gold.evidenceSummary,
      rationale: gold.rationale,
    });
  }

  const assessableRows = caseResults.filter((row) => row.assessable);
  const originallyAvailableRows = assessableRows.filter((row) => row.originalDocumentAvailable);
  const exactCount = originallyAvailableRows.filter((row) => row.exact).length;
  const toleranceExactCount = originallyAvailableRows.filter((row) => row.toleranceExact).length;
  const usableExactCount = caseResults.filter((row) => row.endToEndUsableExact).length;
  const fieldDenominator = assessableRows.reduce((sum, row) => sum + row.fieldDenominator, 0);
  const fieldMatches = Object.fromEntries(CANONICAL_DISCLOSURE_EVENT_FIELDS.map((field) => [
    field,
    assessableRows.reduce((sum, row) => sum + (row.fieldMatches[field] ?? 0), 0),
  ]));
  const fieldAccuracies = Object.fromEntries(CANONICAL_DISCLOSURE_EVENT_FIELDS.map((field) => [
    field,
    ratio(fieldMatches[field], fieldDenominator),
  ]));
  const totalFieldMatches = Object.values(fieldMatches).reduce((sum, value) => sum + value, 0);

  const goldEventCount = assessableRows.reduce((sum, row) => sum + row.goldEventCount, 0);
  const predictedEventCount = assessableRows.reduce(
    (sum, row) => sum + row.predictedEventCount,
    0,
  );
  const cardinalityTruePositive = assessableRows.reduce(
    (sum, row) => sum + Math.min(row.goldEventCount, row.predictedEventCount),
    0,
  );
  const exactTupleTruePositive = assessableRows.reduce(
    (sum, row) => sum + row.exactTupleMatches,
    0,
  );
  const cardinalityPrecision = ratio(cardinalityTruePositive, predictedEventCount);
  const cardinalityRecall = ratio(cardinalityTruePositive, goldEventCount);
  const tuplePrecision = ratio(exactTupleTruePositive, predictedEventCount);
  const tupleRecall = ratio(exactTupleTruePositive, goldEventCount);

  const strictAccuracy = ratio(exactCount, originallyAvailableRows.length);
  const endToEndAccuracy = ratio(usableExactCount, sourceResults.length);
  return {
    summary: {
      totalFilings: sourceResults.length,
      originallyAvailableFilings: sourceResults.filter((row) => row.document).length,
      goldAssessableFilings: assessableRows.length,
      scoredOriginallyAvailableFilings: originallyAvailableRows.length,
      exactFilings: exactCount,
      availableExactAccuracy: strictAccuracy,
      availableExactWilson95: wilsonInterval(exactCount, originallyAvailableRows.length),
      toleranceExactFilings: toleranceExactCount,
      toleranceExactAccuracy: ratio(toleranceExactCount, originallyAvailableRows.length),
      endToEndUsableExactFilings: usableExactCount,
      endToEndUsableAccuracy: endToEndAccuracy,
      endToEndWilson95: wilsonInterval(usableExactCount, sourceResults.length),
      documentAcquisitionCoverage: ratio(
        sourceResults.filter((row) => row.document).length,
        sourceResults.length,
      ),
      semanticMismatchFilings: originallyAvailableRows.length - exactCount,
      unassessableFilings: caseResults.filter((row) => !row.assessable).length,
      unresolvedPredictionFilings: caseResults.filter((row) => !row.predictionResolved).length,
      invalidPredictionFilings: caseResults.filter(
        (row) => row.predictionPresent && row.predictionShapeValid === false,
      ).length,
      alternativeSensitiveFilings: toleranceExactCount - exactCount,
    },
    fields: {
      denominatorOccurrences: fieldDenominator,
      matches: fieldMatches,
      accuracy: fieldAccuracies,
      microAccuracy: ratio(
        totalFieldMatches,
        fieldDenominator * CANONICAL_DISCLOSURE_EVENT_FIELDS.length,
      ),
    },
    cardinality: {
      goldEventCount,
      predictedEventCount,
      truePositiveCount: cardinalityTruePositive,
      precision: cardinalityPrecision,
      recall: cardinalityRecall,
      f1: f1(cardinalityPrecision, cardinalityRecall),
      exactCountFilings: assessableRows.filter((row) => row.cardinalityExact).length,
      exactCountRate: ratio(
        assessableRows.filter((row) => row.cardinalityExact).length,
        assessableRows.length,
      ),
      overpredictionFilings: assessableRows.filter(
        (row) => row.predictedEventCount > row.goldEventCount,
      ).length,
      underpredictionFilings: assessableRows.filter(
        (row) => row.predictedEventCount < row.goldEventCount,
      ).length,
    },
    exactTupleEvents: {
      truePositiveCount: exactTupleTruePositive,
      precision: tuplePrecision,
      recall: tupleRecall,
      f1: f1(tuplePrecision, tupleRecall),
    },
    strata: {
      correction: groupSummary(originallyAvailableRows, (row) => row.correction ? 'correction' : 'original'),
      truncation: groupSummary(originallyAvailableRows, (row) => row.bodyTruncated ? 'truncated' : 'not-truncated'),
      confidence: groupSummary(originallyAvailableRows, (row) => row.predictionConfidence),
      goldCardinality: groupSummary(originallyAvailableRows, (row) => row.goldEventCount >= 2 ? '2+' : String(row.goldEventCount)),
      detailType: groupSummary(originallyAvailableRows, (row) => row.detailType),
    },
    cases: caseResults,
  };
}

function percent(value) {
  return value == null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}

function fraction(value, numerator, denominator) {
  return `${percent(value)} (${numerator}/${denominator})`;
}

function strataRows(strata) {
  const axes = [
    ['correction', '정정 여부'],
    ['truncation', '본문 절단'],
    ['confidence', '예측 confidence'],
    ['goldCardinality', 'gold cardinality'],
  ];
  return axes.flatMap(([key, label]) => Object.entries(strata[key] ?? {}).map(
    ([stratum, summary]) => `| ${label} | ${stratum} | ${fraction(summary.accuracy, summary.exact, summary.total)} |`,
  )).join('\n');
}

function markdownReport(results, gold) {
  const { summary, fields, cardinality, exactTupleEvents, strata, cases } = results;
  const mismatches = cases.filter((entry) => entry.assessable && !entry.exact);
  const annotation = gold.annotation ?? {};
  return `# OpenDART 150건 canonical event 정확도 감사 결과

## 결론

- **본문 확보 조건부 exact multiset accuracy:** ${fraction(summary.availableExactAccuracy, summary.exactFilings, summary.scoredOriginallyAvailableFilings)}
- **조건부 exact 95% Wilson 구간:** ${percent(summary.availableExactWilson95.lower)}–${percent(summary.availableExactWilson95.upper)}
- **전체 150건 end-to-end usable accuracy:** ${fraction(summary.endToEndUsableAccuracy, summary.endToEndUsableExactFilings, summary.totalFilings)}
- **end-to-end 95% Wilson 구간:** ${percent(summary.endToEndWilson95.lower)}–${percent(summary.endToEndWilson95.upper)}
- **5필드 micro accuracy:** ${percent(fields.microAccuracy)}
- **exact tuple event F1:** ${percent(exactTupleEvents.f1)}
- **cardinality F1:** ${percent(cardinality.f1)}

이는 이 150건 다양성 표본에 대한 agent-adjudicated audit 결과이며 KOSPI 전체 모집단 정확도가 아니다.

## Annotation 품질

- 원래 본문 확보: ${summary.originallyAvailableFilings}/${summary.totalFilings}
- gold assessable: ${summary.goldAssessableFilings}/${summary.totalFilings}
- A/B exact agreement: ${annotation.exactAgreementCount ?? 'n/a'}/${annotation.assessableComparedCount ?? 'n/a'}
- adjudication: ${annotation.adjudicatedCount ?? 'n/a'}건
- prediction-blind: ${gold.predictionBlind === true ? '예' : '아니오'}

## 필드별 정확도

| 필드 | 정확도 | 일치/denominator |
|---|---:|---:|
${CANONICAL_DISCLOSURE_EVENT_FIELDS.map((field) => `| ${field} | ${percent(fields.accuracy[field])} | ${fields.matches[field]}/${fields.denominatorOccurrences} |`).join('\n')}

## Cardinality 및 tuple

- gold/predicted event: ${cardinality.goldEventCount}/${cardinality.predictedEventCount}
- exact-count filing rate: ${percent(cardinality.exactCountRate)}
- count-only precision/recall/F1: ${percent(cardinality.precision)} / ${percent(cardinality.recall)} / ${percent(cardinality.f1)}
- exact-tuple precision/recall/F1: ${percent(exactTupleEvents.precision)} / ${percent(exactTupleEvents.recall)} / ${percent(exactTupleEvents.f1)}

## 주요 strata

| 축 | 구간 | exact accuracy |
|---|---|---:|
${strataRows(strata)}

## Strict mismatch ${mismatches.length}건

| rceptNo | 회사·공시 | 불일치 필드 | gold/pred 수 |
|---|---|---|---:|
${mismatches.map((entry) => `| ${entry.rceptNo} | ${entry.corpName} · ${entry.reportName.replaceAll('|', '\\|')} | ${entry.mismatchedFields.join(', ') || 'disposition'} | ${entry.goldEventCount}/${entry.predictedEventCount} |`).join('\n')}

## 해석 제한

- 기존 97.8% \`plausible\`은 정확도가 아니며 본 감사 지표와 직접 비교할 수 없다.
- detail-type 다양성 우선 표본이므로 모집단 빈도를 반영하지 않는다.
- 동일 개발 환경의 Codex subagent gold라 외부 인간 라벨보다 독립성이 낮다.
- ontology의 표현 적절성과 extractor의 ontology 준수 정확도는 별도 문제다.
`;
}

async function main() {
  const sourcePath = resolve(reportDir, 'source-data.json');
  const goldPath = resolve(here, 'gold-final.json');
  const sourceRaw = await readFile(sourcePath, 'utf8');
  const goldRaw = await readFile(goldPath, 'utf8');
  const source = JSON.parse(sourceRaw);
  const gold = JSON.parse(goldRaw);
  const sourceDataSha256 = createHash('sha256').update(sourceRaw).digest('hex');

  if (gold.ontologyVersion !== KR_DISCLOSURE_EVENT_ONTOLOGY_VERSION) {
    throw new Error(`Gold ontology version mismatch: ${gold.ontologyVersion}`);
  }
  if (gold.ontologyHash !== KR_DISCLOSURE_EVENT_ONTOLOGY_HASH) {
    throw new Error(`Gold ontology hash mismatch: ${gold.ontologyHash}`);
  }
  if (gold.sourceDataSha256 !== sourceDataSha256) {
    throw new Error(
      `Gold source hash mismatch: ${gold.sourceDataSha256}/${sourceDataSha256}`,
    );
  }
  if (gold.predictionBlind !== true) throw new Error('Gold is not marked predictionBlind=true.');
  if (gold.cases.length !== source.results.length) {
    throw new Error(`Gold/source case count mismatch: ${gold.cases.length}/${source.results.length}`);
  }

  for (const entry of gold.cases) {
    if (!entry.assessable) continue;
    for (const event of entry.goldEvents ?? []) {
      const validation = validateCanonicalDisclosureEvent(event);
      if (!validation.valid) {
        throw new Error(`Invalid gold event ${entry.rceptNo}: ${validation.errors.join('; ')}`);
      }
    }
  }

  const results = scoreCases({ goldCases: gold.cases, sourceResults: source.results });
  const artifact = {
    schemaVersion: 'jaroo.opendart-event-accuracy-results.v1',
    scoredAt: new Date().toISOString(),
    methodology: 'methodology.md',
    sourceDataSha256,
    goldSha256: createHash('sha256').update(goldRaw).digest('hex'),
    ontologyVersion: KR_DISCLOSURE_EVENT_ONTOLOGY_VERSION,
    ontologyHash: KR_DISCLOSURE_EVENT_ONTOLOGY_HASH,
    annotation: gold.annotation,
    ...results,
  };
  await writeFile(resolve(here, 'accuracy-results.json'), `${JSON.stringify(artifact, null, 2)}\n`);
  await writeFile(resolve(here, 'accuracy-report.md'), markdownReport(artifact, gold));
  console.log(JSON.stringify(artifact.summary, null, 2));
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) await main();
