import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { getDartDisclosureDocumentText } from '../../../packages/crawler/src/crawlers/dart-filings.js';
import { OPEN_DART_DISCLOSURE_DETAIL_TYPES } from '../../../packages/crawler/src/data/kr-disclosure-classification-dataset.js';
import { extractEventsGatedProjection } from '../../../packages/crawler/src/services/deepscan-kr-disclosure-event-extractors.js';
import { classifyDisclosureFiling } from '../../../packages/crawler/src/services/deepscan-kr-disclosure-pipeline.js';

const OPEN_DART_LIST_URL = 'https://opendart.fss.or.kr/api/list.json';
const FROM = process.env.REPORT_FROM ?? '20260429';
const TO = process.env.REPORT_TO ?? '20260727';
const TARGET_COUNT = Number(process.env.REPORT_TARGET ?? 150);
const LIST_COUNT_PER_DETAIL = Number(process.env.REPORT_LIST_COUNT ?? 100);
const BODY_CHARS = Number(process.env.REPORT_BODY_CHARS ?? 80_000);
const LIST_CONCURRENCY = 6;
const DOCUMENT_CONCURRENCY = 4;
const SEED = process.env.REPORT_SEED ?? 'jaroo-opendart-live-random-20260728-v1';
const OUTPUT = resolve(process.env.REPORT_OUTPUT ?? new URL('./source-data.json', import.meta.url).pathname);

function getApiKey() {
  return process.env.DART_KEY
    ?? process.env.DART_API_KEY
    ?? process.env.OPENDART_API_KEY
    ?? process.env.OPEN_DART_API_KEY
    ?? process.env.API_K_DART
    ?? null;
}

function seededRandom(seed) {
  let state = createHash('sha256').update(seed).digest().readUInt32LE(0);
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function shuffled(values, random) {
  const output = [...values];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [output[index], output[swap]] = [output[swap], output[index]];
  }
  return output;
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

async function fetchDetailPool(detail, apiKey) {
  const url = new URL(OPEN_DART_LIST_URL);
  const params = {
    crtfc_key: apiKey,
    bgn_de: FROM,
    end_de: TO,
    last_reprt_at: 'N',
    pblntf_detail_ty: detail.code,
    corp_cls: 'Y',
    sort: 'date',
    sort_mth: 'desc',
    page_no: '1',
    page_count: String(LIST_COUNT_PER_DETAIL),
  };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const records = Array.isArray(payload.list) ? payload.list.map((item) => ({
      rceptNo: String(item.rcept_no ?? ''),
      receiptDate: String(item.rcept_dt ?? ''),
      reportName: String(item.report_nm ?? ''),
      corpCode: String(item.corp_code ?? ''),
      corpName: String(item.corp_name ?? ''),
      stockCode: String(item.stock_code ?? ''),
      corpClass: String(item.corp_cls ?? ''),
      filerName: String(item.flr_nm ?? ''),
      remarks: String(item.rm ?? ''),
      disclosureType: detail.type,
      disclosureDetailType: detail.code,
      disclosureDetailTypeLabel: detail.label,
      detailMode: detail.mode,
    })) : [];
    return {
      detail,
      status: String(payload.status ?? ''),
      message: String(payload.message ?? ''),
      totalCount: Number(payload.total_count ?? 0),
      records,
    };
  } catch (error) {
    return {
      detail,
      status: 'request_error',
      message: String(error?.message ?? error),
      totalCount: 0,
      records: [],
    };
  }
}

