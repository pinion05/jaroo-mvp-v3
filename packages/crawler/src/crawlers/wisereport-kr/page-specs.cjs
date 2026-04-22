function compactArray(values) {
  return values.filter(Boolean);
}

const KR_WISEREPORT_PAGE_SPECS = Object.freeze([
  {
    id: 'company-overview',
    legacyKey: 'companyOverview',
    sourceKey: 'wisereport기업개요',
    sourceType: 'wisereport',
    title: '기업개요',
    url: (code) => `https://comp.wisereport.co.kr/company/c1020001.aspx?cmp_cd=${code}&cn=&menuType=block`,
    waitForSelectors: ['#cTB201', '#cTB202'],
  },
  {
    id: 'financial-analysis',
    legacyKey: 'financialAnalysis',
    sourceKey: 'wisereport재무분석',
    sourceType: 'wisereport',
    title: '재무분석',
    url: (code) => `https://comp.wisereport.co.kr/company/c1030001.aspx?cmp_cd=${code}&cn=&menuType=block`,
    waitForSelectors: ['#cTB301', '.gHead01.all-width.data-list'],
  },
  {
    id: 'investment-indicators',
    legacyKey: 'investmentIndicators',
    sourceKey: 'wisereport투자지표',
    sourceType: 'wisereport',
    title: '투자지표',
    url: (code) => `https://comp.wisereport.co.kr/company/c1040001.aspx?cmp_cd=${code}&cn=&menuType=block`,
    waitForSelectors: ['#draggable-table-body', '#cTB401'],
  },
  {
    id: 'consensus',
    legacyKey: 'consensus',
    sourceKey: 'wisereport컨센서스',
    sourceType: 'wisereport',
    title: '컨센서스',
    url: (code) => `https://comp.wisereport.co.kr/company/c1050001.aspx?cmp_cd=${code}&cn=&menuType=block`,
    waitForSelectors: ['#cTB511', '#cTB512'],
  },
  {
    id: 'shareholding',
    legacyKey: 'shareholding',
    sourceKey: 'wisereport지분현황',
    sourceType: 'wisereport',
    title: '지분현황',
    url: (code) => `https://comp.wisereport.co.kr/company/c1070001.aspx?cmp_cd=${code}&cn=&menuType=block`,
    waitForSelectors: ['#cTB711', '#cTB713_1'],
  },
  {
    id: 'recent-reports',
    legacyKey: 'recentReports',
    sourceKey: 'wisereport최근리포트',
    sourceType: 'wisereport',
    title: '최근리포트',
    url: (code) => `https://comp.wisereport.co.kr/company/c1080001.aspx?cmp_cd=${code}&cn=&menuType=block`,
    waitForSelectors: ['#tableCmpDetail'],
  },
  {
    id: 'fnguide-finance',
    legacyKey: 'fnguideFinance',
    sourceKey: 'fnguide재무제표',
    sourceType: 'fnguide',
    title: '재무제표',
    url: (code) => `https://comp.fnguide.com/SVO2/ASP/SVD_Finance.asp?pGB=1&gicode=A${code}&cID=AA&MenuYn=Y&ReportGB=&NewMenuID=103&stkGb=701`,
    waitForSelectors: ['table.us_table_ty1'],
  },
  {
    id: 'relative-return',
    legacyKey: 'relativeReturn',
    sourceKey: 'fnguide상대수익률',
    sourceType: 'fnguide',
    title: '상대수익률',
    url: (code) => `https://comp.fnguide.com/SVO2/common/chartListPopup2.asp?oid=topChart01&cid=01_01&gicode=A${code}&filter=D&term=Y&etc=3Y&etc2=1`,
    waitForSelectors: ['#chartDataGrid table', 'table.us_table_ty2'],
  },
  {
    id: 'opinion',
    legacyKey: 'opinion',
    sourceKey: 'fnguide투자의견',
    sourceType: 'fnguide',
    title: '투자의견',
    url: (code) => `https://comp.fnguide.com/SVO2/ASP/SVD_Consensus.asp?pGB=1&gicode=A${code}&cID=AA&MenuYn=Y&ReportGB=&NewMenuID=108&stkGb=701`,
    waitForSelectors: ['table.us_table_ty1'],
  },
  {
    id: 'style-analysis',
    legacyKey: 'styleAnalysis',
    sourceKey: 'fnguide스타일분석',
    sourceType: 'fnguide',
    title: '스타일분석',
    url: (code) => `https://comp.fnguide.com/SVO2/common/chartListPopup2.asp?oid=div5_img&cid=05_05&gicode=A${code}&filter=D&term=Y&etc=0&etc2=0&titleTxt=%EB%A9%80%ED%8B%B0%ED%8C%A9%ED%84%B0%20%EC%8A%A4%ED%83%80%EC%9D%BC%20%EB%B6%84%EC%84%9D&dateTxt=undefined&unitTxt=`,
    waitForSelectors: ['#chartDataGrid table', 'table.us_table_ty2'],
  },
]);

const WISEREPORT_KR_PAGES = Object.freeze(KR_WISEREPORT_PAGE_SPECS.map((spec) => ({
  id: spec.id,
  legacyKey: spec.legacyKey,
  sourceKey: spec.sourceKey,
  title: spec.title,
  sourceType: spec.sourceType,
})));

const PAGE_MAP = new Map(KR_WISEREPORT_PAGE_SPECS.flatMap((page) => compactArray([
  [page.id, page],
  [page.legacyKey, page],
  [page.sourceKey, page],
])));

function getPageSpec(routeRef) {
  return PAGE_MAP.get(routeRef) || null;
}

module.exports = {
  KR_WISEREPORT_PAGE_SPECS,
  WISEREPORT_KR_PAGES,
  PAGE_MAP,
  getPageSpec,
};
