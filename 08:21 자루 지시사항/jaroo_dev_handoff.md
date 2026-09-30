# Jaroo 개발 전달 문서

버전: 2026-05-28 최종
대상: 프론트엔드 / 백엔드 개발자

---

## 0. 시작하기 전에

### 이 문서 읽는 법
| 역할 | 필수 섹션 |
|---|---|
| 프론트 | §1 화면 목록 · §4 디자인 토큰 · §5 컴포넌트 규칙 · §7 금지 항목 |
| 백엔드 | §2 데이터 계약 · §3 API · §6 비즈니스 로직 |
| 기획/QA | §1 · §7 금지 항목 · §8 우선순위 |

### 프로토타입 사용법
- 모든 HTML은 **340px 모바일 프레임** 기준. 브라우저에서 바로 열림
- 슬라이더·접기·애니메이션은 **실제 동작**함 (목업 아님)
- 색/여백/폰트는 프로토타입 값을 그대로 사용

---

## 1. 화면 목록 (15개)

### 1-1. 진입 · OCR
| 파일 | 화면 | 비고 |
|---|---|---|
| `jaroo_ocr_upload.html` | ①처음 사용자 ②기존 사용자 ③액션시트 ④인식 중 | 자동 추출(버튼 없음) |
| `jaroo_ocr_result.html` | 종목 확인 | 정상 접힘 · 실패 후보 · 계좌 병합 |

### 1-2. 메인
| 파일 | 화면 | 비고 |
|---|---|---|
| `jaroo_home_v2.html` | 홈 | 도넛 + 종목 카드. 워치 중이면 상태 표시 |
| `jaroo_final_v7.html` | 딥스캔 결과 | 60초 실시간 · 결론 후 접기 · 워치 CTA |

### 1-3. 워치 (구독)
| 파일 | 화면 | 비고 |
|---|---|---|
| `jaroo_watch.html` | 등록 유도 · 대시보드 · 타임라인 | |
| `jaroo_watch_v2.html` | 종목 상세 | 요약 + 접기(①~④) |
| `jaroo_watch_calm.html` | "안 봐도 되는 기간" | 회피형 안심 |
| `jaroo_watch_event.html` | 이벤트 예고 · 번역 · 알림 3층 | |
| `jaroo_watch_average.html` | 추가매수 시뮬레이터 | 슬라이더 실시간 계산 |
| `jaroo_watch_notify.html` | 알림 강도 설정 | 3단계 + 안전 하한선 |

### 1-4. 계정
| 파일 | 화면 |
|---|---|
| `jaroo_login.html` | 로그인 2화면 (구글·이메일 활성 / 카카오·애플 준비중) |
| `jaroo_mypage.html` | 마이페이지 (프로필 · 크레딧 · 워치 카드 · 알림 · 기타) |
| `jaroo_mypage_detail.html` | 세부 5화면 (프로필편집 · 종목관리 · 분석기록 · 크레딧준비중 · Pro준비중) |

### 1-5. 상태 처리
| 파일 | 화면 |
|---|---|
| `jaroo_states.html` | OCR 완전실패 · OCR 부분실패 · 딥스캔 실패 · 네트워크 · 빈 상태 3종 |
| `jaroo_transition.html` | 체험 종료 · 해지 만류 · 손절 후 |

---

## 2. 데이터 계약

### 2-1. OCR 결과
```jsonc
POST /api/ocr/parse
{
  "scanned_count": 2,
  "items": [
    {
      "matched": true,
      "name": "삼성전자", "code": "005930", "market": "KOSPI",
      "qty": 6,
      "avg_price": 231400,          // 정수 반올림 필수
      "eval_amount": 1926000,
      "profit_pct": 38.1,
      "profit_amount": 736210,
      "merged_from": [               // 2건 이상이면 "N개 계좌 합산" 배지
        {"qty":1,"avg_price":227756,"source_idx":0},
        {"qty":5,"avg_price":232129,"source_idx":1}
      ]
    },
    {
      "matched": false,              // 후보 제시 (빈 폼 입력 금지)
      "read_text": "HPSP",
      "read_qty": 3, "read_avg_price": 61195,
      "candidates": [
        {"name":"HPSP","code":"403870","market":"KOSDAQ","similarity":0.98},
        {"name":"HLB","code":"028300","market":"KOSDAQ","similarity":0.71}
      ]
    }
  ]
}
```

