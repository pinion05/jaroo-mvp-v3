const MAX_CAPTURED_RESPONSE_CHARS = 24000;

function normalizeText(value) {
  return String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function limitText(value, maxLength = MAX_CAPTURED_RESPONSE_CHARS) {
  const text = String(value ?? '');
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function sanitizeLabel(label, fallback = 'value') {
  const normalized = normalizeText(label);
  return normalized || fallback;
}

function uniqueHeaders(headers) {
  const counts = new Map();
  return headers.map((header, index) => {
    const base = sanitizeLabel(header, `column_${index + 1}`);
    const current = counts.get(base) || 0;
    counts.set(base, current + 1);
    return current === 0 ? base : `${base}_${current + 1}`;
  });
}

function rowsToRecords(headers, rows) {
  return rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])));
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

function dedupeConsecutiveValues(values) {
  const deduped = [];
  for (const value of values || []) {
    const normalized = normalizeText(value);
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
    if (parent.includes(child)) {
      return parent;
    }
    if (/^\(.+\)$/.test(child)) {
      return `${parent}${child}`;
    }
    return `${parent}(${child})`;
  }
  return normalizedParts.join(' / ');
}

function findTableById(tables, id) {
  return (tables || []).find((table) => table.id === id) || null;
}

function findTablesByClass(tables, classFragment) {
  return (tables || []).filter((table) => String(table.className || '').includes(classFragment));
}

function recordsFromTable(table, headerRows = 1) {
  if (!table) {
    return null;
  }
  const rows = Array.isArray(table.rows) ? table.rows : [];
  const headerMatrix = rows.slice(0, headerRows);
  const headerCount = Math.max(...headerMatrix.map((row) => row.length), 0);
  const headers = Array.from({ length: headerCount }, (_, columnIndex) => formatHeaderLabel(
    headerMatrix
      .map((row) => row[columnIndex])
      .filter((cell) => normalizeText(cell)),
    `column_${columnIndex + 1}`,
  ));
  const normalizedHeaders = uniqueHeaders(headers);
  const bodyRows = rows.slice(headerRows).filter((row) => row.some((cell) => normalizeText(cell)));
  return {
    tableId: table.id,
    className: table.className,
    headerRows: headerMatrix.map((row) => dedupeConsecutiveValues(row)),
    headers: normalizedHeaders,
    rows: rowsToRecords(normalizedHeaders, bodyRows),
    rowCount: bodyRows.length,
  };
}

function keyValueRowsFromTable(table) {
  if (!table) {
    return null;
  }
  const pairs = [];
  for (const row of table.rows.slice(1)) {
    for (let index = 0; index < row.length; index += 2) {
      const key = normalizeText(row[index]);
      const value = normalizeText(row[index + 1]);
      if (key) {
        pairs.push({ key, value });
      }
    }
  }
  return pairs;
}

function annotateTableAvailability(table, options = {}) {
  if (!table) {
    return null;
  }
  const headers = Array.isArray(table.headers) ? table.headers : [];
  const rows = Array.isArray(table.rows) ? table.rows : [];
  const keyColumnCount = Math.max(0, options.keyColumnCount || 0);
  const valueHeaders = headers.slice(keyColumnCount);
  const emptyValueHeaders = valueHeaders.filter((header) => rows.every((row) => !normalizeText(row?.[header])));
  const hasAnyValueCell = valueHeaders.some((header) => rows.some((row) => normalizeText(row?.[header])));
  return {
    ...table,
    dataAvailability: {
      source: options.source || 'dom',
      keyHeaders: headers.slice(0, keyColumnCount),
      valueHeaders,
      emptyValueHeaders,
      hasAnyValueCell,
      status: hasAnyValueCell ? 'present' : 'source-empty',
      note: hasAnyValueCell
        ? null
        : (options.emptyNote || 'Value cells were empty in the upstream page source for this capture.'),
    },
  };
}

function parseCompanyFromTitle(title, code) {
  const normalizedTitle = normalizeText(title);
  if (!normalizedTitle) {
    return { code };
  }

  let name = normalizedTitle;
  const wisereportMatch = normalizedTitle.match(/^(.+?)\s*-\s*.+$/);
  const fnguideMatch = normalizedTitle.match(/^(.+?)\(A?\d{6}\)/);
  if (fnguideMatch) {
    name = fnguideMatch[1];
  } else if (wisereportMatch) {
    name = wisereportMatch[1];
  }

  return {
    name: normalizeText(name),
    code,
    title: normalizedTitle,
  };
}

function selectCapturedResponses(responses, pattern) {
  return (responses || []).filter((response) => pattern.test(response.url));
}

function summarizeCapturedResponses(responses) {
  return (responses || []).map((response) => ({
    url: response.url,
    status: response.status,
    resourceType: response.resourceType,
    contentType: response.contentType,
    bodyType: response.bodyType,
    parsedBodyKeys: response.parsedBody && typeof response.parsedBody === 'object' && !Array.isArray(response.parsedBody)
      ? Object.keys(response.parsedBody).slice(0, 12)
      : null,
    textLength: typeof response.bodyText === 'string' ? response.bodyText.length : null,
  }));
}

function measureCompleteness(value) {
  if (value == null) {
    return 0;
  }
  if (Array.isArray(value)) {
    return value.reduce((sum, item) => sum + measureCompleteness(item), 0);
  }
  if (typeof value === 'object') {
    return Object.values(value).reduce((sum, item) => sum + measureCompleteness(item), 0);
  }
  return normalizeText(value) ? 1 : 0;
}

module.exports = {
  MAX_CAPTURED_RESPONSE_CHARS,
  normalizeText,
  limitText,
  sanitizeLabel,
  uniqueHeaders,
  rowsToRecords,
  compactHeaderParts,
  dedupeConsecutiveValues,
  formatHeaderLabel,
  findTableById,
  findTablesByClass,
  recordsFromTable,
  keyValueRowsFromTable,
  annotateTableAvailability,
  parseCompanyFromTitle,
  selectCapturedResponses,
  summarizeCapturedResponses,
  measureCompleteness,
};
