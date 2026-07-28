#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractEventsGatedProjection } from '../src/services/deepscan-kr-disclosure-event-extractors.js';
import {
  CANONICAL_DISCLOSURE_EVENT_FIELDS,
  canonicalizeDisclosureEventAliases,
  KR_DISCLOSURE_EVENT_ONTOLOGY_HASH,
  KR_DISCLOSURE_EVENT_ONTOLOGY_VERSION,
} from '../src/services/deepscan-kr-disclosure-event-ontology.js';
import {
  canonicalJsonSha256,
  KR_DISCLOSURE_TEMPORAL_STRICT_THRESHOLDS,
  temporalCorpusCaseProjection,
  temporalCorpusCaseSha256,
  temporalDomainSha256,
  validateCandidateFreezeEnvelope,
  validateDetachedTimestampEnvelope,
  validateTemporalRawCorpusEnvelope,
} from '../src/services/deepscan-kr-disclosure-temporal-protocol.js';
import { normalizeTitleTemplate } from './collect-dart-disclosure-temporal-holdout.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DEFAULT_FIXTURE = resolve(ROOT, 'test/fixtures/kr-disclosure-event-temporal-holdout.v1.json');
const EVALUATOR_PATH = fileURLToPath(import.meta.url);
const EXTRACTOR_PATH = resolve(ROOT, 'src/services/deepscan-kr-disclosure-event-extractors.js');
const CORRECTION_TABLE_PATH = resolve(ROOT, 'src/services/deepscan-kr-correction-table.js');
export const CANONICAL_EVENT_FIELDS = CANONICAL_DISCLOSURE_EVENT_FIELDS;
// Development and burned temporal calibration both place the resolved
// medium-confidence bucket near 90% exactness.  Keep a conservative gap to
// the audited high bucket while scoring the labels with their observed base
// rate instead of the former under-confident 0.75 prior.
export const CONFIDENCE_PROBABILITIES = Object.freeze({ low: 0.1, medium: 0.9, high: 0.95 });
const MAXIMUM_THRESHOLD_METRICS = new Set(['brierScore', 'expectedCalibrationError']);
export const MAX_EVENTS_PER_CASE = 20;
export const STRICT_THRESHOLDS = KR_DISCLOSURE_TEMPORAL_STRICT_THRESHOLDS;
export const TEMPORAL_EXTERNAL_INDEPENDENCE_REQUIREMENTS = Object.freeze([
  'contract-tsa-formal-accuracy-bound',
  'provider-population-authenticity-witness',
  'signed-independent-annotation-identities',
  'append-only-cohort-burn-ledger',
]);
const SEALED_V2_FIXTURE_FIELDS = Object.freeze([
  'schemaVersion', 'role', 'labelStatus', 'ontologyVersion', 'ontologyHash',
  'cutoff', 'candidateFreeze', 'audit', 'query', 'summary', 'cases', 'provenance',
]);
const SEALED_V2_AUDIT_FIELDS = Object.freeze([
  'predictionsHiddenUntilAdjudication', 'unlabeledCorpusSha256', 'annotationManifestSha256',
]);
const SEALED_V2_PROVENANCE_FIELDS = Object.freeze([
  'rawCorpusPath', 'rawCorpusFileSha256', 'rawCorpusPayloadCanonicalSha256',
  'annotationFreeze',
]);
const SEALED_V2_SUMMARY_FIELDS = Object.freeze([
  'selectedCount', 'caseCount', 'uniqueIssuerCount', 'uniqueTitleTemplateCount',
  'truncatedBodyCount', 'retainedBodyCharCount', 'agreementCaseCount',
  'dualAdjudicatorResolutionCount', 'finalAdjudicatorResolutionCount',
  'documentFailureCount',
]);
const SEALED_V2_CASE_FIELDS = Object.freeze([
  'id', 'labelStatus', 'templateKey', 'source', 'input', 'expectedEvents',
  'annotations', 'adjudication',
]);
const SEALED_V2_ANNOTATION_FIELDS = Object.freeze([
  'annotator', 'blindedToPrediction', 'confidenceInLabel', 'expectedEvents',
]);
const SEALED_V2_ADJUDICATION_FIELDS = Object.freeze([
  'adjudicator', 'decision', 'blindedToPrediction', 'rationale', 'expectedEvents',
]);
const SEALED_V3_CASE_FIELDS = Object.freeze([
  ...SEALED_V2_CASE_FIELDS,
  'goldDisposition',
]);
const SEALED_V3_ANNOTATION_FIELDS = Object.freeze([
  ...SEALED_V2_ANNOTATION_FIELDS,
  'goldDisposition',
]);
const SEALED_V3_ADJUDICATION_FIELDS = Object.freeze([
  ...SEALED_V2_ADJUDICATION_FIELDS,
  'goldDisposition',
]);
export const GOLD_DISPOSITIONS = Object.freeze([
  'canonical-events-present',
  'no-canonical-events',
]);
export const PREDICTION_DISPOSITIONS = Object.freeze([
  ...GOLD_DISPOSITIONS,
  'unresolved',
]);

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

function requireExactObjectFields(value, requiredFields, label, { optionalFields = [] } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  const allowed = new Set([...requiredFields, ...optionalFields]);
  const unexpected = Object.keys(value).find((field) => !allowed.has(field));
  if (unexpected) fail(`${label} contains forbidden field ${unexpected}`);
  const missing = requiredFields.find((field) => !Object.hasOwn(value, field));
  if (missing) fail(`${label} is missing required field ${missing}`);
  return value;
}

