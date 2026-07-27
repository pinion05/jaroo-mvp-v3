import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  KR_DISCLOSURE_EVENT_ONTOLOGY_HASH,
  KR_DISCLOSURE_EVENT_ONTOLOGY_VERSION,
} from './deepscan-kr-disclosure-event-ontology.js';

export const KR_DISCLOSURE_TEMPORAL_FREEZE_SCHEMA_VERSION = 'jaroo.kr-disclosure-event-candidate-freeze.v2';
export const KR_DISCLOSURE_TEMPORAL_CORPUS_SCHEMA_VERSION = 'jaroo.kr-disclosure-temporal-holdout-corpus.v2';
export const KR_DISCLOSURE_TEMPORAL_TIMESTAMP_ENVELOPE_SCHEMA_VERSION = 'jaroo.rfc3161-detached-envelope.v1';
export const KR_DISCLOSURE_TEMPORAL_CHAIN_DOMAIN = 'jaroo.kr-disclosure-temporal-chain.v2';
export const KR_DISCLOSURE_TEMPORAL_SELECTION_ALGORITHM = 'deterministic-issuer-title-template-stratified.v2';
export const KR_DISCLOSURE_TEMPORAL_COLLECTION_PLAN_SCHEMA_VERSION = 'jaroo.kr-disclosure-temporal-collection-plan.v1';
export const KR_DISCLOSURE_TEMPORAL_FREEZE_TIME_ZONE = 'Asia/Seoul';
export const KR_DISCLOSURE_TEMPORAL_DEFAULT_COLLECTION_PLAN = Object.freeze({
  schemaVersion: KR_DISCLOSURE_TEMPORAL_COLLECTION_PLAN_SCHEMA_VERSION,
  startOffsetDays: 0,
  windowDays: 7,
  limit: 400,
  minIssuers: 100,
  retainedBodyChars: 60_000,
  provider: 'opendart',
  corpClass: 'Y',
  lastReportOnly: false,
  sort: 'date',
  sortDirection: 'asc',
  pageCount: 100,
  stoppingRule: 'fixed-window-fixed-limit-no-backfill.v1',
});
export const KR_DISCLOSURE_TEMPORAL_STRICT_THRESHOLDS = Object.freeze({
  total: 325,
  issuerCount: 100,
  templateCount: 50,
  exactMultisetAccuracy: 0.9,
  exactMultisetWilsonLower: 0.9,
  resolvedCoverage: 0.95,
  resolvedCoverageWilsonLower: 0.92,
  fieldAccuracy: 0.97,
  templateMacroAccuracy: 0.9,
  highConfidenceCount: 35,
  highConfidenceIssuerCount: 30,
  highConfidenceTemplateCount: 20,
  highConfidenceExactPrecision: 0.95,
  highConfidenceWilsonLower: 0.9,
  brierScore: 0.15,
  expectedCalibrationError: 0.1,
});

const CRAWLER_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const REPOSITORY_ROOT = resolve(CRAWLER_ROOT, '../..');
const RFC3161_ROOT = resolve(CRAWLER_ROOT, 'config/rfc3161');
const RFC3161_RESPONSE_MAX_BYTES = 256 * 1024;
const RFC3161_RECEIPT_FIELDS = Object.freeze([
  'authorityId', 'endpoint', 'policyOid', 'expectedAccuracy',
  'formalAccuracyBoundVerified', 'operationalSafetyBufferSeconds',
  'rootSha256', 'untrustedChainSha256', 'payloadSha256',
  'querySha256', 'responseSha256', 'queryDerBase64', 'responseDerBase64',
  'hashAlgorithm', 'genTime', 'nonce', 'accuracy',
]);
const CANDIDATE_PATHS = Object.freeze({
  extractor: resolve(CRAWLER_ROOT, 'src/services/deepscan-kr-disclosure-event-extractors.js'),
  ontology: resolve(CRAWLER_ROOT, 'src/services/deepscan-kr-disclosure-event-ontology.js'),
  classificationDataset: resolve(CRAWLER_ROOT, 'src/data/kr-disclosure-classification-dataset.js'),
  disclosurePipeline: resolve(CRAWLER_ROOT, 'src/services/deepscan-kr-disclosure-pipeline.js'),
  disclosureRiskKeywords: resolve(CRAWLER_ROOT, 'src/services/deepscan-kr-disclosure-risk-keywords.js'),
  safeJson: resolve(CRAWLER_ROOT, '../deepscan-runtime-core/src/safe-json.js'),
  dartFilings: resolve(CRAWLER_ROOT, 'src/crawlers/dart-filings.js'),
  protocol: fileURLToPath(import.meta.url),
  collector: resolve(CRAWLER_ROOT, 'scripts/collect-dart-disclosure-temporal-holdout.mjs'),
  evaluator: resolve(CRAWLER_ROOT, 'scripts/benchmark-dart-disclosure-temporal-holdout.mjs'),
  freezer: resolve(CRAWLER_ROOT, 'scripts/freeze-dart-disclosure-temporal-candidate.mjs'),
  exclusionBuilder: resolve(CRAWLER_ROOT, 'scripts/build-dart-disclosure-temporal-exclusions.mjs'),
  exclusionManifest: resolve(CRAWLER_ROOT, 'test/artifacts/kr-disclosure-event-temporal-exclusions.v1.json'),
  digicertRoot: resolve(RFC3161_ROOT, 'digicert-assured-id-root-ca.crt'),
  digicertChain: resolve(RFC3161_ROOT, 'digicert-timestamp-2025-chain.crt'),
  freeTsaRoot: resolve(RFC3161_ROOT, 'freetsa-root-ca.crt'),
  freeTsaChain: resolve(RFC3161_ROOT, 'freetsa-timestamp-signer.crt'),
});
const CANDIDATE_FILE_FIELDS = Object.freeze({
  extractorSha256: CANDIDATE_PATHS.extractor,
  ontologySourceSha256: CANDIDATE_PATHS.ontology,
  classificationDatasetSha256: CANDIDATE_PATHS.classificationDataset,
  disclosurePipelineSha256: CANDIDATE_PATHS.disclosurePipeline,
  disclosureRiskKeywordsSha256: CANDIDATE_PATHS.disclosureRiskKeywords,
  safeJsonSha256: CANDIDATE_PATHS.safeJson,
  dartFilingsSha256: CANDIDATE_PATHS.dartFilings,
  protocolSha256: CANDIDATE_PATHS.protocol,
  collectorSha256: CANDIDATE_PATHS.collector,
  evaluatorSha256: CANDIDATE_PATHS.evaluator,
  freezerSha256: CANDIDATE_PATHS.freezer,
  exclusionBuilderSha256: CANDIDATE_PATHS.exclusionBuilder,
  exclusionManifestFileSha256: CANDIDATE_PATHS.exclusionManifest,
  digicertRootSha256: CANDIDATE_PATHS.digicertRoot,
  digicertChainSha256: CANDIDATE_PATHS.digicertChain,
  freeTsaRootSha256: CANDIDATE_PATHS.freeTsaRoot,
  freeTsaChainSha256: CANDIDATE_PATHS.freeTsaChain,
});
const CANDIDATE_REPOSITORY_PATHS = Object.freeze(Object.fromEntries(
  Object.entries(CANDIDATE_FILE_FIELDS).map(([field, path]) => [
    field,
    path.slice(REPOSITORY_ROOT.length + 1).replaceAll('\\', '/'),
  ]),
));
const TEMPORAL_COLLECTION_PLAN_FIELDS = Object.freeze(Object.keys(
  KR_DISCLOSURE_TEMPORAL_DEFAULT_COLLECTION_PLAN,
));
const TEMPORAL_CANDIDATE_FINGERPRINT_FIELDS = Object.freeze([
  ...Object.keys(CANDIDATE_FILE_FIELDS),
  'ontologyVersion', 'ontologyManifestSha256', 'thresholdsSha256',
  'timestampAuthoritiesSha256', 'selectionAlgorithm', 'bundleSha256',
]);
const TEMPORAL_CANDIDATE_PRECOMMIT_FIELDS = Object.freeze([
  'schemaVersion', 'experimentId', 'timeZone', 'timestampAuthorities',
  'sampling', 'collectionPlan', 'candidate', 'repository',
]);
const TEMPORAL_CANDIDATE_SAMPLING_FIELDS = Object.freeze([
  'selectionAlgorithm', 'selectionSeedCommitment', 'exclusionManifestSha256',
  'excludedReceiptCount', 'excludedReceiptsSha256', 'excludedReceipts',
]);
const TEMPORAL_CANDIDATE_REPOSITORY_FIELDS = Object.freeze(['gitHead']);
const TEMPORAL_COLLECTION_WINDOW_FIELDS = Object.freeze(['from', 'to']);
const TEMPORAL_BOUNDARY_FIELDS = Object.freeze([
  'formalAccuracyBoundVerified', 'operationalNotBefore', 'cutoff',
  'firstEligibleFilingDate', 'collectionWindow',
]);
const TEMPORAL_CANDIDATE_FREEZE_FIELDS = Object.freeze([
  'schemaVersion', 'timeZone', 'precommit', 'temporalBoundary', 'timestampReceipts',
]);
const TEMPORAL_TIMESTAMP_ENVELOPE_FIELDS = Object.freeze([
  'schemaVersion', 'payloadCanonicalSha256', 'timestampReceipts',
]);

