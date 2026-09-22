# Jaroo 워치 알림 시안

이 폴더는 두 이슈의 시안을 함께 둔다.

- `jaroo_watch_*.html` — **#268** [워치] 알림 조건 요구사항 정리 (설정형/피드형/워치리스트 통합형)
- `jaroo_halt_*.html` — **#269** [딥스캔] 거래정지 종목 별도 페이지 (상태형/체크리스트형/공시상세형)

자세한 내용은 각 이슈 참조.

## 데이터 소스 (레포 실측, 전부 크롤러에 이미 존재)

| 데이터 | 소스 모듈 | 시안에서 사용한 필드 |
|---|---|---|
| KR 공시 목록 | `packages/crawler/src/crawlers/dart-filings.js` (OpenDART `/api/list.json`) | `reportName`(공시명), `receiptDate`(접수일), `disclosureTypeLabel`(A–J 한글 라벨: 정기공시·주요사항보고·거래소공시…), `stockCode`, `corpCls`/`corpClsLabel`(유가·코스닥), `documentUrl`(DART 원문 링크) |
| 중요 공시 판정 | `packages/crawler/src/services/deepscan-kr-disclosure-risk-keywords.js` | 9개 리스크 그룹 — critical: 상장폐지/정리매매 · high: 매매거래정지·거래소심사·감사의견·보고서미제출·부도/회생/자본잠식·횡령/배임/불성실·코넥스지정자문인 · medium: 시장안내/투자유의. `hasKrDisclosureHighRiskSignal()`로 high 이상 판정 이미 구현됨 |
| 현재가·수익률 | `packages/crawler/src/crawlers/current-quotes.js` (네이버 시세 폴백 포함) | 현재가, 등락률 |
| 워치 종목 | `src/data/mypage-test-data.ts` `WATCHLIST_TEST_DATA` | 삼성전자·LG디스플레이·SFA반도체(기존 테스트 데이터) |

**미구현 데이터(시안에 미사용):** 알림 읽음 상태·푸시 발송 이력·시간대별 알림 설정 — 백엔드 스키마 없음. 토글/뱃지는 UI 상태만 표현.

## 시안 목록

| 파일 | 방향 | 화면 |
|---|---|---|
| `jaroo_watch_a_settings.html` | A · 설정형 | A1 알림 조건 설정(중요 공시만/전체 세그먼트 + 기준 칩) · A2 종목별 알림 관리 |
| `jaroo_watch_b_feed.html` | B · 피드형 | B1 공시 알림 피드(중요/일반 태그·DART 원문 링크·날짜 그룹) · B2 알림 없음 상태 |
| `jaroo_watch_c_watchlist.html` | C · 통합형 | C1 워치리스트+공시 배너(중요=빨강 배너 강조) · C2 증권사 캡처 차단 해제 안내 |

## 거래정지 별도 페이지 시안 (#269)

거래정지 종목은 일반 딥스캔 스텝(세 팀 분석)이 무의미 → 별도 페이지 + 공시 상세. `deepscan-inline-results.tsx`의 결과 카드 디자인 언어(16px 라운드·#E8EAEE 보더·navy 스퀘어 아이콘·facts 그리드·시나리오 바)를 계승하고, 시나리오/전망 블록을 공시 상세로 치환했다.

| 파일 | 방향 | 화면 |
|---|---|---|
| `jaroo_halt_min.html` | **채택** · 기존 계승 최소 변경 | 판1 히어로+심각도4단계+대처+공시 · 판2 카드만(중간단계 심각도 예시) |
| `jaroo_halt_a_status.html` | 초안(기각 — 변화 과다) | A1 딥스캔 진입 감지 · A2 상태 요약+타임라인 |
| `jaroo_halt_b_checklist.html` | 초안(기각 — 변화 과다) | B1 체크리스트 · B2 정리매매 임계 케이스 |
| `jaroo_halt_c_disclosure.html` | 초안(기각 — 변화 과다) | C1 공시 확장 카드 · C2 거래재개 전환 |

**채택 기준(2026-09-22 사용자 피드백):** 기존 딥스캔 구성요소(히어로 카드·emoji 스퀘어 헤더 카드·facts 그리드·모델행 리스트·CTA)만 사용하고 새 컴포넌트 언어를 만들지 않는다. AI 세 팀 위원회 파트(게이지·시나리오 확률)는 거래정지 상황과 안 맞으므로 제외 — "대처" 중심. 심각도 카드는 기존 종합결론 카드의 큰 라벨+게이지 리듬을 4단계로 계승해 공시 키워드 분류(critical/high/medium)를 표시한다.

사용 데이터 필드(전부 `deepscan-kr-evidence.js` disclosureAnalysis에서 이미 생성): filings(reportName·receiptDate·disclosureTypeLabel·filerName·documentUrl), riskLevel/riskLabel(중요 리스크/확인 필요/지분 변동/일반), riskKeywords, 카운트(riskCount·dilutionCount·correctionCount·ownershipCount·totalCount), `buildDisclosureRisk()`의 "자본변동 공시 N건 확인" 문장. 보유 정보는 홈 테스트 데이터의 거래정지 카드(드래곤플라이) 사용.

**미구현 데이터(시안에 미사용):** 정리매매 기간·재개 예정일 산출 로직, 감사의견 등 재무 팩트 요약 — disclosureAnalysis에 없는 필드는 "예시" 표기로만 등장.

## 이슈 요구사항 반영

- **중요 공시 기준 정의**: A1의 기준 카드가 리스크 그룹 9종을 severity별 칩으로 노출 — "중요 공시만 / 전체" 선택의 근거가 화면에 보임
- **거래정지 → "자본변동 공시 1건 확인"**: SFA반도체 예시로 3개 시안 모두에 동일 문구 사용 (빅스캔 관찰 기반)
- **증권사 캡처 차단 대응**: C2에서 KB·키움 언급 + 3단계 해제 안내
- 색 규칙: 플러스=빨강(#E5484D) / 마이너스=파랑(#2B6BE6) — 이슈 #266 방향과 일치

## 참고

- 기존 `design/` 컨벤션 동일: 단일 HTML 인라인 스타일, 340px 프레임, Pretendard, 시안 토큰(`--navy #0F1419` 등)
- 구현 시 `SpecFrame` + `detail.module.css` 계열 컴포넌트로 포팅 (기존 watchlist 페이지와 동일 경로)
- 폰트 로컬 로드 실패 시 시스템 폰트로 폴백 (레포 node_modules pretendard 상대경로 참조)
