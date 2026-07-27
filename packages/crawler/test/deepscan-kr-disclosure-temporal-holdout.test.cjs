const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { mkdtemp, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const BENCHMARK = join(__dirname, '..', 'scripts', 'benchmark-dart-disclosure-temporal-holdout.mjs');
const COLLECTOR = join(__dirname, '..', 'scripts', 'collect-dart-disclosure-temporal-holdout.mjs');
const FREEZER = join(__dirname, '..', 'scripts', 'freeze-dart-disclosure-temporal-candidate.mjs');
const EXTRACTOR = join(__dirname, '..', 'src', 'services', 'deepscan-kr-disclosure-event-extractors.js');
const ONTOLOGY = join(__dirname, '..', 'src', 'services', 'deepscan-kr-disclosure-event-ontology.js');
const PROTOCOL = join(__dirname, '..', 'src', 'services', 'deepscan-kr-disclosure-temporal-protocol.js');
const ONTOLOGY_VERSION = 'jaroo.kr-disclosure-event-ontology.v1';
const ONTOLOGY_HASH = '9546959673fb62c9264af038e59ad52a8dbb3fea3fc0f1f2c77f05169dbf7237';
const STRICT_THRESHOLDS = Object.freeze({
  total: 40,
  issuerCount: 20,
  templateCount: 15,
  exactMultisetAccuracy: 0.9,
  exactMultisetWilsonLower: 0.75,
  resolvedCoverage: 0.85,
  fieldAccuracy: 0.95,
  templateMacroAccuracy: 0.8,
  highConfidenceExactPrecision: 0.95,
  highConfidenceWilsonLower: 0.7,
  highConfidenceCoverage: 0.35,
  brierScore: 0.15,
});
const GIT_HEAD = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: join(__dirname, '..', '..', '..'), encoding: 'utf8' }).trim();
const GIT_COMMITTED_AT = new Date(execFileSync(
  'git', ['show', '-s', '--format=%cI', GIT_HEAD],
  { cwd: join(__dirname, '..', '..', '..'), encoding: 'utf8' },
).trim()).toISOString();
const GOLD = Object.freeze({
  type: 'capital-change',
  action: 'decided',
  state: 'proposed',
  cause: 'rights-offering',
  subjectType: 'securities',
});

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function canonicalSha256(value) {
  return sha256(JSON.stringify(canonicalize(value)));
}

function selectionCommitment(seed = 'frozen-seed') {
  return sha256(`jaroo-temporal-holdout-selection-seed-v1\0${seed}`);
}

function seoulDate(value) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  return `${parts.year}${parts.month}${parts.day}`;
}

function nextDate(value) {
  const date = new Date(Date.UTC(
    Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8)) + 1,
  ));
  return date.toISOString().slice(0, 10).replaceAll('-', '');
}

const FREEZE_CUTOFF = seoulDate(GIT_COMMITTED_AT);
const FIRST_ELIGIBLE_DATE = nextDate(FREEZE_CUTOFF);
const TEST_EXCLUSION = Object.freeze({ sha256: 'c'.repeat(64), receipts: new Set(['prior-receipt']) });
const TEST_EXCLUDED_RECEIPTS_SHA256 = canonicalSha256([...TEST_EXCLUSION.receipts].sort());

function candidateFreezeEnvelope() {
  const components = {
    extractorSha256: sha256(readFileSync(EXTRACTOR)),
    ontologySourceSha256: sha256(readFileSync(ONTOLOGY)),
    protocolSha256: sha256(readFileSync(PROTOCOL)),
    collectorSha256: sha256(readFileSync(COLLECTOR)),
    ontologyVersion: ONTOLOGY_VERSION,
    ontologyManifestSha256: ONTOLOGY_HASH,
    evaluatorSha256: sha256(readFileSync(BENCHMARK)),
    thresholdsSha256: sha256(JSON.stringify(STRICT_THRESHOLDS)),
  };
  const manifest = {
    schemaVersion: 'jaroo.kr-disclosure-event-candidate-freeze.v1',
    createdAt: GIT_COMMITTED_AT,
    timeZone: 'Asia/Seoul',
    cutoff: FREEZE_CUTOFF,
    firstEligibleFilingDate: FIRST_ELIGIBLE_DATE,
    sampling: {
      selectionSeedCommitment: selectionCommitment(),
      exclusionManifestSha256: TEST_EXCLUSION.sha256,
      excludedReceiptCount: TEST_EXCLUSION.receipts.size,
      excludedReceiptsSha256: TEST_EXCLUDED_RECEIPTS_SHA256,
    },
    candidate: { ...components, bundleSha256: canonicalSha256(components) },
    repository: { gitHead: GIT_HEAD, gitCommittedAt: GIT_COMMITTED_AT },
  };
  const bytes = `${JSON.stringify(manifest, null, 2)}\n`;
  return {
    manifestFileSha256: sha256(bytes),
    manifestCanonicalSha256: canonicalSha256(manifest),
    manifest,
  };
}

