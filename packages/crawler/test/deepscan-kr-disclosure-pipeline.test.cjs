const test = require('node:test');
const assert = require('node:assert/strict');

const PIPELINE_MODULE = '../src/services/deepscan-kr-disclosure-pipeline.js';

function filing(overrides = {}) {
  return {
    rceptNo: '20260601000001',
    receiptDate: '20260601',
    reportName: '분기보고서 (2026.03)',
    corpCode: '00126380',
    stockCode: '005930',
    corpName: '삼성전자',
    filerName: '삼성전자',
    disclosureType: 'A',
    remarks: null,
    documentUrl: 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260601000001',
    raw: { crtfc_key: 'must-not-survive' },
    ...overrides,
  };
}

test('normalization preserves identity-bearing periods while matching relation wrappers', async () => {
  const { normalizeDisclosureFiling } = await import(PIPELINE_MODULE);

  const corrected = normalizeDisclosureFiling(filing({
    reportName: '[기재정정] 분기보고서 (2026.03)',
  }));
  const attached = normalizeDisclosureFiling(filing({
    rceptNo: '20260601000002',
    reportName: '[첨부정정] 분기보고서 (2026.03)',
  }));
  const laterPeriod = normalizeDisclosureFiling(filing({
    rceptNo: '20260601000003',
    reportName: '분기보고서 (2026.06)',
  }));

  assert.equal(corrected.matchName, '분기보고서');
  assert.equal(corrected.identityName, '분기보고서 (2026.03)');
  assert.equal(corrected.isCorrection, true);
  assert.equal(corrected.isAttachment, false);
  assert.equal(attached.isCorrection, true);
  assert.equal(attached.isAttachment, true);
  assert.equal(attached.relationKind, 'attachment_correction');
  assert.notEqual(corrected.identityName, laterPeriod.identityName);
  assert.equal(Object.prototype.hasOwnProperty.call(corrected, 'raw'), false);
});

test('classification implements exact detail semantics, risk dominance, aliases, and fallback', async () => {
  const { classifyDisclosureFiling, normalizeDisclosureFiling } = await import(PIPELINE_MODULE);
  const cases = [
    [{ reportName: '합병 결정', disclosureType: 'C', disclosureDetailType: 'C004' }, 'restructuring', 85, 'medium', 'full_text'],
    [{ reportName: '알림', disclosureType: 'D', disclosureDetailType: 'D001' }, 'ownership', 55, 'low', 'full_text'],
    [{ reportName: '알림', disclosureType: 'D', disclosureDetailType: 'D003' }, 'governance', 35, 'low', 'key_sections'],
    [{ reportName: '알림', disclosureType: 'D', disclosureDetailType: 'D004' }, 'corporate-action', 75, 'medium', 'full_text'],
    [{ reportName: '알림', disclosureType: 'D', disclosureDetailType: 'D999' }, 'ownership', 55, 'low', 'full_text'],
    [{ reportName: '처음 보는 공시', disclosureType: null, disclosureDetailType: null }, 'other', 10, 'low', 'metadata_only'],
  ];

  for (const [input, primaryCategory, materialityScore, riskLevel, dumpPolicy] of cases) {
    const classified = classifyDisclosureFiling(normalizeDisclosureFiling(filing(input)));
    assert.equal(classified.primaryCategory, primaryCategory, JSON.stringify(input));
    assert.equal(classified.materialityScore, materialityScore, JSON.stringify(input));
    assert.equal(classified.riskLevel, riskLevel, JSON.stringify(input));
    assert.equal(classified.dumpPolicy, dumpPolicy, JSON.stringify(input));
  }

  const highRisk = classifyDisclosureFiling(normalizeDisclosureFiling(filing({
    reportName: '[기재정정] 주권매매거래정지해제 (상장폐지에 따른 정리매매 개시)',
    disclosureType: 'D',
    disclosureDetailType: 'D003',
  })));
  assert.equal(highRisk.primaryCategory, 'high-risk');
  assert.equal(highRisk.materialityScore, 100);
  assert.equal(highRisk.materialityLevel, 'critical');
  assert.equal(highRisk.riskLevel, 'critical');
  assert.ok(highRisk.categories.includes('trading-status'));
  assert.ok(highRisk.categories.includes('correction'));
  assert.ok(highRisk.classificationReasons.includes('risk_keyword:terminal-delisting'));
  assert.equal(highRisk.categories.includes('ownership'), false);
});

