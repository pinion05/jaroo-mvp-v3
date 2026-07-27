import { createHash, randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDartDisclosureDocumentText } from '../src/crawlers/dart-filings.js';
import {
  buildTemporalRawCorpusPayload,
  createCandidateFreezeEnvelope,
  createTemporalRawCorpusEnvelope,
  dedupeFilings,
  issueRfc3161ReceiptSet,
  normalizeTitleTemplate,
  selectStratifiedFilings,
  selectionSeedCommitment,
  validateCandidateFreezeEnvelope,
} from '../src/services/deepscan-kr-disclosure-temporal-protocol.js';

export {
  dedupeFilings,
  normalizeTitleTemplate,
  selectStratifiedFilings,
  selectionSeedCommitment,
};

const OPEN_DART_LIST_URL = 'https://opendart.fss.or.kr/api/list.json';
const CRAWLER_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PAGE_COUNT = 100;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_DATE_RANGE_DAYS = 92;

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) throw new Error(`unexpected argument: ${argument}`);
    const separator = argument.indexOf('=');
    if (separator >= 0) {
      parsed[argument.slice(2, separator)] = argument.slice(separator + 1);
    } else if (argv[index + 1] && !argv[index + 1].startsWith('--')) {
      parsed[argument.slice(2)] = argv[index + 1];
      index += 1;
    } else {
      parsed[argument.slice(2)] = 'true';
    }
  }
  return parsed;
}

