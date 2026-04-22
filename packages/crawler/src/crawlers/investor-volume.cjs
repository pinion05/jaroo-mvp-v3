const krxClient = require('./krx-client.cjs');

/**
 * 투자자별 거래량(개인/외국인/기관) 조회 (krx-js-client)
 * @param {string} ticker - 종목코드 (예: '005930')
 * @param {string} startDate - 시작일 (YYYYMMDD)
 * @param {string} endDate - 종료일 (YYYYMMDD)
 * @returns {Promise<Array>} [{ date, individual, foreigner, institution }]
 */
async function getInvestorVolume(ticker, startDate, endDate) {
    try {
        return await krxClient.getInvestorVolume(ticker, startDate, endDate);
    } catch (err) {
        console.error(`⚠️ [InvestorVolume] Failed to fetch investor volume: ${err.message}`);
        throw err;
    }
}

module.exports = { getInvestorVolume };
