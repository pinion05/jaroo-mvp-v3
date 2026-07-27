#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractEventsGatedProjection } from '../src/services/deepscan-kr-disclosure-event-extractors.js';
import {
  CANONICAL_DISCLOSURE_EVENT_FIELDS,
  canonicalizeDisclosureEventAliases,
  KR_DISCLOSURE_EVENT_ONTOLOGY_HASH,
  KR_DISCLOSURE_EVENT_ONTOLOGY_VERSION,
} from '../src/services/deepscan-kr-disclosure-event-ontology.js';
import {
  KR_DISCLOSURE_TEMPORAL_STRICT_THRESHOLDS,
  validateCandidateFreezeEnvelope,
} from '../src/services/deepscan-kr-disclosure-temporal-protocol.js';
import { normalizeTitleTemplate } from './collect-dart-disclosure-temporal-holdout.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DEFAULT_FIXTURE = resolve(ROOT, 'test/fixtures/kr-disclosure-event-temporal-holdout.v1.json');
const EVALUATOR_PATH = fileURLToPath(import.meta.url);
const EXTRACTOR_PATH = resolve(ROOT, 'src/services/deepscan-kr-disclosure-event-extractors.js');
export const CANONICAL_EVENT_FIELDS = CANONICAL_DISCLOSURE_EVENT_FIELDS;
export const CONFIDENCE_PROBABILITIES = Object.freeze({ low: 0.1, medium: 0.75, high: 0.95 });
export const MAX_EVENTS_PER_CASE = 20;
export const STRICT_THRESHOLDS = KR_DISCLOSURE_TEMPORAL_STRICT_THRESHOLDS;

export class TemporalHoldoutFixtureError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TemporalHoldoutFixtureError';
  }
}

export class TemporalHoldoutPredictionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TemporalHoldoutPredictionError';
  }
}

function fail(message) {
  throw new TemporalHoldoutFixtureError(message);
}

function option(name, fallback = null) {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

function normalizedDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}(?:-?\d{2}){2}$/.test(value)) fail(`${label} must be YYYY-MM-DD or YYYYMMDD`);
  const compact = value.replaceAll('-', '');
  const year = Number(compact.slice(0, 4));
  const month = Number(compact.slice(4, 6));
  const day = Number(compact.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) fail(`${label} is not a valid date`);
  return compact;
}

function dateDistanceDays(from, to) {
  const toMillis = (value) => Date.UTC(
    Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8)),
  );
  return Math.floor((toMillis(to) - toMillis(from)) / 86_400_000);
}

function valueFrom(fixtureCase, directKeys, inputKeys = directKeys) {
  for (const key of directKeys) if (fixtureCase?.[key] != null) return fixtureCase[key];
  for (const key of inputKeys) if (fixtureCase?.input?.[key] != null) return fixtureCase.input[key];
  return undefined;
}

function sourceValue(fixtureCase, keys) {
  for (const key of keys) if (fixtureCase?.source?.[key] != null) return fixtureCase.source[key];
  return undefined;
}

function canonicalEvent(event) {
  return Object.fromEntries(CANONICAL_EVENT_FIELDS.map((field) => [field, event?.[field] ?? null]));
}

function eventMultiset(events = []) {
  return events.map(canonicalEvent).map(JSON.stringify).sort();
}

function exactMultiset(expected, actual) {
  return JSON.stringify(eventMultiset(expected)) === JSON.stringify(eventMultiset(actual));
}

