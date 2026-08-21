import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  KR_DISCLOSURE_EVENT_ONTOLOGY_HASH,
  KR_DISCLOSURE_EVENT_ONTOLOGY_VERSION,
  validateCanonicalDisclosureEvent,
} from '../../../../packages/crawler/src/services/deepscan-kr-disclosure-event-ontology.js';
import { eventMultisetEqual } from './score-accuracy.mjs';

const here = new URL('.', import.meta.url).pathname;
const reportDir = resolve(here, '..');
async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

const annotationsA = [];
const annotationsB = [];
const reviewers = { a: [], b: [] };
for (let slice = 1; slice <= 4; slice += 1) {
  const [a, b] = await Promise.all([
    readJson(resolve(here, `gold-slice-${slice}.json`)),
    readJson(resolve(here, `gold-b-slice-${slice}.json`)),
  ]);
  annotationsA.push(...a.cases);
  annotationsB.push(...b.cases);
  reviewers.a.push(a.reviewer);
  reviewers.b.push(b.reviewer);
}
annotationsA.sort((left, right) => left.index - right.index);
annotationsB.sort((left, right) => left.index - right.index);

const agreement = await readJson(resolve(here, 'annotation-agreement.json'));
const adjudication = await readJson(resolve(here, 'adjudications.json'));
const spotcheck = await readJson(resolve(here, 'agreement-spotcheck-results.json'));
if (adjudication.predictionBlind !== true) {
  throw new Error('Adjudication is not marked predictionBlind=true.');
}
if (spotcheck.predictionBlind !== true || spotcheck.cases.length !== 20) {
  throw new Error('Agreement spot-check is incomplete or not prediction-blind.');
}
const revisedSpotchecks = spotcheck.cases.filter((entry) => entry.verdict === 'revised');
if (revisedSpotchecks.length) {
  throw new Error(
    `Agreement spot-check found ${revisedSpotchecks.length} revisions; supplemental adjudication is required.`,
  );
}
const adjudicatedByReceipt = new Map(
  adjudication.cases.map((entry) => [entry.rceptNo, entry]),
);
if (adjudicatedByReceipt.size !== agreement.disagreementCount) {
  throw new Error(
    `Adjudication count mismatch: ${adjudicatedByReceipt.size}/${agreement.disagreementCount}`,
  );
}

const cases = [];
for (let index = 0; index < 150; index += 1) {
  const a = annotationsA[index];
  const b = annotationsB[index];
  const bothUnassessable = !a.assessable && !b.assessable;
  const exactAgreement = Boolean(
    a.assessable === b.assessable &&
    (bothUnassessable || eventMultisetEqual(a.goldEvents, b.goldEvents)),
  );
  const selected = exactAgreement ? a : adjudicatedByReceipt.get(a.rceptNo);
  if (!selected) throw new Error(`Missing adjudication for ${a.rceptNo}`);
  const finalCase = {
    index,
    rceptNo: a.rceptNo,
    assessable: selected.assessable,
    goldEvents: selected.assessable ? selected.goldEvents : null,
    acceptableAlternatives: selected.acceptableAlternatives ?? [],
    confidence: selected.confidence ?? (exactAgreement ? a.confidence : 'medium'),
    evidenceSummary: selected.evidenceSummary ?? a.evidenceSummary,
    rationale: selected.rationale ?? a.rationale,
    annotationAgreement: exactAgreement,
    adjudicated: !exactAgreement,
    selectedFrom: exactAgreement ? 'agreement' : (selected.selectedFrom ?? 'adjudicated'),
  };

  if (finalCase.assessable) {
    if (!Array.isArray(finalCase.goldEvents)) {
      throw new Error(`Assessable gold has no event array: ${finalCase.rceptNo}`);
    }
    for (const event of finalCase.goldEvents) {
      const validation = validateCanonicalDisclosureEvent(event);
      if (!validation.valid) {
        throw new Error(
          `Invalid final gold ${finalCase.rceptNo}: ${validation.errors.join('; ')}`,
        );
      }
    }
  }
  cases.push(finalCase);
}

const sourceRaw = await readFile(resolve(reportDir, 'source-data.json'), 'utf8');
const artifact = {
  schemaVersion: 'jaroo.opendart-event-gold.v1',
  generatedAt: new Date().toISOString(),
  predictionBlind: true,
  methodology: 'methodology.md',
  ontologyVersion: KR_DISCLOSURE_EVENT_ONTOLOGY_VERSION,
  ontologyHash: KR_DISCLOSURE_EVENT_ONTOLOGY_HASH,
  sourceDataSha256: createHash('sha256').update(sourceRaw).digest('hex'),
  annotation: {
    annotators: reviewers,
    adjudicator: adjudication.adjudicator,
    exactAgreementCount: agreement.exactAgreementCount,
    assessableComparedCount: agreement.assessableComparedCount,
    exactAgreementRate: agreement.exactAgreementRate,
    cardinalityAgreementCount: agreement.cardinalityAgreementCount,
    cardinalityAgreementRate: agreement.cardinalityAgreementRate,
    fieldAgreement: agreement.fieldAgreement,
    unassessableAgreementCount: agreement.unassessableAgreementCount,
    adjudicatedCount: agreement.disagreementCount,
    alternativeCompatibleCount: agreement.alternativeCompatibleCount,
    agreementSpotcheck: {
      reviewer: spotcheck.reviewer,
      sampleSize: spotcheck.cases.length,
      confirmedCount: spotcheck.cases.filter((entry) => entry.verdict === 'confirmed').length,
      revisedCount: revisedSpotchecks.length,
      seed: spotcheck.seed,
    },
  },
  cases,
};

const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
if (serialized.includes('eventExtraction') || serialized.includes('filingClassification')) {
  throw new Error('Final gold accidentally contains predictions.');
}
await writeFile(resolve(here, 'gold-final.json'), serialized, 'utf8');
console.log(JSON.stringify({
  output: resolve(here, 'gold-final.json'),
  caseCount: cases.length,
  assessableCount: cases.filter((entry) => entry.assessable).length,
  eventCount: cases.reduce((sum, entry) => sum + (entry.goldEvents?.length ?? 0), 0),
  ...artifact.annotation,
}, null, 2));
