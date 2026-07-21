const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtemp, readFile, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const MODULE = '../src/services/deepscan-kr-disclosure-event-extractors.js';
const FIXTURE = join(__dirname, 'fixtures', 'kr-disclosure-event-benchmark.v1.json');
const BODY_REVIEWED_FIXTURE = join(__dirname, 'fixtures', 'kr-disclosure-event-body-reviewed.v1.json');
const SEMANTIC_GATE_FIXTURE = join(__dirname, 'fixtures', 'kr-disclosure-event-semantic-gate.v1.json');
const BENCHMARK = join(__dirname, '..', 'scripts', 'benchmark-dart-disclosure-event-extractors.mjs');
const RESEARCH_BENCHMARK = join(__dirname, '..', 'scripts', 'benchmark-dart-disclosure-event-research.mjs');
const SEMANTIC_GATE_BENCHMARK = join(__dirname, '..', 'scripts', 'benchmark-dart-disclosure-semantic-gate.mjs');

function normalizeEvent(event = {}) {
  return {
    type: event.type ?? 'other',
    action: event.action ?? null,
    state: event.state ?? null,
    cause: event.cause ?? null,
    subjectType: event.subjectType ?? null,
  };
}

function eventSet(events) {
  return events.map(normalizeEvent).map(JSON.stringify).sort();
}

async function loadFixture() {
  return JSON.parse(await readFile(FIXTURE, 'utf8'));
}

test('event benchmark corpus is contrastive, versioned, and multi-event aware', async () => {
  const fixture = await loadFixture();
  assert.equal(fixture.schemaVersion, 'jaroo.kr-disclosure-event-benchmark.v1');
  assert.ok(fixture.cases.length >= 30);
  assert.equal(new Set(fixture.cases.map((entry) => entry.id)).size, fixture.cases.length);
  assert.ok(fixture.cases.filter((entry) => entry.tags.includes('p0')).length >= 4);
  assert.ok(fixture.cases.filter((entry) => entry.tags.includes('contrast')).length >= 8);
  assert.ok(fixture.cases.some((entry) => entry.expectedEvents.length > 1));
  for (const fixtureCase of fixture.cases) {
    assert.ok(fixtureCase.input.reportName, fixtureCase.id);
    assert.ok(fixtureCase.expectedEvents.length > 0, fixtureCase.id);
    for (const event of fixtureCase.expectedEvents) assert.ok(event.type, fixtureCase.id);
  }
});

test('all extractor candidates are deterministic and emit the canonical event shape', async () => {
  const fixture = await loadFixture();
  const { KR_DISCLOSURE_EVENT_EXTRACTOR_CANDIDATES } = await import(MODULE);
  assert.deepEqual(Object.keys(KR_DISCLOSURE_EVENT_EXTRACTOR_CANDIDATES), ['legacy', 'flat', 'structured', 'hybrid', 'document', 'gated']);

  for (const [name, extractor] of Object.entries(KR_DISCLOSURE_EVENT_EXTRACTOR_CANDIDATES)) {
    for (const fixtureCase of fixture.cases) {
      const first = extractor(fixtureCase.input);
      const second = extractor(fixtureCase.input);
      assert.deepEqual(first, second, `${name}:${fixtureCase.id}`);
      const gatedBodyDependentAbstention = name === 'gated'
        && fixtureCase.input.disclosureDetailType === 'J001'
        && !fixtureCase.input.bodyText;
      assert.ok(first.events.length > 0 || gatedBodyDependentAbstention, `${name}:${fixtureCase.id}`);
      for (const event of first.events) {
        assert.deepEqual(Object.keys(event), ['type', 'action', 'state', 'cause', 'subjectType'], `${name}:${fixtureCase.id}`);
      }
    }
  }
});

