function compactArray(values) {
  return values.filter(Boolean);
}

const KR_WISEREPORT_PAGE_SPECS = Object.freeze([
  {
    id: 'company-overview',
    legacyKey: 'companyOverview',
    sourceKey: 'wisereport기업개요',
    sourceType: 'wisereport',
    checkedSourceId: 'wisereport.company-overview',
    title: '기업개요',
    url: (code) => `https://comp.wisereport.co.kr/company/c1020001.aspx?cmp_cd=${code}&cn=&menuType=block`,
    waitForSelectors: ['#cTB201', '#cTB202'],
  },
  {
    id: 'financial-analysis',
    legacyKey: 'financialAnalysis',
    sourceKey: 'wisereport재무분석',
    sourceType: 'wisereport',
    checkedSourceId: 'wisereport.financial-analysis',
    title: '재무분석',
    url: (code) => `https://comp.wisereport.co.kr/company/c1030001.aspx?cmp_cd=${code}&cn=&menuType=block`,
    waitForSelectors: ['#cTB301', '.gHead01.all-width.data-list'],
  },
  {
    id: 'investment-indicators',
    legacyKey: 'investmentIndicators',
    sourceKey: 'wisereport투자지표',
    sourceType: 'wisereport',
    checkedSourceId: 'wisereport.investment-indicators',
    title: '투자지표',
    url: (code) => `https://comp.wisereport.co.kr/company/c1040001.aspx?cmp_cd=${code}&cn=&menuType=block`,
    waitForSelectors: ['#draggable-table-body', '#cTB401'],
  },
  {
    id: 'consensus',
    legacyKey: 'consensus',
    sourceKey: 'wisereport컨센서스',
    sourceType: 'wisereport',
    checkedSourceId: 'wisereport.consensus',
    title: '컨센서스',
    url: (code) => `https://comp.wisereport.co.kr/company/c1050001.aspx?cmp_cd=${code}&cn=&menuType=block`,
    waitForSelectors: ['#cTB511', '#cTB512'],
  },
  {
    id: 'shareholding',
    legacyKey: 'shareholding',
    sourceKey: 'wisereport지분현황',
    sourceType: 'wisereport',
    checkedSourceId: 'wisereport.shareholding',
    title: '지분현황',
    url: (code) => `https://comp.wisereport.co.kr/company/c1070001.aspx?cmp_cd=${code}&cn=&menuType=block`,
    waitForSelectors: ['#cTB711', '#cTB713_1'],
  },
  {
    id: 'recent-reports',
    legacyKey: 'recentReports',
    sourceKey: 'wisereport최근리포트',
    sourceType: 'wisereport',
    checkedSourceId: 'wisereport.recent-reports',
    title: '최근리포트',
    url: (code) => `https://comp.wisereport.co.kr/company/c1080001.aspx?cmp_cd=${code}&cn=&menuType=block`,
    waitForSelectors: ['#tableCmpDetail'],
  },
  {
    id: 'fnguide-finance',
    legacyKey: 'fnguideFinance',
    sourceKey: 'fnguide재무제표',
    sourceType: 'fnguide',
    checkedSourceId: 'fnguide.finance',
    title: '재무제표',
    url: (code) => `https://comp.fnguide.com/SVO2/ASP/SVD_Finance.asp?pGB=1&gicode=A${code}&cID=AA&MenuYn=Y&ReportGB=&NewMenuID=103&stkGb=701`,
    waitForSelectors: ['table.us_table_ty1'],
  },
  {
    id: 'relative-return',
    legacyKey: 'relativeReturn',
    sourceKey: 'fnguide상대수익률',
    sourceType: 'fnguide',
    checkedSourceId: 'fnguide.relative-return',
    title: '상대수익률',
    url: (code) => `https://comp.fnguide.com/SVO2/common/chartListPopup2.asp?oid=topChart01&cid=01_01&gicode=A${code}&filter=D&term=Y&etc=3Y&etc2=1`,
    waitForSelectors: ['#chartDataGrid table', 'table.us_table_ty2'],
  },
  {
    id: 'opinion',
    legacyKey: 'opinion',
    sourceKey: 'fnguide투자의견',
    sourceType: 'fnguide',
    checkedSourceId: 'fnguide.opinion',
    title: '투자의견',
    url: (code) => `https://comp.fnguide.com/SVO2/ASP/SVD_Consensus.asp?pGB=1&gicode=A${code}&cID=AA&MenuYn=Y&ReportGB=&NewMenuID=108&stkGb=701`,
    waitForSelectors: ['table.us_table_ty1'],
  },
  {
    id: 'style-analysis',
    legacyKey: 'styleAnalysis',
    sourceKey: 'fnguide스타일분석',
    sourceType: 'fnguide',
    checkedSourceId: 'fnguide.style-analysis',
    title: '스타일분석',
    url: (code) => `https://comp.fnguide.com/SVO2/common/chartListPopup2.asp?oid=div5_img&cid=05_05&gicode=A${code}&filter=D&term=Y&etc=0&etc2=0&titleTxt=%EB%A9%80%ED%8B%B0%ED%8C%A9%ED%84%B0%20%EC%8A%A4%ED%83%80%EC%9D%BC%20%EB%B6%84%EC%84%9D&dateTxt=undefined&unitTxt=`,
    waitForSelectors: ['#chartDataGrid table', 'table.us_table_ty2'],
  },
]);

