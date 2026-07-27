#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CRAWLER_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DEFAULT_OUTPUT = resolve(CRAWLER_ROOT, 'test/artifacts/kr-disclosure-event-temporal-exclusions.v1.json');
const DEFAULT_SOURCES = Object.freeze([
  'test/fixtures/archive/kr-disclosure-event-temporal-holdout.first-sealed.v1.json',
  'test/fixtures/kr-disclosure-classification-gold.v1.json',
  'test/fixtures/kr-disclosure-event-body-reviewed.v1.json',
  'test/fixtures/kr-disclosure-event-semantic-gate.v1.json',
  'test/fixtures/kr-disclosure-event-temporal-holdout.v1.json',
]);

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

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function collectReceiptNumbers(value, receipts) {
  if (Array.isArray(value)) {
    for (const item of value) collectReceiptNumbers(item, receipts);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const key of ['rceptNo', 'rcept_no', 'receiptNumber']) {
    const receipt = String(value[key] ?? '').trim();
    if (receipt) receipts.add(receipt);
  }
  for (const nested of Object.values(value)) collectReceiptNumbers(nested, receipts);
}

export async function buildExclusionManifest(sourcePaths = DEFAULT_SOURCES) {
  const allReceipts = new Set();
  const sources = [];
  for (const sourcePath of sourcePaths) {
    const absolutePath = resolve(CRAWLER_ROOT, sourcePath);
    const bytes = await readFile(absolutePath);
    const parsed = JSON.parse(bytes.toString('utf8'));
    const receipts = new Set();
    collectReceiptNumbers(parsed, receipts);
    for (const receipt of receipts) allReceipts.add(receipt);
    sources.push({
      path: relative(CRAWLER_ROOT, absolutePath),
      sha256: sha256(bytes),
      receiptCount: receipts.size,
    });
  }
  return {
    schemaVersion: 'jaroo.kr-disclosure-event-temporal-exclusions.v1',
    sources,
    receiptNumbers: [...allReceipts].sort(),
    summary: {
      sourceCount: sources.length,
      uniqueReceiptCount: allReceipts.size,
    },
  };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const outputPath = resolve(options.out ?? DEFAULT_OUTPUT);
  const artifact = await buildExclusionManifest();
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ outputPath, ...artifact.summary }, null, 2)}\n`);
  return artifact;
}

const isDirectRun = process.argv[1]
  && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]));
if (isDirectRun) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
