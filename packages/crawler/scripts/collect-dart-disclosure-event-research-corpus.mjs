import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { getDartDisclosureDocumentText } from '../src/crawlers/dart-filings.js';

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_BODY_CHARS = 60_000;
const DEFAULT_ATTEMPTS_PER_TEMPLATE = 3;

function parseArgs(argv) {
  return Object.fromEntries(argv.map((argument) => {
    const [key, ...rest] = argument.replace(/^--/u, '').split('=');
    return [key, rest.length > 0 ? rest.join('=') : 'true'];
  }));
}

function positiveInteger(value, fallback, maximum) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : fallback;
}

function normalizeTemplateTitle(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/^\[(?:기재정정|첨부정정|첨부추가|변경등록|연장결정|발행조건확정|정정제출요구)\]/u, '')
    .replace(/\s*\(20\d{2}\.\d{2}\)\s*$/u, '')
    .replaceAll(/\s+/gu, '')
    .trim();
}

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

function buildTemplateGroups(audit, { includeAmbiguousRecords }) {
  const groups = new Map();
  for (const detailResult of audit.results ?? []) {
    for (const sample of detailResult.samples ?? []) {
      const templateTitle = normalizeTemplateTitle(sample.reportName);
      const key = `${detailResult.detailType}|${templateTitle}`;
      const candidate = {
        ...sample,
        detailType: detailResult.detailType,
        detailTypeLabel: detailResult.detailTypeLabel,
        detailMode: detailResult.detailMode,
        templateTitle,
      };
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(candidate);
    }
  }
  const templateGroups = [...groups.entries()].map(([key, candidates]) => ({ key, candidates }));
  const ambiguousGroups = [];
  if (includeAmbiguousRecords) {
    for (const detailResult of audit.results ?? []) {
      for (const sample of detailResult.samples ?? []) {
        if (!sample.needsClassifier) continue;
        ambiguousGroups.push({
          key: `ambiguous-record:${sample.rceptNo}`,
          candidates: [{
            ...sample,
            detailType: detailResult.detailType,
            detailTypeLabel: detailResult.detailTypeLabel,
            detailMode: detailResult.detailMode,
            templateTitle: normalizeTemplateTitle(sample.reportName),
          }],
        });
      }
    }
  }
  return {
    groups: [...templateGroups, ...ambiguousGroups],
    uniqueTemplateCount: templateGroups.length,
    ambiguousRecordCount: ambiguousGroups.length,
  };
}

function serializeError(error) {
  return {
    code: String(error?.code ?? 'document_fetch_failed'),
    message: String(error?.message ?? 'document fetch failed'),
    providerStatus: error?.details?.providerStatus ?? null,
  };
}

async function fetchTemplateDocument(group, options) {
  const failures = [];
  for (const sample of group.candidates.slice(0, options.attemptsPerTemplate)) {
    try {
      const document = await getDartDisclosureDocumentText(sample.rceptNo, {
        timeoutMs: options.timeoutMs,
      });
      const bodyText = document.text.slice(0, options.bodyChars);
      return {
        key: group.key,
        input: {
          rceptNo: sample.rceptNo,
          receiptDate: sample.receiptDate,
          reportName: sample.reportName,
          remarks: sample.remarks,
          corpName: sample.corpName,
          stockCode: sample.stockCode,
          corpClass: sample.corpClass,
          disclosureType: sample.disclosureType,
          disclosureDetailType: sample.disclosureDetailType,
          bodyText,
        },
        provenance: {
          detailTypeLabel: sample.detailTypeLabel,
          detailMode: sample.detailMode,
          templateTitle: sample.templateTitle,
          bodySource: document.source,
          bodyCharCount: document.charCount,
          retainedBodyCharCount: [...bodyText].length,
          bodyTruncated: document.charCount > [...bodyText].length,
          fileCount: document.fileCount,
          attemptedReceiptCount: failures.length + 1,
        },
        fetchFailures: failures,
      };
    } catch (error) {
      failures.push({ rceptNo: sample.rceptNo, ...serializeError(error) });
    }
  }

  const sample = group.candidates[0];
  return {
    key: group.key,
    input: {
      rceptNo: sample.rceptNo,
      receiptDate: sample.receiptDate,
      reportName: sample.reportName,
      remarks: sample.remarks,
      corpName: sample.corpName,
      stockCode: sample.stockCode,
      corpClass: sample.corpClass,
      disclosureType: sample.disclosureType,
      disclosureDetailType: sample.disclosureDetailType,
      bodyText: null,
    },
    provenance: {
      detailTypeLabel: sample.detailTypeLabel,
      detailMode: sample.detailMode,
      templateTitle: sample.templateTitle,
      bodySource: null,
      bodyCharCount: 0,
      retainedBodyCharCount: 0,
      bodyTruncated: false,
      fileCount: 0,
      attemptedReceiptCount: failures.length,
    },
    fetchFailures: failures,
  };
}

const args = parseArgs(process.argv.slice(2));
if (!args.audit) throw new Error('--audit is required');

const auditPath = resolve(args.audit);
const outputPath = resolve(args.out ?? '.omx/context/dart-disclosure-event-research-corpus.json');
const concurrency = positiveInteger(args.concurrency, DEFAULT_CONCURRENCY, 10);
const bodyChars = positiveInteger(args['body-chars'], DEFAULT_BODY_CHARS, 500_000);
const attemptsPerTemplate = positiveInteger(
  args['attempts-per-template'],
  DEFAULT_ATTEMPTS_PER_TEMPLATE,
  10,
);
const timeoutMs = positiveInteger(args['timeout-ms'], 20_000, 120_000);
const audit = JSON.parse(await readFile(auditPath, 'utf8'));
const includeAmbiguousRecords = args['include-ambiguous-records'] === 'true';
const selection = buildTemplateGroups(audit, { includeAmbiguousRecords });
const groups = selection.groups;
const cases = await mapConcurrent(groups, concurrency, (group) => fetchTemplateDocument(group, {
  attemptsPerTemplate,
  bodyChars,
  timeoutMs,
}));
const availableCases = cases.filter((entry) => entry.input.bodyText);
const artifact = {
  schemaVersion: 'jaroo.kr-disclosure-event-research-corpus.v1',
  generatedAt: new Date().toISOString(),
  auditPath,
  query: {
    ...audit.query,
    templateCount: selection.uniqueTemplateCount,
    ambiguousRecordCount: selection.ambiguousRecordCount,
    concurrency,
    bodyChars,
    attemptsPerTemplate,
    includeAmbiguousRecords,
  },
  summary: {
    observedRecordCount: audit.summary?.observedSampleCount ?? null,
    uniqueTemplateCount: selection.uniqueTemplateCount,
    ambiguousRecordCount: selection.ambiguousRecordCount,
    researchCaseCount: groups.length,
    bodyAvailableCount: availableCases.length,
    bodyUnavailableCount: cases.length - availableCases.length,
    uniqueCompanyCount: new Set(cases.map((entry) => entry.input.corpName).filter(Boolean)).size,
    retainedBodyCharCount: availableCases.reduce(
      (total, entry) => total + entry.provenance.retainedBodyCharCount,
      0,
    ),
  },
  cases,
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ outputPath, ...artifact.summary }, null, 2));
