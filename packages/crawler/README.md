# @jaroo/crawler

Jaroo V3 모노레포 내부에서 사용하는 crawler workspace package다. 기존 `jaroo-mvp-v3-crawler`의 현재 스냅샷을 PR1 foundation 작업으로 내부 패키지화했다.
모든 public HTTP surface는 `/api/*` 기준으로만 제공한다.

## 1. 빠른 시작

사전 조건:

- Node.js >= 20.9.0
- npm
- `.env` 파일 준비 (`cp .env.example .env`; 아직 값이 없어도 파일은 필요)

```bash
cd /path/to/jaroo-mvp-v3/packages/crawler
npm install
cp .env.example .env
npm run dev
```

표준 npm 스크립트는 먼저 저장소 루트의 `.env.local`, `.env.cookie`, 그 다음 `packages/crawler/.env`를 순서대로 읽습니다 (`--env-file-if-exists`). 따라서 로컬에서는 루트 env 파일만 있어도 바로 실행할 수 있고, crawler 전용 override가 필요할 때만 `packages/crawler/.env`를 추가하면 됩니다.

기본 포트는 `3040`입니다.

주요 스크립트:

| 명령 | 설명 |
| --- | --- |
| `npm run dev` | 개발 서버 실행 (`node --watch`) |
| `npm start` | 서버 실행 |
| `npm run check` | 주요 런타임 파일 문법 체크 |
| `npm test` | Node test 실행 |
| `npm run verify:wisereport-kr` | WiseReport KR 구조 검증 스크립트 |
| `npm run examples` | 대표 API를 실제 호출해 `example/` 샘플 갱신 |

## 2. 환경변수

현재 기준은 `.env.example` 입니다.

### 2.1 서버가 직접 읽는 환경변수

| 변수명 | 설명 |
| --- | --- |
| `PORT` | 서버 포트. 기본값 `3040` |
| `WISEREPORT_GLOBAL_COOKIE_HEADER` | WiseReport Global raw cookie header |
| `WISEREPORT_GLOBAL_COOKIES_JSON` | WiseReport Global 쿠키 JSON 문자열 |
| `WISEREPORT_GLOBAL_COOKIES_FILE` | WiseReport Global 쿠키 파일 경로 |
| `COMPANY_GLOBAL_COOKIE_HEADER` | `WISEREPORT_GLOBAL_COOKIE_HEADER` alias |
| `COMPANY_GLOBAL_COOKIES_JSON` | `WISEREPORT_GLOBAL_COOKIES_JSON` alias |
| `COMPANY_GLOBAL_COOKIES_FILE` | `WISEREPORT_GLOBAL_COOKIES_FILE` alias |
| `WISEREPORT_GLOBAL_COOKIE_FILE` | `WISEREPORT_GLOBAL_COOKIES_FILE` 단수형 alias |
| `COMPANY_GLOBAL_COOKIE_FILE` | cookie file alias |
| `POLYGON_API_KEY` | 미국주식 provider 호출용 |
| `FMP_API_KEY` | 미국주식 provider 호출용 |
| `FINNHUB_API_KEY` | 미국주식 provider 호출용 |
| `SEC_EDGAR_USER_AGENT` | SEC EDGAR 호출 User-Agent. 미설정 시 기본값 사용 |

메모:

- WiseReport Global cookie env는 canonical 이름과 alias 이름을 모두 지원합니다.
- WiseReport Global은 env/file/opts 값이 있으면 그것을 사용합니다.
- PR1 foundation 기준으로 하드코딩 fallback 쿠키는 제거했으므로, 값이 없으면 WiseReport Global 경로는 실패합니다.

### 2.2 pass-through / dependency 환경변수

이 저장소가 직접 파싱하지는 않지만 KRX 로그인/외부 의존 흐름에서 함께 쓰는 값들입니다.

| 변수명 | 설명 |
| --- | --- |
| `KRX_LOGIN_METHOD` | KRX 로그인 방식 |
| `KRX_ID` | KRX 로그인 ID |
| `KRX_PW` | KRX 로그인 비밀번호 |
| `KAKAO_ID` | Kakao 로그인 ID |
| `KAKAO_PW` | Kakao 로그인 비밀번호 |

메모:

- KRX 계열 API는 위 값이 없으면 실패할 수 있습니다.

### 2.3 reference-only 환경변수

`.env.example` 에는 있으나 현재 crawler runtime이 직접 읽지 않는 값입니다.

| 변수명 | 설명 |
| --- | --- |
| `TWELVE_DATA_API_KEY` | reserved key |
| `DART_KEY` | reserved key |
| `OPENROUTER_API_KEY` | ecosystem alignment / reference |
| `OPENAI_API_KEY` | ecosystem alignment / reference |
| `LLM_MODEL` | ecosystem alignment / reference |
| `SUPABASE_URL` | ecosystem alignment / reference |
| `SUPABASE_ANON_KEY` | ecosystem alignment / reference |
| `SUPABASE_SERVICE_ROLE_KEY` | ecosystem alignment / reference |

