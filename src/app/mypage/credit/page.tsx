'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Coins, CreditCard, Loader2, LogIn } from 'lucide-react'
import { SpecFrame } from '@/components/spec/spec-frame'
import { CREDIT_PACKS, fetchPaymentsMe, isTossClientConfigured, startCreditPackCheckout } from '@/lib/payments/client'
import { DEEPSCAN_CREDIT_COST } from '@/lib/payments/products'
import styles from '../../payments/payments.module.css'

export default function CreditPage() {
  const [me, setMe] = useState<Awaited<ReturnType<typeof fetchPaymentsMe>>>(null)
  const [selected, setSelected] = useState<string>(CREDIT_PACKS[1]?.id ?? CREDIT_PACKS[0].id)
  const [pendingProductId, setPendingProductId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const configured = isTossClientConfigured()

  useEffect(() => {
    fetchPaymentsMe().then(setMe)
  }, [])

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
          <div className={styles.state}>
            <div className={styles.ico}><CreditCard className='size-7' /></div>
            <div className={styles.title}>결제 연동 준비 중</div>
            <div className={styles.desc}>결제사 연동이 완료되면 크레딧 충전이 열려요. 지금은 딥스캔을 무료로 이용할 수 있어요.</div>
          </div>
        ) : (
          <>
            <div className={styles.subCard}>
              <div className={styles.subRow}>
                <span>보유 크레딧</span>
                <span className={styles.subRowValue}>{balance.toLocaleString()}cr</span>
              </div>
              <div className={styles.subRow}>
                <span>딥스캔 가능 횟수</span>
                <span className={styles.subRowValue}>{Math.floor(balance / DEEPSCAN_CREDIT_COST)}회</span>
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
