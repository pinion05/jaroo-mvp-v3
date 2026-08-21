import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KR_DISCLOSURE_EVENT_EXTRACTOR_CANDIDATES } from '../src/services/deepscan-kr-disclosure-event-extractors.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_PATH = resolve(ROOT, 'test/fixtures/kr-disclosure-event-benchmark.v1.json');
const DEFAULT_ITERATIONS = 1_000;

function parseArgs(argv) {
  return Object.fromEntries(argv.map((argument) => {
    const [key, ...rest] = argument.replace(/^--/u, '').split('=');
    return [key, rest.length > 0 ? rest.join('=') : 'true'];
  }));
}

function positiveInteger(value, fallback, maximum = 100_000) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : fallback;
}

function normalizeEvent(event = {}) {
  return {
    type: event.type ?? 'other',
    action: event.action ?? null,
    state: event.state ?? null,
    cause: event.cause ?? null,
    subjectType: event.subjectType ?? null,
  };
}

function eventFingerprint(event) {
  const normalized = normalizeEvent(event);
  return [normalized.type, normalized.action, normalized.state, normalized.cause, normalized.subjectType]
    .map((value) => value ?? '')
    .join('|');
}

function eventSetFingerprint(events) {
  return (Array.isArray(events) ? events : []).map(eventFingerprint).sort().join('\n');
}

function typeSetFingerprint(events) {
  return [...new Set((Array.isArray(events) ? events : []).map((event) => event.type ?? 'other'))].sort().join('|');
}

function eventTokens(events) {
  const tokens = new Set();
  for (const event of Array.isArray(events) ? events : []) {
    const normalized = normalizeEvent(event);
    tokens.add(`type:${normalized.type}`);
    for (const field of ['action', 'state', 'cause', 'subjectType']) {
      if (normalized[field]) tokens.add(`${normalized.type}:${field}:${normalized[field]}`);
    }
  }
  return tokens;
}

function intersectionSize(left, right) {
  let size = 0;
  for (const value of left) if (right.has(value)) size += 1;
  return size;
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function round(value, digits = 4) {
  return Number(value.toFixed(digits));
}

function evaluateCandidate(extractor, cases) {
  let exactCaseCount = 0;
  let typeSetExactCount = 0;
  let p0ExactCount = 0;
  let p0Count = 0;
  let contrastExactCount = 0;
  let contrastCount = 0;
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  const failures = [];

  for (const fixture of cases) {
    const predicted = extractor(fixture.input).events;
    const expected = fixture.expectedEvents;
    const exact = eventSetFingerprint(predicted) === eventSetFingerprint(expected);
    const typeExact = typeSetFingerprint(predicted) === typeSetFingerprint(expected);
    const expectedTokens = eventTokens(expected);
    const predictedTokens = eventTokens(predicted);
    const matched = intersectionSize(expectedTokens, predictedTokens);
    truePositive += matched;
    falsePositive += predictedTokens.size - matched;
    falseNegative += expectedTokens.size - matched;
    if (exact) exactCaseCount += 1;
    if (typeExact) typeSetExactCount += 1;

    if (fixture.tags.includes('p0')) {
      p0Count += 1;
      if (exact) p0ExactCount += 1;
    }
    if (fixture.tags.includes('contrast')) {
      contrastCount += 1;
      if (exact) contrastExactCount += 1;
    }
    if (!exact && failures.length < 8) failures.push({ id: fixture.id, expected, predicted });
  }

  const precision = ratio(truePositive, truePositive + falsePositive);
  const recall = ratio(truePositive, truePositive + falseNegative);
  const fieldF1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const exactCaseAccuracy = ratio(exactCaseCount, cases.length);
  const typeSetAccuracy = ratio(typeSetExactCount, cases.length);
  const p0ExactAccuracy = ratio(p0ExactCount, p0Count);
  const contrastExactAccuracy = ratio(contrastExactCount, contrastCount);
  const selectionScore = (
    exactCaseAccuracy * 0.30
    + fieldF1 * 0.25
    + typeSetAccuracy * 0.20
    + p0ExactAccuracy * 0.15
    + contrastExactAccuracy * 0.10
  );

  return {
    caseCount: cases.length,
    exactCaseCount,
    exactCaseAccuracy: round(exactCaseAccuracy),
    typeSetExactCount,
    typeSetAccuracy: round(typeSetAccuracy),
    fieldPrecision: round(precision),
    fieldRecall: round(recall),
    fieldF1: round(fieldF1),
    p0ExactCount,
    p0Count,
    p0ExactAccuracy: round(p0ExactAccuracy),
    contrastExactCount,
    contrastCount,
    contrastExactAccuracy: round(contrastExactAccuracy),
    selectionScore: round(selectionScore),
    failures,
  };
}

function benchmarkLatency(extractor, cases, iterations) {
  for (let warmup = 0; warmup < Math.min(100, iterations); warmup += 1) {
    for (const fixture of cases) extractor(fixture.input);
  }
  const operationCount = cases.length * iterations;
  const startedAt = performance.now();
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (const fixture of cases) extractor(fixture.input);
  }
  const elapsedMs = performance.now() - startedAt;
  return {
    iterations,
    operationCount,
    elapsedMs: round(elapsedMs, 2),
    microsecondsPerFiling: round((elapsedMs * 1_000) / operationCount, 2),
    operationsPerSecond: Math.round(operationCount / (elapsedMs / 1_000)),
  };
}