function validateCanonicalEventList(events, label) {
  if (!Array.isArray(events) || events.length === 0) fail(`${label} must be nonempty`);
  if (events.length > MAX_EVENTS_PER_CASE) fail(`${label} exceeds the maximum of ${MAX_EVENTS_PER_CASE} events`);
  for (const [eventIndex, event] of events.entries()) {
    if (!event || typeof event !== 'object' || Array.isArray(event)) fail(`${label}[${eventIndex}] must be an object`);
    const keys = Object.keys(event).sort();
    const canonicalKeys = [...CANONICAL_EVENT_FIELDS].sort();
    if (JSON.stringify(keys) !== JSON.stringify(canonicalKeys)) fail(`${label}[${eventIndex}] must have exactly the five canonical keys`);
    let canonical;
    try {
      canonical = canonicalizeDisclosureEventAliases(event);
    } catch (error) {
      fail(`${label}[${eventIndex}] violates ontology: ${error.message}`);
    }
    if (JSON.stringify(canonical) !== JSON.stringify(event)) {
      fail(`${label}[${eventIndex}] must use canonical ontology vocabulary rather than an alias`);
    }
  }
}

function fieldMatches(left, right) {
  return CANONICAL_EVENT_FIELDS.reduce((total, field) => total + Number(left[field] === right[field]), 0);
}

