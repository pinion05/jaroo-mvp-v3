
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from '../src/server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const outDir = path.join(projectRoot, 'docs', 'http-samples');
const code = (process.argv[2] || '005930').trim();

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
  return await response.json();
}

const result = await withServer(async (baseUrl) => {
  const aggregate = await fetchJson(`${baseUrl}/api/wisereport/kr/${code}`);
  const companyOverview = await fetchJson(`${baseUrl}/api/wisereport/kr/${code}/company-overview`);
  const relativeReturn = await fetchJson(`${baseUrl}/api/wisereport/kr/${code}/relative-return`);
  return { baseUrl, aggregate, companyOverview, relativeReturn };
});

await mkdir(outDir, { recursive: true });
const files = {
  aggregate: path.join(outDir, `wisereport-kr-aggregate-${code}.json`),
  companyOverview: path.join(outDir, `wisereport-kr-company-overview-${code}.json`),
  relativeReturn: path.join(outDir, `wisereport-kr-relative-return-${code}.json`),
  manifest: path.join(outDir, `wisereport-kr-http-samples-${code}.json`),
};

await writeFile(files.aggregate, `${JSON.stringify(result.aggregate, null, 2)}
`);
await writeFile(files.companyOverview, `${JSON.stringify(result.companyOverview, null, 2)}
`);
await writeFile(files.relativeReturn, `${JSON.stringify(result.relativeReturn, null, 2)}
`);
await writeFile(files.manifest, `${JSON.stringify({
  code,
  files,
  summary: {
    aggregateCount: result.aggregate?.count ?? null,
    companyOverviewCount: result.companyOverview?.count ?? null,
    relativeReturnCount: result.relativeReturn?.count ?? null,
  },
}, null, 2)}
`);

console.log(JSON.stringify({ code, files }, null, 2));
