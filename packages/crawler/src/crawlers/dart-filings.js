/**
 * dart-filings.js — 한국주식 OpenDART 공시 목록 조회
 *
 * - 공시 목록: OpenDART `/api/list.json`
 * - 종목코드 → DART 고유번호: OpenDART `/api/corpCode.xml` ZIP
 */

import { inflateRawSync } from 'node:zlib';

const OPEN_DART_BASE_URL = 'https://opendart.fss.or.kr/api';
const DART_CORP_CODE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DART_LIST_CACHE_TTL_MS = 5 * 60 * 1000;
const DART_DEFAULT_LOOKBACK_DAYS = 90;
const DART_DEFAULT_TIMEOUT_MS = 15_000;
const DART_DOCUMENT_CACHE_TTL_MS = 30 * 60 * 1000;
const DART_DOCUMENT_DUMP_DEFAULT_MAX_CHARS = 15_000;
const DART_DOCUMENT_DUMP_DEFAULT_LIMIT = 20;
const DART_DOCUMENT_DUMP_DEFAULT_CONCURRENCY = 4;
const DART_DISCLOSURE_TYPES = Object.freeze({
  A: '정기공시',
  B: '주요사항보고',
  C: '발행공시',
  D: '지분공시',
  E: '기타공시',
  F: '외부감사관련',
  G: '펀드공시',
  H: '자산유동화',
  I: '거래소공시',
  J: '공정위공시',
});
const DART_CORP_CLASS_LABELS = Object.freeze({
  Y: '유가',
  K: '코스닥',
  N: '코넥스',
  E: '기타',
});
const DART_ALLOWED_SORTS = new Set(['date', 'crp', 'rpt']);
const DART_ALLOWED_SORT_METHODS = new Set(['asc', 'desc']);
const XML_ENTITY_MAP = Object.freeze({
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
});

const corpCodeCache = new Map();
const listCache = new Map();

