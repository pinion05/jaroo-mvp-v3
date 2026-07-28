import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getDartDisclosureDocumentText } from '../../../../packages/crawler/src/crawlers/dart-filings.js';
import {
  KR_DISCLOSURE_EVENT_ONTOLOGY_HASH,
  KR_DISCLOSURE_EVENT_ONTOLOGY_VERSION,
} from '../../../../packages/crawler/src/services/deepscan-kr-disclosure-event-ontology.js';

const here = dirname(fileURLToPath(import.meta.url));
const reportDir = resolve(here, '..');
const outputDir = resolve(
  process.env.ACCURACY_AUDIT_PACKET_DIR ?? '/tmp/jaroo-opendart-accuracy-audit',
);
const sourceData = JSON.parse(await readFile(resolve(reportDir, 'source-data.json'), 'utf8'));
const ranges = [
  [0, 34],
  [35, 74],
  [75, 112],
  [113, 149],
];

async function mapConcurrent(values, concurrency, mapper) {
  const output = new Array(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return output;
}

function serializeError(error) {
  return {
    code: String(error?.code ?? 'document_fetch_failed'),
    message: String(error?.message ?? error),
    providerStatus: error?.details?.providerStatus ?? null,
  };
}

async function fetchWithRetry(rceptNo, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await getDartDisclosureDocumentText(rceptNo, { timeoutMs: 30_000 });
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 250));
      }
    }
  }
  throw lastError;
}

const cases = await mapConcurrent(sourceData.results, 4, async (result, index) => {
  const source = {
    rceptNo: result.source.rceptNo,
    receiptDate: result.source.receiptDate,
    reportName: result.source.reportName,
    corpCode: result.source.corpCode,
    corpName: result.source.corpName,
    stockCode: result.source.stockCode,
    disclosureType: result.source.disclosureType,
    disclosureDetailType: result.source.disclosureDetailType,
    disclosureDetailTypeLabel: result.source.disclosureDetailTypeLabel,
    filingUrl: result.source.filingUrl,
  };

  if (!result.document) {
    return {
      index,
      source,
      document: null,
      fetchError: result.fetchError,
      assessable: false,
      originalDocumentStatus: 'unavailable',
    };
  }

  try {
    const document = await fetchWithRetry(source.rceptNo);
    const bodySha256 = createHash('sha256').update(document.text).digest('hex');
    return {
      index,
      source,
      document: {
        source: document.source,
        charCount: document.charCount,
        fileCount: document.fileCount,
        bodySha256,
        expectedBodySha256: result.document.bodySha256,
        hashMatchesOriginalRun: bodySha256 === result.document.bodySha256,
        bodyText: document.text,
      },
      fetchError: null,
      assessable: true,
      originalDocumentStatus: 'available',
    };
  } catch (error) {
    return {
      index,
      source,
      document: null,
      fetchError: serializeError(error),
      assessable: false,
      originalDocumentStatus: 'available-but-refetch-failed',
    };
  }
});

await mkdir(outputDir, { recursive: true });
for (const [sliceIndex, [from, to]] of ranges.entries()) {
  const packet = {
    schemaVersion: 'jaroo.opendart-event-accuracy-blind-packet.v1',
    generatedAt: new Date().toISOString(),
    predictionBlind: true,
    ontologyVersion: KR_DISCLOSURE_EVENT_ONTOLOGY_VERSION,
    ontologyHash: KR_DISCLOSURE_EVENT_ONTOLOGY_HASH,
    range: { from, to },
    cases: cases.slice(from, to + 1),
  };
  const serialized = `${JSON.stringify(packet, null, 2)}\n`;
  if (serialized.includes('eventExtraction') || serialized.includes('filingClassification')) {
    throw new Error('Blind packet accidentally contains classifier output.');
  }
  await writeFile(resolve(outputDir, `blind-slice-${sliceIndex + 1}.json`), serialized, 'utf8');
}

const summary = {
  outputDir,
  caseCount: cases.length,
  assessableCount: cases.filter((entry) => entry.assessable).length,
  unavailableCount: cases.filter((entry) => !entry.assessable).length,
  bodyHashMatchCount: cases.filter((entry) => entry.document?.hashMatchesOriginalRun).length,
  bodyHashMismatchCount: cases.filter(
    (entry) => entry.document && !entry.document.hashMatchesOriginalRun,
  ).length,
};
await writeFile(
  resolve(outputDir, 'packet-summary.json'),
  `${JSON.stringify(summary, null, 2)}\n`,
  'utf8',
);
console.log(JSON.stringify(summary, null, 2));
