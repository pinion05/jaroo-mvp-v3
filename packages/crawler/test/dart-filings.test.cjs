const test = require('node:test');
const assert = require('node:assert/strict');

async function withServer(app, run) {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    return await run(baseUrl);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

const CORP_CODE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<result>
  <list>
    <corp_code>00126380</corp_code>
    <corp_name>삼성전자</corp_name>
    <corp_eng_name>SAMSUNG ELECTRONICS CO.,LTD.</corp_eng_name>
    <stock_code>005930</stock_code>
    <modify_date>20240101</modify_date>
  </list>
  <list>
    <corp_code>00164779</corp_code>
    <corp_name>현대자동차</corp_name>
    <corp_eng_name>HYUNDAI MOTOR COMPANY</corp_eng_name>
    <stock_code>005380</stock_code>
    <modify_date>20240102</modify_date>
  </list>
</result>`;

test('parseDartCorpCodeXml maps OpenDART corpCode XML entries', async () => {
  const { parseDartCorpCodeXml } = await import('../src/crawlers/dart-filings.js');

  const entries = parseDartCorpCodeXml(CORP_CODE_XML);

  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], {
    corpCode: '00126380',
    corpName: '삼성전자',
    corpEngName: 'SAMSUNG ELECTRONICS CO.,LTD.',
    stockCode: '005930',
    modifyDate: '20240101',
  });
});

test('getDartDisclosures resolves stock code to corp_code and normalizes filings', async () => {
  const { clearDartCaches, getDartDisclosures } = await import('../src/crawlers/dart-filings.js');
  clearDartCaches();
  const requestedUrls = [];

  const result = await getDartDisclosures({
    code: '005930.KS',
    from: '2026-05-01',
    to: '2026-05-31',
    finalOnly: true,
    disclosureType: 'A',
    limit: 2,
  }, {
    apiKey: 'test-dart-key',
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      requestedUrls.push(parsed);

      if (parsed.pathname.endsWith('/corpCode.xml')) {
        assert.equal(parsed.searchParams.get('crtfc_key'), 'test-dart-key');
        return new Response(CORP_CODE_XML, { status: 200, headers: { 'Content-Type': 'application/xml' } });
      }

      assert.equal(parsed.pathname, '/api/list.json');
      assert.equal(parsed.searchParams.get('corp_code'), '00126380');
      assert.equal(parsed.searchParams.get('bgn_de'), '20260501');
      assert.equal(parsed.searchParams.get('end_de'), '20260531');
      assert.equal(parsed.searchParams.get('last_reprt_at'), 'Y');
      assert.equal(parsed.searchParams.get('pblntf_ty'), 'A');
      assert.equal(parsed.searchParams.get('page_count'), '2');

      return new Response(JSON.stringify({
        status: '000',
        message: '정상',
        page_no: 1,
        page_count: 2,
        total_count: 1,
        total_page: 1,
        list: [{
          corp_code: '00126380',
          corp_name: '삼성전자',
          stock_code: '005930',
          corp_cls: 'Y',
          report_nm: '분기보고서 (2026.03)',
          rcept_no: '20260515000001',
          flr_nm: '삼성전자',
          rcept_dt: '20260515',
          rm: '',
          pblntf_ty: 'A',
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });

  assert.equal(requestedUrls.length, 2);
  assert.equal(result.source, 'opendart');
  assert.equal(result.corporation.corpCode, '00126380');
  assert.equal(result.corporation.resolvedBy, 'stockCode');
  assert.equal(result.requested.stockCode, '005930');
  assert.equal(result.requested.corpCode, '00126380');
  assert.equal(result.requested.finalOnly, true);
  assert.equal(result.summary.totalCount, 1);
  assert.equal(result.summary.latestReceiptDate, '20260515');
  assert.equal(result.filings.length, 1);
  assert.equal(result.filings[0].reportName, '분기보고서 (2026.03)');
  assert.equal(result.filings[0].corpClsLabel, '유가');
  assert.equal(result.filings[0].disclosureTypeLabel, '정기공시');
  assert.equal(result.filings[0].documentUrl, 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260515000001');
});

test('getDartDisclosures treats OpenDART 013 as an empty successful result', async () => {
  const { clearDartCaches, getDartDisclosures } = await import('../src/crawlers/dart-filings.js');
  clearDartCaches();

  const result = await getDartDisclosures({
    corpCode: '00126380',
    from: '2026-01-01',
    to: '2026-01-31',
  }, {
    apiKey: 'test-dart-key',
    fetchImpl: async () => new Response(JSON.stringify({
      status: '013',
      message: '조회된 데이타가 없습니다.',
      page_no: 1,
      page_count: 10,
      total_count: 0,
      total_page: 0,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  });

  assert.equal(result.meta.status, '013');
  assert.deepEqual(result.filings, []);
  assert.equal(result.summary.totalCount, 0);
});

test('getDartDisclosures reports missing API key as provider-unconfigured', async () => {
  const { clearDartCaches, getDartDisclosures } = await import('../src/crawlers/dart-filings.js');
  clearDartCaches();
  const original = {
    DART_KEY: process.env.DART_KEY,
    DART_API_KEY: process.env.DART_API_KEY,
    OPENDART_API_KEY: process.env.OPENDART_API_KEY,
    OPEN_DART_API_KEY: process.env.OPEN_DART_API_KEY,
    API_K_DART: process.env.API_K_DART,
  };
  delete process.env.DART_KEY;
  delete process.env.DART_API_KEY;
  delete process.env.OPENDART_API_KEY;
  delete process.env.OPEN_DART_API_KEY;
  delete process.env.API_K_DART;

  try {
    await assert.rejects(
      () => getDartDisclosures({ corpCode: '00126380' }),
      (error) => {
        assert.equal(error.status, 503);
        assert.equal(error.code, 'provider_unconfigured');
        assert.match(error.message, /DART_KEY/);
        return true;
      },
    );
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test('buildDartDisclosureDocumentDump includes only under-threshold documents up to limit', async () => {
  const { buildDartDisclosureDocumentDump, clearDartCaches } = await import('../src/crawlers/dart-filings.js');
  clearDartCaches();
  const requestedReceiptNos = [];
  const documents = {
    '20260601000001': '<document><section>짧은 공시 본문입니다.</section></document>',
    '20260601000002': `<document><section>${'긴'.repeat(20)}</section></document>`,
    '20260601000003': '<document><section>두 번째 짧은 본문입니다.</section></document>',
    '20260601000004': '<document><section>세 번째 짧은 본문입니다.</section></document>',
  };

  const dump = await buildDartDisclosureDocumentDump([
    { rceptNo: '20260601000001', reportName: '짧은 공시', receiptDate: '20260601', filerName: '삼성전자' },
    { rceptNo: '20260601000002', reportName: '긴 공시', receiptDate: '20260601', filerName: '삼성전자' },
    { rceptNo: '20260601000003', reportName: '짧은 공시 2', receiptDate: '20260601', filerName: '삼성전자' },
    { rceptNo: '20260601000004', reportName: '짧은 공시 3', receiptDate: '20260601', filerName: '삼성전자' },
  ], {
    apiKey: 'test-dart-key',
    maxCharsPerFiling: 15,
    limit: 2,
    concurrency: 2,
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      requestedReceiptNos.push(parsed.searchParams.get('rcept_no'));
      assert.equal(parsed.pathname, '/api/document.xml');
      assert.equal(parsed.searchParams.get('crtfc_key'), 'test-dart-key');
      return new Response(documents[parsed.searchParams.get('rcept_no')], {
        status: 200,
        headers: { 'Content-Type': 'application/xml' },
      });
    },
  });

  assert.equal(requestedReceiptNos.length, 4);
  assert.equal(dump.available, true);
  assert.equal(dump.maxCharsPerFiling, 15);
  assert.equal(dump.limit, 2);
  assert.equal(dump.includedCount, 2);
  assert.equal(dump.skippedTooLongCount, 1);
  assert.equal(dump.skipped.some((entry) => entry.reason === 'limit_exceeded'), true);
  assert.deepEqual(dump.filings.map((filing) => filing.rceptNo), ['20260601000001', '20260601000003']);
  assert.match(dump.combinedText, /짧은 공시 본문입니다/);
  assert.match(dump.combinedText, /두 번째 짧은 본문입니다/);
  assert.doesNotMatch(dump.combinedText, /긴긴긴/);
});

test('kr-stock-disclosures endpoint is registered and returns standard envelope', async () => {
  const { app, endpointDefinitions } = await import('../src/server.js');
  const definition = endpointDefinitions.find((item) => item.id === 'kr-stock-disclosures');

  assert.ok(definition);
  assert.equal(definition.primaryPath, '/api/source/opendart/kr/stocks/:code/disclosures');
  assert.deepEqual(definition.dataSources, ['opendart']);
  assert.ok(definition.query.includes('limit(optional alias for pageCount)'));

  const originalHandler = definition.handler;
  definition.handler = async (req) => ({
    source: 'opendart',
    market: 'KR',
    requested: { stockCode: req.params.code },
    corporation: { corpCode: '00126380', corpName: '삼성전자', stockCode: '005930' },
    filings: [{ rceptNo: '20260515000001', reportName: '분기보고서' }],
    summary: { count: 1, totalCount: 1 },
    meta: { status: '000', message: '정상' },
  });

  try {
    const body = await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/source/opendart/kr/stocks/005930/disclosures?limit=1`);
      assert.equal(response.status, 200);
      return response.json();
    });

    assert.equal(body.ok, true);
    assert.equal(body.count, 1);
    assert.equal(body.meta.routeId, 'kr-stock-disclosures');
    assert.equal(body.data.corporation.corpCode, '00126380');
    assert.equal(body.data.filings[0].rceptNo, '20260515000001');
  } finally {
    definition.handler = originalHandler;
  }
});
