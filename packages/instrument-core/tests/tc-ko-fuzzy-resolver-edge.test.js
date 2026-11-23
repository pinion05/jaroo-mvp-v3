const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

const { createKoFuzzyResolver } = require('../src/ko-fuzzy-resolver');

// 기존 ko-fuzzy-resolver.test.js는 정상 입력(한글 종목명·오타)만 다뤘다.
// 이 파일은 커버리지 갭인 "비정상 입력 경계"(빈 문자열, 공백, null 등)와
// topN 후보 수 상한만을 검증한다 — 프로덕션 동작은 절대 수정하지 않는다.

function createResolver() {
  return createKoFuzzyResolver({
    koMapPath: path.join(repoRoot, 'data/us/us-stock-name-ko-to-ticker-coverage100.json'),
    tickerInfoPath: path.join(repoRoot, 'data/us/us-stock-ticker-to-ko-en-coverage100.json'),
  });
}

test('resolve with empty string query returns an empty array without throwing', () => {
  const resolver = createResolver();

  let results;
  assert.doesNotThrow(() => {
    results = resolver.resolve('', { topN: 3 });
  });
  assert.ok(Array.isArray(results));
  assert.deepEqual(results, []);
});

test('resolve with whitespace-only query returns an empty array without throwing', () => {
  const resolver = createResolver();

  assert.deepEqual(resolver.resolve('   ', { topN: 3 }), []);
});

test('resolve with null query returns an empty array without throwing', () => {
  const resolver = createResolver();

  let results;
  assert.doesNotThrow(() => {
    results = resolver.resolve(null, { topN: 3 });
  });
  assert.deepEqual(results, []);
});

test('resolve clamps negative topN to a safe minimum instead of emptying results', () => {
  const resolver = createResolver();

  const results = resolver.resolve('팔란티어', { topN: -7 });
  assert.ok(results.length >= 1);
  assert.equal(results[0].ticker, 'PLTR');
  assert.equal(results[0].score, 1);
});

test('resolve without topN option defaults to at most 5 candidates', () => {
  const resolver = createResolver();

  const results = resolver.resolve('파란티어');
  assert.ok(Array.isArray(results));
  assert.ok(results.length > 0);
  assert.ok(results.length <= 5);
  assert.ok(results.some((item) => item.ticker === 'PLTR'));
});

test('resolve with exact query and topN=1 returns exactly one exact-scored candidate', () => {
  const resolver = createResolver();

  const results = resolver.resolve('팔란티어', { topN: 1 });
  assert.equal(results.length, 1);
  assert.equal(results[0].ticker, 'PLTR');
  assert.equal(results[0].score, 1);
  assert.equal(results[0].via, 'exact');
});
