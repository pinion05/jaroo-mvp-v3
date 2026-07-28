import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { bestAlignment, eventMultisetEqual } from './score-accuracy.mjs';

const here = new URL('.', import.meta.url).pathname;
const packetDir = resolve(
  process.env.ACCURACY_AUDIT_PACKET_DIR ?? '/tmp/jaroo-opendart-accuracy-audit',
);

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

const annotationsA = [];
const annotationsB = [];
const blindCases = [];
const reviewers = { a: [], b: [] };

for (let slice = 1; slice <= 4; slice += 1) {
  const [a, b, packet] = await Promise.all([
    readJson(resolve(here, `gold-slice-${slice}.json`)),
    readJson(resolve(here, `gold-b-slice-${slice}.json`)),
    readJson(resolve(packetDir, `blind-slice-${slice}.json`)),
  ]);
  if (a.predictionBlind !== true || b.predictionBlind !== true) {
    throw new Error(`Slice ${slice} is not prediction-blind.`);
  }
  reviewers.a.push(a.reviewer);
  reviewers.b.push(b.reviewer);
  annotationsA.push(...a.cases);
  annotationsB.push(...b.cases);
  blindCases.push(...packet.cases);
}

annotationsA.sort((left, right) => left.index - right.index);
annotationsB.sort((left, right) => left.index - right.index);
blindCases.sort((left, right) => left.index - right.index);

if (annotationsA.length !== 150 || annotationsB.length !== 150 || blindCases.length !== 150) {
  throw new Error('Expected 150 cases in both annotations and blind packets.');
}

const disagreements = [];
let exactAgreementCount = 0;
let assessableComparedCount = 0;
let unassessableAgreementCount = 0;
let alternativeCompatibleCount = 0;
let cardinalityAgreementCount = 0;
let fieldDenominator = 0;
const fieldMatches = {
  type: 0,
  action: 0,
  state: 0,
  cause: 0,
  subjectType: 0,
};

for (let index = 0; index < 150; index += 1) {
  const a = annotationsA[index];
  const b = annotationsB[index];
  const blindCase = blindCases[index];
  if (a.index !== index || b.index !== index || blindCase.index !== index) {
    throw new Error(`Index mismatch at ${index}.`);
  }
  if (a.rceptNo !== b.rceptNo || a.rceptNo !== blindCase.source.rceptNo) {
    throw new Error(`Receipt mismatch at ${index}.`);
  }

  const bothUnassessable = !a.assessable && !b.assessable;
  const exactAgreement = Boolean(
    a.assessable === b.assessable &&
    (bothUnassessable || eventMultisetEqual(a.goldEvents, b.goldEvents)),
  );
  if (bothUnassessable) unassessableAgreementCount += 1;
  if (a.assessable && b.assessable) {
    assessableComparedCount += 1;
    if (a.goldEvents.length === b.goldEvents.length) cardinalityAgreementCount += 1;
    const denominator = Math.max(a.goldEvents.length, b.goldEvents.length);
    const alignment = bestAlignment(a.goldEvents, b.goldEvents);
    fieldDenominator += denominator;
    for (const field of Object.keys(fieldMatches)) {
      fieldMatches[field] += alignment.fieldMatches[field] ?? 0;
    }
  }
  if (exactAgreement && !bothUnassessable) exactAgreementCount += 1;
  if (exactAgreement) continue;

  const alternativeCompatible = Boolean(
    a.assessable && b.assessable && (
      (a.acceptableAlternatives ?? []).some((events) => eventMultisetEqual(events, b.goldEvents)) ||
      (b.acceptableAlternatives ?? []).some((events) => eventMultisetEqual(events, a.goldEvents))
    )
  );
  if (alternativeCompatible) alternativeCompatibleCount += 1;
  disagreements.push({
    index,
    rceptNo: a.rceptNo,
    blindCase,
    annotationA: a,
    annotationB: b,
    alternativeCompatible,
  });
}

const artifact = {
  schemaVersion: 'jaroo.opendart-event-adjudication-packet.v1',
  generatedAt: new Date().toISOString(),
  predictionBlind: true,
  handbook: {
    scope: 'Document-level disclosure intent, excluding historical/background/boilerplate mentions.',
    comparison: 'Order-insensitive, duplicate-sensitive canonical event multiset.',
    correction: 'Correction wrapper is not an independent event; label post-correction substantive lifecycle.',
  },
  reviewers,
  summary: {
    totalCases: 150,
    assessableComparedCount,
    exactAgreementCount,
    exactAgreementRate: assessableComparedCount
      ? exactAgreementCount / assessableComparedCount
      : null,
    cardinalityAgreementCount,
    cardinalityAgreementRate: assessableComparedCount
      ? cardinalityAgreementCount / assessableComparedCount
      : null,
    fieldAgreement: {
      denominatorOccurrences: fieldDenominator,
      matches: fieldMatches,
      accuracy: Object.fromEntries(Object.entries(fieldMatches).map(([field, count]) => [
        field,
        fieldDenominator ? count / fieldDenominator : null,
      ])),
      microAccuracy: fieldDenominator
        ? Object.values(fieldMatches).reduce((sum, value) => sum + value, 0) /
          (fieldDenominator * Object.keys(fieldMatches).length)
        : null,
    },
    unassessableAgreementCount,
    disagreementCount: disagreements.length,
    alternativeCompatibleCount,
  },
  disagreements,
};

const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
if (serialized.includes('eventExtraction') || serialized.includes('filingClassification')) {
  throw new Error('Adjudication packet accidentally contains predictions.');
}
await writeFile(resolve(packetDir, 'adjudication-packet.json'), serialized, 'utf8');
await writeFile(
  resolve(here, 'annotation-agreement.json'),
  `${JSON.stringify({ ...artifact.summary, reviewers }, null, 2)}\n`,
  'utf8',
);
console.log(JSON.stringify({ packet: resolve(packetDir, 'adjudication-packet.json'), ...artifact.summary }, null, 2));
