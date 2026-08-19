'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { CreditCard, Crown } from 'lucide-react'
import { fetchPaymentsMe } from '@/lib/payments/client'
import { PRO_PLAN } from '@/lib/payments/products'
import styles from '@/app/mypage/mypage.module.css'

// 마이페이지 크레딧/Pro 카드 — /api/payments/me 기반 실데이터.
export function PaymentsStatusCards() {
  const [me, setMe] = useState<Awaited<ReturnType<typeof fetchPaymentsMe>>>(null)

  useEffect(() => {
    fetchPaymentsMe().then(setMe)
  }, [])

  const balance = me?.balance ?? 0
  const deepScanLeft = me?.deepScanLeft ?? 0
  const sub = me?.subscription ?? null
  const subscribed = sub != null && sub.status === 'active' && new Date(sub.current_period_end) > new Date()

  return (
    <>
      <div className={styles.creditCard}>
        <div className={styles.creditLabel}>지금 이용 가능</div>
        <div className={styles.creditAmt}>딥스캔 <span>{me ? deepScanLeft.toLocaleString() : '—'}</span>회</div>
        <div className={styles.creditSub}>보유 크레딧 {me ? balance.toLocaleString() : '—'}cr</div>
        <Link href='/mypage/credit' className={styles.creditBtn}><CreditCard className='size-4' /> 크레딧 충전</Link>
      </div>

      <div className={styles.proCard}>
        <div className={styles.proMark}><Crown className='size-5' /></div>
        <div className={styles.proInfo}>
          <div className={styles.proTitle}>Jaroo Pro</div>
          <div className={styles.proDesc}>
            {subscribed
              ? sub.cancel_at_period_end ? '해지 예약 · 기간 종료 시 만료' : '구독 중 · 딥스캔 무제한'
              : `딥스캔 무제한 · 월 ${PRO_PLAN.amountKrw.toLocaleString()}원`}
          </div>
        </div>
        <Link href='/mypage/pro' className={styles.proBtn}>{subscribed ? '관리' : '시작하기'}</Link>
      </div>
    </>
  )
}