function fixtureCase(index, overrides = {}) {
  const bodyText = overrides.bodyText ?? `synthetic filing body ${index}`;
  const expectedEvents = overrides.expectedEvents ?? [GOLD];
  const input = {
    rceptNo: String(20270101000000 + index),
    receiptDate: '2027-01-01',
    issuer: `issuer-${index % 20}`,
    title: `template-${index % 15}`,
    body: bodyText,
    ...(overrides.input ?? {}),
  };
  return {
    id: `case-${index}`,
    labelStatus: 'adjudicated',
    templateKey: `template-${index % 15}`,
    source: {
      corpClass: 'Y',
      corpCode: `corp-${index % 20}`,
      retainedSha256: createHash('sha256').update(bodyText).digest('hex'),
    },
    expectedEvents,
    annotations: overrides.annotations ?? [
      { annotator: 'reviewer-a', blindedToPrediction: true, confidenceInLabel: 'high', expectedEvents },
      { annotator: 'reviewer-b', blindedToPrediction: true, confidenceInLabel: 'high', expectedEvents },
    ],
    adjudication: overrides.adjudication ?? {
      adjudicator: 'reviewer-c',
      decision: 'agreement',
      blindedToPrediction: true,
      rationale: 'independent labels match',
      expectedEvents,
    },
    ...overrides,
    input,
  };
}

function fixture(cases) {
  const retainedBodyCharCount = cases.reduce((total, item) => total + [...item.input.body].length, 0);
  return {
    schemaVersion: 'jaroo.kr-disclosure-event-temporal-holdout.v1',
    role: 'sealed-temporal-holdout',
    labelStatus: 'adjudicated',
    ontologyVersion: ONTOLOGY_VERSION,
    ontologyHash: ONTOLOGY_HASH,
    cutoff: FREEZE_CUTOFF,
    candidateFreeze: candidateFreezeEnvelope(),
    audit: {
      independentClaimEligible: true,
      predictionsHiddenUntilAdjudication: true,
      unlabeledCorpusSha256: 'a'.repeat(64),
      annotationManifestSha256: 'b'.repeat(64),
    },
    query: {
      from: '2027-01-01',
      to: '2027-01-31',
      cutoff: FREEZE_CUTOFF,
      corpClass: 'Y',
      selectionSeedCommitment: selectionCommitment(),
      exclusionManifestSha256: TEST_EXCLUSION.sha256,
      excludedReceiptCount: TEST_EXCLUSION.receipts.size,
      excludedReceiptsSha256: TEST_EXCLUDED_RECEIPTS_SHA256,
    },
    summary: {
      selectedCount: cases.length,
      caseCount: cases.length,
      uniqueIssuerCount: new Set(cases.map((item) => item.source.corpCode)).size,
      uniqueTitleTemplateCount: new Set(cases.map((item) => item.templateKey)).size,
      truncatedBodyCount: 0,
      retainedBodyCharCount,
      agreementCaseCount: cases.filter((item) => item.adjudication.decision === 'agreement').length,
      dualAdjudicatorResolutionCount: 0,
      finalAdjudicatorResolutionCount: 0,
      documentFailureCount: 0,
    },
    cases,
  };
}

test('rejects a fixture with malformed canonical gold event keys', async () => {
  const benchmark = await import(pathToFileURL(BENCHMARK));
  const invalid = fixture([fixtureCase(1, { expectedEvents: [{ ...GOLD, explanation: 'not canonical' }] })]);
  assert.throws(() => benchmark.validateTemporalHoldoutFixture(invalid), /exactly the five canonical keys/);
});