export class DartDisclosureError extends Error {
  constructor(message, { status = 500, code = 'dart_error', details = null } = {}) {
    super(message);
    this.name = 'DartDisclosureError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function nowKstDate(now = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(now).replaceAll('-', '');
}

function shiftCompactDate(compactDate, days) {
  const year = Number(compactDate.slice(0, 4));
  const month = Number(compactDate.slice(4, 6));
  const day = Number(compactDate.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10).replaceAll('-', '');
}

function normalizeCompactDate(value, key = 'date') {
  if (value == null || String(value).trim() === '') return undefined;
  const normalized = String(value).trim().replaceAll('-', '');
  if (!/^\d{8}$/.test(normalized)) {
    throw new DartDisclosureError(`invalid ${key}: expected YYYYMMDD or YYYY-MM-DD`, {
      status: 400,
      code: 'invalid_date',
      details: { key, value: String(value), expected: 'YYYYMMDD or YYYY-MM-DD' },
    });
  }

  const year = Number(normalized.slice(0, 4));
  const month = Number(normalized.slice(4, 6));
  const day = Number(normalized.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    throw new DartDisclosureError(`invalid ${key}: impossible calendar date`, {
      status: 400,
      code: 'invalid_date',
      details: { key, value: String(value), expected: 'valid calendar date' },
    });
  }

  return normalized;
}

function resolveDateRange(opts = {}) {
  const today = normalizeCompactDate(opts.today ?? nowKstDate(opts.now), 'today');
  const from = normalizeCompactDate(opts.from ?? opts.bgnDe ?? opts.bgn_de, 'from');
  const to = normalizeCompactDate(opts.to ?? opts.endDe ?? opts.end_de, 'to');

  if (!from && !to) {
    return {
      bgnDe: shiftCompactDate(today, -DART_DEFAULT_LOOKBACK_DAYS),
      endDe: today,
      defaulted: true,
    };
  }

  const bgnDe = from ?? to;
  const endDe = to ?? today;
  if (bgnDe > endDe) {
    throw new DartDisclosureError('invalid date range: from must be <= to', {
      status: 400,
      code: 'invalid_date_range',
      details: { from: bgnDe, to: endDe },
    });
  }

  return { bgnDe, endDe, defaulted: false };
}

function normalizeStockCode(value) {
  if (value == null || String(value).trim() === '') return undefined;
  const upper = String(value).trim().toUpperCase();
  const match = upper.match(/^(\d{6})(?:\.(?:KS|KQ|KN|KR))?$/);
  if (!match) {
    throw new DartDisclosureError('invalid stock code: expected 6 digits', {
      status: 400,
      code: 'invalid_stock_code',
      details: { value: String(value), expected: '6 digit stock code' },
    });
  }
  return match[1];
}

function normalizeCorpCode(value) {
  if (value == null || String(value).trim() === '') return undefined;
  const normalized = String(value).trim();
  if (!/^\d{8}$/.test(normalized)) {
    throw new DartDisclosureError('invalid corpCode: expected 8 digits', {
      status: 400,
      code: 'invalid_corp_code',
      details: { value: String(value), expected: '8 digit DART corp_code' },
    });
  }
  return normalized;
}

function normalizeText(value) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function normalizePositiveInteger(value, key, fallback, { max = Number.POSITIVE_INFINITY } = {}) {
  if (value == null || String(value).trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new DartDisclosureError(`invalid ${key}: expected integer between 1 and ${max}`, {
      status: 400,
      code: 'invalid_integer',
      details: { key, value: String(value), expected: `1..${max}` },
    });
  }
  return parsed;
}

function normalizeBooleanYN(value, key, fallback = undefined) {
  if (value == null || String(value).trim() === '') return fallback;
  const normalized = String(value).trim().toUpperCase();
  if (['Y', 'YES', 'TRUE', '1', 'ON'].includes(normalized)) return 'Y';
  if (['N', 'NO', 'FALSE', '0', 'OFF'].includes(normalized)) return 'N';
  throw new DartDisclosureError(`invalid ${key}: expected Y or N`, {
    status: 400,
    code: 'invalid_boolean',
    details: { key, value: String(value), expected: 'Y/N or true/false' },
  });
}

function normalizeEnum(value, allowed, key, label = key) {
  const normalized = normalizeText(value)?.toUpperCase();
  if (!normalized) return undefined;
  if (!allowed.has(normalized)) {
    throw new DartDisclosureError(`invalid ${label}`, {
      status: 400,
      code: 'invalid_enum',
      details: { key, value: String(value), allowed: [...allowed] },
    });
  }
  return normalized;
}

function normalizeDartOptions(opts = {}) {
  const pageNo = normalizePositiveInteger(opts.pageNo ?? opts.page_no, 'pageNo', 1, { max: 99999 });
  const pageCount = normalizePositiveInteger(opts.pageCount ?? opts.page_count ?? opts.limit, 'pageCount', 10, { max: 100 });
  const sort = normalizeText(opts.sort)?.toLowerCase() ?? 'date';
  const sortMth = normalizeText(opts.sortMth ?? opts.sort_mth)?.toLowerCase() ?? 'desc';

  if (!DART_ALLOWED_SORTS.has(sort)) {
    throw new DartDisclosureError('invalid sort', {
      status: 400,
      code: 'invalid_sort',
      details: { value: sort, allowed: [...DART_ALLOWED_SORTS] },
    });
  }
  if (!DART_ALLOWED_SORT_METHODS.has(sortMth)) {
    throw new DartDisclosureError('invalid sortMth', {
      status: 400,
      code: 'invalid_sort_mth',
      details: { value: sortMth, allowed: [...DART_ALLOWED_SORT_METHODS] },
    });
  }

  const disclosureType = normalizeEnum(
    opts.disclosureType ?? opts.pblntfTy ?? opts.pblntf_ty,
    new Set(Object.keys(DART_DISCLOSURE_TYPES)),
    'pblntf_ty',
    'disclosureType',
  );
  const disclosureDetailType = normalizeText(opts.disclosureDetailType ?? opts.pblntfDetailTy ?? opts.pblntf_detail_ty)?.toUpperCase();
  const corpCls = normalizeEnum(
    opts.corpCls ?? opts.corp_cls,
    new Set(Object.keys(DART_CORP_CLASS_LABELS)),
    'corp_cls',
    'corpCls',
  );

  return {
    corpCode: normalizeCorpCode(opts.corpCode ?? opts.corp_code),
    stockCode: normalizeStockCode(opts.stockCode ?? opts.stock_code ?? opts.code),
    corpName: normalizeText(opts.corpName ?? opts.corp_name ?? opts.name),
    ...resolveDateRange(opts),
    lastReprtAt: normalizeBooleanYN(opts.finalOnly ?? opts.lastReprtAt ?? opts.last_reprt_at, 'lastReprtAt', 'N'),
    disclosureType,
    disclosureDetailType,
    corpCls,
    sort,
    sortMth,
    pageNo,
    pageCount,
  };
}

function getDartApiKey(opts = {}) {
  const key = normalizeText(opts.apiKey)
    ?? normalizeText(process.env.DART_KEY)
    ?? normalizeText(process.env.DART_API_KEY)
    ?? normalizeText(process.env.OPENDART_API_KEY)
    ?? normalizeText(process.env.OPEN_DART_API_KEY)
    ?? normalizeText(process.env.API_K_DART);

  if (!key) {
    throw new DartDisclosureError('DART_KEY is not configured', {
      status: 503,
      code: 'provider_unconfigured',
      details: {
        provider: 'opendart',
        env: ['DART_KEY', 'DART_API_KEY', 'OPENDART_API_KEY', 'OPEN_DART_API_KEY', 'API_K_DART'],
      },
    });
  }

  return key;
}

function redactDartUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has('crtfc_key')) {
      parsed.searchParams.set('crtfc_key', '[redacted]');
    }
    return parsed.toString();
  } catch {
    return String(url).replace(/([?&]crtfc_key=)[^&]*/i, '$1[redacted]');
  }
}

