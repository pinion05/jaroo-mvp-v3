# 딥스캔 위원 전멸 — 후속 포렌식 보고

- 일자: 2026-11-09 (진행형 문서 — 사용자 실측 윈도 12:00~14:30 KST, 11/09 18:00 KST 배치 확인 후 완결 예정)
- 작성: 후속 포렌식 에이전트 (블랙박스 원칙 — 제품 소스 비열람, 운영 로그·배포 메타데이터만 관찰)
- 대상: jaroo 운영(production) — Railway 프로젝트 91cdd87e / 서비스 jaroo 691762e8 / 환경 447abb35
- 방법: Railway GraphQL(v2) `deploymentLogs` 읽기 전용 조회. 재현 스크립트 `scripts/railway-log-dig.py` (토큰은 `RAILWAY_TOKEN` 환경변수로만 전달)

## 0. 수정 배포 확인 (배포 메타데이터)

- 현재 배포: **96de67c4-d978-48e8-80d5-f7807e636999**, 생성 2026-11-06T05:08:22.491Z (= 14:08 KST), SUCCESS
- 커밋: **13c68379** `Merge pull request #350 from pinion05/fix/deepscan-quality`
  - 커밋 메시지(배포 메타데이터 인용): "fix(deepscan): 딥스캔 품질 버그 5건 수정 — **위원회 소프트 데드라인 90s**·기록 페이지 503·dev↔운영 혼선·hero.score 정규화·목표가 가드"
  - → 소프트 데드라인 90초(=90000ms) 반영이 커밋 메시지에 명문화돼 있음 (관측 근거는 §2)
- 배포 목록에는 이 시각의 배포 2건(96de67c4, 쌍둥이 25414eaa — 동일 커밋)만 존재, `hasNextPage: false`

## ① 전/후 정량 대표

### 전 (전멸 기간 11/02~11/05, 4일 — 구 배포)

| 항목 | 수치 | 출처 |
|---|---|---|
| `committee-llm` start | 28 | 선행 포렌식 측정치(구 배포 로그) |
| member error | 252 | 〃 |
| soft-deadline error 스냅샷 | 28 | 〃 |

- **구 배포의 배포 레코드·런타임 로그는 Railway에서 소실 확인** (배포 목록에 11/06 05:08Z 이전 레코드 부재). 위 수치는 선행 측정치 인용이며, 선행 문서 `docs/tc/deepscan-failure-analysis.md`(11/6 14:16 작성, 존재 확인 — 내용 미열람) 및 커밋 13c68379 메시지가 정정 배경을 뒷받침.

### 후 (현재 배포 96de67c4, 2026-11-06 05:08Z ~ 조회시점)

| 필터 | 건수 | 비고 |
|---|---|---|
| `committee-llm` | 1 | **11/09 12:15 사용자 실행 1건뿐** (배치 경로에서 위원회 미실행 — §2) |
| `llm-upstream-error` | 0 | |
| `soft-deadline` (에러성) | 0 | 사용자 실행 1건의 스냅샷은 `status=complete` |
| `watch-daily-batch` | 3 | 11/06·11/07·11/08 각 1회, 모두 `failed=0` |
| `deepscan-kr job` (complete) | 21 | 3일 × 7종 전부 complete |
| `refund` | 0 | |
| `402` | 14 | 전량 FMP(미국주 데이터 제공사) LAES 402 — LLM 크레딧 아님 (§3) |
| `error` | 7 | Next.js Server Action 불일치 6 + aborted 1 — 딥스캔 무관 (§3) |
| `timeout` | 3 | 전량 `[dart-corpcode-prefetch] start timeoutMs=600000` 일상 프리페치 라인 |
| `ECONN*` | 1 | ECONNRESET 1 (11/09 09:33, 오래된 탭의 Server Action — §3) |
| `watchdog` / `partial` / `upstream` / `bad` / HTTP `502` | 0 | 502 필터 3건은 `elapsed=502ms`·`5028ms` 부분문자열(양성) |

## ② 유저 실행 딥스캔 시그니처 (최우선 증거)

### 11/09 12:15:22~12:15:50 KST — 종목 100840 (리드 실측 6종 중 1번째, 실시간 관찰)

```
12:15:36 [committee-llm] start requestId=kr-committee-100840-1794194136261
         members=9 concurrency=9 model=deepseek/deepseek-v4-flash softDeadlineMs=90000
12:15:39~49 member 9종 전원 status=ok attempts=1 (elapsed 3,452~13,667ms; 최장 avgPriceGap 13.7s)
12:15:49 [committee-llm] soft-deadline snapshot status=complete completed=9/9 pending=0 errors=0 elapsed=13675ms
12:15:49 [committee-llm] final status=complete completed=9/9 errors=0 elapsed=13676ms
12:15:49 [deepscan-kr] stage committee elapsed=13697ms status=complete completed=9/9
12:15:49 [deepscan-kr] payload ready total=33191ms code=100840 degraded=0 llm=on
12:15:50 [deepscan] canonical fetch ok code=100840 elapsedMs=33301 httpStatus=200
```