// These public RFC 3161 authorities report `Accuracy: unspecified`, and their
// public policies do not provide a numeric bound for the pinned OIDs. The
// 24-hour value below is therefore only an operational safety buffer for future
// corpus collection, not a cryptographically verified clock-accuracy bound.
// Independent claims remain fail-closed until a contract TSA with a documented
// numeric accuracy bound is configured. HTTP transport is acceptable because
// DER signature, nonce, payload imprint, policy OID, and pinned chain are still
// verified.
export const KR_DISCLOSURE_RFC3161_AUTHORITIES = Object.freeze([
  Object.freeze({
    authorityId: 'digicert-rfc3161-2025',
    endpoint: 'http://timestamp.digicert.com',
    policyOid: '2.16.840.1.114412.7.1',
    expectedAccuracy: 'unspecified',
    formalAccuracyBoundVerified: false,
    operationalSafetyBufferSeconds: 86_400,
    rootPath: CANDIDATE_PATHS.digicertRoot,
    untrustedPath: CANDIDATE_PATHS.digicertChain,
  }),
  Object.freeze({
    authorityId: 'freetsa-rfc3161-2026',
    endpoint: 'https://freetsa.org/tsr',
    policyOid: '1.2.3.4.1',
    expectedAccuracy: 'unspecified',
    formalAccuracyBoundVerified: false,
    operationalSafetyBufferSeconds: 86_400,
    rootPath: CANDIDATE_PATHS.freeTsaRoot,
    untrustedPath: CANDIDATE_PATHS.freeTsaChain,
  }),
]);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
  );
}

export function canonicalJsonBytes(value) {
  return Buffer.from(JSON.stringify(canonicalize(value)), 'utf8');
}

export function canonicalJsonSha256(value) {
  return sha256(canonicalJsonBytes(value));
}

export function temporalDomainSha256(domain, value) {
  const label = String(domain ?? '').trim();
  if (!label) throw new Error('temporal hash domain must be nonempty');
  return sha256(Buffer.concat([
    Buffer.from(`${KR_DISCLOSURE_TEMPORAL_CHAIN_DOMAIN}\0${label}\0`, 'utf8'),
    canonicalJsonBytes(value),
  ]));
}

export function selectionSeedCommitment(selectionSeed) {
  const seed = String(selectionSeed ?? '').trim();
  if (!seed) throw new Error('selection seed must be nonempty');
  return sha256(`jaroo-temporal-holdout-selection-seed-v1\0${seed}`);
}

export function normalizeTemporalDate(value, label = 'date') {
  const compact = String(value ?? '').trim().replaceAll('-', '');
  if (!/^\d{8}$/u.test(compact)) throw new Error(`${label} must be YYYYMMDD or YYYY-MM-DD`);
  const year = Number(compact.slice(0, 4));
  const month = Number(compact.slice(4, 6));
  const day = Number(compact.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.toISOString().slice(0, 10).replaceAll('-', '') !== compact) {
    throw new Error(`${label} is not a valid date`);
  }
  return compact;
}

function datePartsInSeoul(instant) {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: KR_DISCLOSURE_TEMPORAL_FREEZE_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(instant).map((part) => [part.type, part.value]),
  );
}

export function seoulCalendarDate(instant = new Date()) {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) throw new Error('freeze instant must be a valid timestamp');
  const parts = datePartsInSeoul(date);
  return `${parts.year}${parts.month}${parts.day}`;
}

export function nextCalendarDate(value) {
  return addCalendarDays(value, 1);
}

export function addCalendarDays(value, days) {
  const compact = normalizeTemporalDate(value, 'date');
  if (!Number.isInteger(days)) throw new Error('calendar day offset must be an integer');
  const next = new Date(Date.UTC(
    Number(compact.slice(0, 4)),
    Number(compact.slice(4, 6)) - 1,
    Number(compact.slice(6, 8)) + days,
  ));
  return next.toISOString().slice(0, 10).replaceAll('-', '');
}

function planInteger(value, label, { minimum, maximum }) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

export function normalizeTemporalCollectionPlan(
  plan = KR_DISCLOSURE_TEMPORAL_DEFAULT_COLLECTION_PLAN,
) {
  requireExactFields(plan, TEMPORAL_COLLECTION_PLAN_FIELDS, 'collectionPlan');
  const normalized = {
    schemaVersion: plan?.schemaVersion,
    startOffsetDays: planInteger(plan?.startOffsetDays, 'collectionPlan.startOffsetDays', { minimum: 0, maximum: 365 }),
    windowDays: planInteger(plan?.windowDays, 'collectionPlan.windowDays', { minimum: 1, maximum: 92 }),
    limit: planInteger(plan?.limit, 'collectionPlan.limit', { minimum: 1, maximum: 100_000 }),
    minIssuers: planInteger(plan?.minIssuers, 'collectionPlan.minIssuers', { minimum: 1, maximum: 100_000 }),
    retainedBodyChars: planInteger(plan?.retainedBodyChars, 'collectionPlan.retainedBodyChars', { minimum: 1, maximum: 500_000 }),
    provider: String(plan?.provider ?? ''),
    corpClass: String(plan?.corpClass ?? ''),
    lastReportOnly: plan?.lastReportOnly,
    sort: String(plan?.sort ?? ''),
    sortDirection: String(plan?.sortDirection ?? ''),
    pageCount: planInteger(plan?.pageCount, 'collectionPlan.pageCount', { minimum: 1, maximum: 100 }),
    stoppingRule: String(plan?.stoppingRule ?? ''),
  };
  if (normalized.schemaVersion !== KR_DISCLOSURE_TEMPORAL_COLLECTION_PLAN_SCHEMA_VERSION) {
    throw new Error('invalid temporal collection plan schemaVersion');
  }
  if (normalized.minIssuers > normalized.limit) {
    throw new Error('collectionPlan.minIssuers cannot exceed collectionPlan.limit');
  }
  if (normalized.provider !== 'opendart'
    || normalized.corpClass !== 'Y'
    || normalized.lastReportOnly !== false
    || normalized.sort !== 'date'
    || normalized.sortDirection !== 'asc'
    || normalized.pageCount !== 100
    || normalized.stoppingRule !== 'fixed-window-fixed-limit-no-backfill.v1') {
    throw new Error('temporal collection plan provider and stopping policy must match the frozen OpenDART protocol');
  }
  return Object.freeze(normalized);
}

export function deriveTemporalCollectionWindow(firstEligibleFilingDate, collectionPlan) {
  const plan = normalizeTemporalCollectionPlan(collectionPlan);
  const from = addCalendarDays(firstEligibleFilingDate, plan.startOffsetDays);
  return Object.freeze({
    from,
    to: addCalendarDays(from, plan.windowDays - 1),
  });
}

function requireSha256(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest`);
  }
}

function requireCanonicalIso(value, label) {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime()) || instant.toISOString() !== value) {
    throw new Error(`${label} must be a canonical ISO timestamp`);
  }
  return instant;
}

function canonicalBase64(value, label, { maximumBytes = RFC3161_RESPONSE_MAX_BYTES } = {}) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be nonempty base64`);
  const maximumEncodedLength = Math.ceil(maximumBytes / 3) * 4;
  if (value.length > maximumEncodedLength) {
    throw new Error(`${label} exceeds ${maximumBytes} bytes`);
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length === 0 || bytes.toString('base64') !== value) throw new Error(`${label} must be canonical base64`);
  if (bytes.length > maximumBytes) throw new Error(`${label} exceeds ${maximumBytes} bytes`);
  return bytes;
}

