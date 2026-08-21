const test = require('node:test');
const assert = require('node:assert/strict');
const { deflateRawSync } = require('node:zlib');

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

function createZipWithOutOfRangeLocalHeader(fileName = 'document.xml') {
  const name = Buffer.from(fileName, 'utf8');
  const centralDirectory = Buffer.alloc(46 + name.length);
  centralDirectory.writeUInt32LE(0x02014b50, 0);
  centralDirectory.writeUInt16LE(name.length, 28);
  centralDirectory.writeUInt32LE(0xfffffff0, 42);
  name.copy(centralDirectory, 46);

  const endOfCentralDirectory = Buffer.alloc(22);
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
  endOfCentralDirectory.writeUInt16LE(1, 8);
  endOfCentralDirectory.writeUInt16LE(1, 10);
  endOfCentralDirectory.writeUInt32LE(centralDirectory.length, 12);
  endOfCentralDirectory.writeUInt32LE(0, 16);

  return Buffer.concat([centralDirectory, endOfCentralDirectory]);
}

function createDeflatedZip(fileName, contents, { declaredUncompressedSize = Buffer.byteLength(contents) } = {}) {
  const name = Buffer.from(fileName, 'utf8');
  const source = Buffer.from(contents, 'utf8');
  const compressed = deflateRawSync(source);
  const localHeader = Buffer.alloc(30 + name.length);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(8, 8);
  localHeader.writeUInt32LE(compressed.length, 18);
  localHeader.writeUInt32LE(declaredUncompressedSize, 22);
  localHeader.writeUInt16LE(name.length, 26);
  name.copy(localHeader, 30);

  const centralDirectory = Buffer.alloc(46 + name.length);
  centralDirectory.writeUInt32LE(0x02014b50, 0);
  centralDirectory.writeUInt16LE(20, 6);
  centralDirectory.writeUInt16LE(8, 10);
  centralDirectory.writeUInt32LE(compressed.length, 20);
  centralDirectory.writeUInt32LE(declaredUncompressedSize, 24);
  centralDirectory.writeUInt16LE(name.length, 28);
  centralDirectory.writeUInt32LE(0, 42);
  name.copy(centralDirectory, 46);

  const endOfCentralDirectory = Buffer.alloc(22);
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
  endOfCentralDirectory.writeUInt16LE(1, 8);
  endOfCentralDirectory.writeUInt16LE(1, 10);
  endOfCentralDirectory.writeUInt32LE(centralDirectory.length, 12);
  endOfCentralDirectory.writeUInt32LE(localHeader.length + compressed.length, 16);

  return Buffer.concat([localHeader, compressed, centralDirectory, endOfCentralDirectory]);
}

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
    disclosureDetailType: 'A003',
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
      assert.equal(parsed.searchParams.get('pblntf_detail_ty'), 'A003');
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
  assert.equal(result.filings[0].disclosureType, 'A');
  assert.equal(result.filings[0].disclosureTypeLabel, '정기공시');
  assert.equal(result.filings[0].disclosureDetailType, 'A003');
  assert.equal(result.filings[0].disclosureDetailTypeLabel, '분기보고서');
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

