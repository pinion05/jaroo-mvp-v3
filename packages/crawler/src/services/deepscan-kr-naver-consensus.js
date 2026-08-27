// 네이버 증권 컨센서스 폴백 수집기(이슈: 삼성전자 등 주요 종목의 목표주가 수집 실패).
//
// 배경: 2026-08-27 기준 fnguide 투자의견 페이지(SVD_Consensus.asp)가 에러 페이지
// ("페이지가 없습니다")로 응답해 KR 컨센서스 스냅샷이 전종목 not_provided가 됐다.
// 네이버 증권은 동일 출처(에프앤가이드 제공) 데이터를 메인 HTML과 m.stock API로
// 계속 제공하므로, 이 모듈이 보조 소스로 목표주가·투자의견을 회수한다.
//
// 우선순위는 호출측(buildDeepScanKrEvidencePacket)에서 제어한다:
// fnguide opinion이 정상이면 원본을 그대로 쓰고, 실패했을 때만 본 모듈 결과를 합성 행으로 주입.

function extractNumberWithComma(text) {
  const cleaned = text.replace(/,/g, '').trim();
  if (!/^\d+(\.\d+)?$/.test(cleaned)) {
    return null;
  }
  const numeric = Number(cleaned);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

/** m.stock 경량 HTML (1차 선호 — 모바일 전용, 약 24KB, 기준일 포함) */
async function fetchNaverMStockOverall(code, timeoutMs = 8000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(
      `https://m.stock.naver.com/api/html/item/getOverallInfo.nhn?code=${encodeURIComponent(code)}`,
      {
        headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://m.stock.naver.com/' },
        signal: controller.signal,
      },
    );
    clearTimeout(timer);
    if (!response.ok) {
      return null;
    }
    const html = await response.text();

    // 컨센서스 점수: graph_data 툴팁 em (범례 뒤 실측값, 예: <span class="data_lyr">4.04</span>)
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

/** 네이버 금융 메인 HTML (2차 백업 — 크지만 구조 고정적) */
async function fetchNaverMainOpinion(code, timeoutMs = 10000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(`https://finance.naver.com/item/main.naver?code=${encodeURIComponent(code)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: controller.signal,
    });
    clearTimeout(timer);
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
 * fnguide opinion이 실패(행 0개)했을 때 네이버 폴백 데이터를 합성 행으로 만든다.
 * 행 구조는 readTargetPriceFromRow/extractRecommendation이 인식하는 키를 사용한다.
 * fnguide가 정상이면(null 반환 없음) 호출측에서 이 함수를 쓰지 않는다.
 */
async function buildNaverConsensusSyntheticRow(code) {
  const fallback = (await fetchNaverMStockOverall(code)) ?? (await fetchNaverMainOpinion(code));
  if (!fallback || fallback.targetPrice === null) {
    return null;
  }

  return {
    sourceLabel: 'naver-fallback',
    asOfText: fallback.asOfText,
    targetPrice: fallback.targetPrice,
    추정기관: 'consensus',
    '투자의견(점수)': fallback.score ?? null,
    ...(fallback.opinionLabel ? { 투자의견: fallback.opinionLabel } : {}),
    rows: [{ '투자의견(점수)': fallback.score ?? null, 목표주가: fallback.targetPrice }],
  };
}

export { fetchNaverMStockOverall, fetchNaverMainOpinion, buildNaverConsensusSyntheticRow };