function gitOutput(args, { encoding = 'utf8' } = {}) {
  return execFileSync('git', args, {
    cwd: REPOSITORY_ROOT,
    encoding,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

function opensslOutput(args) {
  return execFileSync('openssl', args, {
    encoding: 'utf8',
    env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function timestampAuthoritySnapshot(policy) {
  return Object.freeze({
    authorityId: policy.authorityId,
    endpoint: policy.endpoint,
    policyOid: policy.policyOid,
    expectedAccuracy: policy.expectedAccuracy,
    formalAccuracyBoundVerified: policy.formalAccuracyBoundVerified,
    operationalSafetyBufferSeconds: policy.operationalSafetyBufferSeconds,
    rootSha256: sha256(readFileSync(policy.rootPath)),
    untrustedChainSha256: sha256(readFileSync(policy.untrustedPath)),
  });
}

async function readBoundedResponseBytes(response, label) {
  const declaredLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > RFC3161_RESPONSE_MAX_BYTES) {
    throw new Error(`${label} RFC3161 response exceeds ${RFC3161_RESPONSE_MAX_BYTES} bytes`);
  }
  if (!response.body?.getReader) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > RFC3161_RESPONSE_MAX_BYTES) {
      throw new Error(`${label} RFC3161 response exceeds ${RFC3161_RESPONSE_MAX_BYTES} bytes`);
    }
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > RFC3161_RESPONSE_MAX_BYTES) {
      await reader.cancel();
      throw new Error(`${label} RFC3161 response exceeds ${RFC3161_RESPONSE_MAX_BYTES} bytes`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

export function currentRfc3161AuthorityManifest(
  policies = KR_DISCLOSURE_RFC3161_AUTHORITIES,
) {
  return Object.freeze(policies.map(timestampAuthoritySnapshot));
}

async function issueRfc3161Receipt(payload, policy, { fetchImpl = fetch } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'jaroo-rfc3161-issue-'));
  const payloadPath = join(directory, 'payload.json');
  const queryPath = join(directory, 'request.tsq');
  const responsePath = join(directory, 'response.tsr');
  try {
    const payloadBytes = canonicalJsonBytes(payload);
    writeFileSync(payloadPath, payloadBytes);
    opensslOutput(['ts', '-query', '-data', payloadPath, '-sha256', '-cert', '-out', queryPath]);
    const queryBytes = readFileSync(queryPath);
    const response = await fetchImpl(policy.endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/timestamp-reply',
        'Content-Type': 'application/timestamp-query',
      },
      body: queryBytes,
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`${policy.authorityId} returned HTTP ${response.status}`);
    const responseBytes = await readBoundedResponseBytes(response, policy.authorityId);
    if (responseBytes.length < 32) throw new Error(`${policy.authorityId} returned an empty RFC3161 response`);
    writeFileSync(responsePath, responseBytes);
    const parsed = parseTimestampReply(
      opensslOutput(['ts', '-reply', '-in', responsePath, '-text']),
      policy.authorityId,
    );
    return Object.freeze({
      ...timestampAuthoritySnapshot(policy),
      payloadSha256: sha256(payloadBytes),
      querySha256: sha256(queryBytes),
      responseSha256: sha256(responseBytes),
      queryDerBase64: queryBytes.toString('base64'),
      responseDerBase64: responseBytes.toString('base64'),
      policyOid: parsed.policyOid,
      hashAlgorithm: parsed.hashAlgorithm,
      genTime: parsed.genTime,
      nonce: parsed.nonce,
      accuracy: parsed.accuracy,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export async function issueRfc3161ReceiptSet(payload, {
  policies = KR_DISCLOSURE_RFC3161_AUTHORITIES,
  fetchImpl = fetch,
} = {}) {
  const receipts = [];
  for (const policy of policies) {
    receipts.push(await issueRfc3161Receipt(payload, policy, { fetchImpl }));
  }
  return Object.freeze(receipts);
}

function parseTimestampReply(text, label) {
  const field = (name) => text.match(new RegExp(`^${name}:\\s*(.+)$`, 'mu'))?.[1]?.trim() ?? null;
  const status = field('Status');
  if (status !== 'Granted.') throw new Error(`${label} RFC3161 status must be Granted`);
  const policyOid = field('Policy OID');
  const hashAlgorithm = field('Hash Algorithm');
  const timeStamp = field('Time stamp');
  const nonce = field('Nonce');
  if (hashAlgorithm !== 'sha256') throw new Error(`${label} RFC3161 hash algorithm must be sha256`);
  const genTime = new Date(timeStamp);
  if (!timeStamp || Number.isNaN(genTime.getTime())) throw new Error(`${label} RFC3161 genTime is invalid`);
  if (!nonce || !/^0x[0-9A-F]+$/u.test(nonce)) throw new Error(`${label} RFC3161 nonce is missing`);
  return Object.freeze({
    status,
    policyOid,
    hashAlgorithm,
    genTime: genTime.toISOString(),
    nonce,
    accuracy: field('Accuracy'),
  });
}

function verifyRfc3161Crypto(payloadBytes, queryBytes, responseBytes, policy) {
  const directory = mkdtempSync(join(tmpdir(), 'jaroo-rfc3161-'));
  const payloadPath = join(directory, 'payload.json');
  const queryPath = join(directory, 'request.tsq');
  const responsePath = join(directory, 'response.tsr');
  try {
    writeFileSync(payloadPath, payloadBytes);
    writeFileSync(queryPath, queryBytes);
    writeFileSync(responsePath, responseBytes);
    const trustArgs = ['-CAfile', policy.rootPath, '-untrusted', policy.untrustedPath];
    opensslOutput(['ts', '-verify', '-data', payloadPath, '-in', responsePath, ...trustArgs]);
    opensslOutput(['ts', '-verify', '-queryfile', queryPath, '-in', responsePath, ...trustArgs]);
    return parseTimestampReply(
      opensslOutput(['ts', '-reply', '-in', responsePath, '-text']),
      policy.authorityId,
    );
  } catch (error) {
    const details = String(error?.stderr ?? error?.message ?? '').trim().split('\n').at(-1);
    throw new Error(`${policy.authorityId} RFC3161 verification failed${details ? `: ${details}` : ''}`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function validateRfc3161Receipts(payload, receipts, {
  policies = KR_DISCLOSURE_RFC3161_AUTHORITIES,
  verifyCrypto = true,
  now = new Date(),
} = {}) {
  if (!Array.isArray(receipts) || receipts.length !== policies.length) {
    throw new Error(`RFC3161 receipt set must contain exactly ${policies.length} authorities`);
  }
  const payloadBytes = canonicalJsonBytes(payload);
  const payloadSha256 = sha256(payloadBytes);
  const validationInstant = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(validationInstant.getTime())) throw new Error('RFC3161 validation time must be valid');
  const verified = [];
  const seen = new Set();
  for (const policy of policies) {
    const receipt = receipts.find((entry) => entry?.authorityId === policy.authorityId);
    if (!receipt || seen.has(receipt.authorityId)) throw new Error(`missing or duplicate RFC3161 receipt ${policy.authorityId}`);
    requireExactFields(receipt, RFC3161_RECEIPT_FIELDS, `${policy.authorityId} RFC3161 receipt`);
    seen.add(receipt.authorityId);
    const snapshot = timestampAuthoritySnapshot(policy);
    for (const field of [
      'endpoint',
      'policyOid',
      'expectedAccuracy',
      'formalAccuracyBoundVerified',
      'operationalSafetyBufferSeconds',
      'rootSha256',
      'untrustedChainSha256',
    ]) {
      if (receipt[field] !== snapshot[field]) throw new Error(`${policy.authorityId} RFC3161 ${field} does not match policy`);
    }
    if (receipt.payloadSha256 !== payloadSha256) throw new Error(`${policy.authorityId} RFC3161 payload hash mismatch`);
    const queryBytes = canonicalBase64(receipt.queryDerBase64, `${policy.authorityId}.queryDerBase64`);
    const responseBytes = canonicalBase64(receipt.responseDerBase64, `${policy.authorityId}.responseDerBase64`);
    if (receipt.querySha256 !== sha256(queryBytes)) throw new Error(`${policy.authorityId} RFC3161 query hash mismatch`);
    if (receipt.responseSha256 !== sha256(responseBytes)) throw new Error(`${policy.authorityId} RFC3161 response hash mismatch`);
    const suppliedGenTime = requireCanonicalIso(receipt.genTime, `${policy.authorityId}.genTime`);
    if (suppliedGenTime.getTime() > validationInstant.getTime() + 5 * 60_000) {
      throw new Error(`${policy.authorityId} RFC3161 genTime cannot be in the future`);
    }
    if (typeof receipt.nonce !== 'string' || !/^0x[0-9A-F]+$/u.test(receipt.nonce)) {
      throw new Error(`${policy.authorityId} RFC3161 nonce is invalid`);
    }
    if (verifyCrypto) {
      const parsed = verifyRfc3161Crypto(payloadBytes, queryBytes, responseBytes, policy);
      for (const field of ['policyOid', 'hashAlgorithm', 'genTime', 'nonce', 'accuracy']) {
        if (receipt[field] !== parsed[field]) throw new Error(`${policy.authorityId} RFC3161 ${field} does not match DER response`);
      }
    } else if (receipt.hashAlgorithm !== 'sha256') {
      throw new Error(`${policy.authorityId} RFC3161 hashAlgorithm must be sha256`);
    }
    if (receipt.accuracy !== policy.expectedAccuracy) {
      throw new Error(`${policy.authorityId} RFC3161 accuracy no longer matches the pinned conservative policy`);
    }
    const operationalNotBefore = new Date(
      suppliedGenTime.getTime() + policy.operationalSafetyBufferSeconds * 1_000,
    );
    verified.push(Object.freeze({
      ...receipt,
      formalAccuracyBoundVerified: false,
      operationalNotBefore: operationalNotBefore.toISOString(),
    }));
  }
  const genTimes = verified.map((entry) => new Date(entry.genTime).getTime());
  const operationalBoundaries = verified.map((entry) => new Date(entry.operationalNotBefore).getTime());
  return Object.freeze({
    payloadSha256,
    receipts: Object.freeze(verified),
    earliestGenTime: new Date(Math.min(...genTimes)).toISOString(),
    latestGenTime: new Date(Math.max(...genTimes)).toISOString(),
    formalAccuracyBoundVerified: false,
    operationalNotBefore: new Date(Math.max(...operationalBoundaries)).toISOString(),
  });
}

export function createDetachedTimestampEnvelope(payload, timestampReceipts) {
  return Object.freeze({
    schemaVersion: KR_DISCLOSURE_TEMPORAL_TIMESTAMP_ENVELOPE_SCHEMA_VERSION,
    payloadCanonicalSha256: canonicalJsonSha256(payload),
    timestampReceipts,
  });
}

export function validateDetachedTimestampEnvelope(payload, envelope, options = {}) {
  requireExactFields(envelope, TEMPORAL_TIMESTAMP_ENVELOPE_FIELDS, 'detached timestamp envelope');
  if (envelope?.schemaVersion !== KR_DISCLOSURE_TEMPORAL_TIMESTAMP_ENVELOPE_SCHEMA_VERSION) {
    throw new Error('invalid detached timestamp envelope schemaVersion');
  }
  if (envelope.payloadCanonicalSha256 !== canonicalJsonSha256(payload)) {
    throw new Error('detached timestamp payload canonical hash mismatch');
  }
  return validateRfc3161Receipts(payload, envelope.timestampReceipts, options);
}

export function currentTemporalCandidateFingerprint(thresholds = KR_DISCLOSURE_TEMPORAL_STRICT_THRESHOLDS) {
  if (!thresholds || typeof thresholds !== 'object' || Array.isArray(thresholds)) {
    throw new Error('strict thresholds are required to fingerprint the candidate');
  }
  const components = {
    ...Object.fromEntries(Object.entries(CANDIDATE_FILE_FIELDS).map(([field, path]) => [
      field,
      sha256(readFileSync(path)),
    ])),
    ontologyVersion: KR_DISCLOSURE_EVENT_ONTOLOGY_VERSION,
    ontologyManifestSha256: KR_DISCLOSURE_EVENT_ONTOLOGY_HASH,
    thresholdsSha256: sha256(JSON.stringify(thresholds)),
    timestampAuthoritiesSha256: canonicalJsonSha256(currentRfc3161AuthorityManifest()),
    selectionAlgorithm: KR_DISCLOSURE_TEMPORAL_SELECTION_ALGORITHM,
  };
  return Object.freeze({
    ...components,
    bundleSha256: canonicalJsonSha256(components),
  });
}

export function currentTemporalRepositoryAnchor() {
  const gitHead = gitOutput(['rev-parse', 'HEAD']).trim();
  if (!/^[a-f0-9]{40}$/u.test(gitHead)) {
    throw new Error('current repository HEAD cannot anchor the temporal candidate');
  }
  return Object.freeze({ gitHead });
}

function currentFrozenExclusion() {
  const bytes = readFileSync(CANDIDATE_PATHS.exclusionManifest);
  const manifest = JSON.parse(bytes.toString('utf8'));
  if (manifest?.schemaVersion !== 'jaroo.kr-disclosure-event-temporal-exclusions.v1'
    || !Array.isArray(manifest.receiptNumbers)) {
    throw new Error('frozen temporal exclusion manifest is invalid');
  }
  const receipts = [...new Set(manifest.receiptNumbers.map((value) => String(value).trim()))].sort();
  if (receipts.length !== manifest.receiptNumbers.length
    || receipts.length === 0
    || receipts.some((value) => !/^\d{14}$/u.test(value))) {
    throw new Error('frozen temporal exclusion receipt set is invalid');
  }
  return Object.freeze({ sha256: sha256(bytes), receipts: Object.freeze(receipts) });
}

export function buildTemporalCandidatePrecommit({
  experimentId,
  selectionSeed,
  exclusionManifestSha256,
  excludedReceipts,
  collectionPlan = KR_DISCLOSURE_TEMPORAL_DEFAULT_COLLECTION_PLAN,
  thresholds = KR_DISCLOSURE_TEMPORAL_STRICT_THRESHOLDS,
  repository = currentTemporalRepositoryAnchor(),
} = {}) {
  const normalizedExperimentId = String(experimentId ?? '').trim();
  if (!/^[a-z0-9][a-z0-9._-]{7,127}$/u.test(normalizedExperimentId)) {
    throw new Error('experimentId must be 8-128 lowercase identifier characters');
  }
  requireSha256(exclusionManifestSha256, 'exclusionManifestSha256');
  const receipts = [...new Set(Array.from(excludedReceipts ?? [], (value) => String(value).trim()))].sort();
  if (receipts.length === 0 || receipts.some((value) => !/^\d{14}$/u.test(value))) {
    throw new Error('excludedReceipts must contain valid 14-digit OpenDART receipt numbers');
  }
  const frozenExclusion = currentFrozenExclusion();
  if (exclusionManifestSha256 !== frozenExclusion.sha256
    || JSON.stringify(receipts) !== JSON.stringify(frozenExclusion.receipts)) {
    throw new Error('candidate precommit must use the repository-frozen temporal exclusion manifest');
  }
  return Object.freeze({
    schemaVersion: 'jaroo.kr-disclosure-event-candidate-precommit.v2',
    experimentId: normalizedExperimentId,
    timeZone: KR_DISCLOSURE_TEMPORAL_FREEZE_TIME_ZONE,
    timestampAuthorities: currentRfc3161AuthorityManifest(),
    sampling: Object.freeze({
      selectionAlgorithm: KR_DISCLOSURE_TEMPORAL_SELECTION_ALGORITHM,
      selectionSeedCommitment: selectionSeedCommitment(selectionSeed),
      exclusionManifestSha256,
      excludedReceiptCount: receipts.length,
      excludedReceiptsSha256: temporalDomainSha256('excluded-receipts', receipts),
      excludedReceipts: Object.freeze(receipts),
    }),
    collectionPlan: normalizeTemporalCollectionPlan(collectionPlan),
    candidate: currentTemporalCandidateFingerprint(thresholds),
    repository: Object.freeze({ gitHead: String(repository?.gitHead ?? '') }),
  });
}

export function buildTemporalCandidateFreeze({
  precommit,
  timestampReceipts,
  now = new Date(),
} = {}) {
  const timestamp = validateRfc3161Receipts(precommit, timestampReceipts, { verifyCrypto: true, now });
  const cutoff = seoulCalendarDate(timestamp.operationalNotBefore);
  const firstEligibleFilingDate = nextCalendarDate(cutoff);
  return Object.freeze({
    schemaVersion: KR_DISCLOSURE_TEMPORAL_FREEZE_SCHEMA_VERSION,
    timeZone: KR_DISCLOSURE_TEMPORAL_FREEZE_TIME_ZONE,
    precommit,
    temporalBoundary: Object.freeze({
      formalAccuracyBoundVerified: timestamp.formalAccuracyBoundVerified,
      operationalNotBefore: timestamp.operationalNotBefore,
      cutoff,
      firstEligibleFilingDate,
      collectionWindow: deriveTemporalCollectionWindow(firstEligibleFilingDate, precommit.collectionPlan),
    }),
    timestampReceipts,
  });
}

function validateCandidateRepositoryAnchor(precommit) {
  const repository = precommit.repository;
  if (!/^[a-f0-9]{40}$/u.test(repository?.gitHead ?? '')) {
    throw new Error('candidate freeze repository.gitHead must be a full Git commit id');
  }
  try {
    gitOutput(['cat-file', '-e', `${repository.gitHead}^{commit}`]);
  } catch {
    throw new Error('candidate freeze Git commit is not available in the repository');
  }
  const committedHashes = Object.fromEntries(Object.entries(CANDIDATE_REPOSITORY_PATHS).map(([field, path]) => [
    field,
    sha256(gitOutput(['show', `${repository.gitHead}:${path}`], { encoding: null })),
  ]));
  for (const [field, committedHash] of Object.entries(committedHashes)) {
    if (precommit.candidate[field] !== committedHash) {
      throw new Error(`candidate freeze ${field} is not anchored by repository.gitHead`);
    }
  }
}

export function validateTemporalCandidateFreeze(manifest, {
  selectionSeed,
  exclusion,
  thresholds = KR_DISCLOSURE_TEMPORAL_STRICT_THRESHOLDS,
  verifyCurrentCandidate = true,
  verifyRepositoryAnchor = true,
  verifyExternalTimestamps = true,
  now = new Date(),
} = {}) {
  requireExactFields(manifest, TEMPORAL_CANDIDATE_FREEZE_FIELDS, 'candidate freeze manifest');
  if (manifest?.schemaVersion !== KR_DISCLOSURE_TEMPORAL_FREEZE_SCHEMA_VERSION) {
    throw new Error('invalid temporal candidate freeze schemaVersion');
  }
  if (manifest.timeZone !== KR_DISCLOSURE_TEMPORAL_FREEZE_TIME_ZONE) {
    throw new Error(`temporal candidate freeze timeZone must be ${KR_DISCLOSURE_TEMPORAL_FREEZE_TIME_ZONE}`);
  }
  const precommit = manifest.precommit;
  requireExactFields(precommit, TEMPORAL_CANDIDATE_PRECOMMIT_FIELDS, 'candidate freeze precommit');
  if (precommit?.schemaVersion !== 'jaroo.kr-disclosure-event-candidate-precommit.v2') {
    throw new Error('invalid temporal candidate precommit schemaVersion');
  }
  if (precommit.timeZone !== KR_DISCLOSURE_TEMPORAL_FREEZE_TIME_ZONE) {
    throw new Error('candidate precommit timeZone mismatch');
  }
  if (!/^[a-z0-9][a-z0-9._-]{7,127}$/u.test(precommit.experimentId)) {
    throw new Error('candidate precommit experimentId is invalid');
  }
  if (canonicalJsonSha256(precommit.timestampAuthorities)
    !== canonicalJsonSha256(currentRfc3161AuthorityManifest())) {
    throw new Error('candidate precommit RFC3161 authority policy mismatch');
  }
  const sampling = precommit.sampling;
  requireExactFields(sampling, TEMPORAL_CANDIDATE_SAMPLING_FIELDS, 'candidate freeze sampling');
  if (sampling?.selectionAlgorithm !== KR_DISCLOSURE_TEMPORAL_SELECTION_ALGORITHM) {
    throw new Error('candidate freeze selection algorithm mismatch');
  }
  requireSha256(sampling?.selectionSeedCommitment, 'candidateFreeze.sampling.selectionSeedCommitment');
  if (selectionSeed !== undefined && sampling.selectionSeedCommitment !== selectionSeedCommitment(selectionSeed)) {
    throw new Error('selection seed does not match the temporal candidate freeze commitment');
  }
  requireSha256(sampling?.exclusionManifestSha256, 'candidateFreeze.sampling.exclusionManifestSha256');
  requireSha256(sampling?.excludedReceiptsSha256, 'candidateFreeze.sampling.excludedReceiptsSha256');
  if (!Array.isArray(sampling?.excludedReceipts) || sampling.excludedReceipts.length === 0) {
    throw new Error('candidate freeze excluded receipt set must be nonempty');
  }
  const sortedExcluded = [...sampling.excludedReceipts].sort();
  if (new Set(sortedExcluded).size !== sortedExcluded.length
    || sortedExcluded.some((receipt) => !/^\d{14}$/u.test(receipt))) {
    throw new Error('candidate freeze excluded receipt set is invalid');
  }
  if (JSON.stringify(sortedExcluded) !== JSON.stringify(sampling.excludedReceipts)) {
    throw new Error('candidate freeze excluded receipt set must be sorted');
  }
  if (sampling.excludedReceiptCount !== sortedExcluded.length) {
    throw new Error('candidate freeze excluded receipt count is stale');
  }
  if (sampling.excludedReceiptsSha256 !== temporalDomainSha256('excluded-receipts', sortedExcluded)) {
    throw new Error('candidate freeze excluded receipt set hash mismatch');
  }
  if (exclusion) {
    if (sampling.exclusionManifestSha256 !== exclusion.sha256) {
      throw new Error('exclusion manifest bytes do not match the temporal candidate freeze');
    }
    if (JSON.stringify([...exclusion.receipts].sort()) !== JSON.stringify(sortedExcluded)) {
      throw new Error('exclusion receipt set does not match the temporal candidate freeze');
    }
  }
  const collectionPlan = normalizeTemporalCollectionPlan(precommit.collectionPlan);
  const candidate = precommit.candidate;
  requireExactFields(candidate, TEMPORAL_CANDIDATE_FINGERPRINT_FIELDS, 'candidate fingerprint');
  for (const field of [
    ...Object.keys(CANDIDATE_FILE_FIELDS),
    'ontologyManifestSha256',
    'thresholdsSha256',
    'timestampAuthoritiesSha256',
    'bundleSha256',
  ]) requireSha256(candidate[field], `candidateFreeze.candidate.${field}`);
  if (candidate.ontologyVersion !== KR_DISCLOSURE_EVENT_ONTOLOGY_VERSION) {
    throw new Error(`candidate freeze ontologyVersion must equal ${KR_DISCLOSURE_EVENT_ONTOLOGY_VERSION}`);
  }
  if (candidate.ontologyManifestSha256 !== KR_DISCLOSURE_EVENT_ONTOLOGY_HASH) {
    throw new Error('candidate freeze ontology manifest hash does not match the frozen ontology');
  }
  if (candidate.selectionAlgorithm !== KR_DISCLOSURE_TEMPORAL_SELECTION_ALGORITHM) {
    throw new Error('candidate fingerprint selection algorithm mismatch');
  }
  const bundle = { ...candidate };
  delete bundle.bundleSha256;
  if (candidate.bundleSha256 !== canonicalJsonSha256(bundle)) {
    throw new Error('candidate freeze bundleSha256 does not match its component hashes');
  }
  if (verifyCurrentCandidate) {
    const current = currentTemporalCandidateFingerprint(thresholds);
    for (const field of Object.keys(current)) {
      if (candidate[field] !== current[field]) {
        throw new Error(`current candidate ${field} does not match the frozen candidate`);
      }
    }
    const frozenExclusion = currentFrozenExclusion();
    if (sampling.exclusionManifestSha256 !== frozenExclusion.sha256
      || JSON.stringify(sortedExcluded) !== JSON.stringify(frozenExclusion.receipts)) {
      throw new Error('candidate freeze does not match the repository-frozen exclusion manifest');
    }
  }
  requireExactFields(precommit.repository, TEMPORAL_CANDIDATE_REPOSITORY_FIELDS, 'candidate repository');
  if (verifyRepositoryAnchor) validateCandidateRepositoryAnchor(precommit);
  const timestamp = validateRfc3161Receipts(precommit, manifest.timestampReceipts, {
    verifyCrypto: verifyExternalTimestamps,
    now,
  });
  const cutoff = seoulCalendarDate(timestamp.operationalNotBefore);
  const firstEligibleFilingDate = nextCalendarDate(cutoff);
  const collectionWindow = deriveTemporalCollectionWindow(firstEligibleFilingDate, collectionPlan);
  requireExactFields(manifest.temporalBoundary, TEMPORAL_BOUNDARY_FIELDS, 'candidate temporal boundary');
  requireExactFields(
    manifest.temporalBoundary.collectionWindow,
    TEMPORAL_COLLECTION_WINDOW_FIELDS,
    'candidate collection window',
  );
  if (manifest.temporalBoundary?.formalAccuracyBoundVerified !== timestamp.formalAccuracyBoundVerified
    || manifest.temporalBoundary?.operationalNotBefore !== timestamp.operationalNotBefore
    || manifest.temporalBoundary?.cutoff !== cutoff
    || manifest.temporalBoundary?.firstEligibleFilingDate !== firstEligibleFilingDate
    || canonicalJsonSha256(manifest.temporalBoundary?.collectionWindow) !== canonicalJsonSha256(collectionWindow)) {
    throw new Error('candidate freeze temporal boundary does not match verified RFC3161 receipts');
  }
  return Object.freeze({
    ...manifest,
    cutoff,
    firstEligibleFilingDate,
    collectionPlan,
    collectionWindow,
    sampling,
    candidate,
    timestamp,
  });
}

export function createCandidateFreezeEnvelope(manifest, fileBytes) {
  const bytes = Buffer.isBuffer(fileBytes) ? fileBytes : Buffer.from(fileBytes);
  return Object.freeze({
    manifestFileSha256: sha256(bytes),
    manifestCanonicalSha256: canonicalJsonSha256(manifest),
    manifest,
  });
}

export function validateCandidateFreezeEnvelope(envelope, options = {}) {
  requireExactFields(envelope, TEMPORAL_CANDIDATE_FREEZE_ENVELOPE_FIELDS, 'candidate freeze envelope');
  requireSha256(envelope?.manifestFileSha256, 'candidateFreeze.manifestFileSha256');
  requireSha256(envelope?.manifestCanonicalSha256, 'candidateFreeze.manifestCanonicalSha256');
  if (envelope.manifestCanonicalSha256 !== canonicalJsonSha256(envelope.manifest)) {
    throw new Error('candidate freeze canonical hash does not match the embedded manifest');
  }
  const canonicalFileBytes = Buffer.from(`${JSON.stringify(envelope.manifest, null, 2)}\n`, 'utf8');
  if (envelope.manifestFileSha256 !== sha256(canonicalFileBytes)) {
    throw new Error('candidate freeze file hash does not match the canonical manifest bytes');
  }
  return validateTemporalCandidateFreeze(envelope.manifest, options);
}

export function normalizeTitleTemplate(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/^\[(?:기재정정|첨부정정|첨부추가|변경등록|연장결정|발행조건확정|정정제출요구)\]/u, '')
    .replace(/\s*\(20\d{2}\.\d{2}\)\s*$/u, '')
    .replaceAll(/\s+/gu, '')
    .trim();
}

function canonicalCompare(left, right) {
  return String(left.receiptDate ?? '').localeCompare(String(right.receiptDate ?? ''))
    || String(left.rceptNo ?? '').localeCompare(String(right.rceptNo ?? ''));
}

export function dedupeFilings(filings) {
  const byReceipt = new Map();
  for (const filing of Array.isArray(filings) ? filings : []) {
    const rceptNo = String(filing?.rceptNo ?? filing?.rcept_no ?? '').trim();
    if (rceptNo && !byReceipt.has(rceptNo)) byReceipt.set(rceptNo, { ...filing, rceptNo });
  }
  return [...byReceipt.values()].sort(canonicalCompare);
}

function issuerKey(filing) {
  return String(filing.corpCode ?? '').trim();
}

function stratumKey(filing) {
  return `${issuerKey(filing)}|${normalizeTitleTemplate(filing.reportName ?? filing.title)}`;
}

export function selectStratifiedFilings(filings, {
  limit = null,
  minIssuers = 1,
  selectionSeed,
  excludedReceipts = new Set(),
} = {}) {
  const seedCommitment = selectionSeedCommitment(selectionSeed);
  const exclusions = excludedReceipts instanceof Set ? excludedReceipts : new Set(excludedReceipts);
  const candidates = dedupeFilings(filings)
    .filter((filing) => issuerKey(filing) && !exclusions.has(filing.rceptNo));
  const issuerGroups = new Map();
  for (const candidate of candidates) {
    const key = issuerKey(candidate);
    if (!issuerGroups.has(key)) issuerGroups.set(key, []);
    issuerGroups.get(key).push(candidate);
  }
  if (issuerGroups.size < minIssuers) {
    throw new Error(`only ${issuerGroups.size} issuers are available; --min-issuers requires ${minIssuers}`);
  }
  if (limit !== null && candidates.length < limit) {
    throw new Error(`only ${candidates.length} non-excluded filings are available; --limit requires ${limit}`);
  }
  if (limit === null || candidates.length <= limit) return candidates;

  const selected = [];
  const selectedReceipts = new Set();
  const add = (candidate) => {
    if (!candidate || selectedReceipts.has(candidate.rceptNo) || selected.length >= limit) return false;
    selected.push(candidate);
    selectedReceipts.add(candidate.rceptNo);
    return true;
  };
  const stableHash = (value) => sha256(String(value));
  const orderedIssuers = [...issuerGroups.entries()].sort((left, right) => (
    stableHash(`${seedCommitment}|issuer|${left[0]}`).localeCompare(stableHash(`${seedCommitment}|issuer|${right[0]}`))
      || left[0].localeCompare(right[0])
  ));
  for (const [, group] of orderedIssuers.slice(0, Math.min(limit, orderedIssuers.length))) {
    add([...group].sort((left, right) => (
      stableHash(`${seedCommitment}|stratum|${stratumKey(left)}`).localeCompare(stableHash(`${seedCommitment}|stratum|${stratumKey(right)}`))
        || canonicalCompare(left, right)
    ))[0]);
  }
  const strata = new Map();
  for (const candidate of candidates) {
    const key = stratumKey(candidate);
    if (!strata.has(key)) strata.set(key, []);
    strata.get(key).push(candidate);
  }
  const queues = [...strata.entries()]
    .sort((left, right) => (
      stableHash(`${seedCommitment}|queue|${left[0]}`).localeCompare(stableHash(`${seedCommitment}|queue|${right[0]}`))
        || left[0].localeCompare(right[0])
    ))
    .map(([, group]) => group.sort(canonicalCompare));
  let depth = 0;
  while (selected.length < limit) {
    let hasCandidateAtDepth = false;
    for (const queue of queues) {
      if (queue[depth]) {
        hasCandidateAtDepth = true;
        add(queue[depth]);
      }
      if (selected.length >= limit) break;
    }
    if (!hasCandidateAtDepth) break;
    depth += 1;
  }
  return selected.sort(canonicalCompare);
}

function filingProjection(filing) {
  return Object.freeze({
    rceptNo: String(filing?.rceptNo ?? '').trim(),
    receiptDate: normalizeTemporalDate(filing?.receiptDate, 'filing.receiptDate'),
    corpCode: String(filing?.corpCode ?? '').trim(),
    corpName: String(filing?.corpName ?? '').trim() || null,
    stockCode: String(filing?.stockCode ?? '').trim() || null,
    corpClass: String(filing?.corpClass ?? '').trim(),
    reportName: String(filing?.reportName ?? filing?.title ?? '').trim(),
    filerName: String(filing?.filerName ?? '').trim() || null,
    remarks: String(filing?.remarks ?? '').trim() || null,
  });
}

function validateReceiptIdentity(projection, label, { requireCorpCode = true } = {}) {
  if (!/^\d{14}$/u.test(projection.rceptNo)) throw new Error(`${label}.rceptNo must be a 14-digit OpenDART receipt`);
  if (projection.rceptNo.slice(0, 8) !== projection.receiptDate) {
    throw new Error(`${label}.receiptDate must equal the receipt-number date prefix`);
  }
  if (projection.corpClass !== 'Y' || !projection.reportName) {
    throw new Error(`${label} must contain KOSPI corpClass Y and reportName`);
  }
  if (requireCorpCode && !projection.corpCode) {
    throw new Error(`${label} must contain a KOSPI corpCode`);
  }
}

const TEMPORAL_CASE_INPUT_FIELDS = Object.freeze([
  'rceptNo', 'receiptDate', 'issuer', 'stockCode', 'title', 'body',
]);
const TEMPORAL_CASE_SOURCE_FIELDS = Object.freeze([
  'provider', 'corpClass', 'corpCode', 'filerName', 'remarks',
  'listApiPath', 'documentApiPath', 'documentSource', 'fileCount',
  'fullCharCount', 'retainedCharCount', 'truncated', 'fullSha256', 'retainedSha256',
]);
const TEMPORAL_RAW_CASE_FIELDS = Object.freeze(['id', 'labelStatus', 'input', 'source']);
const TEMPORAL_ANNOTATED_CASE_FIELDS = Object.freeze([
  'templateKey', 'goldDisposition', 'expectedEvents', 'annotations', 'adjudication',
]);
const TEMPORAL_CANDIDATE_FREEZE_ENVELOPE_FIELDS = Object.freeze([
  'manifestFileSha256', 'manifestCanonicalSha256', 'manifest',
]);
const TEMPORAL_RAW_ENVELOPE_FIELDS = Object.freeze([
  'schemaVersion', 'payloadCanonicalSha256', 'payload', 'timestampReceipts',
]);
const TEMPORAL_RAW_PAYLOAD_FIELDS = Object.freeze([
  'schemaVersion', 'labelStatus', 'candidateFreeze', 'query', 'source', 'capture',
  'listedFilings', 'population', 'cases', 'selection',
]);
const TEMPORAL_RAW_QUERY_FIELDS = Object.freeze([
  'from', 'to', 'cutoff', 'corpClass', 'lastReportOnly', 'sort', 'sortDirection',
  'pageCount', 'limit', 'minIssuers', 'sampling', 'stoppingRule',
  'selectionSeedReveal', 'selectionSeedCommitment', 'selectionAlgorithm',
  'exclusionManifestSha256', 'excludedReceiptCount', 'excludedReceiptsSha256',
  'retainedBodyChars', 'concurrency', 'timeoutMs',
]);
const TEMPORAL_RAW_QUERY_INPUT_FIELDS = Object.freeze(
  TEMPORAL_RAW_QUERY_FIELDS.filter((field) => field !== 'selectionAlgorithm'),
);
const TEMPORAL_RAW_SOURCE_FIELDS = Object.freeze([
  'provider', 'listApiPath', 'documentApiPath', 'market',
]);
const TEMPORAL_RAW_CAPTURE_FIELDS = Object.freeze([
  'providerTotalCount', 'listedCount', 'pagesFetched', 'deduplicatedCount',
  'eligibleCount', 'duplicateCount', 'excludedInWindowCount', 'selectedCount',
  'caseCount', 'documentFailureCount', 'uniqueIssuerCount',
  'uniqueTitleTemplateCount', 'truncatedBodyCount', 'retainedBodyCharCount',
]);
const TEMPORAL_RAW_SELECTION_FIELDS = Object.freeze([
  'algorithm', 'populationSha256', 'selectedReceiptNumbers',
  'selectedReceiptsSha256', 'selectedCaseDigests', 'selectedCasesSha256',
]);
const TEMPORAL_FILING_FIELDS = Object.freeze([
  'rceptNo', 'receiptDate', 'corpCode', 'corpName', 'stockCode', 'corpClass',
  'reportName', 'filerName', 'remarks',
]);

function validatedFilingProjection(raw, label, { requireCorpCode = true } = {}) {
  requireExactFields(raw, TEMPORAL_FILING_FIELDS, label);
  for (const field of ['rceptNo', 'receiptDate', 'corpClass', 'reportName']) {
    if (typeof raw[field] !== 'string') throw new Error(`${label}.${field} must be a string`);
  }
  for (const field of ['corpCode', 'corpName', 'stockCode', 'filerName', 'remarks']) {
    if (raw[field] !== null && typeof raw[field] !== 'string') {
      throw new Error(`${label}.${field} must be a string or null`);
    }
  }
  const projection = filingProjection(raw);
  validateReceiptIdentity(projection, label, { requireCorpCode });
  for (const field of TEMPORAL_FILING_FIELDS) {
    if (raw[field] !== projection[field]) {
      throw new Error(`${label}.${field} must equal its canonical projection`);
    }
  }
  return projection;
}

function forbiddenField(value, allowedFields) {
  const allowed = new Set(allowedFields);
  return Object.keys(value ?? {}).find((key) => !allowed.has(key)) ?? null;
}

function requireExactFields(value, requiredFields, label, { optionalFields = [] } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const unexpected = forbiddenField(value, [...requiredFields, ...optionalFields]);
  if (unexpected) throw new Error(`${label} contains forbidden field ${unexpected}`);
  const missing = requiredFields.find((field) => !Object.hasOwn(value, field));
  if (missing) throw new Error(`${label} is missing required field ${missing}`);
  return value;
}

function requiredNonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a nonnegative safe integer`);
  }
  return value;
}

export function temporalCorpusCaseProjection(corpusCase, {
  maxRetainedBodyChars = null,
} = {}) {
  requireExactFields(corpusCase, TEMPORAL_RAW_CASE_FIELDS, 'temporal corpus case', {
    optionalFields: corpusCase?.labelStatus === 'adjudicated'
      ? TEMPORAL_ANNOTATED_CASE_FIELDS
      : [],
  });
  const input = corpusCase?.input ?? {};
  const source = corpusCase?.source ?? {};
  requireExactFields(input, TEMPORAL_CASE_INPUT_FIELDS, 'temporal corpus case input');
  requireExactFields(source, TEMPORAL_CASE_SOURCE_FIELDS, 'temporal corpus case source');
  if (typeof corpusCase.id !== 'string' || corpusCase.id.length === 0) {
    throw new Error('temporal corpus case id must be nonempty');
  }
  if (corpusCase.labelStatus !== 'unlabeled' && corpusCase.labelStatus !== 'adjudicated') {
    throw new Error('temporal corpus case labelStatus is invalid');
  }
  if (source.provider !== 'opendart'
    || source.listApiPath !== '/api/list.json'
    || source.documentApiPath !== '/api/document.xml'
    || source.documentSource !== 'opendart-document') {
    throw new Error('temporal corpus case source must match the frozen OpenDART document protocol');
  }
  if (!Number.isSafeInteger(source.fileCount) || source.fileCount < 1) {
    throw new Error('temporal corpus case fileCount must be a positive safe integer');
  }
  for (const field of ['filerName', 'remarks']) {
    if (source[field] !== null && typeof source[field] !== 'string') {
      throw new Error(`temporal corpus case ${field} must be a string or null`);
    }
  }
  for (const field of ['rceptNo', 'receiptDate', 'title', 'body']) {
    if (typeof input[field] !== 'string') throw new Error(`temporal corpus case ${field} must be a string`);
  }
  for (const field of ['issuer', 'stockCode']) {
    if (input[field] !== null && typeof input[field] !== 'string') {
      throw new Error(`temporal corpus case ${field} must be a string or null`);
    }
  }
  if (typeof input.body !== 'string') throw new Error('temporal corpus case body must be a string');
  const body = input.body;
  if (!body) throw new Error('temporal corpus case body must be nonempty');
  const retainedCharCount = [...body].length;
  if (maxRetainedBodyChars !== null) {
    if (!Number.isSafeInteger(maxRetainedBodyChars) || maxRetainedBodyChars < 1) {
      throw new Error('maxRetainedBodyChars must be a positive safe integer');
    }
    if (retainedCharCount > maxRetainedBodyChars) {
      throw new Error('temporal corpus case body exceeds the frozen retainedBodyChars limit');
    }
  }
  const filing = filingProjection({
    rceptNo: input.rceptNo,
    receiptDate: input.receiptDate,
    corpCode: source.corpCode,
    corpName: input.issuer ?? input.corpName,
    stockCode: input.stockCode,
    corpClass: source.corpClass,
    reportName: input.title ?? input.reportName,
    filerName: source.filerName,
    remarks: source.remarks,
  });
  validateReceiptIdentity(filing, 'temporal corpus case');
  const retainedSha256 = sha256(body);
  requireSha256(source.retainedSha256, 'temporal corpus case retainedSha256');
  if (source.retainedSha256 !== retainedSha256) throw new Error('temporal corpus case retainedSha256 mismatch');
  requireSha256(source.fullSha256, 'temporal corpus case fullSha256');
  const recordedRetainedCharCount = requiredNonnegativeInteger(
    source.retainedCharCount,
    'temporal corpus case retainedCharCount',
  );
  const fullCharCount = requiredNonnegativeInteger(
    source.fullCharCount,
    'temporal corpus case fullCharCount',
  );
  if (recordedRetainedCharCount !== retainedCharCount) {
    throw new Error('temporal corpus case retainedCharCount must equal the retained body length');
  }
  if (fullCharCount < retainedCharCount) {
    throw new Error('temporal corpus case fullCharCount cannot be less than retainedCharCount');
  }
  if (typeof source.truncated !== 'boolean') {
    throw new Error('temporal corpus case truncated must be boolean');
  }
  const truncated = fullCharCount > retainedCharCount;
  if (source.truncated !== truncated) {
    throw new Error('temporal corpus case truncated must match the recorded character counts');
  }
  if (!truncated && source.fullSha256 !== retainedSha256) {
    throw new Error('temporal corpus case fullSha256 must equal retainedSha256 when untruncated');
  }
  return Object.freeze({
    id: corpusCase.id,
    ...filing,
    bodySha256: retainedSha256,
    fullSha256: source.fullSha256,
    fullCharCount,
    retainedCharCount,
    truncated,
  });
}

export function temporalCorpusCaseSha256(corpusCase) {
  return temporalDomainSha256('corpus-case', temporalCorpusCaseProjection(corpusCase));
}

export function buildTemporalRawCorpusPayload({
  candidateFreeze,
  query,
  source,
  capture,
  listedFilings,
  population,
  cases,
} = {}) {
  requireExactFields(query, TEMPORAL_RAW_QUERY_INPUT_FIELDS, 'raw corpus query', {
    optionalFields: ['selectionAlgorithm'],
  });
  requireExactFields(source, TEMPORAL_RAW_SOURCE_FIELDS, 'raw corpus source');
  requireExactFields(capture, TEMPORAL_RAW_CAPTURE_FIELDS, 'raw corpus capture');
  for (const [index, corpusCase] of (cases ?? []).entries()) {
    requireExactFields(corpusCase, TEMPORAL_RAW_CASE_FIELDS, `raw corpus cases[${index}]`);
  }
  const seed = String(query?.selectionSeedReveal ?? '').trim();
  const normalizedListedFilings = (listedFilings ?? population ?? []).map((filing, index) => (
    validatedFilingProjection(filing, `listedFilings[${index}]`)
  ));
  const excluded = new Set(candidateFreeze?.manifest?.precommit?.sampling?.excludedReceipts ?? []);
  const normalizedPopulation = dedupeFilings(normalizedListedFilings)
    .filter((filing) => !excluded.has(filing.rceptNo))
    .map(filingProjection);
  for (const [index, filing] of normalizedPopulation.entries()) validateReceiptIdentity(filing, `population[${index}]`);
  if (population) {
    const suppliedPopulation = population.map((filing, index) => (
      validatedFilingProjection(filing, `population[${index}]`)
    ));
    if (canonicalJsonSha256(dedupeFilings(suppliedPopulation).map(filingProjection))
      !== canonicalJsonSha256(normalizedPopulation)) {
      throw new Error('raw corpus population must equal the complete deduplicated non-excluded listing');
    }
  }
  const selected = selectStratifiedFilings(normalizedPopulation, {
    limit: query?.limit ?? null,
    minIssuers: query?.minIssuers ?? 1,
    selectionSeed: seed,
  });
  const selectedReceiptNumbers = selected.map((entry) => entry.rceptNo);
  const caseByReceipt = new Map((cases ?? []).map((entry) => [String(entry?.input?.rceptNo ?? ''), entry]));
  const orderedCases = selectedReceiptNumbers.map((receipt) => caseByReceipt.get(receipt));
  if (orderedCases.some((entry) => !entry)
    || caseByReceipt.size !== orderedCases.length
    || (cases ?? []).length !== orderedCases.length) {
    throw new Error('raw corpus cases must exactly match deterministic selected receipts');
  }
  const selectedCaseDigests = orderedCases.map(temporalCorpusCaseSha256);
  return Object.freeze({
    schemaVersion: 'jaroo.kr-disclosure-temporal-holdout-corpus-payload.v2',
    labelStatus: 'unlabeled',
    candidateFreeze,
    query: Object.freeze({
      ...query,
      selectionAlgorithm: KR_DISCLOSURE_TEMPORAL_SELECTION_ALGORITHM,
      selectionSeedReveal: seed,
      selectionSeedCommitment: selectionSeedCommitment(seed),
    }),
    source,
    capture,
    listedFilings: Object.freeze(normalizedListedFilings),
    population: Object.freeze(normalizedPopulation),
    cases: Object.freeze(orderedCases),
    selection: Object.freeze({
      algorithm: KR_DISCLOSURE_TEMPORAL_SELECTION_ALGORITHM,
      populationSha256: temporalDomainSha256('population', normalizedPopulation),
      selectedReceiptNumbers: Object.freeze(selectedReceiptNumbers),
      selectedReceiptsSha256: temporalDomainSha256('selected-receipts', selectedReceiptNumbers),
      selectedCaseDigests: Object.freeze(selectedCaseDigests),
      selectedCasesSha256: temporalDomainSha256('selected-cases', selectedCaseDigests),
    }),
  });
}

export function createTemporalRawCorpusEnvelope(payload, timestampReceipts) {
  return Object.freeze({
    schemaVersion: KR_DISCLOSURE_TEMPORAL_CORPUS_SCHEMA_VERSION,
    payloadCanonicalSha256: canonicalJsonSha256(payload),
    payload,
    timestampReceipts,
  });
}

export function validateTemporalRawCorpusEnvelope(envelope, {
  verifyExternalTimestamps = true,
  verifyCurrentCandidate = true,
  verifyRepositoryAnchor = true,
  now = new Date(),
} = {}) {
  requireExactFields(envelope, TEMPORAL_RAW_ENVELOPE_FIELDS, 'temporal raw corpus envelope');
  if (envelope?.schemaVersion !== KR_DISCLOSURE_TEMPORAL_CORPUS_SCHEMA_VERSION) {
    throw new Error('invalid temporal raw corpus schemaVersion');
  }
  const payload = envelope.payload;
  requireExactFields(payload, TEMPORAL_RAW_PAYLOAD_FIELDS, 'temporal raw corpus payload');
  if (envelope.payloadCanonicalSha256 !== canonicalJsonSha256(payload)) {
    throw new Error('temporal raw corpus payload canonical hash mismatch');
  }
  if (payload?.schemaVersion !== 'jaroo.kr-disclosure-temporal-holdout-corpus-payload.v2'
    || payload.labelStatus !== 'unlabeled') {
    throw new Error('temporal raw corpus payload must be unlabeled v2');
  }
  const freeze = validateCandidateFreezeEnvelope(payload.candidateFreeze, {
    selectionSeed: payload.query?.selectionSeedReveal,
    verifyExternalTimestamps,
    verifyCurrentCandidate,
    verifyRepositoryAnchor,
    now,
  });
  const timestamp = validateRfc3161Receipts(payload, envelope.timestampReceipts, {
    verifyCrypto: verifyExternalTimestamps,
    now,
  });
  if (new Date(timestamp.earliestGenTime) <= new Date(freeze.timestamp.operationalNotBefore)) {
    throw new Error('raw corpus RFC3161 receipt must follow the candidate freeze boundary');
  }
  const query = payload.query;
  requireExactFields(query, TEMPORAL_RAW_QUERY_FIELDS, 'raw corpus query');
  if (query?.selectionAlgorithm !== KR_DISCLOSURE_TEMPORAL_SELECTION_ALGORITHM) {
    throw new Error('raw corpus selection algorithm mismatch');
  }
  if (query.selectionSeedCommitment !== freeze.sampling.selectionSeedCommitment) {
    throw new Error('raw corpus seed reveal does not match candidate freeze commitment');
  }
  const from = normalizeTemporalDate(query.from, 'rawCorpus.query.from');
  const to = normalizeTemporalDate(query.to, 'rawCorpus.query.to');
  if (from > to
    || from !== freeze.collectionWindow.from
    || to !== freeze.collectionWindow.to) {
    throw new Error('raw corpus query window violates candidate freeze boundary');
  }
  if (query.cutoff !== freeze.cutoff) {
    throw new Error('raw corpus query cutoff differs from the candidate freeze');
  }
  if (to >= seoulCalendarDate(timestamp.earliestGenTime)) {
    throw new Error('raw corpus must be timestamped on a KST date after query.to');
  }
  const expectedPlanQuery = {
    corpClass: freeze.collectionPlan.corpClass,
    pageCount: freeze.collectionPlan.pageCount,
    limit: freeze.collectionPlan.limit,
    minIssuers: freeze.collectionPlan.minIssuers,
    retainedBodyChars: freeze.collectionPlan.retainedBodyChars,
    sort: freeze.collectionPlan.sort,
    sortDirection: freeze.collectionPlan.sortDirection,
    lastReportOnly: freeze.collectionPlan.lastReportOnly,
    stoppingRule: freeze.collectionPlan.stoppingRule,
  };
  for (const [field, expected] of Object.entries(expectedPlanQuery)) {
    if (query[field] !== expected) throw new Error(`raw corpus query.${field} differs from the candidate collection plan`);
  }
  const expectedSampling = query.limit === null
    ? 'all-deduplicated-filings'
    : 'deterministic-issuer-title-template-stratified';
  if (query.sampling !== expectedSampling) throw new Error('raw corpus query.sampling is invalid');
  for (const field of ['concurrency', 'timeoutMs']) {
    if (!Number.isSafeInteger(query[field]) || query[field] < 1) {
      throw new Error(`raw corpus query.${field} must be a positive safe integer`);
    }
  }
  if (query.exclusionManifestSha256 !== freeze.sampling.exclusionManifestSha256
    || query.excludedReceiptsSha256 !== freeze.sampling.excludedReceiptsSha256
    || query.excludedReceiptCount !== freeze.sampling.excludedReceiptCount) {
    throw new Error('raw corpus exclusion binding does not match candidate freeze');
  }
  requireExactFields(payload.source, TEMPORAL_RAW_SOURCE_FIELDS, 'raw corpus source');
  requireExactFields(payload.capture, TEMPORAL_RAW_CAPTURE_FIELDS, 'raw corpus capture');
  requireExactFields(payload.selection, TEMPORAL_RAW_SELECTION_FIELDS, 'raw corpus selection');
  if (payload.source?.provider !== 'opendart'
    || payload.source?.market !== 'KR'
    || payload.source?.listApiPath !== '/api/list.json'
    || payload.source?.documentApiPath !== '/api/document.xml'
    || !Array.isArray(payload.listedFilings)
    || payload.listedFilings.length === 0
    || !Array.isArray(payload.population)
    || payload.population.length === 0) {
    throw new Error('raw corpus population must be nonempty');
  }
  if (payload.selection.algorithm !== KR_DISCLOSURE_TEMPORAL_SELECTION_ALGORITHM) {
    throw new Error('raw corpus selection.algorithm mismatch');
  }
  for (const field of TEMPORAL_RAW_CAPTURE_FIELDS) {
    requiredNonnegativeInteger(payload.capture[field], `raw corpus capture.${field}`);
  }
  const excluded = new Set(freeze.sampling.excludedReceipts);
  const normalizedListedFilings = payload.listedFilings.map((raw, index) => (
    validatedFilingProjection(raw, `rawCorpus.listedFilings[${index}]`)
  ));
  for (const [index, filing] of normalizedListedFilings.entries()) {
    if (filing.receiptDate < from || filing.receiptDate > to) {
      throw new Error('raw corpus listed filing receiptDate is outside query window');
    }
  }
  if (dedupeFilings(normalizedListedFilings).length !== normalizedListedFilings.length) {
    throw new Error('raw corpus listed filings contain duplicate receipts');
  }
  const deduplicatedListedFilings = dedupeFilings(normalizedListedFilings);
  const recomputedPopulation = deduplicatedListedFilings
    .filter((filing) => !excluded.has(filing.rceptNo))
    .map(filingProjection);
  const populationReceipts = new Set();
  const normalizedSuppliedPopulation = [];
  for (const [index, raw] of payload.population.entries()) {
    const filing = validatedFilingProjection(raw, `rawCorpus.population[${index}]`);
    if (filing.receiptDate < from || filing.receiptDate > to) throw new Error('raw corpus population receiptDate is outside query window');
    if (excluded.has(filing.rceptNo)) throw new Error('raw corpus population overlaps frozen exclusions');
    if (populationReceipts.has(filing.rceptNo)) throw new Error('raw corpus population contains duplicate receipts');
    populationReceipts.add(filing.rceptNo);
    normalizedSuppliedPopulation.push(filing);
  }
  if (canonicalJsonSha256(recomputedPopulation) !== canonicalJsonSha256(normalizedSuppliedPopulation)) {
    throw new Error('raw corpus population is not the complete deduplicated non-excluded listing');
  }
  const capture = payload.capture;
  const recomputedCapture = {
    providerTotalCount: normalizedListedFilings.length,
    listedCount: normalizedListedFilings.length,
    pagesFetched: Math.ceil(normalizedListedFilings.length / query.pageCount),
    deduplicatedCount: deduplicatedListedFilings.length,
    eligibleCount: recomputedPopulation.length,
    duplicateCount: normalizedListedFilings.length - deduplicatedListedFilings.length,
    excludedInWindowCount: deduplicatedListedFilings.filter((filing) => excluded.has(filing.rceptNo)).length,
  };
  for (const [field, expected] of Object.entries(recomputedCapture)) {
    if (capture?.[field] !== expected) throw new Error(`raw corpus capture.${field} is stale`);
  }
  if (payload.selection?.populationSha256 !== temporalDomainSha256('population', normalizedSuppliedPopulation)) {
    throw new Error('raw corpus populationSha256 mismatch');
  }
  const replay = selectStratifiedFilings(normalizedSuppliedPopulation, {
    limit: query.limit ?? null,
    minIssuers: query.minIssuers ?? 1,
    selectionSeed: query.selectionSeedReveal,
  }).map((entry) => entry.rceptNo);
  if (JSON.stringify(payload.selection?.selectedReceiptNumbers) !== JSON.stringify(replay)) {
    throw new Error('selectedReceiptNumbers do not equal deterministic replay');
  }
  if (payload.selection.selectedReceiptsSha256 !== temporalDomainSha256('selected-receipts', replay)) {
    throw new Error('raw corpus selectedReceiptsSha256 mismatch');
  }
  if (!Array.isArray(payload.cases) || payload.cases.length !== replay.length) {
    throw new Error('raw corpus selected case count mismatch');
  }
  const caseDigests = [];
  const populationByReceipt = new Map(normalizedSuppliedPopulation.map((entry) => [entry.rceptNo, entry]));
  const receiptDateCeiling = seoulCalendarDate(timestamp.earliestGenTime);
  for (const [index, corpusCase] of payload.cases.entries()) {
    const unexpectedCaseField = forbiddenField(corpusCase, TEMPORAL_RAW_CASE_FIELDS);
    if (unexpectedCaseField) {
      throw new Error(`raw corpus case contains forbidden field ${unexpectedCaseField}`);
    }
    if (corpusCase?.labelStatus !== 'unlabeled') throw new Error('raw corpus cases must remain unlabeled');
    const projection = temporalCorpusCaseProjection(corpusCase, {
      maxRetainedBodyChars: freeze.collectionPlan.retainedBodyChars,
    });
    if (projection.rceptNo !== replay[index]) throw new Error('raw corpus case order does not match selected receipts');
    if (projection.receiptDate > receiptDateCeiling) throw new Error('raw corpus case receiptDate is later than its RFC3161 capture');
    const populationFiling = populationByReceipt.get(projection.rceptNo);
    for (const field of ['receiptDate', 'corpCode', 'corpName', 'stockCode', 'corpClass', 'reportName']) {
      if (projection[field] !== populationFiling?.[field]) throw new Error(`raw corpus case ${field} differs from population`);
    }
    caseDigests.push(temporalCorpusCaseSha256(corpusCase));
  }
  if (JSON.stringify(payload.selection.selectedCaseDigests) !== JSON.stringify(caseDigests)) {
    throw new Error('raw corpus selected case content digest mismatch');
  }
  if (payload.selection.selectedCasesSha256 !== temporalDomainSha256('selected-cases', caseDigests)) {
    throw new Error('raw corpus selectedCasesSha256 mismatch');
  }
  const selectedCapture = {
    selectedCount: replay.length,
    caseCount: payload.cases.length,
    documentFailureCount: 0,
    uniqueIssuerCount: new Set(payload.cases.map((entry) => entry?.source?.corpCode).filter(Boolean)).size,
    uniqueTitleTemplateCount: new Set(payload.cases.map((entry) => normalizeTitleTemplate(entry?.input?.title))).size,
    truncatedBodyCount: payload.cases.filter((entry) => entry?.source?.truncated === true).length,
    retainedBodyCharCount: payload.cases.reduce((total, entry) => total + [...String(entry?.input?.body ?? '')].length, 0),
  };
  for (const [field, expected] of Object.entries(selectedCapture)) {
    if (capture?.[field] !== expected) throw new Error(`raw corpus capture.${field} is stale`);
  }
  return Object.freeze({ envelope, payload, freeze, timestamp, replay: Object.freeze(replay) });
}

export const TEMPORAL_CANDIDATE_PATHS = CANDIDATE_PATHS;
