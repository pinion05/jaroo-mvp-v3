#!/usr/bin/env node

const path = require('node:path');
const { createKoFuzzyResolver } = require('../src/ko-fuzzy-resolver');

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function readFlagValue(args, flagName, valueLabel) {
  const value = args.shift();
  if (!value || value.startsWith('--')) {
    fail(`${flagName} requires a ${valueLabel} argument`);
  }
  return value;
}

function readNumberFlagValue(args, flagName) {
  const value = readFlagValue(args, flagName, 'numeric');
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    fail(`${flagName} requires a numeric argument`);
  }
  return parsed;
}

function parseArgs(argv) {
  const args = [...argv];
  let query = null;
  let topN = 5;
  let koMapPath;
  let tickerInfoPath;

  while (args.length > 0) {
    const current = args.shift();
    if (current === '--topN') {
      topN = readNumberFlagValue(args, '--topN');
      continue;
    }
    if (current === '--ko-map') {
      koMapPath = path.resolve(readFlagValue(args, '--ko-map', 'path'));
      continue;
    }
    if (current === '--ticker-info') {
      tickerInfoPath = path.resolve(readFlagValue(args, '--ticker-info', 'path'));
      continue;
    }
    if (!query) {
      query = current;
      continue;
    }
  }

  return { query, topN, koMapPath, tickerInfoPath };
}

const { query, topN, koMapPath, tickerInfoPath } = parseArgs(process.argv.slice(2));

if (!query) {
  console.error('usage: ko-fuzzy-resolve <query> [--topN 5] [--ko-map path] [--ticker-info path]');
  process.exit(1);
}

const resolver = createKoFuzzyResolver({ koMapPath, tickerInfoPath });
const results = resolver.resolve(query, { topN });
process.stdout.write(JSON.stringify({ query, topN, results }, null, 2));
process.stdout.write('\n');
