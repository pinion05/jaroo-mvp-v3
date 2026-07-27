const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const { copyFile, cp, mkdtemp, readFile, rm, symlink, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { basename, join, relative, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');

const PACKAGE_ROOT = resolve(__dirname, '..');
const REPOSITORY_ROOT = resolve(PACKAGE_ROOT, '../..');
const RUNNER = resolve(PACKAGE_ROOT, 'scripts/benchmark-dart-disclosure-q4-development.mjs');
const ARTIFACTS = resolve(__dirname, 'artifacts');
const DEFAULT_CORPUS = resolve(ARTIFACTS, 'kr-disclosure-event-q4-2025q4-corpus.v1.json.gz');
const DEFAULT_ORACLE = resolve(ARTIFACTS, 'kr-disclosure-event-q4-development-oracle.v10.json');
const DEFAULT_EVIDENCE = resolve(ARTIFACTS, 'dart-event-q4-400-residual-adjudication-iteration9.json');
const DEFAULT_EVIDENCE_MANIFEST = resolve(
  ARTIFACTS,
  'kr-disclosure-event-q4-development-evidence-manifest.v1.json',
);
const SCORING_EVALUATOR = resolve(PACKAGE_ROOT, 'scripts/benchmark-dart-disclosure-temporal-holdout.mjs');

async function loadRunner() {
  return import(pathToFileURL(RUNNER).href);
}

test('Q4 benchmark defaults are repository-contained tracked artifacts', async () => {
  const { Q4_DEVELOPMENT_DEFAULT_PATHS } = await loadRunner();
  assert.deepEqual(Q4_DEVELOPMENT_DEFAULT_PATHS, {
    corpus: DEFAULT_CORPUS,
    oracle: DEFAULT_ORACLE,
    evidenceManifest: DEFAULT_EVIDENCE_MANIFEST,
  });
  assert.ok(!JSON.stringify(Q4_DEVELOPMENT_DEFAULT_PATHS).includes('.omx'));
  for (const artifact of [
    DEFAULT_CORPUS,
    DEFAULT_ORACLE,
    DEFAULT_EVIDENCE,
    DEFAULT_EVIDENCE_MANIFEST,
  ]) {
    await readFile(artifact);
    assert.doesNotThrow(() => execFileSync('git', [
      'ls-files',
      '--error-unmatch',
      relative(REPOSITORY_ROOT, artifact),
    ], {
      cwd: REPOSITORY_ROOT,
    }));
  }
});

test('Q4 benchmark runs from the committed git archive without dirty or untracked state', async (t) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'jaroo-q4-clean-checkout-'));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const archive = execFileSync('git', ['archive', '--format=tar', 'HEAD'], {
    cwd: REPOSITORY_ROOT,
    encoding: null,
    maxBuffer: 50 * 1024 * 1024,
  });
  execFileSync('tar', ['-xf', '-', '-C', temporaryRoot], { input: archive });
  const cleanPackage = join(temporaryRoot, 'packages', 'crawler');
  const result = spawnSync(process.execPath, [
    join(cleanPackage, 'scripts', basename(RUNNER)),
    '--json',
  ], {
    cwd: cleanPackage,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.developmentOnly, true);
  assert.equal(report.claimEligible, false);
  assert.equal(report.gateScope, 'development-regression-only');
  assert.equal(report.predictionBlind, false);
  assert.equal(report.populationCaseCount, 400);
  assert.equal(report.scorableCaseCount, 397);
  assert.equal(report.unscorableCount, 3);
  assert.equal(report.assessment.metrics.total, 397);
  assert.equal(report.assessment.metrics.exactCount, 397);
  assert.equal(report.assessment.metrics.highConfidenceCount, 39);
  assert.equal(report.assessment.metrics.highConfidenceIssuerCount, 33);
  assert.equal(report.assessment.metrics.highConfidenceTemplateCount, 22);
  assert.equal(report.failureCount, 0);
  assert.deepEqual(report.failures, []);
  assert.equal(report.assessment.passed, true);
  assert.equal(report.hashes.corpusSha256, '37472b36b474c60280da57928da1c647161c839e4e16c8318f8668999956dc4c');
  assert.equal(report.hashes.oracleSha256, '7b2d53e1689bb02326cda16bd621ab11598ae56b2e82af61350d7e76e981ac40');
  assert.equal(report.hashes.adjudicationEvidenceSha256, 'b83bc9744a70dfada8f5e972a0f9b81b5043f4fb589b9e7e885f5b5bd1081ada');
  assert.match(report.hashes.evidenceManifestSha256, /^[a-f0-9]{64}$/);
  assert.match(report.oracleProvenance.sourceExtractorSha256, /^[a-f0-9]{64}$/);
  assert.match(report.hashes.extractorSha256, /^[a-f0-9]{64}$/);
  assert.match(report.hashes.q4RunnerSha256, /^[a-f0-9]{64}$/);
  assert.match(report.hashes.scoringEvaluatorSha256, /^[a-f0-9]{64}$/);
});

