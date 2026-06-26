// KR disclosure risk keyword database.
//
// Seeded from a 2026-06-26 sample of 100 OpenDART/KIND disclosures across
// 35 recently delisted KR issuers. The strongest recurring delisting signals
// were: 상장폐지, 정리매매, 주권매매거래정지, 기타시장안내,
// 감사의견/의견거절/감사범위 제한/계속기업, 상장폐지기준,
// 기업의 계속성/경영의 투명성, 지정자문인 선임계약, 관리종목,
// 상장적격성, 회생절차, 미해소.

const SEVERITY_RANK = Object.freeze({
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
});

export const KR_DELISTING_DISCLOSURE_KEYWORD_GROUPS = Object.freeze([
  {
    id: 'terminal-delisting',
    label: '상장폐지/정리매매',
    severity: 'critical',
    keywords: Object.freeze([
      '상장폐지',
      '상장 폐지',
      '상폐',
      '상장폐지결정',
      '상장폐지 결정',
      '상장폐지 절차',
      '상장폐지 절차 진행',
      '상장폐지 절차 재개',
      '상장폐지절차',
      '상장폐지절차 안내',
      '상장폐지 관련',
      '상장폐지 우려',
      '상장폐지 사유',
      '상장폐지사유',
      '상장폐지 여부',
      '상장폐지효력정지',
      '상장폐지 효력정지',
      '상장폐지결정 효력정지',
      '상장폐지결정등 효력정지',
      '상장폐지결정 등 효력정지',
      '자진상장폐지',
      '자진상장폐지 신청',
      '상장폐지 신청',
      '정리매매',
      '정리매매 개시',
      '정리매매 재개',
      '정리매매절차',
      '정리매매절차 재개',
    ]),
  },
  {
    id: 'trading-halt',
    label: '매매거래정지',
    severity: 'high',
    keywords: Object.freeze([
      '주권매매거래정지',
      '주권매매거래정지해제',
      '주권매매거래정지기간변경',
      '매매거래정지',
      '매매거래정지해제',
      '거래정지',
      '거래정지 해제',
      '거래정지기간 변경',
    ]),
  },
  {
    id: 'exchange-review-procedure',
    label: '거래소 심사/개선기간',
    severity: 'high',
    keywords: Object.freeze([
      '상장적격성',
      '상장적격성 실질심사',
      '상장폐지기준',
      '상장 폐지 기준',
      '기업심사위원회',
      '코스닥시장위원회',
      '상장공시위원회',
      '개선기간',
      '개선기간 종료',
      '이의신청',
      '상장예비심사 청구서 미제출',
      '상장예비심사신청서 미제출',
      '관리종목',
      '투자주의환기종목',
      '투자주의 환기종목',
      '시장조치 미진행',
      '시장조치사항',
      '절차 미진행',
      '미해소',
    ]),
  },
  {
    id: 'audit-opinion',
    label: '감사의견/감사범위',
    severity: 'high',
    keywords: Object.freeze([
      '감사의견',
      '감사의견 거절',
      '감사의견거절',
      '감사의견 의견거절',
      '의견거절',
      '감사범위 제한',
      '감사범위제한',
      '계속기업 존속능력',
      '계속기업 존속능력 불확실성',
      '감사의견 한정',
      '감사의견 부적정',
      '외부감사인의 감사의견',
      '계속기업 가정',
      '계속기업가정',
      '계속기업 가정 불확실성',
      '계속기업가정 불확실성',
      '반기검토의견부적정또는의견거절',
      '반기검토의견 부적정',
      '검토의견 부적정',
      '검토의견 의견거절',
      '부적정또는의견거절',
    ]),
  },
  {
    id: 'filing-deadline',
    label: '보고서 미제출',
    severity: 'high',
    keywords: Object.freeze([
      '사업보고서 미제출',
      '사업보고서 법정제출기한',
      '반기보고서 미제출',
      '분기보고서 미제출',
      '법정제출기한',
      '제출기한 내 미제출',
    ]),
  },
  {
    id: 'financial-distress',
    label: '부도/회생/자본잠식',
    severity: 'high',
    keywords: Object.freeze([
      '자본잠식',
      '완전자본잠식',
      '최종부도',
      '부도',
      '거래은행에 의한 거래정지',
      '회생',
      '회생절차',
      '회생절차개시',
      '회생절차개시신청',
      '회생절차폐지',
      '회생절차폐지결정',
      '회생절차폐지신청',
      '파산',
      '채무불이행',
    ]),
  },
  {
    id: 'governance-integrity',
    label: '횡령/배임/불성실',
    severity: 'high',
    keywords: Object.freeze([
      '횡령',
      '배임',
      '횡령ㆍ배임',
      '횡령·배임',
      '불성실',
      '불성실공시',
      '불성실공시법인',
      '기업의 계속성',
      '경영의 투명성',
      '영업정지',
      '소송',
      '제재',
      '회계처리기준 위반',
    ]),
  },
  {
    id: 'konex-advisor-contract',
    label: '코넥스 지정자문인 계약',
    severity: 'high',
    keywords: Object.freeze([
      '지정자문인',
      '지정자문인 선임계약',
      '지정자문인 계약해지',
      '선임계약 해지',
      '30일 이내 미체결',
    ]),
  },
  {
    id: 'market-notice-wrapper',
    label: '시장안내/투자유의 wrapper',
    severity: 'medium',
    keywords: Object.freeze([
      '기타시장안내',
      '투자유의안내',
    ]),
  },
]);

function normalizeKeywordText(value) {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value)
    .normalize('NFKC')
    .replace(/[−–—]/g, '-')
    .replace(/\s+/g, '');
}

function unique(values) {
  return [...new Set(values)];
}

export function matchKrDisclosureRiskKeywords(text) {
  const normalizedText = normalizeKeywordText(text);
  if (!normalizedText) {
    return {
      matched: false,
      maxSeverity: 'low',
      groups: [],
      keywords: [],
    };
  }

  const groups = [];
  const keywords = [];
  let maxSeverity = 'low';

  for (const group of KR_DELISTING_DISCLOSURE_KEYWORD_GROUPS) {
    const matchedKeywords = group.keywords.filter((keyword) => {
      const normalizedKeyword = normalizeKeywordText(keyword);
      return normalizedKeyword && normalizedText.includes(normalizedKeyword);
    });

    if (matchedKeywords.length === 0) {
      continue;
    }

    groups.push(group.id);
    keywords.push(...matchedKeywords);
    if (SEVERITY_RANK[group.severity] > SEVERITY_RANK[maxSeverity]) {
      maxSeverity = group.severity;
    }
  }

  return {
    matched: groups.length > 0,
    maxSeverity,
    groups: unique(groups),
    keywords: unique(keywords),
  };
}

export function hasKrDisclosureHighRiskSignal(text) {
  const match = matchKrDisclosureRiskKeywords(text);
  return match.matched && SEVERITY_RANK[match.maxSeverity] >= SEVERITY_RANK.high;
}