test('pins the fixture and predictions to the frozen ontology manifest', async () => {
  const benchmark = await import(pathToFileURL(BENCHMARK));
  const wrongVersion = { ...fixture([fixtureCase(1)]), ontologyVersion: 'jaroo.kr-disclosure-event-ontology.v0' };
  assert.throws(() => benchmark.validateTemporalHoldoutFixture(wrongVersion), /ontologyVersion must equal/);

  const wrongHash = { ...fixture([fixtureCase(2)]), ontologyHash: '0'.repeat(64) };
  assert.throws(() => benchmark.validateTemporalHoldoutFixture(wrongHash), /ontologyHash must equal/);

  const alias = {
    type: 'capital-change', action: 'decided', state: 'proposed',
    cause: 'conditional-capital-security', subjectType: 'securities',
  };
  assert.throws(
    () => benchmark.validateTemporalHoldoutFixture(fixture([fixtureCase(3, { expectedEvents: [alias] })])),
    /canonical ontology vocabulary rather than an alias/,
  );
  assert.throws(
    () => benchmark.evaluateTemporalHoldoutCase(fixtureCase(4), { events: [alias], confidence: 'high' }),
    /noncanonical ontology alias/,
  );
});

test('requires two distinct prediction-blinded annotations and adjudication', async () => {
  const benchmark = await import(pathToFileURL(BENCHMARK));
  const invalid = fixtureCase(1, {
    annotations: [{ annotator: 'reviewer-a', blindedToPrediction: true, expectedEvents: [GOLD] }],
  });
  assert.throws(() => benchmark.validateTemporalHoldoutFixture(fixture([invalid])), /at least two independent labels/);

  const unblinded = fixtureCase(2, {
    annotations: [
      { annotator: 'reviewer-a', blindedToPrediction: false, confidenceInLabel: 'high', expectedEvents: [GOLD] },
      { annotator: 'reviewer-b', blindedToPrediction: true, confidenceInLabel: 'high', expectedEvents: [GOLD] },
    ],
  });
  assert.throws(() => benchmark.validateTemporalHoldoutFixture(fixture([unblinded])), /blinded to prediction/);
});

test('allows null optional canonical fields in adjudicated gold', async () => {
  const benchmark = await import(pathToFileURL(BENCHMARK));
  const filed = { ...GOLD, action: 'filed', state: null };
  assert.doesNotThrow(() => benchmark.validateTemporalHoldoutFixture(fixture([
    fixtureCase(1, { expectedEvents: [filed] }),
  ])));
});

