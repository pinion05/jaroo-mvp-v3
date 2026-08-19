'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { SpecFrame } from '@/components/spec/spec-frame'
import { confirmCreditPayment } from '@/lib/payments/client'
import styles from '../payments.module.css'

type Phase = 'confirming' | 'done' | 'error'

export function SuccessClient({ orderId, paymentKey }: { orderId: string; paymentKey: string }) {
  const validParams = Boolean(orderId) && Boolean(paymentKey)
  const [phase, setPhase] = useState<Phase>(validParams ? 'confirming' : 'error')
  const [message, setMessage] = useState<string | null>(validParams ? null : '결제 정보가 올바르지 않아요.')
  const [credits, setCredits] = useState<number | null>(null)
  const requested = useRef(false)

  useEffect(() => {
    if (requested.current) return
    requested.current = true
    if (!validParams) return

    confirmCreditPayment(orderId, paymentKey)
      .then((result) => {
        if (result.ok) {
          setCredits(result.credits ?? null)
          setPhase('done')
        } else {
          setPhase('error')
          setMessage(result.error ?? '결제 승인에 실패했어요.')
        }
      })
      .catch(() => {
        setPhase('error')
        setMessage('결제 승인 확인 중 오류가 발생했어요.')
      })
  }, [validParams, orderId, paymentKey])

  return (
    <SpecFrame backHref='/mypage' title='결제 완료'>
      <div className={styles.state}>
        {phase === 'confirming' ? (
          <>
            <div className={styles.ico}><Loader2 className='size-7 animate-spin' /></div>
            <div className={styles.title}>결제를 확인하고 있어요</div>
            <div className={styles.desc}>잠시만 기다려주세요.</div>
          </>
        ) : phase === 'done' ? (
          <>
            <div className={[styles.ico, styles.icoDone].join(' ')}><CheckCircle2 className='size-7' /></div>
            <div className={styles.title}>충전이 완료됐어요</div>
            <div className={styles.desc}>
              {credits != null ? `${credits.toLocaleString()} 크레딧이 지급됐어요.` : '크레딧이 지급됐어요.'}
            </div>
          </>
        ) : (
          <>
            <div className={[styles.ico, styles.icoFail].join(' ')}><XCircle className='size-7' /></div>
            <div className={styles.title}>결제를 완료하지 못했어요</div>
            <div className={styles.desc}>{message ?? '잠시 후 다시 시도해주세요.'}</div>
          </>
        )}
      </div>

      <Link href='/mypage/credit' className={styles.ghostBtn}>크레딧 화면으로</Link>
      <Link href='/mypage' className={styles.primaryBtn}>마이페이지로</Link>
    </SpecFrame>
  )
}