// Disclosure event sets are small. This exact assignment search is deterministic and
// includes unmatched events in the denominator, so missing and extra events are penalized.
export function optimalFieldMatches(expectedEvents = [], predictedEvents = []) {
  let smaller = expectedEvents.map(canonicalEvent);
  let larger = predictedEvents.map(canonicalEvent);
  if (smaller.length > larger.length) [smaller, larger] = [larger, smaller];
  let best = 0;
  const used = new Set();
  function visit(index, score) {
    if (index === smaller.length) {
      best = Math.max(best, score);
      return;
    }
    for (let candidate = 0; candidate < larger.length; candidate += 1) {
      if (used.has(candidate)) continue;
      used.add(candidate);
      visit(index + 1, score + fieldMatches(smaller[index], larger[candidate]));
      used.delete(candidate);
    }
  }
  if (smaller.length > 0) visit(0, 0);
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

export function validateTemporalHoldoutFixture(fixture, { allowBurned = false } = {}) {
  if (fixture?.schemaVersion !== 'jaroo.kr-disclosure-event-temporal-holdout.v1') fail('invalid temporal holdout fixture schemaVersion');
  if (!['sealed-temporal-holdout', 'burned-temporal-development'].includes(fixture.role)) {
    fail('temporal holdout fixture role must be sealed-temporal-holdout or burned-temporal-development');
  }
  if (fixture.role === 'burned-temporal-development') {
    if (!allowBurned) fail('burned temporal development fixtures cannot be used by the strict holdout gate');
    if (fixture.audit?.independentClaimEligible !== false) {
      fail('burned temporal development fixture must set audit.independentClaimEligible=false');
    }
    if (typeof fixture.audit?.burnedReason !== 'string' || fixture.audit.burnedReason.length === 0) {
      fail('burned temporal development fixture must record audit.burnedReason');
    }
    for (const field of ['firstSealedFixtureSha256', 'firstSealedResultSha256']) {
      if (!/^[a-f0-9]{64}$/.test(fixture.audit?.[field] ?? '')) {
        fail(`burned temporal development fixture must record audit.${field}`);
      }
    }
  } else {
    if (fixture.audit?.independentClaimEligible !== true) {
      fail('sealed temporal holdout must set audit.independentClaimEligible=true');
    }
    if (fixture.audit?.predictionsHiddenUntilAdjudication !== true) {
      fail('sealed temporal holdout must attest audit.predictionsHiddenUntilAdjudication=true');
    }
    for (const field of ['unlabeledCorpusSha256', 'annotationManifestSha256']) {
      if (!/^[a-f0-9]{64}$/u.test(fixture.audit?.[field] ?? '')) {
        fail(`sealed temporal holdout must record audit.${field}`);
      }
    }
  }
  if (fixture.ontologyVersion !== KR_DISCLOSURE_EVENT_ONTOLOGY_VERSION) {
    fail(`fixture ontologyVersion must equal ${KR_DISCLOSURE_EVENT_ONTOLOGY_VERSION}`);
  }
  if (fixture.ontologyHash !== KR_DISCLOSURE_EVENT_ONTOLOGY_HASH) {
    fail(`fixture ontologyHash must equal ${KR_DISCLOSURE_EVENT_ONTOLOGY_HASH}`);
  }
  if (!fixture.query || typeof fixture.query !== 'object') fail('temporal holdout fixture query is required');
  const cutoff = normalizedDate(fixture.cutoff ?? fixture.query.cutoff, 'cutoff');
  const queryCutoff = normalizedDate(fixture.query.cutoff, 'query.cutoff');
  const queryFrom = normalizedDate(fixture.query.from, 'query.from');
  const queryTo = normalizedDate(fixture.query.to, 'query.to');
  let candidateFreeze = null;
  if (fixture.role === 'sealed-temporal-holdout') {
    try {
      candidateFreeze = validateCandidateFreezeEnvelope(fixture.candidateFreeze);
    } catch (error) {
      fail(error.message);
    }
    if (candidateFreeze.cutoff !== cutoff) fail('candidate freeze cutoff must equal fixture cutoff');
    if (queryFrom < candidateFreeze.firstEligibleFilingDate) {
      fail('query.from must be on or after candidate freeze firstEligibleFilingDate');
    }
    if (fixture.query.selectionSeedCommitment !== candidateFreeze.sampling.selectionSeedCommitment) {
      fail('query selection seed commitment must match the candidate freeze');
    }
    if (!/^[a-f0-9]{64}$/u.test(fixture.query.exclusionManifestSha256 ?? '')) {
      fail('sealed temporal holdout query must record exclusionManifestSha256');
    }
    if (!Number.isInteger(fixture.query.excludedReceiptCount) || fixture.query.excludedReceiptCount < 1) {
      fail('sealed temporal holdout query must exclude at least one prior receipt');
    }
    if (fixture.query.exclusionManifestSha256 !== candidateFreeze.sampling.exclusionManifestSha256) {
      fail('query exclusionManifestSha256 must match the candidate freeze');
    }
    if (fixture.query.excludedReceiptCount !== candidateFreeze.sampling.excludedReceiptCount) {
      fail('query excludedReceiptCount must match the candidate freeze');
    }
    if (fixture.query.excludedReceiptsSha256 !== candidateFreeze.sampling.excludedReceiptsSha256) {
      fail('query excludedReceiptsSha256 must match the candidate freeze');
    }
  }
  if (cutoff !== queryCutoff) fail('top-level cutoff must equal query.cutoff');
  if (queryFrom > queryTo) fail('query.from must be on or before query.to');
  if (queryFrom <= cutoff || queryTo <= cutoff) fail('query.from and query.to must be strictly after cutoff');
  if (dateDistanceDays(queryFrom, queryTo) > 92) fail('query date range cannot exceed 92 days');
  if (fixture.query.corpClass !== 'Y') fail('query.corpClass must be Y');
  if (fixture.labelStatus !== 'adjudicated') fail('fixture labelStatus must be adjudicated');
  if (!Array.isArray(fixture.cases) || fixture.cases.length === 0) fail('temporal holdout fixture must contain cases');
  const receipts = new Set();
  const ids = new Set();
  for (const [index, fixtureCase] of fixture.cases.entries()) {
    const label = `cases[${index}]`;
    if (!fixtureCase || typeof fixtureCase !== 'object' || Array.isArray(fixtureCase)) fail(`${label} must be an object`);
    if (typeof fixtureCase.id !== 'string' || fixtureCase.id.length === 0) fail(`${label}.id must be nonempty`);
    if (ids.has(fixtureCase.id)) fail(`${label} has duplicate case id ${fixtureCase.id}`);
    ids.add(fixtureCase.id);
    if (fixtureCase.labelStatus !== 'adjudicated') fail(`${label}.labelStatus must be adjudicated`);
    const corpClass = valueFrom(fixtureCase, ['corpClass']) ?? sourceValue(fixtureCase, ['corpClass']);
    if (corpClass !== 'Y') fail(`${label} must have KOSPI corpClass Y`);
    const receipt = valueFrom(fixtureCase, ['rceptNo', 'receiptNumber'], ['rceptNo', 'receiptNumber']);
    if (typeof receipt !== 'string' || receipt.length === 0) fail(`${label} must have a receipt number`);
    if (receipts.has(receipt)) fail(`${label} has duplicate receipt number ${receipt}`);
    receipts.add(receipt);
    const filedAt = valueFrom(fixtureCase, ['filedAt', 'filingDate'], ['filedAt', 'filingDate', 'receiptDate']);
    const filingDate = normalizedDate(filedAt, `${label}.filedAt`);
    if (filingDate <= cutoff) fail(`${label} filing date must be strictly after cutoff`);
    if (candidateFreeze && filingDate < candidateFreeze.firstEligibleFilingDate) {
      fail(`${label} filing date must be on or after candidate freeze firstEligibleFilingDate`);
    }
    if (filingDate < queryFrom || filingDate > queryTo) fail(`${label} filing date must be within query.from and query.to`);
    const bodyText = valueFrom(fixtureCase, ['bodyText'], ['bodyText', 'body']);
    if (typeof bodyText !== 'string' || bodyText.length === 0) fail(`${label} must have nonempty bodyText`);
    const suppliedHash = fixtureCase.bodySha256
      ?? fixtureCase.bodyTextSha256
      ?? sourceValue(fixtureCase, ['retainedSha256']);
    if (typeof suppliedHash !== 'string' || !/^[a-f0-9]{64}$/.test(suppliedHash)) fail(`${label}.bodySha256 must be a lowercase SHA-256 hex digest`);
    const actualHash = createHash('sha256').update(bodyText).digest('hex');
    if (suppliedHash !== actualHash) fail(`${label} body SHA-256 mismatch`);
    if (typeof fixtureCase.templateKey !== 'string' || fixtureCase.templateKey.length === 0) fail(`${label}.templateKey must be nonempty`);
    const title = valueFrom(fixtureCase, ['reportName', 'title'], ['reportName', 'title']);
    if (fixtureCase.templateKey !== normalizeTitleTemplate(title)) {
      fail(`${label}.templateKey must equal the normalized disclosure title`);
    }
    const issuer = sourceValue(fixtureCase, ['corpCode']);
    if (typeof issuer !== 'string' || issuer.length === 0) fail(`${label}.source.corpCode must identify an issuer`);
    validateCanonicalEventList(fixtureCase.expectedEvents, `${label}.expectedEvents`);
    const hasDevelopmentGold = Object.hasOwn(fixtureCase, 'developmentExpectedEvents')
      || Object.hasOwn(fixtureCase, 'developmentReAdjudication');
    if (hasDevelopmentGold && fixture.role !== 'burned-temporal-development') {
      fail(`${label}.developmentExpectedEvents are forbidden in a sealed holdout`);
    }
    if (hasDevelopmentGold) {
      validateCanonicalEventList(fixtureCase.developmentExpectedEvents, `${label}.developmentExpectedEvents`);
      const developmentAudit = fixtureCase.developmentReAdjudication;
      if (developmentAudit?.predictionBlinded !== false) {
        fail(`${label}.developmentReAdjudication.predictionBlinded must be false`);
      }
      if (typeof developmentAudit.reason !== 'string' || developmentAudit.reason.length === 0) {
        fail(`${label}.developmentReAdjudication.reason must be nonempty`);
      }
      validateCanonicalEventList(
        developmentAudit.previousExpectedEvents,
        `${label}.developmentReAdjudication.previousExpectedEvents`,
      );
      if (JSON.stringify(eventMultiset(developmentAudit.previousExpectedEvents))
        !== JSON.stringify(eventMultiset(fixtureCase.expectedEvents))) {
        fail(`${label}.developmentReAdjudication.previousExpectedEvents must preserve the blinded gold`);
      }
    }
    if (!Array.isArray(fixtureCase.annotations) || fixtureCase.annotations.length < 2) {
      fail(`${label}.annotations must contain at least two independent labels`);
    }
    const annotators = new Set();
    const annotationFingerprints = [];
    for (const [annotationIndex, annotation] of fixtureCase.annotations.entries()) {
      const annotationLabel = `${label}.annotations[${annotationIndex}]`;
      if (typeof annotation?.annotator !== 'string' || annotation.annotator.length === 0) {
        fail(`${annotationLabel}.annotator must be nonempty`);
      }
      if (annotators.has(annotation.annotator)) fail(`${label}.annotations must use distinct annotators`);
      annotators.add(annotation.annotator);
      if (annotation.blindedToPrediction !== true) fail(`${annotationLabel} must be blinded to prediction`);
      if (!Object.hasOwn(CONFIDENCE_PROBABILITIES, annotation.confidenceInLabel)) {
        fail(`${annotationLabel}.confidenceInLabel must be low, medium, or high`);
      }
      validateCanonicalEventList(annotation.expectedEvents, `${annotationLabel}.expectedEvents`);
      annotationFingerprints.push(JSON.stringify(eventMultiset(annotation.expectedEvents)));
    }
    const adjudication = fixtureCase.adjudication;
    if (typeof adjudication?.adjudicator !== 'string' || adjudication.adjudicator.length === 0) {
      fail(`${label}.adjudication.adjudicator must be nonempty`);
    }
    if (annotators.has(adjudication.adjudicator)) fail(`${label}.adjudicator must be independent from annotators`);
    if (!['agreement', 'resolved'].includes(adjudication.decision)) {
      fail(`${label}.adjudication.decision must be agreement or resolved`);
    }
    if (adjudication.blindedToPrediction !== true) fail(`${label}.adjudication must be blinded to prediction`);
    if (typeof adjudication.rationale !== 'string' || adjudication.rationale.length === 0) {
      fail(`${label}.adjudication.rationale must be nonempty`);
    }
    validateCanonicalEventList(adjudication.expectedEvents, `${label}.adjudication.expectedEvents`);
    const goldFingerprint = JSON.stringify(eventMultiset(fixtureCase.expectedEvents));
    const adjudicationFingerprint = JSON.stringify(eventMultiset(adjudication.expectedEvents));
    if (adjudicationFingerprint !== goldFingerprint) fail(`${label} adjudication expectedEvents must exactly match case gold`);
    const unanimous = annotationFingerprints.every((fingerprint) => fingerprint === annotationFingerprints[0]);
    if (adjudication.decision === 'agreement'
      && (!unanimous || annotationFingerprints[0] !== goldFingerprint)) {
      fail(`${label} agreement adjudication must match both independent labels`);
    }
    if (adjudication.decision === 'resolved' && unanimous) {
      fail(`${label} resolved adjudication requires an annotation disagreement`);
    }
  }
  const summary = fixture.summary;
  if (!summary || typeof summary !== 'object') fail('fixture summary is required');
  const recomputed = {
    caseCount: fixture.cases.length,
    selectedCount: fixture.cases.length,
    uniqueIssuerCount: new Set(fixture.cases.map((item) => sourceValue(item, ['corpCode'])).filter(Boolean)).size,
    uniqueTitleTemplateCount: new Set(fixture.cases.map((item) => item.templateKey)).size,
    truncatedBodyCount: fixture.cases.filter((item) => item.source?.truncated === true).length,
    retainedBodyCharCount: fixture.cases.reduce((total, item) => total + [...valueFrom(item, ['bodyText'], ['bodyText', 'body'])].length, 0),
    agreementCaseCount: fixture.cases.filter((item) => item.adjudication.decision === 'agreement').length,
    dualAdjudicatorResolutionCount: fixture.cases.filter((item) => (
      item.adjudication.resolutionTier === 'dual-adjudicator-agreement'
    )).length,
    finalAdjudicatorResolutionCount: fixture.cases.filter((item) => (
      item.adjudication.resolutionTier === 'final-independent-adjudication'
    )).length,
    documentFailureCount: Array.isArray(fixture.failures) ? fixture.failures.length : 0,
  };
  if (Number.isInteger(summary.listedCount) && Number.isInteger(summary.deduplicatedCount)) {
    recomputed.duplicateCount = summary.listedCount - summary.deduplicatedCount;
  }
  if (fixture.role === 'burned-temporal-development') {
    const developmentReAdjudicationCount = fixture.cases.filter((item) => (
      Array.isArray(item.developmentExpectedEvents)
    )).length;
    if (developmentReAdjudicationCount > 0 || Object.hasOwn(summary, 'developmentReAdjudicationCount')) {
      recomputed.developmentReAdjudicationCount = developmentReAdjudicationCount;
    }
  }
  for (const [key, actual] of Object.entries(recomputed)) {
    if (summary[key] !== actual) fail(`summary.${key} must equal recomputed value ${actual}`);
  }
  return fixture;
}

function isExplicitlyUnresolved(prediction) {
  return prediction?.resolved === false
    || prediction?.abstained === true
    || prediction?.abstain === true
    || prediction?.status === 'abstain'
    || prediction?.status === 'unresolved';
}

export function evaluateTemporalHoldoutCase(
  fixtureCase,
  prediction = {},
  { allowDevelopmentGold = false } = {},
) {
  const usesDevelopmentGold = allowDevelopmentGold && Array.isArray(fixtureCase.developmentExpectedEvents);
  const expected = usesDevelopmentGold ? fixtureCase.developmentExpectedEvents : fixtureCase.expectedEvents ?? [];
  const predicted = Array.isArray(prediction.events) ? prediction.events : [];
  const explicitlyUnresolved = isExplicitlyUnresolved(prediction);
  const containsOther = predicted.some((event) => !event || event.type === 'other');
  const resolved = !explicitlyUnresolved && predicted.length > 0 && !containsOther;
  if (resolved) {
    for (const [eventIndex, event] of predicted.entries()) {
      let canonical;
      try {
        canonical = canonicalizeDisclosureEventAliases(event);
      } catch (error) {
        throw new TemporalHoldoutPredictionError(
          `prediction event ${eventIndex} for ${fixtureCase.id} violates ontology: ${error.message}`,
        );
      }
      if (JSON.stringify(canonical) !== JSON.stringify(event)) {
        throw new TemporalHoldoutPredictionError(
          `prediction event ${eventIndex} for ${fixtureCase.id} uses a noncanonical ontology alias`,
        );
      }
    }
  }
  if (!Object.hasOwn(CONFIDENCE_PROBABILITIES, prediction.confidence)) {
    throw new TemporalHoldoutPredictionError(`prediction confidence for ${fixtureCase.id} must be low, medium, or high`);
  }
  const confidence = prediction.confidence;
  const exact = resolved && exactMultiset(expected, predicted);
  return Object.freeze({
    id: fixtureCase.id,
    issuerKey: sourceValue(fixtureCase, ['corpCode']),
    templateKey: fixtureCase.templateKey,
    exact,
    resolved,
    confidence,
    goldSource: usesDevelopmentGold ? 'post-burn-development' : 'prediction-blinded',
    probability: CONFIDENCE_PROBABILITIES[confidence],
    fieldMatches: optimalFieldMatches(expected, predicted),
    fieldDenominator: Math.max(expected.length, predicted.length) * CANONICAL_EVENT_FIELDS.length,
    expected: eventMultiset(expected),
    actual: eventMultiset(predicted),
  });
}

function calibrationMetrics(evaluations) {
  if (evaluations.length === 0) return { brierScore: 0, expectedCalibrationError: 0 };
  let brier = 0;
  let ece = 0;
  for (const confidence of Object.keys(CONFIDENCE_PROBABILITIES)) {
    const bucket = evaluations.filter((item) => item.confidence === confidence);
    if (bucket.length === 0) continue;
    const probability = CONFIDENCE_PROBABILITIES[confidence];
    const accuracy = bucket.filter((item) => item.exact).length / bucket.length;
    ece += (bucket.length / evaluations.length) * Math.abs(probability - accuracy);
  }
  for (const item of evaluations) {
    const outcome = Number(item.exact);
    // Two-category Brier score: correct and incorrect probabilities both contribute.
    brier += ((item.probability - outcome) ** 2) + (((1 - item.probability) - (1 - outcome)) ** 2);
  }
  return { brierScore: brier / evaluations.length, expectedCalibrationError: ece };
}

export function assessTemporalHoldoutThresholds(evaluations, thresholds = STRICT_THRESHOLDS) {
  const total = evaluations.length;
  const exactCount = evaluations.filter((item) => item.exact).length;
  const resolvedCount = evaluations.filter((item) => item.resolved).length;
  const high = evaluations.filter((item) => item.confidence === 'high');
  const highExact = high.filter((item) => item.exact).length;
  const fieldMatchesTotal = evaluations.reduce((sum, item) => sum + item.fieldMatches, 0);
  const fieldDenominator = evaluations.reduce((sum, item) => sum + item.fieldDenominator, 0);
  const templates = new Map();
  for (const item of evaluations) {
    const bucket = templates.get(item.templateKey) ?? [];
    bucket.push(item);
    templates.set(item.templateKey, bucket);
  }
  const templateMacroAccuracy = templates.size === 0 ? 0 : [...templates.values()]
    .reduce((sum, bucket) => sum + bucket.filter((item) => item.exact).length / bucket.length, 0) / templates.size;
  const exactMultisetAccuracy = total === 0 ? 0 : exactCount / total;
  const exactMultisetWilsonLower = wilsonLowerBound(exactCount, total);
  const highConfidenceExactPrecision = high.length === 0 ? 0 : highExact / high.length;
  const calibration = calibrationMetrics(evaluations);
  const metrics = Object.freeze({
    total,
    issuerCount: new Set(evaluations.map((item) => item.issuerKey).filter(Boolean)).size,
    templateCount: templates.size,
    exactCount,
    exactMultisetAccuracy,
    exactSetAccuracy: exactMultisetAccuracy,
    exactMultisetWilsonLower,
    exactSetWilsonLower: exactMultisetWilsonLower,
    resolvedCoverage: total === 0 ? 0 : resolvedCount / total,
    fieldAccuracy: fieldDenominator === 0 ? 0 : fieldMatchesTotal / fieldDenominator,
    templateMacroAccuracy,
    highConfidenceCount: high.length,
    highConfidenceExactPrecision,
    highConfidencePrecision: highConfidenceExactPrecision,
    highConfidenceWilsonLower: wilsonLowerBound(highExact, high.length),
    // Coverage is the share of the complete sealed cohort assigned high confidence,
    // including incorrect or unresolved outputs; precision separately measures correctness.
    highConfidenceCoverage: total === 0 ? 0 : high.length / total,
    highConfidencePredictionCoverage: total === 0 ? 0 : high.length / total,
    ...calibration,
    categoricalBrierScore: calibration.brierScore,
    ece: calibration.expectedCalibrationError,
  });
  const failures = Object.entries(thresholds).flatMap(([metric, threshold]) => {
    const maximum = metric === 'brierScore';
    const failed = maximum ? metrics[metric] > threshold : metrics[metric] < threshold;
    return failed ? [{ metric, actual: metrics[metric], [maximum ? 'maximum' : 'minimum']: threshold }] : [];
  });
  return Object.freeze({ metrics, passed: failures.length === 0, failures: Object.freeze(failures) });
}

export function evaluateTemporalHoldoutFixture(
  fixture,
  predictor = extractEventsGatedProjection,
  thresholds = STRICT_THRESHOLDS,
  { allowBurned = false } = {},
) {
  const validated = validateTemporalHoldoutFixture(fixture, { allowBurned });
  const evaluations = validated.cases.map((fixtureCase) => {
    const input = fixtureCase.input ?? {};
    const extractorInput = {
      ...input,
      filedAt: input.filedAt ?? input.receiptDate,
      reportName: input.reportName ?? input.title,
      bodyText: input.bodyText ?? input.body,
      corpName: input.corpName ?? input.issuer,
    };
    return evaluateTemporalHoldoutCase(
      fixtureCase,
      predictor(extractorInput),
      { allowDevelopmentGold: allowBurned },
    );
  });
  const assessment = assessTemporalHoldoutThresholds(evaluations, thresholds);
  return Object.freeze({ evaluations: Object.freeze(evaluations), assessment });
}

export async function runTemporalHoldoutBenchmark({ fixturePath = DEFAULT_FIXTURE, gateMode = 'strict' } = {}) {
  if (!['strict', 'diagnostic'].includes(gateMode)) {
    throw new TemporalHoldoutFixtureError('gateMode must be strict or diagnostic');
  }
  const absoluteFixture = resolve(fixturePath);
  const fixtureBytes = await readFile(absoluteFixture);
  const fixture = JSON.parse(fixtureBytes.toString('utf8'));
  if (gateMode === 'diagnostic' && fixture.role !== 'burned-temporal-development') {
    throw new TemporalHoldoutFixtureError('diagnostic gate mode is reserved for burned temporal development fixtures');
  }
  const { evaluations, assessment } = evaluateTemporalHoldoutFixture(
    fixture,
    extractEventsGatedProjection,
    gateMode === 'strict' ? STRICT_THRESHOLDS : {},
    { allowBurned: gateMode === 'diagnostic' },
  );
  const fixtureIndependentClaimEligible = fixture.role === 'sealed-temporal-holdout'
    && fixture.audit?.independentClaimEligible === true;
  return {
    schemaVersion: 'jaroo.kr-disclosure-event-temporal-holdout-result.v1',
    fixture: absoluteFixture,
    fixtureRole: fixture.role,
    fixtureIndependentClaimEligible,
    independentClaimEligible: gateMode === 'strict' && assessment.passed && fixtureIndependentClaimEligible,
    developmentReAdjudicationCount: fixture.summary?.developmentReAdjudicationCount ?? 0,
    hashes: {
      fixtureSha256: createHash('sha256').update(fixtureBytes).digest('hex'),
      evaluatorSha256: createHash('sha256').update(await readFile(EVALUATOR_PATH)).digest('hex'),
      extractorSha256: createHash('sha256').update(await readFile(EXTRACTOR_PATH)).digest('hex'),
      ontologyManifestSha256: KR_DISCLOSURE_EVENT_ONTOLOGY_HASH,
      thresholdsSha256: createHash('sha256').update(JSON.stringify(STRICT_THRESHOLDS)).digest('hex'),
      candidateFreezeManifestSha256: fixture.candidateFreeze?.manifestFileSha256 ?? null,
    },
    ontologyVersion: KR_DISCLOSURE_EVENT_ONTOLOGY_VERSION,
    cutoff: fixture.cutoff ?? fixture.query?.cutoff,
    metrics: assessment.metrics,
    failures: evaluations.filter((item) => !item.exact),
    gate: { mode: gateMode, passed: assessment.passed, failures: assessment.failures },
  };
}

async function main() {
  const report = await runTemporalHoldoutBenchmark({
    fixturePath: option('fixture', DEFAULT_FIXTURE),
    gateMode: option('gate', 'strict'),
  });
  process.stdout.write(`${JSON.stringify(report, null, process.argv.includes('--json') ? 0 : 2)}\n`);
  if (!report.gate.passed) process.exitCode = 1;
}

if (process.argv[1]
  && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]))) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  });
}