### 2-2. 홈
```jsonc
GET /api/portfolio
{
  "total_eval": 772750,
  "total_profit_amount": 40133,
  "total_profit_pct": 5.5,
  "status_label": "관찰",            // 강세/우세/관찰/주의/위험
  "loss_count": 1, "total_count": 3,
  "trend_message": "이번 주 포트폴리오 순풍",
  "trend_direction": "up",
  "holdings": [{
    "name":"삼성전자","code":"005930","market":"KOSPI",
    "qty":1,"weight_pct":41,
    "current_price":299500,"avg_price":227756,"eval_amount":299500,
    "profit_pct":31.5,"profit_amount":71744,
    "tag":"수익",                     // 수익/관찰/손실
    "last_scan_at":"2026-05-28",     // null이면 [딥스캔 분석], 있으면 [다시 보기]
    "watching": true,                 // true면 "지켜보는 중" 상태 표시
    "next_check_date":"2026-08-05"
  }]
}
```

### 2-3. 딥스캔
```jsonc
GET /api/deepscan/{code}
{
  "llm_eta_sec": 58,                 // 브리핑 속도 동적 조절용 (캐시면 짧게)
  "instant": {                        // 즉시 표시 (LLM 대기 없음)
    "current_price":16050,"avg_price":15980,
    "week52_high":18400,"week52_low":12100,
    "day_high":16200,"day_low":15900,"volume_ratio":1.4,
    "candles":[...],                  // 일봉 배열
    "briefings":[                     // 6개 고정
      {"q":"한 달 흐름","data":"+12.3%","meaning":"..."}
    ]
  },
  "llm": {                            // 40~60초 후
    "level":"강세",                   // 강세/우세/관찰/주의/위험
    "bar":4,                          // 0~5
    "distribution":"3팀 중 2팀 긍정 · 1팀 중립",
    "summary":"거의 본전이고 상승 여력이 남아 있어…",
    "teams":[{
      "name":"시장·차트팀","verdict":"긍정","text":"…",
      "basis":[["현재가","16,050원"],["20일선","15,800원"]]
    }],
    "scenarios":[
      {"name":"보유 유지","pct":62,"recommended":true,"trigger":"목표가 도달 시 분할 매도"},
      {"name":"추가 매수","pct":23,"trigger":"−10% 도달 시 평단 낮추기"},
      {"name":"손절","pct":15,"trigger":"추세 이탈 시 검토","sell_now_amount":-877}
    ],
    "target":{"price":17500,"upside_pct":23.4,"opinion":"매수 우세","brokers":13,"recent":"상향"}
  }
}
```

### 2-4. 워치
```jsonc
GET /api/watch
{
  "subscription":{"status":"trial","days_left":5},
  "notify_level":"normal",            // minimal/normal/detailed
  "items":[{
    "code":"036540","name":"SFA반도체",
    "status":"calm",                  // calm(지켜보는 중) / alert(확인 필요)
    "gap_to_breakeven_pct":16.7,
    "gap_change_pct":-2.1,            // 음수면 가까워짐 → "3주 전보다 2.1% 가까워졌어요"
    "gap_change_period":"3주",
    "next_check_date":"2026-08-05",
    "next_check_reason":"2분기 실적 발표",
    "last_signal":{"text":"아직 버틸 근거가 있어요","at":"2026-05-26","level":"ok"},
    "conditions":[                     // 이벤트마다 재채점
      {"name":"업황 회복","met":true,"detail":"후공정 수주 2분기 연속 증가","updated_at":"2026-07-28"},
      {"name":"목표가 여력","met":true,"detail":"13,200원 · 평단보다 위"},
      {"name":"흑자 전환","met":false,"detail":"8/5 실적에서 확인"}
    ],
    "worst_case":{"price":8120,"drop_pct":16.9,"loss_amount":-73700},
    "peer_stat":{"loss_ratio_pct":68,"index_change_pct":-11.2},
    "upcoming_events":[
      {"date":"2026-08-05","dday":6,"title":"2분기 실적 발표","why":"흑자 전환 여부가 갈려요","key":true},
      {"date":"2026-08-12","dday":13,"title":"삼성전자 설비투자 계획","why":"후공정 협력사라 수주에 영향","key":false}
    ],
    "timeline":[
      {"at":"2026-07-28","type":"condition_met","text":"후공정 수주 2분기 연속 증가",
       "impact":"버틸 근거 하나가 더 단단해졌어요. 2/3 충족으로 올라갔어요.","source":"업황 지표"},
      {"at":"2026-07-22","type":"background","text":"미국 반도체주 3.2% 하락",
       "impact":"SFA반도체 영향: 제한적. 버틸 근거는 그대로예요.","source":"미국 시장"}
    ],
    "filtered_count":147               // "관련 없는 뉴스 147건은 알려드리지 않았어요"
  }]
}
```

