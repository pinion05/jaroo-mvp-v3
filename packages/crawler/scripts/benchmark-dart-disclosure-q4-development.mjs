#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
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
const DEFAULT_CORPUS = resolve(
  ROOT,
  'test/artifacts/kr-disclosure-event-q4-2025q4-corpus.v1.json.gz',
);
const DEFAULT_ORACLE = resolve(
  ROOT,
  'test/artifacts/kr-disclosure-event-q4-development-oracle.v10.json',
);
const DEFAULT_EVIDENCE_MANIFEST = resolve(
  ROOT,
  'test/artifacts/kr-disclosure-event-q4-development-evidence-manifest.v1.json',
);
const EXTRACTOR_PATH = resolve(ROOT, 'src/services/deepscan-kr-disclosure-event-extractors.js');
const ONTOLOGY_PATH = resolve(ROOT, 'src/services/deepscan-kr-disclosure-event-ontology.js');
const Q4_RUNNER_PATH = fileURLToPath(import.meta.url);
const SCORING_EVALUATOR_PATH = resolve(ROOT, 'scripts/benchmark-dart-disclosure-temporal-holdout.mjs');

export const Q4_DEVELOPMENT_DEFAULT_PATHS = Object.freeze({
  corpus: DEFAULT_CORPUS,
  oracle: DEFAULT_ORACLE,
  evidenceManifest: DEFAULT_EVIDENCE_MANIFEST,
});

