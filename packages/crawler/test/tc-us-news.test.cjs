const test = require('node:test');
const assert = require('node:assert/strict');

// TC-CRW-040 — src/crawlers/us-news.js (US 뉴스 병합/감성 + WiseReport 본문 보강) 커버리지 갭 테스트.
// us-news는 기존 자동화 테스트가 전무했다. polygon/finnhub 엔드포인트를 스텁해(외부 네트워크 없음)
// ① 두 소스 뉴스 병합·제목 기준 중복 제거, ② finnhub 감성 스코어 정규화, ③ 요약이 없는 뉴스에 대한
// wisereportRawData 본문 보강(getUSNews → augmentUSNewsWithWiseReport 경로)을 검증한다.

// api-clients.js가 모듈 로드 시점에 API 키를 캡처하므로, 동적 import 전에 환경을 고정한다.
process.env.POLYGON_API_KEY = 'tc-test-polygon-key';
process.env.FINNHUB_API_KEY = 'tc-test-finnhub-token';
delete process.env.FMP_API_KEY;

const ALPHA_EPOCH = 1767000000; // finnhub datetime (초 단위)
const BETA_WISEREPORT_PUBLISH = '/Date(1767000000000)/'; // WiseReport /Date(ms)/ 형식

function stubNewsFetch() {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    const target = new URL(String(url));
    calls.push(target.hostname + target.pathname);
    if (target.hostname === 'api.polygon.io') {
      assert.equal(target.searchParams.get('apiKey'), 'tc-test-polygon-key', 'polygon 호출에는 apiKey 파라미터가 실려야 한다');
    }

    if (target.hostname === 'api.polygon.io' && target.pathname === '/v2/reference/news') {
      return {
        ok: true,
        json: async () => ({
          results: [
            {
              publisher: { name: 'TechDaily' },
              title: 'Alpha Launches Quantum Chip',
              description: 'Alpha chip desc',
              article_url: 'https://example.com/alpha',
              image_url: 'https://example.com/alpha.png',
              published_utc: '2026-11-01T09:30:00.000Z',
              tickers: ['AAPL'],
            },
            {
              // description 없음 → 요약 공백 → WiseReport 본문 보강 트리거
              publisher: { name: 'TechDaily' },
              title: 'Beta Recall Expands Overseas',
              article_url: 'https://example.com/beta',
              published_utc: '2026-11-02T10:00:00.000Z',
              tickers: ['AAPL'],
            },
          ],
        }),
      };
    }
    if (target.hostname === 'finnhub.io' && target.pathname === '/api/v1/company-news') {
      return {
        ok: true,
        json: async () => [
          {
            // polygon 기사와 정규화 제목이 같은 중복 기사 → 병합에서 제거되어야 한다
            source: 'FinnHub Wire',
            headline: 'alpha launches quantum chip',
            summary: 'dup summary',
            url: 'https://example.com/alpha-dup',
            datetime: ALPHA_EPOCH,
          },
          {
            source: 'FinnHub Wire',
            headline: 'Gamma guidance raised',
            summary: 'gamma summary',
            url: 'https://example.com/gamma',
            datetime: ALPHA_EPOCH + 3600,
          },
        ],
      };
    }
    if (target.hostname === 'finnhub.io' && target.pathname === '/api/v1/news-sentiment') {
      return {
        ok: true,
        json: async () => ({
          bullishPercent: 0.7,
          bearishPercent: 0.2,
          buzz: { articlesInLastWeek: 10, buzz: 1.5, weeklyAverage: 1.2 },
          sectorAverageBullishPercent: 0.55,
          sectorAverageNewsScore: 0.5,
        }),
      };
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  };

  return async () => {
    globalThis.fetch = originalFetch;
    return calls;
  };
}

const wisereportRawData = {
  ticker: 'AAPL',
  pages: {
    'company-snap': {
      auxiliary: [
        {
          id: 'news-company-1',
          ok: true,
          data: {
            Data: [
              {
                TEXT: 'Beta Recall Expands Overseas',
                BODY: '<p>Beta expanded the recall to Europe.</p>',
                PUBLISHTIME: BETA_WISEREPORT_PUBLISH,
              },
            ],
          },
        },
      ],
    },
  },
};