test('relationships keep separate periods, chain corrections, and suppress related attachments only', async () => {
  const { buildKrDisclosurePipeline } = await import(PIPELINE_MODULE);
  const result = buildKrDisclosurePipeline({
    source: 'opendart',
    requested: { from: '20260101', to: '20260630' },
    summary: { totalCount: 7, hasMore: false },
    filings: [
      filing({ rceptNo: '1', receiptDate: '20260401', reportName: '분기보고서 (2026.03)' }),
      filing({ rceptNo: '2', receiptDate: '20260402', reportName: '[기재정정] 분기보고서 (2026.03)' }),
      filing({ rceptNo: '3', receiptDate: '20260403', reportName: '정정 분기보고서 (2026.03)' }),
      filing({ rceptNo: '4', receiptDate: '20260404', reportName: '[첨부추가] 분기보고서 (2026.03)' }),
      filing({ rceptNo: '5', receiptDate: '20260701', reportName: '분기보고서 (2026.06)' }),
      filing({ rceptNo: '6', receiptDate: '20260401', reportName: '분기보고서 (2026.03)', filerName: '다른 제출인' }),
      filing({ rceptNo: '6', receiptDate: '20260401', reportName: '분기보고서 (2026.03)', filerName: '다른 제출인' }),
    ],
  }, { selectionLimit: 20 });

  assert.equal(result.collection.collectedCount, 7);
  assert.equal(result.collection.canonicalRecordCount, 6);
  const representative = result.selected.find((entry) => entry.rceptNo === '3');
  assert.ok(representative);
  assert.deepEqual(representative.supersedesRceptNos, ['1', '2']);
  assert.deepEqual(representative.relatedRceptNos, ['1', '2', '4']);
  assert.ok(result.selected.some((entry) => entry.rceptNo === '5'));
  assert.ok(result.selected.some((entry) => entry.rceptNo === '6'));
  assert.ok(result.excluded.some((entry) => entry.rceptNo === '4' && entry.reasonCode === 'related_attachment'));
  assert.ok(result.excluded.some((entry) => entry.rceptNo === '1' && entry.reasonCode === 'superseded_original'));
  assert.ok(result.relationships.excluded.some((entry) => entry.reasonCode === 'duplicate_receipt'));
});

test('a correction never supersedes a compatible original that was filed later', async () => {
  const { buildKrDisclosurePipeline } = await import(PIPELINE_MODULE);
  const result = buildKrDisclosurePipeline({
    requested: { to: '20260630' },
    summary: { totalCount: 2 },
    filings: [
      filing({ rceptNo: 'early-correction', receiptDate: '20260401', reportName: '[기재정정] 분기보고서 (2026.03)' }),
      filing({ rceptNo: 'later-original', receiptDate: '20260402', reportName: '분기보고서 (2026.03)' }),
    ],
  }, { selectionLimit: 10 });

  assert.deepEqual(result.selected.map((entry) => entry.rceptNo).sort(), ['early-correction', 'later-original']);
  assert.equal(result.collection.relationshipGroupCount, 2);
  assert.equal(result.relationships.excluded.some((entry) => entry.reasonCode === 'superseded_original'), false);
  assert.deepEqual(result.selected.find((entry) => entry.rceptNo === 'early-correction').supersedesRceptNos, []);
});

