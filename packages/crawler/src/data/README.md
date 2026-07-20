# KR 공시 분류 데이터셋 운영

공시 분류는 분류 함수만 추가해서 완성되는 기능이 아니다. 이 디렉터리의 기준 데이터와
검증용 골드 코퍼스를 먼저 갱신한 뒤 분류 엔진을 변경한다.

## 데이터 계층

1. `kr-disclosure-classification-dataset.js`
   - OpenDART 공식 `pblntf_ty` 10종과 `pblntf_detail_ty` 61종
   - Jaroo 의미 카테고리, 중요도, 위험도 기본값, dump policy
   - 실제 제목 변형을 정규화해 매칭하는 버전 관리 규칙
   - 제목만으로 확정할 수 없는 상세유형의 `title_required` 표시
2. `../../test/fixtures/kr-disclosure-classification-gold.v1.json`
   - OpenDART에서 실제 관측한 보고서명과 접수번호
   - 사람이 확인한 기대 category/materiality/risk/dump policy
   - 의도적으로 분류를 보류해야 하는 ambiguous 케이스
   - 상장폐지 위험 제목 변형
3. `.omx/context/dart-classification-audit-*.json`
   - 라이브 API에서 생성하는 재현 가능한 감사 산출물
   - 원시 관측 자료이므로 커밋하지 않는다.

## 갱신 절차

```bash
npm --prefix packages/crawler run audit:dart-disclosure-classification -- \
  --from=20260421 --to=20260720 --per-type=5
```

1. `providerLabeled`와 실제 일반 수집 조건인 `titleOnly`의 ambiguous 비율을 각각 본다.
2. ambiguous 또는 오분류 표본을 원문/공식 상세유형과 대조한다.
3. 의미가 확정되는 제목만 분류 데이터셋 규칙에 추가한다.
4. 해당 실제 표본을 접수번호와 함께 골드 fixture로 승격한다.
5. 제목만으로 확정할 수 없는 표본은 억지 규칙을 만들지 않고 `needsClassifier`로 남긴다.
6. 데이터셋 단위 테스트와 전체 crawler 테스트를 실행한다.

감사 스크립트의 현재 분류 결과를 그대로 정답으로 복사하지 않는다. 그렇게 하면 엔진이
자기 출력을 검증하는 순환 테스트가 된다. 골드 라벨은 공식 유형과 공시 의미를 별도로
확인한 뒤 기록한다.
