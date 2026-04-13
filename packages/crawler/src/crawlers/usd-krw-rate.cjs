/**
 * USD/KRW 환율 크롤러
 * investing.com에서 오늘 환율과 변동률 추출
 */

function getPlaywrightChromium() {
  return require('playwright').chromium;
}

const USD_KRW_URL = 'https://kr.investing.com/currencies/usd-krw';

/**
 * USD/KRW 환율 데이터 추출
 * @returns {Promise<{rate: number, change: number, changePercent: number, timestamp: string}>}
 */
async function fetchUsdKrwRate() {
  let browser;
  try {
    const chromium = getPlaywrightChromium();
    browser = await chromium.launch({
      headless: true
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 }
    });

    const page = await context.newPage();

    await page.goto(USD_KRW_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    // 데이터 로딩 대기
    await page.waitForSelector('[data-test="instrument-price-last"]', { timeout: 10000 });

    // 환율 데이터 추출
    const data = await page.evaluate(() => {
      const rateEl = document.querySelector('[data-test="instrument-price-last"]');
      const changeEl = document.querySelector('[data-test="instrument-price-change"]');
      const changePercentEl = document.querySelector('[data-test="instrument-price-change-percent"]');
      const timeEl = document.querySelector('[data-test="trading-time-label"]');

      const parseNumber = (str) => {
        if (!str) return null;
        // 괄호, 쉼표, +, % 제거하고 숫자로 변환
        return parseFloat(str.replace(/[(),+%]/g, '').replace(/,/g, ''));
      };

      return {
        rate: parseNumber(rateEl?.textContent || ''),
        change: parseNumber(changeEl?.textContent || ''),
        changePercent: parseNumber(changePercentEl?.textContent || ''),
        timestamp: timeEl?.getAttribute('datetime') || new Date().toISOString(),
        raw: {
          rate: rateEl?.textContent?.trim(),
          change: changeEl?.textContent?.trim(),
          changePercent: changePercentEl?.textContent?.trim()
        }
      };
    });

    return data;
  } catch (error) {
    console.error('환율 데이터 추출 실패:', error.message);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * 환율 데이터 포맷팅
 */
function formatRateData(data) {
  if (!data.rate) {
    return '환율 데이터를 가져올 수 없습니다.';
  }

  const direction = data.change >= 0 ? '▲' : '▼';
  const sign = data.change >= 0 ? '+' : '';

  return `
USD/KRW 환율 정보
================
현재 환율: ${data.rate.toLocaleString()} 원
변동: ${direction} ${sign}${data.change.toFixed(2)} (${sign}${data.changePercent.toFixed(2)}%)
기준 시각: ${data.timestamp}
`.trim();
}

// CLI 실행
if (require.main === module) {
  fetchUsdKrwRate()
    .then(data => {
      console.log(formatRateData(data));
      console.log('\n--- Raw Data ---');
      console.log(JSON.stringify(data, null, 2));
    })
    .catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
}

module.exports = { fetchUsdKrwRate, formatRateData };
