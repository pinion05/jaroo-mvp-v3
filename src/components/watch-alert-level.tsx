'use client'

import { useEffect, useState } from 'react'

import { WATCH_ALERT_LEVELS, type WatchAlertLevel } from '@/lib/watch/levels'

// 워치 알림 강도 선택기(#222 §3-6) — 계정 단위 설정(종목별 설정 없음).
// 딥스캔 결과 워치 카드와 워치 관리 페이지 두 곳에서 쓴다.
// 안전 하한선(거래정지·상장폐지 등 중대 공시)은 어떤 강도에서도 발송된다 — 끌 수 없음을 명시.

const SELECTED_CLASS_BY_TONE = {
  light: 'border-[#0F1419] bg-[#0F1419] text-white',
  dark: 'border-white bg-white text-[#0F1419]',
}
const IDLE_CLASS_BY_TONE = {
  light: 'border-[#d7e0ea] bg-white text-[#5b6673] hover:border-[#9fb2c5]',
  dark: 'border-transparent bg-white/5 text-white/60 hover:text-white/85',
}

export function WatchAlertLevelSelector({ compact = false, tone = 'light' }: { compact?: boolean; tone?: 'light' | 'dark' }) {
  const [level, setLevel] = useState<WatchAlertLevel | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const res = await fetch('/api/watch/settings')
        if (!res.ok) return
        const body = (await res.json().catch(() => ({}))) as { alertLevel?: WatchAlertLevel }
        if (active) setLevel(body.alertLevel ?? 'normal')
      } catch {
        // 조회 실패 시 기본값 표시 (변경 시 서버가 진짜 저장을 담당)
        if (active) setLevel('normal')
      }
    })()
    return () => {
      active = false
    }
  }, [])

  const update = async (next: WatchAlertLevel) => {
    if (pending || next === level) return
    setPending(true)
    const previous = level
    setLevel(next)
    try {
      const res = await fetch('/api/watch/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alertLevel: next }),
      })
      if (!res.ok) {
        setLevel(previous)
        window.alert('일시적인 문제예요. 잠시 후 다시 시도해주세요.')
      }
    } catch {
      setLevel(previous)
      window.alert('일시적인 문제예요. 잠시 후 다시 시도해주세요.')
    } finally {
      setPending(false)
    }
  }

  if (level == null) {
    return null
  }

  const activeLabel = WATCH_ALERT_LEVELS.find((item) => item.value === level)?.label ?? ''
  const activeHint = WATCH_ALERT_LEVELS.find((item) => item.value === level)?.hint ?? ''

  return (
    <div className={compact ? 'space-y-1.5' : 'space-y-2'}>
      <div className='flex flex-wrap items-center gap-1.5'>
        <span className={`text-[11px] font-semibold ${tone === 'dark' ? 'text-white/70' : 'text-[#5b6673]'}`}>알림 강도</span>
        <div className={`flex overflow-hidden rounded-full border ${tone === 'dark' ? 'border-white/20' : 'border-[#d7e0ea]'}`}>
          {WATCH_ALERT_LEVELS.map((item) => (
            <button
              key={item.value}
              type='button'
              disabled={pending}
              onClick={() => void update(item.value)}
              className={`px-2.5 py-1 text-[11px] font-semibold transition-colors disabled:opacity-60 ${
                level === item.value ? SELECTED_CLASS_BY_TONE[tone] : IDLE_CLASS_BY_TONE[tone]
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <p className={`text-[11px] leading-snug ${tone === 'dark' ? 'text-white/45' : 'text-[#8a95a3]'}`}>
        {activeLabel} · {activeHint}
        {level !== 'minimal' ? ' · 주 1회 요약 포함' : ''}
        <br />
        거래정지·상장폐지 같은 중대 공시는 강도와 무관하게 반드시 보내드려요.
      </p>
    </div>
  )
}
