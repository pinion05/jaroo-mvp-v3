import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from '../src/server.js';
import { crawlWiseReportKrPage, getCrawl } from '../src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const verificationArtifactPath = path.join(projectRoot, 'docs', 'wisereport-kr-structured-verification.json');

const code = (process.argv[2] || '005930').trim();

function summarizePage(page) {
  return {
    id: page?.id,
    sourceKey: page?.sourceKey,
    tableCount: page?.quality?.tableCount,
    warningCount: Array.isArray(page?.quality?.warnings) ? page.quality.warnings.length : null,
    normalizedKeys: Object.keys(page?.normalized || {}),
    hasJsonEvidence: Array.isArray(page?.source?.capturedResponses)
      ? page.source.capturedResponses.some((response) => response?.parsedBody)
      : false,
  };
}

function summarizeAggregate(aggregate) {
  return {
    code: aggregate?.source?.code ?? null,
    pageCount: Object.keys(aggregate?.normalized || aggregate?.pages || {}).length,
    pageIds: Object.keys(aggregate?.normalized || aggregate?.pages || {}),
    warningCount: aggregate?.quality?.warningCount ?? null,
    qualityKeys: Object.keys(aggregate?.quality || {}),
  };
}

async function withServer(run) {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });

  try {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

async function fetchJson(url) {
  const response = await fetch(url);
  const body = await response.json();
  return {
    status: response.status,
    ok: response.ok,
    body,
    headers: Object.fromEntries(response.headers.entries()),
  };
}

const page = await crawlWiseReportKrPage(code, 'company-overview', { waitAfterLoadMs: 1200 });
const aggregate = await getCrawl(code, { concurrency: 2, waitAfterLoadMs: 1200 });

const httpSmoke = await withServer(async (baseUrl) => {
  const companyOverview = await fetchJson(`${baseUrl}/api/wisereport/kr/${code}/company-overview`);
  const aggregateResponse = await fetchJson(`${baseUrl}/api/wisereport/kr/${code}`);
  const slimResponse = await fetchJson(`${baseUrl}/api/wisereport/kr/${code}/slim/v1`);
  return {
    baseUrl,
    companyOverview: {
      status: companyOverview.status,
      ok: companyOverview.ok,
      count: companyOverview.body?.count,
      resource: companyOverview.body?.meta?.resource,
      dataKeys: Object.keys(companyOverview.body?.data || {}),
      normalizedKeys: Object.keys(companyOverview.body?.data?.normalized || {}),
      qualityKeys: Object.keys(companyOverview.body?.data?.quality || {}),
    },
    aggregate: {
      status: aggregateResponse.status,
      ok: aggregateResponse.ok,
      count: aggregateResponse.body?.count,
      resource: aggregateResponse.body?.meta?.resource,
      pageKeys: Object.keys(aggregateResponse.body?.data?.pages || {}),
      qualityKeys: Object.keys(aggregateResponse.body?.data?.quality || {}),
    },
    slimV1: {
      status: slimResponse.status,
      contentType: slimResponse.headers['content-type'] || null,
      topLevelKeys: Object.keys(slimResponse.body || {}),
      company: slimResponse.body?.company || null,
      pageKeys: Object.keys(slimResponse.body?.pages || {}),
      samplePageKeys: Object.keys(slimResponse.body?.pages?.['company-overview'] || {}),
    },
  };
});

const output = {
  generatedAt: new Date().toISOString(),
  code,
  directCrawler: {
    page: summarizePage(page),
    aggregate: summarizeAggregate(aggregate),
  },
  httpSmoke,
};

await mkdir(path.dirname(verificationArtifactPath), { recursive: true });
await writeFile(verificationArtifactPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(output, null, 2));