test('selection is deterministic and materiality beats recency across the full collected universe', async () => {
  const { buildKrDisclosurePipeline } = await import(PIPELINE_MODULE);
  const candidates = [
    filing({ rceptNo: 'old-risk', receiptDate: '20260101', reportName: '상장폐지에 따른 정리매매 개시', disclosureType: 'I' }),
    filing({ rceptNo: 'new-other', receiptDate: '20260630', reportName: '안내 공시', disclosureType: 'E' }),
    filing({ rceptNo: 'contract', receiptDate: '20260620', reportName: '단일판매 공급계약 체결', disclosureType: 'B' }),
    filing({ rceptNo: 'ownership', receiptDate: '20260625', reportName: '주식등의대량보유상황보고서', disclosureType: 'D', disclosureDetailType: 'D001' }),
  ];
  const options = { selectionLimit: 3, selectedAt: '2026-07-01' };
  const first = buildKrDisclosurePipeline({ requested: {}, summary: { totalCount: 4 }, filings: candidates }, options);
  const second = buildKrDisclosurePipeline({ requested: {}, summary: { totalCount: 4 }, filings: [...candidates].reverse() }, options);

  assert.deepEqual(first.selected, second.selected);
  assert.equal(first.selected[0].rceptNo, 'old-risk');
  assert.equal(first.analysis.count, 3);
  assert.equal(first.analysis.totalCount, 4);
  assert.equal(first.collection.providerTotalCount, 4);
  assert.equal(first.analysis.riskCount, 1);
  assert.ok(first.selected.every((entry) => Array.isArray(entry.selectionReasonCodes)));
  assert.ok(first.excluded.some((entry) => entry.rceptNo === 'new-other' && entry.reasonCode === 'selection_limit'));
});

test('critical overflow is explicit and never lets diversity cross the critical tier', async () => {
  const { buildKrDisclosurePipeline } = await import(PIPELINE_MODULE);
  const result = buildKrDisclosurePipeline({
    requested: { to: '20260630' },
    summary: { totalCount: 3 },
    filings: [
      filing({ rceptNo: 'risk-1', reportName: '상장폐지 결정', receiptDate: '20260601' }),
      filing({ rceptNo: 'risk-2', reportName: '정리매매 개시', receiptDate: '20260602' }),
      filing({ rceptNo: 'periodic', reportName: '사업보고서 (2025.12)', receiptDate: '20260630' }),
    ],
  }, { selectionLimit: 1 });

  assert.equal(result.analysis.state, 'truncated');
  assert.equal(result.analysis.summary.criticalOverflowCount, 1);
  assert.equal(result.selected.length, 1);
  assert.equal(result.selected[0].primaryCategory, 'high-risk');
  assert.ok(result.excluded.some((entry) => entry.reasonCode === 'critical_overflow'));
});

test('analysis creates bounded metadata-only material events without inventing document facts', async () => {
  const { buildKrDisclosurePipeline } = await import(PIPELINE_MODULE);
  const documentOnlySecret = '987654321원 제3자회사 2026년 9월 확정';
  const result = buildKrDisclosurePipeline({
    requested: { from: '20260601', to: '20260630' },
    summary: { totalCount: 2 },
    filings: [
      filing({
        rceptNo: 'contract',
        reportName: `단일판매 공급계약 체결 ${'가'.repeat(280)}`,
        remarks: '계약 조건 확인 필요',
        documentFixture: documentOnlySecret,
      }),
      filing({ rceptNo: 'bad', reportName: '', remarks: null, disclosureType: 'B' }),
    ],
  });

  const event = result.analysis.materialEvents.find((entry) => entry.rceptNo === 'contract');
  assert.ok(event);
  assert.ok([...event.keyFact].length <= 240);
  assert.equal(event.evidenceScope, 'filing_metadata');
  assert.equal(event.analysisState, 'metadata_only');
  assert.doesNotMatch(event.keyFact, /987654321|제3자회사|9월 확정/);
  assert.ok(event.verificationConditions.length <= 3);
  assert.equal(JSON.stringify(result).includes(documentOnlySecret), false);
});