test('structured and hybrid candidates resolve the four observed P0 semantics', async () => {
  const fixture = await loadFixture();
  const {
    extractEventsHybridProjection,
    extractEventsStructuredTitleProjection,
  } = await import(MODULE);
  const p0Cases = fixture.cases.filter((entry) => entry.tags.includes('p0'));
  assert.equal(p0Cases.length, 4);

  for (const fixtureCase of p0Cases) {
    assert.deepEqual(eventSet(extractEventsStructuredTitleProjection(fixtureCase.input).events), eventSet(fixtureCase.expectedEvents), `structured:${fixtureCase.id}`);
    assert.deepEqual(eventSet(extractEventsHybridProjection(fixtureCase.input).events), eventSet(fixtureCase.expectedEvents), `hybrid:${fixtureCase.id}`);
  }
});

test('hybrid candidate uses provider detail metadata while title-only structured candidate abstains', async () => {
  const {
    extractEventsHybridProjection,
    extractEventsStructuredTitleProjection,
  } = await import(MODULE);
  const input = {
    reportName: '지분공시',
    disclosureType: 'D',
    disclosureDetailType: 'D001',
  };
  assert.equal(extractEventsStructuredTitleProjection(input).events[0].type, 'other');
  assert.deepEqual(extractEventsHybridProjection(input).events, [{
    type: 'ownership-change',
    action: 'reported',
    state: null,
    cause: 'large-shareholding',
    subjectType: 'ownership',
  }]);
});

test('document-aware candidate resolves a generic market notice from its body subject', async () => {
  const { extractEventsDocumentAwareProjection } = await import(MODULE);
  const result = extractEventsDocumentAwareProjection({
    reportName: '기타안내사항(안내공시)',
    disclosureType: 'I',
    disclosureDetailType: 'I003',
    bodyText: '기타 안내사항 | 1. 제목 | | 보통주 의무보유 기간 만료 안내 | | 2. 주요내용 | 의무보유 해제일 2026.07.16 |',
  });
  assert.deepEqual(result.events, [{
    type: 'capital-change',
    action: 'lifted',
    state: null,
    cause: 'lockup',
    subjectType: 'securities',
  }]);
  assert.ok(result.reasons.includes('document-subject-fallback'));
});

test('document-aware candidate matches every source-backed body-required reviewed case', async () => {
  const fixture = JSON.parse(await readFile(BODY_REVIEWED_FIXTURE, 'utf8'));
  const { extractEventsDocumentAwareProjection } = await import(MODULE);
  assert.equal(fixture.schemaVersion, 'jaroo.kr-disclosure-event-body-reviewed.v1');
  assert.equal(fixture.cases.length, 13);
  for (const fixtureCase of fixture.cases) {
    assert.deepEqual(
      eventSet(extractEventsDocumentAwareProjection(fixtureCase.input).events),
      eventSet(fixtureCase.expectedEvents),
      fixtureCase.id,
    );
  }
});

test('document baseline remains separate while the gated candidate exposes all pure gate stages', async () => {
  const extractorModule = await import(MODULE);
  const requiredExports = [
    'normalizeDisclosureEventGateInput',
    'runFilingWrapperGate',
    'extractStructuredBodyFacts',
    'buildDetailPriorClaims',
    'buildTitleSemanticClaims',
    'resolveTemporalEvent',
    'normalizeEventOntology',
    'arbitrateEventCandidates',
    'scoreEventExtractionConfidence',
    'extractEventsGatedProjection',
  ];
  for (const name of requiredExports) assert.equal(typeof extractorModule[name], 'function', name);
  const input = { rceptNo: '20260713800438', reportName: '기타안내사항(안내공시)', bodyText: '| 1. 제목 | | 의무보유 기간 만료 안내 | | 해제일 | 2026.07.16 |' };
  assert.equal(extractorModule.extractEventsDocumentAwareProjection(input).strategy, 'document-aware-hierarchical-projection');
  assert.equal(extractorModule.extractEventsGatedProjection(input).strategy, 'semantic-gate-v3');
  assert.equal(extractorModule.normalizeDisclosureEventGateInput({ reportName: '[첨부추가] 공시' }).wrapperKind, 'attachment-added');
  assert.equal(extractorModule.extractEventsGatedProjection({ reportName: '투자설명서', disclosureDetailType: 'C004' }).confidence, 'medium');
});