function parseOpenDartXmlStatus(xmlText) {
  const status = xmlText.match(/<status>\s*([\s\S]*?)\s*<\/status>/i)?.[1]?.trim();
  if (!status) {
    return null;
  }

  return {
    status,
    message: decodeXmlText(xmlText.match(/<message>\s*([\s\S]*?)\s*<\/message>/i)?.[1] ?? '').trim() || null,
  };
}

function stripDartDocumentToText(value = '') {
  return decodeXmlText(String(value))
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractAllTextFilesFromZipBuffer(bufferLike) {
  const buffer = Buffer.isBuffer(bufferLike) ? bufferLike : Buffer.from(bufferLike);
  const head = buffer.subarray(0, Math.min(buffer.length, 200)).toString('utf8').trimStart();
  if (head.startsWith('<?xml') || head.startsWith('<')) {
    return [{ fileName: 'document.xml', buffer }];
  }

  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset < 0) {
    throw new DartDisclosureError('OpenDART document payload is not a ZIP/XML file', {
      status: 502,
      code: 'provider_invalid_document_zip',
    });
  }

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  let centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  const files = [];

  for (let index = 0; index < totalEntries; index += 1) {
    if (buffer.readUInt32LE(centralOffset) !== 0x02014b50) break;

    const compressionMethod = buffer.readUInt16LE(centralOffset + 10);
    const compressedSize = buffer.readUInt32LE(centralOffset + 20);
    const fileNameLength = buffer.readUInt16LE(centralOffset + 28);
    const extraLength = buffer.readUInt16LE(centralOffset + 30);
    const commentLength = buffer.readUInt16LE(centralOffset + 32);
    const localHeaderOffset = buffer.readUInt32LE(centralOffset + 42);
    const fileName = buffer.subarray(centralOffset + 46, centralOffset + 46 + fileNameLength).toString('utf8');

    if (/(\.xml|\.html?|\.xhtml|\.txt)$/i.test(fileName)) {
      if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
        throw new DartDisclosureError('OpenDART document ZIP has invalid local header', {
          status: 502,
          code: 'provider_invalid_document_zip',
          details: { fileName },
        });
      }

      const localFileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
      const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
      const fileBuffer = compressionMethod === 0
        ? compressed
        : compressionMethod === 8
          ? inflateRawSync(compressed)
          : null;

      if (fileBuffer) {
        files.push({ fileName, buffer: fileBuffer });
      }
    }

    centralOffset += 46 + fileNameLength + extraLength + commentLength;
  }

  return files;
}

async function mapWithConcurrency(items, concurrency, worker) {
  const limit = Math.max(1, Math.min(items.length || 1, concurrency));
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => runWorker()));
  return results;
}

