
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
  const slimV11 = await fetchJson(`${baseUrl}/api/source/wisereport-fnguide/kr/companies/${code}/slim/v1.1`);
  return { baseUrl, slimV11 };
});

await mkdir(outDir, { recursive: true });
const files = {
  slimV11: path.join(outDir, `wisereport-kr-slim-v11-${code}.json`),
  manifest: path.join(outDir, `wisereport-kr-http-samples-${code}.json`),
};

await writeFile(files.slimV11, `${JSON.stringify(result.slimV11, null, 2)}
`);
await writeFile(files.manifest, `${JSON.stringify({
  code,
  files,
  summary: {
    slimV11TopLevelKeys: Object.keys(result.slimV11 || {}),
  },
}, null, 2)}
`);

console.log(JSON.stringify({ code, files }, null, 2));
