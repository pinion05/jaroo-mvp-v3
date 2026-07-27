#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildTemporalCandidateFreeze,
  buildTemporalCandidatePrecommit,
  canonicalJsonSha256,
  currentTemporalRepositoryAnchor,
  issueRfc3161ReceiptSet,
  KR_DISCLOSURE_TEMPORAL_DEFAULT_COLLECTION_PLAN,
  KR_DISCLOSURE_TEMPORAL_STRICT_THRESHOLDS,
  normalizeTemporalCollectionPlan,
  validateTemporalCandidateFreeze,
} from '../src/services/deepscan-kr-disclosure-temporal-protocol.js';
import {
  readExclusionManifest,
  writeImmutableArtifact,
} from './collect-dart-disclosure-temporal-holdout.mjs';

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

function required(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`--${name} is required`);
  return normalized;
}

function integerOption(value, name, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`--${name} must be an integer`);
  return parsed;
}

export async function main(argv = process.argv.slice(2), options = {}) {
  const parsed = parseArgs(argv);
  const outputPath = resolve(required(parsed.out, 'out'));
  const experimentId = required(parsed['experiment-id'], 'experiment-id');
  const selectionSeed = required(parsed['selection-seed'], 'selection-seed');
  const exclusionManifestPath = resolve(required(parsed['exclude-manifest'], 'exclude-manifest'));
  const collectionPlan = normalizeTemporalCollectionPlan({
    ...KR_DISCLOSURE_TEMPORAL_DEFAULT_COLLECTION_PLAN,
    startOffsetDays: integerOption(parsed['start-offset-days'], 'start-offset-days', KR_DISCLOSURE_TEMPORAL_DEFAULT_COLLECTION_PLAN.startOffsetDays),
    windowDays: integerOption(parsed['window-days'], 'window-days', KR_DISCLOSURE_TEMPORAL_DEFAULT_COLLECTION_PLAN.windowDays),
    limit: integerOption(parsed.limit, 'limit', KR_DISCLOSURE_TEMPORAL_DEFAULT_COLLECTION_PLAN.limit),
    minIssuers: integerOption(parsed['min-issuers'], 'min-issuers', KR_DISCLOSURE_TEMPORAL_DEFAULT_COLLECTION_PLAN.minIssuers),
    retainedBodyChars: integerOption(parsed['body-chars'], 'body-chars', KR_DISCLOSURE_TEMPORAL_DEFAULT_COLLECTION_PLAN.retainedBodyChars),
  });
  const exclusion = await readExclusionManifest(exclusionManifestPath, { verifySources: true });
  const precommit = buildTemporalCandidatePrecommit({
    experimentId,
    selectionSeed,
    exclusionManifestSha256: exclusion.sha256,
    excludedReceipts: exclusion.receipts,
    collectionPlan,
    thresholds: KR_DISCLOSURE_TEMPORAL_STRICT_THRESHOLDS,
    repository: currentTemporalRepositoryAnchor(),
  });
  const timestampReceipts = await issueRfc3161ReceiptSet(precommit, options);
  const manifest = buildTemporalCandidateFreeze({ precommit, timestampReceipts });
  validateTemporalCandidateFreeze(manifest, { selectionSeed, exclusion });
  const bytes = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeImmutableArtifact(outputPath, bytes);
  process.stdout.write(`${JSON.stringify({
    outputPath,
    experimentId: precommit.experimentId,
    formalAccuracyBoundVerified: manifest.temporalBoundary.formalAccuracyBoundVerified,
    independentClaimEligible: false,
    operationalNotBefore: manifest.temporalBoundary.operationalNotBefore,
    cutoff: manifest.temporalBoundary.cutoff,
    firstEligibleFilingDate: manifest.temporalBoundary.firstEligibleFilingDate,
    collectionWindow: manifest.temporalBoundary.collectionWindow,
    collectionPlan: precommit.collectionPlan,
    timestampAuthorities: timestampReceipts.map((receipt) => receipt.authorityId),
    manifestCanonicalSha256: canonicalJsonSha256(manifest),
    candidateBundleSha256: precommit.candidate.bundleSha256,
  }, null, 2)}\n`);
  return manifest;
}

const isDirectRun = process.argv[1]
  && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]));
if (isDirectRun) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
