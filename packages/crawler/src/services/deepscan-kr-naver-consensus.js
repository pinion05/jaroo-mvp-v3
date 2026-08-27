// 네이버 증권 컨센서스 폴백 수집기(이슈: 삼성전자 등 주요 종목의 목표주가 수집 실패).
//
// 배경: 2026-08-27 기준 fnguide 투자의견 페이지(SVD_Consensus.asp)가 에러 페이지
// ("페이지가 없습니다")로 응답해 KR 컨센서스 스냅샷이 전종목 not_provided가 됐다.
// 네이버 증권은 동일 출처(에프앤가이드 제공) 데이터를 계속 제공하므로 이 모듈이
// 보조 소스로 목표주가·투자의견을 회수한다.
//
// 폴백 체인 (2026-08-28 v2 — 미공식 API 이동 이력 대비 3중):
//   1차) stock.naver.com 신규 JSON API /api/domestic/detail/{code}/consensus (순수 JSON)
//   2차) m.stock.naver.com getOverallInfo.nhn (경량 HTML, 약 24KB)
//   3차) finance.naver.com/item/main.naver (무겁지만 구조 고정적)
//
// 증권사별 최신 목표가 집계(최고/최저/증권사 수)는 researches/v2/company를 사용한다.
// 우선순위는 호출측(getCrawlV12)에서 제어한다: fnguide opinion이 정상이면 원본을 그대로 쓰고,
// 실패했을 때만 본 모듈 결과를 합성 행으로 주입한다.

const CONSENSUS_REPORT_WINDOW_DAYS = 90;