function option(name, fallback = null) {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function readArtifact(path) {
  const storedBytes = await readFile(path);
  const contentBytes = path.endsWith('.gz') ? gunzipSync(storedBytes) : storedBytes;
  return { storedBytes, contentBytes };
}

export async function hashQ4BenchmarkSources({
  q4RunnerPath = Q4_RUNNER_PATH,
  scoringEvaluatorPath = SCORING_EVALUATOR_PATH,
} = {}) {
  const [q4RunnerBytes, scoringEvaluatorBytes] = await Promise.all([
    readFile(q4RunnerPath),
    readFile(scoringEvaluatorPath),
  ]);
  return {
    q4RunnerSha256: sha256(q4RunnerBytes),
    scoringEvaluatorSha256: sha256(scoringEvaluatorBytes),
  };
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

async function validateEvidenceManifest({
  manifestPath,
  corpusSha256,
  oracleSha256,
  oracle,
  adjudicationEvidenceSha256,
}) {
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (manifest.schemaVersion !== 'jaroo.kr-disclosure-event-q4-development-evidence-manifest.v1'
    || manifest.developmentOnly !== true
    || manifest.claimEligible !== false
    || manifest.predictionBlind !== false) {
    fail('evidence manifest must be development-only, prediction-aware, and claim-ineligible');
  }
  if (manifest.sourceCorpusSha256 !== corpusSha256) {
    fail('evidence manifest sourceCorpusSha256 does not match corpus bytes');
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    fail('evidence manifest files must be nonempty');
  }

  const root = dirname(manifestPath);
  const realRoot = realpathSync(root);
  const byHash = new Map();
  const byRole = new Map();
  const parsedJson = [];
  const ids = new Set();
  for (const [index, entry] of manifest.files.entries()) {
    const label = `evidence manifest files[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify(['id', 'path', 'role', 'sha256'])) {
      fail(`${label} must have exactly id, path, role, and sha256`);
    }
    if (typeof entry.id !== 'string' || !entry.id || ids.has(entry.id)) fail(`${label}.id must be unique`);
    ids.add(entry.id);
    if (typeof entry.path !== 'string' || !entry.path || isAbsolute(entry.path)) {
      fail(`${label}.path must be a repository-relative artifact path`);
    }
    const absolute = resolve(root, entry.path);
    const fromRoot = relative(root, absolute);
    if (!fromRoot || fromRoot === '..' || fromRoot.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
      fail(`${label}.path escapes the evidence manifest directory`);
    }
    const realAbsolute = realpathSync(absolute);
    const realFromRoot = relative(realRoot, realAbsolute);
    if (!realFromRoot
      || realFromRoot === '..'
      || realFromRoot.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
      fail(`${label}.path escapes the evidence manifest directory through a symlink`);
    }
    if (!/^[a-f0-9]{64}$/.test(entry.sha256 ?? '')) fail(`${label}.sha256 must be lowercase SHA-256`);
    if (typeof entry.role !== 'string' || !entry.role) fail(`${label}.role must be nonempty`);
    const bytes = await readFile(realAbsolute);
    if (sha256(bytes) !== entry.sha256) fail(`${label} bytes do not match sha256`);
    if (byHash.has(entry.sha256)) fail(`${label}.sha256 duplicates another manifest entry`);
    byHash.set(entry.sha256, entry);
    const roleEntries = byRole.get(entry.role) ?? [];
    roleEntries.push(entry);
    byRole.set(entry.role, roleEntries);
    if (entry.path.endsWith('.json')) parsedJson.push({ entry, value: JSON.parse(bytes.toString('utf8')) });
  }

  const requireHash = (value, label) => {
    if (!byHash.has(value)) fail(`${label} is missing from the evidence manifest`);
  };
  const requireUniqueRole = (role) => {
    const entries = byRole.get(role) ?? [];
    if (entries.length !== 1) fail(`evidence manifest must contain exactly one ${role}`);
    return entries[0];
  };
  const finalOracle = requireUniqueRole('final-oracle');
  if (finalOracle.sha256 !== oracleSha256) fail('final-oracle role does not match the evaluated oracle');
  const sourceExtractor = requireUniqueRole('oracle-source-extractor');
  if (sourceExtractor.sha256 !== oracle.sourceExtractorSha256) {
    fail('oracle-source-extractor role does not match oracle sourceExtractorSha256');
  }
  requireHash(oracleSha256, 'final oracle hash');
  requireHash(adjudicationEvidenceSha256, 'final adjudication evidence hash');
  requireHash(oracle.sourceExtractorSha256, 'oracle sourceExtractorSha256');
  if (oracle.predecessorOracleSha256) requireHash(oracle.predecessorOracleSha256, 'oracle predecessor hash');
  for (const [index, report] of (oracle.sourceReports ?? []).entries()) {
    if (report && typeof report === 'object' && report.sha256) {
      requireHash(report.sha256, `oracle sourceReports[${index}] hash`);
    } else if (report === 'q4-77-independent-adjudication-v1'
      && (byRole.get('initial-adjudication-report')?.length ?? 0) !== 1) {
      fail('oracle q4-77 adjudication report is missing from the evidence manifest');
    }
  }
  for (const { entry, value } of parsedJson) {
    for (const [index, source] of (value.sourceFiles ?? []).entries()) {
      requireHash(source?.sha256, `${entry.id}.sourceFiles[${index}] hash`);
    }
    for (const [sourcePath, sourceHash] of Object.entries(value.inputSha256 ?? {})) {
      if (sourceHash !== corpusSha256 && !byHash.has(sourceHash)) {
        fail(`${entry.id}.inputSha256[${sourcePath}] is missing from the evidence manifest`);
      }
    }
    if (value.predecessorOracleSha256) {
      requireHash(value.predecessorOracleSha256, `${entry.id}.predecessorOracleSha256`);
    }
    if (value.adjudicationEvidenceSha256) {
      requireHash(value.adjudicationEvidenceSha256, `${entry.id}.adjudicationEvidenceSha256`);
    }
  }
  return {
    manifest,
    manifestSha256: sha256(manifestBytes),
  };
}

function validateOracle({ corpus, corpusSha256, oracle, oraclePath }) {
  if (oracle.schemaVersion !== 'jaroo.kr-disclosure-event-development-oracle.v10') {
    fail('oracle schemaVersion must be jaroo.kr-disclosure-event-development-oracle.v10');
  }
  if (oracle.developmentOnly !== true) fail('oracle must be explicitly developmentOnly');
  if (oracle.sourceCorpusSha256 !== corpusSha256) fail('oracle sourceCorpusSha256 does not match corpus bytes');
  if (!/^[a-f0-9]{64}$/.test(oracle.sourceExtractorSha256 ?? '')) {
    fail('oracle sourceExtractorSha256 must be a SHA-256 provenance hash');
  }
  if (oracle.ontologyVersion !== KR_DISCLOSURE_EVENT_ONTOLOGY_VERSION
    || oracle.ontologyManifestSha256 !== KR_DISCLOSURE_EVENT_ONTOLOGY_HASH) {
    fail('oracle ontology provenance does not match the evaluated ontology');
  }
  if (!Array.isArray(corpus.cases) || corpus.cases.length === 0) fail('corpus cases must be nonempty');
  if (!Array.isArray(oracle.cases) || oracle.cases.length !== corpus.cases.length) {
    fail('oracle cases must align one-to-one with corpus cases');
  }
  const unscorableIndices = [];
  for (const [index, oracleCase] of oracle.cases.entries()) {
    if (oracleCase.index !== index) fail(`oracle case ${index} has a noncanonical index`);
    if (!Array.isArray(oracleCase.expectedEvents)) fail(`oracle case ${index} expectedEvents must be an array`);
    if (!['canonical-events-present', 'no-canonical-events', 'unscorable'].includes(oracleCase.goldDisposition)) {
      fail(`oracle case ${index} goldDisposition is invalid`);
    }
    if (oracleCase.goldDisposition === 'canonical-events-present' && oracleCase.expectedEvents.length === 0) {
      fail(`oracle case ${index} canonical-events-present requires expectedEvents`);
    }
    if (['no-canonical-events', 'unscorable'].includes(oracleCase.goldDisposition)
      && oracleCase.expectedEvents.length !== 0) {
      fail(`oracle case ${index} ${oracleCase.goldDisposition} requires empty expectedEvents`);
    }
    if (oracleCase.goldDisposition === 'unscorable') {
      const corpusCase = corpus.cases[index] ?? {};
      if (corpusCase.input?.bodyText || !(corpusCase.fetchFailures?.length > 0)) {
        fail(`oracle case ${index} unscorable requires missing body text and document fetch failures`);
      }
      unscorableIndices.push(index);
    }
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
  const expectedUnscorable = oracle.summary?.unscorableIndices ?? [];
  if (JSON.stringify(expectedUnscorable) !== JSON.stringify(unscorableIndices)
    || oracle.summary?.unscorableCaseCount !== unscorableIndices.length
    || oracle.summary?.scorableCaseCount !== oracle.cases.length - unscorableIndices.length) {
    fail('oracle summary scorable/unscorable counts do not match case dispositions');
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
    goldDisposition: oracleCase.goldDisposition,
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
  evidenceManifestPath = DEFAULT_EVIDENCE_MANIFEST,
  thresholds = STRICT_THRESHOLDS,
} = {}) {
  const absoluteCorpusPath = resolve(corpusPath);
  const absoluteOraclePath = resolve(oraclePath);
  const [corpusArtifact, oracleArtifact, extractorBytes, ontologyBytes, benchmarkSourceHashes] = await Promise.all([
    readArtifact(absoluteCorpusPath),
    readArtifact(absoluteOraclePath),
    readFile(EXTRACTOR_PATH),
    readFile(ONTOLOGY_PATH),
    hashQ4BenchmarkSources(),
  ]);
  const corpusBytes = corpusArtifact.contentBytes;
  const oracleBytes = oracleArtifact.contentBytes;
  const corpus = JSON.parse(corpusBytes.toString('utf8'));
  const oracle = JSON.parse(oracleBytes.toString('utf8'));
  const corpusSha256 = sha256(corpusBytes);
  const extractorSha256 = sha256(extractorBytes);
  const evidencePath = validateOracle({
    corpus,
    corpusSha256,
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
  const evidenceManifest = await validateEvidenceManifest({
    manifestPath: resolve(evidenceManifestPath),
    corpusSha256,
    oracleSha256: sha256(oracleBytes),
    oracle,
    adjudicationEvidenceSha256,
  });

  const failures = [];
  const evaluations = [];
  const unscorableCases = [];
  for (const [index, corpusCase] of corpus.cases.entries()) {
    const input = corpusCase.input ?? {};
    const prediction = extractEventsGatedProjection(input);
    const oracleCase = oracle.cases[index];
    if (oracleCase.goldDisposition === 'unscorable') {
      unscorableCases.push({
        index,
        rceptNo: input.rceptNo ?? null,
        reportName: input.reportName ?? null,
        disclosureDetailType: input.disclosureDetailType ?? null,
        fetchFailures: corpusCase.fetchFailures ?? [],
        predictionDisposition: prediction.disposition,
        predictedEvents: prediction.events,
      });
      continue;
    }
    const evaluated = evaluateTemporalHoldoutCase(
      fixtureCase(corpusCase, oracleCase, index),
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
        expectedEvents: oracleCase.expectedEvents,
        predictedEvents: prediction.events,
        eventEvidence: prediction.eventEvidence,
      });
    }
    evaluations.push(evaluated);
  }
  const assessment = assessTemporalHoldoutThresholds(evaluations, thresholds);
  return {
    schemaVersion: 'jaroo.kr-disclosure-event-q4-development-benchmark.v12',
    developmentOnly: true,
    claimEligible: evidenceManifest.manifest.claimEligible,
    gateScope: 'development-regression-only',
    predictionBlind: evidenceManifest.manifest.predictionBlind,
    semantics: {
      exactMultiset: true,
      abstentionCountsAsWrong: true,
      unresolvedCountsAsWrong: true,
      explicitNoCanonicalEventCanBeCorrect: true,
      sourceRetrievalFailuresCanBeUnscorable: true,
      unscorableCasesExcludedFromPerformanceMetrics: true,
      confidenceIsScored: true,
    },
    hashes: {
      corpusSha256,
      corpusStoredSha256: sha256(corpusArtifact.storedBytes),
      oracleSha256: sha256(oracleBytes),
      oracleStoredSha256: sha256(oracleArtifact.storedBytes),
      extractorSha256,
      adjudicationEvidenceSha256,
      evidenceManifestSha256: evidenceManifest.manifestSha256,
      ontologyManifestSha256: KR_DISCLOSURE_EVENT_ONTOLOGY_HASH,
      ontologySourceSha256: sha256(ontologyBytes),
      thresholdsSha256: sha256(Buffer.from(JSON.stringify(thresholds))),
      ...benchmarkSourceHashes,
    },
    oracleProvenance: {
      sourceCorpusSha256: oracle.sourceCorpusSha256,
      sourceExtractorSha256: oracle.sourceExtractorSha256,
      ontologyVersion: oracle.ontologyVersion,
      ontologyManifestSha256: oracle.ontologyManifestSha256,
    },
    ontologyVersion: KR_DISCLOSURE_EVENT_ONTOLOGY_VERSION,
    extractorVersion: extractEventsGatedProjection(corpus.cases[0]?.input ?? {}).version,
    thresholds,
    assessment,
    populationCaseCount: corpus.cases.length,
    scorableCaseCount: evaluations.length,
    unscorableCount: unscorableCases.length,
    unscorableCases,
    failureCount: failures.length,
    failureBreakdown: failureBreakdown(failures),
    failures,
  };
}

async function main() {
  const report = await runQ4DevelopmentBenchmark({
    corpusPath: option('corpus', DEFAULT_CORPUS),
    oraclePath: option('oracle', DEFAULT_ORACLE),
    evidenceManifestPath: option('evidence-manifest', DEFAULT_EVIDENCE_MANIFEST),
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