async function fetchWithTimeout(url, { fetchImpl = fetch, timeoutMs = DART_DEFAULT_TIMEOUT_MS, headers = {} } = {}) {
  const controller = timeoutMs > 0 ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const response = await fetchImpl(url, {
      headers: {
        Accept: 'application/json',
        ...headers,
      },
      signal: controller?.signal,
    });
    return response;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new DartDisclosureError('OpenDART request timed out', {
        status: 504,
        code: 'provider_timeout',
        details: { url: redactDartUrl(url), timeoutMs },
      });
    }
    throw new DartDisclosureError(error?.message ?? 'OpenDART request failed', {
      status: 502,
      code: 'provider_request_failed',
      details: { url: redactDartUrl(url) },
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fetchDartJson(path, params, opts = {}) {
  const apiKey = getDartApiKey(opts);
  const url = new URL(`${OPEN_DART_BASE_URL}${path}`);
  url.searchParams.set('crtfc_key', apiKey);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  const cacheKey = `json:${redactDartUrl(url.toString())}`;
  const cached = listCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < (opts.cacheTtlMs ?? DART_LIST_CACHE_TTL_MS)) {
    return cached.value;
  }

  const response = await fetchWithTimeout(url, opts);
  if (!response.ok) {
    throw new DartDisclosureError(`OpenDART HTTP ${response.status}`, {
      status: response.status >= 500 ? 502 : response.status,
      code: 'provider_http_error',
      details: { providerStatus: response.status, url: redactDartUrl(url.toString()) },
    });
  }

  let data;
  try {
    data = await response.json();
  } catch (error) {
    throw new DartDisclosureError('OpenDART returned invalid JSON', {
      status: 502,
      code: 'provider_invalid_json',
      details: { message: error?.message ?? 'invalid json', url: redactDartUrl(url.toString()) },
    });
  }

  listCache.set(cacheKey, { fetchedAt: Date.now(), value: data });
  return data;
}

export async function getDartDisclosureDocumentText(rceptNoInput, opts = {}) {
  const rceptNo = normalizeText(rceptNoInput);
  if (!rceptNo) {
    throw new DartDisclosureError('invalid rceptNo: required', {
      status: 400,
      code: 'invalid_receipt_no',
    });
  }

  const apiKey = getDartApiKey(opts);
  const url = new URL(`${OPEN_DART_BASE_URL}/document.xml`);
  url.searchParams.set('crtfc_key', apiKey);
  url.searchParams.set('rcept_no', rceptNo);

  const cacheKey = `document:${redactDartUrl(url.toString())}`;
  const cached = listCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < (opts.cacheTtlMs ?? DART_DOCUMENT_CACHE_TTL_MS)) {
    return cached.value;
  }

  const response = await fetchWithTimeout(url, {
    ...opts,
    headers: { Accept: 'application/zip, application/xml, text/xml, */*', ...(opts.headers ?? {}) },
  });
  if (!response.ok) {
    throw new DartDisclosureError(`OpenDART document HTTP ${response.status}`, {
      status: response.status >= 500 ? 502 : response.status,
      code: 'provider_http_error',
      details: { providerStatus: response.status, url: redactDartUrl(url.toString()) },
    });
  }

  const payload = Buffer.from(await response.arrayBuffer());
  const head = payload.subarray(0, Math.min(payload.length, 800)).toString('utf8').trimStart();
  const xmlStatus = parseOpenDartXmlStatus(head);
  if (xmlStatus && xmlStatus.status !== '000') {
    throw new DartDisclosureError(`OpenDART ${xmlStatus.status}: ${xmlStatus.message ?? 'document unavailable'}`, {
      status: xmlStatus.status === '013' ? 404 : 502,
      code: 'provider_status_error',
      details: { providerStatus: xmlStatus.status, providerMessage: xmlStatus.message, path: '/document.xml' },
    });
  }

  const files = extractAllTextFilesFromZipBuffer(payload);
  const textFiles = files
    .map((file) => ({
      fileName: file.fileName,
      text: stripDartDocumentToText(file.buffer.toString('utf8')),
    }))
    .filter((file) => file.text);
  const text = textFiles.map((file) => file.text).join('\n').trim();
  const result = {
    source: 'opendart-document',
    rceptNo,
    text,
    charCount: [...text].length,
    byteCount: Buffer.byteLength(text, 'utf8'),
    wordishCount: text ? text.split(/\s+/).filter(Boolean).length : 0,
    fileCount: textFiles.length,
    documentBytes: payload.length,
    generatedAt: new Date().toISOString(),
  };

  listCache.set(cacheKey, { fetchedAt: Date.now(), value: result });
  return result;
}