function casesForMode(cases, mode) {
  if (mode === 'provider-detail') return cases;
  return cases.map((fixture) => ({
    ...fixture,
    input: {
      ...fixture.input,
      disclosureType: undefined,
      disclosureDetailType: undefined,
    },
  }));
}

function tabularRows(report) {
  return Object.entries(report.modes).flatMap(([mode, candidates]) => Object.entries(candidates).map(([candidate, metrics]) => ({
    mode,
    candidate,
    score: metrics.selectionScore,
    exact: `${metrics.exactCaseCount}/${metrics.caseCount}`,
    type: `${metrics.typeSetExactCount}/${metrics.caseCount}`,
    fieldF1: metrics.fieldF1,
    p0: `${metrics.p0ExactCount}/${metrics.p0Count}`,
    contrast: `${metrics.contrastExactCount}/${metrics.contrastCount}`,
    usPerFiling: metrics.latency.microsecondsPerFiling,
  })));
}

const args = parseArgs(process.argv.slice(2));
const fixture = JSON.parse(await readFile(FIXTURE_PATH, 'utf8'));
const iterations = positiveInteger(args.iterations, DEFAULT_ITERATIONS);
const modes = {};

for (const mode of ['title-only', 'provider-detail']) {
  const cases = casesForMode(fixture.cases, mode);
  modes[mode] = {};
  for (const [name, extractor] of Object.entries(KR_DISCLOSURE_EVENT_EXTRACTOR_CANDIDATES)) {
    modes[mode][name] = {
      ...evaluateCandidate(extractor, cases),
      latency: benchmarkLatency(extractor, cases, iterations),
    };
  }
}

const report = {
  schemaVersion: 'jaroo.kr-disclosure-event-benchmark-result.v1',
  generatedAt: new Date().toISOString(),
  fixtureSchemaVersion: fixture.schemaVersion,
  fixturePath: FIXTURE_PATH,
  caseCount: fixture.cases.length,
  weighting: {
    exactCaseAccuracy: 0.30,
    fieldF1: 0.25,
    typeSetAccuracy: 0.20,
    p0ExactAccuracy: 0.15,
    contrastExactAccuracy: 0.10,
  },
  modes,
};

if (args.json === 'true') {
  process.stdout.write(`${JSON.stringify(report)}\n`);
} else {
  console.log(`KR disclosure event extractor benchmark · ${fixture.cases.length} cases · ${iterations} iterations`);
  console.table(tabularRows(report));
  for (const [mode, candidates] of Object.entries(modes)) {
    const winner = Object.entries(candidates).sort((left, right) => right[1].selectionScore - left[1].selectionScore)[0];
    console.log(`${mode} winner: ${winner[0]} (${winner[1].selectionScore})`);
  }
}