export function normalizeDate(value, name = 'date') {
  const compact = String(value ?? '').trim().replaceAll('-', '');
  if (!/^\d{8}$/u.test(compact)) throw new Error(`--${name} must be YYYYMMDD or YYYY-MM-DD`);
  const year = Number(compact.slice(0, 4));
  const month = Number(compact.slice(4, 6));
  const day = Number(compact.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  const roundTrip = date.toISOString().slice(0, 10).replaceAll('-', '');
  if (roundTrip !== compact) throw new Error(`--${name} is not a valid date`);
  return compact;
}

function dateDistanceDays(from, to) {
  const parse = (value) => Date.UTC(
    Number(value.slice(0, 4)),
    Number(value.slice(4, 6)) - 1,
    Number(value.slice(6, 8)),
  );
  return Math.floor((parse(to) - parse(from)) / 86_400_000);
}

function requiredInteger(value, name, { minimum = 1, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`--${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

export function validateOptions(input) {
  for (const name of ['out', 'selection-seed', 'candidate-freeze', 'exclude-manifest']) {
    if (input[name] === undefined || String(input[name]).trim() === '') {
      throw new Error(`--${name} is required`);
    }
  }

  const from = input.from === undefined ? null : normalizeDate(input.from, 'from');
  const to = input.to === undefined ? null : normalizeDate(input.to, 'to');
  if ((from === null) !== (to === null)) throw new Error('--from and --to must be provided together');
  if (from !== null && from > to) throw new Error('--from must be on or before --to');
  if (from !== null && dateDistanceDays(from, to) > MAX_DATE_RANGE_DAYS) {
    throw new Error(`OpenDART global list ranges cannot exceed ${MAX_DATE_RANGE_DAYS} days`);
  }

  const limit = input.limit === undefined
    ? null
    : requiredInteger(input.limit, 'limit', { minimum: 1, maximum: 100_000 });
  const minIssuers = input['min-issuers'] === undefined
    ? null
    : requiredInteger(input['min-issuers'], 'min-issuers', { maximum: 100_000 });
  if (limit !== null && minIssuers !== null && minIssuers > limit) throw new Error('--min-issuers cannot exceed --limit');

  return {
    from,
    to,
    cutoff: null,
    outputPath: resolve(String(input.out)),
    limit,
    minIssuers,
    selectionSeed: String(input['selection-seed']).trim(),
    candidateFreezePath: resolve(String(input['candidate-freeze'])),
    exclusionManifestPath: resolve(String(input['exclude-manifest'])),
    bodyChars: input['body-chars'] === undefined
      ? null
      : requiredInteger(input['body-chars'], 'body-chars', { maximum: 500_000 }),
    concurrency: input.concurrency === undefined
      ? DEFAULT_CONCURRENCY
      : requiredInteger(input.concurrency, 'concurrency', { maximum: 10 }),
    timeoutMs: input['timeout-ms'] === undefined
      ? DEFAULT_TIMEOUT_MS
      : requiredInteger(input['timeout-ms'], 'timeout-ms', { minimum: 1_000, maximum: 120_000 }),
  };
}

function stableHash(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

export async function readCandidateFreeze(path) {
  const bytes = await readFile(path);
  let manifest;
  try {
    manifest = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('--candidate-freeze must contain valid JSON');
  }
  return createCandidateFreezeEnvelope(manifest, bytes);
}

export function bindOptionsToCandidateFreeze(options, candidateFreeze, exclusion, validationOptions = {}) {
  const manifest = validateCandidateFreezeEnvelope(candidateFreeze, {
    selectionSeed: options.selectionSeed,
    exclusion,
    ...validationOptions,
  });
  const expected = {
    from: manifest.collectionWindow.from,
    to: manifest.collectionWindow.to,
    limit: manifest.collectionPlan.limit,
    minIssuers: manifest.collectionPlan.minIssuers,
    bodyChars: manifest.collectionPlan.retainedBodyChars,
  };
  for (const [field, value] of Object.entries(expected)) {
    if (options[field] !== null && options[field] !== value) {
      throw new Error(`--${field.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)} must match the candidate collection plan`);
    }
  }
  return Object.freeze({ ...options, ...expected, cutoff: manifest.cutoff, candidateFreeze });
}

export function receiptNumbersFromExclusionManifest(manifest) {
  const entries = Array.isArray(manifest)
    ? manifest
    : manifest?.receiptNumbers ?? manifest?.receipts ?? manifest?.cases;
  if (!Array.isArray(entries)) {
    throw new Error('exclusion manifest must be an array or contain receiptNumbers, receipts, or cases');
  }
  const receipts = new Set();
  for (const [index, entry] of entries.entries()) {
    const receipt = String(
      typeof entry === 'string'
        ? entry
        : entry?.rceptNo ?? entry?.receiptNumber ?? entry?.input?.rceptNo ?? '',
    ).trim();
    if (!receipt) throw new Error(`exclusion manifest entry ${index} has no receipt number`);
    if (!/^\d{14}$/u.test(receipt)) throw new Error(`exclusion manifest entry ${index} is not a 14-digit OpenDART receipt`);
    if (receipts.has(receipt)) throw new Error(`exclusion manifest contains duplicate receipt number ${receipt}`);
    receipts.add(receipt);
  }
  return receipts;
}

function collectNestedReceiptNumbers(value, receipts) {
  if (Array.isArray(value)) {
    for (const item of value) collectNestedReceiptNumbers(item, receipts);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const key of ['rceptNo', 'rcept_no', 'receiptNumber']) {
    const receipt = String(value[key] ?? '').trim();
    if (/^\d{14}$/u.test(receipt)) receipts.add(receipt);
  }
  for (const nested of Object.values(value)) collectNestedReceiptNumbers(nested, receipts);
}

function validateExclusionManifestStructure(manifest, receipts) {
  if (manifest?.schemaVersion !== 'jaroo.kr-disclosure-event-temporal-exclusions.v1') {
    throw new Error('invalid temporal exclusion manifest schemaVersion');
  }
  if (!Array.isArray(manifest.sources) || manifest.sources.length === 0) {
    throw new Error('temporal exclusion manifest sources must be nonempty');
  }
  for (const [index, source] of manifest.sources.entries()) {
    if (typeof source?.path !== 'string' || source.path.length === 0) {
      throw new Error(`temporal exclusion manifest sources[${index}].path must be nonempty`);
    }
    if (!/^[a-f0-9]{64}$/u.test(source.sha256 ?? '')) {
      throw new Error(`temporal exclusion manifest sources[${index}].sha256 must be a lowercase SHA-256 digest`);
    }
    if (!Number.isInteger(source.receiptCount) || source.receiptCount < 0) {
      throw new Error(`temporal exclusion manifest sources[${index}].receiptCount must be a nonnegative integer`);
    }
  }
  if (manifest.summary?.sourceCount !== manifest.sources.length) {
    throw new Error('temporal exclusion manifest summary.sourceCount is stale');
  }
  if (manifest.summary?.uniqueReceiptCount !== receipts.size || receipts.size === 0) {
    throw new Error('temporal exclusion manifest summary.uniqueReceiptCount is stale or empty');
  }
}

export async function readExclusionManifest(path, { verifySources = false } = {}) {
  if (!path) return { receipts: new Set(), sha256: null };
  const bytes = await readFile(path);
  let manifest;
  try {
    manifest = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('--exclude-manifest must contain valid JSON');
  }
  const receipts = receiptNumbersFromExclusionManifest(manifest);
  validateExclusionManifestStructure(manifest, receipts);
  if (verifySources) {
    const sourceReceipts = new Set();
    for (const [index, source] of manifest.sources.entries()) {
      const crawlerRootRealPath = realpathSync(CRAWLER_ROOT);
      const absolutePath = realpathSync(resolve(crawlerRootRealPath, source.path));
      const pathFromRoot = relative(crawlerRootRealPath, absolutePath);
      if (pathFromRoot.startsWith('..') || isAbsolute(pathFromRoot)) {
        throw new Error(`temporal exclusion manifest sources[${index}] escapes the crawler root`);
      }
      const sourceBytes = await readFile(absolutePath);
      if (createHash('sha256').update(sourceBytes).digest('hex') !== source.sha256) {
        throw new Error(`temporal exclusion manifest sources[${index}] SHA-256 mismatch`);
      }
      const parsed = JSON.parse(sourceBytes.toString('utf8'));
      const receiptsForSource = new Set();
      collectNestedReceiptNumbers(parsed, receiptsForSource);
      if (receiptsForSource.size !== source.receiptCount) {
        throw new Error(`temporal exclusion manifest sources[${index}] receiptCount mismatch`);
      }
      for (const receipt of receiptsForSource) sourceReceipts.add(receipt);
    }
    if (JSON.stringify([...sourceReceipts].sort()) !== JSON.stringify([...receipts].sort())) {
      throw new Error('temporal exclusion manifest receiptNumbers do not match its source artifacts');
    }
  }
  return { receipts, sha256: createHash('sha256').update(bytes).digest('hex') };
}

function issuerKey(filing) {
  return String(filing.corpCode ?? '').trim();
}

function getApiKey() {
  return process.env.DART_KEY
    ?? process.env.DART_API_KEY
    ?? process.env.OPENDART_API_KEY
    ?? process.env.OPEN_DART_API_KEY
    ?? process.env.API_K_DART
    ?? null;
}

function redact(value, secrets = []) {
  let output = String(value ?? 'OpenDART request failed');
  for (const secret of secrets.filter(Boolean)) output = output.replaceAll(secret, '[REDACTED]');
  return output.replace(/([?&]crtfc_key=)[^&\s]+/giu, '$1[REDACTED]');
}

function serializeError(error, secrets) {
  return {
    code: redact(error?.code ?? 'provider_request_failed', secrets),
    message: redact(error?.message ?? 'OpenDART request failed', secrets),
    providerStatus: error?.details?.providerStatus ?? null,
  };
}

async function fetchListPage({ apiKey, from, to, pageNo, timeoutMs }) {
  const url = new URL(OPEN_DART_LIST_URL);
  for (const [key, value] of Object.entries({
    crtfc_key: apiKey,
    bgn_de: from,
    end_de: to,
    corp_cls: 'Y',
    last_reprt_at: 'N',
    sort: 'date',
    sort_mth: 'asc',
    page_no: String(pageNo),
    page_count: String(PAGE_COUNT),
  })) url.searchParams.set(key, value);

  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new Error(redact(error?.message ?? 'OpenDART list request failed', [apiKey]), { cause: error });
  }
  if (!response.ok) throw new Error(`OpenDART list HTTP ${response.status}`);
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('OpenDART list returned invalid JSON');
  }
  if (payload?.status === '013') return { filings: [], totalCount: 0, totalPages: 0 };
  if (payload?.status !== '000') {
    throw new Error(`OpenDART ${payload?.status ?? 'unknown'}: ${redact(payload?.message ?? 'provider error', [apiKey])}`);
  }
  const filings = (Array.isArray(payload.list) ? payload.list : []).map((item) => ({
    rceptNo: String(item.rcept_no ?? '').trim(),
    receiptDate: String(item.rcept_dt ?? '').trim(),
    corpCode: String(item.corp_code ?? '').trim() || null,
    corpName: String(item.corp_name ?? '').trim() || null,
    stockCode: String(item.stock_code ?? '').trim() || null,
    corpClass: String(item.corp_cls ?? '').trim() || null,
    reportName: String(item.report_nm ?? '').trim() || null,
    filerName: String(item.flr_nm ?? '').trim() || null,
    remarks: String(item.rm ?? '').trim() || null,
  }));
  return {
    filings,
    totalCount: Number(payload.total_count) || filings.length,
    totalPages: Number(payload.total_page) || Math.ceil((Number(payload.total_count) || filings.length) / PAGE_COUNT),
  };
}

async function collectList(options, apiKey) {
  const filings = [];
  let expectedTotalCount = 0;
  let pageNo = 1;
  let totalPages = 1;
  while (pageNo <= totalPages) {
    const page = await fetchListPage({ ...options, apiKey, pageNo });
    if (pageNo === 1) {
      expectedTotalCount = page.totalCount;
      totalPages = page.totalPages;
    }
    filings.push(...page.filings);
    if (page.filings.length === 0 && pageNo < totalPages) {
      throw new Error(`OpenDART returned an empty page before completion (page ${pageNo}/${totalPages})`);
    }
    pageNo += 1;
  }
  if (filings.length !== expectedTotalCount) {
    throw new Error(`OpenDART pagination was incomplete: expected ${expectedTotalCount}, received ${filings.length}`);
  }
  return { filings, expectedTotalCount, pagesFetched: pageNo - 1 };
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

function retainCharacters(text, maximum) {
  const characters = [...text];
  return { body: characters.slice(0, maximum).join(''), fullCharCount: characters.length };
}

async function fetchCase(filing, options, apiKey) {
  try {
    const document = await getDartDisclosureDocumentText(filing.rceptNo, {
      apiKey,
      timeoutMs: options.timeoutMs,
    });
    if (!document.text) throw Object.assign(new Error('OpenDART document text is empty'), { code: 'empty_document_text' });
    const retained = retainCharacters(document.text, options.bodyChars);
    return {
      case: {
        id: `opendart-${filing.rceptNo}`,
        labelStatus: 'unlabeled',
        input: {
          rceptNo: filing.rceptNo,
          receiptDate: filing.receiptDate,
          issuer: filing.corpName,
          stockCode: filing.stockCode,
          title: filing.reportName,
          body: retained.body,
        },
        source: {
          provider: 'opendart',
          corpClass: filing.corpClass,
          corpCode: filing.corpCode,
          filerName: filing.filerName,
          remarks: filing.remarks,
          listApiPath: '/api/list.json',
          documentApiPath: '/api/document.xml',
          documentSource: document.source,
          fileCount: document.fileCount,
          fullCharCount: retained.fullCharCount,
          retainedCharCount: [...retained.body].length,
          truncated: retained.fullCharCount > [...retained.body].length,
          fullSha256: stableHash(document.text),
          retainedSha256: stableHash(retained.body),
        },
      },
      failure: null,
    };
  } catch (error) {
    return {
      case: null,
      failure: { rceptNo: filing.rceptNo, ...serializeError(error, [apiKey]) },
    };
  }
}

export async function writeImmutableArtifact(outputPath, bytes) {
  await mkdir(dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, bytes, { flag: 'wx' });
    await link(temporaryPath, outputPath);
  } finally {
    await unlink(temporaryPath).catch(() => {});
  }
}

export async function main(argv = process.argv.slice(2)) {
  const parsedOptions = validateOptions(parseArgs(argv));
  const candidateFreeze = await readCandidateFreeze(parsedOptions.candidateFreezePath);
  const exclusion = await readExclusionManifest(parsedOptions.exclusionManifestPath, { verifySources: true });
  const options = bindOptionsToCandidateFreeze(parsedOptions, candidateFreeze, exclusion);
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('DART_KEY is not configured');

  const listed = await collectList(options, apiKey);
  const deduped = dedupeFilings(listed.filings);
  const population = deduped.filter((filing) => (
    issuerKey(filing) && !exclusion.receipts.has(filing.rceptNo)
  ));
  const eligibleCount = population.length;
  const selectionOptions = {
    limit: options.limit,
    minIssuers: options.minIssuers,
    selectionSeed: options.selectionSeed,
  };
  // Selection happens exactly once against the complete eligible population.
  // Failed document fetches invalidate the cohort rather than allowing an
  // outcome-dependent replacement that would change the sealed sample.
  const selected = selectStratifiedFilings(population, selectionOptions);
  const fetched = await mapConcurrent(
    selected,
    options.concurrency,
    (filing) => fetchCase(filing, options, apiKey),
  );
  const failures = fetched.flatMap((result) => result.failure ? [result.failure] : []);
  if (failures.length > 0) {
    throw new Error(`sealed selection failed closed because ${failures.length} selected documents were unusable: ${failures.map((entry) => entry.rceptNo).join(', ')}`);
  }
  const caseByReceipt = new Map(fetched.flatMap((result) => result.case
    ? [[result.case.input.rceptNo, result.case]]
    : []));
  const cases = selected.map((filing) => caseByReceipt.get(filing.rceptNo)).filter(Boolean);
  const successfulIssuerCount = new Set(cases.map((entry) => entry.source.corpCode).filter(Boolean)).size;
  if (successfulIssuerCount < options.minIssuers) {
    throw new Error(`only ${successfulIssuerCount} issuers have usable documents; --min-issuers requires ${options.minIssuers}`);
  }
  const overlap = cases.map((entry) => entry.input.rceptNo).filter((receipt) => exclusion.receipts.has(receipt));
  if (overlap.length > 0) throw new Error(`selected cases overlap exclusion manifest: ${overlap.join(', ')}`);

  const query = {
    from: options.from,
    to: options.to,
    cutoff: options.cutoff,
    corpClass: 'Y',
    lastReportOnly: false,
    sort: 'date',
    sortDirection: 'asc',
    pageCount: PAGE_COUNT,
    limit: options.limit,
    minIssuers: options.minIssuers,
    sampling: options.limit === null ? 'all-deduplicated-filings' : 'deterministic-issuer-title-template-stratified',
    stoppingRule: candidateFreeze.manifest.precommit.collectionPlan.stoppingRule,
    selectionSeedReveal: options.selectionSeed,
    selectionSeedCommitment: selectionSeedCommitment(options.selectionSeed),
    exclusionManifestSha256: exclusion.sha256,
    excludedReceiptCount: exclusion.receipts.size,
    excludedReceiptsSha256: candidateFreeze.manifest.precommit.sampling.excludedReceiptsSha256,
    retainedBodyChars: options.bodyChars,
    concurrency: options.concurrency,
    timeoutMs: options.timeoutMs,
  };
  const source = {
    provider: 'opendart',
    listApiPath: '/api/list.json',
    documentApiPath: '/api/document.xml',
    market: 'KR',
  };
  const capture = {
    providerTotalCount: listed.expectedTotalCount,
    listedCount: listed.filings.length,
    pagesFetched: listed.pagesFetched,
    deduplicatedCount: deduped.length,
    eligibleCount,
    duplicateCount: listed.filings.length - deduped.length,
    excludedInWindowCount: deduped.length - eligibleCount,
    selectedCount: selected.length,
    caseCount: cases.length,
    documentFailureCount: 0,
    uniqueIssuerCount: successfulIssuerCount,
    uniqueTitleTemplateCount: new Set(cases.map((entry) => normalizeTitleTemplate(entry.input.title))).size,
    truncatedBodyCount: cases.filter((entry) => entry.source.truncated).length,
    retainedBodyCharCount: cases.reduce((total, entry) => total + entry.source.retainedCharCount, 0),
  };
  const payload = buildTemporalRawCorpusPayload({
    candidateFreeze,
    query,
    source,
    capture,
    listedFilings: listed.filings,
    population,
    cases,
  });
  const timestampReceipts = await issueRfc3161ReceiptSet(payload);
  const artifact = createTemporalRawCorpusEnvelope(payload, timestampReceipts);

  await writeImmutableArtifact(options.outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(JSON.stringify({
    outputPath: options.outputPath,
    ...capture,
    payloadCanonicalSha256: artifact.payloadCanonicalSha256,
    timestampAuthorities: timestampReceipts.map((receipt) => receipt.authorityId),
  }, null, 2));
  return artifact;
}

const isDirectRun = process.argv[1]
  && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]));
if (isDirectRun) {
  main().catch((error) => {
    console.error(error?.message ?? error);
    process.exitCode = 1;
  });
}