test('Q4 provenance detects a scoring evaluator source mutation', async (t) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'jaroo-q4-evaluator-hash-'));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const mutatedEvaluator = join(temporaryRoot, basename(SCORING_EVALUATOR));
  await copyFile(SCORING_EVALUATOR, mutatedEvaluator);
  const { hashQ4BenchmarkSources } = await loadRunner();
  const original = await hashQ4BenchmarkSources();
  await writeFile(mutatedEvaluator, `${await readFile(mutatedEvaluator, 'utf8')}\n// provenance mutation\n`);
  const mutated = await hashQ4BenchmarkSources({ scoringEvaluatorPath: mutatedEvaluator });
  assert.notEqual(mutated.scoringEvaluatorSha256, original.scoringEvaluatorSha256);
  assert.equal(mutated.q4RunnerSha256, original.q4RunnerSha256);
});

async function copiedArtifacts(t, prefix) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const copied = join(temporaryRoot, 'artifacts');
  await cp(ARTIFACTS, copied, { recursive: true });
  return copied;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function rewriteOracleAndManifest(artifacts, mutate) {
  const oraclePath = join(artifacts, 'kr-disclosure-event-q4-development-oracle.v10.json');
  const manifestPath = join(artifacts, 'kr-disclosure-event-q4-development-evidence-manifest.v1.json');
  const oracle = JSON.parse(await readFile(oraclePath, 'utf8'));
  mutate(oracle);
  await writeFile(oraclePath, `${JSON.stringify(oracle, null, 2)}\n`);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.files.find((entry) => entry.role === 'final-oracle').sha256 = sha256(await readFile(oraclePath));
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifestPath, oraclePath };
}

test('Q4 oracle rejects unknown schemas and unbound extractor provenance', async (t) => {
  const runner = await loadRunner();
  const schemaArtifacts = await copiedArtifacts(t, 'jaroo-q4-schema-');
  const schemaPaths = await rewriteOracleAndManifest(schemaArtifacts, (oracle) => {
    oracle.schemaVersion = 'attacker.unknown-oracle.v999';
  });
  await assert.rejects(
    runner.runQ4DevelopmentBenchmark({
      corpusPath: join(schemaArtifacts, 'kr-disclosure-event-q4-2025q4-corpus.v1.json.gz'),
      oraclePath: schemaPaths.oraclePath,
      evidenceManifestPath: schemaPaths.manifestPath,
    }),
    /oracle schemaVersion must be/,
  );

  const provenanceArtifacts = await copiedArtifacts(t, 'jaroo-q4-provenance-');
  const provenancePaths = await rewriteOracleAndManifest(provenanceArtifacts, (oracle) => {
    oracle.sourceExtractorSha256 = '0'.repeat(64);
  });
  await assert.rejects(
    runner.runQ4DevelopmentBenchmark({
      corpusPath: join(provenanceArtifacts, 'kr-disclosure-event-q4-2025q4-corpus.v1.json.gz'),
      oraclePath: provenancePaths.oraclePath,
      evidenceManifestPath: provenancePaths.manifestPath,
    }),
    /oracle-source-extractor role does not match/,
  );
});

test('Q4 oracle cannot exclude arbitrary missing-body cases from the scoring denominator', async (t) => {
  const runner = await loadRunner();
  const artifacts = await copiedArtifacts(t, 'jaroo-q4-unscorable-');
  const paths = await rewriteOracleAndManifest(artifacts, (oracle) => {
    const manipulatedIndex = 35;
    oracle.cases[manipulatedIndex].expectedEvents = [];
    oracle.cases[manipulatedIndex].goldDisposition = 'unscorable';
    oracle.summary.unscorableIndices = [...oracle.summary.unscorableIndices, manipulatedIndex]
      .sort((left, right) => left - right);
    oracle.summary.unscorableCaseCount += 1;
    oracle.summary.scorableCaseCount -= 1;
  });
  await assert.rejects(
    runner.runQ4DevelopmentBenchmark({
      corpusPath: join(artifacts, 'kr-disclosure-event-q4-2025q4-corpus.v1.json.gz'),
      oraclePath: paths.oraclePath,
      evidenceManifestPath: paths.manifestPath,
    }),
    /unscorable is restricted to generic C004 prospectus resource-limit failures/,
  );
});

test('Q4 evidence manifest rejects symlink escapes', async (t) => {
  const runner = await loadRunner();
  const artifacts = await copiedArtifacts(t, 'jaroo-q4-symlink-');
  const manifestPath = join(artifacts, 'kr-disclosure-event-q4-development-evidence-manifest.v1.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const entry = manifest.files.find((item) => item.role === 'initial-qualitative-review');
  const evidencePath = join(artifacts, entry.path);
  const outsidePath = join(artifacts, '..', 'outside-evidence.json');
  await copyFile(evidencePath, outsidePath);
  await rm(evidencePath);
  await symlink(outsidePath, evidencePath);

  await assert.rejects(
    runner.runQ4DevelopmentBenchmark({
      corpusPath: join(artifacts, 'kr-disclosure-event-q4-2025q4-corpus.v1.json.gz'),
      oraclePath: join(artifacts, 'kr-disclosure-event-q4-development-oracle.v10.json'),
      evidenceManifestPath: manifestPath,
    }),
    /escapes the evidence manifest directory through a symlink/,
  );
});
