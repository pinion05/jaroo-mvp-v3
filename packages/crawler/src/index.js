import { createRequire } from 'node:module';
import {
  WISEREPORT_GLOBAL_ROUTES,
  crawlWiseReportGlobal,
  crawlWiseReportGlobalDomainData,
  extractWiseReportGlobalDomainData,
  normalizeWiseReportGlobalCmpCode,
  formatWiseReportGlobalDomainTsv,
} from './crawlers/wisereport-global.js';
import {
  getIndexPrevClose,
  getIndexSMA,
  getUSMarketIndicators,
} from './crawlers/us-market-indicators.js';
import {
  getCurrentQuotes,
} from './crawlers/current-quotes.js';

const require = createRequire(import.meta.url);

const { WISEREPORT_KR_PAGES, crawlWiseReportKr, crawlWiseReportKrPage, getCrawl, crawlMarketData } = require('./crawlers/wisereport-kr.cjs');
const { fetchUsdKrwRate, formatRateData } = require('./crawlers/usd-krw-rate.cjs');
const {
  SOURCES,
  fetchVkospi,
  fetchAdr,
  fetchUsVix,
  fetchAllMarketIndicators,
  parseVkospiText,
  parseAdrText,
  parseUsVixText,
} = require('./crawlers/market-indicators.cjs');
const { getStockData, getKrx, getIndexData } = require('./crawlers/stock-data.cjs');
const { getInvestorVolume } = require('./crawlers/investor-volume.cjs');
const {
  getOhlcv,
  getIndexOhlcv,
  getMarketSnapshot,
  getMarketCap,
  getTickerNames,
  getNearestBusinessDay,
  getNearestBusinessDayInAWeek,
  runTriggerBatch,
} = require('./crawlers/krx-client.cjs');

export {
  polygonFetch,
  fmpFetch,
  finnhubFetch,
  secEdgarFetch,
  getProviderStatus,
  clearCache,
  getCacheStats,
} from './crawlers/api-clients.js';

export {
  getFinancialStatementsFMP,
  getFinancialStatementsPolygon,
  getFinancialStatementsFinnhub,
  getFinancialStatements,
  getKeyMetrics,
  getFinancialRatios,
  getUSFinancials,
} from './crawlers/us-financials.js';

export {
  getCompanyProfile,
  getPriceTargetConsensus,
  getAnalystEstimates,
  getAnalystRecommendations,
  getStockRating,
  getEarningsCalendar,
  getFinnhubEarningsHistory,
  getUSConsensus,
} from './crawlers/us-consensus.js';

export {
  getPolygonNews,
  getFinnhubNews,
  getNewsSentiment,
  getUSNews,
} from './crawlers/us-news.js';

export {
  FILING_TYPES,
  getFilings,
  getKeyFilings,
  getCompanyFacts,
  getCompanyFactsTaxonomies,
  getCompanyFactsTaxonomyConcepts,
  getCompanyFactsConcept,
  getUSFilings,
} from './crawlers/us-sec-filings.js';

export {
  getUSStockReportData,
} from './crawlers/us-stock-report.js';

export {
  buildJarooDeepScanPayload,
} from './services/deepscan-payload.js';

export {
  SOURCES,
  WISEREPORT_GLOBAL_ROUTES,
  WISEREPORT_KR_PAGES,
  crawlWiseReportKr,
  crawlWiseReportKrPage,
  getCrawl,
  crawlMarketData,
  fetchUsdKrwRate,
  formatRateData,
  fetchVkospi,
  fetchAdr,
  fetchUsVix,
  fetchAllMarketIndicators,
  parseVkospiText,
  parseAdrText,
  parseUsVixText,
  getStockData,
  getKrx,
  getIndexData,
  getInvestorVolume,
  getOhlcv,
  getIndexOhlcv,
  getMarketSnapshot,
  getMarketCap,
  getTickerNames,
  getNearestBusinessDay,
  getNearestBusinessDayInAWeek,
  runTriggerBatch,
  crawlWiseReportGlobal,
  crawlWiseReportGlobalDomainData,
  extractWiseReportGlobalDomainData,
  normalizeWiseReportGlobalCmpCode,
  formatWiseReportGlobalDomainTsv,
  getIndexPrevClose,
  getIndexSMA,
  getUSMarketIndicators,
  getCurrentQuotes,
};