export async function buildDartDisclosureDocumentDump(filings = [], opts = {}) {
  const sourceFilings = Array.isArray(filings) ? filings : [];
  const maxCharsPerFiling = normalizePositiveInteger(
    opts.maxCharsPerFiling ?? opts.maxChars ?? opts.documentMaxChars,
    'maxCharsPerFiling',
    DART_DOCUMENT_DUMP_DEFAULT_MAX_CHARS,
    { max: 500_000 },
  );
  const limit = normalizePositiveInteger(
    opts.limit ?? opts.documentLimit,
    'documentLimit',
    DART_DOCUMENT_DUMP_DEFAULT_LIMIT,
    { max: 100 },
  );
  const fetchLimit = normalizePositiveInteger(
    opts.fetchLimit ?? opts.documentFetchLimit,
    'documentFetchLimit',
    sourceFilings.length || limit,
    { max: 100 },
  );
  const concurrency = normalizePositiveInteger(
    opts.concurrency ?? opts.documentConcurrency,
    'documentConcurrency',
    DART_DOCUMENT_DUMP_DEFAULT_CONCURRENCY,
    { max: 10 },
  );
  const candidates = sourceFilings
    .filter((filing) => normalizeText(filing?.rceptNo ?? filing?.rcept_no))
    .slice(0, fetchLimit);

  const fetched = await mapWithConcurrency(candidates, concurrency, async (filing) => {
    const rceptNo = normalizeText(filing.rceptNo ?? filing.rcept_no);
    try {
      return {
        filing,
        document: await getDartDisclosureDocumentText(rceptNo, opts),
        error: null,
      };
    } catch (error) {
      return {
        filing,
        document: null,
        error: normalizeText(error?.message) ?? 'document fetch failed',
      };
    }
  });

  const included = [];
  const skipped = [];
  for (const entry of fetched) {
    const filing = entry.filing;
    const rceptNo = normalizeText(filing.rceptNo ?? filing.rcept_no) ?? null;
    const reportName = normalizeText(filing.reportName ?? filing.report_nm) ?? '';
    const receiptDate = normalizeText(filing.receiptDate ?? filing.rcept_dt) ?? null;
    const filerName = normalizeText(filing.filerName ?? filing.flr_nm) ?? null;

    if (!entry.document) {
      skipped.push({ rceptNo, reportName, receiptDate, filerName, reason: 'fetch_failed', error: entry.error });
      continue;
    }

    const charCount = entry.document.charCount;
    if (charCount >= maxCharsPerFiling) {
      skipped.push({ rceptNo, reportName, receiptDate, filerName, reason: 'too_long', charCount });
      continue;
    }

    if (included.length >= limit) {
      skipped.push({ rceptNo, reportName, receiptDate, filerName, reason: 'limit_exceeded', charCount });
      continue;
    }

    included.push({
      rceptNo,
      reportName,
      receiptDate,
      filerName,
      charCount,
      wordishCount: entry.document.wordishCount,
      text: entry.document.text,
    });
  }

  const combinedText = included
    .map((entry, index) => [
      `[${index + 1}] ${entry.receiptDate ?? 'date-unknown'} · ${entry.reportName || '제목 없음'}${entry.filerName ? ` · 제출:${entry.filerName}` : ''} · ${entry.rceptNo ?? 'receipt-unknown'} · ${entry.charCount}자`,
      entry.text,
    ].join('\n'))
    .join('\n\n---\n\n');

  const skippedTooLongCount = skipped.filter((entry) => entry.reason === 'too_long').length;
  const skippedUnavailableCount = skipped.filter((entry) => entry.reason === 'fetch_failed').length;

  return {
    available: included.length > 0,
    source: 'opendart-document',
    policy: 'skip_gte_max_chars_then_take_first_limit',
    maxCharsPerFiling,
    limit,
    fetchLimit,
    fetchedCount: fetched.length,
    includedCount: included.length,
    skippedCount: skipped.length,
    skippedTooLongCount,
    skippedUnavailableCount,
    totalCharCount: included.reduce((sum, entry) => sum + entry.charCount, 0),
    combinedText,
    filings: included,
    skipped,
    generatedAt: new Date().toISOString(),
  };
}