function requireSealedExactSchema(fixture, rawCorpus) {
  const schemaGeneration = fixture.schemaVersion === 'jaroo.kr-disclosure-event-temporal-holdout.v3'
    ? 3
    : 2;
  const schemaLabel = `sealed v${schemaGeneration} fixture`;
  const caseFields = schemaGeneration === 3 ? SEALED_V3_CASE_FIELDS : SEALED_V2_CASE_FIELDS;
  const annotationFields = schemaGeneration === 3
    ? SEALED_V3_ANNOTATION_FIELDS
    : SEALED_V2_ANNOTATION_FIELDS;
  const adjudicationFields = schemaGeneration === 3
    ? SEALED_V3_ADJUDICATION_FIELDS
    : SEALED_V2_ADJUDICATION_FIELDS;
  requireExactObjectFields(fixture, SEALED_V2_FIXTURE_FIELDS, schemaLabel);
  requireExactObjectFields(fixture.audit, SEALED_V2_AUDIT_FIELDS, `${schemaLabel} audit`);
  requireExactObjectFields(
    fixture.provenance,
    SEALED_V2_PROVENANCE_FIELDS,
    `${schemaLabel} provenance`,
  );
  requireExactObjectFields(fixture.summary, SEALED_V2_SUMMARY_FIELDS, `${schemaLabel} summary`);
  requireExactObjectFields(
    fixture.query,
    Object.keys(rawCorpus?.payload?.query ?? {}),
    `${schemaLabel} query`,
  );
  for (const [index, fixtureCase] of (fixture.cases ?? []).entries()) {
    const label = `${schemaLabel} cases[${index}]`;
    requireExactObjectFields(fixtureCase, caseFields, label);
    temporalCorpusCaseProjection(fixtureCase);
    for (const [annotationIndex, annotation] of (fixtureCase.annotations ?? []).entries()) {
      requireExactObjectFields(
        annotation,
        annotationFields,
        `${label}.annotations[${annotationIndex}]`,
      );
    }
    requireExactObjectFields(
      fixtureCase.adjudication,
      adjudicationFields,
      `${label}.adjudication`,
      { optionalFields: ['resolutionTier'] },
    );
  }
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

function validateCanonicalEventList(events, label, { allowEmpty = false } = {}) {
  if (!Array.isArray(events) || (!allowEmpty && events.length === 0)) {
    fail(`${label} must be ${allowEmpty ? 'an array' : 'nonempty'}`);
  }
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

function dispositionFingerprint(record) {
  return JSON.stringify({
    goldDisposition: record.goldDisposition,
    expectedEvents: eventMultiset(record.expectedEvents),
  });
}

function validateGoldRecord(record, label, { requireDisposition }) {
  if (!requireDisposition) {
    validateCanonicalEventList(record.expectedEvents, `${label}.expectedEvents`);
    return;
  }
  if (!GOLD_DISPOSITIONS.includes(record.goldDisposition)) {
    fail(`${label}.goldDisposition must be canonical-events-present or no-canonical-events`);
  }
  validateCanonicalEventList(record.expectedEvents, `${label}.expectedEvents`, { allowEmpty: true });
  if (record.goldDisposition === 'canonical-events-present' && record.expectedEvents.length === 0) {
    fail(`${label}.expectedEvents must be nonempty when goldDisposition is canonical-events-present`);
  }
  if (record.goldDisposition === 'no-canonical-events' && record.expectedEvents.length !== 0) {
    fail(`${label}.expectedEvents must be empty when goldDisposition is no-canonical-events`);
  }
}

function validateAdjudicatedGoldLabels(fixtureCase, label, { requireDisposition }) {
  const fingerprint = requireDisposition
    ? dispositionFingerprint
    : (record) => JSON.stringify(eventMultiset(record.expectedEvents));
  validateGoldRecord(fixtureCase, label, { requireDisposition });
  if (!Array.isArray(fixtureCase.annotations) || fixtureCase.annotations.length < 2) {
    fail(`${label}.annotations must contain at least two independent labels`);
  }
  const fingerprints = fixtureCase.annotations.map((annotation, index) => {
    validateGoldRecord(annotation, `${label}.annotations[${index}]`, { requireDisposition });
    return fingerprint(annotation);
  });
  validateGoldRecord(fixtureCase.adjudication, `${label}.adjudication`, { requireDisposition });
  const goldFingerprint = fingerprint(fixtureCase);
  if (fingerprint(fixtureCase.adjudication) !== goldFingerprint) {
    fail(`${label} adjudication disposition and expectedEvents must exactly match case gold`);
  }
  const unanimous = fingerprints.every((value) => value === fingerprints[0]);
  if (fixtureCase.adjudication.decision === 'agreement'
    && (!unanimous || fingerprints[0] !== goldFingerprint)) {
    fail(`${label} agreement adjudication must match both independent labels`);
  }
  if (fixtureCase.adjudication.decision === 'resolved' && unanimous) {
    fail(`${label} resolved adjudication requires an annotation disagreement`);
  }
  return fixtureCase;
}

export function validateSealedV2GoldLabels(fixtureCase, label = 'sealed v2 fixture case') {
  return validateAdjudicatedGoldLabels(fixtureCase, label, { requireDisposition: false });
}

export function validateSealedV3GoldLabels(fixtureCase, label = 'sealed v3 fixture case') {
  return validateAdjudicatedGoldLabels(fixtureCase, label, { requireDisposition: true });
}

function fieldMatches(left, right) {
  return CANONICAL_EVENT_FIELDS.reduce((total, field) => total + Number(left[field] === right[field]), 0);
}

// Solve the maximum-weight bipartite assignment in O(n^3). Padding with zero-weight
// vertices preserves the unmatched-event penalty applied by the caller's denominator.
export function optimalFieldMatches(expectedEvents = [], predictedEvents = []) {
  const expected = expectedEvents.map(canonicalEvent);
  const predicted = predictedEvents.map(canonicalEvent);
  const size = Math.max(expected.length, predicted.length);
  if (size === 0) return 0;

  const maximumPairWeight = CANONICAL_EVENT_FIELDS.length;
  const rowPotential = Array(size + 1).fill(0);
  const columnPotential = Array(size + 1).fill(0);
  const matchedRowByColumn = Array(size + 1).fill(0);
  const previousColumn = Array(size + 1).fill(0);

  for (let rowToMatch = 1; rowToMatch <= size; rowToMatch += 1) {
    matchedRowByColumn[0] = rowToMatch;
    const minimumReducedCost = Array(size + 1).fill(Number.POSITIVE_INFINITY);
    const visitedColumn = Array(size + 1).fill(false);
    let column = 0;

    do {
      visitedColumn[column] = true;
      const row = matchedRowByColumn[column];
      let delta = Number.POSITIVE_INFINITY;
      let nextColumn = 0;

      for (let candidateColumn = 1; candidateColumn <= size; candidateColumn += 1) {
        if (visitedColumn[candidateColumn]) continue;
        const weight = row <= expected.length && candidateColumn <= predicted.length
          ? fieldMatches(expected[row - 1], predicted[candidateColumn - 1])
          : 0;
        const reducedCost = maximumPairWeight - weight
          - rowPotential[row]
          - columnPotential[candidateColumn];
        if (reducedCost < minimumReducedCost[candidateColumn]) {
          minimumReducedCost[candidateColumn] = reducedCost;
          previousColumn[candidateColumn] = column;
        }
        if (minimumReducedCost[candidateColumn] < delta) {
          delta = minimumReducedCost[candidateColumn];
          nextColumn = candidateColumn;
        }
      }

      for (let candidateColumn = 0; candidateColumn <= size; candidateColumn += 1) {
        if (visitedColumn[candidateColumn]) {
          rowPotential[matchedRowByColumn[candidateColumn]] += delta;
          columnPotential[candidateColumn] -= delta;
        } else if (candidateColumn > 0) {
          minimumReducedCost[candidateColumn] -= delta;
        }
      }
      column = nextColumn;
    } while (matchedRowByColumn[column] !== 0);

    do {
      const prior = previousColumn[column];
      matchedRowByColumn[column] = matchedRowByColumn[prior];
      column = prior;
    } while (column !== 0);
  }

  let total = 0;
  for (let column = 1; column <= predicted.length; column += 1) {
    const row = matchedRowByColumn[column];
    if (row > 0 && row <= expected.length) {
      total += fieldMatches(expected[row - 1], predicted[column - 1]);
    }
  }
  return total;
}

export function wilsonLowerBound(successes, total, z = 1.959963984540054) {
  if (total <= 0) return 0;
  const proportion = successes / total;
  const denominator = 1 + (z ** 2 / total);
  const centre = proportion + (z ** 2 / (2 * total));
  const margin = z * Math.sqrt((proportion * (1 - proportion) + (z ** 2 / (4 * total))) / total);
  return Math.max(0, (centre - margin) / denominator);
}

function canonicalEventArray(events = []) {
  return events.map(canonicalEvent).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

export function buildTemporalAnnotationPayload(fixture, {
  rawCorpusFileSha256,
  rawCorpus,
} = {}) {
  if (!rawCorpus?.payload?.selection) fail('raw corpus selection is required for the annotation payload');
  requireSealedExactSchema(fixture, rawCorpus);
  const includeDisposition = fixture.schemaVersion === 'jaroo.kr-disclosure-event-temporal-holdout.v3';
  return {
    schemaVersion: includeDisposition
      ? 'jaroo.kr-disclosure-event-annotation-manifest.v3'
      : 'jaroo.kr-disclosure-event-annotation-manifest.v2',
    rawCorpusFileSha256,
    rawCorpusPayloadCanonicalSha256: rawCorpus.envelope.payloadCanonicalSha256,
    selectedReceiptsSha256: rawCorpus.payload.selection.selectedReceiptsSha256,
    selectedCasesSha256: rawCorpus.payload.selection.selectedCasesSha256,
    ontologyVersion: fixture.ontologyVersion,
    ontologyHash: fixture.ontologyHash,
    predictionsHiddenUntilAdjudication: fixture.audit?.predictionsHiddenUntilAdjudication,
    cases: fixture.cases.map((fixtureCase, index) => ({
      id: fixtureCase.id,
      rceptNo: valueFrom(fixtureCase, ['rceptNo', 'receiptNumber'], ['rceptNo', 'receiptNumber']),
      caseContentSha256: rawCorpus.payload.selection.selectedCaseDigests[index],
      ...(includeDisposition ? { goldDisposition: fixtureCase.goldDisposition } : {}),
      expectedEvents: canonicalEventArray(fixtureCase.expectedEvents),
      annotations: fixtureCase.annotations.map((annotation) => ({
        annotator: annotation.annotator,
        blindedToPrediction: annotation.blindedToPrediction,
        confidenceInLabel: annotation.confidenceInLabel,
        ...(includeDisposition ? { goldDisposition: annotation.goldDisposition } : {}),
        expectedEvents: canonicalEventArray(annotation.expectedEvents),
      })),
      adjudication: {
        adjudicator: fixtureCase.adjudication.adjudicator,
        decision: fixtureCase.adjudication.decision,
        blindedToPrediction: fixtureCase.adjudication.blindedToPrediction,
        rationale: fixtureCase.adjudication.rationale,
        resolutionTier: fixtureCase.adjudication.resolutionTier ?? null,
        ...(includeDisposition ? { goldDisposition: fixtureCase.adjudication.goldDisposition } : {}),
        expectedEvents: canonicalEventArray(fixtureCase.adjudication.expectedEvents),
      },
    })),
  };
}

export function validateTemporalHoldoutFixture(fixture, {
  allowBurned = false,
  allowLegacySealedForTesting = false,
  rawCorpusEnvelope = null,
  rawCorpusFileBytes = null,
  verifyExternalTimestamps = true,
  verifyCurrentCandidate = true,
  verifyRepositoryAnchor = true,
  now = new Date(),
} = {}) {
  if (!['sealed-temporal-holdout', 'burned-temporal-development'].includes(fixture.role)) {
    fail('temporal holdout fixture role must be sealed-temporal-holdout or burned-temporal-development');
  }
  const sealedV2 = fixture.role === 'sealed-temporal-holdout'
    && fixture.schemaVersion === 'jaroo.kr-disclosure-event-temporal-holdout.v2';
  const sealedV3 = fixture.role === 'sealed-temporal-holdout'
    && fixture.schemaVersion === 'jaroo.kr-disclosure-event-temporal-holdout.v3';
  const provenanceBoundSealed = sealedV2 || sealedV3;
  const legacyV1 = fixture.schemaVersion === 'jaroo.kr-disclosure-event-temporal-holdout.v1';
  if (fixture.role === 'sealed-temporal-holdout' && !provenanceBoundSealed
    && !(allowLegacySealedForTesting && legacyV1)) {
    fail('sealed temporal holdout must use the provenance-bound v2 or v3 schema');
  }
  if (fixture.role === 'burned-temporal-development' && !legacyV1) {
    fail('burned temporal development fixture must use the archived v1 schema');
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
    if (provenanceBoundSealed && Object.hasOwn(fixture.audit ?? {}, 'independentClaimEligible')) {
      fail('provenance-bound sealed eligibility is derived from verified provenance and must not be self-attested');
    }
    if (!provenanceBoundSealed && fixture.audit?.independentClaimEligible !== true) {
      fail('legacy sealed temporal holdout must set audit.independentClaimEligible=true');
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
  let rawCorpus = null;
  let rawCorpusFileSha256 = null;
  if (fixture.role === 'sealed-temporal-holdout') {
    if (provenanceBoundSealed) {
      if (!rawCorpusEnvelope || !rawCorpusFileBytes) {
        fail('provenance-bound sealed fixture requires the exact timestamped raw corpus artifact');
      }
      rawCorpusFileSha256 = createHash('sha256').update(rawCorpusFileBytes).digest('hex');
      if (fixture.provenance?.rawCorpusFileSha256 !== rawCorpusFileSha256
        || fixture.audit?.unlabeledCorpusSha256 !== rawCorpusFileSha256) {
        fail('provenance-bound sealed raw corpus file hash mismatch');
      }
      try {
        rawCorpus = validateTemporalRawCorpusEnvelope(rawCorpusEnvelope, {
          verifyExternalTimestamps,
          verifyCurrentCandidate,
          verifyRepositoryAnchor,
          now,
        });
      } catch (error) {
        fail(error.message);
      }
      requireSealedExactSchema(fixture, rawCorpus);
      candidateFreeze = rawCorpus.freeze;
      if (canonicalJsonSha256(fixture.candidateFreeze)
        !== canonicalJsonSha256(rawCorpus.payload.candidateFreeze)) {
        fail('fixture candidate freeze must equal the raw corpus candidate freeze');
      }
      if (fixture.provenance?.rawCorpusPayloadCanonicalSha256
        !== rawCorpus.envelope.payloadCanonicalSha256) {
        fail('provenance-bound sealed raw corpus payload canonical hash mismatch');
      }
      for (const field of [
        'from', 'to', 'cutoff', 'corpClass', 'limit', 'minIssuers',
        'selectionSeedCommitment', 'exclusionManifestSha256',
        'excludedReceiptCount', 'excludedReceiptsSha256',
      ]) {
        if (fixture.query[field] !== rawCorpus.payload.query[field]) {
          fail(`fixture query.${field} must equal the timestamped raw corpus query`);
        }
      }
      if (canonicalJsonSha256(fixture.query) !== canonicalJsonSha256(rawCorpus.payload.query)) {
        fail('provenance-bound sealed fixture query must exactly equal the timestamped raw corpus query');
      }
    } else if (allowLegacySealedForTesting) {
      const legacy = fixture.candidateFreeze?.manifest;
      const legacySampling = legacy?.sampling ?? legacy?.precommit?.sampling;
      const legacyCutoff = legacy?.cutoff ?? legacy?.temporalBoundary?.cutoff;
      const legacyFirstEligible = legacy?.firstEligibleFilingDate
        ?? legacy?.temporalBoundary?.firstEligibleFilingDate;
      if (!legacySampling || !legacyCutoff || !legacyFirstEligible) {
        fail('legacy test fixture candidate freeze is incomplete');
      }
      candidateFreeze = {
        ...legacy,
        sampling: legacySampling,
        cutoff: legacyCutoff,
        firstEligibleFilingDate: legacyFirstEligible,
      };
    } else {
      try {
        candidateFreeze = validateCandidateFreezeEnvelope(fixture.candidateFreeze, {
          verifyExternalTimestamps,
          verifyCurrentCandidate,
          verifyRepositoryAnchor,
          now,
        });
      } catch (error) {
        fail(error.message);
      }
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
  if (rawCorpus && fixture.cases.length !== rawCorpus.replay.length) {
    fail('provenance-bound sealed fixture case count must equal the deterministic raw corpus selection');
  }
  const receipts = new Set();
  const ids = new Set();
  for (const [index, fixtureCase] of fixture.cases.entries()) {
    const label = `cases[${index}]`;
    if (!fixtureCase || typeof fixtureCase !== 'object' || Array.isArray(fixtureCase)) fail(`${label} must be an object`);
    if (typeof fixtureCase.id !== 'string' || fixtureCase.id.length === 0) fail(`${label}.id must be nonempty`);
    if (ids.has(fixtureCase.id)) fail(`${label} has duplicate case id ${fixtureCase.id}`);
    ids.add(fixtureCase.id);
    if (fixtureCase.labelStatus !== 'adjudicated') fail(`${label}.labelStatus must be adjudicated`);
    let immutableProjection = null;
    if (rawCorpus) {
      for (const forbidden of [
        'rceptNo', 'receiptNumber', 'filedAt', 'filingDate', 'reportName', 'title',
        'bodyText', 'body', 'corpClass', 'bodySha256', 'bodyTextSha256',
      ]) {
        if (Object.hasOwn(fixtureCase, forbidden)) fail(`${label} contains forbidden post-capture alias ${forbidden}`);
      }
      try {
        immutableProjection = temporalCorpusCaseProjection(fixtureCase);
      } catch (error) {
        fail(`${label} immutable raw content is invalid: ${error.message}`);
      }
    }
    const corpClass = immutableProjection?.corpClass
      ?? valueFrom(fixtureCase, ['corpClass'])
      ?? sourceValue(fixtureCase, ['corpClass']);
    if (corpClass !== 'Y') fail(`${label} must have KOSPI corpClass Y`);
    const receipt = immutableProjection?.rceptNo
      ?? valueFrom(fixtureCase, ['rceptNo', 'receiptNumber'], ['rceptNo', 'receiptNumber']);
    if (typeof receipt !== 'string' || receipt.length === 0) fail(`${label} must have a receipt number`);
    if (receipts.has(receipt)) fail(`${label} has duplicate receipt number ${receipt}`);
    receipts.add(receipt);
    if (rawCorpus) {
      if (receipt !== rawCorpus.replay[index]) {
        fail(`${label} receipt does not equal the deterministic raw corpus selection`);
      }
      const caseDigest = temporalCorpusCaseSha256(fixtureCase);
      if (caseDigest !== rawCorpus.payload.selection.selectedCaseDigests[index]) {
        fail(`${label} immutable content differs from the timestamped raw corpus`);
      }
    }
    const filedAt = immutableProjection?.receiptDate
      ?? valueFrom(fixtureCase, ['filedAt', 'filingDate'], ['filedAt', 'filingDate', 'receiptDate']);
    const filingDate = normalizedDate(filedAt, `${label}.filedAt`);
    if (filingDate <= cutoff) fail(`${label} filing date must be strictly after cutoff`);
    if (candidateFreeze && filingDate < candidateFreeze.firstEligibleFilingDate) {
      fail(`${label} filing date must be on or after candidate freeze firstEligibleFilingDate`);
    }
    if (filingDate < queryFrom || filingDate > queryTo) fail(`${label} filing date must be within query.from and query.to`);
    const bodyText = rawCorpus
      ? fixtureCase.input.body
      : valueFrom(fixtureCase, ['bodyText'], ['bodyText', 'body']);
    if (typeof bodyText !== 'string' || bodyText.length === 0) fail(`${label} must have nonempty bodyText`);
    const suppliedHash = fixtureCase.bodySha256
      ?? fixtureCase.bodyTextSha256
      ?? sourceValue(fixtureCase, ['retainedSha256']);
    if (typeof suppliedHash !== 'string' || !/^[a-f0-9]{64}$/.test(suppliedHash)) fail(`${label}.bodySha256 must be a lowercase SHA-256 hex digest`);
    const actualHash = createHash('sha256').update(bodyText).digest('hex');
    if (suppliedHash !== actualHash) fail(`${label} body SHA-256 mismatch`);
    if (typeof fixtureCase.templateKey !== 'string' || fixtureCase.templateKey.length === 0) fail(`${label}.templateKey must be nonempty`);
    const title = immutableProjection?.reportName
      ?? valueFrom(fixtureCase, ['reportName', 'title'], ['reportName', 'title']);
    if (fixtureCase.templateKey !== normalizeTitleTemplate(title)) {
      fail(`${label}.templateKey must equal the normalized disclosure title`);
    }
    const issuer = sourceValue(fixtureCase, ['corpCode']);
    if (typeof issuer !== 'string' || issuer.length === 0) fail(`${label}.source.corpCode must identify an issuer`);
    validateGoldRecord(fixtureCase, label, { requireDisposition: sealedV3 });
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
      validateGoldRecord(annotation, annotationLabel, { requireDisposition: sealedV3 });
      annotationFingerprints.push(sealedV3
        ? dispositionFingerprint(annotation)
        : JSON.stringify(eventMultiset(annotation.expectedEvents)));
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
    validateGoldRecord(adjudication, `${label}.adjudication`, { requireDisposition: sealedV3 });
    const goldFingerprint = sealedV3
      ? dispositionFingerprint(fixtureCase)
      : JSON.stringify(eventMultiset(fixtureCase.expectedEvents));
    const adjudicationFingerprint = sealedV3
      ? dispositionFingerprint(adjudication)
      : JSON.stringify(eventMultiset(adjudication.expectedEvents));
    if (adjudicationFingerprint !== goldFingerprint) {
      fail(`${label} adjudication disposition and expectedEvents must exactly match case gold`);
    }
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
  if (rawCorpus) {
    const annotationPayload = buildTemporalAnnotationPayload(fixture, {
      rawCorpusFileSha256,
      rawCorpus,
    });
    const annotationManifestSha256 = temporalDomainSha256('annotation-manifest', annotationPayload);
    if (fixture.audit.annotationManifestSha256 !== annotationManifestSha256) {
      fail('sealed annotationManifestSha256 does not match the actual labels and adjudication');
    }
    let annotationTimestamp;
    try {
      annotationTimestamp = validateDetachedTimestampEnvelope(
        annotationPayload,
        fixture.provenance?.annotationFreeze,
        { verifyCrypto: verifyExternalTimestamps, now },
      );
    } catch (error) {
      fail(error.message);
    }
    if (new Date(annotationTimestamp.earliestGenTime) <= new Date(rawCorpus.timestamp.operationalNotBefore)) {
      fail('annotation RFC3161 receipts must postdate the raw corpus trusted upper boundary');
    }
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
  if (Object.hasOwn(prediction, 'events') && !Array.isArray(prediction.events)) {
    throw new TemporalHoldoutPredictionError(
      `prediction events for ${fixtureCase.id} must be an array`,
    );
  }
  if (['canonical-events-present', 'no-canonical-events'].includes(prediction.disposition)
    && !Array.isArray(prediction.events)) {
    throw new TemporalHoldoutPredictionError(
      `resolved prediction events for ${fixtureCase.id} must be an array`,
    );
  }
  const predicted = Array.isArray(prediction.events) ? prediction.events : [];
  if (predicted.length > MAX_EVENTS_PER_CASE) {
    throw new TemporalHoldoutPredictionError(
      `prediction events for ${fixtureCase.id} exceeds the maximum of ${MAX_EVENTS_PER_CASE} events`,
    );
  }
  const explicitlyUnresolved = isExplicitlyUnresolved(prediction);
  const containsOther = predicted.some((event) => !event || event.type === 'other');
  const inferredDisposition = predicted.length > 0 && !containsOther
    ? 'canonical-events-present'
    : 'unresolved';
  const predictionDisposition = prediction.disposition ?? inferredDisposition;
  if (!PREDICTION_DISPOSITIONS.includes(predictionDisposition)) {
    throw new TemporalHoldoutPredictionError(
      `prediction disposition for ${fixtureCase.id} must be canonical-events-present, no-canonical-events, or unresolved`,
    );
  }
  if (predictionDisposition === 'canonical-events-present' && (predicted.length === 0 || containsOther)) {
    throw new TemporalHoldoutPredictionError(
      `canonical-events-present prediction for ${fixtureCase.id} must contain canonical events`,
    );
  }
  if (predictionDisposition === 'no-canonical-events' && predicted.length !== 0) {
    throw new TemporalHoldoutPredictionError(
      `no-canonical-events prediction for ${fixtureCase.id} must contain no events`,
    );
  }
  const resolved = !explicitlyUnresolved && (
    predictionDisposition === 'no-canonical-events'
    || (predictionDisposition === 'canonical-events-present' && predicted.length > 0 && !containsOther)
  );
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
  const goldDisposition = fixtureCase.goldDisposition
    ?? (expected.length === 0 ? 'no-canonical-events' : 'canonical-events-present');
  const exact = resolved
    && predictionDisposition === goldDisposition
    && exactMultiset(expected, predicted);
  const dispositionExact = resolved && predictionDisposition === goldDisposition;
  const positiveGold = goldDisposition === 'canonical-events-present';
  return Object.freeze({
    id: fixtureCase.id,
    issuerKey: sourceValue(fixtureCase, ['corpCode']),
    templateKey: fixtureCase.templateKey,
    exact,
    resolved,
    confidence,
    predictionDisposition,
    dispositionExact,
    goldSource: usesDevelopmentGold ? 'post-burn-development' : 'prediction-blinded',
    probability: CONFIDENCE_PROBABILITIES[confidence],
    // Event-field accuracy measures extraction quality only. Gold no-event
    // decisions are reported through disposition metrics and exactness instead
    // of receiving five synthetic field matches for a nonexistent event.
    fieldMatches: positiveGold && resolved ? optimalFieldMatches(expected, predicted) : 0,
    fieldDenominator: positiveGold
      ? Math.max(1, expected.length, predicted.length) * CANONICAL_EVENT_FIELDS.length
      : 0,
    goldDisposition,
    // Empty output without an explicit no-canonical-events disposition,
    // explicit abstain, unresolved, and `other` remain strictly incorrect.
    abstained: !resolved,
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
  const noCanonicalEventCount = evaluations.filter((item) => (
    item.goldDisposition === 'no-canonical-events'
  )).length;
  const abstentionCount = evaluations.filter((item) => item.abstained === true).length;
  const noCanonicalEventAbstentionCount = evaluations.filter((item) => (
    item.goldDisposition === 'no-canonical-events' && item.abstained === true
  )).length;
  const explicitNoCanonicalEventPredictionCount = evaluations.filter((item) => (
    item.predictionDisposition === 'no-canonical-events'
  )).length;
  const noCanonicalEventExactCount = evaluations.filter((item) => (
    item.goldDisposition === 'no-canonical-events' && item.exact
  )).length;
  const dispositionExactCount = evaluations.filter((item) => item.dispositionExact).length;
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
    noCanonicalEventCount,
    noCanonicalEventRate: total === 0 ? 0 : noCanonicalEventCount / total,
    abstentionCount,
    noCanonicalEventAbstentionCount,
    explicitNoCanonicalEventPredictionCount,
    noCanonicalEventExactCount,
    dispositionExactCount,
    dispositionAccuracy: total === 0 ? 0 : dispositionExactCount / total,
    eventFieldScoredCaseCount: evaluations.filter((item) => (
      item.goldDisposition === 'canonical-events-present'
    )).length,
    maximumAchievableExactCount: total,
    maximumAchievableExactAccuracy: total === 0 ? 0 : 1,
    exactMultisetAccuracy,
    exactSetAccuracy: exactMultisetAccuracy,
    exactMultisetWilsonLower,
    exactSetWilsonLower: exactMultisetWilsonLower,
    resolvedCoverage: total === 0 ? 0 : resolvedCount / total,
    resolvedCoverageWilsonLower: wilsonLowerBound(resolvedCount, total),
    fieldAccuracy: fieldDenominator === 0 ? 0 : fieldMatchesTotal / fieldDenominator,
    templateMacroAccuracy,
    highConfidenceCount: high.length,
    highConfidenceIssuerCount: new Set(high.map((item) => item.issuerKey).filter(Boolean)).size,
    highConfidenceTemplateCount: new Set(high.map((item) => item.templateKey).filter(Boolean)).size,
    highConfidenceExactPrecision,
    highConfidencePrecision: highConfidenceExactPrecision,
    highConfidenceWilsonLower: wilsonLowerBound(highExact, high.length),
    // Coverage is the share of the complete sealed cohort assigned high confidence,
    // including incorrect or unresolved outputs; precision separately measures correctness.
    highConfidenceCoverage: total === 0 ? 0 : high.length / total,
    highConfidencePredictionCoverage: total === 0 ? 0 : high.length / total,
    highConfidenceCoverageWilsonLower: wilsonLowerBound(high.length, total),
    ...calibration,
    categoricalBrierScore: calibration.brierScore,
    ece: calibration.expectedCalibrationError,
  });
  const failures = Object.entries(thresholds).flatMap(([metric, threshold]) => {
    const maximum = MAXIMUM_THRESHOLD_METRICS.has(metric);
    if (!Object.hasOwn(metrics, metric)) {
      return [{ metric, actual: null, requirement: 'metric-not-implemented' }];
    }
    const failed = maximum ? metrics[metric] > threshold : metrics[metric] < threshold;
    return failed ? [{ metric, actual: metrics[metric], [maximum ? 'maximum' : 'minimum']: threshold }] : [];
  });
  return Object.freeze({ metrics, passed: failures.length === 0, failures: Object.freeze(failures) });
}

export function evaluateTemporalHoldoutFixture(
  fixture,
  predictor = extractEventsGatedProjection,
  thresholds = STRICT_THRESHOLDS,
  validationOptions = {},
) {
  const { allowBurned = false } = validationOptions;
  const validated = validateTemporalHoldoutFixture(fixture, validationOptions);
  const evaluations = validated.cases.map((fixtureCase) => {
    const input = fixtureCase.input ?? {};
    const extractorInput = {
      rceptNo: input.rceptNo,
      receiptDate: input.receiptDate,
      filedAt: input.receiptDate,
      reportName: input.title,
      title: input.title,
      bodyText: input.body,
      body: input.body,
      corpName: input.issuer,
      issuer: input.issuer,
      stockCode: input.stockCode,
    };
    return evaluateTemporalHoldoutCase(
      fixtureCase,
      predictor(extractorInput),
      { allowDevelopmentGold: allowBurned },
    );
  });
  const assessment = assessTemporalHoldoutThresholds(evaluations, thresholds);
  return Object.freeze({
    evaluations: Object.freeze(evaluations),
    assessment,
    schemaVersion: validated.schemaVersion,
    temporalPerformanceClaimSchemaEligible: validated.schemaVersion
      === 'jaroo.kr-disclosure-event-temporal-holdout.v3',
    provenanceVerified: validated.role === 'sealed-temporal-holdout'
      && [
        'jaroo.kr-disclosure-event-temporal-holdout.v2',
        'jaroo.kr-disclosure-event-temporal-holdout.v3',
      ].includes(validated.schemaVersion)
      && validationOptions.verifyExternalTimestamps !== false
      && validationOptions.verifyCurrentCandidate !== false
      && validationOptions.verifyRepositoryAnchor !== false
      && validationOptions.allowLegacySealedForTesting !== true,
  });
}

export function buildTemporalExternalAttestation() {
  return Object.freeze({
    contractTsaFormalAccuracyBoundVerified: false,
    providerPopulationAuthenticityWitnessVerified: false,
    signedIndependentAnnotationIdentitiesVerified: false,
    appendOnlyCohortBurnLedgerVerified: false,
    passed: false,
    failures: TEMPORAL_EXTERNAL_INDEPENDENCE_REQUIREMENTS,
  });
}

export function assessTemporalClaimGates(options = {}) {
  requireExactObjectFields(
    options,
    ['gateMode', 'assessment', 'provenanceVerified'],
    'temporal claim gate options',
  );
  const { gateMode, assessment, provenanceVerified } = options;
  if (!['strict', 'diagnostic'].includes(gateMode)) {
    throw new TemporalHoldoutFixtureError('gateMode must be strict or diagnostic');
  }
  const externalAttestation = buildTemporalExternalAttestation();
  const performanceGate = Object.freeze({
    passed: assessment?.passed === true,
    failures: Object.freeze([...(assessment?.failures ?? [])]),
  });
  const provenanceGate = Object.freeze({
    passed: provenanceVerified === true,
    failures: Object.freeze(provenanceVerified === true ? [] : [{ requirement: 'sealed-temporal-provenance' }]),
  });
  const temporalPerformanceClaimEligible = gateMode === 'strict'
    && performanceGate.passed
    && provenanceGate.passed;
  const independentClaimEligible = temporalPerformanceClaimEligible
    && externalAttestation.passed === true;
  const independentGate = Object.freeze({
    mode: 'strict',
    enforced: true,
    claimScope: 'independent-sealed-temporal-holdout',
    passed: independentClaimEligible,
    failures: Object.freeze([
      ...performanceGate.failures,
      ...provenanceGate.failures,
      ...externalAttestation.failures.map((requirement) => ({ requirement })),
    ]),
  });
  const gate = gateMode === 'strict'
    ? independentGate
    : Object.freeze({
      mode: 'diagnostic',
      enforced: false,
      claimScope: 'diagnostic-only',
      passed: true,
      failures: Object.freeze([]),
    });
  return Object.freeze({
    performanceGate,
    provenanceGate,
    externalAttestation,
    temporalPerformanceClaimEligible,
    independentClaimEligible,
    independentGate,
    gate,
  });
}

export async function runTemporalHoldoutBenchmark({
  fixturePath = DEFAULT_FIXTURE,
  gateMode = 'strict',
  verifyExternalTimestamps = true,
  verifyCurrentCandidate = true,
  verifyRepositoryAnchor = true,
  allowLegacySealedForTesting = false,
  now = new Date(),
} = {}) {
  if (!['strict', 'diagnostic'].includes(gateMode)) {
    throw new TemporalHoldoutFixtureError('gateMode must be strict or diagnostic');
  }
  if (gateMode === 'strict' && (
    !verifyExternalTimestamps
    || !verifyCurrentCandidate
    || !verifyRepositoryAnchor
    || allowLegacySealedForTesting
  )) {
    throw new TemporalHoldoutFixtureError('strict gate forbids provenance verification bypasses');
  }
  const absoluteFixture = resolve(fixturePath);
  const fixtureBytes = await readFile(absoluteFixture);
  const fixture = JSON.parse(fixtureBytes.toString('utf8'));
  if (gateMode === 'diagnostic' && fixture.role !== 'burned-temporal-development') {
    throw new TemporalHoldoutFixtureError('diagnostic gate mode is reserved for burned temporal development fixtures');
  }
  let rawCorpusEnvelope = null;
  let rawCorpusFileBytes = null;
  let rawCorpusPath = null;
  if (fixture.role === 'sealed-temporal-holdout'
    && [
      'jaroo.kr-disclosure-event-temporal-holdout.v2',
      'jaroo.kr-disclosure-event-temporal-holdout.v3',
    ].includes(fixture.schemaVersion)) {
    if (typeof fixture.provenance?.rawCorpusPath !== 'string' || !fixture.provenance.rawCorpusPath) {
      throw new TemporalHoldoutFixtureError('provenance-bound sealed fixture provenance.rawCorpusPath is required');
    }
    rawCorpusPath = resolve(dirname(absoluteFixture), fixture.provenance.rawCorpusPath);
    rawCorpusFileBytes = await readFile(rawCorpusPath);
    rawCorpusEnvelope = JSON.parse(rawCorpusFileBytes.toString('utf8'));
  }
  const {
    evaluations,
    assessment,
    provenanceVerified,
    schemaVersion: fixtureSchemaVersion,
    temporalPerformanceClaimSchemaEligible,
  } = evaluateTemporalHoldoutFixture(
    fixture,
    extractEventsGatedProjection,
    STRICT_THRESHOLDS,
    {
      allowBurned: gateMode === 'diagnostic',
      allowLegacySealedForTesting,
      rawCorpusEnvelope,
      rawCorpusFileBytes,
      verifyExternalTimestamps,
      verifyCurrentCandidate,
      verifyRepositoryAnchor,
      now,
    },
  );
  // RFC3161 and the content-addressed chain prove existence, ordering, and
  // internal immutability. They do not prove that OpenDART returned the entire
  // population, that human labelers were prediction-blind, or that a cohort
  // has never been burned elsewhere. Keep the independent claim fail-closed
  // until dedicated external witness/signature/ledger verifiers are added.
  const claimGates = assessTemporalClaimGates({
    gateMode,
    assessment,
    provenanceVerified: provenanceVerified && temporalPerformanceClaimSchemaEligible,
  });
  const fixtureIndependentClaimEligible = claimGates.independentClaimEligible;
  return {
    schemaVersion: 'jaroo.kr-disclosure-event-temporal-holdout-result.v3',
    fixture: absoluteFixture,
    fixtureRole: fixture.role,
    fixtureSchemaVersion,
    temporalPerformanceClaimSchemaEligible,
    fixtureIndependentClaimEligible,
    temporalPerformanceClaimEligible: claimGates.temporalPerformanceClaimEligible,
    independentClaimEligible: claimGates.independentClaimEligible,
    cryptographicChainVerified: provenanceVerified,
    externalAttestation: claimGates.externalAttestation,
    externalIndependence: claimGates.externalAttestation,
    developmentReAdjudicationCount: fixture.summary?.developmentReAdjudicationCount ?? 0,
    hashes: {
      fixtureSha256: createHash('sha256').update(fixtureBytes).digest('hex'),
      evaluatorSha256: createHash('sha256').update(await readFile(EVALUATOR_PATH)).digest('hex'),
      extractorSha256: createHash('sha256').update(await readFile(EXTRACTOR_PATH)).digest('hex'),
      correctionTableSha256: createHash('sha256').update(await readFile(CORRECTION_TABLE_PATH)).digest('hex'),
      ontologyManifestSha256: KR_DISCLOSURE_EVENT_ONTOLOGY_HASH,
      thresholdsSha256: createHash('sha256').update(JSON.stringify(STRICT_THRESHOLDS)).digest('hex'),
      candidateFreezeManifestSha256: fixture.candidateFreeze?.manifestFileSha256 ?? null,
      rawCorpusFileSha256: rawCorpusFileBytes
        ? createHash('sha256').update(rawCorpusFileBytes).digest('hex')
        : null,
      annotationManifestSha256: fixture.audit?.annotationManifestSha256 ?? null,
    },
    ontologyVersion: KR_DISCLOSURE_EVENT_ONTOLOGY_VERSION,
    cutoff: fixture.cutoff ?? fixture.query?.cutoff,
    rawCorpus: rawCorpusPath,
    metrics: assessment.metrics,
    failures: evaluations.filter((item) => !item.exact),
    performanceGate: claimGates.performanceGate,
    provenanceGate: claimGates.provenanceGate,
    independentGate: claimGates.independentGate,
    gate: claimGates.gate,
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
