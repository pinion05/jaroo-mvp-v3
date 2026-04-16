const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');

let createKoFuzzyResolver;
try {
  ({ createKoFuzzyResolver } = require('../src/ko-fuzzy-resolver'));
} catch {
  createKoFuzzyResolver = null;
}

test('exports createKoFuzzyResolver', () => {
  assert.equal(typeof createKoFuzzyResolver, 'function');
});

test('resolves exact Korean stock name to ticker', () => {
  const resolver = createKoFuzzyResolver({
    koMapPath: path.join(repoRoot, 'data/us/us-stock-name-ko-to-ticker-coverage100.json'),
    tickerInfoPath: path.join(repoRoot, 'data/us/us-stock-ticker-to-ko-en-coverage100.json'),
  });

  const results = resolver.resolve('팔란티어', { topN: 3 });
  assert.equal(results[0].ticker, 'PLTR');
  assert.equal(results[0].score, 1);
});

test('resolves common Korean typo to expected ticker within top3', () => {
  const resolver = createKoFuzzyResolver({
    koMapPath: path.join(repoRoot, 'data/us/us-stock-name-ko-to-ticker-coverage100.json'),
    tickerInfoPath: path.join(repoRoot, 'data/us/us-stock-ticker-to-ko-en-coverage100.json'),
  });

  const results = resolver.resolve('파란티어', { topN: 3 });
  assert.ok(results.length > 0);
  assert.ok(results.slice(0, 3).some((item) => item.ticker === 'PLTR'));
});

test('keeps strong current top1 while recovering additional hybrid candidates', () => {
  const resolver = createKoFuzzyResolver({
    koMapPath: path.join(repoRoot, 'data/us/us-stock-name-ko-to-ticker-coverage100.json'),
    tickerInfoPath: path.join(repoRoot, 'data/us/us-stock-ticker-to-ko-en-coverage100.json'),
  });

  const shortTickerResults = resolver.resolve('FS', { topN: 5 });
  assert.equal(shortTickerResults[0].ticker, 'FFIV');

  const recoveredResults = resolver.resolve('넥스테라 에너지', { topN: 5 });
  assert.ok(recoveredResults.some((item) => item.ticker === 'NEE'));
});

test('recovers hard typo aliases within top5', () => {
  const resolver = createKoFuzzyResolver({
    koMapPath: path.join(repoRoot, 'data/us/us-stock-name-ko-to-ticker-coverage100.json'),
    tickerInfoPath: path.join(repoRoot, 'data/us/us-stock-ticker-to-ko-en-coverage100.json'),
  });

  const appleResults = resolver.resolve('애프', { topN: 5 });
  assert.ok(appleResults.some((item) => item.ticker === 'AAPL'));

  const palantirResults = resolver.resolve('파라티어', { topN: 5 });
  assert.ok(palantirResults.some((item) => item.ticker === 'PLTR'));
});

test('resolver clamps invalid topN inputs to a safe range', () => {
  const resolver = createKoFuzzyResolver({
    koMapPath: path.join(repoRoot, 'data/us/us-stock-name-ko-to-ticker-coverage100.json'),
    tickerInfoPath: path.join(repoRoot, 'data/us/us-stock-ticker-to-ko-en-coverage100.json'),
  });

  const nanResults = resolver.resolve('팔란티어', { topN: Number.NaN });
  assert.ok(nanResults.length > 0);
  assert.equal(nanResults[0].ticker, 'PLTR');

  const zeroResults = resolver.resolve('파란티어', { topN: 0 });
  assert.equal(zeroResults.length, 1);
  assert.equal(zeroResults[0].ticker, 'PLTR');
});

test('CLI prints JSON results', () => {
  const cliPath = path.join(repoRoot, 'bin/ko-fuzzy-resolve.js');
  const result = spawnSync(process.execPath, [cliPath, '파란티어', '--topN', '3'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.query, '파란티어');
  assert.equal(parsed.topN, 3);
  assert.ok(Array.isArray(parsed.results));
  assert.ok(parsed.results.some((item) => item.ticker === 'PLTR'));
});

test('CLI rejects missing numeric value for --topN', () => {
  const cliPath = path.join(repoRoot, 'bin/ko-fuzzy-resolve.js');
  const result = spawnSync(process.execPath, [cliPath, '파란티어', '--topN', '--ko-map', 'data/us/us-stock-name-ko-to-ticker-coverage100.json'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /--topN requires a numeric argument/);
});

test('CLI rejects missing values for path flags', () => {
  const cliPath = path.join(repoRoot, 'bin/ko-fuzzy-resolve.js');
  const result = spawnSync(process.execPath, [cliPath, '파란티어', '--ko-map'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /--ko-map requires a path argument/);
});
