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
const EXCLUSION_BUILDER = join(__dirname, '..', 'scripts', 'build-dart-disclosure-temporal-exclusions.mjs');
const EXTRACTOR = join(__dirname, '..', 'src', 'services', 'deepscan-kr-disclosure-event-extractors.js');
const ONTOLOGY = join(__dirname, '..', 'src', 'services', 'deepscan-kr-disclosure-event-ontology.js');
const CLASSIFICATION_DATASET = join(__dirname, '..', 'src', 'data', 'kr-disclosure-classification-dataset.js');
const DISCLOSURE_PIPELINE = join(__dirname, '..', 'src', 'services', 'deepscan-kr-disclosure-pipeline.js');
const DISCLOSURE_RISK_KEYWORDS = join(__dirname, '..', 'src', 'services', 'deepscan-kr-disclosure-risk-keywords.js');
const SAFE_JSON = join(__dirname, '..', '..', 'deepscan-runtime-core', 'src', 'safe-json.js');
const DART_FILINGS = join(__dirname, '..', 'src', 'crawlers', 'dart-filings.js');
const PROTOCOL = join(__dirname, '..', 'src', 'services', 'deepscan-kr-disclosure-temporal-protocol.js');
const EXCLUSION_MANIFEST = join(__dirname, 'artifacts', 'kr-disclosure-event-temporal-exclusions.v1.json');
const DIGICERT_ROOT = join(__dirname, '..', 'config', 'rfc3161', 'digicert-assured-id-root-ca.crt');
const DIGICERT_CHAIN = join(__dirname, '..', 'config', 'rfc3161', 'digicert-timestamp-2025-chain.crt');
const FREETSA_ROOT = join(__dirname, '..', 'config', 'rfc3161', 'freetsa-root-ca.crt');
const FREETSA_CHAIN = join(__dirname, '..', 'config', 'rfc3161', 'freetsa-timestamp-signer.crt');
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

function temporalHash(domain, value) {
  return sha256(Buffer.concat([
    Buffer.from(`jaroo.kr-disclosure-temporal-chain.v2\0${domain}\0`),
    Buffer.from(JSON.stringify(canonicalize(value))),
  ]));
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

function daysBetween(from, to) {
  const millis = (value) => Date.UTC(
    Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8)),
  );
  return Math.round((millis(to) - millis(from)) / 86_400_000);
}

const FREEZE_GEN_TIME = GIT_COMMITTED_AT;
const FREEZE_OPERATIONAL_NOT_BEFORE = new Date(new Date(FREEZE_GEN_TIME).getTime() + 86_400_000).toISOString();
const FREEZE_CUTOFF = seoulDate(FREEZE_OPERATIONAL_NOT_BEFORE);
const FIRST_ELIGIBLE_DATE = nextDate(FREEZE_CUTOFF);
const TEST_EXCLUSION = Object.freeze({ sha256: 'c'.repeat(64), receipts: new Set(['20260721000001']) });
const TEST_EXCLUDED_RECEIPTS_SHA256 = temporalHash('excluded-receipts', [...TEST_EXCLUSION.receipts].sort());

function timestampAuthorityManifest() {
  return [
    {
      authorityId: 'digicert-rfc3161-2025', endpoint: 'http://timestamp.digicert.com',
      policyOid: '2.16.840.1.114412.7.1', expectedAccuracy: 'unspecified', formalAccuracyBoundVerified: false, operationalSafetyBufferSeconds: 86400,
      rootSha256: sha256(readFileSync(DIGICERT_ROOT)),
      untrustedChainSha256: sha256(readFileSync(DIGICERT_CHAIN)),
    },
    {
      authorityId: 'freetsa-rfc3161-2026', endpoint: 'https://freetsa.org/tsr',
      policyOid: '1.2.3.4.1', expectedAccuracy: 'unspecified', formalAccuracyBoundVerified: false, operationalSafetyBufferSeconds: 86400,
      rootSha256: sha256(readFileSync(FREETSA_ROOT)),
      untrustedChainSha256: sha256(readFileSync(FREETSA_CHAIN)),
    },
  ];
}

function fakeTimestampReceipts(payload, genTime = FREEZE_GEN_TIME) {
  const payloadSha256 = canonicalSha256(payload);
  return timestampAuthorityManifest().map((policy, index) => {
    const query = Buffer.from(`query:${policy.authorityId}:${payloadSha256}`);
    const response = Buffer.from(`response:${policy.authorityId}:${payloadSha256}`);
    return {
      ...policy,
      payloadSha256,
      querySha256: sha256(query),
      responseSha256: sha256(response),
      queryDerBase64: query.toString('base64'),
      responseDerBase64: response.toString('base64'),
      hashAlgorithm: 'sha256',
      genTime: new Date(new Date(genTime).getTime() + index * 1_000).toISOString(),
      nonce: `0x${(index + 1).toString(16).toUpperCase()}`,
      accuracy: 'unspecified',
    };
  });
}