test('v3 semantic regression fixture passes exact event sets and confidence contracts', async () => {
  const fixture = JSON.parse(await readFile(SEMANTIC_GATE_FIXTURE, 'utf8'));
  const { extractEventsGatedProjection } = await import(MODULE);
  assert.equal(fixture.schemaVersion, 'jaroo.kr-disclosure-event-semantic-gate.v1');
  assert.ok(fixture.cases.length >= 12);
  for (const fixtureCase of fixture.cases) {
    const actual = extractEventsGatedProjection(fixtureCase.input);
    assert.deepEqual(eventSet(actual.events), eventSet(fixtureCase.expectedEvents), fixtureCase.id);
    if (fixtureCase.expectedConfidence) assert.equal(actual.confidence, fixtureCase.expectedConfidence, fixtureCase.id);
  }
});

test('J001 blank periodic loan tables abstain with low confidence', async () => {
  const { extractEventsGatedProjection } = await import(MODULE);
  const actual = extractEventsGatedProjection({
    rceptNo: '20260714000419',
    reportName: '계열금융회사의약관에의한금융거래-[장단기대여]',
    disclosureDetailType: 'J001',
    bodyText: '거래상대방 | - | 거래일자 | - | 대여종류 | - | 거래금액 | - | 실제 인수금액은 없었습니다.',
  });
  assert.deepEqual(actual.events, []);
  assert.equal(actual.confidence, 'low');
});

test('J001 body-dependent disclosures abstain when the body is unavailable', async () => {
  const { extractEventsGatedProjection } = await import(MODULE);
  const actual = extractEventsGatedProjection({
    reportName: '약관에의한금융거래시계열금융회사의거래상대방의공시',
    disclosureDetailType: 'J001',
  });
  assert.deepEqual(actual.events, []);
  assert.equal(actual.confidence, 'low');
});

test('Q1-promoted semantic families use generalized lifecycle and object rules', async () => {
  const { extractEventsGatedProjection } = await import(MODULE);
  const cases = [
    {
      id: 'corrected-audit-reissue',
      input: {
        reportName: '[기재정정]감사보고서',
        disclosureDetailType: 'F001',
        filedAt: '2026-03-17',
        bodyText: '정정신고 | 정정사유 | 재무제표 수정에 따른 감사보고서 재발행',
      },
      expected: { type: 'audit', action: 'updated', state: 'effective', cause: 'audit-report', subjectType: 'audit-opinion' },
    },
    {
      id: 'corrected-offering-price',
      input: {
        reportName: '[기재정정]투자설명서(집합투자증권)',
        disclosureDetailType: 'G002',
        filedAt: '2026-03-10',
        bodyText: '정정신고 | 정정사유 | 1차 발행가액 확정 | 예정 모집가액 3000원 | 확정 발행가액 3055원',
      },
      expected: { type: 'capital-change', action: 'price-set', state: 'effective', cause: 'fund-securities', subjectType: 'securities' },
    },
    {
      id: 'chief-executive-change',
      input: { reportName: '대표이사(대표집행임원)변경(안내공시)', bodyText: '대표이사 신규 선임' },
      expected: { type: 'governance', action: 'changed', state: 'effective', cause: 'chief-executive-change', subjectType: 'governance' },
    },
    {
      id: 'related-party-collateral-received',
      input: { reportName: '특수관계인으로부터받은담보', disclosureDetailType: 'J001', filedAt: '2026-03-01', bodyText: '담보물 | 계열회사 주식 | 담보 수령일 | 2026.03.01' },
      expected: { type: 'related-party', action: 'received', state: 'effective', cause: 'collateral-received', subjectType: 'securities' },
    },
    {
      id: 'related-party-deposit-effective',
      input: { reportName: '특수관계인과의예ㆍ적금거래', disclosureDetailType: 'J001', filedAt: '2026-02-27', bodyText: '예ㆍ적금일 | 2026.02.27 | 예ㆍ적금의 종류 | USD RP | 상품가입 완료' },
      expected: { type: 'related-party', action: 'deposited', state: 'effective', cause: 'deposit-investment', subjectType: 'securities' },
    },
    {
      id: 'related-party-donation-planned',
      input: { reportName: '특수관계인에대한증여', disclosureDetailType: 'J001', filedAt: '2026-03-01', bodyText: '현금 출연은 분기별 출연 예정이며 이사회에서 의결하였다' },
      expected: { type: 'related-party', action: 'decided', state: 'proposed', cause: 'cash-donation', subjectType: 'cash' },
    },
  ];

  for (const fixtureCase of cases) {
    assert.deepEqual(extractEventsGatedProjection(fixtureCase.input).events, [fixtureCase.expected], fixtureCase.id);
  }

  assert.deepEqual(extractEventsGatedProjection({
    reportName: '매매거래정지및정지해제(중요내용공시)',
    filedAt: '2026-03-26',
    bodyText: '매매거래정지일시 | 2026.03.26 17:05 | 매매거래정지해제일시 | 2026.03.27 09:00 | 주식소각 결정',
  }).events, [
    { type: 'trading-status', action: 'halted', state: 'effective', cause: 'share-cancellation', subjectType: 'listed-shares' },
    { type: 'trading-status', action: 'lifted', state: 'pending', cause: 'share-cancellation', subjectType: 'listed-shares' },
  ]);
});