function extractNumberWithComma(text) {
  const cleaned = text.replace(/,/g, '').trim();
  if (!/^\d+(\.\d+)?$/.test(cleaned)) {
    return null;
  }
  const numeric = Number(cleaned);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function naverJsonHeaders() {
  return { 'User-Agent': 'Mozilla/5.0', Referer: 'https://stock.naver.com/' };
}

async function fetchWithTimeout(url, headers, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** 1차: 신규 stock.naver.com JSON API — 순수 JSON이라 가장 안정적 */
async function fetchNaverConsensusApi(code, timeoutMs = 6000) {
  try {
    const response = await fetchWithTimeout(
      `https://stock.naver.com/api/domestic/detail/${encodeURIComponent(code)}/consensus`,
      naverJsonHeaders(),
      timeoutMs,
    );
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    const targetPrice = data && typeof data.targetPrice === 'string'
      ? extractNumberWithComma(data.targetPrice)
      : null;
    const score = data && typeof data.opinion === 'string' && data.opinion.trim()
      ? Number(data.opinion)
      : null;
    const asOfText = data && typeof data.date === 'string' && data.date.length === 8
      ? `${data.date.slice(0, 4)}.${data.date.slice(4, 6)}.${data.date.slice(6, 8)}`
      : null;

    if (targetPrice === null) {
      return null;
    }

    return {
      score: Number.isFinite(score) ? score : null,
      opinionLabel: null,
      targetPrice,
      asOfText,
    };
  } catch {
    return null;
  }
}

/** 2차: m.stock 경량 HTML (모바일 전용, 약 24KB, 기준일 포함) */
async function fetchNaverMStockOverall(code, timeoutMs = 8000) {
  try {
    const response = await fetchWithTimeout(
      `https://m.stock.naver.com/api/html/item/getOverallInfo.nhn?code=${encodeURIComponent(code)}`,
      { 'User-Agent': 'Mozilla/5.0', Referer: 'https://m.stock.naver.com/' },
      timeoutMs,
    );
    if (!response.ok) {
      return null;
    }
    const html = await response.text();

    // 컨센서스 점수: graph_data 툴팁 span (범례 뒤 실측값, 예: <span class="data_lyr">4.04</span>)
    const scoreMatch = html.match(/_graph_data[^>]*>\s*<span[^>]*>([\d.]+)</);
    const targetMatch = html.match(/목표주가[^<]*(?:<[^>]+>\s*)*<em[^>]*>([\d,.]+)/);
    const asOfMatch = html.match(/(\d{4}\.\d{2}\.\d{2})\s*기준/);

    const targetPrice = targetMatch ? extractNumberWithComma(targetMatch[1]) : null;
    if (targetPrice === null || !scoreMatch) {
      return null;
    }

    return {
      score: Number(scoreMatch[1]),
      opinionLabel: null,
      targetPrice,
      asOfText: asOfMatch ? asOfMatch[1] : null,
    };
  } catch {
    return null;
  }
}

/** 3차: 네이버 금융 메인 HTML (크지만 구조 고정적) */
async function fetchNaverMainOpinion(code, timeoutMs = 10000) {
  try {
    const response = await fetchWithTimeout(
      `https://finance.naver.com/item/main.naver?code=${encodeURIComponent(code)}`,
      { 'User-Agent': 'Mozilla/5.0' },
      timeoutMs,
    );
    if (!response.ok) {
      return null;
    }
    const html = await response.text();
    const anchorIndex = html.indexOf('summary="투자의견 정보"');
    if (anchorIndex < 0) {
      return null;
    }
    const block = html.slice(anchorIndex, anchorIndex + 2500);

    const scoreMatch = block.match(/<em[^>]*>(\d+(?:\.\d+)?)<\/em>\s*(매수|중립|매도|비중축소|보유)/);
    if (!scoreMatch) {
      return null;
    }

    const ems = [];
    const emRegex = /<em[^>]*>([\d,.]+)<\/em>/g;
    let match;
    while ((match = emRegex.exec(block)) !== null) {
      ems.push(extractNumberWithComma(match[1]));
    }
    if (ems.length < 2 || !ems[1]) {
      return null;
    }

    return {
      score: Number(scoreMatch[1]),
      opinionLabel: scoreMatch[2],
      targetPrice: ems[1],
      asOfText: null,
    };
  } catch {
    return null;
  }
}

/**
 * 증권사별 최신 목표가 집계 — researches/v2/company 리포트 목록에서
 * 최근 90일 리포트의 증권사별 최신 goalPrice를 모아 최고/최저/증권사 수를 계산한다.
 * 페이지당 50건씩 최대 200건(약 1년치)까지 훑는다.
 */
async function fetchNaverBrokerTargetStats(code, timeoutMs = 12000) {
  try {
    const cutoff = new Date(Date.now() - CONSENSUS_REPORT_WINDOW_DAYS * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const latestByBroker = new Map();
    let exhausted = false;

    for (let offset = 0; offset < 200 && !exhausted; offset += 50) {
      const response = await fetchWithTimeout(
        `https://stock.naver.com/api/stockSecurity/researches/v2/company?itemCodes=${encodeURIComponent(code)}&index=${offset}&size=50`,
        naverJsonHeaders(),
        timeoutMs,
      );
      if (!response.ok) {
        break;
      }
      const data = await response.json();
      const items = Array.isArray(data) ? data : data.items ?? [];
      if (items.length === 0) {
        break;
      }
      let withinWindow = 0;
      for (const item of items) {
        const writeDate = typeof item?.writeDate === 'string' ? item.writeDate : '';
        if (!writeDate || writeDate < cutoff) {
          continue;
        }
        withinWindow += 1;
        const goal = typeof item.goalPrice === 'string' || typeof item.goalPrice === 'number'
          ? extractNumberWithComma(String(item.goalPrice))
          : null;
        const broker = typeof item.brokerName === 'string' && item.brokerName.trim()
          ? item.brokerName.trim()
          : null;
        if (goal === null || !broker) {
          continue;
        }
        const prev = latestByBroker.get(broker);
        if (!prev || prev.writeDate < writeDate) {
          latestByBroker.set(broker, { goalPrice: goal, writeDate });
        }
      }
      if (withinWindow === 0) {
        exhausted = true;
      }
    }

    if (latestByBroker.size === 0) {
      return { analystCount: 0, highestTargetPrice: null, lowestTargetPrice: null, averageTargetPrice: null };
    }

    const goals = [...latestByBroker.values()].map((entry) => entry.goalPrice);
    return {
      analystCount: latestByBroker.size,
      highestTargetPrice: goals.length > 1 ? Math.max(...goals) : null,
      lowestTargetPrice: goals.length > 1 ? Math.min(...goals) : null,
      averageTargetPrice: Math.round(goals.reduce((sum, value) => sum + value, 0) / goals.length),
    };
  } catch {
    return null;
  }
}

/**
 * fnguide opinion이 실패(행 0개)했을 때 네이버 폴백 데이터를 합성 행으로 만든다.
 * 행 구조는 readTargetPriceFromRow/extractRecommendation이 인식하는 키를 사용한다.
 * fnguide가 정상이면(null 반환 없음) 호출측에서 이 함수를 쓰지 않는다.
 */
async function buildNaverConsensusSyntheticRow(code) {
  const fallback = (await fetchNaverConsensusApi(code))
    ?? (await fetchNaverMStockOverall(code))
    ?? (await fetchNaverMainOpinion(code));
  if (!fallback || fallback.targetPrice === null) {
    return null;
  }

  const brokerStats = await fetchNaverBrokerTargetStats(code);

  return {
    sourceLabel: 'naver-fallback',
    asOfText: fallback.asOfText,
    targetPrice: fallback.targetPrice,
    추정기관: 'consensus',
    '투자의견(점수)': fallback.score ?? null,
    ...(fallback.opinionLabel ? { 투자의견: fallback.opinionLabel } : {}),
    ...(brokerStats && brokerStats.analystCount > 0
      ? {
          최고목표주가: brokerStats.highestTargetPrice,
          최저목표주가: brokerStats.lowestTargetPrice,
          증권사수: brokerStats.analystCount,
        }
      : {}),
    rows: [{ '투자의견(점수)': fallback.score ?? null, 목표주가: fallback.targetPrice }],
  };
}

export {
  fetchNaverConsensusApi,
  fetchNaverMStockOverall,
  fetchNaverMainOpinion,
  fetchNaverBrokerTargetStats,
  buildNaverConsensusSyntheticRow,
};