- **softDeadlineMs=90000 목격 (핵심)**: 수정 전 5000 → 90000 반영이 운영 로그에서 직접 확인됨. 9멤버 동시(concurrency=9) 실행에서 최장 13.7s 멤버까지 여유 종료 — 5s 데드라인이었다면 전멸(soft-deadline 에러) 재발 구간이었음이 자명한 여유 마진.
- 최종: **complete 9/9, partial 0, member error 0, 재시도(attempts>1) 0**
- 부가 관찰: `[deepscan-kr-committee] duplicate numeric citations count=4`(토큰 120.8%, 38634, 24000, 53000 등 다중 인용) — 품질 감사 로그. 정보성(에러 아님).
- 나머지 5종: 실측 진행 중 (12:00~14:30 KST) — §2 표는 윈도 종료 후 갱신.

### 경로 분기 (배치 vs 사용자)

- 배치(18:00 KST 워치): `[deepscan-kr] payload ready ... degraded=1 llm=off` — 위원회를 아예 돌리지 않음(`committee-llm` 0건). 전멸이 발생하던 배치 경로의 위원회 실행 자체가 꺼져 있음.
- 사용자(브라우저): `degraded=0 llm=on` — 위원회 실실행, 소프트 데드라인 90s 적용.

### 그 외 시간대 사용자 실행 흔적 (11/06~11/09)

- KR 딥스캔(`[deepscan-kr]`·`[deepscan] canonical`): 11/06~11/08 배치 시간대(18:0x KST) 외 관찰 0건. 사용자 위원회 실행은 11/09 12:15가 수정 배포 후 첫 사례.
- 미국주종 조회 흔적: 11/07 10:31~10:32 KST LAES — FMP 402×14·404, polygon 403(지수)·404, `FINNHUB_API_KEY 미설정` 다수 (§3 잔존 리스크)

## ③ 잔존 리스크

| 리스크 | 관측 | 판정 |
|---|---|---|
| `llm-upstream-error` (502 bad upstream 등) 재현 | 0건 (사용자 실행 1건 포함 전 구간) | 재현 없음 — 과거 로컬 2회 관측치는 운영 미재현 |
| refund 실패 | 0건 | 양호 |
| 402 credit | LLM 크레딧 402 없음. 단 **FMP(미국 재무데이터) 402×14** (11/07 LAES) | 딥스캔 위원회 무관. 미국주 종목조회 품질 저하 요인 |
| timeout / watchdog / ECONN | `timeout`=dart 프리페치 start 라인(양성), watchdog 0, ECONNRESET 1(11/09 09:33, 구배포 탭의 Server Action — 딥스캔 무관 양성) | 양호 |
| 위원 partial 종결 | 0건 (1/1 실행이 complete 9/9) | 양호 — 속행 관찰 |
| (신규 관찰) FINNHUB_API_KEY 미설정, polygon 403(지수 I:SPX/I:VIX) | 11/07 10:31 LAES 경로 | 미국주 조회 경로 설정 과제 — 위원회 전멸과 무관 |

## ④ 배치 경과 (11/06~11/09)

| 일자 | watch-daily-batch done | deepscan-kr job | 비고 |
|---|---|---|---|
| 11/06 | `stocks=7 collected=7 events=3 failed=0` 18:04:06 | 7종 complete | 수정 배포 당일 첫 배치 — 전멸 0건 |
| 11/07 | `stocks=8 collected=8 events=0 failed=0` 18:03:14 | 7종 complete(+LAES 캐시성 1ms) | 〃 |
| 11/08 | `stocks=8 collected=8 events=0 weekly=1 failed=0` 18:03:33 | 7종 complete | 〓 sendFailed=0 |
| 11/09 | **확인 예정** (18:00 KST 예정, 18:04 KST 자동 재조회 스크립트 구동 중) | | |

## ⑤ 결론 (중간)

- 배치 전멸: **소멸 확인** — 수정 배포 후 3회 연속 `failed=0`, member error/soft-deadline/refund 전부 0건.
- 사용자 경로: **softDeadlineMs=90000 운영 목격 + complete 9/9** — 수정이 실사용 경로에 반영됐다는 직접 증거 확보.
- 종결 판정: 11/09 배치(18:00 KST) 무사 통과 + 잔여 실측 5종 완료 후 최종 확정 예정.

## ⑥ 한계

- 구 배포(전멸 기간) 배포 레코드·로그의 Railway 보존 소실 — "전" 수치는 선행 측정치 인용뿐, 원 로그 재검증 불가.
- `deploymentLogs`는 조회 시점 이후 수 분 내 최신 로그까지 즉시 조회됨을 확인(12:15:36 라인이 ~1분 내 조회됨). 단 Railway 로그 보존 정책(기간)은 공식 문서화되지 않아 장기 이력 재조회를 보장 못 함.
- 멀티라인 로그(객체 출력)는 동시 출력 인터리브로 일부 재구성 필요 — duplicate citations 배열 일부 라인 순서 복원은 추정 포함.
- 위원회 미실행(배치 `llm=off`)이 수정 의도(권장 설정)인지 임시 플래그인지는 소스 비열람 원칙상 로그만으로 판별 불가 — 운영 의사결정 확인 필요.
