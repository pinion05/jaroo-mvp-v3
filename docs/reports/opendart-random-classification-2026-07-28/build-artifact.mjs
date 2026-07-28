import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sourceData = JSON.parse(await readFile(resolve(here, 'source-data.json'), 'utf8'));
const qualitativeReview = JSON.parse(await readFile(resolve(here, 'qualitative-review.json'), 'utf8'));

const EVENT_TYPE_LABELS = {
  'capital-change': '자본변동',
  'ownership-change': '지분변동',
  governance: '지배구조',
  'corporate-action': '주주·자본행위',
  'periodic-report': '정기보고',
  'related-party': '특수관계자 거래',
  'corporate-event': '기업 이벤트',
  restructuring: '구조개편',
  earnings: '실적',
  'supplier-payment': '하도급대금',
  'trading-status': '거래상태',
  insolvency: '회생·도산',
  'operating-status': '영업상태',
};

const CONFIDENCE_LABELS = { high: '높음', medium: '중간', low: '낮음', unresolved: '미분류' };
const REVIEW_LABELS = {
  plausible: '의미상 타당',
  questionable: '재검토 필요',
  unassessable: '평가 불가',
};

function pct(numerator, denominator) {
  return denominator ? numerator / denominator : 0;
}

function displayDate(value) {
  const text = String(value ?? '');
  return /^\d{8}$/u.test(text)
    ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`
    : text;
}

function eventSummary(entry) {
  const events = entry.eventExtraction?.events ?? [];
  if (!events.length) return '본문 미확보';
  return events.map((event) => [
    event.type,
    event.action,
    event.state,
    event.cause,
    event.subjectType,
  ].map((value) => value ?? 'null').join(' · ')).join(' / ');
}

function reviewMap() {
  return new Map(qualitativeReview.cases.map((entry) => [entry.rceptNo, entry]));
}

const reviews = reviewMap();
const summary = sourceData.resultSummary;
const sourceSummary = sourceData.sourceSummary;
const correctionCases = sourceData.results.filter((entry) => /^\[(?:기재정정|첨부정정)/u.test(entry.source.reportName));
const correctionAvailable = correctionCases.filter((entry) => entry.document);
const correctionResolved = correctionAvailable.filter((entry) => entry.eventExtraction?.resolved);
const available = sourceData.results.filter((entry) => entry.document);
const highConfidence = available.filter((entry) => entry.eventExtraction?.confidence === 'high').length;
const assessableReviewCount = qualitativeReview.aggregate.plausible + qualitativeReview.aggregate.questionable;

const eventTypeRows = Object.entries(summary.eventTypeCounts).map(([eventType, count]) => ({
  eventType,
  eventTypeLabel: EVENT_TYPE_LABELS[eventType] ?? eventType,
  count,
  share: pct(count, summary.extractedEventCount),
}));

const confidenceRows = Object.entries(summary.eventConfidenceCounts).map(([confidence, count]) => ({
  confidence,
  confidenceLabel: CONFIDENCE_LABELS[confidence] ?? confidence,
  count,
  share: pct(count, summary.documentAvailableCount),
}));

const correctionStageRows = [
  { stage: '무작위 표본의 정정 공시', count: correctionCases.length, stageOrder: 1 },
  { stage: '본문 확보', count: correctionAvailable.length, stageOrder: 2 },
  { stage: 'canonical event 생성', count: correctionResolved.length, stageOrder: 3 },
];

const reviewOutcomeRows = [
  { outcome: '의미상 타당', count: qualitativeReview.aggregate.plausible, outcomeOrder: 1 },
  { outcome: '재검토 필요', count: qualitativeReview.aggregate.questionable, outcomeOrder: 2 },
  { outcome: '평가 불가', count: qualitativeReview.aggregate.unassessable, outcomeOrder: 3 },
];

const headlineRows = [{
  selectedCount: sourceSummary.selectedCount,
  uniqueIssuerCount: sourceSummary.uniqueIssuerCount,
  selectedDetailTypeCount: sourceSummary.selectedDetailTypeCount,
  documentAvailableRate: pct(summary.documentAvailableCount, sourceSummary.selectedCount),
  resolvedRateAmongAvailable: summary.resolvedRateAmongAvailable,
  plausibleRateAmongAssessable: pct(qualitativeReview.aggregate.plausible, assessableReviewCount),
  correctionDocumentAvailableRate: pct(correctionAvailable.length, correctionCases.length),
  highConfidenceRate: pct(highConfidence, summary.documentAvailableCount),
}];

const allResultRows = sourceData.results.map((entry) => {
  const review = reviews.get(entry.source.rceptNo);
  return {
    filingLabel: `${displayDate(entry.source.receiptDate)} · ${entry.source.corpName} · ${entry.source.disclosureDetailType} · ${entry.source.reportName.trim()} · ${entry.source.rceptNo}`,
    classificationLabel: `${entry.filingClassification.primaryCategory} | ${eventSummary(entry)} | ${entry.eventExtraction?.confidence ?? 'unresolved'} | ${REVIEW_LABELS[review?.verdict] ?? '미검토'}`,
    receiptDate: displayDate(entry.source.receiptDate),
    corpName: entry.source.corpName,
    stockCode: entry.source.stockCode || '-',
    detailType: entry.source.disclosureDetailType,
    reportName: entry.source.reportName.trim(),
    filingCategory: entry.filingClassification.primaryCategory,
    eventSummary: eventSummary(entry),
    confidence: entry.eventExtraction?.confidence ?? 'unresolved',
    review: REVIEW_LABELS[review?.verdict] ?? '미검토',
    reviewNote: review?.note ?? '',
    rceptNo: entry.source.rceptNo,
    filingUrl: entry.source.filingUrl,
  };
});

const ambiguousRows = sourceData.results
  .filter((entry) => entry.filingClassification.needsClassifier)
  .map((entry) => ({
    filingLabel: `${displayDate(entry.source.receiptDate)} · ${entry.source.corpName} · ${entry.source.reportName.trim()}`,
    classificationLabel: `${eventSummary(entry)} | ${entry.eventExtraction?.confidence ?? 'unresolved'}`,
    receiptDate: displayDate(entry.source.receiptDate),
    corpName: entry.source.corpName,
    reportName: entry.source.reportName.trim(),
    metadataCategory: entry.filingClassification.primaryCategory,
    extractedEvents: eventSummary(entry),
    eventConfidence: entry.eventExtraction?.confidence ?? 'unresolved',
    rceptNo: entry.source.rceptNo,
  }));

const issueRows = qualitativeReview.cases
  .filter((entry) => entry.verdict !== 'plausible')
  .map((entry) => {
    const result = sourceData.results.find((candidate) => candidate.source.rceptNo === entry.rceptNo);
    return {
      filingLabel: `${result?.source.corpName ?? entry.corpName ?? '-'} · ${result?.source.reportName?.trim() ?? entry.reportName ?? '-'}`,
      caseLabel: `${REVIEW_LABELS[entry.verdict]} · ${result?.source.corpName ?? entry.corpName ?? '-'} · ${result?.source.reportName?.trim() ?? entry.reportName ?? '-'} · ${entry.rceptNo}`,
      verdict: REVIEW_LABELS[entry.verdict],
      corpName: result?.source.corpName ?? entry.corpName ?? '-',
      reportName: result?.source.reportName?.trim() ?? entry.reportName ?? '-',
      eventSummary: result ? eventSummary(result) : '-',
      note: entry.note,
      rceptNo: entry.rceptNo,
    };
  });

const representativeReceiptNos = new Set([
  ...qualitativeReview.cases.filter((entry) => entry.verdict === 'questionable').map((entry) => entry.rceptNo),
  ...sourceData.results.filter((entry) => (entry.eventExtraction?.events?.length ?? 0) > 1).map((entry) => entry.source.rceptNo),
  ...ambiguousRows.slice(0, 5).map((entry) => entry.rceptNo),
  ...correctionAvailable.slice(0, 5).map((entry) => entry.source.rceptNo),
]);
const representativeRows = allResultRows.filter((entry) => representativeReceiptNos.has(entry.rceptNo));

const openDartSource = {
  id: 'opendart_live_sample',
  label: 'OpenDART KOSPI seeded random sample',
  path: 'source-data.json',
  href: 'https://opendart.fss.or.kr/',
  query: {
    engine: 'DuckDB',
    language: 'SQL',
    sql: "SELECT * FROM read_json_auto('source-data.json')",
    description: 'Exact seeded OpenDART sample and classifier outputs. Report datasets are reproducibly projected by build-artifact.mjs.',
    executed_at: sourceData.generatedAt,
    tables_used: ['source-data.json'],
    filters: [
      'corp_cls=Y (KOSPI)',
      `receipt date ${sourceData.methodology.from} through ${sourceData.methodology.to}`,
      `seed=${sourceData.methodology.seed}`,
      `target=${sourceData.methodology.targetCount}`,
      'one random case per available detail type before seeded fill',
    ],
    metric_definitions: [
      '본문 확보율 = document.xml 본문을 안전 제한 내에서 읽은 공시 수 / 전체 표본 수',
      '이벤트 생성률 = canonical events가 하나 이상 생성된 공시 수 / 본문 확보 공시 수',
      '신뢰도는 분류기 내부 근거 등급이며 실제 정확도 확률이 아니다',
    ],
  },
};

const reviewSource = {
  id: 'qualitative_review',
  label: 'Four-way Codex qualitative plausibility review',
  path: 'qualitative-review.json',
  query: {
    engine: 'DuckDB',
    language: 'SQL',
    sql: "SELECT * FROM read_json_auto('qualitative-review.json')",
    description: 'Exact four-slice qualitative review decisions. Report rows are reproducibly projected by build-artifact.mjs.',
    executed_at: qualitativeReview.generatedAt,
    tables_used: ['qualitative-review.json'],
    filters: [
      'all 150 sampled filings reviewed in four disjoint index ranges',
      'title, OpenDART detail type, canonical tuple, and official body when needed',
      'plausibility review only; no blinded gold labels',
    ],
    metric_definitions: [
      '의미상 타당 = available evidence did not reveal a semantic contradiction',
      '재검토 필요 = reviewer found a concrete semantic mismatch or unstable ontology boundary',
      '평가 불가 = source body was unavailable, so event correctness could not be assessed',
    ],
  },
};

const artifact = {
  surface: 'report',
  manifest: {
    version: 1,
    surface: 'report',
    title: 'OpenDART 무작위 공시 분류 스트레스 테스트',
    description: '최근 90일 KOSPI 공식 공시 150건을 무작위·다양성 표본으로 수집해 Jaroo canonical event extractor v8에 통과시킨 결과 보고서.',
    generatedAt: sourceData.generatedAt,
    cards: [
      {
        id: 'sample_count',
        description: '최근 90일 KOSPI 공시에서 추출한 재현 가능한 다양성 표본.',
        dataset: 'headline',
        sourceId: 'opendart_live_sample',
        metrics: [{ label: '분류 투입 공시', field: 'selectedCount', format: 'number' }],
      },
      {
        id: 'issuer_count',
        description: '표본에 포함된 서로 다른 KOSPI 발행사 수.',
        dataset: 'headline',
        sourceId: 'opendart_live_sample',
        metrics: [{ label: '기업 수', field: 'uniqueIssuerCount', format: 'number' }],
      },
      {
        id: 'detail_count',
        description: '실제 표본에 포함된 OpenDART 세부 공시유형 수.',
        dataset: 'headline',
        sourceId: 'opendart_live_sample',
        metrics: [{ label: '세부유형 수', field: 'selectedDetailTypeCount', format: 'number' }],
      },
      {
        id: 'body_availability',
        description: '안전 리소스 한도 안에서 document.xml 본문을 확보한 비율.',
        dataset: 'headline',
        sourceId: 'opendart_live_sample',
        metrics: [{ label: '본문 확보율', field: 'documentAvailableRate', format: 'percent' }],
      },
      {
        id: 'event_coverage',
        description: '본문 확보 공시 중 canonical event가 하나 이상 생성된 비율. 정확도가 아니라 출력 커버리지다.',
        dataset: 'headline',
        sourceId: 'opendart_live_sample',
        metrics: [{ label: '이벤트 생성률', field: 'resolvedRateAmongAvailable', format: 'percent' }],
      },
      {
        id: 'plausibility_rate',
        description: '정성평가 가능한 공시 중 구체적인 의미 모순이 발견되지 않은 비율. 블라인드 정확도가 아니다.',
        dataset: 'headline',
        sourceId: 'qualitative_review',
        metrics: [{ label: '정성 타당 비율', field: 'plausibleRateAmongAssessable', format: 'percent' }],
      },
    ],
    charts: [
      {
        id: 'event_type_distribution',
        title: 'Canonical event 유형별 건수',
        subtitle: `본문 확보 ${summary.documentAvailableCount}건에서 생성된 ${summary.extractedEventCount}개 이벤트`,
        type: 'bar',
        dataset: 'event_types',
        sourceId: 'opendart_live_sample',
        encodings: {
          x: { field: 'eventTypeLabel', type: 'nominal', label: '이벤트 유형' },
          y: { field: 'count', type: 'quantitative', label: '이벤트 수', format: 'number' },
          tooltip: [{ field: 'share', type: 'quantitative', label: '구성비', format: 'percent' }],
        },
        valueFormat: 'number',
        layout: 'full',
        settings: { orientation: 'horizontal', sort: 'descending', showValues: true, categoryLabelPolicy: 'wrap' },
        palette: { kind: 'sequential', root: 'blue' },
      },
      {
        id: 'correction_stages',
        title: '정정 공시 처리 단계',
        subtitle: `무작위 표본의 정정 공시 ${correctionCases.length}건; 본문 확보 실패 ${correctionCases.length - correctionAvailable.length}건`,
        type: 'bar',
        dataset: 'correction_stages',
        sourceId: 'opendart_live_sample',
        encodings: {
          x: { field: 'stage', type: 'ordinal', label: '처리 단계' },
          y: { field: 'count', type: 'quantitative', label: '공시 수', format: 'number' },
        },
        valueFormat: 'number',
        layout: 'full',
        settings: { orientation: 'vertical', sort: 'none', showValues: true, categoryLabelPolicy: 'wrap' },
        palette: { kind: 'sequential', root: 'orange' },
      },
      {
        id: 'review_outcomes',
        title: '정성 의미 검토 결과',
        subtitle: `150건 전체를 4개 독립 범위로 검토; 평가 가능 ${assessableReviewCount}건`,
        type: 'bar',
        dataset: 'review_outcomes',
        sourceId: 'qualitative_review',
        encodings: {
          x: { field: 'outcome', type: 'nominal', label: '판정' },
          y: { field: 'count', type: 'quantitative', label: '공시 수', format: 'number' },
        },
        valueFormat: 'number',
        layout: 'full',
        settings: { orientation: 'horizontal', sort: 'none', showValues: true },
        palette: { kind: 'categorical', roots: ['blue', 'orange', 'gold'] },
      },
    ],
    tables: [
      {
        id: 'ambiguous_cases',
        title: '메타데이터 단계에서 모호했던 공시',
        subtitle: `메타데이터 분류가 ambiguous였지만 본문 이벤트 추출이 완료된 ${ambiguousRows.length}건`,
        dataset: 'ambiguous_cases',
        sourceId: 'opendart_live_sample',
        defaultSort: { field: 'filingLabel', direction: 'desc' },
        density: 'spacious',
        layout: 'full',
        columns: [
          { field: 'filingLabel', label: '공시', type: 'text' },
          { field: 'classificationLabel', label: '추출 이벤트 · 신뢰도', type: 'text' },
        ],
      },
      {
        id: 'review_issues',
        title: '재검토 및 평가 불가 사례',
        subtitle: '정성 검토에서 구체적 의미 이슈가 발견됐거나 본문 확보 실패로 판단할 수 없었던 사례',
        dataset: 'review_issues',
        sourceId: 'qualitative_review',
        defaultSort: { field: 'caseLabel', direction: 'desc' },
        density: 'spacious',
        layout: 'full',
        columns: [
          { field: 'caseLabel', label: '판정 · 공시', type: 'text' },
          { field: 'note', label: '검토 메모', type: 'text' },
        ],
      },
      {
        id: 'representative_cases',
        title: '대표·경계 사례',
        subtitle: '다중 이벤트, 메타데이터 모호성, 정정 공시, 재검토 사례를 함께 표시',
        dataset: 'representative_cases',
        sourceId: 'opendart_live_sample',
        defaultSort: { field: 'filingLabel', direction: 'desc' },
        density: 'spacious',
        layout: 'full',
        columns: [
          { field: 'filingLabel', label: '공시', type: 'text' },
          { field: 'classificationLabel', label: 'Canonical events · 신뢰도 · 정성 판정', type: 'text' },
        ],
      },
      {
        id: 'all_results',
        title: '150건 전체 분류 결과',
        subtitle: '접수일 내림차순으로 정렬 가능한 전체 감사 테이블',
        dataset: 'all_results',
        sourceId: 'opendart_live_sample',
        defaultSort: { field: 'filingLabel', direction: 'desc' },
        density: 'dense',
        layout: 'full',
        columns: [
          { field: 'filingLabel', label: '공시', type: 'text' },
          { field: 'classificationLabel', label: '분류 결과 · 신뢰도 · 정성 판정', type: 'text' },
        ],
      },
    ],
    sources: [openDartSource, reviewSource],
    blocks: [
      { id: 'title', type: 'markdown', body: '# OpenDART 무작위 공시 분류 스트레스 테스트' },
      {
        id: 'executive_summary',
        type: 'markdown',
        body: `## Executive Summary\n\n- **가용 본문에서는 출력 커버리지가 높았습니다.** 최근 90일 KOSPI 공시 ${sourceSummary.selectedCount}건을 투입했고, 본문을 확보한 ${summary.documentAvailableCount}건 모두에서 canonical event가 생성됐습니다.\n- **분류 결과는 다양하게 분리됐습니다.** ${summary.extractedEventCount}개 이벤트가 ${eventTypeRows.length}개 유형으로 나뉘었고, 자본변동·지분변동 외에도 지배구조, 구조개편, 거래상태, 회생·도산까지 포착했습니다.\n- **가장 큰 병목은 분류기가 아니라 문서 수집입니다.** ${summary.documentUnavailableCount}건은 본문을 읽지 못했으며, 정정 공시 ${correctionCases.length}건 중 ${correctionCases.length - correctionAvailable.length}건이 이 구간에 몰렸습니다.\n- **이는 정확도 증명이 아닙니다.** prediction-blind 정답 라벨이 없는 live 표본이므로, 아래 수치는 출력 커버리지와 정성적 타당성 점검 결과입니다.`,
        layout: 'full',
      },
      { id: 'headline_metrics', type: 'metric-strip', cardIds: ['sample_count', 'issuer_count', 'detail_count', 'body_availability', 'event_coverage', 'plausibility_rate'] },
      {
        id: 'coverage_finding',
        type: 'markdown',
        sourceId: 'opendart_live_sample',
        body: `## 본문을 읽은 138건은 모두 이벤트 객체로 변환됐다\n\n**출력 커버리지는 100%였지만, 고신뢰 비중은 ${highConfidence}/${summary.documentAvailableCount}(${(pct(highConfidence, summary.documentAvailableCount) * 100).toFixed(1)}%)로 보수적이었습니다.** 나머지는 medium으로 유지됐고 low나 unresolved 출력은 없었습니다. 이는 분류기가 무리하게 high를 남발하지 않으면서도 canonical tuple을 구성했다는 신호입니다. 다만 confidence는 내부 근거 등급이지 실제 정답 확률은 아닙니다.`,
        layout: 'full',
      },
      {
        id: 'event_distribution_context',
        type: 'markdown',
        sourceId: 'opendart_live_sample',
        body: `## 자본·지분 공시가 절반 가까이를 차지했지만 유형 폭은 넓었다\n\n자본변동 ${summary.eventTypeCounts['capital-change'] ?? 0}개와 지분변동 ${summary.eventTypeCounts['ownership-change'] ?? 0}개가 가장 많았습니다. 동시에 거래정지·해제, 중대재해와 작업중지, 회생절차, 구조개편처럼 lifecycle과 subject 구분이 필요한 이벤트도 생성됐습니다. **무작위 표본이 특정 정정 양식만 반복한 테스트가 아니라는 점은 긍정적입니다.**`,
        layout: 'full',
      },
      { id: 'event_distribution_chart', type: 'chart', chartId: 'event_type_distribution', layout: 'full' },
      {
        id: 'correction_bottleneck',
        type: 'markdown',
        sourceId: 'opendart_live_sample',
        body: `## 정정 분류보다 앞단의 document.xml 수집 제한이 더 큰 병목이다\n\n정정 공시는 ${correctionCases.length}건이 뽑혔지만 본문 확보는 ${correctionAvailable.length}건(${(pct(correctionAvailable.length, correctionCases.length) * 100).toFixed(1)}%)에 그쳤습니다. 확보된 ${correctionResolved.length}건은 모두 분류됐고, updated뿐 아니라 cancelled, price-set, scheduled, halted, lifted를 구분했습니다. 반면 미확보 ${correctionCases.length - correctionAvailable.length}건 중 대부분은 대형 ZIP 압축해제 제한이 원인이었습니다. **실사용 커버리지를 높이려면 parser 규칙 추가보다 안전한 대용량 문서 처리·대체 본문 경로가 먼저입니다.**`,
        layout: 'full',
      },
      { id: 'correction_stage_chart', type: 'chart', chartId: 'correction_stages', layout: 'full' },
      {
        id: 'metadata_bridge',
        type: 'markdown',
        sourceId: 'opendart_live_sample',
        body: `## 메타데이터에서 모호했던 9건을 본문 이벤트 게이트가 구체화했다\n\n공정공시의 장래사업계획, IR 개최, 중대재해처럼 세부코드만으로는 category가 other/ambiguous였던 ${ambiguousRows.length}건이 모두 구체 이벤트로 변환됐습니다. 예를 들어 중대재해 공시는 사고 발생과 부분 작업중지 명령을 각각 독립 이벤트로 남겼습니다. **파일링 분류와 canonical event 추출을 분리한 현재 구조가 실제로 보완 효과를 냈습니다.**`,
        layout: 'full',
      },
      { id: 'ambiguous_table_block', type: 'table', tableId: 'ambiguous_cases', layout: 'full' },
      {
        id: 'qualitative_finding',
        type: 'markdown',
        sourceId: 'qualitative_review',
        body: `## 정성 검토에서는 ${qualitativeReview.aggregate.questionable}건이 구체적 재검토 대상으로 남았다\n\n4개 분리 범위에서 전체 ${sourceSummary.selectedCount}건을 검토했습니다. 평가 가능한 ${assessableReviewCount}건 중 ${qualitativeReview.aggregate.plausible}건은 제목·세부유형·본문과 canonical tuple 사이에서 명백한 모순이 발견되지 않았습니다. ${qualitativeReview.aggregate.questionable}건은 구체적인 의미 불일치 또는 ontology 경계 문제로 표시했고, ${qualitativeReview.aggregate.unassessable}건은 본문 미확보 때문에 판단하지 않았습니다. **이 결과는 정확도 통계가 아니라 다음 수정 대상을 찾기 위한 plausibility audit입니다.**`,
        layout: 'full',
      },
      { id: 'review_outcome_chart', type: 'chart', chartId: 'review_outcomes', layout: 'full' },
      { id: 'review_issue_table', type: 'table', tableId: 'review_issues', layout: 'full' },
      {
        id: 'case_context',
        type: 'markdown',
        body: `## 대표 사례는 단일 이벤트뿐 아니라 독립 occurrence도 보존했다\n\n교보증권 일괄신고추가서류의 동일 tuple 2개는 실제 서로 다른 K-ELS 25회·26회를 반영했습니다. HD현대중공업 중대재해는 사고 발생과 부분 작업중지 명령을 분리했고, 동아지질 공시는 거래정지와 다음 날 해제를 각각 남겼습니다. 반면 정성 검토에서 표시된 사례들은 아래 표에서 원인과 함께 확인할 수 있습니다.`,
        layout: 'full',
      },
      { id: 'representative_table_block', type: 'table', tableId: 'representative_cases', layout: 'full' },
      {
        id: 'recommendations',
        type: 'markdown',
        body: `## 다음 개발 우선순위\n\n1. **document.xml 대용량 fallback을 먼저 보강합니다.** 리소스 한도를 무작정 완화하지 말고 ZIP entry별 streaming, 필요한 XML 우선 추출, 안전한 최대치 정책을 설계해야 합니다.\n2. **정성 검토의 concrete mismatch를 회귀 케이스로 고정합니다.** 각 사례는 현재 tuple과 원문 근거를 함께 저장해 같은 오분류가 재발하지 않게 해야 합니다.\n3. **새로운 prediction-blind 홀드아웃을 별도로 봉인합니다.** 이 live 표본을 수정에 사용한 뒤 정확도 검증셋으로 재사용하면 안 됩니다.\n4. **파일링 category와 canonical event의 역할 차이를 UI에 명시합니다.** category=other여도 본문 event가 구체화될 수 있으므로 사용자에게 두 층을 혼동시키지 않아야 합니다.`,
        layout: 'full',
      },
      {
        id: 'further_questions',
        type: 'markdown',
        body: `## 추가로 답해야 할 질문\n\n- 대형 사업·반기보고서 전체를 읽지 않고도 필요한 정정 표와 핵심 섹션만 안전하게 가져올 수 있는가?\n- 동일 canonical tuple이 여러 번 나온 경우 실제 독립 occurrence인지 자동으로 설명 가능한가?\n- 현재 medium confidence가 과도하게 넓은데, 근거 종류별 calibration을 분리하면 사용자 신뢰도를 더 잘 표현할 수 있는가?\n- 새로 봉인할 홀드아웃은 correction, I계열 수시공시, 대형 증권신고를 각각 충분히 포함하는가?`,
        layout: 'full',
      },
      {
        id: 'caveats',
        type: 'markdown',
        body: `## 해석 시 주의사항\n\n- 기간은 2026년 4월 29일부터 7월 27일까지이며 KOSPI(corp_cls=Y)만 포함합니다.\n- 61개 설정 세부유형 중 해당 기간에 실제 KOSPI 목록이 있었던 27개만 표본에 포함됐습니다.\n- 표본은 seed를 고정했지만, OpenDART가 과거 목록을 정정하면 동일 API 호출 결과가 달라질 수 있습니다.\n- 정성 검토자는 모델 출력과 원문을 볼 수 있었고 prediction-blind gold annotation이 아닙니다. 따라서 정성 타당 비율을 정확도로 해석하면 안 됩니다.\n- 본문은 분류 시 최대 80,000자로 제한됐고 ${available.filter((entry) => entry.document.bodyTruncated).length}건은 잘렸습니다.`,
        layout: 'full',
      },
      { id: 'all_results_context', type: 'markdown', body: '## 전체 결과 감사표\n\n아래 표는 150건 전체의 파일링 분류, canonical event, 내부 신뢰도, 정성 판정을 한 번에 확인하기 위한 상세 자료입니다.' },
      { id: 'all_results_table_block', type: 'table', tableId: 'all_results', layout: 'full' },
    ],
  },
  snapshot: {
    version: 1,
    generatedAt: sourceData.generatedAt,
    status: 'ready',
    datasets: {
      headline: headlineRows,
      event_types: eventTypeRows,
      confidence: confidenceRows,
      correction_stages: correctionStageRows,
      review_outcomes: reviewOutcomeRows,
      ambiguous_cases: ambiguousRows,
      review_issues: issueRows,
      representative_cases: representativeRows,
      all_results: allResultRows,
    },
  },
  sources: [openDartSource, reviewSource],
};

