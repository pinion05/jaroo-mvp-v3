'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Coins, Loader2, LogIn, Sparkles } from 'lucide-react'
import { SpecFrame } from '@/components/spec/spec-frame'
import { CREDIT_PACKS, fetchPaymentsMe, isTossClientConfigured, startCreditPackCheckout } from '@/lib/payments/client'
import { DEEPSCAN_CREDIT_COST, FREE_GRANT_CREDITS, deepScanRunsLeft } from '@/lib/payments/products'
import styles from '../../payments/payments.module.css'

// 결제 미연동 상태의 무료 지급 흐름 — 페이지에 들어오면 바로 999크레딧을 채운다.
type FreeGrantState =
  | { status: 'checking' }
  | { status: 'charging' }
  | { status: 'done'; balance: number; deepScanLeft: number }
  | { status: 'error'; message: string }

async function requestFreeGrant(): Promise<{ balance: number; deepScanLeft: number }> {
  const response = await fetch('/api/payments/credits/grant', { method: 'POST' })
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok) {
    if (response.status === 401) throw new Error('로그인 후 무료 크레딧을 받을 수 있어요.')
    throw new Error('크레딧을 채우지 못했어요. 잠시 후 다시 시도해주세요.')
  }
  return {
    balance: typeof body.balance === 'number' ? body.balance : 0,
    deepScanLeft: typeof body.deepScanLeft === 'number' ? body.deepScanLeft : 0,
  }
}