test('document dump keeps long filings through deterministic key-section extraction and exact total budget', async () => {
  const { buildKrDisclosurePipeline, buildKrDisclosureLlmDump } = await import(PIPELINE_MODULE);
  const pipeline = buildKrDisclosurePipeline({
    requested: { to: '20260630' },
    summary: { totalCount: 3 },
    filings: [
      filing({ rceptNo: 'long', reportName: '기업지배구조보고서', disclosureType: 'D', disclosureDetailType: 'D003' }),
      filing({ rceptNo: 'short', reportName: '단일판매 공급계약 체결', receiptDate: '20260531', disclosureType: 'B' }),
      filing({ rceptNo: 'meta', reportName: '기타 안내', receiptDate: '20260530', disclosureType: 'E' }),
    ],
  });
  const longText = `${'머리말 '.repeat(80)}\n감사위원회 주요 활동\n${'핵심 '.repeat(80)}\n${'꼬리 '.repeat(80)}`;
  const dump = buildKrDisclosureLlmDump(pipeline.selected, [
    { rceptNo: 'long', document: { text: longText, charCount: [...longText].length, wordishCount: 240 } },
    { rceptNo: 'short', document: { text: '계약 체결 본문', charCount: 8, wordishCount: 3 } },
  ], { maxCharsPerFiling: 120, maxTotalChars: 360, limit: 3 });

  assert.equal(dump.available, true);
  assert.ok(['complete', 'partial'].includes(dump.state));
  assert.ok(dump.combinedCharCount <= 360);
  assert.equal(dump.skippedTooLongCount, 0);
  assert.equal(dump.extractedLongCount, 1);
  assert.equal(dump.included.some((entry) => Object.prototype.hasOwnProperty.call(entry, 'text')), false);
  assert.equal(dump.filings.some((entry) => entry.rceptNo === 'long'), true);
  assert.match(dump.filings.find((entry) => entry.rceptNo === 'long').text, /감사위원회/);
  assert.ok(dump.excluded.some((entry) => entry.rceptNo === 'meta' && entry.reason === 'metadata_only_policy'));
});

test('document dump retains peers after fetch/resource failures and derives compatibility counters', async () => {
  const { buildKrDisclosurePipeline, buildKrDisclosureLlmDump } = await import(PIPELINE_MODULE);
  const pipeline = buildKrDisclosurePipeline({
    requested: { to: '20260630' },
    summary: { totalCount: 3 },
    filings: [
      filing({ rceptNo: 'ok', reportName: '유상증자 결정' }),
      filing({ rceptNo: 'fail', reportName: '합병 결정' }),
      filing({ rceptNo: 'resource', reportName: '소송 제기' }),
    ],
  });
  const dump = buildKrDisclosureLlmDump(pipeline.selected, [
    { rceptNo: 'ok', document: { text: '정상 본문', charCount: 5, wordishCount: 2 } },
    { rceptNo: 'fail', error: { code: 'provider_http_error', message: 'crtfc_key=top-secret' } },
    { rceptNo: 'resource', error: { code: 'document_resource_limited', message: 'api_key=top-secret' } },
  ], { maxCharsPerFiling: 100, maxTotalChars: 1000, limit: 3 });

  assert.equal(dump.state, 'partial');
  assert.equal(dump.includedCount, 1);
  assert.equal(dump.failedCount, 2);
  assert.equal(dump.skippedUnavailableCount, 2);
  assert.equal(dump.skippedTooLongCount, 0);
  assert.equal(JSON.stringify(dump).includes('top-secret'), false);
  assert.ok(dump.excluded.some((entry) => entry.reason === 'resource_limited'));
});