const KR_WISEREPORT_V12_EXTRA_PAGE_SPECS = Object.freeze([
  {
    id: 'fnguide-snapshot',
    legacyKey: 'fnguideSnapshot',
    sourceKey: 'fnguide스냅샷',
    sourceType: 'fnguide',
    checkedSourceId: 'fnguide.snapshot',
    title: '스냅샷',
    url: (code) => `https://comp.fnguide.com/SVO2/ASP/SVD_Main.asp?pGB=1&gicode=A${code}&cID=AA&MenuYn=Y&ReportGB=&NewMenuID=101&stkGb=701`,
    waitForSelectors: ['table.us_table_ty1', '#svdMainChart12'],
  },
  {
    id: 'fnguide-shareanalysis',
    legacyKey: 'fnguideShareAnalysis',
    sourceKey: 'fnguide지분분석',
    sourceType: 'fnguide',
    checkedSourceId: 'fnguide.shareanalysis',
    title: '지분분석',
    url: (code) => `https://comp.fnguide.com/SVO2/ASP/SVD_shareanalysis.asp?pGB=1&gicode=A${code}&cID=AA&MenuYn=Y&ReportGB=&NewMenuID=109&stkGb=701`,
    waitForSelectors: ['#dataTable', '#sharedetailtable'],
  },
  {
    id: 'fnguide-foreign-ownership-chart',
    legacyKey: 'fnguideForeignOwnershipChart',
    sourceKey: 'fnguide외국인지분율차트',
    sourceType: 'fnguide',
    checkedSourceId: 'fnguide.foreign-ownership-chart',
    title: '외국인 지분율 차트',
    url: (code) => `https://comp.fnguide.com/SVO2/common/chartListPopup2.asp?oid=topChart02&cid=01_01&gicode=A${code}&filter=D&term=Y&etc=3M&etc2=2&titleTxt=&dateTxt=&unitTxt=`,
    waitForSelectors: ['#chartDataGrid table', '#chartDataGrid'],
  },
]);

const KR_WISEREPORT_V12_PAGE_SPECS = Object.freeze([
  ...KR_WISEREPORT_PAGE_SPECS,
  ...KR_WISEREPORT_V12_EXTRA_PAGE_SPECS,
]);

function assertUniqueCheckedSourceIds(pageSpecs) {
  const seen = new Set();

  for (const spec of pageSpecs) {
    if (typeof spec.checkedSourceId !== 'string' || !spec.checkedSourceId.trim()) {
      throw new Error(`KR page spec ${spec.id} is missing checkedSourceId`);
    }
    if (seen.has(spec.checkedSourceId)) {
      throw new Error(`Duplicate KR checkedSourceId: ${spec.checkedSourceId}`);
    }
    seen.add(spec.checkedSourceId);
  }
}

function getCheckedSourceIds(pageSpecs, pageIds = null) {
  const wantedPageIds = Array.isArray(pageIds) ? new Set(pageIds) : null;
  const selectedSpecs = wantedPageIds
    ? pageSpecs.filter((spec) => wantedPageIds.has(spec.id))
    : pageSpecs;

  if (wantedPageIds && selectedSpecs.length !== wantedPageIds.size) {
    const foundIds = new Set(selectedSpecs.map((spec) => spec.id));
    const missingIds = [...wantedPageIds].filter((pageId) => !foundIds.has(pageId));
    throw new Error(`Unknown KR page ids for checked source derivation: ${missingIds.join(', ')}`);
  }

  assertUniqueCheckedSourceIds(selectedSpecs);
  return selectedSpecs.map((spec) => spec.checkedSourceId);
}

function getWiseReportKrCheckedSourceIds(pageIds = null) {
  return getCheckedSourceIds(KR_WISEREPORT_PAGE_SPECS, pageIds);
}

function getWiseReportKrV12CheckedSourceIds(pageIds = null) {
  return getCheckedSourceIds(KR_WISEREPORT_V12_PAGE_SPECS, pageIds);
}

const WISEREPORT_KR_PAGES = Object.freeze(KR_WISEREPORT_PAGE_SPECS.map((spec) => ({
  id: spec.id,
  legacyKey: spec.legacyKey,
  sourceKey: spec.sourceKey,
  title: spec.title,
  sourceType: spec.sourceType,
})));

const WISEREPORT_KR_V12_PAGES = Object.freeze(KR_WISEREPORT_V12_PAGE_SPECS.map((spec) => ({
  id: spec.id,
  legacyKey: spec.legacyKey,
  sourceKey: spec.sourceKey,
  title: spec.title,
  sourceType: spec.sourceType,
})));

assertUniqueCheckedSourceIds(KR_WISEREPORT_V12_PAGE_SPECS);

const WISEREPORT_KR_CHECKED_SOURCE_IDS = Object.freeze(getWiseReportKrCheckedSourceIds());
const WISEREPORT_KR_V12_CHECKED_SOURCE_IDS = Object.freeze(getWiseReportKrV12CheckedSourceIds());

const PAGE_MAP = new Map(KR_WISEREPORT_V12_PAGE_SPECS.flatMap((page) => compactArray([
  [page.id, page],
  [page.legacyKey, page],
  [page.sourceKey, page],
])));

function getPageSpec(routeRef) {
  return PAGE_MAP.get(routeRef) || null;
}

module.exports = {
  KR_WISEREPORT_PAGE_SPECS,
  KR_WISEREPORT_V12_EXTRA_PAGE_SPECS,
  KR_WISEREPORT_V12_PAGE_SPECS,
  WISEREPORT_KR_PAGES,
  WISEREPORT_KR_V12_PAGES,
  WISEREPORT_KR_CHECKED_SOURCE_IDS,
  WISEREPORT_KR_V12_CHECKED_SOURCE_IDS,
  getCheckedSourceIds,
  getWiseReportKrCheckedSourceIds,
  getWiseReportKrV12CheckedSourceIds,
  PAGE_MAP,
  getPageSpec,
};
