# OpenDART 분류 정확도 독립 subagent 평가

평가일: 2026-07-28
대상: 동결된 150건 OpenDART 다양성 표본과 v8 canonical event 출력

## 판정

**헤드라인 수치는 재현됐지만, 현재 분류기를 “정확도가 높다”고 평가하기는 어렵다.**

- 본문 확보 138건에서 다섯 필드 event multiset 완전 일치: **50/138, 36.2%**
- 원래 본문 미확보 12건까지 포함한 end-to-end: **50/150, 33.3%**
- 95% Wilson 구간: 조건부 **28.7–44.5%**, end-to-end **26.3–41.2%**
- 다섯 필드 micro accuracy: **58.4%**
- exact tuple event F1: **31.2%**

이는 동결된 agent-adjudicated gold에 대한 **엄격한 canonical contract 일치율**이다.
KOSPI 전체 모집단 정확도, ontology 자체의 정답성, 투자 판단 유용성을 뜻하지 않는다.

## Subagent 검증 결과

### 1. 숫자 독립 검증

숫자 검증 subagent가 기존 scorer를 호출하지 않고 Python으로 다시 계산했다.

- strict exact `50/138` 및 end-to-end `50/150` 재현
- 필드 일치 `124/93/105/115/106`, denominator 186 재현
- gold/predicted event `186/141`, exact-count `127/138` 재현
- source·gold SHA-256과 150개 접수번호의 순서·유일성 확인
- 확보된 본문 138개의 SHA-256이 원래 실행과 모두 일치
- exact 12건과 mismatch 19건을 본문으로 추가 점검했으며 명백한 점수 반전 오류는 발견하지 못함

따라서 **동결된 gold 기준 36.2%라는 계산 자체는 PASS**다.

### 2. 방법론 비판 검증

방법론 비판 subagent의 판정은 **PARTIAL**이다.

- A/B 독립 annotator의 exact label agreement는 **79/138, 57.2%**였다.
- A label 기준 정확도는 **52/138, 37.7%**, B 기준은 **46/138, 33.3%**였다.
- 둘 중 하나를 정답으로 허용하면 **55/138, 39.9%**다.
- 두 annotator가 모두 동일한 tuple을 지지하고 예측도 일치한 보수적 하한은 **43/138, 31.2%**다.
- final adjudication과 선언된 대안까지 넓힌 상한은 **57/138, 41.3%**다.

따라서 실무적으로는 **점 추정치 36.2%, 주된 라벨 선택 민감도 33.3–39.9%, 보수적 전체 범위 31.2–41.3%**로 읽는 편이 정직하다. Wilson 구간은 표본 불확실성만 나타내며 ontology·adjudication 불확실성은 포함하지 않는다.

## 무엇은 잘 되고 무엇은 부족한가

gold와 prediction이 모두 단일 event인 124건만 보면 다음과 같다.

| 지표 | 결과 |
|---|---:|
| `type` | 109/124, **87.9%** |
| `cause` | 107/124, **86.3%** |
| `type + cause` 동시 일치 | 93/124, **75.0%** |
| `action + state` 동시 일치 | 73/124, **58.9%** |
| 다섯 필드 완전 일치 | 50/124, **40.3%** |

즉, **공시의 큰 종류를 라우팅하는 능력은 비교적 괜찮지만 lifecycle과 subject까지 완성된 canonical event로 만드는 능력은 낮다.**

88건의 strict 실패는 모두 하나 이상의 필드·ontology 경계 불일치를 포함했다. 그중 11건은 event 수도 함께 부족했지만, event 수만 완화해서 exact로 바뀌는 사례는 없었다.

주요 취약 구간은 다음과 같다.

- correction: **3/23, 13.0%**
- gold event 2개 이상: **0/14**
- `action`: **50.0%**
- `state`: **56.5%**
- `subjectType`: **57.0%**
- 반복 경계: `capital-change` 대 `corporate-action`, correction lifecycle, `issuer` 대 `financials`, `securities` 대 `listed-shares`

## 최종 해석

현재 결과는 “분류 정확도가 엄청 개선됐다”가 아니라 다음 단계에 가깝다.

1. `type`·`cause` 중심의 **1차 공시 라우팅은 실용 가능성이 보인다.**
2. `action`·`state`·`subjectType`을 포함한 **완전한 canonical 객체는 아직 연구·개선 단계다.**
3. correction과 복수 event 공시를 별도 gate로 분리하고, ontology 경계 규칙을 먼저 고정해야 한다.
4. 외부 도메인 전문가가 만든 holdout gold로 재평가하기 전에는 36.2%를 일반화하면 안 된다.

상세 케이스와 strata는 [`accuracy-report.md`](./accuracy-report.md), 기계 판독 원본은 [`accuracy-results.json`](./accuracy-results.json)에서 확인할 수 있다.