export default function CreditPage() {
  const [me, setMe] = useState<Awaited<ReturnType<typeof fetchPaymentsMe>>>(null)
  const [selected, setSelected] = useState<string>(CREDIT_PACKS[1]?.id ?? CREDIT_PACKS[0].id)
  const [pendingProductId, setPendingProductId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [freeGrant, setFreeGrant] = useState<FreeGrantState>({ status: 'checking' })
  const grantInFlight = useRef(false)
  const configured = isTossClientConfigured()

  useEffect(() => {
    fetchPaymentsMe().then(setMe)
  }, [])

  // 결제 미연동 + 로그인이 확인되면 즉시 무료 999크레딧을 지급받는다.
  const runFreeGrant = useCallback(() => {
    if (grantInFlight.current) return
    grantInFlight.current = true
    setFreeGrant({ status: 'charging' })
    requestFreeGrant()
      .then((result) => setFreeGrant({ status: 'done', ...result }))
      .catch((err: unknown) => {
        setFreeGrant({
          status: 'error',
          message: err instanceof Error ? err.message : '크레딧을 채우지 못했어요. 잠시 후 다시 시도해주세요.',
        })
      })
      .finally(() => {
        grantInFlight.current = false
      })
  }, [])

  useEffect(() => {
    if (configured || me?.authScope !== 'authenticated') return
    // 이펙트 본문에서 동기 setState를 부르면 cascading render 경고가 뜬다 — 타이머로 한 틱 미룬다.
    const timer = setTimeout(runFreeGrant, 0)
    return () => clearTimeout(timer)
  }, [configured, me?.authScope, runFreeGrant])

  async function handlePurchase() {
    setError(null)
    setPendingProductId(selected)
    try {
      await startCreditPackCheckout(selected)
    } catch (err) {
      setError(err instanceof Error ? err.message : '결제를 시작하지 못했어요.')
      setPendingProductId(null)
    }
  }

  const guest = me?.authScope === 'guest'
  const balance = me?.balance ?? 0
  const pending = pendingProductId != null

  return (
    <SpecFrame backHref='/mypage' title='크레딧 충전'>
      <div className={styles.wrap}>
        {guest ? (
          <>
            <div className={styles.state}>
              <div className={styles.ico}><LogIn className='size-7' /></div>
              <div className={styles.title}>로그인이 필요해요</div>
              <div className={styles.desc}>로그인 후 크레딧을 충전할 수 있어요.</div>
            </div>
            <Link href='/login' className={styles.primaryBtn}>로그인하러 가기</Link>
          </>
        ) : !configured ? (
          // 결제 연동 전 — 들어오자마자 999크레딧 무료 충전. 막다른 안내 대신 완료 상태로 안내한다.
          freeGrant.status === 'done' ? (
            <>
              <div className={styles.state}>
                <div className={`${styles.ico} ${styles.icoDone}`}><Sparkles className='size-7' /></div>
                <div className={styles.title}>{FREE_GRANT_CREDITS.toLocaleString()}크레딧을 채웠어요!</div>
                <div className={styles.desc}>
                  결제 연동이 열리기 전까지 딥스캔 크레딧을 무료로 드려요.<br />
                  보유 {freeGrant.balance.toLocaleString()}cr · 딥스캔 {freeGrant.deepScanLeft.toLocaleString()}회
                </div>
              </div>
              <Link href='/home' className={styles.primaryBtn}>딥스캔 이용하러 가기</Link>
              <button type='button' className={styles.ghostBtn} onClick={runFreeGrant}>크레딧이 더 필요해요 ({FREE_GRANT_CREDITS.toLocaleString()}cr 더 받기)</button>
            </>
          ) : freeGrant.status === 'error' ? (
            <>
              <div className={styles.state}>
                <div className={styles.ico}><Coins className='size-7' /></div>
                <div className={styles.title}>크레딧을 채우지 못했어요</div>
                <div className={styles.desc}>{freeGrant.message}</div>
              </div>
              <button type='button' className={styles.primaryBtn} onClick={runFreeGrant}>다시 시도</button>
            </>
          ) : (
            <div className={styles.state}>
              <div className={styles.ico}><Loader2 className='size-7 animate-spin' /></div>
              <div className={styles.title}>{freeGrant.status === 'checking' ? '크레딧 정보를 확인하고 있어요' : '무료 크레딧을 채우고 있어요'}</div>
              <div className={styles.desc}>결제 연동이 열리기 전까지 {FREE_GRANT_CREDITS.toLocaleString()}크레딧을 무료로 드려요.</div>
            </div>
          )
        ) : (
          <>
            <div className={styles.subCard}>
              <div className={styles.subRow}>
                <span>보유 크레딧</span>
                <span className={styles.subRowValue}>{balance.toLocaleString()}cr</span>
              </div>
              <div className={styles.subRow}>
                <span>딥스캔 가능 횟수</span>
                <span className={styles.subRowValue}>{deepScanRunsLeft(balance)}회</span>
              </div>
            </div>

            <div className={styles.packList}>
              {CREDIT_PACKS.map((pack) => (
                <button
                  key={pack.id}
                  type='button'
                  className={[styles.pack, selected === pack.id ? styles.packSelected : ''].filter(Boolean).join(' ')}
                  onClick={() => setSelected(pack.id)}
                  disabled={pending}
                >
                  <div className={styles.packInfo}>
                    <div className={styles.packCredits}>
                      <Coins className='size-4' />
                      {pack.credits.toLocaleString()}크레딧
                      {pack.badge ? <span className={styles.packBadge}>{pack.badge}</span> : null}
                    </div>
                    <div className={styles.packMeta}>딥스캔 {Math.floor(pack.credits / DEEPSCAN_CREDIT_COST)}회 분량</div>
                  </div>
                  <div className={styles.packPrice}>{pack.amountKrw.toLocaleString()}원</div>
                </button>
              ))}
            </div>

            {error ? <div className={styles.desc} style={{ color: '#e5484d' }}>{error}</div> : null}

            <button type='button' className={styles.primaryBtn} onClick={handlePurchase} disabled={pending}>
              {pending ? <Loader2 className='size-4 animate-spin' style={{ display: 'inline-block', verticalAlign: '-2px' }} /> : null}
              {pending ? '결제창을 여는 중...' : `${(CREDIT_PACKS.find((p) => p.id === selected)?.amountKrw ?? 0).toLocaleString()}원 결제하기`}
            </button>

            <p className={styles.notice}>{`결제 수단 등록 없이 카드로 한 번에 결제돼요. 충전된 크레딧은 딥스캔 1회에 ${DEEPSCAN_CREDIT_COST}크레딧씩 사용돼요.`}</p>
          </>
        )}
      </div>
    </SpecFrame>
  )
}
