/**
 * us-ownership-flow.js — 미국주식 ownership/flow 요약
 *
 * - direct ownership/flow source: SEC submissions filing activity
 * - focuses on direct disclosure activity rather than peer proxy context
 */

import { getUSFilings } from './us-sec-filings.js';

const OWNERSHIP_FLOW_FILING_TYPES = Object.freeze([
  '3',
  '4',
  '5',
  'SC 13D',
  'SC 13D/A',
  'SC 13G',
  'SC 13G/A',
]);

function isIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function filingTimestamp(filing = {}) {
  const candidate = filing.filedDate ?? filing.acceptedDate ?? filing.reportDate;
  if (isIsoDate(candidate)) {
    const timestamp = Date.parse(`${candidate}T00:00:00Z`);
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  if (typeof candidate === 'string') {
    const timestamp = Date.parse(candidate);
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  return null;
}

function latestDate(values = []) {
  return values
    .filter(isIsoDate)
    .sort((a, b) => b.localeCompare(a))[0] ?? null;
}

export function summarizeOwnershipFlowFromFilings(filings = [], opts = {}) {
  const recentDays = Number.isInteger(opts.recentDays) && opts.recentDays > 0 ? opts.recentDays : 180;
  const now = typeof opts.now === 'string' ? Date.parse(opts.now) : Date.now();
  const lookbackStart = Number.isFinite(now) ? now - (recentDays * 24 * 60 * 60 * 1000) : null;

  const normalized = Array.isArray(filings)
    ? filings
      .filter((filing) => filing && typeof filing === 'object')
      .map((filing) => ({
        type: typeof filing.type === 'string' ? filing.type : null,
        filedDate: typeof filing.filedDate === 'string' ? filing.filedDate : null,
        acceptedDate: typeof filing.acceptedDate === 'string' ? filing.acceptedDate : null,
        title: typeof filing.title === 'string' ? filing.title : null,
        url: typeof filing.url === 'string' ? filing.url : null,
        source: typeof filing.source === 'string' ? filing.source : null,
      }))
      .filter((filing) => filing.type && OWNERSHIP_FLOW_FILING_TYPES.includes(filing.type))
    : [];

  const recent = lookbackStart === null
    ? normalized
    : normalized.filter((filing) => {
      const timestamp = filingTimestamp(filing);
      return timestamp !== null && timestamp >= lookbackStart;
    });

  const insiderFilings = recent.filter((filing) => ['3', '4', '5'].includes(filing.type));
  const beneficialFilings = recent.filter((filing) => ['SC 13D', 'SC 13D/A', 'SC 13G', 'SC 13G/A'].includes(filing.type));

  const totalDirectEvents = insiderFilings.length + beneficialFilings.length;
  const direction = totalDirectEvents > 0
    ? insiderFilings.length > 0 && beneficialFilings.length > 0
      ? 'mixed-direct-flow'
      : insiderFilings.length > 0
        ? 'insider-flow-active'
        : 'beneficial-ownership-active'
    : 'quiet';

  return {
    source: 'sec-submissions',
    recentDays,
    signal: {
      status: totalDirectEvents > 0 ? 'active' : 'quiet',
      direction,
      summary: totalDirectEvents > 0
        ? `최근 ${recentDays}일 ownership/flow 공시 ${totalDirectEvents}건`
        : `최근 ${recentDays}일 direct ownership/flow 공시 없음`,
    },
    counts: {
      totalDirectEvents,
      insiderForms: insiderFilings.length,
      beneficialOwnershipForms: beneficialFilings.length,
    },
    latestDates: {
      latestEvent: latestDate(recent.map((filing) => filing.filedDate)),
      insider: latestDate(insiderFilings.map((filing) => filing.filedDate)),
      beneficialOwnership: latestDate(beneficialFilings.map((filing) => filing.filedDate)),
    },
    filings: recent.slice(0, 6),
  };
}

/**
 * 미국주식 ownership/flow direct filing activity 요약
 * @param {string} ticker
 * @param {Object} [opts]
 * @param {number} [opts.limit=12]
 * @param {number} [opts.recentDays=180]
 * @param {string} [opts.now]
 * @returns {Promise<Object>}
 */
export async function getUSOwnershipFlow(ticker, opts = {}) {
  const normalizedTicker = String(ticker ?? '').trim().toUpperCase();
  const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 12;
  const recentDays = Number.isInteger(opts.recentDays) && opts.recentDays > 0 ? opts.recentDays : 180;

  if (!normalizedTicker) {
    return {
      ticker: null,
      source: 'sec-submissions',
      recentDays,
      recentFilings: [],
      summary: summarizeOwnershipFlowFromFilings([], { recentDays, now: opts.now }),
      meta: {
        status: 'missing',
        reason: 'ticker_required',
      },
    };
  }

  const filings = await getUSFilings(normalizedTicker, {
    limit: Math.max(limit, 12),
    filingTypes: [...OWNERSHIP_FLOW_FILING_TYPES],
  }).catch(() => null);

  const recentFilings = Array.isArray(filings?.recentFilings)
    ? filings.recentFilings.slice(0, limit).map((filing) => ({
      type: filing.type ?? null,
      filedDate: filing.filedDate ?? null,
      acceptedDate: filing.acceptedDate ?? null,
      title: filing.title ?? null,
      url: filing.url ?? null,
      source: filing.source ?? null,
      priority: filing.priority ?? null,
    }))
    : [];

  const summary = summarizeOwnershipFlowFromFilings(recentFilings, { recentDays, now: opts.now });

  return {
    ticker: normalizedTicker,
    source: 'sec-submissions',
    recentDays,
    recentFilings,
    summary,
    meta: {
      status: recentFilings.length > 0 ? 'ok' : 'missing',
      requestedLimit: limit,
      count: recentFilings.length,
      filingTypes: [...OWNERSHIP_FLOW_FILING_TYPES],
      primarySource: 'sec-edgar',
    },
  };
}
