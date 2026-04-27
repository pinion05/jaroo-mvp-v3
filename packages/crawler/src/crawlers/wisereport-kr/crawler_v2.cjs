const {
  annotateTableAvailability,
  findTableById,
  findTablesByClass,
  keyValueRowsFromTable,
  measureCompleteness,
  parseCompanyFromTitle,
  recordsFromTable,
  selectCapturedResponses,
  summarizeCapturedResponses,
} = require('./helpers.cjs');

function buildBase({ spec, code, capture }) {
  return {
    company: {
      ...parseCompanyFromTitle(capture.title, code),
      headerText: capture.company?.headerText || null,
    },
    sourceType: spec.sourceType,
    sourceKey: spec.sourceKey,
    bodyTextHead: capture.bodyTextHead,
  };
}

function collectIframeTables(v1) {
  return (v1?.source?.iframes || [])
    .flatMap((frame, index) => {
      const tables = frame?.content?.tables || [];
      return tables.map((table) => ({
        ...table,
        __source: 'iframe',
        __frameIndex: index,
        __frameName: frame?.name || null,
        __frameUrl: frame?.url || null,
      }));
    });
}

function makeTableMatch(source, table) {
  if (!table) return null;
  return {
    source,
    table,
    sourceDetail: {
      tableId: table.id || null,
      className: table.className || null,
      frameName: table.__frameName || null,
      frameUrl: table.__frameUrl || null,
    },
  };
}

function findPreferredTableById(domTables, iframeTables, id) {
  return makeTableMatch('dom', findTableById(domTables, id)) || makeTableMatch('iframe', findTableById(iframeTables, id));
}

function findPreferredTableByClass(domTables, iframeTables, classFragment, predicate = null) {
  const select = (tables, source) => {
    const matched = findTablesByClass(tables, classFragment).find((table) => (predicate ? predicate(table) : true));
    return makeTableMatch(source, matched);
  };
  return select(domTables, 'dom') || select(iframeTables, 'iframe');
}

function findPreferredTableByIndex(domTables, iframeTables, index) {
  return makeTableMatch('dom', domTables[index]) || makeTableMatch('iframe', iframeTables[index]);
}

function candidate(field, source, value, sourceDetail = {}) {
  if (value == null) {
    return null;
  }
  return {
    field,
    source,
    sourceDetail,
    completeness: measureCompleteness(value),
    value,
  };
}

function candidateFromTable(field, match, parser, parserOptions = null) {
  if (!match?.table) {
    return null;
  }
  const parsed = parserOptions == null ? parser(match.table) : parser(match.table, parserOptions);
  return candidate(field, match.source, parsed, match.sourceDetail);
}

function pairsFromTableCells(table) {
  if (!table) {
    return null;
  }
  const rows = Array.isArray(table.rows) ? table.rows : [];
  return {
    tableId: table.id,
    className: table.className,
    rows: rows
      .flatMap((row) => {
        const pairs = [];
        for (let index = 0; index < row.length; index += 2) {
          const key = row[index];
          const value = row[index + 1];
          if (key || value) {
            pairs.push({ key, value });
          }
        }
        return pairs;
      })
      .filter((row) => row.key || row.value),
  };
}

function firstParsedJsonResponse(responses, pattern) {
  return selectCapturedResponses(responses, pattern).find((response) => response.parsedBody && typeof response.parsedBody === 'object');
}

function compactCandidates(candidateMap) {
  return Object.fromEntries(Object.entries(candidateMap)
    .map(([field, candidates]) => [field, (candidates || []).filter(Boolean)])
    .filter(([, candidates]) => candidates.length > 0));
}

