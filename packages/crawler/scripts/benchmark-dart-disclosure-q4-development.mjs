#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractEventsGatedProjection } from '../src/services/deepscan-kr-disclosure-event-extractors.js';
import {
  canonicalizeDisclosureEventAliases,
  KR_DISCLOSURE_EVENT_ONTOLOGY_HASH,
  KR_DISCLOSURE_EVENT_ONTOLOGY_VERSION,
} from '../src/services/deepscan-kr-disclosure-event-ontology.js';
import {
  assessTemporalHoldoutThresholds,
  evaluateTemporalHoldoutCase,
  STRICT_THRESHOLDS,
} from './benchmark-dart-disclosure-temporal-holdout.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const REPOSITORY_ROOT = resolve(ROOT, '../..');
const DEFAULT_CORPUS = resolve(
  REPOSITORY_ROOT,
  '.omx/handoff/dart-event-final-2025q4/sealed/corpus.json',
);
const DEFAULT_ORACLE = resolve(
  REPOSITORY_ROOT,
  '.omx/handoff/dart-event-q4-400-development-oracle-iteration9.json',
);
const EXTRACTOR_PATH = resolve(ROOT, 'src/services/deepscan-kr-disclosure-event-extractors.js');

function option(name, fallback = null) {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function fail(message) {
  throw new Error(`Q4 development benchmark: ${message}`);
}

function eventKey(event) {
  return JSON.stringify({
    type: event?.type ?? null,
    action: event?.action ?? null,
    state: event?.state ?? null,
    cause: event?.cause ?? null,
    subjectType: event?.subjectType ?? null,
  });
}

function validateOracle({ corpus, corpusSha256, extractorSha256, oracle, oraclePath }) {
  if (oracle.developmentOnly !== true) fail('oracle must be explicitly developmentOnly');
  if (oracle.sourceCorpusSha256 !== corpusSha256) fail('oracle sourceCorpusSha256 does not match corpus bytes');
  if (oracle.sourceExtractorSha256 !== extractorSha256) {
    fail('oracle sourceExtractorSha256 does not match the evaluated extractor bytes');
  }
  if (oracle.ontologyVersion !== KR_DISCLOSURE_EVENT_ONTOLOGY_VERSION
    || oracle.ontologyManifestSha256 !== KR_DISCLOSURE_EVENT_ONTOLOGY_HASH) {
    fail('oracle ontology provenance does not match the evaluated ontology');
  }
  if (!Array.isArray(corpus.cases) || corpus.cases.length === 0) fail('corpus cases must be nonempty');
  if (!Array.isArray(oracle.cases) || oracle.cases.length !== corpus.cases.length) {
    fail('oracle cases must align one-to-one with corpus cases');
  }
  for (const [index, oracleCase] of oracle.cases.entries()) {
    if (oracleCase.index !== index) fail(`oracle case ${index} has a noncanonical index`);
    if (!Array.isArray(oracleCase.expectedEvents)) fail(`oracle case ${index} expectedEvents must be an array`);
    for (const [eventIndex, event] of oracleCase.expectedEvents.entries()) {
      let canonical;
      try {
        canonical = canonicalizeDisclosureEventAliases(event);
      } catch (error) {
        fail(`oracle case ${index} event ${eventIndex} violates ontology: ${error.message}`);
      }
      if (eventKey(canonical) !== eventKey(event)) {
        fail(`oracle case ${index} event ${eventIndex} uses a noncanonical alias`);
      }
    }
  }

  if (oracle.adjudicationEvidenceSha256) {
    const evidenceReport = [...(oracle.sourceReports ?? [])]
      .reverse()
      .find((report) => report?.sha256 === oracle.adjudicationEvidenceSha256 && report?.path);
    if (!evidenceReport) fail('oracle adjudicationEvidenceSha256 has no matching source report');
    return resolve(dirname(oraclePath), evidenceReport.path);
  }
  return null;
}

function fixtureCase(corpusCase, oracleCase, index) {
  const input = corpusCase.input ?? {};
  return {
    id: corpusCase.key ?? input.rceptNo ?? String(index),
    source: {
      corpCode: input.corpCode
        ?? corpusCase.corpCode
        ?? input.stockCode
        ?? input.corpName
        ?? null,
    },
    templateKey: corpusCase.sourceTemplateKey
      ?? `${input.disclosureDetailType ?? ''}|${input.reportName ?? ''}`,
    expectedEvents: oracleCase.expectedEvents,
  };
}

function failureBreakdown(failures) {
  const countBy = (key) => Object.fromEntries([...failures.reduce((counts, failure) => {
    const value = failure[key] ?? 'unknown';
    counts.set(value, (counts.get(value) ?? 0) + 1);
    return counts;
  }, new Map()).entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])));
  return {
    confidence: countBy('confidence'),
    disclosureDetailType: countBy('disclosureDetailType'),
    reportName: countBy('reportName'),
  };
}

