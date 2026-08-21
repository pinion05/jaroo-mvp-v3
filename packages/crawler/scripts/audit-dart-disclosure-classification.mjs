import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  KR_DISCLOSURE_CLASSIFICATION_DATASET_VERSION,
  OPEN_DART_DISCLOSURE_DETAIL_TYPES,
} from '../src/data/kr-disclosure-classification-dataset.js';
import { classifyDisclosureFiling } from '../src/services/deepscan-kr-disclosure-pipeline.js';

const OPEN_DART_LIST_URL = 'https://opendart.fss.or.kr/api/list.json';
const DEFAULT_SAMPLE_COUNT = 5;
const MAX_SAMPLE_COUNT = 100;
const DEFAULT_CONCURRENCY = 5;
const OPEN_DART_CORP_CLASSES = new Set(['Y', 'K', 'N', 'E']);

function parseArgs(argv) {
  return Object.fromEntries(argv.map((argument) => {
    const [key, ...rest] = argument.replace(/^--/, '').split('=');
    return [key, rest.length > 0 ? rest.join('=') : 'true'];
  }));
}

function compactDate(date) {
  return date.toISOString().slice(0, 10).replaceAll('-', '');
}

function shiftUtcDate(compact, days) {
  const date = new Date(Date.UTC(
    Number(compact.slice(0, 4)),
    Number(compact.slice(4, 6)) - 1,
    Number(compact.slice(6, 8)),
  ));
  date.setUTCDate(date.getUTCDate() + days);
  return compactDate(date);
}

function assertCompactDate(value, key) {
  if (!/^\d{8}$/.test(value)) throw new Error(`${key} must be YYYYMMDD`);
  const normalized = compactDate(new Date(Date.UTC(
    Number(value.slice(0, 4)),
    Number(value.slice(4, 6)) - 1,
    Number(value.slice(6, 8)),
  )));
  if (normalized !== value) throw new Error(`${key} is not a valid date`);
}

function positiveInteger(value, fallback, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) return fallback;
  return parsed;
}

function getApiKey() {
  return process.env.DART_KEY
    ?? process.env.DART_API_KEY
    ?? process.env.OPENDART_API_KEY
    ?? process.env.OPEN_DART_API_KEY
    ?? process.env.API_K_DART
    ?? null;
}

async function mapConcurrent(values, concurrency, mapper) {
  const output = new Array(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return output;
}

async function fetchDetailSamples(detail, { apiKey, from, to, sampleCount, corpClass }) {
  const url = new URL(OPEN_DART_LIST_URL);
  const params = {
    crtfc_key: apiKey,
    bgn_de: from,
    end_de: to,
    last_reprt_at: 'N',
    pblntf_detail_ty: detail.code,
    sort: 'date',
    sort_mth: 'desc',
    page_no: '1',
    page_count: String(sampleCount),
  };
  if (corpClass) params.corp_cls = corpClass;
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) {
    return {
      detailType: detail.code,
      status: 'http_error',
      message: `OpenDART HTTP ${response.status}`,
      totalCount: 0,
      samples: [],
    };
  }

  const payload = await response.json();
  const samples = Array.isArray(payload.list) ? payload.list.map((item) => {
    const baseInput = {
      rceptNo: item.rcept_no,
      receiptDate: item.rcept_dt,
      reportName: item.report_nm,
      corpCode: item.corp_code,
      corpName: item.corp_name,
      stockCode: item.stock_code,
      corpCls: item.corp_cls,
      filerName: item.flr_nm,
      remarks: item.rm,
    };
    const titleOnly = classifyDisclosureFiling(baseInput);
    const classified = classifyDisclosureFiling({
      ...baseInput,
      disclosureType: detail.type,
      disclosureDetailType: detail.code,
    });
    return {
      rceptNo: classified.rceptNo,
      receiptDate: classified.receiptDate,
      reportName: classified.reportName,
      corpName: classified.corpName,
      stockCode: classified.stockCode,
      corpClass: baseInput.corpCls ?? null,
      remarks: classified.remarks,
      disclosureType: classified.disclosureType,
      disclosureDetailType: classified.disclosureDetailType,
      primaryCategory: classified.primaryCategory,
      categories: classified.categories,
      materialityScore: classified.materialityScore,
      riskLevel: classified.riskLevel,
      dumpPolicy: classified.dumpPolicy,
      classificationConfidence: classified.classificationConfidence,
      needsClassifier: classified.needsClassifier,
      classificationReasons: classified.classificationReasons,
      titleOnlyClassification: {
        primaryCategory: titleOnly.primaryCategory,
        categories: titleOnly.categories,
        materialityScore: titleOnly.materialityScore,
        riskLevel: titleOnly.riskLevel,
        dumpPolicy: titleOnly.dumpPolicy,
        classificationConfidence: titleOnly.classificationConfidence,
        needsClassifier: titleOnly.needsClassifier,
        classificationReasons: titleOnly.classificationReasons,
      },
    };
  }) : [];

  return {
    detailType: detail.code,
    detailTypeLabel: detail.label,
    detailMode: detail.mode,
    status: payload.status ?? null,
    message: payload.message ?? null,
    totalCount: Number(payload.total_count ?? 0),
    samples,
  };
}