const chartMap = {
  generatedAt: new Date().toISOString(),
  charts: [
    {
      section: '이벤트 유형 폭',
      question: '무작위 표본이 어떤 canonical event 유형으로 분리됐는가?',
      family: 'Comparison & Ranking',
      type: 'bar',
      fields: ['eventTypeLabel', 'count', 'share'],
      takeaway: '자본·지분이 크지만 13개 유형이 관찰됨',
      palette: 'single-root blue',
    },
    {
      section: '정정 공시 처리 병목',
      question: '정정 공시는 어느 단계에서 손실되는가?',
      family: 'Progression',
      type: 'bar',
      fields: ['stage', 'count'],
      takeaway: '분류보다 본문 수집에서 손실이 발생함',
      palette: 'single-root orange',
    },
    {
      section: '정성 검토',
      question: '의미상 타당·재검토·평가불가가 어떻게 분포하는가?',
      family: 'Composition',
      type: 'bar',
      fields: ['outcome', 'count'],
      takeaway: '구체적 이슈와 본문 미확보를 성공 출력과 분리함',
      palette: 'three-category blue/orange/gold',
    },
  ],
};

await writeFile(resolve(here, 'artifact.json'), `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
await writeFile(resolve(here, 'chart-map.json'), `${JSON.stringify(chartMap, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  artifact: resolve(here, 'artifact.json'),
  datasets: Object.fromEntries(Object.entries(artifact.snapshot.datasets).map(([key, rows]) => [key, rows.length])),
}, null, 2));