test('document dump exposes disabled, all-budget-excluded, and tiny per-filing boundaries exactly', async () => {
  const { buildKrDisclosurePipeline, buildKrDisclosureLlmDump } = await import(PIPELINE_MODULE);
  const pipeline = buildKrDisclosurePipeline({
    requested: { to: '20260630' },
    summary: { totalCount: 1 },
    filings: [filing({ rceptNo: 'bounded', reportName: '단일판매 공급계약 체결' })],
  });

  const disabled = buildKrDisclosureLlmDump(pipeline.selected, [], { enabled: false });
  assert.equal(disabled.state, 'disabled');
  assert.equal(disabled.available, false);
  assert.equal(disabled.failedCount, 0);
  assert.equal(disabled.skippedCount, 1);
  assert.equal(disabled.excluded[0].reason, 'not_requested');

  const allBudgetExcluded = buildKrDisclosureLlmDump(pipeline.selected, [
    { rceptNo: 'bounded', document: { text: '본문', charCount: 2, wordishCount: 1 } },
  ], { maxCharsPerFiling: 10, maxTotalChars: 1, limit: 1 });
  assert.equal(allBudgetExcluded.state, 'partial');
  assert.equal(allBudgetExcluded.available, false);
  assert.equal(allBudgetExcluded.failedCount, 0);
  assert.equal(allBudgetExcluded.budgetExcludedCount, 1);

  const tinyPerFiling = buildKrDisclosureLlmDump(pipeline.selected, [
    { rceptNo: 'bounded', document: { text: '가나다라마바사', charCount: 7, wordishCount: 1 } },
  ], { maxCharsPerFiling: 1, maxTotalChars: 200, limit: 1 });
  assert.equal(tinyPerFiling.includedCount, 1);
  assert.equal(tinyPerFiling.filings[0].charCount, 1);
  assert.equal([...tinyPerFiling.filings[0].text].length, 1);
});

test('canonical debug projection removes compatibility aliases and duplicates text only in canonical dump fields', async () => {
  const { createDisclosureDebugProjection } = await import(PIPELINE_MODULE);
  const llmDump = {
    state: 'complete',
    available: true,
    filings: [{ rceptNo: '1', text: '본문' }],
    combinedText: '[1]\n본문',
  };
  const source = {
    summary: { totalCount: 1 },
    filings: [{ rceptNo: '1' }],
    disclosurePipeline: { schemaVersion: 'jaroo.deepscan.kr-disclosure-pipeline.v1', llmDump },
    documentDump: llmDump,
    apiKey: 'secret',
  };
  const projected = createDisclosureDebugProjection(source);
  const serialized = JSON.stringify(projected);

  assert.equal(Object.prototype.hasOwnProperty.call(projected, 'documentDump'), false);
  assert.equal((serialized.match(/combinedText/g) ?? []).length, 1);
  assert.equal(serialized.includes('secret'), false);
});

test('empty and unavailable sources remain distinct across analysis and dump states', async () => {
  const {
    buildKrDisclosureLlmDump,
    buildKrDisclosurePipeline,
    createUnavailableKrDisclosurePipeline,
  } = await import(PIPELINE_MODULE);
  const empty = buildKrDisclosurePipeline({
    requested: { from: '20260601', to: '20260630' },
    summary: { totalCount: 0, hasMore: false },
    filings: [],
  });
  const emptyDump = buildKrDisclosureLlmDump(empty.selected, []);
  const unavailable = createUnavailableKrDisclosurePipeline({
    requested: { from: '20260601', to: '20260630' },
    issue: { code: 'provider_unconfigured' },
  });

  assert.equal(empty.collection.state, 'empty');
  assert.equal(empty.analysis.state, 'empty');
  assert.equal(empty.analysis.available, true);
  assert.equal(emptyDump.state, 'metadata_only');
  assert.equal(emptyDump.available, false);
  assert.equal(unavailable.collection.state, 'unavailable');
  assert.equal(unavailable.analysis.state, 'unavailable');
  assert.equal(unavailable.analysis.available, false);
  assert.equal(unavailable.llmDump.state, 'unavailable');
  assert.equal(unavailable.llmDump.available, false);
});
