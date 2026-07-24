import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { OPEN_DART_DISCLOSURE_DETAIL_TYPES } from '../src/data/kr-disclosure-classification-dataset.js';
import { KR_DISCLOSURE_EVENT_EXTRACTOR_CANDIDATES } from '../src/services/deepscan-kr-disclosure-event-extractors.js';

const CATEGORY_TO_EVENT_TYPE = Object.freeze({
  periodic: 'periodic-report',
  'capital-change': 'capital-change',
  restructuring: 'restructuring',
  'material-contract': 'material-contract',
  ownership: 'ownership-change',
  governance: 'governance',
  'corporate-action': 'corporate-action',
  audit: 'audit',
  insolvency: 'insolvency',
  earnings: 'earnings',
  'trading-status': 'trading-status',
  'legal-regulatory': 'legal-regulatory',
  'related-party': 'related-party',
  other: 'other',
});

const DETAIL_BY_CODE = new Map(OPEN_DART_DISCLOSURE_DETAIL_TYPES.map((detail) => [detail.code, detail]));

function parseArgs(argv) {
  return Object.fromEntries(argv.map((argument) => {
    const [key, ...rest] = argument.replace(/^--/u, '').split('=');
    return [key, rest.length > 0 ? rest.join('=') : 'true'];
  }));
}

function eventFingerprint(events) {
  return events.map((event) => [
    event.type ?? 'other',
    event.action ?? '',
    event.state ?? '',
    event.cause ?? '',
    event.subjectType ?? '',
  ].join('|')).sort().join('\n');
}

function isSemanticallyResolved(events) {
  return events.some((event) => event.type !== 'other' || event.action || event.cause || event.subjectType);
}