function runCrawlerV2Stage({ spec, code, v1 }) {
  const capture = v1?.capture || { title: '', bodyTextHead: '', tables: [] };
  const domTables = capture.tables || [];
  const iframeTables = collectIframeTables(v1);
  const capturedResponses = v1?.source?.capturedResponses || [];
  const base = buildBase({ spec, code, capture });

  const byId = (id) => findPreferredTableById(domTables, iframeTables, id);
  const byClass = (classFragment, predicate = null) => findPreferredTableByClass(domTables, iframeTables, classFragment, predicate);
  const byIndex = (index) => findPreferredTableByIndex(domTables, iframeTables, index);

  let candidates = {};

  switch (spec.id) {
    case 'company-overview':
      candidates = {
        profile: [candidateFromTable('profile', byId('cTB201'), keyValueRowsFromTable)],
        recentHistory: [candidateFromTable('recentHistory', byId('cTB202'), recordsFromTable)],
        productMix: [candidateFromTable('productMix', byId('cTB203'), recordsFromTable)],
        marketShare: [candidateFromTable('marketShare', byId('cTB204'), recordsFromTable)],
        researchAndDevelopment: [candidateFromTable('researchAndDevelopment', byId('cTB205_1'), recordsFromTable)],
        workforce: [candidateFromTable('workforce', byId('cTB205_2'), recordsFromTable, 2)],
        salesComposition: [(() => {
          const match = byId('cTB206');
          if (!match) return null;
          const parsed = annotateTableAvailability(recordsFromTable(match.table, 2), {
            keyColumnCount: 2,
            source: match.source,
            emptyNote: 'The salesComposition value cells were empty in the upstream WiseReport page source for this capture.',
          });
          return candidate('salesComposition', match.source, parsed, match.sourceDetail);
        })()],
        bondsAndCp: [candidateFromTable('bondsAndCp', byId('cTB209'), recordsFromTable)],
        capitalChanges: [candidateFromTable('capitalChanges', byId('cTB210'), recordsFromTable)],
      };
      break;
    case 'financial-analysis':
      candidates = {
        statementTabs: [candidateFromTable('statementTabs', byId('cTB301'), recordsFromTable)],
        formulaDefinitions: [candidateFromTable(
          'formulaDefinitions',
          byClass('all-width', (table) => table.rows?.[0]?.[0] === '분류'),
          recordsFromTable,
        )],
        financialStatements: [candidateFromTable(
          'financialStatements',
          byClass('gHead01 all-width data-list', (table) => (table.rows?.[0] || []).includes('항목')),
          recordsFromTable,
        )],
      };
      break;
    case 'investment-indicators':
      candidates = {
        indicatorTabs: [candidateFromTable('indicatorTabs', byId('cTB401'), recordsFromTable)],
        formulaDefinitions: [candidateFromTable('formulaDefinitions', byId('draggable-table-body'), recordsFromTable)],
        metrics: [candidate(
          'metrics',
          'dom',
          [...findTablesByClass(domTables, 'gHead01 all-width data-list'), ...findTablesByClass(iframeTables, 'gHead01 all-width data-list')]
            .filter((table) => (table.rows?.[0] || []).includes('항목'))
            .map((table) => recordsFromTable(table)),
        )],
      };
      break;
    case 'consensus':
      candidates = {
        annualOrQuarterly: [candidateFromTable('annualOrQuarterly', byId('cTB501'), recordsFromTable)],
        consensusSummary: [candidateFromTable('consensusSummary', byId('cTB511'), recordsFromTable)],
        consensusTrend: [candidateFromTable('consensusTrend', byId('cTB512'), recordsFromTable)],
        earningsSurprise: [candidateFromTable('earningsSurprise', byId('cTB513'), recordsFromTable, 2)],
        ajaxEvidence: [candidate('ajaxEvidence', 'network', summarizeCapturedResponses(selectCapturedResponses(capturedResponses, /c1050001_data/i)), { pattern: 'c1050001_data' })],
      };
      break;
    case 'shareholding':
      candidates = {
        ownershipSummary: [candidateFromTable('ownershipSummary', byId('cTB711'), recordsFromTable, 2)],
        ownershipTabs: [candidateFromTable('ownershipTabs', byId('cTB712'), recordsFromTable)],
        majorShareholders: [candidateFromTable('majorShareholders', byId('cTB713_1'), recordsFromTable)],
        shareholderChanges: [candidateFromTable('shareholderChanges', byId('cTB714'), recordsFromTable)],
      };
      break;
    case 'recent-reports':
      candidates = {
        recentReports: [candidateFromTable('recentReports', byId('tableCmpDetail'), recordsFromTable)],
        pagination: [candidateFromTable('pagination', byClass('pagingTable'), recordsFromTable)],
        ajaxEvidence: [candidate('ajaxEvidence', 'network', summarizeCapturedResponses(selectCapturedResponses(capturedResponses, /c1080001_data/i)), { pattern: 'c1080001_data' })],
      };
      break;
    case 'fnguide-finance':
      candidates = {
        annualIncomeStatement: [candidateFromTable('annualIncomeStatement', byIndex(0), recordsFromTable)],
        quarterlyIncomeStatement: [candidateFromTable('quarterlyIncomeStatement', byIndex(1), recordsFromTable)],
        annualBalanceSheet: [candidateFromTable('annualBalanceSheet', byIndex(2), recordsFromTable)],
        quarterlyBalanceSheet: [candidateFromTable('quarterlyBalanceSheet', byIndex(3), recordsFromTable)],
        annualCashFlow: [candidateFromTable('annualCashFlow', byIndex(4), recordsFromTable)],
        quarterlyCashFlow: [candidateFromTable('quarterlyCashFlow', byIndex(5), recordsFromTable)],
      };
      break;
    case 'relative-return': {
      const jsonResponse = firstParsedJsonResponse(capturedResponses, /json\/chart\/01_01/i);
      candidates = {
        chartJson: [candidate('chartJson', 'network', jsonResponse?.parsedBody, { url: jsonResponse?.url || null })],
        popupTable: [candidateFromTable('popupTable', byIndex(0), recordsFromTable)],
      };
      break;
    }
    case 'opinion':
      candidates = {
        performanceAndConsensus: [candidateFromTable('performanceAndConsensus', byIndex(0), recordsFromTable)],
        estimateHistory: [candidateFromTable('estimateHistory', byIndex(1), recordsFromTable)],
        analystOpinions: [candidateFromTable('analystOpinions', byIndex(2), recordsFromTable, 2)],
        reportSummaries: [candidateFromTable('reportSummaries', byIndex(3), recordsFromTable)],
      };
      break;
    case 'style-analysis': {
      const jsonResponse = firstParsedJsonResponse(capturedResponses, /json\/chart\/05_05/i);
      candidates = {
        factorScores: [candidate('factorScores', 'network', jsonResponse?.parsedBody, { url: jsonResponse?.url || null })],
        popupTable: [candidateFromTable('popupTable', byIndex(0), recordsFromTable)],
      };
      break;
    }
    case 'fnguide-snapshot':
      candidates = {
        marketSnapshot: [candidateFromTable(
          'marketSnapshot',
          byClass('us_table_ty1', (table) => table.caption === '시세현황' || /외국인\s*지분율/.test((table.rows || []).flat().join(' '))),
          pairsFromTableCells,
        )],
        assetManagerHoldings: [candidateFromTable(
          'assetManagerHoldings',
          byClass('us_table_ty1', (table) => table.caption === '운용사별 보유 현황' || /운용사명/.test((table.rows || [])[0]?.join(' ') || '')),
          recordsFromTable,
        )],
        snapshotMajorShareholders: [candidateFromTable(
          'snapshotMajorShareholders',
          byClass('us_table_ty1', (table) => /항목/.test((table.rows || [])[0]?.join(' ') || '') && /보통주/.test((table.rows || [])[0]?.join(' ') || '') && /지분율/.test((table.rows || [])[0]?.join(' ') || '')),
          recordsFromTable,
        )],
        shareholderCategories: [candidateFromTable(
          'shareholderCategories',
          byClass('us_table_ty1', (table) => /주주구분/.test((table.rows || [])[0]?.join(' ') || '') && /대표주주수|대표 주주수/.test((table.rows || [])[0]?.join(' ') || '')),
          recordsFromTable,
        )],
      };
      break;
    case 'fnguide-shareanalysis': {
      const detailJson = firstParsedJsonResponse(capturedResponses, /json\/data\/01_09_01/i);
      const changesJson = firstParsedJsonResponse(capturedResponses, /json\/data\/01_09_02/i);
      candidates = {
        shareholderCategories: [candidateFromTable('shareholderCategories', byId('dataTable'), recordsFromTable)],
        shareholderDetails: [candidateFromTable('shareholderDetails', byId('sharedetailtable'), recordsFromTable)],
        shareholderChanges: [candidateFromTable(
          'shareholderChanges',
          byClass('us_table_ty1', (table) => table.caption === '주주변동내역' || /변동주주/.test((table.rows || [])[0]?.join(' ') || '')),
          recordsFromTable,
        )],
        shareholderDetailsJson: [candidate('shareholderDetailsJson', 'network', detailJson?.parsedBody, { url: detailJson?.url || null })],
        shareholderChangesJson: [candidate('shareholderChangesJson', 'network', changesJson?.parsedBody, { url: changesJson?.url || null })],
      };
      break;
    }
    case 'fnguide-foreign-ownership-chart': {
      const jsonResponse = firstParsedJsonResponse(capturedResponses, /json\/chart\/01_01/i);
      candidates = {
        chartJson: [candidate('chartJson', 'network', jsonResponse?.parsedBody, { url: jsonResponse?.url || null })],
        popupTable: [candidateFromTable('popupTable', byIndex(0), recordsFromTable)],
      };
      break;
    }
    default:
      candidates = {
        tables: [candidate('tables', 'dom', domTables.map((table) => recordsFromTable(table)))],
      };
      break;
  }

  const compacted = compactCandidates(candidates);
  const flatCandidates = Object.values(compacted).flat();
  const iframeCandidateCount = flatCandidates.filter((item) => item.source === 'iframe').length;
  const networkCandidateCount = flatCandidates.filter((item) => item.source === 'network').length;

  return {
    ok: true,
    base,
    candidates: compacted,
    extractionMeta: {
      candidateFieldCount: Object.keys(compacted).length,
      iframeCandidateCount,
      networkCandidateCount,
      totalCandidateCount: flatCandidates.length,
      iframeTableCount: iframeTables.length,
    },
  };
}

module.exports = {
  runCrawlerV2Stage,
};
