# @jaroo/instrument-core

Jaroo V3 모노레포 내부에서 사용하는 KR/US 종목명↔코드/티커 매핑 데이터와 resolver 패키지다. 기존 `kr-us-stock-name-ticker-maps` 스냅샷을 PR1 foundation 작업으로 내부 패키지화했다.

실사용 목적은 아래 3가지다.
- OCR/자연어 입력에서 종목명을 코드/티커로 매핑
- 한국어 미국주식 검색어를 공식 티커로 연결
- 이름 충돌이 있는 종목까지 포함한 100% 커버리지 맵 제공

## 포함 데이터

### 1) 한국 주식
- `data/kr/kr-stock-name-to-code.json`
  - 형식: `{ "삼성전자": "005930", ... }`
- `data/kr/kr-stock-name-to-code.txt`
  - 형식: `삼성전자 : 005930`

기준:
- KRX/KIND 상장법인목록으로 보강
- 총 3453개 이름 매핑
- 2026-06-04 수집 기준 KOSPI 838 / KOSDAQ 1819 / KONEX 107

### 2) 미국 주식 / 미국 상장 종목

#### exact 맵
이름이 정확히 1:1로 매핑되는 항목만 담은 파일이다.
- `data/us/us-stock-name-ko-to-ticker-exact.json`
- `data/us/us-stock-name-en-to-ticker-exact.json`
- `data/us/us-stock-name-exact-report.json`

#### coverage100 맵
동일 이름 충돌까지 처리해서 전체 티커를 빠짐없이 담은 최종판이다.
- `data/us/us-stock-name-ko-to-ticker-coverage100.json`
- `data/us/us-stock-name-en-to-ticker-coverage100.json`
- `data/us/us-stock-ticker-to-ko-en-coverage100.json`
- `data/us/us-stock-name-coverage100-report.json`

#### exact multimap
같은 이름이 여러 티커에 대응되는 원형 데이터다.
- `data/us/us-stock-name-ko-to-tickers-exact-multimap.json`
- `data/us/us-stock-name-en-to-tickers-exact-multimap.json`

## coverage100 규칙

미국 종목은 같은 이름이 여러 티커에 대응되는 경우가 많다.
예를 들면 아래 같은 케이스다.
- 보통주 / 우선주
- 워런트 / 유닛 / 권리
- Class A / B / C
- 동일 법인의 파생 상장 종목

그래서 `coverage100` 파일은 고유 키를 만들기 위해 아래 규칙을 쓴다.
- 한글 맵: `이름 (TICKER)`
- 영문 맵: `Name [TICKER]`

즉, `coverage100` 파일은 “모든 티커를 빠짐없이 담는 것”이 목표고,
`exact` 파일은 “이름 그대로 1:1 매핑되는 것만 담는 것”이 목표다.

## 현재 커버리지 요약

### 한국 주식
- 기존 KR 맵에 KRX/KIND 상장법인목록 누락분을 보강해 3453개 이름 매핑 수록

### 미국 주식
원천 기준:
- SEC 전체 티커: 10426
- Naver 매칭 티커: 6376
- 추가 생성 보강 티커: 4050

최종 결과:
- ticker → (영문명, 한글명) 커버리지: 10426 / 10426 = 100%
- 한글 name → ticker coverage100: 10426 / 10426 = 100%
- 영문 name → ticker coverage100: 10426 / 10426 = 100%

참고:
- 미국 한글명 4050개는 공개 소스 미매칭 구간을 보강하기 위해 음역/직역 기반으로 생성했다.
- 따라서 투자 서비스용 “공식 한글명” 데이터셋으로 보기보다는 검색/매핑용 보강 데이터로 보는 게 맞다.

## 데이터 출처

### 한국 주식
- KRX KIND 상장법인목록(EXCEL)
- 원본: `https://kind.krx.co.kr/corpgeneral/corpList.do?method=download&searchType=13`

### 미국 주식
- SEC company tickers
- 원본: `https://www.sec.gov/files/company_tickers.json`

- Naver 미국주식 시가총액/종목 목록 API
  - `https://api.stock.naver.com/stock/exchange/NASDAQ/marketValue?page=1&pageSize=100`
  - `https://api.stock.naver.com/stock/exchange/NYSE/marketValue?page=1&pageSize=100`
  - `https://api.stock.naver.com/stock/exchange/AMEX/marketValue?page=1&pageSize=100`

## 빠른 예시

### 한국 주식
```json
{
  "삼성전자": "005930",
  "카카오": "035720"
}
```

### 미국 주식 exact
```json
{
  "마이크로소프트": "MSFT",
  "팔란티어": "PLTR",
  "Apple Inc.": "AAPL"
}
```

### 미국 주식 coverage100
```json
{
  "마이크로소프트": "MSFT",
  "보나도 리얼티 트러스트 우선주 L (VNO-PL)": "VNO-PL",
  "Apple Inc. [AAPL]": "AAPL"
}
```