### 2-5. 추가매수 시뮬레이션 (클라이언트 계산)
서버 호출 불필요. 아래 공식으로 실시간 계산:
```js
newQty  = qty + add
newAvg  = (avg * qty + current * add) / newQty
gapPct  = (newAvg - current) / current * 100
cost    = current * add
gain10  = current * 0.10 * newQty        // 10% 등락 시 손익
worst   = |(week52Low - newAvg) * newQty|
gauge%  = gapPct / baseGapPct * 100      // 게이지 채움 비율
```

---

## 3. API 목록

| 메서드 | 경로 | 용도 |
|---|---|---|
| POST | `/api/ocr/parse` | 스크린샷 → 종목 추출 (멀티파트, 최대 5장) |
| POST | `/api/portfolio/apply` | 확인된 종목 적용 (신규/병합) |
| GET | `/api/portfolio` | 홈 데이터 |
| DELETE | `/api/portfolio/{code}` | 종목 삭제 |
| GET | `/api/deepscan/{code}` | 딥스캔 (SSE 또는 폴링 — instant 먼저, llm 나중) |
| GET | `/api/deepscan/history` | 분석 기록 |
| GET | `/api/watch` | 워치 대시보드 |
| POST | `/api/watch/{code}` | 워치 등록 |
| DELETE | `/api/watch/{code}` | 워치 해제 |
| PATCH | `/api/watch/settings` | 알림 강도 변경 |
| POST | `/api/auth/email` · `/api/auth/google` | 로그인 |

**딥스캔 전송 방식**: `instant`를 먼저 응답하고 `llm`은 SSE로 push 권장. 폴링이면 2초 간격.

---

## 4. 디자인 토큰

```css
/* 색 — 한국 증시 관습 (빨강=상승, 파랑=하락) */
--ink:        #0F1419;   /* 모든 액션: 버튼·딥스캔·링크·토글 */
--up:         #E5484D;   /* 수익·상승 */
--down:       #2B6BE6;   /* 손실·하락 */
--bg:         #F5F6F8;   /* 화면 배경 */
--card:       #FFFFFF;
--line:       #E8EAEE;   /* 카드 테두리 */
--line-soft:  #EFF1F4;   /* 내부 구분선 */
--ink-soft:   #EEF0F3;   /* 배지·연한 강조 */
--t1:         #0F1419;   /* 본문 */
--t2:         #5A6473;   /* 보조 */
--t3:         #97A0AE;   /* 흐린 텍스트 */

/* 상태 배경 */
--up-bg:      #FBE6E7;   /* 수익 배지·경고 */
--up-text:    #A8323A;
--down-bg:    #F0F4FB;   /* 손실 배지 */
--down-text:  #2456A8;
```

**색 규칙**
- 액션(버튼·링크·토글)은 **무조건 먹색**. 손익 색을 버튼에 쓰지 않음
- 빨강/파랑은 **손익 전용**. 유일한 컬러
- 구글 로고만 공식 4색 예외 (브랜드 규정)
- 도넛 비중 조각은 중립 청회색(`#3E5C8A`/`#7E97BD`/`#C3D0E3`) — 손익과 혼동 방지

