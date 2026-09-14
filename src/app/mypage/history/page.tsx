'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight, Loader2, LogIn, ScanSearch } from 'lucide-react'
import { SpecFrame } from '@/components/spec/spec-frame'
import { buildDeepScanTargetInputFromHistoryTargetInput } from '@/lib/deepscan-history-restore'
import { useDeepScanStore } from '@/lib/stores/use-deepscan-store'
import styles from '../detail.module.css'

// 마이페이지 > 분석 기록 — deepscan_scan_history 원장(스캔 성공 시마다 1행)을 나열한다.
// 항목을 탭하면 당시 타깃(target_input)을 복원해 딥스캔으로 이동한다 — 종목당 최신
// 스냅샷이 캐시 히트되므로 재열람은 무료·즉시다(A안).

type HistoryRow = {
  id: string
  targetKey: string
  market: string | null
  stockName: string | null
  targetInput: unknown
  chargedCredits: number
  scannedAt: string
}

type LoadState =
  | { phase: 'loading' }
  | { phase: 'guest' }
  | { phase: 'error' }
  | { phase: 'ready'; rows: HistoryRow[] }

function formatHistoryDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

export default function HistoryPage() {
  const [state, setState] = useState<LoadState>({ phase: 'loading' })
  const router = useRouter()
  const setDeepScanTarget = useDeepScanStore((store) => store.setTarget)

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const res = await fetch('/api/deepscan/history?limit=30', { cache: 'no-store' })
        if (!active) return
        if (res.status === 401) {
          setState({ phase: 'guest' })
          return
        }
        if (!res.ok) {
          setState({ phase: 'error' })
          return
        }
        const body = (await res.json().catch(() => null)) as { rows?: HistoryRow[] } | null
        if (!active) return
        setState({ phase: 'ready', rows: Array.isArray(body?.rows) ? body.rows : [] })
      } catch {
        if (active) setState({ phase: 'error' })
      }
    })()
    return () => {
      active = false
    }
  }, [])

  // 당시 타깃 복원 → 딥스캔 진입. 복원 불가 행(수치 누락)은 스캔 폼으로 보낸다.
  const openScan = (row: HistoryRow) => {
    const target = buildDeepScanTargetInputFromHistoryTargetInput(row.targetInput)
    if (target) {
      setDeepScanTarget(target)
    }
    router.push('/deepscan')
  }

  return (
    <SpecFrame backHref='/mypage' title='분석 기록' showBottomNav>
      <div className={styles.body}>
        <div className={styles.subLabel}>지난 딥스캔 결과를 다시 볼 수 있어요</div>

        {state.phase === 'loading' ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '56px 0' }}>
            <Loader2 className='size-6 animate-spin text-[#97A0AE]' aria-label='기록을 불러오는 중' />
          </div>
        ) : state.phase === 'guest' ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '48px 0' }}>
            <LogIn className='size-7 text-[#97A0AE]' aria-hidden />
            <p className={styles.subLabel} style={{ marginBottom: 0 }}>로그인하면 분석 기록이 쌓여요</p>
            <Link href='/login' className={styles.saveBtn} style={{ textDecoration: 'none', display: 'inline-block' }}>로그인하러 가기</Link>
          </div>
        ) : state.phase === 'error' ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '48px 0' }}>
            <p className={styles.errorNote} style={{ margin: 0 }}>기록을 불러오지 못했어요. 잠시 후 다시 시도해주세요.</p>
          </div>
        ) : state.rows.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '48px 0' }}>
            <ScanSearch className='size-7 text-[#97A0AE]' aria-hidden />
            <p className={styles.subLabel} style={{ marginBottom: 0 }}>아직 분석 기록이 없어요. 첫 딥스캔을 실행해보세요</p>
            <Link href='/screenshot' className={styles.saveBtn} style={{ textDecoration: 'none', display: 'inline-block' }}>스캔 시작하기</Link>
          </div>
        ) : (
          state.rows.map((row) => (
            <button
              type='button'
              key={row.id}
              className={`${styles.recItem} ${styles.recBtn}`}
              onClick={() => openScan(row)}
              aria-label={`${row.stockName ?? row.targetKey} 딥스캔 다시 보기`}
            >
              <div className={styles.recTop}>
                <span className={styles.recDot} style={{ background: '#97A0AE' }} aria-hidden />
                <span className={styles.recName}>{row.stockName ?? row.targetKey}</span>
                <span className={styles.recDate}>{formatHistoryDate(row.scannedAt)}</span>
              </div>
              <div className={styles.recBody}>
                <span className={styles.recLabel}>{row.market ?? '—'}</span>
                <span className={styles.recSummary}>탭하면 최신 분석으로 다시 열어요</span>
                <span className={styles.recArrow}><ChevronRight className='size-4' aria-hidden /></span>
              </div>
            </button>
          ))
        )}
      </div>
    </SpecFrame>
  )
}
