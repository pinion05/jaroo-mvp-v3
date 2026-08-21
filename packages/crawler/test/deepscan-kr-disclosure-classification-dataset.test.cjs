const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const { join } = require('node:path');

const DATASET_MODULE = '../src/data/kr-disclosure-classification-dataset.js';
const PIPELINE_MODULE = '../src/services/deepscan-kr-disclosure-pipeline.js';
const GOLD_FIXTURE = join(__dirname, 'fixtures', 'kr-disclosure-classification-gold.v1.json');

async function loadGoldFixture() {
  return JSON.parse(await readFile(GOLD_FIXTURE, 'utf8'));
}

test('classification dataset covers the complete documented OpenDART taxonomy without duplicate codes', async () => {
  const {
    KR_DISCLOSURE_CATEGORY_CONFIG,
    KR_DISCLOSURE_CATEGORY_ORDER,
    KR_DISCLOSURE_CLASSIFICATION_DATASET,
    KR_DISCLOSURE_CLASSIFICATION_DATASET_VERSION,
    KR_DISCLOSURE_TITLE_RULES,
    OPEN_DART_DISCLOSURE_DETAIL_TYPES,
    OPEN_DART_DISCLOSURE_TYPES,
  } = await import(DATASET_MODULE);

  assert.equal(KR_DISCLOSURE_CLASSIFICATION_DATASET.schemaVersion, KR_DISCLOSURE_CLASSIFICATION_DATASET_VERSION);
  assert.equal(Object.keys(OPEN_DART_DISCLOSURE_TYPES).length, 10);
  assert.equal(OPEN_DART_DISCLOSURE_DETAIL_TYPES.length, 61);
  assert.equal(new Set(OPEN_DART_DISCLOSURE_DETAIL_TYPES.map((entry) => entry.code)).size, 61);
  assert.deepEqual(
    Object.fromEntries(Object.keys(OPEN_DART_DISCLOSURE_TYPES).map((type) => [
      type,
      OPEN_DART_DISCLOSURE_DETAIL_TYPES.filter((entry) => entry.type === type).length,
    ])),
    { A: 5, B: 3, C: 11, D: 5, E: 10, F: 5, G: 3, H: 6, I: 6, J: 7 },
  );

  for (const detail of OPEN_DART_DISCLOSURE_DETAIL_TYPES) {
    assert.match(detail.code, /^[A-J]\d{3}$/);
    assert.equal(detail.type, detail.code[0]);
    assert.ok(OPEN_DART_DISCLOSURE_TYPES[detail.type], detail.code);
    assert.ok(['exact', 'title_required'].includes(detail.mode), detail.code);
    if (detail.defaultCategory) {
      assert.ok(KR_DISCLOSURE_CATEGORY_CONFIG[detail.defaultCategory], `${detail.code}:${detail.defaultCategory}`);
    } else {
      assert.equal(detail.mode, 'title_required', detail.code);
    }
  }

  assert.deepEqual(Object.keys(KR_DISCLOSURE_CATEGORY_CONFIG).sort(), [...KR_DISCLOSURE_CATEGORY_ORDER].sort());
  for (const rule of KR_DISCLOSURE_TITLE_RULES) {
    assert.ok(KR_DISCLOSURE_CATEGORY_CONFIG[rule.category], rule.id);
    assert.doesNotThrow(() => new RegExp(rule.pattern, rule.flags), rule.id);
  }
});

