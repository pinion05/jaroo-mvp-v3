# OpenDART 공시 이벤트 추출 확장 연구

- 연구일: 2026-07-21
- 대상 시장: KOSPI (`corp_cls=Y`)
- 관측 기간: 2026-04-22 ~ 2026-07-21
- 공식 API: [공시검색](https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019001), [공시서류 원본파일](https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019003)

## 수정된 결론

OpenDART 상세코드 → 제목 → 필요한 본문 필드 순으로 좁혀 가는 계층형 구조 자체는 유효하다. 그러나 현재 `document-aware` 후보는 **주제/type 라우터로는 유망하지만 5필드 canonical event 추출기로는 아직 운영 투입 수준이 아니다.**

- 160개 고유 제목 template 독립 정성평가: 완전 정답 **123/160 (76.9%)**
- 핵심 사건은 맞지만 한 개 이상 필드가 부정확: **16/160 (10.0%)**
- 핵심 오분류: **19/160 (11.9%)**, 근거 부족: **2/160 (1.3%)**
- `high`로 반환한 159건 중 완전 정답이 아닌 사례: **36건 (22.6%)**
- 본문 의존 13건 독립 재검토: 완전 정답 **6/13 (46.2%)**, 핵심 오분류 **3/13 (23.1%)**

즉 기존의 `100% coverage`, `100% field completeness`, 개발 fixture `13/13`은 의미 정확도가 아니다. 가장 큰 문제는 필드 누락이 아니라 **action 시제, filing 상태와 event 상태의 혼합, cause/subjectType 축의 불일치, 무조건적인 high confidence**다.

권장 방향은 ML을 먼저 붙이는 것이 아니라 canonical 계약과 시간 해석 규칙을 먼저 고친 뒤, 그래도 남는 generic 본문에만 ML/LLM을 제한적으로 사용하는 것이다.

현재 구조와 필요한 보강 지점은 다음과 같다.

```text
OpenDART 상세분류코드
        ↓
구조화된 공시 제목 규칙
        ↓
원문 구조화 필드
  ├─ `1. 제목` / `공시제목`
  ├─ 결정일·예정일·효력일·완료일
  ├─ 정정/첨부 변경 내용
  └─ 배정방식·거래대상·실행 여부
        ↓
시간 정규화 + canonical contract 검증
        ↓
events[] + field confidence + evidence
        ↓
근거 부족/충돌 시 abstain 또는 classifier fallback
```

기존 실험에서 본문 때문에 출력이 바뀐 건수는 13건이었지만, 이는 **현재 구현이 본문의 제목 필드만 사용했다는 뜻**이지 본문이 13건에만 유용하다는 뜻이 아니다. 독립 검토에서는 출력이 바뀌지 않았던 사례에서도 예정일, 효력일, 정정 내용 때문에 action/state 오판이 반복됐다. 전건 자유본문 분류는 불필요하지만, 표준 구조 필드와 날짜는 더 넓게 읽어야 한다.

## 데이터 규모

| 계층 | 규모 | 용도 |
|---|---:|---|
| KOSPI 실공시 | 1,861건 / 535개 기업 | 실제 분포·provider type 검증 |
| 상세코드만으로 type을 확정 가능한 공시 | 1,457건 | provider type agreement |
| 제목 해석이 필요한 상세유형 | 404건 | 규칙 커버리지 |
| 사람 검증 type corpus | 51건 | 독립 type 정확도 |
| 대조/P0 full-event gold | 35건 | 5개 필드 전체 일치 정확도 |
| 본문 필요 전수 reviewed set | 13건 | body fallback 전체 일치 |
| 본문 연구 corpus | 305건, 원문 확보 294건 | 본문 사용 효과·필드 완성도 |
| 고유 제목 template 정성평가 | 160건 / 112개 기업 | 5필드 의미 정확성 |
| title-required 이중평가 subset | 40건 / 39개 기업 | 평가자 간 일치도 |

본문 연구 corpus는 160개 고유 제목 template과 기존 분류기가 보류했던 145개 실공시를 합친 것이다.

## 자동 벤치마크: coverage와 개발셋 일치

정확도와 비라벨 coverage를 섞어 하나의 점수로 만들지 않았다. 아래 표의 `13/13`, `35/35`도 현재 규칙 개발에 사용된 fixture와의 일치이며 독립 holdout 정확도가 아니다.

