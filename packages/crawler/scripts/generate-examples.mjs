import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from '../src/server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const outputDir = path.join(projectRoot, 'example');

const COMPANY_FACTS_EXAMPLE_ID = 'us-stock-company-facts-nvda';
const COMPANY_FACTS_TAXONOMY_CONCEPTS_EXAMPLE_ID = 'us-stock-company-facts-nvda-us-gaap-concepts';
const COMPANY_FACTS_CONCEPT_EXAMPLE_ID = 'us-stock-company-facts-nvda-us-gaap-assets';
const MAX_TAXONOMY_SAMPLE_CONCEPTS = 4;
const MAX_CONCEPT_SAMPLE_UNITS = 2;
const PREFERRED_COMPANY_FACTS_CONCEPTS = [
  'EntityCommonStockSharesOutstanding',
  'Assets',
  'Liabilities',
  'StockholdersEquity',
  'Revenues',
  'RevenueFromContractWithCustomerExcludingAssessedTax',
  'OperatingIncomeLoss',
  'NetIncomeLoss',
  'NetCashProvidedByUsedInOperatingActivities',
  'EarningsPerShareDiluted',
];

const exampleRequests = [
  { id: 'health', path: '/health' },
  { id: 'catalog', path: '/api/catalog' },
  { id: 'wisereport-kr-005930', path: '/api/wisereport/kr/005930' },
  { id: 'market-overview-kr', path: '/api/market/overview/kr' },
  { id: 'market-fx-usd-krw', path: '/api/market/fx/usd-krw' },
  { id: 'market-indicators', path: '/api/market/indicators' },
  { id: 'market-indicators-vkospi', path: '/api/market/indicators/vkospi' },
  { id: 'market-indicators-adr', path: '/api/market/indicators/adr' },
  { id: 'market-indicators-us-vix', path: '/api/market/indicators/us-vix' },
  { id: 'wisereport-global-nvda', path: '/api/wisereport/global/NVDA' },
  { id: 'wisereport-global-nvda-domain', path: '/api/wisereport/global/NVDA/domain' },
  { id: 'us-stock-financials-nvda', path: '/api/us-stock/financials/NVDA' },
  { id: 'us-stock-consensus-nvda', path: '/api/us-stock/consensus/NVDA' },
  { id: 'us-stock-news-nvda', path: '/api/us-stock/news/NVDA' },
  { id: 'us-stock-filings-nvda', path: '/api/us-stock/filings/NVDA' },
  { id: 'us-stock-company-facts-nvda', path: '/api/us-stock/company-facts/NVDA' },
  { id: 'us-stock-company-facts-nvda-taxonomies', path: '/api/us-stock/company-facts/NVDA/taxonomies' },
  { id: 'us-stock-company-facts-nvda-us-gaap-concepts', path: '/api/us-stock/company-facts/NVDA/taxonomies/us-gaap/concepts' },
  { id: 'us-stock-company-facts-nvda-us-gaap-assets', path: '/api/us-stock/company-facts/NVDA/taxonomies/us-gaap/concepts/Assets' },
  { id: 'us-market-indicators', path: '/api/us-market/indicators' },
  { id: 'us-stock-report-nvda', path: '/api/us-stock/report/NVDA' },
  { id: 'krx-ohlcv-005930', path: '/api/krx/ohlcv/005930?startDate=20250301&endDate=20250330' },
  { id: 'krx-index-1001', path: '/api/krx/index/1001?startDate=20250301&endDate=20250330' },
  { id: 'krx-investor-volume-005930', path: '/api/krx/investor-volume/005930?startDate=20250301&endDate=20250330' },
  { id: 'krx-market-snapshot-kospi-20250328', path: '/api/krx/market/snapshot?tradeDate=20250328&market=KOSPI' },
  { id: 'krx-market-cap-kospi-20250328', path: '/api/krx/market/cap?tradeDate=20250328&market=KOSPI' },
  { id: 'krx-tickers-kospi', path: '/api/krx/tickers?market=KOSPI' },
  { id: 'krx-trigger-batch-morning', path: '/api/krx/batches/trigger?mode=morning' },
];

