'use client'

import { useCallback, useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'

import { WatchAlertLevelSelector } from '@/components/watch-alert-level'

// 워치 관리 섹션 — 실제 watch_items 목록(등록 해지) + 계정 단위 알림 강도 선택(#222 §3-6).
// 아래 포트폴리오 목록과 별개 데이터다(watch_items vs portfolio_holdings).

type WatchRow = {
  code: string
  name: string | null
  market: string | null
}

export function WatchManageSection() {
  const [rows, setRows] = useState<WatchRow[] | null>(null)
  const [pendingCode, setPendingCode] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const res = await fetch('/api/watch')
      if (!res.ok) return
      const body = (await res.json().catch(() => ({}))) as { rows?: WatchRow[] }
      setRows(body.rows ?? [])
    } catch {
      setRows([])
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const remove = async (row: WatchRow) => {
    if (!window.confirm(`${row.name ?? row.code} 지켜보기를 그만둘까요?`)) return
    setPendingCode(row.code)
    try {
      const res = await fetch(`/api/watch?code=${encodeURIComponent(row.code)}`, { method: 'DELETE' })
      if (res.ok) {
        setRows((previous) => (previous ?? []).filter((item) => item.code !== row.code))
      } else {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        window.alert(body.error ?? '일시적인 문제예요. 잠시 후 다시 시도해주세요.')
      }
    } catch {
      window.alert('일시적인 문제예요. 잠시 후 다시 시도해주세요.')
    } finally {
      setPendingCode(null)
    }
  }

  return (
    <section aria-label='워치 관리' className='mb-4 rounded-[12px] border-[0.5px] border-[#d7e0ea] bg-white p-3.5'>
      <h2 className='mb-1 text-[13px] font-bold text-[#0F1419]'>워치 관리</h2>
      <p className='mb-3 text-[11.5px] leading-snug text-[#8a95a3]'>
        지켜보는 종목의 변화를 텔레그램으로 알려드려요. 강도는 계정에 하나만 적용돼요.
      </p>
      <div className='mb-3'>
        <WatchAlertLevelSelector compact />
      </div>
      {rows == null ? (
        <div className='text-[11.5px] text-[#97A0AE]'>워치 목록을 불러오는 중이에요…</div>
      ) : rows.length === 0 ? (
        <div className='text-[11.5px] text-[#97A0AE]'>지켜보는 종목이 없어요. 딥스캔 결과에서 등록할 수 있어요.</div>
      ) : (
        <ul className='space-y-1.5'>
          {rows.map((row) => (
            <li key={row.code} className='flex items-center justify-between rounded-[10px] border-[0.5px] border-[#e3e9f0] px-3 py-2'>
              <div className='min-w-0'>
                <div className='truncate text-[12.5px] font-semibold text-[#0F1419]'>{row.name ?? row.code}</div>
                <div className='text-[10.5px] text-[#97A0AE]'>{row.market ?? ''} · {row.code}</div>
              </div>
              <button
                type='button'
                disabled={pendingCode === row.code}
                onClick={() => void remove(row)}
                className='flex size-8 items-center justify-center rounded-full text-[#97A0AE] transition-colors hover:bg-[#f3f5f7] hover:text-[#d64545] disabled:opacity-50'
                aria-label={`${row.name ?? row.code} 지켜보기 해지`}
              >
                <Trash2 className='size-4' />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