## 파일 선택 가이드

### 보통 가장 추천
- 한국 주식: `data/kr/kr-stock-name-to-code.json`
- 미국 주식 한글 검색: `data/us/us-stock-name-ko-to-ticker-coverage100.json`
- 미국 주식 영문 검색: `data/us/us-stock-name-en-to-ticker-coverage100.json`
- 티커 기준 정규화: `data/us/us-stock-ticker-to-ko-en-coverage100.json`

### 이름 충돌을 직접 처리하고 싶다면
- `data/us/us-stock-name-ko-to-tickers-exact-multimap.json`
- `data/us/us-stock-name-en-to-tickers-exact-multimap.json`

## 한국어 퍼지서치 엔진

이 저장소에는 미국 주식 한글명 오타를 티커 후보로 돌려주는 실험용 한국어 퍼지서치 엔진도 포함되어 있다.

파일:
- 엔진: `src/ko-fuzzy-resolver.js`
- CLI: `bin/ko-fuzzy-resolve.js`

설치:
```bash
npm install
```

CLI 예시:
```bash
node bin/ko-fuzzy-resolve.js 파란티어 --topN 3
```

출력 예시:
```json
{
  "query": "파란티어",
  "topN": 3,
  "results": [
    {
      "ticker": "PLTR",
      "score": 0.9,
      "via": "팔란티어",
      "canonicalKo": "팔란티어 테크놀로지스"
    }
  ]
}
```

Node API 예시:
```js
const { createKoFuzzyResolver } = require('./src/ko-fuzzy-resolver');

const resolver = createKoFuzzyResolver();
const results = resolver.resolve('파란티어', { topN: 5 });
console.log(results);
```

HTTP 서버 엔드포인트 예시:
```bash
node bin/ko-fuzzy-http-server.js --port 3040
```

기본 엔드포인트:
- `GET /api/ticker-search?q=파란티어&topN=5`
- `GET /api/stock-search?q=삼성전자&topN=5`
- `GET /health`

해외주식 퍼지 티커 응답 예시:
```json
{
  "query": "파란티어",
  "topN": 5,
  "results": [
    {
      "ticker": "PLTR",
      "score": 0.75,
      "via": "팔란티어",
      "canonicalKo": "팔란티어 테크놀로지스",
      "canonicalEn": "Palantir Technologies Inc."
    }
  ]
}
```

통합 엔드포인트 응답 예시:
```json
{
  "query": "삼성전자",
  "topN": 5,
  "kr": {
    "matched": true,
    "matchedBy": "exact",
    "name": "삼성전자",
    "code": "005930"
  },
  "us": {
    "results": []
  }
}
```

`/api/stock-search`는 한국 주식명 exact/compact 매칭으로 종목코드를 반환한다. KR 매칭이 성공하면 `us.results`는 빈 배열을 반환하고, KR 미매칭일 때만 기존 퍼지 엔진으로 해외주식 티커 후보를 채운다.

Express/Next/Fastify 등에 붙일 때는 `createKrStockResolver()`와 `createKoFuzzyResolver()`를 import해서, KR 해석이 실패한 경우에만 해외주식 `resolve(query, { topN })`를 호출하면 된다. HTTP 서버를 그대로 띄우면 같은 응답 구조를 `kr`/`us` 필드로 반환한다.

현재 엔진 특성:
- exact / compact exact 매칭을 우선 시도한다.
- decorator 토큰(예: 홀딩스, 그룹, 클래스 표기)을 일부 제거한다.
- `hangul-util` 거리 기반 후보 생성 후 자체 점수로 재정렬한다.
- common stock 쪽을 약하게 우선한다.
- baseline top1을 최대한 유지하면서 후보 recall을 넓히는 보수적 확장 경로를 함께 사용한다.

벤치마크 스냅샷(1000건 한글 오타 코퍼스 기준):
- Top1: `895 / 1000` (`89.5%`)
- Top3: `948 / 1000` (`94.8%`)
- Top5: `964 / 1000` (`96.4%`)
- 관찰: Top1은 기존 기준과 거의 비슷하게 유지하면서, Top3/Top5 후보 회복을 높이는 방향이다.

## 주의
- 미국 한글명 보강 구간에는 생성 기반 이름이 포함된다.
- ETF, ADR, 우선주, 워런트, 유닛, 권리 종목이 포함되어 있다.
- 따라서 “보통주만 필요”한 경우 후처리 필터링이 필요할 수 있다.
- 퍼지서치 엔진은 실험용 1차 구현이며, 짧은 이름·순서 반전·share-class sibling 충돌에는 아직 약하다.

## 라이선스

데이터 원본의 이용 조건은 각 원본 제공처 정책을 따른다.
이 저장소의 정리/가공 결과물과 문서는 MIT License로 제공한다.