test('semantic gate benchmark enforces exact-set accuracy, coverage, and high-confidence precision', () => {
  const output = execFileSync(process.execPath, [
    SEMANTIC_GATE_BENCHMARK,
    `--fixture=${SEMANTIC_GATE_FIXTURE}`,
    '--gate=strict',
    '--json',
  ], { encoding: 'utf8' });
  const report = JSON.parse(output);
  assert.equal(report.gate.passed, true);
  assert.equal(report.metrics.exactSetAccuracy, 1);
  assert.equal(report.metrics.fieldAccuracy, 1);
  assert.equal(report.metrics.highConfidenceExactPrecision, 1);
  assert.ok(report.metrics.exactSetWilsonLower > 0.75);
  assert.ok(report.metrics.highConfidenceWilsonLower > 0.7);
});

test('semantic gate metrics reject abstain, other, missing, extra, all-low, and duplicate-template gaming', async () => {
  const benchmark = await import(pathToFileURL(SEMANTIC_GATE_BENCHMARK));
  const gold = { type: 'capital-change', action: 'decided', state: 'proposed', cause: 'rights-offering', subjectType: 'securities' };
  const fixtureCase = { id: 'case', templateKey: 'A', expectedEvents: [gold] };
  const evaluate = (events, confidence = 'high', extra = {}) => benchmark.evaluateSemanticGateCandidate(fixtureCase, { events, confidence, ...extra });
  assert.equal(evaluate([], 'high', { resolved: false }).exact, false);
  assert.equal(evaluate([{ ...gold, type: 'other' }]).resolved, false);
  assert.equal(evaluate([{ ...gold, cause: null }]).exact, false);
  assert.equal(evaluate([gold, gold]).exact, false);

  const allLow = benchmark.assessSemanticGateThresholds([evaluate([gold], 'low')]);
  assert.equal(allLow.passed, false);
  assert.equal(allLow.metrics.highConfidenceExactPrecision, 0);

  const repeated = Array.from({ length: 9 }, (_, index) => ({ ...evaluate([gold]), id: `a-${index}` }));
  const wrongTemplate = { ...evaluate([], 'high', { resolved: false }), id: 'b-1', templateKey: 'B' };
  const macroGate = benchmark.assessSemanticGateThresholds([...repeated, wrongTemplate], {
    exactSetAccuracy: 0.8,
    templateMacroAccuracy: 0.9,
  });
  assert.equal(macroGate.metrics.exactSetAccuracy, 0.9);
  assert.equal(macroGate.metrics.templateMacroAccuracy, 0.5);
  assert.equal(macroGate.passed, false);
});