| 후보 | 대조 fixture 일치 | body fixture 일치 | 사람검증 type | provider type | 제목필요 coverage | 본문 fallback 후 coverage | 구조적 필드 완성도 |
|---|---:|---:|---:|---:|---:|---:|---:|
| Legacy | 0/35 | 0/13 | 51/51 | 1,457/1,457 | 64.11% | 64.11% | 0% |
| Flat keyword | 27/35 | 0/13 | 34/51 | 684/1,457 | 62.13% | 62.13% | 46.89% |
| Structured title | 31/35 | 0/13 | 34/51 | 684/1,457 | 61.88% | 61.88% | 46.89% |
| Title + detail hybrid | 35/35 | 0/13 | 47/51 | 1,452/1,457 | 61.88% | 61.88% | 58.36% |
| **Hierarchical document-aware** | **35/35** | **13/13** | **51/51** | **1,457/1,457** | **96.78%** | **100%** | **100%** |

`coverage`는 독립 정답률이 아니다. 해당 공시를 `other/null`로 보류하지 않고 canonical event로 구성할 수 있었는지만 측정한다.

`필드 완성도`도 의미 정확도가 아니다. 현재 benchmark의 `isFieldComplete`는 `type/action/cause/subjectType`가 비어 있지 않은지만 검사하고 `state`는 검사하지 않는다. 틀린 값을 강제로 채워도 100%가 된다.

## 독립 서브에이전트 정성평가

### 평가 방법

OpenDART 상세코드형 79개 template과 제목 해석형 81개 template을 합친 **160개 고유 정규화 제목 전수**를 두 구간으로 나눠 별도 서브에이전트가 검토했다. 입력은 보고서명, 상세코드/공식 라벨, 실제 원문이었다. provider 코드와 fixture 기대값을 정답으로 간주하지 않고 현재 예측의 각 필드가 원문으로 방어 가능한지 판정했다.

| 등급 | 판정 기준 |
|---|---|
| `correct` | 모든 비-null 필드가 원문으로 직접 방어 가능 |
| `mostly_correct` | 핵심 사건은 맞지만 한 개 이상 필드가 과도하거나 부정확 |
| `wrong` | 핵심 type/action/state/cause 오판 또는 근거 없는 event 생성 |
| `uncertain` | 제공된 원문만으로 독립 판정 불가 |

### 결과

| 평가군 | correct | mostly | wrong | uncertain | correct+mostly | high인데 non-correct |
|---|---:|---:|---:|---:|---:|---:|
| 상세코드 확정형 79개 template | 61 (77.2%) | 14 | 2 | 2 | 75 (94.9%) | 17/78 (21.8%) |
| 제목 해석형 81개 template | 62 (76.5%) | 2 | 17 | 0 | 64 (79.0%) | 19/81 (23.5%) |
| **고유 template 합계 160건** | **123 (76.9%)** | **16** | **19** | **2** | **139 (86.9%)** | **36/159 (22.6%)** |
| 본문 의존 실공시 13건 | 6 (46.2%) | 4 | 3 | 0 | 10 (76.9%) | 7/13 (53.8%) |

160건 결과는 template 단위 품질이며 실제 시장 빈도로 가중한 record 단위 정확도는 아니다. 반대로 반복 IR 공시처럼 쉬운 동일 template이 대량 포함되는 효과를 제거해 규칙의 의미 다양성을 더 엄격하게 본다.

### 이중평가 일치도

제목 해석형 중 event type을 층화해 결정론적으로 뽑은 40건은 두 서브에이전트가 서로의 결과를 보지 않고 독립 평가했다.

- 4등급 완전 일치: **38/40 (95.0%)**
- Cohen's kappa: **0.890**
- `correct+mostly` 대 `wrong+uncertain` 이진 판정 일치: **40/40 (100%)**
- 불일치 2건도 `correct` 대 `mostly_correct` 경계였고 핵심 오분류 여부에는 이견이 없었다.

따라서 핵심 오분류 결론은 한 평가자의 성향만으로 설명하기 어렵다.

### 필드별 오류 집중도

160개 template에서 해당 필드 오류가 지적된 건수다. 한 사례에 여러 필드 오류가 있을 수 있다.

| 필드 | 오류 template | 비율 | 대표 문제 |
|---|---:|---:|---|
| `action` | 31 | 19.4% | 결정·예정을 `acquired/disposed/borrowed/halted/lifted` 같은 실행·완료형으로 변환 |
| `cause` | 14 | 8.8% | 거래 subtype, 문서 종류, 동기, 실제 원인을 한 축에 혼합 |
| `subjectType` | 13 | 8.1% | `issuer`, `governance`, `ownership`이 행위자·도메인·대상을 혼합 |
| `state` | 5 | 3.1% | filing 정정/첨부 상태와 event lifecycle을 혼합하거나 효력일 조기 확정 |
| `type` | 4 | 2.5% | 타사 증권투자·락업 등을 `capital-change`, 자발적 청산을 `insolvency`로 분류 |

