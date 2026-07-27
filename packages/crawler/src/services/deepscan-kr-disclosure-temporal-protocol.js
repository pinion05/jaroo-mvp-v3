import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  KR_DISCLOSURE_EVENT_ONTOLOGY_HASH,
  KR_DISCLOSURE_EVENT_ONTOLOGY_VERSION,
} from './deepscan-kr-disclosure-event-ontology.js';

export const KR_DISCLOSURE_TEMPORAL_FREEZE_SCHEMA_VERSION = 'jaroo.kr-disclosure-event-candidate-freeze.v1';
export const KR_DISCLOSURE_TEMPORAL_FREEZE_TIME_ZONE = 'Asia/Seoul';
export const KR_DISCLOSURE_TEMPORAL_STRICT_THRESHOLDS = Object.freeze({
  total: 40,
  issuerCount: 20,
  templateCount: 15,
  exactMultisetAccuracy: 0.9,
  exactMultisetWilsonLower: 0.75,
  resolvedCoverage: 0.85,
  fieldAccuracy: 0.95,
  templateMacroAccuracy: 0.8,
  highConfidenceExactPrecision: 0.95,
  highConfidenceWilsonLower: 0.7,
  highConfidenceCoverage: 0.35,
  brierScore: 0.15,
});

const CRAWLER_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const REPOSITORY_ROOT = resolve(CRAWLER_ROOT, '../..');
const CANDIDATE_PATHS = Object.freeze({
  extractor: resolve(CRAWLER_ROOT, 'src/services/deepscan-kr-disclosure-event-extractors.js'),
  ontology: resolve(CRAWLER_ROOT, 'src/services/deepscan-kr-disclosure-event-ontology.js'),
  protocol: fileURLToPath(import.meta.url),
  collector: resolve(CRAWLER_ROOT, 'scripts/collect-dart-disclosure-temporal-holdout.mjs'),
  evaluator: resolve(CRAWLER_ROOT, 'scripts/benchmark-dart-disclosure-temporal-holdout.mjs'),
});
const CANDIDATE_REPOSITORY_PATHS = Object.freeze(Object.fromEntries(
  Object.entries(CANDIDATE_PATHS).map(([key, path]) => [
    key,
    path.slice(REPOSITORY_ROOT.length + 1).replaceAll('\\', '/'),
  ]),
));

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

export function canonicalJsonSha256(value) {
  return sha256(JSON.stringify(canonicalize(value)));
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
  const compact = normalizeTemporalDate(value, 'date');
  const next = new Date(Date.UTC(
    Number(compact.slice(0, 4)),
    Number(compact.slice(4, 6)) - 1,
    Number(compact.slice(6, 8)) + 1,
  ));
  return next.toISOString().slice(0, 10).replaceAll('-', '');
}

export function currentTemporalCandidateFingerprint(thresholds = KR_DISCLOSURE_TEMPORAL_STRICT_THRESHOLDS) {
  if (!thresholds || typeof thresholds !== 'object' || Array.isArray(thresholds)) {
    throw new Error('strict thresholds are required to fingerprint the candidate');
  }
  const components = {
    extractorSha256: sha256(readFileSync(CANDIDATE_PATHS.extractor)),
    ontologySourceSha256: sha256(readFileSync(CANDIDATE_PATHS.ontology)),
    protocolSha256: sha256(readFileSync(CANDIDATE_PATHS.protocol)),
    collectorSha256: sha256(readFileSync(CANDIDATE_PATHS.collector)),
    ontologyVersion: KR_DISCLOSURE_EVENT_ONTOLOGY_VERSION,
    ontologyManifestSha256: KR_DISCLOSURE_EVENT_ONTOLOGY_HASH,
    evaluatorSha256: sha256(readFileSync(CANDIDATE_PATHS.evaluator)),
    thresholdsSha256: sha256(JSON.stringify(thresholds)),
  };
  return Object.freeze({
    ...components,
    bundleSha256: canonicalJsonSha256(components),
  });
}