참고:

- `DART_KEY` 는 `.env.example` 에는 남아 있지만 현재 runtime source는 직접 읽지 않습니다.
- 미국주식 provider key가 일부 비어 있어도 서버는 뜰 수 있지만 provider별 partial / missing 응답은 생길 수 있습니다.

## 3. 응답 형식

기본 성공 응답은 공통 envelope를 사용합니다.

```json
{
  "ok": true,
  "data": {},
  "count": 1,
  "request": {
    "method": "GET",
    "path": "/api/major/market/fx/usd-krw",
    "primaryPath": "/api/major/market/fx/usd-krw",
    "params": {},
    "query": {}
  },
  "meta": {
    "service": "jaroo-mvp-v3-crawler",
    "version": "0.1.0",
    "resource": "market.fx.usd-krw",
    "routeId": "market-fx-usd-krw",
    "description": "USD/KRW 환율 스냅샷을 반환합니다.",
    "generatedAt": "2026-04-09T00:00:00.000Z",
    "dataSources": ["investing"]
  }
}
```

`count` 는 모든 엔드포인트에 동일 규칙으로 고정된 값이 아닙니다.

- 일부 엔드포인트는 route별 계산 규칙을 따릅니다.
  - 예: `/api/source/system/catalog` 는 endpoint 개수
- 별도 규칙이 없으면 배열은 `length`, 객체는 top-level key 수, 스칼라는 `1`, `null` 은 `0` 으로 추론합니다.
- 실패 응답은 `count: 0` 입니다.

성공 시 raw JSON을 그대로 반환하는 활성 WiseReport slim 엔드포인트는 아래 2개입니다.

- `/api/major/wisereport-fnguide/kr/companies/:code/slim/v1.1`
- `/api/major/wisereport-global/us/companies/:ticker/slim/v1.1`

위 2개도 실패 시에는 공통 에러 envelope를 사용합니다.

## 4. API

### 4.1 시스템

| Method | Primary Path | 설명 |
| --- | --- | --- |
| `GET` | `/api/source/system/health` | 서버 생존 상태와 런타임 정보 |
| `GET` | `/api/source/system/catalog` | 전체 API 카탈로그와 WiseReport Global route 목록 |

### 4.2 WiseReport KR

| Method | Primary Path | 성공 응답 | 설명 |
| --- | --- | --- | --- |
| `GET` | `/api/major/wisereport-fnguide/kr/companies/:code/slim/v1.1` | raw JSON | KR slim v1.1 aggregate |

예시:

```bash
curl "http://localhost:3040/api/major/wisereport-fnguide/kr/companies/005930/slim/v1.1"
```

### 4.3 WiseReport Global

| Method | Primary Path | Query | 성공 응답 | 설명 |
| --- | --- | --- | --- | --- |
| `GET` | `/api/major/wisereport-global/us/companies/:ticker/slim/v1.1` | 없음 | raw JSON | Company 5개 route 기준 slim v1.1 |

route id 목록은 `/api/source/system/catalog` 의 `wisereportGlobalRoutes` 에 포함됩니다.

현재 route id는 다음 19개입니다.

- Company: `company-snap`, `company-finance`, `company-invest`, `company-consensus`, `company-analysis`
- Earnings: `earnings-breaking-news`, `earnings-earning-surprise`, `earnings-dividend-news`, `earnings-turnaround`, `earnings-consensus`, `earnings-guide`, `earnings-capital-event`
- Screener: `screener-ranking`, `screener-index`
- News: `news-news`
- Theme: `theme-theme-list`
- GlobalEconomy: `global-economy-synthesis`, `global-economy-overview`, `global-economy-compare`

Global slim v1.1 은 위 전체 route를 쓰지 않고 Company 5개 route만 사용합니다.

예시:

```bash
curl "http://localhost:3040/api/major/wisereport-global/us/companies/NVDA/slim/v1.1"
```

### 4.4 Market

| Method | Primary Path | 설명 |
| --- | --- | --- |
| `GET` | `/api/source/naver-finance/kr/market/overview` | 국내 시장 요약 텍스트 |
| `GET` | `/api/major/market/fx/usd-krw` | USD/KRW 환율 |
| `GET` | `/api/source/stockplus-adrinfo-investing/market/indicators` | VKOSPI + ADR + US VIX |
| `GET` | `/api/source/stockplus/market/indicators/vkospi` | VKOSPI |
| `GET` | `/api/source/adrinfo/market/indicators/adr` | ADR |
| `GET` | `/api/source/investing/us/market/indicators/vix` | US VIX |

### 4.5 US Stock / US Market

