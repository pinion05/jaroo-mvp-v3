#!/bin/bash
# /api/ocr 남용 방지 가드 E2E 매트릭스 (2026-09-14, 코드 감사 B1 후속)
#
# 용법 — dev 스택을 띄우고 서로 다른 유저 2명의 로그인 쿠키 jar를 준비한 뒤:
#   JAR_A=/tmp/u1.jar JAR_B=/tmp/u2.jar [BASE_URL=http://localhost:3000] bash scripts/ocr-guard-matrix.sh
#
# 준비(쿠키 jar): 각 유저로 /auth/dev-set-session?access_token=..&refresh_token=.. 을
# curl -c <jar> 로 한 번 호출하면 httpOnly 세션이 jar에 심긴다.
# JAR_A는 신규 유저(레이트리밋 버킷 비어있음)여야 병렬 원자성 검증이 유효하다.
# 카운트되는 TC(400/413)는 JAR_B를 사용해 JAR_A 버킷을 보존한다(JAR_B는 ≤9회 소진).
#
# 검증 항목: origin 위조/통과, 세션 위조/게스트, 크기 상한(경계+1·chunked),
# 본문 형식 변형, 메서드, no-store 헤더, 병렬 레이트리밋 원자성, 유저 격리.

set -u
BASE_URL="${BASE_URL:-http://localhost:3000}"
API="$BASE_URL/api/ocr"
JAR_A="${JAR_A:?JAR_A(신선 유저 쿠키 jar)를 지정하세요}"
JAR_B="${JAR_B:?JAR_B(소진용 유저 쿠키 jar)를 지정하세요}"
PASS=0; FAIL=0

chk() { # 설명 기대 실제
  if [ "$3" = "$2" ]; then echo "✓ $1 → $3"; PASS=$((PASS+1))
  else echo "✗ $1 → got $3, want $2"; FAIL=$((FAIL+1)); fi
}
code() { curl -s --max-time 20 -o /dev/null -w '%{http_code}' "$@"; }

BIG_JSON=$(mktemp); trap 'rm -f "$BIG_JSON"' EXIT
python3 -c "print('{\"imageDataUrl\":\"data:image/png;base64,'+'A'*(4*1000*1000+1)+'\"}')" > "$BIG_JSON"

echo "── A. Origin/CSRF ──"
chk "TC1 악성 Origin → 403" 403 "$(code -b "$JAR_A" -X POST $API -H 'Content-Type: application/json' -H 'Origin: https://evil.example' -d '{"imageDataUrl":"not-image"}')"
chk "TC2 자기 Origin 통과(400 도달)" 400 "$(code -b "$JAR_B" -X POST $API -H 'Content-Type: application/json' -H "Origin: $BASE_URL" -d '{"imageDataUrl":"not-image"}')"
chk "TC3 Origin 없음 통과(400 도달)" 400 "$(code -b "$JAR_B" -X POST $API -H 'Content-Type: application/json' -d '{"imageDataUrl":"not-image"}')"

echo "── B. 세션 ──"
chk "TC4 가짜 세션 쿠키 → 401" 401 "$(code -X POST $API -H 'Content-Type: application/json' -H 'Cookie: sb-fake-auth-token=garbage' -d '{"imageDataUrl":"not-image"}')"
chk "TC5 게스트 → 401" 401 "$(code -X POST $API -H 'Content-Type: application/json' -d '{"imageDataUrl":"not-image"}')"

echo "── C. 크기 상한 ──"
chk "TC6 4,000,001자(경계+1) → 413" 413 "$(code -b "$JAR_B" -X POST $API -H 'Content-Type: application/json' --data-binary @"$BIG_JSON")"
chk "TC7 chunked+4.1MB → 413" 413 "$(code -b "$JAR_B" -X POST $API -H 'Content-Type: application/json' -H 'Transfer-Encoding: chunked' --data-binary @"$BIG_JSON")"

echo "── D. 본문 형식 ──"
chk "TC8 plain-text → 400" 400 "$(code -b "$JAR_B" -X POST $API -H 'Content-Type: text/plain' -d 'hello')"
chk "TC9 imageDataUrl 누락 → 400" 400 "$(code -b "$JAR_B" -X POST $API -H 'Content-Type: application/json' -d '{}')"
chk "TC10 숫자 타입 → 400" 400 "$(code -b "$JAR_B" -X POST $API -H 'Content-Type: application/json' -d '{"imageDataUrl":12345}')"
chk "TC11 formData → 400" 400 "$(code -b "$JAR_B" -X POST $API -F imageDataUrl=x)"

echo "── E. 메서드 ──"
chk "TC12 GET → 405" 405 "$(code -b "$JAR_A" $API)"
chk "TC13 OPTIONS → 204(Next 프리플라이트 자동응답, 핸들러 미실행)" 204 "$(code -b "$JAR_A" -X OPTIONS $API)"

echo "── F. no-store 헤더 ──"
chk "TC14 401 no-store" 1 "$(curl -s --max-time 20 -D - -o /dev/null -X POST $API -H 'Content-Type: application/json' -d '{"imageDataUrl":"not-image"}' | grep -ci 'cache-control: no-store')"
chk "TC15 403 no-store" 1 "$(curl -s --max-time 20 -D - -o /dev/null -b "$JAR_A" -X POST $API -H 'Content-Type: application/json' -H 'Origin: https://e.vil' -d '{"imageDataUrl":"not-image"}' | grep -ci 'cache-control: no-store')"
chk "TC16 413 no-store" 1 "$(curl -s --max-time 20 -D - -o /dev/null -b "$JAR_B" -X POST $API -H 'Content-Type: application/json' --data-binary @"$BIG_JSON" | grep -ci 'cache-control: no-store')"

echo "── G. 레이트리밋 원자성·격리 ──"
codes=$(for i in $(seq 1 11); do curl -s --max-time 20 -o /dev/null -w '%{http_code} ' -b "$JAR_A" -X POST $API -H 'Content-Type: application/json' -d '{"imageDataUrl":"not-image"}' & done; wait)
n429=$(echo "$codes" | tr ' ' '\n' | grep -c 429)
chk "TC17 병렬 11동시 → 429 정확히 1회(10 통과+1 차단)" 1 "$n429"
chk "TC18 소진 후 재요청 → 429" 429 "$(code -b "$JAR_A" -X POST $API -H 'Content-Type: application/json' -d '{"imageDataUrl":"not-image"}')"
chk "TC19 타 유저 버킷 독립 → 400" 400 "$(code -b "$JAR_B" -X POST $API -H 'Content-Type: application/json' -d '{"imageDataUrl":"not-image"}')"

echo
echo "═══ OCR 가드 매트릭스: PASS=$PASS FAIL=$FAIL ═══"
[ "$FAIL" -eq 0 ] || exit 1