type 라우팅보다 action 시점과 하위 필드가 실제 병목이라는 뜻이다.

### 실제 오분류 예시

| 접수번호 | 원문 의미 | 현재 결과의 문제 |
|---|---|---|
| `20260518800942` | 제3자배정 유상증자 계획, 금액·시기 미확정 | `rights-offering`으로 잘못 구체화 |
| `20260710800261` | 공시 후 예정된 의무보유 해제 | `capital-change/lifted`로 도메인·시제 모두 과진행 |
| `20260716801118` | 타사 CB 취득 결정, 취득일은 미래 | 자사 `capital-change/acquired`로 분류 |
| `20260713000472` | 유형자산 양수 결정, 등기일은 미래 | `acquired`; `[첨부추가]`를 `corrected`로 오인 |
| `20260720800419` | 다음 날 시작되는 생산중단 | 공시 시점부터 `halted`로 확정 |
| `20260720800459` | 실제 차입이 아닌 차입한도 증액 결정 | `borrowed`로 허위 실행 상태 생성 |
| `20260716000632` | 주식매수선택권 일부 취소 정정 | 상세코드 default 때문에 `granted` 유지 |
| `20260630000857` | 주식의 포괄적 교환·이전 결과 | `merger`로 오분류 |

상세코드 확정형의 주요 약점은 J001 대규모 내부거래였다. 매수·출자·증여·임대·차입·처분이 모두 `related-party/reported/internal-transaction/issuer`로 평탄화돼 type은 맞아도 action/cause/subjectType의 실제 의미가 사라졌다.

## 본문 제목 필드가 출력을 바꾼 사례

동일한 generic form 제목이 본문에 따라 서로 다른 이벤트가 됐다.

| 공시 form | 본문 제목 | 결과 |
|---|---|---|
| 투자판단관련주요경영사항 | 정비사업 시공자 선정 | `material-contract / selected / construction-project` |
| 투자판단관련주요경영사항 | CDMO 생산 중단 | `operating-status / halted / production-suspension` |
| 수시공시의무관련사항 | 중장기 주주환원정책 | `corporate-action / announced / shareholder-return-policy` |
| 수시공시의무관련사항 | 자기주식 소각 계획 | `corporate-action / planned / share-cancellation` |
| 기타안내사항 | 의무보유 기간 만료 | 현재 규칙: `capital-change / lifted / lockup` |
| 기타경영사항 | 경영권 매각 추진 | `ownership-change / initiated / control-sale` |

이 사례들은 generic form 전체를 보고서명만으로 하나의 event type에 고정하면 안 된다는 근거다. 다만 의무보유 사례처럼 body title을 읽고도 도메인과 효력 시점을 틀릴 수 있으므로, 제목 fallback 성공 자체를 정답으로 간주해서는 안 된다.

## 품질 문제의 구조적 원인

1. **본문을 읽는 범위가 너무 좁다.** 현재 `semanticCompact`는 보고서명, remarks, 문서의 제목 필드만 합친다. 결정일·예정일·효력일·정정 내용을 읽지 않는다.
2. **action이 서로 다른 단계를 섞는다.** `filed/reported`, `decided/planned`, `acquired/disposed`, `halted/lifted`가 한 enum에 있지만 단계 전이 조건이 없다.
3. **state가 filing 상태와 event 상태를 섞는다.** `[첨부추가]`도 `corrected`로 들어가고 `planned/proposed`, `lifted/lifted`처럼 action과 중복된다.
4. **cause가 실제 원인이 아니다.** `rights-offering`, `annual-report`, `capital-strengthening`, `accounting-violation`처럼 거래 종류·문서 종류·목적·원인이 같은 축에 있다.
5. **subjectType의 존재론적 층이 다르다.** 대상(`asset`)과 행위자(`issuer`), 도메인(`governance`)이 섞여 있다.
6. **type 경계가 넓고 facet과 event를 혼동한다.** `capital-change`가 증권문서·락업·외부증권투자까지 포함하고, `related-party`는 실제 거래와 별도 event로 중복 생성된다.
7. **confidence가 calibration이 아니다.** `document-aware`는 첫 event가 `other`가 아니면 근거 강도와 무관하게 모두 `high`로 반환한다.

## 권장 구현 방향

