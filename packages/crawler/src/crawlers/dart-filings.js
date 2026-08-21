/**
 * dart-filings.js — 한국주식 OpenDART 공시 목록 조회
 *
 * - 공시 목록: OpenDART `/api/list.json`
 * - 종목코드 → DART 고유번호: OpenDART `/api/corpCode.xml` ZIP
 */

import { inflateRawSync } from 'node:zlib';
import {
  OPEN_DART_DISCLOSURE_DETAIL_TYPES,
  OPEN_DART_DISCLOSURE_TYPES,
} from '../data/kr-disclosure-classification-dataset.js';
import {
  buildKrDisclosureLlmDump,
  buildKrDisclosurePipeline,
} from '../services/deepscan-kr-disclosure-pipeline.js';

const OPEN_DART_BASE_URL = 'https://opendart.fss.or.kr/api';
const DART_CORP_CODE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DART_LIST_CACHE_TTL_MS = 5 * 60 * 1000;
const DART_DEFAULT_LOOKBACK_DAYS = 90;
const DART_DEFAULT_TIMEOUT_MS = 15_000;
const DART_DOCUMENT_CACHE_TTL_MS = 30 * 60 * 1000;
const DART_DOCUMENT_DUMP_DEFAULT_MAX_CHARS = 15_000;
const DART_DOCUMENT_DUMP_DEFAULT_MAX_TOTAL_CHARS = 60_000;
const DART_DOCUMENT_DUMP_DEFAULT_LIMIT = 20;
const DART_DOCUMENT_DUMP_DEFAULT_CONCURRENCY = 4;
const DART_DOCUMENT_MAX_COMPRESSED_BYTES = 8 * 1024 * 1024;
const DART_DOCUMENT_MAX_ARCHIVE_ENTRIES = 128;
const DART_DOCUMENT_MAX_ENTRY_BYTES = 4 * 1024 * 1024;
const DART_DOCUMENT_MAX_DECOMPRESSED_BYTES = 12 * 1024 * 1024;
const DART_DOCUMENT_MAX_TEXT_CHARS = 2_000_000;
const DART_COLLECTION_DEFAULT_PAGE_COUNT = 100;
const DART_COLLECTION_DEFAULT_MAX_PAGES = 3;
const DART_COLLECTION_DEFAULT_MAX_FILINGS = 300;
const DART_DISCLOSURE_TYPES = OPEN_DART_DISCLOSURE_TYPES;
const DART_DISCLOSURE_DETAIL_TYPE_BY_CODE = new Map(
  OPEN_DART_DISCLOSURE_DETAIL_TYPES.map((entry) => [entry.code, entry]),
);
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

  const requestedDisclosureType = normalizeEnum(
    opts.disclosureType ?? opts.pblntfTy ?? opts.pblntf_ty,
    new Set(Object.keys(DART_DISCLOSURE_TYPES)),
    'pblntf_ty',
    'disclosureType',
  );
  const disclosureDetailType = normalizeText(opts.disclosureDetailType ?? opts.pblntfDetailTy ?? opts.pblntf_detail_ty)?.toUpperCase();
  const disclosureDetailDefinition = disclosureDetailType
    ? DART_DISCLOSURE_DETAIL_TYPE_BY_CODE.get(disclosureDetailType)
    : null;
  if (disclosureDetailType && !disclosureDetailDefinition) {
    throw new DartDisclosureError('invalid disclosureDetailType', {
      status: 400,
      code: 'invalid_enum',
      details: {
        key: 'pblntf_detail_ty',
        value: disclosureDetailType,
        allowed: OPEN_DART_DISCLOSURE_DETAIL_TYPES.map((entry) => entry.code),
      },
    });
  }
  if (requestedDisclosureType && disclosureDetailDefinition?.type !== requestedDisclosureType) {
    throw new DartDisclosureError('disclosureType and disclosureDetailType do not match', {
      status: 400,
      code: 'invalid_disclosure_type_pair',
      details: {
        disclosureType: requestedDisclosureType,
        disclosureDetailType,
        expectedDisclosureType: disclosureDetailDefinition.type,
      },
    });
  }
  const disclosureType = requestedDisclosureType ?? disclosureDetailDefinition?.type;
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