**타이포**
```css
font-family: -apple-system, 'Pretendard', sans-serif;
font-variant-numeric: tabular-nums;   /* 모든 숫자에 적용 */
```

**아이콘**: SVG 라인, `stroke-width:2`, `stroke-linecap:round`. **이모지 사용 금지**

---

## 5. 컴포넌트 규칙

### 5-1. 정보 밀도 — 결론 먼저, 나머지 접기
모든 상세 화면은 이 구조를 따름:
```
[첫 화면]  결론 한 줄 + 핵심 수치 2~3개
[접기]     "자세히 보기" → ①②③ 번호 섹션
```
적용 화면: 딥스캔 결과, 워치 상세, 추가매수

### 5-2. 번호 섹션
```html
<div class="sec">
  <div class="sec-h">
    <span class="sec-n">1</span>
    <span class="sec-t">제목</span>
    <span class="sec-score">2 / 3</span>  <!-- 또는 sec-d: D-6 -->
  </div>
  ...
</div>
```
각 섹션은 **다른 형태**로 (2열 비교 / 게이지 / 자문 카드) — 훑을 때 구조가 보이게

### 5-3. 접기
```html
<div class="more" id="x">
  <div class="more-btn" onclick="document.getElementById('x').classList.toggle('open')">
    <span class="more-t">자세히 보기</span>
    <span class="more-s">안에 뭐가 있는지 요약</span>
    <span class="more-a"><!-- chevron --></span>
  </div>
  <div class="more-body">...</div>
</div>
```
`.more.open .more-body { max-height: <충분히 큰 값>; }` — 실제 콘텐츠보다 크게 잡을 것

### 5-4. 숫자 표기
- 평단·금액: **정수 반올림** (227,756.4921 → 227,756)
- 퍼센트: 소수 1자리 (+31.5%)
- 손실 부호: `−` (U+2212, 하이픈 아님)
- 천 단위 구분: `toLocaleString('ko-KR')`

---

## 6. 비즈니스 로직

### 6-1. OCR 매칭 정규화 ★필수
MTS마다 종목명 표기가 달라 매칭 실패가 발생. **비교용 키를 정규화**하되 저장은 원본 명칭:
```
정규화: 공백 제거 → # 제거 → 양끝 특수기호 제거 → 대소문자 통일

DB "#삼성스팩"  → 키 "삼성스팩"
OCR "삼성스팩"  → 키 "삼성스팩"   → 매칭 성공
```
- 후보 유사도도 정규화 키 기준으로 계산
- 표시·저장은 **DB 정식 명칭** 사용

### 6-2. 계좌 병합
```
포트폴리오 뷰: 종목 합산 (평단 = 가중평균)  → 비중·전체손익 계산용
계좌별 내역:   분리 보관                     → 딥스캔은 계좌별 평단이 다르므로
```

### 6-3. 이벤트 3층 분류
| 층 | 대상 | 처리 |
|---|---|---|
| 1 | 내 종목 직접 (실적·공시·수주·증자·대주주) | **알림 발송** |
| 2 | 배경 (미국장·환율·업황·공급망) | **기록만** — "내 종목 영향: 제한적/긍정적"으로 번역 |
| 3 | 무관 (테마주·루머·타 업종) | **차단** — `filtered_count`에만 반영 |

연관 판정: 직접 / 업종 / 공급망 / 거시(영향도 판단)
**알림 문구는 항상 종목명으로 시작.** "나스닥 3% 급락" ✗ → "SFA반도체에 영향이 있을 수 있어요" ✓

### 6-4. 알림 강도
| 값 | 라벨 | 발송 대상 | 빈도 |
|---|---|---|---|
| `minimal` | 안 보고 싶어요 | 층1 핵심(근거 붕괴·본전 근접)만. 주간 요약 없음 | 월 1~2 |
| `normal` | 적당히 알려줘요 | 층1 전부 + 주 1회 요약 | 주 1~2 |
| `detailed` | 다 알고 싶어요 | 층1 + 층2 + 5% 이상 급등락 | 주 3~5 |

