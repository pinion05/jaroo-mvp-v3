#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildTemporalCandidateFreeze,
  canonicalJsonSha256,
  currentTemporalRepositoryAnchor,
  KR_DISCLOSURE_TEMPORAL_STRICT_THRESHOLDS,
  validateTemporalCandidateFreeze,
} from '../src/services/deepscan-kr-disclosure-temporal-protocol.js';
import { readExclusionManifest } from './collect-dart-disclosure-temporal-holdout.mjs';

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

export async function main(argv = process.argv.slice(2), { now = new Date() } = {}) {
  const options = parseArgs(argv);
  const outputPath = resolve(required(options.out, 'out'));
  const selectionSeed = required(options['selection-seed'], 'selection-seed');
  const exclusionManifestPath = resolve(required(options['exclude-manifest'], 'exclude-manifest'));
  const exclusion = await readExclusionManifest(exclusionManifestPath, { verifySources: true });
  const manifest = buildTemporalCandidateFreeze({
    createdAt: now,
    selectionSeed,
    exclusionManifestSha256: exclusion.sha256,
    excludedReceiptCount: exclusion.receipts.size,
    excludedReceiptsSha256: canonicalJsonSha256([...exclusion.receipts].sort()),
    thresholds: KR_DISCLOSURE_TEMPORAL_STRICT_THRESHOLDS,
    repository: currentTemporalRepositoryAnchor(),
  });
  validateTemporalCandidateFreeze(manifest, { selectionSeed, exclusion, now });
  const bytes = `${JSON.stringify(manifest, null, 2)}\n`;
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, bytes, { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(`${JSON.stringify({
    outputPath,
    createdAt: manifest.createdAt,
    cutoff: manifest.cutoff,
    firstEligibleFilingDate: manifest.firstEligibleFilingDate,
    manifestCanonicalSha256: canonicalJsonSha256(manifest),
    candidateBundleSha256: manifest.candidate.bundleSha256,
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
