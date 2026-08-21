# OpenDART 150건 canonical event 정확도 감사 방법론

## 목적

`source-data.json`에 동결된 150건의 예측을 공식 OpenDART 본문으로 만든
prediction-blind gold와 비교한다. 기존 `qualitative-review.json`의
`plausible` 판정은 정답으로 사용하지 않는다.

이 결과는 detail-type 다양성을 우선한 고정 cohort의 기술통계다. KOSPI 전체
공시 모집단의 정확도로 일반화하지 않는다.

## 독립성

1. gold annotator는 예측, confidence, review flag, 기존 정성평가 및 extractor
   구현을 보지 않는다.
2. 각 assessable 공시는 서로 독립적인 두 annotator가 라벨한다.
3. 두 gold event multiset이 다르면 prediction을 보지 않은 제3 adjudicator가
   공식 본문과 ontology만으로 최종 gold를 결정한다.
4. 최종 gold가 동결된 뒤에만 저장된 예측을 공개하고 점수를 계산한다.

## 입력과 provenance

- 대상 예측: `../source-data.json`에 저장된 `eventExtraction`
- ontology: `packages/crawler/src/services/deepscan-kr-disclosure-event-ontology.js`
- 표본: 150건
- 원래 본문 확보: 138건
- 원래 본문 미확보: 12건
- 원래 extractor 입력이 80,000자에서 잘린 공시: 16건

원래 확보된 138건은 `document.xml`을 재수집해 저장된 `bodySha256`과
일치해야 annotation에 사용한다. gold는 공식 전체 본문을 사용하지만 예측은
당시 저장된 값을 그대로 유지하며 현재 코드로 다시 실행하지 않는다.

## Gold 계약

각 event는 정확히 다음 다섯 필드를 가진다.

```json
{
  "type": "...",
  "action": "... | null",
  "state": "... | null",
  "cause": "... | null",
  "subjectType": "... | null"
}
```

- `type`은 필수이며 `other`는 resolved gold로 허용하지 않는다.
- 나머지 필드의 `null`은 본문이 그 차원을 확립하지 않았다는 뜻이다.
- 동일 tuple이라도 서로 다른 occurrence이면 중복을 보존한다.
- gold 범위는 제목·세부유형과 정정의 operative content가 지시하는
  **문서 단위 공시 의도**다. 장문 정기보고서나 비교표에 배경·과거사실로
  언급된 모든 사건을 별도 gold event로 만들지 않는다.
- 정정 wrapper 자체는 별도 event가 아니다. 정정 후 substantive lifecycle을
  라벨하며, 독립 occurrence가 확인될 때만 cardinality를 늘린다.
- 복합 사건은 변경 필드 수가 아니라 독립적인 실제 occurrence 수로 나눈다.

## 지표

### 1. Exact canonical event multiset accuracy

공시별 predicted event와 gold event를 **순서 무관·중복 민감 multiset**으로
비교한다. 모든 event의 다섯 필드와 중복 개수가 같아야 1점이다.

```text
available exact accuracy
  = exact 공시 수 / 원래 본문 확보 및 gold 확정 공시 수
```

### 2. 필드 정확도

공시 안에서 gold와 prediction event를 다섯 필드 일치 수가 최대가 되도록
일대일 정렬한다. unmatched event는 다섯 필드 모두 오답이다.

```text
field denominator per filing = max(gold event 수, predicted event 수)
```

`type`, `action`, `state`, `cause`, `subjectType` 및 전체 micro field accuracy를
각각 보고한다.

### 3. Cardinality

의미와 별도로 count-only precision/recall/F1, exact-count filing rate,
overprediction 및 underprediction 수를 보고한다. 또한 exact tuple의 중복 민감
precision/recall/F1을 별도로 계산한다.

### 4. End-to-end usable accuracy

원래 150건 전체를 denominator로 사용한다. 원래 실행에서 본문을 확보하지
못한 12건은 사후 재수집 여부와 무관하게 0점이다.

```text
end-to-end usable accuracy = 원래 실행에서 확보·resolved·exact였던 공시 / 150
```

## 보고 규칙과 한계

- 1차 annotation 중 장문 공시의 행·과거사건을 과분할하는 문제가 발견되어
  위의 문서 단위 공시 의도 규칙을 handbook에 동결했다. 예측을 공개하기 전에
  A/B annotator가 각자 담당했던 전체 slice를 이 규칙으로 다시 검토했다.
- 이상적으로는 cohort 밖 pilot으로 handbook을 먼저 동결해야 했으나 이번
  실행에서는 cohort 내부 calibration 후 전수 재검토를 사용했다.
- 모든 비율은 분자/분모와 함께 표시한다.
- 공시 exact 지표에는 95% Wilson 구간을 함께 표시한다.
- correction, truncated body, confidence 및 gold cardinality strata를 분리한다.
- annotator 불일치와 adjudication 비율을 공개한다.
- ontology의 표현 적절성은 extractor 정확도와 별개의 문제로 기록한다.
- 기존 `97.8% plausible`은 이 정확도 감사의 입력이나 정답률이 아니다.
