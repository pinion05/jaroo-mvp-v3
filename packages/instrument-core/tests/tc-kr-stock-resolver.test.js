const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

const krStockResolverModule = require('../src/kr-stock-resolver');

// kr-stock-resolver는 HTTP 통합 엔드포인트(ko-fuzzy-http-server)를 통해서만
// 간접 검증돼 왔고, 모듈 자체 단위 테스트가 없었다. 이 파일은 해당 커버리지 갭을 메운다.
// 기본 맵(data/kr/kr-stock-name-to-code.json)을 그대로 읽으므로, 맵에 존재하는
// 대표 종목(삼성전자/CJ CGV)과 공백·미지정 쿼리 등 경계값만 검증한다.

test('exports DEFAULT_KR_STOCK_MAP_PATH and createKrStockResolver factory', () => {
  assert.equal(typeof krStockResolverModule.createKrStockResolver, 'function');
  assert.equal(
    krStockResolverModule.DEFAULT_KR_STOCK_MAP_PATH,
    path.join(repoRoot, 'data/kr/kr-stock-name-to-code.json'),
  );
});

test('default map path resolves exact Korean stock name to code', () => {
  const resolver = krStockResolverModule.createKrStockResolver();

  const result = resolver.resolve('삼성전자');
  assert.deepEqual(result, {
    name: '삼성전자',
    code: '005930',
    matched: true,
    matchedBy: 'exact',
  });
});

test('empty string query returns null without throwing', () => {
  const resolver = krStockResolverModule.createKrStockResolver();
  assert.equal(resolver.resolve(''), null);
});

test('whitespace-only query returns null (normalizeText empties it)', () => {
  const resolver = krStockResolverModule.createKrStockResolver();
  assert.equal(resolver.resolve('   '), null);
  assert.equal(resolver.resolve('\t\n'), null);
});

test('unknown query returns null', () => {
  const resolver = krStockResolverModule.createKrStockResolver();
  assert.equal(resolver.resolve('전혀없는종목이름XYZ'), null);
});

test('compact single match returns matchedBy=compact result', () => {
  const resolver = krStockResolverModule.createKrStockResolver();

  const result = resolver.resolve('CJCGV');
  assert.deepEqual(result, {
    name: 'CJ CGV',
    code: '079160',
    matched: true,
    matchedBy: 'compact',
  });
});

test('compact ambiguous query with multiple candidates is conservatively unmatched', () => {
  const resolver = krStockResolverModule.createKrStockResolver();

  // 'S T C'는 compactText로 'STC'가 되며 맵에 동일 compact 키가 2개 이상 존재한다.
  // 고유 매치가 아닐 때는 null(미매칭)로 보수적으로 처리해야 한다.
  assert.equal(resolver.resolve('S T C'), null);
});

test('exposes raw krNameToCode map for diagnostics', () => {
  const resolver = krStockResolverModule.createKrStockResolver();
  assert.equal(typeof resolver.krNameToCode, 'object');
  assert.equal(resolver.krNameToCode['삼성전자'], '005930');
  assert.equal(resolver.krStockMapPath, krStockResolverModule.DEFAULT_KR_STOCK_MAP_PATH);
});
