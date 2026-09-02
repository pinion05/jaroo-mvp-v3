'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { SpecFrame } from '@/components/spec/spec-frame'
import { cn } from '@/lib/utils'
import { fetchPortfolio, syncPortfolioToServer } from '@/lib/portfolio-sync'
import type { AppliedHomePortfolioRow } from '@/lib/jaroo-home-data'
import styles from '../detail.module.css'

// 마이페이지 > 내 종목 관리 — 실제 계정 포트폴리오(/api/portfolio) 기반.
// 시세 원천에 전일 대비가 없어 손익률은 "내 평단 대비 현재가"로 계산한다.

type QuoteItem = { code?: string; ticker?: string; price?: number; currency?: string; status?: string }

function holdingKey(row: AppliedHomePortfolioRow): string {
  return (row.resolvedCode || row.code || row.resolvedTicker || row.ticker || row.resolvedName || '').trim()
}

/** 평단 대비 현재가 손익률(%) — 시세 없으면 null */
function computeProfitRate(row: AppliedHomePortfolioRow, price?: number): number | null {
  const avg = Number(row.averagePrice)
  if (!price || !Number.isFinite(avg) || avg <= 0) return null
  return ((price - avg) / avg) * 100
}

function formatRate(rate: number | null): string {
  if (rate === null) return '—'
  const sign = rate > 0 ? '+' : ''
  return `${sign}${rate.toFixed(1)}%`
}

function formatAvgPrice(row: AppliedHomePortfolioRow): string {
  const n = Number(row.averagePrice)
  if (!row.averagePrice || !Number.isFinite(n)) return ''
  if (row.averagePriceCurrency === 'USD') {
    return `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
  }
  return `${Math.round(n).toLocaleString('ko-KR')}원` // §5-4 평단 정수 반올림
}

export default function WatchlistPage() {
  const [rows, setRows] = useState<AppliedHomePortfolioRow[] | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'logged-out' | 'error'>('loading')
  const [quotes, setQuotes] = useState<Record<string, number>>({})
  const [deletingKey, setDeletingKey] = useState<string | null>(null)

  const load = useCallback(async () => {
    setStatus('loading')
    const result = await fetchPortfolio()
    if (result.status === 'rows' || result.status === 'empty') {
      setRows(result.status === 'rows' ? result.rows : [])
      setStatus('ready')
    } else if (result.status === 'logged-out') {
      setStatus('logged-out')
    } else {
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // 보유 종목 시세 조회 (KR 코드 기준 — 실패해도 목록은 표시, 손익만 '—')
  useEffect(() => {
    const codes = (rows ?? []).map((r) => (r.resolvedCode ?? r.code ?? '').trim()).filter(Boolean)
    if (codes.length === 0) {
      setQuotes({})
      return
    }
    void (async () => {
      try {
        const res = await fetch(`/api/quotes/current?codes=${encodeURIComponent(codes.join(','))}`)
        if (!res.ok) return
        const payload = (await res.json()) as { data?: { items?: QuoteItem[] } }
        const map: Record<string, number> = {}
        for (const item of payload.data?.items ?? []) {
          if (item.code && typeof item.price === 'number' && item.status === 'ok') {
            map[item.code] = item.price
          }
        }
        setQuotes(map)
      } catch {
        // 시세 조회 실패 — 손익 미표시로 견딤
      }
    })()
  }, [rows])

  const removeHolding = async (row: AppliedHomePortfolioRow) => {
    if (deletingKey) return
    const key = holdingKey(row)
    if (!window.confirm(`${row.resolvedName || row.name}을(를) 종목 목록에서 뺄까요?`)) return
    setDeletingKey(key)
    try {
      const next = (rows ?? []).filter((r) => holdingKey(r) !== key)
      const result = await syncPortfolioToServer(next)
      if (result.ok) {
        setRows(next)
      } else if (result.reason === 'logged-out') {
        window.alert('로그인이 만료되었어요. 다시 로그인해주세요.')
      } else {
        window.alert('일시적인 문제로 삭제하지 못했어요. 잠시 후 다시 시도해주세요.')
      }
    } finally {
      setDeletingKey(null)
    }
  }

  return (
    <SpecFrame backHref='/mypage' title='내 종목 관리' showBottomNav>
      <div className={styles.body}>
        {status === 'loading' ? (
          <div className={styles.subLabel}>종목을 불러오는 중이에요…</div>
        ) : status === 'logged-out' ? (
          <div className={styles.subLabel}>
            로그인이 만료되었어요. 다시 로그인한 뒤 이용해주세요.
          </div>
        ) : status === 'error' ? (
          <div className={styles.subLabel}>
            종목을 불러오지 못했어요.
            <button type='button' className={styles.retryText} onClick={() => void load()}>
              다시 시도
            </button>
          </div>
        ) : (rows ?? []).length === 0 ? (
          <div className={styles.subLabel}>
            등록된 종목이 없어요. 스크린샷 한 장으로 추가할 수 있어요.
          </div>
        ) : (
          <div className={styles.subLabel}>
            {rows?.length ?? 0}종목 보유 중 · 빼려면 오른쪽 버튼을 누르세요
          </div>
        )}

        {status === 'ready' &&
          (rows ?? []).map((row) => {
            const key = holdingKey(row)
            const price = key ? quotes[key] : undefined
            const rate = computeProfitRate(row, price)
            const meta = [row.resolvedMarket, row.resolvedCode ?? row.code]
              .filter(Boolean)
              .join(' · ')
            const avg = formatAvgPrice(row)
            return (
              <div className={styles.mngItem} key={key}>
                <span className={styles.mngDot} style={{ background: '#7E97BD' }} />
                <div className={styles.mngInfo}>
                  <div className={styles.mngName}>{row.resolvedName || row.name}</div>
                  <div className={styles.mngMeta}>
                    {[meta, `${row.quantity}주`, avg].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <div className={styles.mngRight}>
                  <div
                    className={cn(
                      styles.mngRate,
                      rate == null ? '' : rate >= 0 ? styles.up : styles.down,
                    )}
                  >
                    {formatRate(rate)}
                  </div>
                </div>
                <button
                  type='button'
                  className={styles.mngDel}
                  onClick={() => void removeHolding(row)}
                  disabled={deletingKey === key}
                  aria-label={`${row.resolvedName || row.name} 삭제`}
                >
                  <Trash2 className='size-4' />
                </button>
              </div>
            )
          })}

        <Link href='/screenshot' className={styles.mngAdd}>
          <Plus className='size-4' /> 스크린샷으로 종목 추가
        </Link>
      </div>
    </SpecFrame>
  )
}