test('every official detail type has deterministic semantics or is explicitly routed to ambiguous review', async () => {
  const {
    KR_DISCLOSURE_CATEGORY_CONFIG,
    KR_DISCLOSURE_CLASSIFICATION_DATASET_VERSION,
    OPEN_DART_DISCLOSURE_DETAIL_TYPES,
  } = await import(DATASET_MODULE);
  const { classifyDisclosureFiling } = await import(PIPELINE_MODULE);

  for (const detail of OPEN_DART_DISCLOSURE_DETAIL_TYPES) {
    const classified = classifyDisclosureFiling({
      reportName: '분류 기준 검증용 공시',
      disclosureType: detail.type,
      disclosureDetailType: detail.code,
    });

    assert.equal(classified.classificationDatasetVersion, KR_DISCLOSURE_CLASSIFICATION_DATASET_VERSION, detail.code);
    assert.equal(classified.disclosureDetailTypeLabel, detail.label, detail.code);
    assert.ok(classified.classificationReasons.includes(`detail_type:${detail.code}:${detail.mode}`), detail.code);

    if (detail.mode === 'title_required') {
      assert.equal(classified.primaryCategory, 'other', detail.code);
      assert.equal(classified.needsClassifier, true, detail.code);
      assert.equal(classified.classificationConfidence, 'ambiguous', detail.code);
      continue;
    }

    assert.ok(classified.categories.includes(detail.defaultCategory), detail.code);
    assert.equal(classified.needsClassifier, false, detail.code);
    assert.equal(classified.classificationConfidence, 'deterministic', detail.code);
    assert.equal(
      classified.materialityScore,
      KR_DISCLOSURE_CATEGORY_CONFIG[classified.primaryCategory].materiality,
      detail.code,
    );
  }
});

test('curated OpenDART gold corpus locks title variants, ambiguity, risk, materiality, and dump policy', async () => {
  const { KR_DISCLOSURE_CLASSIFICATION_DATASET_VERSION } = await import(DATASET_MODULE);
  const { classifyDisclosureFiling } = await import(PIPELINE_MODULE);
  const gold = await loadGoldFixture();
  const riskRank = { low: 0, medium: 1, high: 2, critical: 3 };

  assert.equal(gold.classificationDatasetVersion, KR_DISCLOSURE_CLASSIFICATION_DATASET_VERSION);
  assert.ok(gold.observedCases.length >= 40);
  assert.ok(gold.riskCases.length >= 35);

  for (const fixture of [...gold.observedCases, ...gold.ambiguousCases]) {
    const classified = classifyDisclosureFiling(fixture.input);
    for (const [key, expected] of Object.entries(fixture.expected)) {
      assert.equal(classified[key], expected, `${fixture.id}:${key}`);
    }
    assert.equal(classified.classificationDatasetVersion, KR_DISCLOSURE_CLASSIFICATION_DATASET_VERSION, fixture.id);
  }

  for (const fixture of gold.riskCases) {
    const classified = classifyDisclosureFiling({ reportName: fixture.reportName });
    assert.equal(classified.primaryCategory, fixture.expectedPrimaryCategory, fixture.reportName);
    assert.ok(
      riskRank[classified.riskLevel] >= riskRank[fixture.minimumRiskLevel],
      `${fixture.reportName}:${classified.riskLevel}`,
    );
    assert.equal(classified.needsClassifier, false, fixture.reportName);
  }
});

test('detail-code mismatches remain traceable instead of silently changing provider provenance', async () => {
  const { classifyDisclosureFiling } = await import(PIPELINE_MODULE);
  const classified = classifyDisclosureFiling({
    reportName: '분류 기준 검증용 공시',
    disclosureType: 'B',
    disclosureDetailType: 'D001',
  });

  assert.equal(classified.primaryCategory, 'ownership');
  assert.equal(classified.disclosureTypeLabel, '주요사항보고');
  assert.equal(classified.disclosureDetailTypeLabel, '주식등의대량보유상황보고서');
  assert.ok(classified.classificationReasons.includes('detail_type_mismatch:B:D'));
});

test('canonical pipeline exposes the dataset version and ambiguous-review count', async () => {
  const { KR_DISCLOSURE_CLASSIFICATION_DATASET_VERSION } = await import(DATASET_MODULE);
  const { buildKrDisclosurePipeline } = await import(PIPELINE_MODULE);
  const pipeline = buildKrDisclosurePipeline({
    requested: { from: '20260701', to: '20260720' },
    summary: { totalCount: 2 },
    filings: [
      {
        rceptNo: 'ambiguous',
        receiptDate: '20260720',
        reportName: '주요사항보고서',
        disclosureType: 'B',
        disclosureDetailType: 'B001',
      },
      {
        rceptNo: 'deterministic',
        receiptDate: '20260719',
        reportName: '유상증자결정',
      },
    ],
  });

  assert.equal(pipeline.classificationDatasetVersion, KR_DISCLOSURE_CLASSIFICATION_DATASET_VERSION);
  assert.equal(pipeline.analysis.summary.ambiguousCount, 1);
  assert.equal(pipeline.analysis.ambiguousCount, 1);
});
