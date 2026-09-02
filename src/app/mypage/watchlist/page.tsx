'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { SpecFrame } from '@/components/spec/spec-frame'
import { cn } from '@/lib/utils'
import { removePortfolioItemFromList, usePortfolioStore } from '@/lib/stores/use-portfolio-store'
import {
  buildAppliedHomePortfolioRowsFromPortfolioItems,
  buildPortfolioItemsFromAppliedHomePortfolioRows,
  persistAppliedHomePortfolio,
  readAppliedHomePortfolio,
} from '@/lib/jaroo-home-data'
import {
  fetchPortfolio,
  shouldUsePortfolioSessionFallback,
  syncPortfolioToServer,
} from '@/lib/portfolio-sync'
import type { PortfolioNormalizedItem } from '@/lib/workflow-types'
import styles from '../detail.module.css'

// 마이페이지 > 내 종목 관리.
// 홈이 쓰는 것과 같은 zustand 포트폴리오 스토어를 구독한다 —
// 홈 ↔ 이 화면을 오가며 재마운트돼도 API를 다시 부르지 않는다(캐시 = 스토어).
// 스토어가 비어 있을 때(세션 최초 진입)만 서버에서 적재한다.
// 손익률은 홈의 시세 새로고침이 채워 넣은 currentProfitRate 를 그대로 쓴다.

function formatAvgPrice(item: PortfolioNormalizedItem): string {
  if (!Number.isFinite(item.averagePrice)) return ''
  if (item.averagePriceCurrency === 'USD') {
    return `$${item.averagePrice.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
  }
  return `${Math.round(item.averagePrice).toLocaleString('ko-KR')}원` // §5-4 평단 정수 반올림
}

function formatRate(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return '—'
  const sign = rate > 0 ? '+' : ''
  return `${sign}${rate.toFixed(1)}%`
}

export default function WatchlistPage() {
  const items = usePortfolioStore((state) => state.items)
  const replaceItems = usePortfolioStore((state) => state.replaceItems)
  const removeStoreItem = usePortfolioStore((state) => state.removeItem)
  const [initialLoading, setInitialLoading] = useState(false)
  const [removalPendingKey, setRemovalPendingKey] = useState<string | null>(null)
  const [removalError, setRemovalError] = useState<string | null>(null)

  // 초기 적재 — 스토어에 아이템이 있으면(홈에서 이미 불러옴) 네트워크 호출 자체를 건너뛴다.
  useEffect(() => {
    if (items.length > 0) {
      return
    }

    let active = true
    setInitialLoading(true)
    void (async () => {
      const result = await fetchPortfolio()
      if (!active) {
        return
      }

      if (result.status === 'rows' || result.status === 'empty') {
        if (result.status === 'rows') {
          replaceItems(buildPortfolioItemsFromAppliedHomePortfolioRows(result.rows))
        }
      } else if (shouldUsePortfolioSessionFallback(result)) {
        // 로그인 만료/네트워크 실패 — 세션 캐시로 견딤 (홈과 동일 정책)
        const session = readAppliedHomePortfolio()
        if (session) {
          replaceItems(buildPortfolioItemsFromAppliedHomePortfolioRows(session.rows))
        }
      }
      setInitialLoading(false)
    })()

    return () => {
      active = false
    }
  }, [items.length, replaceItems])

  // 종목 삭제 — 홈의 제거 플로우와 동일: 세션 저장 → 서버 전체 동기화 → 스토어 반영(롤백 포함)
  const removeHolding = async (item: PortfolioNormalizedItem) => {
    if (removalPendingKey) return
    if (!window.confirm(`${item.name}을(를) 종목 목록에서 뺄까요?`)) return

    const key = `${item.code ?? item.ticker ?? item.name}`
    const currentItems = usePortfolioStore.getState().items
    const nextItems = removePortfolioItemFromList(currentItems, item)
    if (nextItems.length === currentItems.length) return

    const currentSession = readAppliedHomePortfolio()
    const broker = currentSession?.broker ?? '내 종목 관리'
    const previousRows = buildAppliedHomePortfolioRowsFromPortfolioItems(currentItems)
    const nextRows = buildAppliedHomePortfolioRowsFromPortfolioItems(nextItems)

    setRemovalPendingKey(key)
    setRemovalError(null)
    try {
      const persisted = persistAppliedHomePortfolio({ broker, rows: nextRows, appliedAt: new Date().toISOString() })
      if (!persisted) {
        setRemovalError('기기 저장소에 변경 내용을 저장하지 못했어요. 다시 시도해주세요.')
        return
      }

      const syncResult = await syncPortfolioToServer(nextRows)
      if (!syncResult.ok && syncResult.reason === 'error') {
        persistAppliedHomePortfolio({ broker, rows: previousRows, appliedAt: currentSession?.appliedAt })
        setRemovalError('저장된 포트폴리오를 변경하지 못했어요. 네트워크 상태를 확인한 뒤 다시 시도해주세요.')
        return
      }

      removeStoreItem(item) // 스토어에서 제거 → 홈 화면에도 즉시 반영
    } finally {
      setRemovalPendingKey(null)
    }
  }

  return (
    <SpecFrame backHref='/mypage' title='내 종목 관리' showBottomNav>
      <div className={styles.body}>
        {initialLoading && items.length === 0 ? (
          <div className={styles.subLabel}>종목을 불러오는 중이에요…</div>
        ) : items.length === 0 ? (
          <div className={styles.subLabel}>
            등록된 종목이 없어요. 스크린샷 한 장으로 추가할 수 있어요.
          </div>
        ) : (
          <div className={styles.subLabel}>{items.length}종목 보유 중</div>
        )}
        {removalError ? (
          <div className={styles.subLabel} role='alert'>
            {removalError}
          </div>
        ) : null}

        {items.map((item) => {
          const key = `${item.code ?? item.ticker ?? item.name}`
          const rate = item.currentProfitRate ?? item.snapshotProfitRate
          const meta = [item.market, item.code ?? item.ticker].filter(Boolean).join(' · ')
          const avg = formatAvgPrice(item)
          return (
            <div className={styles.mngItem} key={key}>
              <span className={styles.mngDot} style={{ background: '#7E97BD' }} />
              <div className={styles.mngInfo}>
                <div className={styles.mngName}>{item.name}</div>
                <div className={styles.mngMeta}>{[meta, `${item.quantity}주`, avg].filter(Boolean).join(' · ')}</div>
              </div>
              <div className={styles.mngRight}>
                <div
                  className={cn(styles.mngRate, rate == null ? '' : rate >= 0 ? styles.up : styles.down)}
                >
                  {formatRate(rate)}
                </div>
              </div>
              <button
                type='button'
                className={styles.mngDel}
                onClick={() => void removeHolding(item)}
                disabled={removalPendingKey === key}
                aria-label={`${item.name} 삭제`}
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