test('getDartDisclosures validates official type/detail taxonomy before calling OpenDART', async () => {
  const { getDartDisclosures } = await import('../src/crawlers/dart-filings.js');
  let fetchCount = 0;
  const opts = {
    apiKey: 'test-dart-key',
    fetchImpl: async () => {
      fetchCount += 1;
      throw new Error('must not fetch');
    },
  };

  await assert.rejects(
    () => getDartDisclosures({
      corpCode: '00126380',
      disclosureType: 'A',
      disclosureDetailType: 'D001',
    }, opts),
    (error) => error.code === 'invalid_disclosure_type_pair',
  );
  await assert.rejects(
    () => getDartDisclosures({ corpCode: '00126380', disclosureDetailType: 'Z999' }, opts),
    (error) => error.code === 'invalid_enum',
  );
  assert.equal(fetchCount, 0);
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

test('OpenDART transport errors never echo the configured credential', async () => {
  const { clearDartCaches, getDartDisclosures } = await import('../src/crawlers/dart-filings.js');
  clearDartCaches();
  const secret = 'dart-transport-secret-195';

  await assert.rejects(
    () => getDartDisclosures({ corpCode: '00126380', from: '2026-06-01', to: '2026-06-01' }, {
      apiKey: secret,
      fetchImpl: async (url) => {
        throw new Error(`network failed for ${String(url)} using ${secret}`);
      },
    }),
    (error) => {
      assert.equal(error.code, 'provider_request_failed');
      assert.equal(JSON.stringify(error).includes(secret), false);
      assert.equal(error.message.includes(secret), false);
      return true;
    },
  );
});

test('buildDartDisclosureDocumentDump prioritizes material filings and extracts long documents within bounds', async () => {
  const { buildDartDisclosureDocumentDump, clearDartCaches } = await import('../src/crawlers/dart-filings.js');
  clearDartCaches();
  const requestedReceiptNos = [];
  const documents = {
    '20260601000001': `<document><section>상장폐지 주요 내용 ${'긴'.repeat(20)}</section></document>`,
    '20260601000002': '<document><section>일반 안내입니다.</section></document>',
    '20260601000003': '<document><section>두 번째 짧은 본문입니다.</section></document>',
    '20260601000004': '<document><section>세 번째 짧은 본문입니다.</section></document>',
  };

  const dump = await buildDartDisclosureDocumentDump([
    { rceptNo: '20260601000002', reportName: '일반 안내', receiptDate: '20260601', filerName: '삼성전자' },
    { rceptNo: '20260601000004', reportName: '기업지배구조보고서', receiptDate: '20260601', filerName: '삼성전자', disclosureType: 'D', disclosureDetailType: 'D003' },
    { rceptNo: '20260601000001', reportName: '상장폐지 결정', receiptDate: '20260601', filerName: '삼성전자' },
    { rceptNo: '20260601000003', reportName: '단일판매 공급계약 체결', receiptDate: '20260601', filerName: '삼성전자' },
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

  assert.deepEqual(requestedReceiptNos, ['20260601000001', '20260601000003']);
  assert.equal(dump.available, true);
  assert.equal(dump.maxCharsPerFiling, 15);
  assert.equal(dump.limit, 2);
  assert.equal(dump.includedCount, 2);
  assert.equal(dump.skippedTooLongCount, 0);
  assert.equal(dump.extractedLongCount, 1);
  assert.equal(dump.skipped.some((entry) => entry.reason === 'budget_excluded'), true);
  assert.deepEqual(dump.filings.map((filing) => filing.rceptNo), ['20260601000001', '20260601000003']);
  assert.match(dump.combinedText, /상장폐지/);
  assert.match(dump.combinedText, /두 번째 짧은 본문입니다/);
  assert.ok(dump.combinedCharCount <= 60_000);
});

test('collectDartDisclosures follows pages within caps and exposes truncation diagnostics', async () => {
  const { clearDartCaches, collectDartDisclosures } = await import('../src/crawlers/dart-filings.js');
  clearDartCaches();
  const pages = [];

  const result = await collectDartDisclosures({
    corpCode: '00126380',
    from: '2026-05-01',
    to: '2026-05-31',
  }, {
    apiKey: 'test-dart-key',
    maxPages: 2,
    maxCollectedFilings: 3,
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      const pageNo = Number(parsed.searchParams.get('page_no'));
      pages.push(pageNo);
      return new Response(JSON.stringify({
        status: '000',
        message: '정상',
        page_no: pageNo,
        page_count: 2,
        total_count: 5,
        total_page: 3,
        list: [1, 2].map((offset) => ({
          corp_code: '00126380',
          corp_name: '삼성전자',
          stock_code: '005930',
          report_nm: pageNo === 2 && offset === 1 ? '상장폐지 결정' : `일반 공시 ${pageNo}-${offset}`,
          rcept_no: `202605${String(pageNo).padStart(2, '0')}00000${offset}`,
          flr_nm: '삼성전자',
          rcept_dt: `202605${String(pageNo).padStart(2, '0')}`,
          pblntf_ty: 'I',
        })),
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });

  assert.deepEqual(pages, [1, 2]);
  assert.equal(result.filings.length, 3);
  assert.equal(result.collection.state, 'truncated');
  assert.equal(result.collection.providerTotalCount, 5);
  assert.equal(result.collection.collectedCount, 3);
  assert.equal(result.collection.pageCountFetched, 2);
  assert.equal(result.collection.truncated, true);
  assert.ok(result.filings.some((entry) => entry.reportName === '상장폐지 결정'));
});

test('document resource limits fail one filing without collapsing successful peers', async () => {
  const { buildDartDisclosureDocumentDump, clearDartCaches } = await import('../src/crawlers/dart-filings.js');
  clearDartCaches();
  const dump = await buildDartDisclosureDocumentDump([
    { rceptNo: 'resource', reportName: '상장폐지 결정', receiptDate: '20260601', filerName: '회사' },
    { rceptNo: 'ok', reportName: '단일판매 공급계약 체결', receiptDate: '20260601', filerName: '회사' },
  ], {
    apiKey: 'test-key',
    maxCompressedBytes: 64,
    maxCharsPerFiling: 100,
    maxTotalChars: 1000,
    limit: 2,
    fetchImpl: async (url) => {
      const rceptNo = new URL(String(url)).searchParams.get('rcept_no');
      if (rceptNo === 'resource') {
        return new Response('x', { status: 200, headers: { 'Content-Length': '1024' } });
      }
      return new Response('<d>정상 계약 본문</d>', { status: 200, headers: { 'Content-Type': 'application/xml' } });
    },
  });

  assert.equal(dump.state, 'partial');
  assert.equal(dump.includedCount, 1);
  assert.equal(dump.skippedUnavailableCount, 1);
  assert.ok(dump.excluded.some((entry) => entry.rceptNo === 'resource' && entry.reason === 'resource_limited'));
  assert.match(dump.combinedText, /정상 계약 본문/);
});

test('collectDartDisclosures retains earlier pages when a later page fails', async () => {
  const { clearDartCaches, collectDartDisclosures } = await import('../src/crawlers/dart-filings.js');
  clearDartCaches();
  const result = await collectDartDisclosures({ corpCode: '00126380', from: '2026-05-01', to: '2026-05-31' }, {
    apiKey: 'test-key',
    maxPages: 3,
    fetchImpl: async (url) => {
      const pageNo = Number(new URL(String(url)).searchParams.get('page_no'));
      if (pageNo === 2) throw new Error('page two failed');
      return new Response(JSON.stringify({
        status: '000',
        page_no: 1,
        page_count: 100,
        total_count: 2,
        total_page: 2,
        list: [{
          corp_code: '00126380',
          corp_name: '삼성전자',
          stock_code: '005930',
          report_nm: '첫 페이지 공시',
          rcept_no: '20260501000001',
          flr_nm: '삼성전자',
          rcept_dt: '20260501',
          pblntf_ty: 'E',
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });

  assert.equal(result.filings.length, 1);
  assert.equal(result.collection.state, 'truncated');
  assert.equal(result.collection.pageCountFetched, 1);
  assert.equal(result.collection.issues.length, 1);
  assert.match(result.collection.issues[0].message, /page two failed/);
});

test('document reader enforces streamed byte caps when Content-Length is missing or lies', async () => {
  const { clearDartCaches, getDartDisclosureDocumentText } = await import('../src/crawlers/dart-filings.js');
  for (const headers of [{}, { 'Content-Length': '1' }]) {
    clearDartCaches();
    await assert.rejects(
      () => getDartDisclosureDocumentText(`receipt-${Object.keys(headers).length}`, {
        apiKey: 'test-key',
        maxCompressedBytes: 32,
        fetchImpl: async () => new Response(`<d>${'x'.repeat(100)}</d>`, { status: 200, headers }),
      }),
      (error) => {
        assert.equal(error.code, 'document_resource_limited');
        return true;
      },
    );
  }
});

test('document reader converts an out-of-range ZIP local header into a typed provider error', async () => {
  const { clearDartCaches, getDartDisclosureDocumentText } = await import('../src/crawlers/dart-filings.js');
  clearDartCaches();

  await assert.rejects(
    () => getDartDisclosureDocumentText('malformed-local-header', {
      apiKey: 'test-key',
      fetchImpl: async () => new Response(createZipWithOutOfRangeLocalHeader(), {
        status: 200,
        headers: { 'Content-Type': 'application/zip' },
      }),
    }),
    (error) => {
      assert.equal(error.name, 'DartDisclosureError');
      assert.equal(error.code, 'provider_invalid_document_zip');
      return true;
    },
  );
});

test('document reader stops high-ratio ZIP inflation at the actual output cap', async () => {
  const { clearDartCaches, getDartDisclosureDocumentText } = await import('../src/crawlers/dart-filings.js');
  clearDartCaches();
  const payload = createDeflatedZip('document.xml', `<document>${'가'.repeat(10_000)}</document>`, {
    declaredUncompressedSize: 0,
  });

  await assert.rejects(
    () => getDartDisclosureDocumentText('high-ratio-zip', {
      apiKey: 'test-key',
      maxEntryBytes: 128,
      maxDecompressedBytes: 256,
      fetchImpl: async () => new Response(payload, {
        status: 200,
        headers: { 'Content-Type': 'application/zip' },
      }),
    }),
    (error) => {
      assert.equal(error.code, 'document_resource_limited');
      return true;
    },
  );
});

test('document cache never bypasses stricter resource limits on a later read', async () => {
  const { clearDartCaches, getDartDisclosureDocumentText } = await import('../src/crawlers/dart-filings.js');
  clearDartCaches();
  let fetchCount = 0;
  const fetchImpl = async () => {
    fetchCount += 1;
    return new Response(`<document>${'가'.repeat(100)}</document>`, {
      status: 200,
      headers: { 'Content-Type': 'application/xml' },
    });
  };

  const permissive = await getDartDisclosureDocumentText('cache-resource-policy', {
    apiKey: 'test-key',
    maxTextChars: 1_000,
    fetchImpl,
  });
  assert.ok(permissive.charCount > 10);

  await assert.rejects(
    () => getDartDisclosureDocumentText('cache-resource-policy', {
      apiKey: 'test-key',
      maxTextChars: 10,
      fetchImpl,
    }),
    (error) => {
      assert.equal(error.code, 'document_resource_limited');
      return true;
    },
  );
  assert.equal(fetchCount, 2);
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