function candidateFreezeEnvelope({
  from = '20270101',
  to = '20270131',
  limit = 40,
  minIssuers = Math.min(20, limit),
  retainedBodyChars = 60_000,
} = {}) {
  const collectionPlan = {
    schemaVersion: 'jaroo.kr-disclosure-temporal-collection-plan.v1',
    startOffsetDays: daysBetween(FIRST_ELIGIBLE_DATE, from),
    windowDays: daysBetween(from, to) + 1,
    limit,
    minIssuers,
    retainedBodyChars,
    provider: 'opendart',
    corpClass: 'Y',
    lastReportOnly: false,
    sort: 'date',
    sortDirection: 'asc',
    pageCount: 100,
    stoppingRule: 'fixed-window-fixed-limit-no-backfill.v1',
  };
  const components = {
    extractorSha256: sha256(readFileSync(EXTRACTOR)),
    ontologySourceSha256: sha256(readFileSync(ONTOLOGY)),
    classificationDatasetSha256: sha256(readFileSync(CLASSIFICATION_DATASET)),
    disclosurePipelineSha256: sha256(readFileSync(DISCLOSURE_PIPELINE)),
    disclosureRiskKeywordsSha256: sha256(readFileSync(DISCLOSURE_RISK_KEYWORDS)),
    safeJsonSha256: sha256(readFileSync(SAFE_JSON)),
    dartFilingsSha256: sha256(readFileSync(DART_FILINGS)),
    protocolSha256: sha256(readFileSync(PROTOCOL)),
    collectorSha256: sha256(readFileSync(COLLECTOR)),
    evaluatorSha256: sha256(readFileSync(BENCHMARK)),
    freezerSha256: sha256(readFileSync(FREEZER)),
    exclusionBuilderSha256: sha256(readFileSync(EXCLUSION_BUILDER)),
    exclusionManifestFileSha256: sha256(readFileSync(EXCLUSION_MANIFEST)),
    digicertRootSha256: sha256(readFileSync(DIGICERT_ROOT)),
    digicertChainSha256: sha256(readFileSync(DIGICERT_CHAIN)),
    freeTsaRootSha256: sha256(readFileSync(FREETSA_ROOT)),
    freeTsaChainSha256: sha256(readFileSync(FREETSA_CHAIN)),
    ontologyVersion: ONTOLOGY_VERSION,
    ontologyManifestSha256: ONTOLOGY_HASH,
    thresholdsSha256: sha256(JSON.stringify(STRICT_THRESHOLDS)),
    timestampAuthoritiesSha256: canonicalSha256(timestampAuthorityManifest()),
    selectionAlgorithm: 'deterministic-issuer-title-template-stratified.v2',
  };
  const precommit = {
    schemaVersion: 'jaroo.kr-disclosure-event-candidate-precommit.v2',
    experimentId: 'jaroo-test-temporal-v2',
    timeZone: 'Asia/Seoul',
    timestampAuthorities: timestampAuthorityManifest(),
    sampling: {
      selectionAlgorithm: 'deterministic-issuer-title-template-stratified.v2',
      selectionSeedCommitment: selectionCommitment(),
      exclusionManifestSha256: TEST_EXCLUSION.sha256,
      excludedReceiptCount: TEST_EXCLUSION.receipts.size,
      excludedReceiptsSha256: TEST_EXCLUDED_RECEIPTS_SHA256,
      excludedReceipts: [...TEST_EXCLUSION.receipts].sort(),
    },
    collectionPlan,
    candidate: { ...components, bundleSha256: canonicalSha256(components) },
    repository: { gitHead: GIT_HEAD },
  };
  const timestampReceipts = fakeTimestampReceipts(precommit);
  const manifest = {
    schemaVersion: 'jaroo.kr-disclosure-event-candidate-freeze.v2',
    timeZone: 'Asia/Seoul',
    precommit,
    temporalBoundary: {
      formalAccuracyBoundVerified: false,
      operationalNotBefore: new Date(new Date(timestampReceipts.at(-1).genTime).getTime() + 86_400_000).toISOString(),
      cutoff: FREEZE_CUTOFF,
      firstEligibleFilingDate: FIRST_ELIGIBLE_DATE,
      collectionWindow: { from, to },
    },
    timestampReceipts,
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

function validateLegacy(benchmark, value, options = {}) {
  return benchmark.validateTemporalHoldoutFixture(value, {
    ...options,
    allowLegacySealedForTesting: true,
    verifyExternalTimestamps: false,
    verifyCurrentCandidate: false,
    verifyRepositoryAnchor: false,
  });
}

function populationEntryFromCase(item) {
  return {
    rceptNo: item.input.rceptNo,
    receiptDate: item.input.receiptDate,
    corpCode: item.source.corpCode,
    corpName: item.input.issuer,
    stockCode: item.input.stockCode ?? null,
    corpClass: item.source.corpClass,
    reportName: item.input.title,
    filerName: null,
    remarks: null,
  };
}

function unlabeledCase(item) {
  return {
    id: item.id,
    labelStatus: 'unlabeled',
    input: { ...item.input },
    source: { ...item.source },
  };
}

async function buildV2Chain(benchmark, protocol, candidateCases, { limit = candidateCases.length } = {}) {
  const population = candidateCases.map(populationEntryFromCase);
  const minIssuers = Math.min(20, new Set(population.map((item) => item.corpCode)).size, limit);
  const freeze = candidateFreezeEnvelope({ limit, minIssuers });
  const selectedReceipts = protocol.selectStratifiedFilings(population, {
    limit,
    minIssuers,
    selectionSeed: 'frozen-seed',
  }).map((item) => item.rceptNo);
  const annotatedByReceipt = new Map(candidateCases.map((item) => [item.input.rceptNo, item]));
  const annotatedCases = selectedReceipts.map((receipt) => annotatedByReceipt.get(receipt));
  const rawCases = annotatedCases.map(unlabeledCase);
  const query = {
    from: '2027-01-01',
    to: '2027-01-31',
    cutoff: FREEZE_CUTOFF,
    corpClass: 'Y',
    lastReportOnly: false,
    sort: 'date',
    sortDirection: 'asc',
    pageCount: 100,
    limit,
    minIssuers,
    retainedBodyChars: 60_000,
    stoppingRule: 'fixed-window-fixed-limit-no-backfill.v1',
    selectionSeedReveal: 'frozen-seed',
    selectionSeedCommitment: selectionCommitment(),
    exclusionManifestSha256: TEST_EXCLUSION.sha256,
    excludedReceiptCount: TEST_EXCLUSION.receipts.size,
    excludedReceiptsSha256: TEST_EXCLUDED_RECEIPTS_SHA256,
  };
  const rawPayload = protocol.buildTemporalRawCorpusPayload({
    candidateFreeze: freeze,
    query,
    source: { provider: 'opendart', market: 'KR' },
    capture: {
      providerTotalCount: population.length,
      listedCount: population.length,
      deduplicatedCount: population.length,
      eligibleCount: population.length,
      duplicateCount: 0,
      excludedInWindowCount: 0,
      selectedCount: limit,
      caseCount: limit,
      documentFailureCount: 0,
      uniqueIssuerCount: new Set(rawCases.map((item) => item.source.corpCode)).size,
      uniqueTitleTemplateCount: new Set(rawCases.map((item) => item.input.title)).size,
      truncatedBodyCount: 0,
      retainedBodyCharCount: rawCases.reduce((sum, item) => sum + [...item.input.body].length, 0),
    },
    listedFilings: population,
    population,
    cases: rawCases,
  });
  const rawGenTime = '2027-02-01T00:00:00.000Z';
  const rawEnvelope = protocol.createTemporalRawCorpusEnvelope(
    rawPayload,
    fakeTimestampReceipts(rawPayload, rawGenTime),
  );
  const rawBytes = Buffer.from(`${JSON.stringify(rawEnvelope, null, 2)}\n`);
  const rawValidated = protocol.validateTemporalRawCorpusEnvelope(rawEnvelope, {
    verifyExternalTimestamps: false,
    verifyCurrentCandidate: false,
    verifyRepositoryAnchor: false,
    now: new Date('2028-01-01T00:00:00.000Z'),
  });
  const value = fixture(annotatedCases);
  value.schemaVersion = 'jaroo.kr-disclosure-event-temporal-holdout.v2';
  value.cutoff = FREEZE_CUTOFF;
  value.candidateFreeze = freeze;
  value.query = { ...rawPayload.query };
  value.audit = {
    predictionsHiddenUntilAdjudication: true,
    unlabeledCorpusSha256: sha256(rawBytes),
    annotationManifestSha256: null,
  };
  value.provenance = {
    rawCorpusPath: 'raw-corpus.json',
    rawCorpusFileSha256: sha256(rawBytes),
    rawCorpusPayloadCanonicalSha256: rawEnvelope.payloadCanonicalSha256,
    annotationFreeze: null,
  };
  const annotationPayload = benchmark.buildTemporalAnnotationPayload(value, {
    rawCorpusFileSha256: sha256(rawBytes),
    rawCorpus: rawValidated,
  });
  value.audit.annotationManifestSha256 = protocol.temporalDomainSha256(
    'annotation-manifest', annotationPayload,
  );
  const annotationGenTime = new Date(
    new Date(rawValidated.timestamp.operationalNotBefore).getTime() + 60_000,
  ).toISOString();
  value.provenance.annotationFreeze = protocol.createDetachedTimestampEnvelope(
    annotationPayload,
    fakeTimestampReceipts(annotationPayload, annotationGenTime),
  );
  return { fixture: value, rawEnvelope, rawBytes, rawValidated, annotatedCases };
}

function validateV2(benchmark, chain) {
  return benchmark.validateTemporalHoldoutFixture(chain.fixture, {
    rawCorpusEnvelope: chain.rawEnvelope,
    rawCorpusFileBytes: chain.rawBytes,
    verifyExternalTimestamps: false,
    verifyCurrentCandidate: false,
    verifyRepositoryAnchor: false,
    now: new Date('2028-01-01T00:00:00.000Z'),
  });
}

function resealAnnotation(benchmark, protocol, chain) {
  const rawCorpusFileSha256 = sha256(chain.rawBytes);
  const payload = benchmark.buildTemporalAnnotationPayload(chain.fixture, {
    rawCorpusFileSha256,
    rawCorpus: chain.rawValidated,
  });
  chain.fixture.audit.annotationManifestSha256 = protocol.temporalDomainSha256(
    'annotation-manifest', payload,
  );
  const genTime = new Date(
    new Date(chain.rawValidated.timestamp.operationalNotBefore).getTime() + 60_000,
  ).toISOString();
  chain.fixture.provenance.annotationFreeze = protocol.createDetachedTimestampEnvelope(
    payload,
    fakeTimestampReceipts(payload, genTime),
  );
}

test('rejects a fixture with malformed canonical gold event keys', async () => {
  const benchmark = await import(pathToFileURL(BENCHMARK));
  const invalid = fixture([fixtureCase(1, { expectedEvents: [{ ...GOLD, explanation: 'not canonical' }] })]);
  assert.throws(() => validateLegacy(benchmark, invalid), /exactly the five canonical keys/);
});

test('pins the fixture and predictions to the frozen ontology manifest', async () => {
  const benchmark = await import(pathToFileURL(BENCHMARK));
  const wrongVersion = { ...fixture([fixtureCase(1)]), ontologyVersion: 'jaroo.kr-disclosure-event-ontology.v0' };
  assert.throws(() => validateLegacy(benchmark, wrongVersion), /ontologyVersion must equal/);

  const wrongHash = { ...fixture([fixtureCase(2)]), ontologyHash: '0'.repeat(64) };
  assert.throws(() => validateLegacy(benchmark, wrongHash), /ontologyHash must equal/);

  const alias = {
    type: 'capital-change', action: 'decided', state: 'proposed',
    cause: 'conditional-capital-security', subjectType: 'securities',
  };
  assert.throws(
    () => validateLegacy(benchmark, fixture([fixtureCase(3, { expectedEvents: [alias] })])),
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
  assert.throws(() => validateLegacy(benchmark, fixture([invalid])), /at least two independent labels/);

  const unblinded = fixtureCase(2, {
    annotations: [
      { annotator: 'reviewer-a', blindedToPrediction: false, confidenceInLabel: 'high', expectedEvents: [GOLD] },
      { annotator: 'reviewer-b', blindedToPrediction: true, confidenceInLabel: 'high', expectedEvents: [GOLD] },
    ],
  });
  assert.throws(() => validateLegacy(benchmark, fixture([unblinded])), /blinded to prediction/);
});

test('allows null optional canonical fields in adjudicated gold', async () => {
  const benchmark = await import(pathToFileURL(BENCHMARK));
  const filed = { ...GOLD, action: 'filed', state: null };
  assert.doesNotThrow(() => validateLegacy(benchmark, fixture([
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

test('an under-sized validated cohort fails the strict gate', async () => {
  const benchmark = await import(pathToFileURL(BENCHMARK));
  const report = benchmark.evaluateTemporalHoldoutFixture(
    fixture([fixtureCase(1)]),
    () => ({ events: [GOLD], confidence: 'high' }),
    benchmark.STRICT_THRESHOLDS,
    {
      allowLegacySealedForTesting: true,
      verifyExternalTimestamps: false,
      verifyCurrentCandidate: false,
      verifyRepositoryAnchor: false,
    },
  );
  assert.equal(report.assessment.passed, false);
  assert.equal(report.provenanceVerified, false);
});

test('benchmark result records fixture, evaluator, extractor, and threshold hashes', async () => {
  const benchmark = await import(pathToFileURL(BENCHMARK));
  const report = await benchmark.runTemporalHoldoutBenchmark({
    fixturePath: join(__dirname, 'fixtures', 'kr-disclosure-event-temporal-holdout.v1.json'),
    gateMode: 'diagnostic',
  });
  assert.deepEqual(Object.keys(report.hashes).sort(), [
    'annotationManifestSha256', 'candidateFreezeManifestSha256', 'evaluatorSha256',
    'extractorSha256', 'fixtureSha256', 'ontologyManifestSha256', 'rawCorpusFileSha256',
    'thresholdsSha256',
  ]);
  assert.equal(report.ontologyVersion, ONTOLOGY_VERSION);
  assert.equal(report.hashes.ontologyManifestSha256, ONTOLOGY_HASH);
  assert.equal(report.independentClaimEligible, false);
  assert.equal(report.externalIndependence.passed, false);
  assert.deepEqual(report.externalIndependence.failures, [
    'contract-tsa-formal-accuracy-bound',
    'provider-population-authenticity-witness',
    'signed-independent-annotation-identities',
    'append-only-cohort-burn-ledger',
  ]);
  for (const hash of Object.values(report.hashes).filter(Boolean)) assert.match(hash, /^[a-f0-9]{64}$/);
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
    await assert.rejects(
      benchmark.runTemporalHoldoutBenchmark({
        fixturePath: path,
        gateMode: 'strict',
        allowLegacySealedForTesting: true,
        verifyExternalTimestamps: false,
        verifyCurrentCandidate: false,
        verifyRepositoryAnchor: false,
      }),
      /strict gate forbids provenance verification bypasses/,
    );
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
    () => validateLegacy(benchmark, burned),
    /cannot be used by the strict holdout gate/,
  );
  assert.doesNotThrow(() => validateLegacy(benchmark, burned, { allowBurned: true }));
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
    () => validateLegacy(benchmark, sealed),
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
  const validated = validateLegacy(benchmark, burned, { allowBurned: true });
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
  assert.throws(() => validateLegacy(benchmark, fixture([first, second])), /duplicate receipt/);
});

test('rejects filing dates on or before the cutoff', async () => {
  const benchmark = await import(pathToFileURL(BENCHMARK));
  const before = fixtureCase(1, { input: { receiptDate: FREEZE_CUTOFF } });
  assert.throws(() => validateLegacy(benchmark, fixture([before])), /strictly after cutoff/);
});

test('rejects duplicate case ids, out-of-window dates, and inconsistent template keys', async () => {
  const benchmark = await import(pathToFileURL(BENCHMARK));
  const first = fixtureCase(1);
  const duplicateId = fixtureCase(2, { id: first.id });
  assert.throws(() => validateLegacy(benchmark, fixture([first, duplicateId])), /duplicate case id/);

  const outside = fixtureCase(3, { input: { receiptDate: '2027-02-01' } });
  assert.throws(() => validateLegacy(benchmark, fixture([outside])), /within query\.from and query\.to/);

  const wrongTemplate = fixtureCase(4, { templateKey: 'not-normalized-title' });
  assert.throws(() => validateLegacy(benchmark, fixture([wrongTemplate])), /normalized disclosure title/);
});

test('rejects inconsistent cutoff and query ranges beyond provider boundaries', async () => {
  const benchmark = await import(pathToFileURL(BENCHMARK));
  const inconsistent = fixture([fixtureCase(1)]);
  inconsistent.cutoff = '2026-12-30';
  assert.throws(
    () => validateLegacy(benchmark, inconsistent),
    /candidate freeze cutoff must equal fixture cutoff|cutoff must equal query\.cutoff/,
  );
  const excessive = fixture([fixtureCase(2)]);
  excessive.query.to = '2027-05-01';
  assert.throws(() => validateLegacy(benchmark, excessive), /cannot exceed 92 days/);
});

test('requires adjudicated label status, confidence enums, and independent adjudicators', async () => {
  const benchmark = await import(pathToFileURL(BENCHMARK));
  assert.throws(
    () => validateLegacy(benchmark, { ...fixture([fixtureCase(1)]), labelStatus: 'unlabeled' }),
    /fixture labelStatus must be adjudicated/,
  );
  const invalidConfidence = fixtureCase(2);
  invalidConfidence.annotations[0].confidenceInLabel = 'certain';
  assert.throws(() => validateLegacy(benchmark, fixture([invalidConfidence])), /low, medium, or high/);
  const reused = fixtureCase(3, {
    adjudication: {
      adjudicator: 'reviewer-a', decision: 'agreement', blindedToPrediction: true,
      rationale: 'same person', expectedEvents: [GOLD],
    },
  });
  assert.throws(() => validateLegacy(benchmark, fixture([reused])), /independent from annotators/);
});

test('requires adjudication events to exactly equal gold for agreement and resolution', async () => {
  const benchmark = await import(pathToFileURL(BENCHMARK));
  const wrong = { ...GOLD, cause: 'convertible-bond' };
  const agreement = fixtureCase(1);
  agreement.adjudication.expectedEvents = [wrong];
  assert.throws(() => validateLegacy(benchmark, fixture([agreement])), /exactly match case gold/);

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
  assert.throws(() => validateLegacy(benchmark, fixture([resolved])), /exactly match case gold/);
});

test('rejects excessive event cardinality and stale summary counts', async () => {
  const benchmark = await import(pathToFileURL(BENCHMARK));
  const tooMany = Array.from({ length: benchmark.MAX_EVENTS_PER_CASE + 1 }, () => ({ ...GOLD }));
  assert.throws(
    () => validateLegacy(benchmark, fixture([fixtureCase(1, { expectedEvents: tooMany })])),
    /exceeds the maximum/,
  );
  const stale = fixture([fixtureCase(2)]);
  stale.summary.caseCount = 99;
  assert.throws(() => validateLegacy(benchmark, stale), /summary\.caseCount/);
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
  const validationOptions = {
    verifyExternalTimestamps: false,
    verifyCurrentCandidate: false,
    verifyRepositoryAnchor: false,
  };
  const bound = collector.bindOptionsToCandidateFreeze(
    options, candidateFreezeEnvelope(), TEST_EXCLUSION, validationOptions,
  );
  assert.equal(bound.cutoff, FREEZE_CUTOFF);

  const sameDay = collector.validateOptions({ ...base, from: FREEZE_CUTOFF, to: FREEZE_CUTOFF });
  assert.throws(
    () => collector.bindOptionsToCandidateFreeze(
      sameDay, candidateFreezeEnvelope(), TEST_EXCLUSION, validationOptions,
    ),
    /candidate collection plan/,
  );
  const wrongSeed = collector.validateOptions({ ...base, 'selection-seed': 'different-seed' });
  assert.throws(
    () => collector.bindOptionsToCandidateFreeze(
      wrongSeed, candidateFreezeEnvelope(), TEST_EXCLUSION, validationOptions,
    ),
    /selection seed does not match/,
  );
  const wrongExclusion = { sha256: 'd'.repeat(64), receipts: new Set(['prior-receipt']) };
  assert.throws(
    () => collector.bindOptionsToCandidateFreeze(
      options, candidateFreezeEnvelope(), wrongExclusion, validationOptions,
    ),
    /exclusion manifest bytes do not match/,
  );
});

test('sealed v2 fixtures derive eligibility from the timestamped raw and annotation chain', async () => {
  const benchmark = await import(pathToFileURL(BENCHMARK));
  const protocol = await import(pathToFileURL(PROTOCOL));
  const chain = await buildV2Chain(benchmark, protocol, [fixtureCase(1)]);
  assert.doesNotThrow(() => validateV2(benchmark, chain));

  chain.fixture.audit.independentClaimEligible = true;
  assert.throws(() => validateV2(benchmark, chain), /must not be self-attested/);
  delete chain.fixture.audit.independentClaimEligible;

  chain.fixture.provenance.rawCorpusFileSha256 = '0'.repeat(64);
  assert.throws(() => validateV2(benchmark, chain), /raw corpus file hash mismatch/);
  chain.fixture.provenance.rawCorpusFileSha256 = sha256(chain.rawBytes);

  chain.fixture.query.exclusionManifestSha256 = 'd'.repeat(64);
  assert.throws(() => validateV2(benchmark, chain), /timestamped raw corpus query/);
});

test('sealed v2 fixtures reject arbitrary cutoff spoofing and freeze-day filings', async () => {
  const benchmark = await import(pathToFileURL(BENCHMARK));
  const protocol = await import(pathToFileURL(PROTOCOL));
  const chain = await buildV2Chain(benchmark, protocol, [fixtureCase(1)]);
  chain.fixture.cutoff = '2026-12-30';
  assert.throws(() => validateV2(benchmark, chain), /candidate freeze cutoff/);

  const freezeDay = fixtureCase(2, {
    input: { rceptNo: `${FREEZE_CUTOFF}000002`, receiptDate: FREEZE_CUTOFF },
  });
  await assert.rejects(
    buildV2Chain(benchmark, protocol, [freezeDay]),
    /query window|firstEligible|receiptDate|population/,
  );
});

test('sealed v2 rejects an arbitrary easy-case substitution even after annotation hashes are rebuilt', async () => {
  const benchmark = await import(pathToFileURL(BENCHMARK));
  const protocol = await import(pathToFileURL(PROTOCOL));
  const candidates = Array.from({ length: 50 }, (_, index) => fixtureCase(index + 1));
  const chain = await buildV2Chain(benchmark, protocol, candidates, { limit: 40 });
  const selected = new Set(chain.annotatedCases.map((item) => item.input.rceptNo));
  const unselected = candidates.find((item) => !selected.has(item.input.rceptNo));
  chain.fixture.cases[0] = structuredClone(unselected);
  resealAnnotation(benchmark, protocol, chain);
  assert.throws(
    () => validateV2(benchmark, chain),
    /receipt does not equal the deterministic raw corpus selection|immutable content differs/,
  );
});

test('sealed v2 rejects receiptDate rewriting even when all final annotation hashes are rebuilt', async () => {
  const benchmark = await import(pathToFileURL(BENCHMARK));
  const protocol = await import(pathToFileURL(PROTOCOL));
  const chain = await buildV2Chain(benchmark, protocol, [fixtureCase(1)]);
  chain.fixture.cases[0].input.receiptDate = '2027-01-02';
  resealAnnotation(benchmark, protocol, chain);
  assert.throws(
    () => validateV2(benchmark, chain),
    /receipt-number date prefix|immutable content differs/,
  );
});

test('raw corpus selection manifest cannot replace deterministic replay by rehashing the envelope', async () => {
  const benchmark = await import(pathToFileURL(BENCHMARK));
  const protocol = await import(pathToFileURL(PROTOCOL));
  const chain = await buildV2Chain(
    benchmark,
    protocol,
    Array.from({ length: 5 }, (_, index) => fixtureCase(index + 1)),
    { limit: 4 },
  );
  const altered = structuredClone(chain.rawEnvelope);
  altered.payload.selection.selectedReceiptNumbers[0] = '20270101999999';
  altered.payload.selection.selectedReceiptsSha256 = protocol.temporalDomainSha256(
    'selected-receipts', altered.payload.selection.selectedReceiptNumbers,
  );
  altered.payloadCanonicalSha256 = canonicalSha256(altered.payload);
  altered.timestampReceipts = fakeTimestampReceipts(altered.payload, '2027-02-01T00:00:00.000Z');
  assert.throws(
    () => protocol.validateTemporalRawCorpusEnvelope(altered, {
      verifyExternalTimestamps: false,
      verifyCurrentCandidate: false,
      verifyRepositoryAnchor: false,
      now: new Date('2028-01-01T00:00:00.000Z'),
    }),
    /do not equal deterministic replay/,
  );
});

test('sealed v2 rejects classifier aliases injected after raw capture', async () => {
  const benchmark = await import(pathToFileURL(BENCHMARK));
  const protocol = await import(pathToFileURL(PROTOCOL));
  const chain = await buildV2Chain(benchmark, protocol, [fixtureCase(1)]);
  chain.fixture.cases[0].input.reportName = '상장폐지 결정';
  chain.fixture.cases[0].input.filedAt = '2027-01-02';
  chain.fixture.cases[0].templateKey = '상장폐지결정';
  assert.throws(
    () => validateV2(benchmark, chain),
    /forbidden alias or field reportName|post-capture alias/,
  );
});

test('raw corpus rejects population and capture count rewrites after timestamping', async () => {
  const benchmark = await import(pathToFileURL(BENCHMARK));
  const protocol = await import(pathToFileURL(PROTOCOL));
  const chain = await buildV2Chain(benchmark, protocol, [fixtureCase(1)]);
  const altered = structuredClone(chain.rawEnvelope);
  altered.payload.capture.providerTotalCount = 999;
  altered.payloadCanonicalSha256 = canonicalSha256(altered.payload);
  altered.timestampReceipts = fakeTimestampReceipts(altered.payload, '2027-02-01T00:00:00.000Z');
  assert.throws(
    () => protocol.validateTemporalRawCorpusEnvelope(altered, {
      verifyExternalTimestamps: false,
      verifyCurrentCandidate: false,
      verifyRepositoryAnchor: false,
      now: new Date('2028-01-01T00:00:00.000Z'),
    }),
    /capture\.providerTotalCount is stale/,
  );
});

test('raw corpus query cannot diverge from the precommitted collection plan', async () => {
  const benchmark = await import(pathToFileURL(BENCHMARK));
  const protocol = await import(pathToFileURL(PROTOCOL));
  const chain = await buildV2Chain(benchmark, protocol, [fixtureCase(1)]);
  const altered = structuredClone(chain.rawEnvelope);
  altered.payload.query.retainedBodyChars += 1;
  altered.payloadCanonicalSha256 = canonicalSha256(altered.payload);
  altered.timestampReceipts = fakeTimestampReceipts(altered.payload, '2027-02-01T00:00:00.000Z');
  assert.throws(
    () => protocol.validateTemporalRawCorpusEnvelope(altered, {
      verifyExternalTimestamps: false,
      verifyCurrentCandidate: false,
      verifyRepositoryAnchor: false,
      now: new Date('2028-01-01T00:00:00.000Z'),
    }),
    /query\.retainedBodyChars differs from the candidate collection plan/,
  );
});

test('raw corpus cannot be sealed before its final KST filing day has ended', async () => {
  const benchmark = await import(pathToFileURL(BENCHMARK));
  const protocol = await import(pathToFileURL(PROTOCOL));
  const chain = await buildV2Chain(benchmark, protocol, [fixtureCase(1)]);
  const altered = structuredClone(chain.rawEnvelope);
  altered.timestampReceipts = fakeTimestampReceipts(altered.payload, '2027-01-31T00:00:00.000Z');
  assert.throws(
    () => protocol.validateTemporalRawCorpusEnvelope(altered, {
      verifyExternalTimestamps: false,
      verifyCurrentCandidate: false,
      verifyRepositoryAnchor: false,
      now: new Date('2028-01-01T00:00:00.000Z'),
    }),
    /timestamped on a KST date after query\.to/,
  );
});

test('RFC3161 validation fails closed when authority accuracy policy changes', async () => {
  const protocol = await import(pathToFileURL(PROTOCOL));
  const payload = { test: 'accuracy-policy' };
  const receipts = fakeTimestampReceipts(payload);
  receipts[0].accuracy = '999 seconds';
  assert.throws(
    () => protocol.validateRfc3161Receipts(payload, receipts, { verifyCrypto: false }),
    /accuracy no longer matches the pinned conservative policy/,
  );
});

test('RFC3161 issuance rejects oversized authority responses before DER parsing', async () => {
  const protocol = await import(pathToFileURL(PROTOCOL));
  await assert.rejects(
    protocol.issueRfc3161ReceiptSet(
      { test: 'oversized-response' },
      { fetchImpl: async () => new Response(new Uint8Array(300 * 1024), { status: 200 }) },
    ),
    /response exceeds 262144 bytes/,
  );
});

test('candidate fingerprint includes extractor and collector transitive dependencies', async () => {
  const protocol = await import(pathToFileURL(PROTOCOL));
  const fingerprint = protocol.currentTemporalCandidateFingerprint();
  for (const field of [
    'classificationDatasetSha256', 'disclosurePipelineSha256',
    'disclosureRiskKeywordsSha256', 'safeJsonSha256', 'dartFilingsSha256',
    'exclusionManifestFileSha256',
    'exclusionBuilderSha256',
  ]) assert.match(fingerprint[field], /^[a-f0-9]{64}$/u);
});

test('burned v1 data cannot become claim-eligible by changing only role and audit fields', async () => {
  const benchmark = await import(pathToFileURL(BENCHMARK));
  const roleFlipped = fixture([fixtureCase(1)]);
  roleFlipped.audit = {
    predictionsHiddenUntilAdjudication: true,
    unlabeledCorpusSha256: 'a'.repeat(64),
    annotationManifestSha256: 'b'.repeat(64),
  };
  assert.throws(
    () => benchmark.validateTemporalHoldoutFixture(roleFlipped),
    /provenance-bound v2 schema/,
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
    () => collector.receiptNumbersFromExclusionManifest(['20260101000001', '20260101000001']),
    /duplicate receipt number/,
  );
  const directory = await mkdtemp(join(tmpdir(), 'jaroo-exclusions-'));
  const path = join(directory, 'manifest.json');
  const bytes = JSON.stringify({
    schemaVersion: 'jaroo.kr-disclosure-event-temporal-exclusions.v1',
    sources: [{ path: 'test/fixtures/source.json', sha256: 'a'.repeat(64), receiptCount: 2 }],
    receiptNumbers: ['20260101000001', '20260101000002'],
    summary: { sourceCount: 1, uniqueReceiptCount: 2 },
  }, null, 2);
  await writeFile(path, bytes);
  try {
    const result = await collector.readExclusionManifest(path);
    assert.deepEqual([...result.receipts], ['20260101000001', '20260101000002']);
    assert.equal(result.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.match(collector.selectionSeedCommitment('frozen-seed'), /^[a-f0-9]{64}$/);
    await writeFile(path, JSON.stringify({ receiptNumbers: ['20260101000001'] }));
    await assert.rejects(collector.readExclusionManifest(path), /schemaVersion/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('collector writes sealed artifacts atomically without overwriting evidence', async () => {
  const collector = await import(pathToFileURL(COLLECTOR));
  const directory = await mkdtemp(join(tmpdir(), 'jaroo-immutable-artifact-'));
  const path = join(directory, 'raw-corpus.json');
  try {
    await collector.writeImmutableArtifact(path, 'first');
    await assert.rejects(collector.writeImmutableArtifact(path, 'second'), /EEXIST|file already exists/);
    assert.equal(readFileSync(path, 'utf8'), 'first');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('passes a synthetic cohort meeting every strict threshold', async () => {
  const benchmark = await import(pathToFileURL(BENCHMARK));
  const cases = Array.from({ length: 40 }, (_, index) => fixtureCase(index + 1));
  const validated = validateLegacy(benchmark, fixture(cases));
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
