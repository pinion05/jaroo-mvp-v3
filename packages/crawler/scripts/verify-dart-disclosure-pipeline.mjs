import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildDartDisclosureDocumentDump,
  collectDartDisclosures,
} from '../src/crawlers/dart-filings.js';
import {
  attachKrDisclosureLlmDump,
  buildKrDisclosurePipeline,
} from '../src/services/deepscan-kr-disclosure-pipeline.js';
import { safeJsonStringify } from '../../deepscan-runtime-core/src/safe-json.js';

function parseArgs(argv) {
  return Object.fromEntries(argv.map((argument) => {
    const [key, ...rest] = argument.replace(/^--/, '').split('=');
    return [key, rest.join('=') || true];
  }));
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function configuredDartKey() {
  return process.env.DART_KEY
    ?? process.env.DART_API_KEY
    ?? process.env.OPENDART_API_KEY
    ?? process.env.OPEN_DART_API_KEY
    ?? process.env.API_K_DART
    ?? null;
}

function artifactPath(code) {
  const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
  const root = join(repositoryRoot, '.omx', 'context', 'dart-disclosure-smoke');
  mkdirSync(root, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return join(root, `${timestamp}-${code}.json`);
}

function writeArtifact(path, payload, secrets = []) {
  writeFileSync(path, safeJsonStringify(payload, 2, { secrets }));
}

function assertContract(pipeline, maxTotalChars, secret) {
  const stageNames = ['collection', 'collected', 'classified', 'relationships', 'selected', 'excluded', 'analysis', 'llmDump'];
  for (const stage of stageNames) {
    if (!Object.prototype.hasOwnProperty.call(pipeline, stage)) {
      throw new Error(`missing pipeline stage: ${stage}`);
    }
  }
  if (pipeline.llmDump.combinedCharCount > maxTotalChars) {
    throw new Error(`combined text exceeds budget: ${pipeline.llmDump.combinedCharCount}/${maxTotalChars}`);
  }
  for (const selected of pipeline.selected) {
    if (!selected.rceptNo && !selected.canonicalKey) throw new Error('selected filing lost receipt lineage');
  }
  const serialized = safeJsonStringify(pipeline, 0, { secrets: secret ? [secret] : [] });
  if ((secret && serialized.includes(secret)) || /crtfc_key=[^&\s]+/i.test(serialized)) {
    throw new Error('credential leaked into serialized pipeline');
  }
}

const args = parseArgs(process.argv.slice(2));
const code = String(args.code ?? '005930');
const from = String(args.from ?? '2026-06-01');
const to = String(args.to ?? from);
const selectionLimit = positiveInteger(args['selection-limit'], 10);
const documentLimit = positiveInteger(args['document-limit'], 4);
const maxTotalChars = positiveInteger(args['max-total-chars'], 30_000);
const requireCategory = typeof args['require-category'] === 'string' ? args['require-category'] : null;
const requireReceipt = typeof args['require-receipt'] === 'string' ? args['require-receipt'] : null;
const requireLongExtraction = args['require-long-extraction'] === true || args['require-long-extraction'] === 'true';
const secret = configuredDartKey();
const outputPath = artifactPath(code);

if (!secret) {
  writeArtifact(outputPath, { status: 'skipped', reason: 'credential_unconfigured', code, from, to });
  console.log(JSON.stringify({ status: 'skipped', reason: 'credential_unconfigured', artifact: outputPath }));
  process.exitCode = 2;
} else {
  try {
    const source = await collectDartDisclosures({ code, from, to, pageCount: 100 }, {
      maxPages: 3,
      maxCollectedFilings: 300,
      timeoutMs: 15_000,
    });
    let pipeline = buildKrDisclosurePipeline(source, { selectionLimit });
    const llmDump = await buildDartDisclosureDocumentDump(pipeline.selected, {
      limit: documentLimit,
      fetchLimit: documentLimit,
      concurrency: 4,
      maxCharsPerFiling: 15_000,
      maxTotalChars,
      timeoutMs: 15_000,
    });
    pipeline = attachKrDisclosureLlmDump(pipeline, llmDump);
    assertContract(pipeline, maxTotalChars, secret);

    const observedCategories = [...new Set(pipeline.classified.flatMap((filing) => filing.categories ?? []))];
    const selectedReceipts = pipeline.selected.map((filing) => filing.rceptNo).filter(Boolean);
    const changedReasons = [
      requireCategory && !observedCategories.includes(requireCategory) ? `category_missing:${requireCategory}` : null,
      requireReceipt && !selectedReceipts.includes(requireReceipt) ? `receipt_missing:${requireReceipt}` : null,
      requireLongExtraction && pipeline.llmDump.extractedLongCount < 1 ? 'long_extraction_missing' : null,
    ].filter(Boolean);
    const status = changedReasons.length > 0 ? 'skipped' : 'passed';
    const result = {
      status,
      ...(changedReasons.length > 0 ? { reason: 'historical_case_changed', changedReasons } : {}),
      requested: { code, from, to, selectionLimit, documentLimit, maxTotalChars },
      observed: {
        collectionState: pipeline.collection.state,
        providerTotalCount: pipeline.collection.providerTotalCount,
        collectedCount: pipeline.collection.collectedCount,
        canonicalRecordCount: pipeline.collection.canonicalRecordCount,
        selectedCount: pipeline.analysis.count,
        includedCount: pipeline.llmDump.includedCount,
        extractedLongCount: pipeline.llmDump.extractedLongCount,
        combinedCharCount: pipeline.llmDump.combinedCharCount,
        categories: observedCategories,
        selectedReceipts,
      },
      pipeline,
    };
    writeArtifact(outputPath, result, [secret]);
    console.log(JSON.stringify({ status, ...(result.reason ? { reason: result.reason } : {}), artifact: outputPath, observed: result.observed }));
    process.exitCode = status === 'passed' ? 0 : 2;
  } catch (error) {
    const externalCodes = new Set([
      'provider_unconfigured',
      'provider_timeout',
      'provider_request_failed',
      'provider_http_error',
      'provider_status_error',
      'corp_not_found',
    ]);
    const external = externalCodes.has(error?.code);
    const result = {
      status: external ? 'skipped' : 'failed',
      reason: external ? 'upstream_unavailable' : 'contract_assertion_failed',
      requested: { code, from, to, selectionLimit, documentLimit, maxTotalChars },
      error: { code: error?.code ?? null, message: error?.message ?? String(error) },
    };
    writeArtifact(outputPath, result, [secret]);
    console.error(JSON.stringify({ status: result.status, reason: result.reason, artifact: outputPath }));
    process.exitCode = external ? 2 : 1;
  }
}