test('CLI exits 2 for an invalid fixture', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jaroo-holdout-'));
  const path = join(directory, 'invalid.json');
  await writeFile(path, JSON.stringify({ schemaVersion: 'wrong', cases: [] }));
  try {
    assert.throws(
      () => execFileSync(process.execPath, [BENCHMARK, `--fixture=${path}`, '--json'], { encoding: 'utf8', stdio: 'pipe' }),
      (error) => error.status === 2,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('CLI exits 1 when a valid cohort fails the strict gate', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jaroo-holdout-'));
  const path = join(directory, 'under-sized.json');
  await writeFile(path, JSON.stringify(fixture([fixtureCase(1)])));
  try {
    assert.throws(
      () => execFileSync(process.execPath, [BENCHMARK, `--fixture=${path}`, '--json'], { encoding: 'utf8', stdio: 'pipe' }),
      (error) => error.status === 1,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('benchmark result records fixture, evaluator, extractor, and threshold hashes', async () => {
  const benchmark = await import(pathToFileURL(BENCHMARK));
  const directory = await mkdtemp(join(tmpdir(), 'jaroo-holdout-hashes-'));
  const path = join(directory, 'fixture.json');
  await writeFile(path, JSON.stringify(fixture([fixtureCase(1)])));
  try {
    const report = await benchmark.runTemporalHoldoutBenchmark({ fixturePath: path });
    assert.deepEqual(Object.keys(report.hashes).sort(), [
      'candidateFreezeManifestSha256', 'evaluatorSha256', 'extractorSha256', 'fixtureSha256',
      'ontologyManifestSha256', 'thresholdsSha256',
    ]);
    assert.equal(report.ontologyVersion, ONTOLOGY_VERSION);
    assert.equal(report.hashes.ontologyManifestSha256, ONTOLOGY_HASH);
    for (const hash of Object.values(report.hashes)) assert.match(hash, /^[a-f0-9]{64}$/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('unknown gate modes fail closed and a failed strict gate is never claim eligible', async () => {
  const benchmark = await import(pathToFileURL(BENCHMARK));
  const directory = await mkdtemp(join(tmpdir(), 'jaroo-holdout-mode-'));
  const path = join(directory, 'fixture.json');
  await writeFile(path, JSON.stringify(fixture([fixtureCase(1)])));
  try {
    await assert.rejects(
      benchmark.runTemporalHoldoutBenchmark({ fixturePath: path, gateMode: 'strcit' }),
      /gateMode must be strict or diagnostic/,
    );
    await assert.rejects(
      benchmark.runTemporalHoldoutBenchmark({ fixturePath: path, gateMode: 'diagnostic' }),
      /reserved for burned temporal development/,
    );
    const report = await benchmark.runTemporalHoldoutBenchmark({ fixturePath: path, gateMode: 'strict' });
    assert.equal(report.gate.passed, false);
    assert.equal(report.fixtureIndependentClaimEligible, true);
    assert.equal(report.independentClaimEligible, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('counts explicit abstention as incorrect and unresolved', async () => {
  const benchmark = await import(pathToFileURL(BENCHMARK));
  const result = benchmark.evaluateTemporalHoldoutCase(fixtureCase(1), {
    events: [GOLD], confidence: 'high', abstained: true,
  });
  assert.equal(result.exact, false);
  assert.equal(result.resolved, false);
});

test('all-low predictions fail high-confidence coverage', async () => {
  const benchmark = await import(pathToFileURL(BENCHMARK));
  const evaluations = Array.from({ length: 40 }, (_, index) => benchmark.evaluateTemporalHoldoutCase(
    fixtureCase(index + 1), { events: [GOLD], confidence: 'low' },
  ));
  const assessment = benchmark.assessTemporalHoldoutThresholds(evaluations);
  assert.equal(assessment.metrics.highConfidenceCoverage, 0);
  assert.equal(assessment.passed, false);
});

test('confidence probabilities reflect opt-in high confidence rather than optimistic defaults', async () => {
  const benchmark = await import(pathToFileURL(BENCHMARK));
  assert.deepEqual(benchmark.CONFIDENCE_PROBABILITIES, {
    low: 0.1,
    medium: 0.75,
    high: 0.95,
  });
});

test('burned temporal data is rejected by strict validation and allowed only for diagnostics', async () => {
  const benchmark = await import(pathToFileURL(BENCHMARK));
  const burned = fixture([fixtureCase(1)]);
  burned.role = 'burned-temporal-development';
  burned.audit = {
    independentClaimEligible: false,
    burnedReason: 'Predictions and adjudicated labels were inspected after the sealed run.',
    firstSealedFixtureSha256: 'a'.repeat(64),
    firstSealedResultSha256: 'b'.repeat(64),
  };

  assert.throws(
    () => benchmark.validateTemporalHoldoutFixture(burned),
    /cannot be used by the strict holdout gate/,
  );
  assert.doesNotThrow(() => benchmark.validateTemporalHoldoutFixture(burned, { allowBurned: true }));
});

test('post-burn ontology re-adjudication is explicit and never accepted in a sealed holdout', async () => {
  const benchmark = await import(pathToFileURL(BENCHMARK));
  const revised = { ...GOLD, cause: 'convertible-bond' };
  const revisedCase = fixtureCase(1, {
    developmentExpectedEvents: [revised],
    developmentReAdjudication: {
      predictionBlinded: false,
      reason: 'The burned run exposed an ontology boundary that was frozen before the next holdout.',
      previousExpectedEvents: [GOLD],
    },
  });
  const sealed = fixture([revisedCase]);
  assert.throws(
    () => benchmark.validateTemporalHoldoutFixture(sealed),
    /developmentExpectedEvents are forbidden in a sealed holdout/,
  );

  const burned = fixture([revisedCase]);
  burned.role = 'burned-temporal-development';
  burned.audit = {
    independentClaimEligible: false,
    burnedReason: 'Predictions and labels were inspected.',
    firstSealedFixtureSha256: 'a'.repeat(64),
    firstSealedResultSha256: 'b'.repeat(64),
  };
  burned.summary.developmentReAdjudicationCount = 1;
  const validated = benchmark.validateTemporalHoldoutFixture(burned, { allowBurned: true });
  const evaluation = benchmark.evaluateTemporalHoldoutCase(validated.cases[0], {
    events: [revised], confidence: 'medium',
  }, { allowDevelopmentGold: true });
  assert.equal(evaluation.exact, true);
  assert.equal(evaluation.goldSource, 'post-burn-development');
});

test('confident wrong predictions fail precision and calibration metrics', async () => {
  const benchmark = await import(pathToFileURL(BENCHMARK));
  const wrong = { ...GOLD, cause: 'convertible-bond' };
  const evaluations = Array.from({ length: 40 }, (_, index) => benchmark.evaluateTemporalHoldoutCase(
    fixtureCase(index + 1), { events: [wrong], confidence: 'high' },
  ));
  const assessment = benchmark.assessTemporalHoldoutThresholds(evaluations);
  assert.equal(assessment.metrics.highConfidenceExactPrecision, 0);
  assert.ok(assessment.metrics.brierScore > 0.15);
  assert.ok(assessment.metrics.expectedCalibrationError > 0.9);
  assert.equal(assessment.passed, false);
});

test('rejects duplicate receipt numbers', async () => {
  const benchmark = await import(pathToFileURL(BENCHMARK));
  const first = fixtureCase(1);
  const second = fixtureCase(2, { input: { rceptNo: first.input.rceptNo } });
  assert.throws(() => benchmark.validateTemporalHoldoutFixture(fixture([first, second])), /duplicate receipt/);
});

test('rejects filing dates on or before the cutoff', async () => {
  const benchmark = await import(pathToFileURL(BENCHMARK));
  const before = fixtureCase(1, { input: { receiptDate: FREEZE_CUTOFF } });
  assert.throws(() => benchmark.validateTemporalHoldoutFixture(fixture([before])), /strictly after cutoff/);
});

test('rejects duplicate case ids, out-of-window dates, and inconsistent template keys', async () => {
  const benchmark = await import(pathToFileURL(BENCHMARK));
  const first = fixtureCase(1);
  const duplicateId = fixtureCase(2, { id: first.id });
  assert.throws(() => benchmark.validateTemporalHoldoutFixture(fixture([first, duplicateId])), /duplicate case id/);

  const outside = fixtureCase(3, { input: { receiptDate: '2027-02-01' } });
  assert.throws(() => benchmark.validateTemporalHoldoutFixture(fixture([outside])), /within query\.from and query\.to/);

  const wrongTemplate = fixtureCase(4, { templateKey: 'not-normalized-title' });
  assert.throws(() => benchmark.validateTemporalHoldoutFixture(fixture([wrongTemplate])), /normalized disclosure title/);
});

test('rejects inconsistent cutoff and query ranges beyond provider boundaries', async () => {
  const benchmark = await import(pathToFileURL(BENCHMARK));
  const inconsistent = fixture([fixtureCase(1)]);
  inconsistent.cutoff = '2026-12-30';
  assert.throws(
    () => benchmark.validateTemporalHoldoutFixture(inconsistent),
    /candidate freeze cutoff must equal fixture cutoff|cutoff must equal query\.cutoff/,
  );
  const excessive = fixture([fixtureCase(2)]);
  excessive.query.to = '2027-05-01';
  assert.throws(() => benchmark.validateTemporalHoldoutFixture(excessive), /cannot exceed 92 days/);
});

test('requires adjudicated label status, confidence enums, and independent adjudicators', async () => {
  const benchmark = await import(pathToFileURL(BENCHMARK));
  assert.throws(
    () => benchmark.validateTemporalHoldoutFixture({ ...fixture([fixtureCase(1)]), labelStatus: 'unlabeled' }),
    /fixture labelStatus must be adjudicated/,
  );
  const invalidConfidence = fixtureCase(2);
  invalidConfidence.annotations[0].confidenceInLabel = 'certain';
  assert.throws(() => benchmark.validateTemporalHoldoutFixture(fixture([invalidConfidence])), /low, medium, or high/);
  const reused = fixtureCase(3, {
    adjudication: {
      adjudicator: 'reviewer-a', decision: 'agreement', blindedToPrediction: true,
      rationale: 'same person', expectedEvents: [GOLD],
    },
  });
  assert.throws(() => benchmark.validateTemporalHoldoutFixture(fixture([reused])), /independent from annotators/);
});

test('requires adjudication events to exactly equal gold for agreement and resolution', async () => {
  const benchmark = await import(pathToFileURL(BENCHMARK));
  const wrong = { ...GOLD, cause: 'convertible-bond' };
  const agreement = fixtureCase(1);
  agreement.adjudication.expectedEvents = [wrong];
  assert.throws(() => benchmark.validateTemporalHoldoutFixture(fixture([agreement])), /exactly match case gold/);

  const resolved = fixtureCase(2, {
    annotations: [
      { annotator: 'reviewer-a', blindedToPrediction: true, confidenceInLabel: 'medium', expectedEvents: [GOLD] },
      { annotator: 'reviewer-b', blindedToPrediction: true, confidenceInLabel: 'medium', expectedEvents: [wrong] },
    ],
    adjudication: {
      adjudicator: 'reviewer-c', decision: 'resolved', blindedToPrediction: true,
      rationale: 'resolved disagreement', expectedEvents: [wrong],
    },
  });
  assert.throws(() => benchmark.validateTemporalHoldoutFixture(fixture([resolved])), /exactly match case gold/);
});

test('rejects excessive event cardinality and stale summary counts', async () => {
  const benchmark = await import(pathToFileURL(BENCHMARK));
  const tooMany = Array.from({ length: benchmark.MAX_EVENTS_PER_CASE + 1 }, () => ({ ...GOLD }));
  assert.throws(
    () => benchmark.validateTemporalHoldoutFixture(fixture([fixtureCase(1, { expectedEvents: tooMany })])),
    /exceeds the maximum/,
  );
  const stale = fixture([fixtureCase(2)]);
  stale.summary.caseCount = 99;
  assert.throws(() => benchmark.validateTemporalHoldoutFixture(stale), /summary\.caseCount/);
});

test('missing or invalid prediction confidence is a contract error', async () => {
  const benchmark = await import(pathToFileURL(BENCHMARK));
  assert.throws(
    () => benchmark.evaluateTemporalHoldoutCase(fixtureCase(1), { events: [GOLD] }),
    /prediction confidence/,
  );
  assert.throws(
    () => benchmark.evaluateTemporalHoldoutCase(fixtureCase(1), { events: [GOLD], confidence: 'certain' }),
    /prediction confidence/,
  );
});

test('collector requires a candidate freeze, exclusion manifest, and precommitted selection seed', async () => {
  const collector = await import(pathToFileURL(COLLECTOR));
  const base = {
    from: '2027-01-01',
    to: '2027-01-31',
    out: '/tmp/out.json',
    'candidate-freeze': '/tmp/freeze.json',
    'exclude-manifest': '/tmp/exclusions.json',
  };
  assert.throws(() => collector.validateOptions(base), /selection-seed.*required/);
  assert.throws(
    () => collector.validateOptions({ ...base, 'selection-seed': 'seed', 'candidate-freeze': '' }),
    /candidate-freeze.*required/,
  );
  assert.throws(
    () => collector.validateOptions({ ...base, 'selection-seed': 'seed', 'exclude-manifest': '' }),
    /exclude-manifest.*required/,
  );
  assert.doesNotThrow(() => collector.validateOptions({ ...base, 'selection-seed': 'seed' }));
});

test('collector derives cutoff from the frozen candidate and rejects same-day or mismatched seed collection', async () => {
  const collector = await import(pathToFileURL(COLLECTOR));
  const base = {
    from: '2027-01-01',
    to: '2027-01-31',
    out: '/tmp/out.json',
    'candidate-freeze': '/tmp/freeze.json',
    'exclude-manifest': '/tmp/exclusions.json',
    'selection-seed': 'frozen-seed',
  };
  const options = collector.validateOptions(base);
  const bound = collector.bindOptionsToCandidateFreeze(options, candidateFreezeEnvelope(), TEST_EXCLUSION);
  assert.equal(bound.cutoff, FREEZE_CUTOFF);

  const sameDay = collector.validateOptions({ ...base, from: FREEZE_CUTOFF, to: FREEZE_CUTOFF });
  assert.throws(
    () => collector.bindOptionsToCandidateFreeze(sameDay, candidateFreezeEnvelope(), TEST_EXCLUSION),
    /firstEligibleFilingDate/,
  );
  const wrongSeed = collector.validateOptions({ ...base, 'selection-seed': 'different-seed' });
  assert.throws(
    () => collector.bindOptionsToCandidateFreeze(wrongSeed, candidateFreezeEnvelope(), TEST_EXCLUSION),
    /selection seed does not match/,
  );
  const wrongExclusion = { sha256: 'd'.repeat(64), receipts: new Set(['prior-receipt']) };
  assert.throws(
    () => collector.bindOptionsToCandidateFreeze(options, candidateFreezeEnvelope(), wrongExclusion),
    /exclusion manifest bytes do not match/,
  );
});

test('sealed fixtures require a current candidate freeze and explicit independent audit chain', async () => {
  const benchmark = await import(pathToFileURL(BENCHMARK));
  const missingFreeze = fixture([fixtureCase(1)]);
  delete missingFreeze.candidateFreeze;
  assert.throws(() => benchmark.validateTemporalHoldoutFixture(missingFreeze), /candidateFreeze|candidate freeze/);

  const ineligible = fixture([fixtureCase(2)]);
  ineligible.audit.independentClaimEligible = false;
  assert.throws(() => benchmark.validateTemporalHoldoutFixture(ineligible), /independentClaimEligible=true/);

  const predictionLeak = fixture([fixtureCase(3)]);
  predictionLeak.audit.predictionsHiddenUntilAdjudication = false;
  assert.throws(() => benchmark.validateTemporalHoldoutFixture(predictionLeak), /predictionsHiddenUntilAdjudication=true/);

  const drifted = fixture([fixtureCase(4)]);
  drifted.candidateFreeze.manifest.candidate.extractorSha256 = 'f'.repeat(64);
  drifted.candidateFreeze.manifestCanonicalSha256 = canonicalSha256(drifted.candidateFreeze.manifest);
  drifted.candidateFreeze.manifestFileSha256 = sha256(`${JSON.stringify(drifted.candidateFreeze.manifest, null, 2)}\n`);
  assert.throws(() => benchmark.validateTemporalHoldoutFixture(drifted), /bundleSha256|frozen candidate/);

  const falseFileHash = fixture([fixtureCase(5)]);
  falseFileHash.candidateFreeze.manifestFileSha256 = '0'.repeat(64);
  assert.throws(() => benchmark.validateTemporalHoldoutFixture(falseFileHash), /file hash does not match/);

  const backdated = fixture([fixtureCase(6)]);
  backdated.candidateFreeze.manifest.createdAt = new Date(new Date(GIT_COMMITTED_AT).getTime() - 1_000).toISOString();
  backdated.candidateFreeze.manifestCanonicalSha256 = canonicalSha256(backdated.candidateFreeze.manifest);
  backdated.candidateFreeze.manifestFileSha256 = sha256(`${JSON.stringify(backdated.candidateFreeze.manifest, null, 2)}\n`);
  assert.throws(() => benchmark.validateTemporalHoldoutFixture(backdated), /cannot precede the candidate Git commit/);

  const exclusionDrift = fixture([fixtureCase(7)]);
  exclusionDrift.query.exclusionManifestSha256 = 'd'.repeat(64);
  assert.throws(() => benchmark.validateTemporalHoldoutFixture(exclusionDrift), /must match the candidate freeze/);
});

test('sealed fixtures reject arbitrary cutoff spoofing and freeze-day filings', async () => {
  const benchmark = await import(pathToFileURL(BENCHMARK));
  const spoofed = fixture([fixtureCase(1)]);
  spoofed.cutoff = '2026-12-30';
  spoofed.query.cutoff = '2026-12-30';
  assert.throws(() => benchmark.validateTemporalHoldoutFixture(spoofed), /candidate freeze cutoff/);

  const sameDay = fixtureCase(2, { input: { receiptDate: FREEZE_CUTOFF } });
  assert.throws(
    () => benchmark.validateTemporalHoldoutFixture(fixture([sameDay])),
    /strictly after cutoff|firstEligibleFilingDate/,
  );
});

test('collector selection is seeded, deterministic, corpCode-based, and exclusion-safe', async () => {
  const collector = await import(pathToFileURL(COLLECTOR));
  const filings = Array.from({ length: 9 }, (_, index) => ({
    rceptNo: String(100 + index), receiptDate: `2027010${(index % 8) + 1}`,
    corpCode: index === 8 ? null : `corp-${index % 4}`,
    corpName: `name-${index}`, reportName: `report ${index % 3}`,
  }));
  const options = { limit: 4, minIssuers: 4, selectionSeed: 'frozen-seed' };
  const first = collector.selectStratifiedFilings(filings, options).map((item) => item.rceptNo);
  const second = collector.selectStratifiedFilings([...filings].reverse(), options).map((item) => item.rceptNo);
  assert.deepEqual(first, second);
  assert.equal(first.includes('108'), false, 'a corpName must not substitute for missing corpCode');

  const excluded = new Set([first[0]]);
  const replacement = collector.selectStratifiedFilings(filings, { ...options, excludedReceipts: excluded });
  assert.equal(replacement.some((item) => excluded.has(item.rceptNo)), false);
  assert.throws(
    () => collector.selectStratifiedFilings(filings, { ...options, limit: 8, excludedReceipts: new Set(['100']) }),
    /non-excluded filings|issuers are available/,
  );
});

test('collector exclusion manifest rejects duplicates and hashes exact bytes', async () => {
  const collector = await import(pathToFileURL(COLLECTOR));
  assert.throws(
    () => collector.receiptNumbersFromExclusionManifest(['123', '123']),
    /duplicate receipt number/,
  );
  const directory = await mkdtemp(join(tmpdir(), 'jaroo-exclusions-'));
  const path = join(directory, 'manifest.json');
  const bytes = JSON.stringify({
    schemaVersion: 'jaroo.kr-disclosure-event-temporal-exclusions.v1',
    sources: [{ path: 'test/fixtures/source.json', sha256: 'a'.repeat(64), receiptCount: 2 }],
    receiptNumbers: ['123', '456'],
    summary: { sourceCount: 1, uniqueReceiptCount: 2 },
  }, null, 2);
  await writeFile(path, bytes);
  try {
    const result = await collector.readExclusionManifest(path);
    assert.deepEqual([...result.receipts], ['123', '456']);
    assert.equal(result.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.match(collector.selectionSeedCommitment('frozen-seed'), /^[a-f0-9]{64}$/);
    await writeFile(path, JSON.stringify({ receiptNumbers: ['123'] }));
    await assert.rejects(collector.readExclusionManifest(path), /schemaVersion/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('passes a synthetic cohort meeting every strict threshold', async () => {
  const benchmark = await import(pathToFileURL(BENCHMARK));
  const cases = Array.from({ length: 40 }, (_, index) => fixtureCase(index + 1));
  const validated = benchmark.validateTemporalHoldoutFixture(fixture(cases));
  const evaluations = validated.cases.map((item) => benchmark.evaluateTemporalHoldoutCase(
    item, { events: item.expectedEvents, confidence: 'high' },
  ));
  const assessment = benchmark.assessTemporalHoldoutThresholds(evaluations);
  assert.equal(assessment.passed, true);
  assert.equal(assessment.metrics.exactMultisetAccuracy, 1);
  assert.equal(assessment.metrics.fieldAccuracy, 1);
  assert.equal(assessment.metrics.issuerCount, 20);
  assert.equal(assessment.metrics.templateCount, 15);
  assert.equal(assessment.metrics.highConfidencePredictionCoverage, 1);
  assert.ok(assessment.metrics.brierScore <= 0.15);
});