function decodeXmlText(value = '') {
  return String(value).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const codePoint = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    if (entity.startsWith('#')) {
      const codePoint = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    return XML_ENTITY_MAP[entity] ?? match;
  });
}

function extractXmlField(block, tag) {
  const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? decodeXmlText(match[1]).trim() : '';
}

export function parseDartCorpCodeXml(xmlText) {
  const xml = String(xmlText ?? '');
  const entries = [];
  const listPattern = /<list>([\s\S]*?)<\/list>/gi;
  let match;

  while ((match = listPattern.exec(xml))) {
    const block = match[1];
    const corpCode = extractXmlField(block, 'corp_code');
    const corpName = extractXmlField(block, 'corp_name');
    const corpEngName = extractXmlField(block, 'corp_eng_name');
    const stockCode = extractXmlField(block, 'stock_code');
    const modifyDate = extractXmlField(block, 'modify_date');

    if (!corpCode && !corpName && !stockCode) continue;
    entries.push({
      corpCode,
      corpName,
      corpEngName: corpEngName || null,
      stockCode: stockCode && /^\d{6}$/.test(stockCode) ? stockCode : null,
      modifyDate: modifyDate || null,
    });
  }

  return entries;
}

function findEndOfCentralDirectory(buffer) {
  const signature = 0x06054b50;
  const minOffset = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === signature) return offset;
  }
  return -1;
}

export function extractFirstXmlFromZipBuffer(bufferLike) {
  const buffer = Buffer.isBuffer(bufferLike) ? bufferLike : Buffer.from(bufferLike);
  const head = buffer.subarray(0, Math.min(buffer.length, 200)).toString('utf8').trimStart();
  if (head.startsWith('<?xml') || head.startsWith('<result')) {
    return buffer.toString('utf8');
  }

  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset < 0) {
    throw new DartDisclosureError('OpenDART corpCode payload is not a ZIP/XML file', {
      status: 502,
      code: 'provider_invalid_zip',
    });
  }

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  let centralOffset = buffer.readUInt32LE(eocdOffset + 16);

  for (let index = 0; index < totalEntries; index += 1) {
    if (buffer.readUInt32LE(centralOffset) !== 0x02014b50) break;

    const compressionMethod = buffer.readUInt16LE(centralOffset + 10);
    const compressedSize = buffer.readUInt32LE(centralOffset + 20);
    const fileNameLength = buffer.readUInt16LE(centralOffset + 28);
    const extraLength = buffer.readUInt16LE(centralOffset + 30);
    const commentLength = buffer.readUInt16LE(centralOffset + 32);
    const localHeaderOffset = buffer.readUInt32LE(centralOffset + 42);
    const fileName = buffer.subarray(centralOffset + 46, centralOffset + 46 + fileNameLength).toString('utf8');

    if (/\.xml$/i.test(fileName) || index === 0) {
      if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
        throw new DartDisclosureError('OpenDART corpCode ZIP has invalid local header', {
          status: 502,
          code: 'provider_invalid_zip',
          details: { fileName },
        });
      }

      const localFileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
      const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
      const xmlBuffer = compressionMethod === 0
        ? compressed
        : compressionMethod === 8
          ? inflateRawSync(compressed)
          : null;

      if (!xmlBuffer) {
        throw new DartDisclosureError('OpenDART corpCode ZIP compression is unsupported', {
          status: 502,
          code: 'provider_unsupported_zip',
          details: { fileName, compressionMethod },
        });
      }

      return xmlBuffer.toString('utf8');
    }

    centralOffset += 46 + fileNameLength + extraLength + commentLength;
  }

  throw new DartDisclosureError('OpenDART corpCode XML file was not found in ZIP', {
    status: 502,
    code: 'provider_missing_xml',
  });
}

