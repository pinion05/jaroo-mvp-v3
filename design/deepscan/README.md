# Jaroo 딥스캔 #267 마무리 시안

이슈 **#267** [딥스캔] 결과 화면 라벨·용어·표기 정리의 남은 3개 항목 before/after 시안.

- `jaroo_267_polish.html` — 패널 A 팬차트 현재가 포인트(BEFORE/AFTER) · 패널 B 시장 브리핑 아이콘 교체 · 패널 C 미사용 페이지 라우트 맵 · 구현 체크리스트

## 남은 항목 실측 요약 (2026-09-23 분석)

| 항목 | 실측 결과 | 제안 |
|---|---|---|
| 현재가 위치 포인트 동그라미 | `deepscan-loading-briefing-card.tsx` 팬차트에서 목표가 닷 3개(우측 끝)만 있고, 현재가 선 끝(부채꼴 분기점)에는 닷 없음. 분기점 좌표는 지오메트리가 이미 `fanStartX·currentY`로 노출 | 분기점에 r 3.6 회색 닷(`--ds-muted`, 흰 테두리) 추가 — 목표가 닷과 동일 규격 |
| 잘못 들어간 아이콘 | "오늘 시장 속에서는?" 시장 요약 행에 `Landmark`(은행/의사당 건물) 아이콘 — '기관'으로 읽혀 시장 흐름 질문과 불일치. 나머지 브리핑 아이콘(Calendar·TrendingUp·Target·BarChart3·Flame·Telescope)은 정상 | `ChartCandlestick`(lucide) 교체, 대안 `Globe`. 회의록 원문(L201-231) 확보 시 재확인 |
| 미사용 페이지 2개 제거 | 전 라우트 인바운드 링크 실측: `/merge`는 프로덕션 진입 0(병합 UI는 /ocr에 인라인돼 고아), `/debug/deepscan`·`/debug/briefing`은 인바운드 0 + 운영 게이트 없음 | `/merge` 삭제 확정. `/debug` 2개는 삭제 vs NODE_ENV 게이트 중 택1(게이트 권장). 회의록 추정 표기('뉴 확보'·'krpg')와는 1:1 매칭 불가 |

이미 완료된 #267 항목(참고): '추천 시나리오' 라벨(52da121), '근거 유지' 행 제거(9f9c516), '오픈다트'→'최근 공시' 쉬운 표기(a51ce8f), 거래 배수 분수 표기(52da121). 목표가 중복 컴포넌트는 #273으로 분리.

## 팬차트 좌표 신뢰성

시안 SVG의 곡선·닷 좌표는 프로덕션 `buildConsensusFanGeometry`를 디버그 fixture 값(현재가 250,000 · 평균 487,045 · 최고 600,000 · 최저 300,000 · 평단 96,852, seed `debug-briefing-kr`)으로 실행한 실측 출력. 색 토큰은 `deepscan-loading-screen.module.css` 라이트 테마 값(--ds-muted #97A0AE · --ds-blue #2B6BE6 · --ds-red #E5484D).

## 참고

- 기존 `design/` 컨벤션 동일: 단일 HTML 인라인 스타일, Pretendard(CDN), 시안 토큰
- 색 규칙: 플러스=빨강(#E5484D) / 마이너스=파랑(#2B6BE6) — #266 확정 규율과 일치