function isFieldComplete(events) {
  return events.length > 0 && events.every((event) => (
    event.type && event.action && event.cause && event.subjectType
  ));
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function round(value, digits = 4) {
  return Number(value.toFixed(digits));
}

function evaluateExactGold(extractor, cases) {
  let exact = 0;
  for (const fixture of cases) {
    const predicted = extractor(fixture.input).events;
    if (eventFingerprint(predicted) === eventFingerprint(fixture.expectedEvents)) exact += 1;
  }
  return { exact, total: cases.length, accuracy: round(ratio(exact, cases.length)) };
}

function evaluateHumanTypeGold(extractor, cases) {
  let exact = 0;
  const failures = [];
  for (const fixture of cases) {
    const expectedType = CATEGORY_TO_EVENT_TYPE[fixture.expected.primaryCategory];
    const input = {
      ...fixture.input,
      disclosureDetailType: fixture.input.disclosureDetailType ?? fixture.provenance?.detailType,
    };
    const predictedTypes = new Set(extractor(input).events.map((event) => event.type));
    if (predictedTypes.has(expectedType)) exact += 1;
    else if (failures.length < 12) failures.push({ id: fixture.id, expectedType, predictedTypes: [...predictedTypes] });
  }
  return { exact, total: cases.length, accuracy: round(ratio(exact, cases.length)), failures };
}

function flattenAuditSamples(audit) {
  return (audit.results ?? []).flatMap((result) => (result.samples ?? []).map((sample) => ({
    ...sample,
    detailType: result.detailType,
    detailMode: result.detailMode,
  })));
}

function evaluateProviderAgreement(extractor, samples) {
  let exact = 0;
  let additionalTypes = 0;
  const failures = [];
  for (const sample of samples) {
    const detail = DETAIL_BY_CODE.get(sample.detailType);
    const expectedType = CATEGORY_TO_EVENT_TYPE[detail.defaultCategory];
    const events = extractor({
      ...sample,
      disclosureDetailType: sample.detailType,
      disclosureType: sample.disclosureType ?? detail.type,
    }).events;
    const predictedTypes = new Set(events.map((event) => event.type));
    if (predictedTypes.has(expectedType)) exact += 1;
    else if (failures.length < 12) failures.push({
      rceptNo: sample.rceptNo,
      detailType: sample.detailType,
      reportName: sample.reportName,
      expectedType,
      predictedTypes: [...predictedTypes],
    });
    if ([...predictedTypes].some((type) => type !== expectedType && type !== 'other')) additionalTypes += 1;
  }
  return {
    exact,
    total: samples.length,
    agreement: round(ratio(exact, samples.length)),
    additionalTypes,
    additionalTypeRate: round(ratio(additionalTypes, samples.length)),
    failures,
  };
}

function evaluateUnlabeledCoverage(extractor, samples) {
  let resolved = 0;
  let complete = 0;
  for (const sample of samples) {
    const detail = DETAIL_BY_CODE.get(sample.detailType);
    const events = extractor({
      ...sample,
      disclosureDetailType: sample.detailType,
      disclosureType: sample.disclosureType ?? detail.type,
    }).events;
    if (isSemanticallyResolved(events)) resolved += 1;
    if (isFieldComplete(events)) complete += 1;
  }
  return {
    resolved,
    complete,
    total: samples.length,
    resolutionRate: round(ratio(resolved, samples.length)),
    fieldCompleteRate: round(ratio(complete, samples.length)),
  };
}

function evaluateBodyTemplates(extractor, cases) {
  let available = 0;
  let resolved = 0;
  let complete = 0;
  let bodyChanged = 0;
  let bodyResolved = 0;
  const bodyChanges = [];
  for (const fixture of cases) {
    const withoutBody = extractor({ ...fixture.input, bodyText: undefined }).events;
    const withBody = extractor(fixture.input).events;
    if (fixture.input.bodyText) available += 1;
    if (isSemanticallyResolved(withBody)) resolved += 1;
    if (isFieldComplete(withBody)) complete += 1;
    if (fixture.input.bodyText && eventFingerprint(withoutBody) !== eventFingerprint(withBody)) {
      bodyChanged += 1;
      if (!isSemanticallyResolved(withoutBody) && isSemanticallyResolved(withBody)) bodyResolved += 1;
      if (bodyChanges.length < 12) bodyChanges.push({
        key: fixture.key,
        reportName: fixture.input.reportName,
        withoutBody,
        withBody,
      });
    }
  }
  return {
    total: cases.length,
    bodyAvailable: available,
    resolved,
    resolutionRate: round(ratio(resolved, cases.length)),
    complete,
    fieldCompleteRate: round(ratio(complete, cases.length)),
    bodyChanged,
    bodyResolved,
    bodyChanges,
  };
}

function benchmarkLatency(extractor, cases, iterations) {
  const inputs = cases.map((fixture) => fixture.input);
  const startedAt = performance.now();
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (const input of inputs) extractor(input);
  }
  const elapsedMs = performance.now() - startedAt;
  return round((elapsedMs * 1_000) / (inputs.length * iterations), 2);
}

const args = parseArgs(process.argv.slice(2));
if (!args.audit || !args.corpus) throw new Error('--audit and --corpus are required');
const audit = JSON.parse(await readFile(resolve(args.audit), 'utf8'));
const corpus = JSON.parse(await readFile(resolve(args.corpus), 'utf8'));
const eventGold = JSON.parse(await readFile(resolve('test/fixtures/kr-disclosure-event-benchmark.v1.json'), 'utf8'));
const bodyReviewed = JSON.parse(await readFile(resolve('test/fixtures/kr-disclosure-event-body-reviewed.v1.json'), 'utf8'));
const classificationGold = JSON.parse(await readFile(resolve('test/fixtures/kr-disclosure-classification-gold.v1.json'), 'utf8'));
const auditSamples = flattenAuditSamples(audit);
const exactProviderSamples = auditSamples.filter((sample) => {
  const detail = DETAIL_BY_CODE.get(sample.detailType);
  return detail?.mode === 'exact' && CATEGORY_TO_EVENT_TYPE[detail.defaultCategory];
});
const titleRequiredSamples = auditSamples.filter((sample) => DETAIL_BY_CODE.get(sample.detailType)?.mode === 'title_required');
const bodyByReceipt = new Map(corpus.cases
  .filter((fixture) => fixture.input?.rceptNo && fixture.input?.bodyText)
  .map((fixture) => [fixture.input.rceptNo, fixture.input.bodyText]));
