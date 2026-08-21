#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { extractEventsGatedProjection } from '../src/services/deepscan-kr-disclosure-event-extractors.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DEFAULT_FIXTURE = resolve(ROOT, 'test/fixtures/kr-disclosure-event-semantic-gate.v1.json');
const FIELDS = Object.freeze(['type', 'action', 'state', 'cause', 'subjectType']);
const DEFAULT_THRESHOLDS = Object.freeze({
  exactSetAccuracy: 1,
  exactSetWilsonLower: 0.75,
  fieldAccuracy: 1,
  resolvedCoverage: 1,
  highConfidenceExactPrecision: 1,
  templateMacroAccuracy: 1,
});

function option(name, fallback = null) {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

function normalizeEvent(event = {}) {
  return Object.fromEntries(FIELDS.map((field) => [field, event[field] ?? null]));
}

function eventSet(events = []) {
  return events.map(normalizeEvent).map(JSON.stringify).sort();
}

function exactEventMultiset(left, right) {
  return JSON.stringify(eventSet(left)) === JSON.stringify(eventSet(right));
}

function eventFieldMatches(expected, actual) {
  return FIELDS.reduce((count, field) => count + Number(expected[field] === actual[field]), 0);
}

function optimalFieldMatches(expectedEvents, predictedEvents) {
  const expected = expectedEvents.map(normalizeEvent);
  const predicted = predictedEvents.map(normalizeEvent);
  const used = new Set();
  let best = 0;
  function search(index, score) {
    if (index >= expected.length) {
      best = Math.max(best, score);
      return;
    }
    search(index + 1, score);
    for (let predictedIndex = 0; predictedIndex < predicted.length; predictedIndex += 1) {
      if (used.has(predictedIndex)) continue;
      used.add(predictedIndex);
      search(index + 1, score + eventFieldMatches(expected[index], predicted[predictedIndex]));
      used.delete(predictedIndex);
    }
  }
  search(0, 0);
  return best;
}

export function wilsonLowerBound(successes, total, z = 1.959963984540054) {
  if (total <= 0) return 0;
  const proportion = successes / total;
  const denominator = 1 + (z ** 2 / total);
  const centre = proportion + (z ** 2 / (2 * total));
  const margin = z * Math.sqrt((proportion * (1 - proportion) + (z ** 2 / (4 * total))) / total);
  return Math.max(0, (centre - margin) / denominator);
}

export function evaluateSemanticGateCandidate(fixtureCase, prediction) {
  const expected = fixtureCase.expectedEvents ?? [];
  const predicted = prediction.events ?? [];
  const exact = exactEventMultiset(expected, predicted);
  const resolved = prediction.resolved !== false
    && predicted.length > 0
    && predicted.every((event) => event.type && event.type !== 'other');
  const fieldDenominator = Math.max(expected.length, predicted.length) * FIELDS.length;
  return Object.freeze({
    id: fixtureCase.id,
    templateKey: fixtureCase.templateKey ?? fixtureCase.family ?? fixtureCase.id,
    exact,
    resolved,
    confidence: prediction.confidence ?? 'low',
    fieldMatches: optimalFieldMatches(expected, predicted),
    fieldDenominator,
    expected: eventSet(expected),
    actual: eventSet(predicted),
  });
}

export function assessSemanticGateThresholds(evaluations, thresholds = DEFAULT_THRESHOLDS) {
  const total = evaluations.length;
  const exactCount = evaluations.filter((evaluation) => evaluation.exact).length;
  const resolvedCount = evaluations.filter((evaluation) => evaluation.resolved).length;
  const high = evaluations.filter((evaluation) => evaluation.confidence === 'high');
  const highExact = high.filter((evaluation) => evaluation.exact).length;
  const fieldMatches = evaluations.reduce((sum, evaluation) => sum + evaluation.fieldMatches, 0);
  const fieldDenominator = evaluations.reduce((sum, evaluation) => sum + evaluation.fieldDenominator, 0);
  const byTemplate = new Map();
  for (const evaluation of evaluations) {
    const bucket = byTemplate.get(evaluation.templateKey) ?? [];
    bucket.push(evaluation);
    byTemplate.set(evaluation.templateKey, bucket);
  }
  const templateMacroAccuracy = byTemplate.size === 0
    ? 0
    : [...byTemplate.values()].reduce((sum, bucket) => sum + bucket.filter((item) => item.exact).length / bucket.length, 0) / byTemplate.size;
  const metrics = {
    total,
    exactCount,
    exactSetAccuracy: total === 0 ? 0 : exactCount / total,
    exactSetWilsonLower: wilsonLowerBound(exactCount, total),
    fieldAccuracy: fieldDenominator === 0 ? 0 : fieldMatches / fieldDenominator,
    resolvedCoverage: total === 0 ? 0 : resolvedCount / total,
    highConfidenceCount: high.length,
    highConfidenceExactPrecision: high.length === 0 ? 0 : highExact / high.length,
    highConfidenceWilsonLower: wilsonLowerBound(highExact, high.length),
    highConfidenceCoverage: total === 0 ? 0 : high.length / total,
    templateMacroAccuracy,
  };
  const failures = Object.entries(thresholds)
    .filter(([metric, minimum]) => metrics[metric] < minimum)
    .map(([metric, minimum]) => ({ metric, actual: metrics[metric], minimum }));
  return Object.freeze({ metrics: Object.freeze(metrics), passed: failures.length === 0, failures: Object.freeze(failures) });
}

function validateFixture(fixture) {
  if (fixture?.schemaVersion !== 'jaroo.kr-disclosure-event-semantic-gate.v1') throw new Error('invalid semantic gate fixture schemaVersion');
  if (!Array.isArray(fixture.cases) || fixture.cases.length === 0) throw new Error('semantic gate fixture must contain cases');
}

export async function runSemanticGateBenchmark({ fixturePath = DEFAULT_FIXTURE, gateMode = 'strict' } = {}) {
  const absoluteFixture = resolve(fixturePath);
  const fixture = JSON.parse(await readFile(absoluteFixture, 'utf8'));
  validateFixture(fixture);
  const evaluations = fixture.cases.map((fixtureCase) => evaluateSemanticGateCandidate(
    fixtureCase,
    extractEventsGatedProjection(fixtureCase.input),
  ));
  const assessment = assessSemanticGateThresholds(evaluations, gateMode === 'strict' ? DEFAULT_THRESHOLDS : {});
  return {
    schemaVersion: 'jaroo.kr-disclosure-event-semantic-gate-result.v2',
    fixture: absoluteFixture,
    metrics: assessment.metrics,
    failures: evaluations.filter((evaluation) => !evaluation.exact),
    gate: { mode: gateMode, passed: assessment.passed, failures: assessment.failures },
  };
}

async function main() {
  const report = await runSemanticGateBenchmark({
    fixturePath: option('fixture', DEFAULT_FIXTURE),
    gateMode: option('gate', 'strict'),
  });
  process.stdout.write(`${JSON.stringify(report, null, process.argv.includes('--json') ? 0 : 2)}\n`);
  if (!report.gate.passed) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  });
}
