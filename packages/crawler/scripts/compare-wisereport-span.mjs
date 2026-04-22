import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const outputPath = path.join(repoRoot, 'docs', 'wisereport-kr-span-regression.json');
const samples = [
  { code: '005930', page: 'company-overview', url: 'https://comp.wisereport.co.kr/company/c1020001.aspx?cmp_cd=005930&cn=&menuType=block' },
  { code: '003280', page: 'company-overview', url: 'https://comp.wisereport.co.kr/company/c1020001.aspx?cmp_cd=003280&cn=&menuType=block' },
  { code: '035420', page: 'company-overview', url: 'https://comp.wisereport.co.kr/company/c1020001.aspx?cmp_cd=035420&cn=&menuType=block' },
];
const tableSpecs = [
  { key: 'workforce', selector: '#cTB205_2', headerRows: 2 },
  { key: 'salesComposition', selector: '#cTB206', headerRows: 2 },
];

const normalizeText = (value) => String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

function uniqueHeaders(headers) {
  const counts = new Map();
  return headers.map((header, index) => {
    const base = normalizeText(header) || `column_${index + 1}`;
    const current = counts.get(base) || 0;
    counts.set(base, current + 1);
    return current === 0 ? base : `${base}_${current + 1}`;
  });
}

function rowsToRecords(headers, rows) {
  const normalizedHeaders = uniqueHeaders(headers);
  return rows.map((row) => Object.fromEntries(normalizedHeaders.map((header, index) => [header, row[index] ?? ''])));
}

function compactHeaderParts(parts) {
  const deduped = [];
  for (const part of parts) {
    const normalized = normalizeText(part);
    if (!normalized || deduped[deduped.length - 1] === normalized) {
      continue;
    }
    deduped.push(normalized);
  }
  return deduped;
}

function formatHeaderLabel(parts, fallback) {
  const normalizedParts = compactHeaderParts(parts);
  if (!normalizedParts.length) {
    return fallback;
  }
  if (normalizedParts.length === 1) {
    return normalizedParts[0];
  }
  if (normalizedParts.length === 2) {
    const [parent, child] = normalizedParts;
    if (/^\(.+\)$/.test(child)) {
      return `${parent}${child}`;
    }
    return `${parent}(${child})`;
  }
  return normalizedParts.join(' / ');
}

function recordsFromRowsLegacy(rows, headerRows = 1) {
  const headerMatrix = rows.slice(0, headerRows);
  const headerCount = Math.max(0, ...headerMatrix.map((row) => row.length));
  const headers = Array.from({ length: headerCount }, (_, columnIndex) => headerMatrix
    .map((row) => normalizeText(row[columnIndex]))
    .filter(Boolean)
    .join(' / ') || `column_${columnIndex + 1}`);
  const bodyRows = rows.slice(headerRows).filter((row) => row.some((cell) => normalizeText(cell)));
  return {
    headers,
    rows: rowsToRecords(headers, bodyRows),
    rowCount: bodyRows.length,
  };
}

function recordsFromRowsSpanAware(rows, headerRows = 1) {
  const headerMatrix = rows.slice(0, headerRows);
  const headerCount = Math.max(0, ...headerMatrix.map((row) => row.length));
  const headers = Array.from({ length: headerCount }, (_, columnIndex) => formatHeaderLabel(
    headerMatrix
      .map((row) => row[columnIndex])
      .filter((cell) => normalizeText(cell)),
    `column_${columnIndex + 1}`,
  ));
  const bodyRows = rows.slice(headerRows).filter((row) => row.some((cell) => normalizeText(cell)));
  return {
    headers,
    rows: rowsToRecords(headers, bodyRows),
    rowCount: bodyRows.length,
  };
}

async function captureTable(page, selector) {
  return page.locator(selector).evaluate((table) => {
    const clean = (value) => String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    const rawRows = Array.from(table.rows || []).map((row) => Array.from(row.cells || []).map((cell) => clean(cell.innerText || cell.textContent || '')));
    const grid = [];
    Array.from(table.rows || []).forEach((row, rowIndex) => {
      if (!grid[rowIndex]) {
        grid[rowIndex] = [];
      }
      let columnIndex = 0;
      Array.from(row.cells || []).forEach((cell) => {
        while (grid[rowIndex][columnIndex] !== undefined) {
          columnIndex += 1;
        }
        const text = clean(cell.innerText || cell.textContent || '');
        const colspan = Math.max(1, Number(cell.getAttribute('colspan')) || cell.colSpan || 1);
        const rowspan = Math.max(1, Number(cell.getAttribute('rowspan')) || cell.rowSpan || 1);
        for (let rowOffset = 0; rowOffset < rowspan; rowOffset += 1) {
          if (!grid[rowIndex + rowOffset]) {
            grid[rowIndex + rowOffset] = [];
          }
          for (let columnOffset = 0; columnOffset < colspan; columnOffset += 1) {
            grid[rowIndex + rowOffset][columnIndex + columnOffset] = text;
          }
        }
        columnIndex += colspan;
      });
    });
    const columnCount = Math.max(0, ...grid.map((row) => row.length));
    const spanAwareRows = grid.map((row) => Array.from({ length: columnCount }, (_, index) => clean(row[index] || '')));
    return { rawRows, spanAwareRows };
  });
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const output = {
  generatedAt: new Date().toISOString(),
  samples: [],
};

try {
  for (const sample of samples) {
    await page.goto(sample.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#cTB205_2', { state: 'attached', timeout: 10000 });
    await page.waitForTimeout(1200);

    const tables = {};
    for (const tableSpec of tableSpecs) {
      const locator = page.locator(tableSpec.selector);
      const count = await locator.count();
      if (!count) {
        tables[tableSpec.key] = null;
        continue;
      }
      const captured = await captureTable(page, tableSpec.selector);
      const legacy = recordsFromRowsLegacy(captured.rawRows, tableSpec.headerRows);
      const fixed = recordsFromRowsSpanAware(captured.spanAwareRows, tableSpec.headerRows);
      tables[tableSpec.key] = {
        legacy: {
          headers: legacy.headers,
          firstRows: legacy.rows.slice(0, 4),
          rowCount: legacy.rowCount,
        },
        fixed: {
          headers: fixed.headers,
          firstRows: fixed.rows.slice(0, 4),
          rowCount: fixed.rowCount,
        },
      };
    }

    output.samples.push({
      code: sample.code,
      page: sample.page,
      tables,
    });
  }
} finally {
  await context.close();
  await browser.close();
}

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(output, null, 2));