1. **canonical 계약부터 수정한다.** 공시 wrapper 상태를 `filing.state`로 분리하고, 거래/문서 subtype용 `kind`를 추가해 `cause`는 실제 trigger/motive만 남긴다.
2. **action 시제 규칙을 추가한다.** 제목이 `결정`이면 기본 action은 `decided`; 예정일이 미래면 `planned/scheduled`; 결과보고서나 완료 근거가 있을 때만 완료형을 허용한다.
3. **본문 구조 필드를 확대한다.** 제목뿐 아니라 결정일·예정일·효력일·완료일, 정정 항목, 배정방식, 거래대상을 파싱한다. 전건 자유본문 keyword scan은 피한다.
4. **type 경계를 정리한다.** `capital-change`를 법적 자본/주식수 변화로 좁히고 증권문서, 외부투자, 락업/상장, 자기주식을 분리한다. `related-party`는 event가 아니라 facet으로 둔다.
5. **subjectType을 closed enum으로 검증한다.** action의 직접 목적어만 허용하고 행위자·도메인명은 별도 필드로 이동한다.
6. **confidence를 event/field별로 계산한다.** 필수 필드 중 최저 confidence를 overall 상한으로 사용하고, generic 본문 부재·시점 미확인·source 충돌에는 hard cap을 둔다.
7. **근거가 부족하면 보류한다.** 억지로 4개 필드를 채우지 않고 `needsClassifier=true` 또는 null을 정상 결과로 인정한다.
8. **ML/LLM은 마지막 fallback으로 제한한다.** 위 계약과 결정론적 구조 파서로 해결되지 않는 generic 사례만 보낸다.
9. **temporal holdout으로 재평가한다.** 다음 달 신규 공시를 규칙 동결 후 이중 리뷰하고 type/action/time/kind/subject/confidence calibration을 별도로 측정한다.

최소 권장 결과 계약은 다음과 같다.

```ts
type CanonicalDisclosureResult = {
  filing: {
    state: 'original' | 'corrected' | 'attachment-added' |
           'correction-requested' | 'terms-finalized' | 'extended';
  };
  events: Array<{
    type: EventType;
    action: EventAction;
    state: EventLifecycle | null;
    kind: EventKind | null;
    cause: EventCause | null;
    subjectType: SubjectType | null;
    confidence: {
      overall: 'high' | 'medium' | 'low';
      fields: Partial<Record<
        'type' | 'action' | 'state' | 'kind' | 'cause' | 'subjectType',
        'high' | 'medium' | 'low'
      >>;
    };
    evidence: Array<{
      source: 'detail-code' | 'report-title' | 'document-field' | 'document-body';
      locator: string;
      text?: string;
    }>;
  }>;
};
```

## 상세코드 수집 비용

OpenDART `list.json`의 `pblntf_detail_ty`는 요청 필터이며 일반 전체조회 응답의 행별 필드로 보장되지 않는다. 현재 crawler도 필터 요청값을 provenance로 보존하는 방식이다. 따라서 상세코드를 안정적으로 확보하려면 61개 공식 상세유형별 검색 결과를 수집하고 접수번호로 중복 제거해야 한다.

이 작업을 사용자 DeepScan 요청마다 수행하면 안 된다. 기간별 KOSPI 공시를 scheduled batch로 수집해 상세코드와 원문 해석 결과를 캐시하고, 온라인 요청에서는 캐시를 조회하는 구성이 적합하다.

## 아직 정확도라고 부를 수 없는 부분

- 35건 대조 gold와 13건 body reviewed set은 현재 규칙 개발에도 사용됐으므로 미래 시점 holdout이 아니다.
- 정성평가는 독립 서브에이전트 감사이며 금융/공시 전문가가 확정한 법적 ground truth는 아니다.
- 160건 결과는 고유 template 단위라 실제 공시 빈도로 가중한 시장 전체 record 정확도가 아니다.
- body reviewed set은 독립 재검토했지만 13건 전체에 대한 사람 이중 라벨 합의 데이터는 아니다.
- 61개 공식 상세유형 중 이 기간 KOSPI에서 실제 관측된 유형은 29개다.
- 본문 연구 305건 중 11건은 원본 부재 또는 resource limit으로 가져오지 못했다.
- 추출 시간 약 58µs/건은 이미 내려받은 텍스트의 처리 시간이며 원문 네트워크 비용을 포함하지 않는다.

따라서 현재 결과는 계층형 아키텍처 선택과 실패 유형 우선순위 결정에는 충분하지만, “전체 KOSPI 공시 full-event 정확도 100%”를 의미하지 않는다. 현재 후보를 `high-confidence canonical extractor`로 배포하면 안 된다. canonical 계약·시간 규칙·confidence를 수정한 뒤 다음 달 신규 공시 temporal holdout을 이중 리뷰해야 한다.
