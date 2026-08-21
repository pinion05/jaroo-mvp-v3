// 약관/개인정보처리방침 개정 관리. 버전을 올리면 문서 페이지와
// 로그인 동의 기록(profiles.terms_version)이 함께 갱신된다.
export const TERMS_VERSION = 'v1'
export const TERMS_EFFECTIVE_DATE = '2026-08-20'

// 브라우저에 저장하는 마지막 동의 시점(ISO 문자열). 재방문 시 체크박스를 유지하고,
// OAuth 콜백/이메일 가입에서 서버 동의 기록의 근거로 쓴다.
export const TERMS_CONSENT_STORAGE_KEY = 'jaroo:terms-consent:v1'