export async function runQ4DevelopmentBenchmark({
  corpusPath = DEFAULT_CORPUS,
  oraclePath = DEFAULT_ORACLE,
  thresholds = STRICT_THRESHOLDS,
} = {}) {
  const absoluteCorpusPath = resolve(corpusPath);
  const absoluteOraclePath = resolve(oraclePath);
  const [corpusBytes, oracleBytes, extractorBytes] = await Promise.all([
    readFile(absoluteCorpusPath),
    readFile(absoluteOraclePath),
    readFile(EXTRACTOR_PATH),
  ]);
  const corpus = JSON.parse(corpusBytes.toString('utf8'));
  const oracle = JSON.parse(oracleBytes.toString('utf8'));
  const corpusSha256 = sha256(corpusBytes);
  const extractorSha256 = sha256(extractorBytes);
  const evidencePath = validateOracle({
    corpus,
    corpusSha256,
    extractorSha256,
    oracle,
    oraclePath: absoluteOraclePath,
  });
  let adjudicationEvidenceSha256 = null;
  if (evidencePath) {
    adjudicationEvidenceSha256 = sha256(await readFile(evidencePath));
    if (adjudicationEvidenceSha256 !== oracle.adjudicationEvidenceSha256) {
      fail('adjudication evidence bytes do not match oracle hash');
    }
  }

  const failures = [];
  const evaluations = corpus.cases.map((corpusCase, index) => {
    const input = corpusCase.input ?? {};
    const prediction = extractEventsGatedProjection(input);
    const evaluated = evaluateTemporalHoldoutCase(
      fixtureCase(corpusCase, oracle.cases[index], index),
      prediction,
    );
    if (!evaluated.exact) {
      failures.push({
        index,
        rceptNo: input.rceptNo ?? null,
        reportName: input.reportName ?? null,
        disclosureDetailType: input.disclosureDetailType ?? null,
        confidence: prediction.confidence,
        resolved: evaluated.resolved,
        expectedEvents: oracle.cases[index].expectedEvents,
        predictedEvents: prediction.events,
        eventEvidence: prediction.eventEvidence,
      });
    }
    return evaluated;
  });
  const assessment = assessTemporalHoldoutThresholds(evaluations, thresholds);
  return {
    schemaVersion: 'jaroo.kr-disclosure-event-q4-development-benchmark.v9',
    developmentOnly: true,
    semantics: {
      exactMultiset: true,
      abstentionCountsAsWrong: true,
      unresolvedCountsAsWrong: true,
      confidenceIsScored: true,
    },
    hashes: {
      corpusSha256,
      oracleSha256: sha256(oracleBytes),
      extractorSha256,
      adjudicationEvidenceSha256,
      ontologyManifestSha256: KR_DISCLOSURE_EVENT_ONTOLOGY_HASH,
      thresholdsSha256: sha256(Buffer.from(JSON.stringify(thresholds))),
    },
    ontologyVersion: KR_DISCLOSURE_EVENT_ONTOLOGY_VERSION,
    extractorVersion: extractEventsGatedProjection(corpus.cases[0]?.input ?? {}).version,
    thresholds,
    assessment,
    failureCount: failures.length,
    failureBreakdown: failureBreakdown(failures),
    failures,
  };
}

async function main() {
  const report = await runQ4DevelopmentBenchmark({
    corpusPath: option('corpus', DEFAULT_CORPUS),
    oraclePath: option('oracle', DEFAULT_ORACLE),
  });
  const serialized = `${JSON.stringify(report, null, process.argv.includes('--json') ? 0 : 2)}\n`;
  const outputPath = option('output');
  if (outputPath) await writeFile(resolve(outputPath), serialized);
  process.stdout.write(serialized);
  if (!report.assessment.passed) process.exitCode = 1;
}

if (process.argv[1]
  && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]))) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  });
}