function selectDiverseRandomSample(pools) {
  const random = seededRandom(SEED);
  const selected = [];
  const selectedReceipts = new Set();
  const issuerCounts = new Map();
  const detailCounts = new Map();

  function add(record, { enforceIssuerCap = true, enforceDetailCap = true } = {}) {
    if (!record?.rceptNo || selectedReceipts.has(record.rceptNo)) return false;
    const issuerKey = record.corpCode || record.corpName;
    if (enforceIssuerCap && (issuerCounts.get(issuerKey) ?? 0) >= 3) return false;
    if (enforceDetailCap && (detailCounts.get(record.disclosureDetailType) ?? 0) >= 4) return false;
    selected.push(record);
    selectedReceipts.add(record.rceptNo);
    issuerCounts.set(issuerKey, (issuerCounts.get(issuerKey) ?? 0) + 1);
    detailCounts.set(record.disclosureDetailType, (detailCounts.get(record.disclosureDetailType) ?? 0) + 1);
    return true;
  }

  // Coverage pass: one randomly chosen filing from every available OpenDART detail type.
  for (const pool of shuffled(pools.filter((entry) => entry.records.length > 0), random)) {
    for (const record of shuffled(pool.records, random)) {
      if (add(record, { enforceDetailCap: false })) break;
    }
  }

  const remaining = shuffled(pools.flatMap((entry) => entry.records), random);
  for (const record of remaining) {
    if (selected.length >= TARGET_COUNT) break;
    add(record);
  }
  for (const record of remaining) {
    if (selected.length >= TARGET_COUNT) break;
    add(record, { enforceIssuerCap: false, enforceDetailCap: false });
  }

  return shuffled(selected, random).slice(0, TARGET_COUNT);
}

function serializeError(error) {
  return {
    code: String(error?.code ?? 'document_fetch_failed'),
    message: String(error?.message ?? error),
    providerStatus: error?.details?.providerStatus ?? null,
  };
}