const titleRequiredWithAvailableBody = titleRequiredSamples.map((sample) => ({
  ...sample,
  bodyText: bodyByReceipt.get(sample.rceptNo),
}));
const iterations = Math.max(1, Math.min(1_000, Number(args.iterations) || 25));
const candidates = {};

for (const [name, extractor] of Object.entries(KR_DISCLOSURE_EVENT_EXTRACTOR_CANDIDATES)) {
  candidates[name] = {
    adversarialEventGold: evaluateExactGold(extractor, eventGold.cases),
    bodyReviewedEventSet: evaluateExactGold(extractor, bodyReviewed.cases),
    humanTypeGold: evaluateHumanTypeGold(extractor, classificationGold.observedCases),
    exactProviderAgreement: evaluateProviderAgreement(extractor, exactProviderSamples),
    titleRequiredCoverage: evaluateUnlabeledCoverage(extractor, titleRequiredSamples),
    titleRequiredHierarchicalCoverage: evaluateUnlabeledCoverage(extractor, titleRequiredWithAvailableBody),
    bodyTemplateCoverage: evaluateBodyTemplates(extractor, corpus.cases),
    microsecondsPerBodyTemplate: benchmarkLatency(extractor, corpus.cases, iterations),
  };
}

const report = {
  schemaVersion: 'jaroo.kr-disclosure-event-research-benchmark.v1',
  generatedAt: new Date().toISOString(),
  dataset: {
    market: audit.query?.corpClass ?? null,
    dateRange: { from: audit.query?.from, to: audit.query?.to },
    observedRecords: auditSamples.length,
    uniqueCompanies: new Set(auditSamples.map((sample) => sample.corpName).filter(Boolean)).size,
    exactProviderLabeledRecords: exactProviderSamples.length,
    titleRequiredRecords: titleRequiredSamples.length,
    titleRequiredBodiesAvailable: titleRequiredWithAvailableBody.filter((sample) => sample.bodyText).length,
    humanTypeGoldCases: classificationGold.observedCases.length,
    adversarialEventGoldCases: eventGold.cases.length,
    bodyReviewedCases: bodyReviewed.cases.length,
    totalFullEventLabeledCases: eventGold.cases.length + bodyReviewed.cases.length,
    bodyTemplateCases: corpus.cases.length,
    bodyAvailableCases: corpus.summary?.bodyAvailableCount ?? null,
  },
  interpretation: {
    accuracyMetrics: [
      'adversarialEventGold',
      'bodyReviewedEventSet',
      'humanTypeGold',
      'exactProviderAgreement',
    ],
    coverageOnlyMetrics: [
      'titleRequiredCoverage',
      'titleRequiredHierarchicalCoverage',
      'bodyTemplateCoverage',
    ],
    warning: 'Coverage metrics are not accuracy and must not be presented as correctness without independent labels.',
  },
  candidates,
};

if (args.json === 'true') {
  process.stdout.write(`${JSON.stringify(report)}\n`);
} else {
  console.log(JSON.stringify(report.dataset, null, 2));
  console.table(Object.entries(candidates).map(([candidate, metrics]) => ({
    candidate,
    eventGold: `${metrics.adversarialEventGold.exact}/${metrics.adversarialEventGold.total}`,
    bodyReviewed: `${metrics.bodyReviewedEventSet.exact}/${metrics.bodyReviewedEventSet.total}`,
    humanType: `${metrics.humanTypeGold.exact}/${metrics.humanTypeGold.total}`,
    providerType: `${metrics.exactProviderAgreement.exact}/${metrics.exactProviderAgreement.total}`,
    providerAdditionalTypes: metrics.exactProviderAgreement.additionalTypes,
    titleRequiredCoverage: metrics.titleRequiredCoverage.resolutionRate,
    hierarchicalCoverage: metrics.titleRequiredHierarchicalCoverage.resolutionRate,
    bodyTemplateCoverage: metrics.bodyTemplateCoverage.resolutionRate,
    fieldComplete: metrics.bodyTemplateCoverage.fieldCompleteRate,
    bodyResolved: metrics.bodyTemplateCoverage.bodyResolved,
    usPerTemplate: metrics.microsecondsPerBodyTemplate,
  })));
}
