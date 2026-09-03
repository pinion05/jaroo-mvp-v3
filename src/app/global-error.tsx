'use client'

// 전역 클라이언트 크래시 바운더리 — 이 파일이 없으면 Next 기본 영어 화면
// ("This page couldn't load")이 뜬다. 한국어 안내 + 서버 리포트를 제공한다.
// global-error 는 <html>/<body>를 직접 그려야 하며 외부 CSS를 신뢰할 수 없어 인라인 스타일만 쓴다.

import { useEffect } from 'react'

const REPORT_FLAG_PREFIX = 'jaroo-client-error-reported:'

function reportOnce(error: Error & { digest?: string }): void {
  if (typeof window === 'undefined') return
  try {
    const flagKey = `${REPORT_FLAG_PREFIX}${error.digest ?? error.message.slice(0, 120)}`
    if (window.sessionStorage.getItem(flagKey)) return
    window.sessionStorage.setItem(flagKey, '1')
  } catch {
    // sessionStorage 접근 불가여도 리포트는 시도한다
  }

  void fetch('/api/client-errors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    keepalive: true,
    body: JSON.stringify({
      message: String(error?.message ?? 'Unknown client error'),
      stack: error?.stack,
      digest: error?.digest,
      page_url: window.location.href,
      userAgent: window.navigator.userAgent,
    }),
  }).catch(() => {
    // 리포트 실패는 무시 — 화면 복구가 우선
  })
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    reportOnce(error)
  }, [error])

  return (
    <html lang='ko'>
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f6f6f4',
          fontFamily:
            "system-ui, -apple-system, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif",
          color: '#1a1f27',
        }}
      >
        <div
          style={{
            width: 'min(420px, calc(100vw - 48px))',
            padding: '32px 24px',
            background: '#ffffff',
            borderRadius: 16,
            border: '1px solid #e3e3df',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>화면을 불러오지 못했어요</div>
          <div style={{ fontSize: 14, lineHeight: 1.6, color: '#5a6472', marginBottom: 20 }}>
            일시적인 문제로 이 화면을 표시하지 못했어요.
            <br />
            문제 정보는 자동으로 전달되었어요.
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button
              type='button'
              onClick={reset}
              style={{
                padding: '12px 20px',
                borderRadius: 10,
                border: 'none',
                background: '#0f1419',
                color: '#ffffff',
                fontSize: 15,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              다시 시도
            </button>
            <a
              href='/home'
              style={{
                padding: '12px 20px',
                borderRadius: 10,
                border: '1px solid #d5d8dd',
                background: '#ffffff',
                color: '#1a1f27',
                fontSize: 15,
                fontWeight: 600,
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
              }}
            >
              홈으로
            </a>
          </div>
          {error?.digest ? (
            <div style={{ marginTop: 16, fontSize: 12, color: '#9aa3ad', wordBreak: 'break-all' }}>
              참고 코드 {error.digest}
            </div>
          ) : null}
        </div>
      </body>
    </html>
  )
}