function gitOutput(args, { encoding = 'utf8' } = {}) {
  return execFileSync('git', args, {
    cwd: REPOSITORY_ROOT,
    encoding,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

export function currentTemporalRepositoryAnchor() {
  const gitHead = gitOutput(['rev-parse', 'HEAD']).trim();
  const committedAt = new Date(gitOutput(['show', '-s', '--format=%cI', gitHead]).trim());
  if (!/^[a-f0-9]{40}$/u.test(gitHead) || Number.isNaN(committedAt.getTime())) {
    throw new Error('current repository HEAD cannot anchor the temporal candidate');
  }
  return Object.freeze({ gitHead, gitCommittedAt: committedAt.toISOString() });
}

export function buildTemporalCandidateFreeze({
  createdAt = new Date(),
  selectionSeed,
  exclusionManifestSha256,
  excludedReceiptCount,
  excludedReceiptsSha256,
  thresholds = KR_DISCLOSURE_TEMPORAL_STRICT_THRESHOLDS,
  repository = currentTemporalRepositoryAnchor(),
} = {}) {
  const instant = createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (Number.isNaN(instant.getTime())) throw new Error('createdAt must be a valid timestamp');
  const cutoff = seoulCalendarDate(instant);
  return Object.freeze({
    schemaVersion: KR_DISCLOSURE_TEMPORAL_FREEZE_SCHEMA_VERSION,
    createdAt: instant.toISOString(),
    timeZone: KR_DISCLOSURE_TEMPORAL_FREEZE_TIME_ZONE,
    cutoff,
    firstEligibleFilingDate: nextCalendarDate(cutoff),
    sampling: Object.freeze({
      selectionSeedCommitment: selectionSeedCommitment(selectionSeed),
      exclusionManifestSha256,
      excludedReceiptCount,
      excludedReceiptsSha256,
    }),
    candidate: currentTemporalCandidateFingerprint(thresholds),
    repository: Object.freeze({
      gitHead: String(repository?.gitHead ?? ''),
      gitCommittedAt: String(repository?.gitCommittedAt ?? ''),
    }),
  });
}

function requireSha256(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest`);
  }
}

export function validateTemporalCandidateFreeze(manifest, {
  selectionSeed,
  exclusion,
  thresholds = KR_DISCLOSURE_TEMPORAL_STRICT_THRESHOLDS,
  verifyCurrentCandidate = true,
  verifyRepositoryAnchor = true,
  now = new Date(),
} = {}) {
  if (manifest?.schemaVersion !== KR_DISCLOSURE_TEMPORAL_FREEZE_SCHEMA_VERSION) {
    throw new Error('invalid temporal candidate freeze schemaVersion');
  }
  if (manifest.timeZone !== KR_DISCLOSURE_TEMPORAL_FREEZE_TIME_ZONE) {
    throw new Error(`temporal candidate freeze timeZone must be ${KR_DISCLOSURE_TEMPORAL_FREEZE_TIME_ZONE}`);
  }
  const instant = new Date(manifest.createdAt);
  if (Number.isNaN(instant.getTime()) || instant.toISOString() !== manifest.createdAt) {
    throw new Error('temporal candidate freeze createdAt must be a canonical ISO timestamp');
  }
  const cutoff = normalizeTemporalDate(manifest.cutoff, 'candidateFreeze.cutoff');
  if (cutoff !== seoulCalendarDate(instant)) {
    throw new Error('temporal candidate freeze cutoff must equal the Seoul calendar date of createdAt');
  }
  const firstEligible = normalizeTemporalDate(
    manifest.firstEligibleFilingDate,
    'candidateFreeze.firstEligibleFilingDate',
  );
  if (firstEligible !== nextCalendarDate(cutoff)) {
    throw new Error('temporal candidate freeze firstEligibleFilingDate must be the day after cutoff');
  }
  const commitment = manifest.sampling?.selectionSeedCommitment;
  requireSha256(commitment, 'candidateFreeze.sampling.selectionSeedCommitment');
  if (selectionSeed !== undefined && commitment !== selectionSeedCommitment(selectionSeed)) {
    throw new Error('selection seed does not match the temporal candidate freeze commitment');
  }
  requireSha256(manifest.sampling?.exclusionManifestSha256, 'candidateFreeze.sampling.exclusionManifestSha256');
  requireSha256(manifest.sampling?.excludedReceiptsSha256, 'candidateFreeze.sampling.excludedReceiptsSha256');
  if (!Number.isInteger(manifest.sampling?.excludedReceiptCount) || manifest.sampling.excludedReceiptCount < 1) {
    throw new Error('candidateFreeze.sampling.excludedReceiptCount must be a positive integer');
  }
  if (exclusion) {
    if (manifest.sampling.exclusionManifestSha256 !== exclusion.sha256) {
      throw new Error('exclusion manifest bytes do not match the temporal candidate freeze');
    }
    if (manifest.sampling.excludedReceiptCount !== exclusion.receipts.size) {
      throw new Error('exclusion receipt count does not match the temporal candidate freeze');
    }
    const receiptHash = canonicalJsonSha256([...exclusion.receipts].sort());
    if (manifest.sampling.excludedReceiptsSha256 !== receiptHash) {
      throw new Error('excluded receipt set does not match the temporal candidate freeze');
    }
  }
  const candidate = manifest.candidate;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error('temporal candidate freeze candidate fingerprint is required');
  }
  for (const field of [
    'extractorSha256',
    'ontologySourceSha256',
    'protocolSha256',
    'collectorSha256',
    'ontologyManifestSha256',
    'evaluatorSha256',
    'thresholdsSha256',
    'bundleSha256',
  ]) requireSha256(candidate[field], `candidateFreeze.candidate.${field}`);
  if (candidate.ontologyVersion !== KR_DISCLOSURE_EVENT_ONTOLOGY_VERSION) {
    throw new Error(`candidate freeze ontologyVersion must equal ${KR_DISCLOSURE_EVENT_ONTOLOGY_VERSION}`);
  }
  if (candidate.ontologyManifestSha256 !== KR_DISCLOSURE_EVENT_ONTOLOGY_HASH) {
    throw new Error('candidate freeze ontology manifest hash does not match the frozen ontology');
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
  }
  const repository = manifest.repository;
  if (!/^[a-f0-9]{40}$/u.test(repository?.gitHead ?? '')) {
    throw new Error('candidate freeze repository.gitHead must be a full Git commit id');
  }
  const committedAt = new Date(repository.gitCommittedAt);
  if (Number.isNaN(committedAt.getTime()) || committedAt.toISOString() !== repository.gitCommittedAt) {
    throw new Error('candidate freeze repository.gitCommittedAt must be a canonical ISO timestamp');
  }
  if (instant < committedAt) {
    throw new Error('candidate freeze createdAt cannot precede the candidate Git commit');
  }
  const validationInstant = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(validationInstant.getTime())) throw new Error('candidate freeze validation time must be valid');
  if (instant.getTime() > validationInstant.getTime() + 5 * 60_000) {
    throw new Error('candidate freeze createdAt cannot be in the future');
  }
  if (verifyRepositoryAnchor) {
    let actualCommittedAt;
    try {
      actualCommittedAt = new Date(gitOutput(['show', '-s', '--format=%cI', repository.gitHead]).trim()).toISOString();
    } catch {
      throw new Error('candidate freeze Git commit is not available in the repository');
    }
    if (actualCommittedAt !== repository.gitCommittedAt) {
      throw new Error('candidate freeze gitCommittedAt does not match the Git commit');
    }
    const committedHashes = {
      extractorSha256: sha256(gitOutput(['show', `${repository.gitHead}:${CANDIDATE_REPOSITORY_PATHS.extractor}`], { encoding: null })),
      ontologySourceSha256: sha256(gitOutput(['show', `${repository.gitHead}:${CANDIDATE_REPOSITORY_PATHS.ontology}`], { encoding: null })),
      protocolSha256: sha256(gitOutput(['show', `${repository.gitHead}:${CANDIDATE_REPOSITORY_PATHS.protocol}`], { encoding: null })),
      collectorSha256: sha256(gitOutput(['show', `${repository.gitHead}:${CANDIDATE_REPOSITORY_PATHS.collector}`], { encoding: null })),
      evaluatorSha256: sha256(gitOutput(['show', `${repository.gitHead}:${CANDIDATE_REPOSITORY_PATHS.evaluator}`], { encoding: null })),
    };
    for (const [field, committedHash] of Object.entries(committedHashes)) {
      if (candidate[field] !== committedHash) {
        throw new Error(`candidate freeze ${field} is not anchored by repository.gitHead`);
      }
    }
  }
  return Object.freeze({
    ...manifest,
    cutoff,
    firstEligibleFilingDate: firstEligible,
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

export const TEMPORAL_CANDIDATE_PATHS = CANDIDATE_PATHS;
