const krxClient = require('./krx-client.cjs');
const logger = require('../utils/logger.cjs');

/**
 * krx-js-client를 이용해 주가 데이터를 조회합니다.
 * @param {string} ticker - 종목코드 (예: '005930')
 * @param {string} startDate - 시작일 (YYYYMMDD)
 * @param {string} endDate - 종료일 (YYYYMMDD)
 * @returns {Promise<Array>} - OHLCV 데이터 배열
 */
async function getStockData(ticker, startDate, endDate) {
    logger.start('KRX', `주가 데이터 수집 | Code: ${ticker}`);
    try {
        return await krxClient.getOhlcv(ticker, startDate, endDate);
    } catch (err) {
        logger.error('KRX', `주가 데이터 실패 | ${err.message}`);
        throw err;
    }
}

// 의미 명확화를 위한 별칭
const getKrx = getStockData;

async function getIndexData(indexCode, startDate, endDate) {
    logger.start('KRX', `지수 데이터 수집 | Code: ${indexCode}`);
    try {
        return await krxClient.getIndexOhlcv(indexCode, startDate, endDate);
    } catch (err) {
        logger.error('KRX', `지수 데이터 실패 | ${err.message}`);
        throw err;
    }
}

module.exports = { getStockData, getKrx, getIndexData };
