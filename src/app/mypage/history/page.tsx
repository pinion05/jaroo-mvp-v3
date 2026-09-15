'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight, Loader2, LogIn, ScanSearch } from 'lucide-react'
import { SpecFrame } from '@/components/spec/spec-frame'
import { buildDeepScanTargetInputFromHistoryTargetInput } from '@/lib/deepscan-history-restore'
import {
  etfMarketLabel,
  mergeAnalysisHistory,
  type AnalysisHistoryRow,
} from '@/lib/analysis-history'
import { useDeepScanStore } from '@/lib/stores/use-deepscan-store'
import styles from '../detail.module.css'

// 마이페이지 > 분석 기록 — 딥스캔(deepscan_scan_history)과 ETF(etf_scan_history)
// 두 원장을 시간순 한 타임라인으로 나열한다. 딥스캔 행은 당시 타깃(target_input)을
// 복원해 딥스캔으로 이동하고(종목당 최신 스냅샷 캐시 히트 — 재열람 무료·즉시, A안),
// ETF 행은 /etf?code= 로 재진입한다(공개 시세성 데이터라 매번 실시간 재수집).

type LoadState =
  | { phase: 'loading' }
  | { phase: 'guest' }
  | { phase: 'error' }
  | { phase: 'ready'; rows: AnalysisHistoryRow[] }

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

/** 두 원장을 병렬 조회 — 401이면 게스트, 둘 다 실패면 에러, 한쪽 실패는 성공 쪽만 보여준다. */
async function fetchAnalysisHistoryRows(): Promise<
  { status: 'guest' } | { status: 'error' } | { status: 'ready'; rows: AnalysisHistoryRow[] }
> {
  const [stockResult, etfResult] = await Promise.allSettled([
    fetch('/api/deepscan/history?limit=30', { cache: 'no-store' }),
    fetch('/api/etf/history?limit=30', { cache: 'no-store' }),
  ])

  const parseRows = async (result: PromiseSettledResult<Response>) => {
    if (result.status !== 'fulfilled') return { code: 'error' as const, rows: [] }
    if (result.value.status === 401) return { code: 'guest' as const, rows: [] }
    if (!result.value.ok) return { code: 'error' as const, rows: [] }
    const body = (await result.value.json().catch(() => null)) as { rows?: AnalysisHistoryRow[] } | null
    return { code: 'ok' as const, rows: Array.isArray(body?.rows) ? body.rows : [] }
  }

  const stock = await parseRows(stockResult)
  const etf = await parseRows(etfResult)
  if (stock.code === 'guest' || etf.code === 'guest') return { status: 'guest' }
  if (stock.code === 'error' && etf.code === 'error') return { status: 'error' }
  return { status: 'ready', rows: mergeAnalysisHistory(stock.rows, etf.rows) }
}

export default function HistoryPage() {
  const [state, setState] = useState<LoadState>({ phase: 'loading' })
  const router = useRouter()
  const setDeepScanTarget = useDeepScanStore((store) => store.setTarget)

  useEffect(() => {
    let active = true
    void (async () => {
      const result = await fetchAnalysisHistoryRows()
      if (!active) return
      if (result.status === 'ready') setState({ phase: 'ready', rows: result.rows })
      else setState({ phase: result.status })
    })()
    return () => {
      active = false
    }
  }, [])

  // 딥스캔 행: 당시 타깃 복원 → 딥스캔 진입(복원 불가 행은 스캔 폼으로).
  // ETF 행: 코드로 재진입 — 매번 실시간 재수집이므로 별도 복원 없이 ?code= 로 충분하다.
  const openRow = (row: AnalysisHistoryRow) => {
    if (row.kind === 'etf' && row.etfCode) {
      router.push(`/etf?code=${encodeURIComponent(row.etfCode)}`)
      return
    }
    const target = buildDeepScanTargetInputFromHistoryTargetInput(row.targetInput)
    if (target) {
      setDeepScanTarget(target)
    }
    router.push('/deepscan')
  }

  return (
    <SpecFrame backHref='/mypage' title='분석 기록' showBottomNav>
      <div className={styles.body}>
        <div className={styles.subLabel}>지난 딥스캔·ETF 분석 결과를 다시 볼 수 있어요</div>

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
              key={`${row.kind}:${row.id}`}
              className={`${styles.recItem} ${styles.recBtn}`}
              onClick={() => openRow(row)}
              aria-label={`${row.stockName ?? row.targetKey} ${row.kind === 'etf' ? 'ETF 분석' : '딥스캔'} 다시 보기`}
            >
              <div className={styles.recTop}>
                <span
                  className={styles.recDot}
                  style={{ background: row.kind === 'etf' ? '#2B6BE6' : '#97A0AE' }}
                  aria-hidden
                />
                <span className={styles.recName}>{row.stockName ?? row.targetKey}</span>
                <span className={styles.recDate}>{formatHistoryDate(row.scannedAt)}</span>
              </div>
              <div className={styles.recBody}>
                <span className={styles.recLabel}>
                  {row.kind === 'etf' ? `ETF · ${etfMarketLabel(row.market)}` : (row.market ?? '—')}
                </span>
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