| Method | Primary Path | Query | 설명 |
| --- | --- | --- | --- |
| `GET` | `/api/source/krx-polygon-fmp/market/quotes/current` | `codes?`, `tickers?`, `tradeDate?` | Home 화면용 KR/US 현재가 배치 조회. 부분 실패 시 `data.missing` 에 누락 사유 포함 |
| `GET` | `/api/source/fmp-polygon-finnhub-wisereport-global/us/stocks/:ticker/financials` | 없음 | 미국주식 통합 재무 데이터 |
| `GET` | `/api/source/fmp-finnhub-wisereport-global/us/stocks/:ticker/consensus` | 없음 | 미국주식 통합 컨센서스 / 애널리스트 데이터 |
| `GET` | `/api/source/polygon-finnhub-wisereport-global/us/stocks/:ticker/news` | `limit?` | 미국주식 뉴스 및 감성 데이터 |
| `GET` | `/api/source/finnhub-sec-edgar/us/stocks/:ticker/filings` | `limit?`, `filingTypes?`, `from?`, `to?` | 미국주식 공시 데이터 |
| `GET` | `/api/source/sec-edgar/us/stocks/:ticker/company-facts` | 없음 | SEC company facts 원시 데이터 |
| `GET` | `/api/source/sec-edgar/us/stocks/:ticker/company-facts/taxonomies` | 없음 | taxonomy 목록 |
| `GET` | `/api/source/sec-edgar/us/stocks/:ticker/company-facts/taxonomies/:taxonomy/concepts` | 없음 | taxonomy별 concept 목록 |
| `GET` | `/api/source/sec-edgar/us/stocks/:ticker/company-facts/taxonomies/:taxonomy/concepts/:concept` | 없음 | 단일 concept 상세 |
| `GET` | `/api/source/polygon-yahoo/us/market/indicators` | 없음 | 미국 시장 지표(S&P 500, NASDAQ, VIX, SMA) |
| `GET` | `/api/source/fmp-polygon-finnhub-sec-edgar-yahoo-wisereport-global/us/stocks/:ticker/report` | `includeFinancials?`, `includeConsensus?`, `includeNews?`, `includeFilings?`, `includeMarketIndicators?`, `newsLimit?`, `filingsLimit?` | 미국주식 리포트용 raw aggregator |

쿼리 규칙:

- `limit`, `newsLimit`, `filingsLimit` 는 양의 정수
- `filingTypes` 는 comma-separated 목록
- `from`, `to` 는 `YYYY-MM-DD`
- `include*` 는 `true/false` 또는 `1/0`

### 4.6 KRX

| Method | Primary Path | Query | 설명 |
| --- | --- | --- | --- |
| `GET` | `/api/source/krx-js-client/kr/stocks/:ticker/ohlcv` | `startDate`, `endDate` | 종목 OHLCV |
| `GET` | `/api/source/krx-js-client/kr/indexes/:indexCode/ohlcv` | `startDate`, `endDate` | 지수 OHLCV |
| `GET` | `/api/source/krx-js-client/kr/stocks/:ticker/investor-volume` | `startDate`, `endDate` | 투자자별 거래량 |
| `GET` | `/api/source/krx-js-client/kr/market/snapshot` | `tradeDate`, `market?` | 시장 스냅샷 |
| `GET` | `/api/source/krx-js-client/kr/market/cap` | `tradeDate`, `market?` | 시가총액 데이터 |
| `GET` | `/api/source/krx-js-client/kr/market/tickers` | `market?` | 티커-종목명 맵 |
| `GET` | `/api/source/krx-js-client/kr/batches/trigger` | `mode?` | trigger batch 실행 |

메모:

- KRX 계열에서 `startDate`, `endDate`, `tradeDate` 는 필수 query 존재 여부를 확인합니다.
- 예시는 관례적으로 `YYYYMMDD` 를 사용합니다.
- `market` 기본값은 `ALL`, `mode` 기본값은 `morning` 입니다.

## 5. 라우팅 정책

- crawler HTTP 엔드포인트는 모두 `primaryPath`, 즉 `/api/*` 경로만 지원합니다.
- path 규칙은 기본적으로 `/api/source/<data-source-slug>/...` 입니다.
- `/api/source/system/catalog` 역시 alias 없이 단일 경로로만 노출됩니다.
- envelope 응답의 `request` 는 `method`, `path`, `primaryPath`, `params`, `query`만 포함합니다.
- envelope 응답의 `meta` 는 `service`, `version`, `resource`, `routeId`, `description`, `generatedAt`, `dataSources`와 route별 추가 메타를 포함합니다.

## 6. 예시 샘플

- `npm run examples` 는 대표 API를 호출해 `example/` 디렉터리에 샘플을 생성합니다.
- 인덱스 파일은 `example/index.json` 입니다.
- 외부 데이터와 인증 상태에 따라 샘플 내용은 시점별로 달라질 수 있습니다.

## 7. 운영 메모

- 현재 제공 리소스를 빠르게 확인하려면 `/api/source/system/catalog` 를 보면 됩니다.
- smoke test는 `/api/source/system/health`, `/api/source/system/catalog`, `/api/major/market/fx/usd-krw` 부터 확인하는 편이 안전합니다.
- 실서비스에서는 `.env` 를 커밋하지 말고 별도 secret 관리 체계를 권장합니다.