export async function getDartCorpCodeList(opts = {}) {
  const apiKey = getDartApiKey(opts);
  const cacheKey = `corpCode:${apiKey.slice(0, 8)}`;
  const cached = corpCodeCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < (opts.cacheTtlMs ?? DART_CORP_CODE_CACHE_TTL_MS)) {
    return cached.entries;
  }

  const url = new URL(`${OPEN_DART_BASE_URL}/corpCode.xml`);
  url.searchParams.set('crtfc_key', apiKey);
  const response = await fetchWithTimeout(url, {
    ...opts,
    headers: { Accept: 'application/zip, application/xml, text/xml, */*', ...(opts.headers ?? {}) },
  });

  if (!response.ok) {
    throw new DartDisclosureError(`OpenDART corpCode HTTP ${response.status}`, {
      status: response.status >= 500 ? 502 : response.status,
      code: 'provider_http_error',
      details: { providerStatus: response.status, url: redactDartUrl(url.toString()) },
    });
  }

  const payload = Buffer.from(await response.arrayBuffer());
  const xml = extractFirstXmlFromZipBuffer(payload);
  const entries = parseDartCorpCodeXml(xml);
  if (entries.length === 0) {
    throw new DartDisclosureError('OpenDART corpCode list is empty', {
      status: 502,
      code: 'provider_empty_corp_codes',
    });
  }

  corpCodeCache.set(cacheKey, { fetchedAt: Date.now(), entries });
  return entries;
}

export async function findDartCorporations(query = {}, opts = {}) {
  const corpCode = normalizeCorpCode(query.corpCode ?? query.corp_code);
  const stockCode = normalizeStockCode(query.stockCode ?? query.stock_code ?? query.code);
  const corpName = normalizeText(query.corpName ?? query.corp_name ?? query.name);
  const entries = await getDartCorpCodeList(opts);

  if (corpCode) {
    return entries.filter((entry) => entry.corpCode === corpCode);
  }

  if (stockCode) {
    return entries.filter((entry) => entry.stockCode === stockCode);
  }

  if (corpName) {
    const normalizedName = corpName.replace(/\s+/g, '').toLowerCase();
    return entries.filter((entry) => entry.corpName.replace(/\s+/g, '').toLowerCase().includes(normalizedName));
  }

  return [];
}

async function resolveDartCorporation(options, opts = {}) {
  if (options.corpCode && !options.stockCode && !options.corpName) {
    return {
      corpCode: options.corpCode,
      corpName: null,
      corpEngName: null,
      stockCode: null,
      modifyDate: null,
      resolvedBy: 'corpCode',
    };
  }

  if (!options.corpCode && !options.stockCode && !options.corpName) return null;

  const matches = await findDartCorporations({
    corpCode: options.corpCode,
    stockCode: options.stockCode,
    corpName: options.corpName,
  }, opts);

  if (matches.length === 0) {
    throw new DartDisclosureError('DART corporation was not found', {
      status: 404,
      code: 'corp_not_found',
      details: {
        corpCode: options.corpCode ?? null,
        stockCode: options.stockCode ?? null,
        corpName: options.corpName ?? null,
      },
    });
  }

  const exactName = options.corpName
    ? matches.find((entry) => entry.corpName === options.corpName)
    : null;
  const selected = exactName ?? matches.find((entry) => entry.stockCode) ?? matches[0];

  return {
    ...selected,
    resolvedBy: options.corpCode ? 'corpCode' : options.stockCode ? 'stockCode' : 'corpName',
    matchCount: matches.length,
  };
}