function countBy(values, keySelector) {
  return values.reduce((counts, value) => {
    const key = keySelector(value) ?? 'unknown';
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

const args = parseArgs(process.argv.slice(2));
const apiKey = getApiKey();
if (!apiKey) throw new Error('DART_KEY is not configured');

const to = args.to ?? compactDate(new Date());
const from = args.from ?? shiftUtcDate(to, -90);
assertCompactDate(from, 'from');
assertCompactDate(to, 'to');
if (from > to) throw new Error('from must be <= to');
const rangeDays = Math.floor((Date.parse(`${to.slice(0, 4)}-${to.slice(4, 6)}-${to.slice(6, 8)}T00:00:00Z`)
  - Date.parse(`${from.slice(0, 4)}-${from.slice(4, 6)}-${from.slice(6, 8)}T00:00:00Z`)) / 86_400_000);
if (rangeDays > 92) throw new Error('OpenDART global disclosure search range must not exceed three months');

const sampleCount = positiveInteger(args['per-type'], DEFAULT_SAMPLE_COUNT, MAX_SAMPLE_COUNT);
const concurrency = positiveInteger(args.concurrency, DEFAULT_CONCURRENCY, 10);
const corpClass = String(args['corp-class'] ?? '').trim().toUpperCase() || null;
if (corpClass && !OPEN_DART_CORP_CLASSES.has(corpClass)) {
  throw new Error('corp-class must be one of Y, K, N, E');
}
const generatedAt = new Date().toISOString();
const defaultOutput = `.omx/context/dart-classification-audit-${generatedAt.replaceAll(/[:.]/g, '-')}.json`;
const outputPath = resolve(args.out ?? defaultOutput);

const results = await mapConcurrent(
  OPEN_DART_DISCLOSURE_DETAIL_TYPES,
  concurrency,
  (detail) => fetchDetailSamples(detail, {
    apiKey,
    from,
    to,
    sampleCount,
    corpClass,
  }),
);
const samples = results.flatMap((result) => result.samples);
const providerLabeledAmbiguous = samples.filter((sample) => sample.needsClassifier);
const titleOnlyAmbiguous = samples.filter((sample) => sample.titleOnlyClassification.needsClassifier);
const titleRequiredSamples = results
  .filter((result) => result.detailMode === 'title_required')
  .flatMap((result) => result.samples);
const titleRequiredAmbiguous = titleRequiredSamples.filter((sample) => sample.needsClassifier);
const summary = {
  detailTypeCount: OPEN_DART_DISCLOSURE_DETAIL_TYPES.length,
  detailTypesWithSamples: results.filter((result) => result.samples.length > 0).length,
  observedSampleCount: samples.length,
  providerLabeled: {
    deterministicCount: samples.length - providerLabeledAmbiguous.length,
    ambiguousCount: providerLabeledAmbiguous.length,
    ambiguousRate: samples.length > 0 ? providerLabeledAmbiguous.length / samples.length : 0,
    categoryCounts: countBy(samples, (sample) => sample.primaryCategory),
    confidenceCounts: countBy(samples, (sample) => sample.classificationConfidence),
  },
  titleOnly: {
    deterministicCount: samples.length - titleOnlyAmbiguous.length,
    ambiguousCount: titleOnlyAmbiguous.length,
    ambiguousRate: samples.length > 0 ? titleOnlyAmbiguous.length / samples.length : 0,
    categoryCounts: countBy(samples, (sample) => sample.titleOnlyClassification.primaryCategory),
    confidenceCounts: countBy(samples, (sample) => sample.titleOnlyClassification.classificationConfidence),
  },
  titleRequired: {
    sampleCount: titleRequiredSamples.length,
    ambiguousCount: titleRequiredAmbiguous.length,
    ambiguousRate: titleRequiredSamples.length > 0
      ? titleRequiredAmbiguous.length / titleRequiredSamples.length
      : 0,
  },
  noDataDetailTypes: results.filter((result) => result.status === '013').map((result) => result.detailType),
  failedDetailTypes: results
    .filter((result) => !['000', '013'].includes(result.status))
    .map((result) => ({ detailType: result.detailType, status: result.status, message: result.message })),
};
const artifact = {
  schemaVersion: 'jaroo.deepscan.kr-disclosure-classification-audit.v1',
  classificationDatasetVersion: KR_DISCLOSURE_CLASSIFICATION_DATASET_VERSION,
  generatedAt,
  query: {
    from,
    to,
    sampleCountPerDetailType: sampleCount,
    concurrency,
    corpClass,
  },
  summary,
  results,
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ outputPath, ...summary }, null, 2));