function createSummary(body) {
  if (!body || typeof body !== 'object') {
    return { kind: typeof body };
  }

  const data = body.data;
  if (Array.isArray(data)) {
    return {
      kind: 'array',
      count: data.length,
      first: data[0] ?? null,
      last: data.at(-1) ?? null,
    };
  }

  if (data && typeof data === 'object') {
    const keys = Object.keys(data);
    return {
      kind: 'object',
      count: body.count ?? keys.length,
      keys: keys.slice(0, 20),
    };
  }

  return {
    kind: data == null ? 'null' : typeof data,
    count: body.count ?? null,
    value: data ?? null,
  };
}

function compareStrings(a, b) {
  return String(a).localeCompare(String(b));
}

function sortKeys(value) {
  return Object.keys(value || {}).sort(compareStrings);
}

function truncateText(value, maxLength = 180) {
  if (typeof value !== 'string') {
    return value ?? null;
  }

  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}…`;
}

function compareFactEntries(a, b) {
  const aKey = [a?.filed ?? '', a?.end ?? '', a?.frame ?? '', a?.accn ?? ''].join('|');
  const bKey = [b?.filed ?? '', b?.end ?? '', b?.frame ?? '', b?.accn ?? ''].join('|');
  return aKey.localeCompare(bKey);
}

function pickFactEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  return {
    end: entry.end ?? null,
    val: entry.val ?? null,
    filed: entry.filed ?? null,
    form: entry.form ?? null,
    fy: entry.fy ?? null,
    fp: entry.fp ?? null,
    frame: entry.frame ?? null,
    accn: entry.accn ?? null,
  };
}

function summarizeFactSeries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return {
      count: 0,
      first: null,
      last: null,
    };
  }

  const sortedEntries = [...entries].sort(compareFactEntries);
  return {
    count: entries.length,
    first: pickFactEntry(sortedEntries[0]),
    last: pickFactEntry(sortedEntries.at(-1)),
  };
}

function summarizeConcept(conceptName, concept) {
  const unitNames = sortKeys(concept?.units || {});
  return {
    concept: conceptName,
    label: concept?.label ?? null,
    description: truncateText(concept?.description),
    unitCount: unitNames.length,
    units: Object.fromEntries(
      unitNames.slice(0, MAX_CONCEPT_SAMPLE_UNITS).map((unitName) => [
        unitName,
        summarizeFactSeries(concept.units?.[unitName]),
      ]),
    ),
  };
}

function selectSampleConceptNames(taxonomy) {
  const conceptNames = sortKeys(taxonomy);
  const selected = [];

  for (const conceptName of PREFERRED_COMPANY_FACTS_CONCEPTS) {
    if (taxonomy?.[conceptName] && !selected.includes(conceptName)) {
      selected.push(conceptName);
    }
    if (selected.length >= MAX_TAXONOMY_SAMPLE_CONCEPTS) {
      return selected;
    }
  }

  for (const conceptName of conceptNames) {
    if (!selected.includes(conceptName)) {
      selected.push(conceptName);
    }
    if (selected.length >= MAX_TAXONOMY_SAMPLE_CONCEPTS) {
      break;
    }
  }

  return selected;
}

function summarizeTaxonomy(taxonomy) {
  const conceptNames = sortKeys(taxonomy);
  const sampleConceptNames = selectSampleConceptNames(taxonomy);

  let unitCount = 0;
  let factSeriesCount = 0;
  let valueCount = 0;

  for (const conceptName of conceptNames) {
    const units = taxonomy?.[conceptName]?.units || {};
    const unitNames = sortKeys(units);
    unitCount += unitNames.length;
    factSeriesCount += unitNames.length;
    valueCount += unitNames.reduce((sum, unitName) => sum + (Array.isArray(units[unitName]) ? units[unitName].length : 0), 0);
  }

  return {
    conceptCount: conceptNames.length,
    unitCount,
    factSeriesCount,
    valueCount,
    sampleConcepts: sampleConceptNames.map((conceptName) => summarizeConcept(conceptName, taxonomy[conceptName])),
  };
}

function compactCompanyFactsExample(body) {
  const facts = body?.data?.facts;
  const taxonomies = body?.data?.taxonomies;

  if (!facts || typeof facts !== 'object') {
    return body;
  }

  const factTaxonomyNames = sortKeys(facts);
  const taxonomyNames = sortKeys(taxonomies || {});

  return {
    ...body,
    data: {
      ...body.data,
      facts: {
        compacted: true,
        note: 'Example artifact summarizes SEC company facts to keep the committed file compact and reviewable.',
        taxonomyCount: factTaxonomyNames.length,
        taxonomies: Object.fromEntries(
          factTaxonomyNames.map((taxonomyName) => [taxonomyName, summarizeTaxonomy(facts[taxonomyName])]),
        ),
      },
      taxonomies: {
        compacted: true,
        taxonomyCount: taxonomyNames.length,
        taxonomies: Object.fromEntries(
          taxonomyNames.map((taxonomyName) => [taxonomyName, summarizeTaxonomy(taxonomies[taxonomyName])]),
        ),
      },
    },
  };
}

function compactCompanyFactsTaxonomyConceptsExample(body) {
  const concepts = body?.data?.concepts;
  if (!Array.isArray(concepts)) {
    return body;
  }

  return {
    ...body,
    data: {
      ...body.data,
      concepts: {
        compacted: true,
        note: 'Example artifact samples concept names to keep the committed file compact and reviewable.',
        count: concepts.length,
        first: concepts.slice(0, 25),
        last: concepts.slice(-5),
      },
    },
  };
}

function compactCompanyFactsConceptExample(body) {
  const units = body?.data?.units;
  if (!units || typeof units !== 'object') {
    return body;
  }

  const unitNames = sortKeys(units);
  return {
    ...body,
    data: {
      ...body.data,
      units: {
        compacted: true,
        note: 'Example artifact summarizes concept units to keep the committed file compact and reviewable.',
        unitCount: unitNames.length,
        units: Object.fromEntries(
          unitNames.map((unitName) => [unitName, summarizeFactSeries(units[unitName])]),
        ),
      },
    },
  };
}

function transformExampleBody(item, body) {
  if (item.id === COMPANY_FACTS_EXAMPLE_ID) {
    return compactCompanyFactsExample(body);
  }

  if (item.id === COMPANY_FACTS_TAXONOMY_CONCEPTS_EXAMPLE_ID) {
    return compactCompanyFactsTaxonomyConceptsExample(body);
  }

  if (item.id === COMPANY_FACTS_CONCEPT_EXAMPLE_ID) {
    return compactCompanyFactsConceptExample(body);
  }

  return body;
}

async function main() {
  await mkdir(outputDir, { recursive: true });

  const server = app.listen(0);
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const manifest = [];

  try {
    for (const item of exampleRequests) {
      console.log(`[example] ${item.id} -> ${item.path}`);
      const startedAt = Date.now();
      const response = await fetch(`${baseUrl}${item.path}`);
      const text = await response.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch (error) {
        throw new Error(`${item.id}: JSON parse 실패 (${error.message})`);
      }

      if (!response.ok || body?.ok === false) {
        throw new Error(`${item.id}: 요청 실패 status=${response.status} message=${body?.error?.message || 'unknown'}`);
      }

      const exampleBody = transformExampleBody(item, body);
      const filePath = path.join(outputDir, `${item.id}.json`);
      await writeFile(filePath, `${JSON.stringify(exampleBody, null, 2)}\n`);

      manifest.push({
        id: item.id,
        path: item.path,
        status: response.status,
        durationMs: Date.now() - startedAt,
        file: `example/${item.id}.json`,
        summary: createSummary(exampleBody),
      });
    }

    const manifestPath = path.join(outputDir, 'index.json');
    await writeFile(manifestPath, `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      count: manifest.length,
      baseUrl,
      examples: manifest,
    }, null, 2)}\n`);

    console.log(JSON.stringify({ ok: true, count: manifest.length, outputDir }, null, 2));
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