function normalizeDartFiling(item = {}) {
  const rceptNo = normalizeText(item.rcept_no);
  const disclosureType = normalizeText(item.pblntf_ty);
  const stockCode = normalizeText(item.stock_code);

  return {
    rceptNo,
    reportName: normalizeText(item.report_nm) ?? '',
    corpCode: normalizeText(item.corp_code) ?? '',
    corpName: normalizeText(item.corp_name) ?? '',
    stockCode: stockCode && /^\d{6}$/.test(stockCode) ? stockCode : null,
    corpCls: normalizeText(item.corp_cls) ?? null,
    corpClsLabel: DART_CORP_CLASS_LABELS[normalizeText(item.corp_cls)] ?? null,
    filerName: normalizeText(item.flr_nm) ?? null,
    receiptDate: normalizeCompactDate(item.rcept_dt, 'rcept_dt') ?? null,
    reportDate: normalizeCompactDate(item.rcept_dt, 'rcept_dt') ?? null,
    disclosureType,
    disclosureTypeLabel: disclosureType ? DART_DISCLOSURE_TYPES[disclosureType] ?? null : null,
    remarks: normalizeText(item.rm) ?? null,
    documentUrl: rceptNo ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${encodeURIComponent(rceptNo)}` : null,
    source: 'opendart-list',
    raw: item,
  };
}

function buildDartSummary(filings, raw = {}) {
  const typeCounts = {};
  for (const filing of filings) {
    const key = filing.disclosureType ?? 'unknown';
    typeCounts[key] = (typeCounts[key] ?? 0) + 1;
  }

  const totalCount = Number(raw.total_count);
  const totalPage = Number(raw.total_page);
  const pageNo = Number(raw.page_no);
  const pageCount = Number(raw.page_count);

  return {
    count: filings.length,
    totalCount: Number.isFinite(totalCount) ? totalCount : filings.length,
    totalPage: Number.isFinite(totalPage) ? totalPage : 0,
    pageNo: Number.isFinite(pageNo) ? pageNo : 1,
    pageCount: Number.isFinite(pageCount) ? pageCount : filings.length,
    hasMore: Number.isFinite(totalPage) && Number.isFinite(pageNo) ? pageNo < totalPage : false,
    latestReceiptDate: filings[0]?.receiptDate ?? null,
    typeCounts,
  };
}

function assertDartStatusOkOrEmpty(raw, context = {}) {
  const status = normalizeText(raw?.status);
  if (status === '000' || status === '013') return;

  const message = normalizeText(raw?.message) ?? 'OpenDART error';
  const statusMap = {
    '010': 401,
    '011': 403,
    '012': 403,
    '020': 429,
    '021': 400,
    '100': 400,
    '101': 400,
    '800': 503,
    '900': 502,
    '901': 403,
  };

  throw new DartDisclosureError(`OpenDART ${status ?? 'unknown'}: ${message}`, {
    status: statusMap[status] ?? 502,
    code: 'provider_status_error',
    details: { providerStatus: status, providerMessage: message, ...context },
  });
}

export async function getDartDisclosures(input = {}, opts = {}) {
  const options = normalizeDartOptions(input);
  const corporation = await resolveDartCorporation(options, opts);
  const corpCode = options.corpCode ?? corporation?.corpCode;
  const params = {
    corp_code: corpCode,
    bgn_de: options.bgnDe,
    end_de: options.endDe,
    last_reprt_at: options.lastReprtAt,
    pblntf_ty: options.disclosureType,
    pblntf_detail_ty: options.disclosureDetailType,
    corp_cls: options.corpCls,
    sort: options.sort,
    sort_mth: options.sortMth,
    page_no: options.pageNo,
    page_count: options.pageCount,
  };

  const raw = await fetchDartJson('/list.json', params, opts);
  assertDartStatusOkOrEmpty(raw, { path: '/list.json' });

  const filings = raw?.status === '013'
    ? []
    : Array.isArray(raw?.list)
      ? raw.list.map((item) => normalizeDartFiling(item))
      : [];

  return {
    source: 'opendart',
    market: 'KR',
    requested: {
      corpCode: corpCode ?? null,
      stockCode: options.stockCode ?? corporation?.stockCode ?? null,
      corpName: options.corpName ?? corporation?.corpName ?? null,
      from: options.bgnDe,
      to: options.endDe,
      defaultDateRange: options.defaulted,
      finalOnly: options.lastReprtAt === 'Y',
      disclosureType: options.disclosureType ?? null,
      disclosureDetailType: options.disclosureDetailType ?? null,
      corpCls: options.corpCls ?? null,
      sort: options.sort,
      sortMth: options.sortMth,
      pageNo: options.pageNo,
      pageCount: options.pageCount,
    },
    corporation,
    filings,
    summary: buildDartSummary(filings, raw),
    meta: {
      status: normalizeText(raw?.status) ?? null,
      message: normalizeText(raw?.message) ?? null,
      provider: 'opendart',
      apiPath: '/api/list.json',
      generatedAt: new Date().toISOString(),
    },
  };
}

export function clearDartCaches() {
  corpCodeCache.clear();
  listCache.clear();
}

export {
  DART_CORP_CLASS_LABELS,
  DART_DISCLOSURE_TYPES,
};