test('TC-CRW-040 getUSNews는 polygon·finnhub 뉴스를 제목 정규화 기준으로 병합·중복 제거하고, 감성 스코어를 0~1로 정규화하며, 요약 공백 뉴스는 WiseReport 원문으로 보강한다', async () => {
  const { getUSNews } = await import('../src/crawlers/us-news.js');
  const restore = stubNewsFetch();

  try {
    const result = await getUSNews('AAPL', 10, { wisereportRawData });

    // 1) 병합 + 중복 제거: polygon 우선, finnhub의 alpha 중복 기사는 탈락 → 총 3건
    assert.equal(result.ticker, 'AAPL');
    assert.equal(result.news.length, 3);
    assert.deepEqual(
      result.news.map((item) => item.title),
      ['Alpha Launches Quantum Chip', 'Beta Recall Expands Overseas', 'Gamma guidance raised'],
    );
    assert.equal(result.totalFetched, 3);

    // 2) polygon 정규화
    const alpha = result.news[0];
    assert.equal(alpha.source, 'TechDaily');
    assert.equal(alpha.summary, 'Alpha chip desc');
    assert.equal(alpha.url, 'https://example.com/alpha');
    assert.equal(alpha.image, 'https://example.com/alpha.png');
    assert.equal(alpha.publishedAt, '2026-11-01T09:30:00.000Z');
    assert.deepEqual(alpha.tickers, ['AAPL']);

    // 3) finnhub 정규화 (epoch 초 → ISO 8601)
    const gamma = result.news[2];
    assert.equal(gamma.source, 'FinnHub Wire');
    assert.equal(gamma.publishedAt, new Date((ALPHA_EPOCH + 3600) * 1000).toISOString());
    assert.equal(gamma.url, 'https://example.com/gamma');

    // 4) 요약이 없던 beta 기사가 WiseReport 원문으로 보강된다
    const beta = result.news[1];
    assert.equal(beta.summary, 'Beta expanded the recall to Europe.', 'HTML 태그가 제거된 본문 요약이 채워져야 한다');
    assert.equal(beta.bodyText, 'Beta expanded the recall to Europe.');
    assert.equal(beta.textSource, 'wisereport-global');
    assert.equal(beta.textStatus, 'augmented');
    // augment는 요약/본문만 채운다 — 원본(polygon) 발행일은 덮어쓰지 않는다
    assert.equal(beta.publishedAt, '2026-11-02T10:00:00.000Z', '원본 기사의 publishedAt이 보존되어야 한다');

    // 5) 보강 메타: 1건 매칭 · 1건 보강 · 기존 요약 보존 0건
    assert.deepEqual(result.meta.newsText, {
      attempted: true,
      source: 'wisereport-global',
      status: 'ok',
      matched: 1,
      augmented: 1,
      skippedExisting: 0,
    });

    // 6) 감성 스코어: (bullish - bearish + 1) / 2 = (0.7 - 0.2 + 1) / 2 = 0.75
    assert.equal(result.sentiment.sentimentScore, 0.75);
    assert.equal(result.sentiment.bullishPercent, 0.7);
    assert.equal(result.sentiment.bearishPercent, 0.2);
    assert.deepEqual(result.sentiment.buzz, { articlesInLastWeek: 10, buzz: 1.5, weeklyAverage: 1.2 });
    assert.equal(result.sentiment.source, 'finnhub-news-sentiment');
    assert.equal(result.sentiment.status, 'ok');
    assert.equal(result.meta.sentiment.status, 'ok');

    // 7) 외부 호출은 polygon 뉴스 1회 + finnhub 2회(company-news, news-sentiment)뿐
    const calls = await restore();
    assert.deepEqual(calls, [
      'api.polygon.io/v2/reference/news',
      'finnhub.io/api/v1/company-news',
      'finnhub.io/api/v1/news-sentiment',
    ]);
  } finally {
    await restore();
  }
});