**안전 하한선 (설정 무관 항상 발송)**
- 거래정지·상장폐지 위험
- 버틸 근거 완전 붕괴

**자동 차등**: 손실 종목은 강도를 한 단계 높게, 수익 종목은 낮게 (사용자 설정 없음)

### 6-5. 감시 주기 — 실시간 보고서 생성 금지
| 주기 | 작업 | LLM |
|---|---|---|
| 매일 | 지표 감시 (본전거리·급락·공시·D-day) | ✗ 계산만 |
| 주 1회 | 주간 요약 (템플릿) | ✗ |
| 이벤트 발생 시 | 딥스캔 재분석 + 조건 재채점 | ✓ |

이유: 매일 LLM 호출 시 구독료 초과 + 대부분의 날은 쓸 내용 없음

### 6-6. 딥스캔 실패 처리
- **크레딧 차감 금지** (화면에 "차감되지 않았어요" 명시)
- `instant` 데이터는 조회됐으므로 "시세 정보만 보기" 제공
- 어느 단계에서 멈췄는지 표시

---

## 7. 금지 항목 (QA 체크리스트)

화면에 **절대 노출 금지**:
- [ ] 점수 숫자 (딥스캔 84, 포트폴리오 66, 시장 57/68) — 전부 폐기
- [ ] 시장 점수 카드 — 홈에서 제거됨
- [ ] 영문 디버그 라벨 (`MARKET SCORE`, `OCR APPLIED`)
- [ ] AI 내부 멘트 ("OCR에서 읽어…", "덤프 기반…", "LLM 위원 3/3")
- [ ] 정체불명 배지 ("원천 상태 표시", "위원회 4개 응답")
- [ ] 시스템 경로 (`/screenshot`, `/ocr`)
- [ ] 개발자 용어 ("식별자(name/ticker/code)", "종목 유형")
- [ ] 디버그 텍스트 ("VKOSPI 원천 차단")
- [ ] `1970-01-01` fallback → "데이터 없음"
- [ ] 평단 소수점
- [ ] 한 카드 안 현재가 중복 (1회만)
- [ ] "9인 위원회" → "세 팀", "300cr" → "딥스캔 N회"
- [ ] 이모지 (SVG 아이콘으로 대체)
- [ ] OCR 실패 시 빈 폼 입력 요구 (후보 제시로 대체)
- [ ] 초록색 (#1A9D55 등) — 한국식 색 체계에서 제거됨

---

## 8. 구현 우선순위

### Phase 1 — 코어 (필수)
1. OCR 흐름 (업로드 → 인식 → 확인 → 적용) + **매칭 정규화(§6-1)**
2. 홈 (도넛 + 종목 카드)
3. 딥스캔 (instant/llm 분리, 60초 대기 UX)
4. 로그인 (구글 + 이메일)
5. 에러/빈 상태 전체

### Phase 2 — 워치
6. 워치 등록 · 대시보드 · 종목 상세
7. 이벤트 감시 + 3층 분류 + 알림
8. 알림 강도 설정
9. 체험 → 유료 전환

### Phase 3 — 확장
10. 추가매수 시뮬레이터
11. 분석 기록 · 프로필 편집
12. 손절 후 흐름

---

## 9. 미확정 (결정 필요)

- **워치 과금 모델** — A(포트폴리오 전체 월정액) vs C(Pro 통합). 상세 비교는 `jaroo_watch_bm.md` §4-B
- **무료 체험 기간** — N일 (변화가 한 번은 감지될 길이여야 함)
- **크레딧 단가** — 현재 화면은 "준비 중" 처리
- 이벤트 트리거 임계값 (몇 % 급락부터 알릴지 등)
- 손실 종목 자동 차등 강도 (얼마나 더 챙길지)

---

## 10. 함께 보는 문서

| 문서 | 내용 |
|---|---|
| `jaroo_overview.md` | 전체 흐름 · 사용자 여정 |
| `jaroo_watch_bm.md` | 워치 BM 설계 (유형 분석 · 과금 · 유인 정렬) |
| `jaroo_dev_spec_v7.md` | 딥스캔 60초 UX 상세 타임라인 |