test('semantic gate source contains no receipt or corporation literal branches', async () => {
  const source = await readFile(join(__dirname, '..', 'src', 'services', 'deepscan-kr-disclosure-event-extractors.js'), 'utf8');
  assert.doesNotMatch(source, /20\d{12}/u);
  assert.doesNotMatch(source, /(?:corpName|receiptNumber|rceptNo)\s*={2,3}/u);
});

test('benchmark runner compares both title-only and provider-detail modes', () => {
  const output = execFileSync(process.execPath, [BENCHMARK, '--json', '--iterations=5'], { encoding: 'utf8' });
  const report = JSON.parse(output);
  assert.equal(report.caseCount >= 30, true);
  assert.deepEqual(Object.keys(report.modes), ['title-only', 'provider-detail']);
  for (const mode of Object.values(report.modes)) {
    assert.deepEqual(Object.keys(mode), ['legacy', 'flat', 'structured', 'hybrid', 'document', 'gated']);
    for (const metrics of Object.values(mode)) {
      assert.equal(typeof metrics.selectionScore, 'number');
      assert.equal(metrics.latency.operationCount > 0, true);
    }
  }
  assert.ok(report.modes['title-only'].structured.selectionScore > report.modes['title-only'].legacy.selectionScore);
  assert.ok(report.modes['provider-detail'].hybrid.selectionScore > report.modes['provider-detail'].structured.selectionScore);
});

test('research benchmark keeps accuracy labels separate from coverage metrics', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jaroo-dart-event-research-'));
  const auditPath = join(directory, 'audit.json');
  const corpusPath = join(directory, 'corpus.json');
  await writeFile(auditPath, JSON.stringify({
    query: { corpClass: 'Y', from: '20260701', to: '20260721' },
    results: [
      {
        detailType: 'A001',
        detailMode: 'exact',
        samples: [{ rceptNo: '1', reportName: '사업보고서 (2025.12)', disclosureType: 'A' }],
      },
      {
        detailType: 'I001',
        detailMode: 'title_required',
        samples: [{ rceptNo: '2', reportName: '투자판단관련주요경영사항', disclosureType: 'I' }],
      },
    ],
  }));
  await writeFile(corpusPath, JSON.stringify({
    summary: { bodyAvailableCount: 1 },
    cases: [{
      key: 'I001|generic',
      input: {
        rceptNo: '2',
        reportName: '투자판단관련주요경영사항',
        disclosureType: 'I',
        disclosureDetailType: 'I001',
        bodyText: '투자판단 관련 주요경영사항 | 1. 제목 | | 정비사업 시공자 선정 | | 2. 주요내용 |',
      },
    }],
  }));

  try {
    const output = execFileSync(process.execPath, [
      RESEARCH_BENCHMARK,
      `--audit=${auditPath}`,
      `--corpus=${corpusPath}`,
      '--iterations=1',
      '--json',
    ], { cwd: join(__dirname, '..'), encoding: 'utf8' });
    const report = JSON.parse(output);
    assert.deepEqual(report.interpretation.accuracyMetrics, [
      'adversarialEventGold',
      'bodyReviewedEventSet',
      'humanTypeGold',
      'exactProviderAgreement',
    ]);
    assert.deepEqual(report.interpretation.coverageOnlyMetrics, [
      'titleRequiredCoverage',
      'titleRequiredHierarchicalCoverage',
      'bodyTemplateCoverage',
    ]);
    assert.equal(report.candidates.document.exactProviderAgreement.agreement, 1);
    assert.equal(report.candidates.document.titleRequiredHierarchicalCoverage.resolutionRate, 1);
    assert.equal(report.candidates.document.bodyTemplateCoverage.bodyResolved, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