function countBy(values, selector) {
  const counts = {};
  for (const value of values) {
    const key = String(selector(value) ?? 'unknown');
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function reviewFlags({ classified, extraction, fetchError, bodyTruncated }) {
  const flags = [];
  if (fetchError) flags.push('document-unavailable');
  if (classified.needsClassifier) flags.push('metadata-ambiguous');
  if (!extraction?.resolved || extraction?.events?.length === 0) flags.push('unresolved');
  if (extraction?.confidence === 'low') flags.push('low-confidence');
  if (extraction?.events?.some((event) => event.type === 'other')) flags.push('other-event');
  if (extraction?.events?.some((event) => [event.action, event.state, event.cause, event.subjectType]
    .filter((value) => value == null).length >= 3)) flags.push('sparse-event');
  if ((extraction?.events?.length ?? 0) >= 4) flags.push('high-cardinality');
  if (bodyTruncated) flags.push('body-truncated');
  return flags;
}

async function classifyRecord(record) {
  let document = null;
  let fetchError = null;
  try {
    document = await getDartDisclosureDocumentText(record.rceptNo, { timeoutMs: 30_000 });
  } catch (error) {
    fetchError = serializeError(error);
  }
  const retainedBody = document?.text?.slice(0, BODY_CHARS) ?? null;
  const input = { ...record, bodyText: retainedBody };
  const classified = classifyDisclosureFiling(input);
  const extraction = retainedBody ? extractEventsGatedProjection(input) : null;
  const bodyTruncated = Boolean(document && [...document.text].length > [...retainedBody].length);
  const flags = reviewFlags({ classified, extraction, fetchError, bodyTruncated });
  const reviewPriority = flags.some((flag) => [
    'document-unavailable', 'unresolved', 'low-confidence', 'other-event',
  ].includes(flag))
    ? 'high'
    : flags.some((flag) => ['metadata-ambiguous', 'sparse-event', 'high-cardinality'].includes(flag))
      ? 'medium'
      : 'normal';
  return {
    source: {
      ...record,
      filingUrl: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${record.rceptNo}`,
    },
    document: document ? {
      source: document.source,
      charCount: document.charCount,
      retainedBodyCharCount: [...retainedBody].length,
      fileCount: document.fileCount,
      bodyTruncated,
      bodySha256: createHash('sha256').update(document.text).digest('hex'),
    } : null,
    fetchError,
    filingClassification: {
      primaryCategory: classified.primaryCategory,
      categories: classified.categories,
      materialityScore: classified.materialityScore,
      materialityLevel: classified.materialityLevel,
      riskLevel: classified.riskLevel,
      confidence: classified.classificationConfidence,
      needsClassifier: classified.needsClassifier,
      reasons: classified.classificationReasons,
    },
    eventExtraction: extraction,
    reviewPriority,
    reviewFlags: flags,
  };
}

const apiKey = getApiKey();
if (!apiKey) throw new Error('DART_KEY is not configured');
if (!Number.isInteger(TARGET_COUNT) || TARGET_COUNT < 1 || TARGET_COUNT > 500) {
  throw new Error('REPORT_TARGET must be an integer between 1 and 500');
}

const generatedAt = new Date().toISOString();
const pools = await mapConcurrent(
  OPEN_DART_DISCLOSURE_DETAIL_TYPES,
  LIST_CONCURRENCY,
  (detail) => fetchDetailPool(detail, apiKey),
);
const selected = selectDiverseRandomSample(pools);
const results = await mapConcurrent(selected, DOCUMENT_CONCURRENCY, classifyRecord);
const fetched = results.filter((entry) => entry.document);
const resolved = fetched.filter((entry) => entry.eventExtraction?.resolved);
const allEvents = resolved.flatMap((entry) => entry.eventExtraction.events);
const highPriority = results.filter((entry) => entry.reviewPriority === 'high');
const mediumPriority = results.filter((entry) => entry.reviewPriority === 'medium');

const artifact = {
  schemaVersion: 'jaroo.opendart-random-classification-report-source.v1',
  generatedAt,
  methodology: {
    source: 'OpenDART list.json and document.xml',
    market: 'KOSPI (corp_cls=Y)',
    from: FROM,
    to: TO,
    seed: SEED,
    targetCount: TARGET_COUNT,
    listCountPerDetailType: LIST_COUNT_PER_DETAIL,
    bodyChars: BODY_CHARS,
    selection: 'One random filing per available detail type, then seeded random fill with issuer/detail caps.',
    accuracyClaimEligible: false,
    limitation: 'The live sample has no prediction-blind human gold labels. Review flags measure coverage and plausibility risk, not accuracy.',
  },
  sourceSummary: {
    configuredDetailTypeCount: OPEN_DART_DISCLOSURE_DETAIL_TYPES.length,
    detailTypesWithListings: pools.filter((entry) => entry.records.length > 0).length,
    detailTypesWithoutListings: pools.filter((entry) => entry.status === '013').length,
    detailTypeRequestFailures: pools.filter((entry) => !['000', '013'].includes(entry.status)).map((entry) => ({
      code: entry.detail.code,
      status: entry.status,
      message: entry.message,
    })),
    listingPoolCount: pools.reduce((sum, entry) => sum + entry.records.length, 0),
    selectedCount: selected.length,
    uniqueIssuerCount: new Set(selected.map((entry) => entry.corpCode || entry.corpName)).size,
    selectedDetailTypeCount: new Set(selected.map((entry) => entry.disclosureDetailType).filter(Boolean)).size,
  },
  resultSummary: {
    documentAvailableCount: fetched.length,
    documentUnavailableCount: results.length - fetched.length,
    resolvedCount: resolved.length,
    unresolvedAmongAvailableCount: fetched.length - resolved.length,
    resolvedRateAmongAvailable: fetched.length ? resolved.length / fetched.length : null,
    extractedEventCount: allEvents.length,
    multiEventFilingCount: resolved.filter((entry) => entry.eventExtraction.events.length > 1).length,
    highPriorityReviewCount: highPriority.length,
    mediumPriorityReviewCount: mediumPriority.length,
    normalPriorityCount: results.length - highPriority.length - mediumPriority.length,
    eventTypeCounts: countBy(allEvents, (event) => event.type),
    eventConfidenceCounts: countBy(fetched, (entry) => entry.eventExtraction?.confidence ?? 'unresolved'),
    filingCategoryCounts: countBy(results, (entry) => entry.filingClassification.primaryCategory),
    riskLevelCounts: countBy(results, (entry) => entry.filingClassification.riskLevel),
    reviewFlagCounts: countBy(results.flatMap((entry) => entry.reviewFlags), (flag) => flag),
  },
  listingStatus: pools.map((entry) => ({
    detailType: entry.detail.code,
    detailTypeLabel: entry.detail.label,
    status: entry.status,
    message: entry.message,
    totalCount: entry.totalCount,
    retainedPoolCount: entry.records.length,
  })),
  results,
};

await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ output: OUTPUT, ...artifact.sourceSummary, ...artifact.resultSummary }, null, 2));