function redactDartErrorText(value, requestUrl) {
  let redacted = String(value ?? 'OpenDART request failed');
  try {
    const secret = new URL(String(requestUrl)).searchParams.get('crtfc_key');
    if (secret) redacted = redacted.split(secret).join('[redacted]');
  } catch {
    // The request URL is built locally, but redaction remains best-effort for test doubles.
  }
  return redacted.replace(/([?&]crtfc_key=)[^&\s]*/gi, '$1[redacted]');
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
    .replace(/<style[\s\S]*?<\/style>/gi, '\n')
    .replace(/<script[\s\S]*?<\/script>/gi, '\n')
    .replace(/<\/?(?:p|div|section|article|table|tr|h[1-6]|title|br|li|ul|ol|body|html|head)(?:\s[^>]*)?>/gi, '\n')
    .replace(/<\/?(?:td|th)(?:\s[^>]*)?>/gi, ' | ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function resourceLimitError(message, details = null) {
  return new DartDisclosureError(message, {
    status: 502,
    code: 'document_resource_limited',
    details,
  });
}

function extractAllTextFilesFromZipBuffer(bufferLike, opts = {}) {
  const buffer = Buffer.isBuffer(bufferLike) ? bufferLike : Buffer.from(bufferLike);
  const maxArchiveEntries = opts.maxArchiveEntries ?? DART_DOCUMENT_MAX_ARCHIVE_ENTRIES;
  const maxEntryBytes = opts.maxEntryBytes ?? DART_DOCUMENT_MAX_ENTRY_BYTES;
  const maxDecompressedBytes = opts.maxDecompressedBytes ?? DART_DOCUMENT_MAX_DECOMPRESSED_BYTES;
  const head = buffer.subarray(0, Math.min(buffer.length, 200)).toString('utf8').trimStart();
  if (head.startsWith('<?xml') || head.startsWith('<')) {
    if (buffer.length > maxDecompressedBytes) {
      throw resourceLimitError('OpenDART XML document exceeds the decompressed byte limit', {
        byteCount: buffer.length,
        maxDecompressedBytes,
      });
    }
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
  if (totalEntries > maxArchiveEntries) {
    throw resourceLimitError('OpenDART document ZIP has too many entries', {
      totalEntries,
      maxArchiveEntries,
    });
  }
  let centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  const files = [];
  let totalDecompressedBytes = 0;

  for (let index = 0; index < totalEntries; index += 1) {
    if (centralOffset + 46 > buffer.length || buffer.readUInt32LE(centralOffset) !== 0x02014b50) {
      throw new DartDisclosureError('OpenDART document ZIP has an invalid central directory', {
        status: 502,
        code: 'provider_invalid_document_zip',
      });
    }

    const compressionMethod = buffer.readUInt16LE(centralOffset + 10);
    const compressedSize = buffer.readUInt32LE(centralOffset + 20);
    const declaredUncompressedSize = buffer.readUInt32LE(centralOffset + 24);
    const fileNameLength = buffer.readUInt16LE(centralOffset + 28);
    const extraLength = buffer.readUInt16LE(centralOffset + 30);
    const commentLength = buffer.readUInt16LE(centralOffset + 32);
    const localHeaderOffset = buffer.readUInt32LE(centralOffset + 42);
    const centralEntryEnd = centralOffset + 46 + fileNameLength + extraLength + commentLength;
    if (centralEntryEnd > buffer.length) {
      throw new DartDisclosureError('OpenDART document ZIP has a truncated central directory entry', {
        status: 502,
        code: 'provider_invalid_document_zip',
      });
    }
    const fileName = buffer.subarray(centralOffset + 46, centralOffset + 46 + fileNameLength).toString('utf8');

    if (/(\.xml|\.html?|\.xhtml|\.txt)$/i.test(fileName)) {
      if (declaredUncompressedSize > maxEntryBytes) {
        throw resourceLimitError('OpenDART document ZIP entry exceeds the decompressed byte limit', {
          fileName,
          declaredUncompressedSize,
          maxEntryBytes,
        });
      }
      if (totalDecompressedBytes + declaredUncompressedSize > maxDecompressedBytes) {
        throw resourceLimitError('OpenDART document ZIP exceeds the total decompressed byte limit', {
          fileName,
          totalDecompressedBytes,
          declaredUncompressedSize,
          maxDecompressedBytes,
        });
      }
      if (localHeaderOffset + 30 > buffer.length || buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
        throw new DartDisclosureError('OpenDART document ZIP has invalid local header', {
          status: 502,
          code: 'provider_invalid_document_zip',
          details: { fileName },
        });
      }

      const localFileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
      if (dataStart + compressedSize > buffer.length) {
        throw new DartDisclosureError('OpenDART document ZIP entry is truncated', {
          status: 502,
          code: 'provider_invalid_document_zip',
          details: { fileName },
        });
      }
      const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
      let fileBuffer = null;
      try {
        fileBuffer = compressionMethod === 0
          ? compressed
          : compressionMethod === 8
            ? inflateRawSync(compressed, { maxOutputLength: Math.min(maxEntryBytes, maxDecompressedBytes - totalDecompressedBytes) })
            : null;
      } catch (error) {
        if (/buffer|output|size|length|memory/i.test(error?.message ?? '')) {
          throw resourceLimitError('OpenDART document ZIP inflate exceeded its resource budget', {
            fileName,
            maxEntryBytes,
          });
        }
        throw new DartDisclosureError('OpenDART document ZIP entry could not be inflated', {
          status: 502,
          code: 'provider_invalid_document_zip',
          details: { fileName },
        });
      }

      if (fileBuffer) {
        if (fileBuffer.length > maxEntryBytes || totalDecompressedBytes + fileBuffer.length > maxDecompressedBytes) {
          throw resourceLimitError('OpenDART document ZIP inflate exceeded its resource budget', {
            fileName,
            byteCount: fileBuffer.length,
            maxEntryBytes,
            maxDecompressedBytes,
          });
        }
        totalDecompressedBytes += fileBuffer.length;
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
    throw new DartDisclosureError(redactDartErrorText(error?.message, url), {
      status: 502,
      code: 'provider_request_failed',
      details: { url: redactDartUrl(url) },
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function readResponseBodyWithLimit(response, maxBytes = DART_DOCUMENT_MAX_COMPRESSED_BYTES) {
  const declaredLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw resourceLimitError('OpenDART document response exceeds the compressed byte limit', {
      declaredLength,
      maxBytes,
    });
  }

  if (!response.body?.getReader) {
    const payload = Buffer.from(await response.arrayBuffer());
    if (payload.length > maxBytes) {
      throw resourceLimitError('OpenDART document response exceeds the compressed byte limit', {
        byteCount: payload.length,
        maxBytes,
      });
    }
    return payload;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => {});
        throw resourceLimitError('OpenDART document response exceeds the compressed byte limit', {
          byteCount: totalBytes,
          maxBytes,
        });
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks, totalBytes);
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

  const resourcePolicy = {
    maxCompressedBytes: opts.maxCompressedBytes ?? DART_DOCUMENT_MAX_COMPRESSED_BYTES,
    maxArchiveEntries: opts.maxArchiveEntries ?? DART_DOCUMENT_MAX_ARCHIVE_ENTRIES,
    maxEntryBytes: opts.maxEntryBytes ?? DART_DOCUMENT_MAX_ENTRY_BYTES,
    maxDecompressedBytes: opts.maxDecompressedBytes ?? DART_DOCUMENT_MAX_DECOMPRESSED_BYTES,
    maxTextChars: opts.maxTextChars ?? DART_DOCUMENT_MAX_TEXT_CHARS,
  };

  const cacheKey = `document:${redactDartUrl(url.toString())}:${JSON.stringify(resourcePolicy)}`;
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

  const payload = await readResponseBodyWithLimit(
    response,
    resourcePolicy.maxCompressedBytes,
  );
  const head = payload.subarray(0, Math.min(payload.length, 800)).toString('utf8').trimStart();
  const xmlStatus = parseOpenDartXmlStatus(head);
  if (xmlStatus && xmlStatus.status !== '000') {
    throw new DartDisclosureError(`OpenDART ${xmlStatus.status}: ${xmlStatus.message ?? 'document unavailable'}`, {
      status: xmlStatus.status === '013' ? 404 : 502,
      code: 'provider_status_error',
      details: { providerStatus: xmlStatus.status, providerMessage: xmlStatus.message, path: '/document.xml' },
    });
  }

  const files = extractAllTextFilesFromZipBuffer(payload, resourcePolicy);
  const textFiles = files
    .map((file) => ({
      fileName: file.fileName,
      text: stripDartDocumentToText(file.buffer.toString('utf8')),
    }))
    .filter((file) => file.text);
  const text = textFiles.map((file) => file.text).join('\n').trim();
  const textCharCount = [...text].length;
  const maxTextChars = resourcePolicy.maxTextChars;
  if (textCharCount > maxTextChars) {
    throw resourceLimitError('OpenDART normalized document text exceeds the character limit', {
      textCharCount,
      maxTextChars,
    });
  }
  const result = {
    source: 'opendart-document',
    rceptNo,
    text,
    charCount: textCharCount,
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
  const maxTotalChars = normalizePositiveInteger(
    opts.maxTotalChars ?? opts.documentMaxTotalChars,
    'maxTotalChars',
    DART_DOCUMENT_DUMP_DEFAULT_MAX_TOTAL_CHARS,
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
    limit,
    { max: 100 },
  );
  const concurrency = normalizePositiveInteger(
    opts.concurrency ?? opts.documentConcurrency,
    'documentConcurrency',
    DART_DOCUMENT_DUMP_DEFAULT_CONCURRENCY,
    { max: 10 },
  );
  const selectedFilings = sourceFilings.every((filing) => filing?.primaryCategory && filing?.dumpPolicy)
    ? sourceFilings
    : buildKrDisclosurePipeline({
        source: 'opendart',
        summary: { totalCount: sourceFilings.length },
        filings: sourceFilings,
      }, { selectionLimit: Math.max(1, Math.min(200, sourceFilings.length || 1)) }).selected;
  const effectiveFetchLimit = Math.min(limit, fetchLimit);
  const candidates = selectedFilings
    .filter((filing) => filing.dumpPolicy !== 'metadata_only')
    .filter((filing) => normalizeText(filing?.rceptNo ?? filing?.rcept_no))
    .slice(0, effectiveFetchLimit);

  const fetched = await mapWithConcurrency(candidates, concurrency, async (filing) => {
    const rceptNo = normalizeText(filing.rceptNo ?? filing.rcept_no);
    try {
      return {
        rceptNo,
        document: await getDartDisclosureDocumentText(rceptNo, opts),
        error: null,
      };
    } catch (error) {
      return {
        rceptNo,
        document: null,
        error: {
          code: normalizeText(error?.code) ?? 'document_fetch_failed',
          message: normalizeText(error?.message) ?? 'document fetch failed',
          details: error?.details ?? null,
        },
      };
    }
  });

  return buildKrDisclosureLlmDump(selectedFilings, fetched, {
    maxCharsPerFiling,
    maxTotalChars,
    limit: effectiveFetchLimit,
  });
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
    if (centralOffset + 46 > buffer.length || buffer.readUInt32LE(centralOffset) !== 0x02014b50) {
      throw new DartDisclosureError('OpenDART corpCode ZIP has an invalid central directory', {
        status: 502,
        code: 'provider_invalid_zip',
      });
    }

    const compressionMethod = buffer.readUInt16LE(centralOffset + 10);
    const compressedSize = buffer.readUInt32LE(centralOffset + 20);
    const fileNameLength = buffer.readUInt16LE(centralOffset + 28);
    const extraLength = buffer.readUInt16LE(centralOffset + 30);
    const commentLength = buffer.readUInt16LE(centralOffset + 32);
    const localHeaderOffset = buffer.readUInt32LE(centralOffset + 42);
    const centralEntryEnd = centralOffset + 46 + fileNameLength + extraLength + commentLength;
    if (centralEntryEnd > buffer.length) {
      throw new DartDisclosureError('OpenDART corpCode ZIP has a truncated central directory entry', {
        status: 502,
        code: 'provider_invalid_zip',
      });
    }
    const fileName = buffer.subarray(centralOffset + 46, centralOffset + 46 + fileNameLength).toString('utf8');

    if (/\.xml$/i.test(fileName) || index === 0) {
      if (localHeaderOffset + 30 > buffer.length || buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
        throw new DartDisclosureError('OpenDART corpCode ZIP has invalid local header', {
          status: 502,
          code: 'provider_invalid_zip',
          details: { fileName },
        });
      }

      const localFileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
      if (dataStart + compressedSize > buffer.length) {
        throw new DartDisclosureError('OpenDART corpCode ZIP entry is truncated', {
          status: 502,
          code: 'provider_invalid_zip',
          details: { fileName },
        });
      }
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

function normalizeDartFiling(item = {}, defaults = {}) {
  const rceptNo = normalizeText(item.rcept_no);
  // OpenDART list.json documents pblntf_ty / pblntf_detail_ty as request
  // filters, not response fields. Preserve a requested filter as provenance
  // when the provider omits those values from each row.
  const disclosureType = normalizeText(item.pblntf_ty)?.toUpperCase()
    ?? normalizeText(defaults.disclosureType)?.toUpperCase()
    ?? null;
  const disclosureDetailType = normalizeText(item.pblntf_detail_ty)?.toUpperCase()
    ?? normalizeText(defaults.disclosureDetailType)?.toUpperCase()
    ?? null;
  const disclosureDetailDefinition = disclosureDetailType
    ? DART_DISCLOSURE_DETAIL_TYPE_BY_CODE.get(disclosureDetailType)
    : null;
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
    disclosureDetailType,
    disclosureDetailTypeLabel: disclosureDetailDefinition?.label ?? null,
    remarks: normalizeText(item.rm) ?? null,
    documentUrl: rceptNo ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${encodeURIComponent(rceptNo)}` : null,
    source: 'opendart-list',
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
      ? raw.list.map((item) => normalizeDartFiling(item, options))
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

export async function collectDartDisclosures(input = {}, opts = {}) {
  const pageCount = normalizePositiveInteger(
    opts.pageCount ?? input.pageCount ?? input.page_count,
    'pageCount',
    DART_COLLECTION_DEFAULT_PAGE_COUNT,
    { max: 100 },
  );
  const maxPages = normalizePositiveInteger(
    opts.maxPages ?? input.maxPages,
    'maxPages',
    DART_COLLECTION_DEFAULT_MAX_PAGES,
    { max: 10 },
  );
  const maxCollectedFilings = normalizePositiveInteger(
    opts.maxCollectedFilings ?? input.maxCollectedFilings,
    'maxCollectedFilings',
    DART_COLLECTION_DEFAULT_MAX_FILINGS,
    { max: 1_000 },
  );
  const firstPageNo = normalizePositiveInteger(input.pageNo ?? input.page_no, 'pageNo', 1, { max: 99_999 });
  const collected = [];
  const issues = [];
  let pageCountFetched = 0;
  let latestResult = null;
  let providerTotalCount = 0;
  let providerHasMore = false;

  for (let offset = 0; offset < maxPages && collected.length < maxCollectedFilings; offset += 1) {
    const pageNo = firstPageNo + offset;
    let page;
    try {
      page = await getDartDisclosures({
        ...input,
        ...(latestResult?.corporation?.corpCode ? { corpCode: latestResult.corporation.corpCode } : {}),
        pageNo,
        pageCount,
      }, opts);
    } catch (error) {
      if (pageCountFetched === 0) throw error;
      issues.push({
        code: normalizeText(error?.code) ?? 'provider_page_failed',
        message: normalizeText(error?.message) ?? 'OpenDART later page unavailable',
        pageNo,
      });
      providerHasMore = true;
      break;
    }

    latestResult = latestResult ?? page;
    pageCountFetched += 1;
    providerTotalCount = Math.max(providerTotalCount, Number(page.summary?.totalCount) || 0);
    collected.push(...page.filings);
    providerHasMore = Boolean(page.summary?.hasMore);
    if (!providerHasMore || page.filings.length === 0) break;
  }

  const cappedFilings = collected.slice(0, maxCollectedFilings);
  const truncated = providerHasMore
    || collected.length > maxCollectedFilings
    || issues.length > 0
    || providerTotalCount > cappedFilings.length && pageCountFetched >= maxPages;
  const state = cappedFilings.length === 0 ? 'empty' : truncated ? 'truncated' : 'complete';
  const result = latestResult ?? {
    source: 'opendart',
    market: 'KR',
    requested: {},
    corporation: null,
    summary: {},
    meta: { status: '013', message: '조회된 데이터가 없습니다.', provider: 'opendart', apiPath: '/api/list.json' },
  };
  const sortedByDate = [...cappedFilings].sort((left, right) => (
    (right.receiptDate ?? '').localeCompare(left.receiptDate ?? '')
    || (left.rceptNo ?? '').localeCompare(right.rceptNo ?? '')
  ));

  return {
    ...result,
    requested: {
      ...result.requested,
      pageNo: firstPageNo,
      pageCount,
    },
    filings: cappedFilings,
    summary: {
      ...result.summary,
      count: cappedFilings.length,
      totalCount: providerTotalCount,
      pageNo: firstPageNo,
      pageCount,
      hasMore: truncated,
      latestReceiptDate: sortedByDate[0]?.receiptDate ?? null,
    },
    collection: {
      state,
      providerTotalCount,
      collectedCount: cappedFilings.length,
      pageCountFetched,
      hasMore: truncated,
      truncated,
      maxCollectedFilings,
      maxPages,
      pageCount,
      issues,
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
