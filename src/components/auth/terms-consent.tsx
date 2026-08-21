'use client'

import { useCallback, useSyncExternalStore } from 'react'
import { TERMS_CONSENT_STORAGE_KEY } from '@/lib/terms'

const CONSENT_CHANGE_EVENT = 'jaroo:terms-consent-change'

// 필수 가입 동의 상태. 체크 시점(ISO)을 localStorage 에 남겨 재방문 시 유지하고,
// OAuth 콜백/이메일 가입에서 서버 동의 기록(profiles.terms_accepted_at)의 근거로 쓴다.
// /login(시안 UI)과 /signup(AuthForm) 양쪽에서 공유한다.
// localStorage 를 외부 스토어로 다루는 useSyncExternalStore 패턴이라 SSR(hydration)에도 안전하다.
function subscribe(callback: () => void) {
  window.addEventListener('storage', callback)
  window.addEventListener(CONSENT_CHANGE_EVENT, callback)
  return () => {
    window.removeEventListener('storage', callback)
    window.removeEventListener(CONSENT_CHANGE_EVENT, callback)
  }
}

function getSnapshot(): string | null {
  return window.localStorage.getItem(TERMS_CONSENT_STORAGE_KEY)
}

function getServerSnapshot(): string | null {
  return null
}

function normalizeConsentAt(value: string | null): string | null {
  if (!value || Number.isNaN(Date.parse(value))) return null
  return value
}

export function useTermsConsent() {
  const stored = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const consentAt = normalizeConsentAt(stored)

  const toggleTermsAgreed = useCallback((next: boolean) => {
    if (next) {
      window.localStorage.setItem(TERMS_CONSENT_STORAGE_KEY, new Date().toISOString())
    } else {
      window.localStorage.removeItem(TERMS_CONSENT_STORAGE_KEY)
    }
    // 같은 탭에서의 변경도 구독자가 반영하도록 알린다(storage 이벤트는 탭 간에만 발생).
    window.dispatchEvent(new Event(CONSENT_CHANGE_EVENT))
  }, [])

  return { termsAgreed: consentAt !== null, consentAt, toggleTermsAgreed }
}
