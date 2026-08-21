'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { SpecFrame } from '@/components/spec/spec-frame'
import { confirmBillingAuth } from '@/lib/payments/client'
import styles from '../../payments.module.css'

type Phase = 'confirming' | 'done' | 'error'

export function BillingCallbackClient({ orderId, customerKey, authKey }: { orderId: string; customerKey: string; authKey: string }) {
  const validParams = Boolean(orderId) && Boolean(authKey)
  const [phase, setPhase] = useState<Phase>(validParams ? 'confirming' : 'error')
  const [message, setMessage] = useState<string | null>(validParams ? null : '카드 등록 정보가 올바르지 않아요.')
  const requested = useRef(false)

  useEffect(() => {
    if (requested.current) return
    requested.current = true
    if (!validParams) return

    confirmBillingAuth(orderId, authKey, customerKey)
      .then((result) => {
        if (result.ok) {
          setPhase('done')
        } else {
          setPhase('error')
          setMessage(result.error ?? '구독 결제에 실패했어요.')
        }
      })
      .catch(() => {
        setPhase('error')
        setMessage('구독 처리 중 오류가 발생했어요.')
      })
  }, [validParams, orderId, customerKey, authKey])

  return (
    <SpecFrame backHref='/mypage' title='구독 결제'>
      <div className={styles.state}>
        {phase === 'confirming' ? (
          <>
            <div className={styles.ico}><Loader2 className='size-7 animate-spin' /></div>
            <div className={styles.title}>구독을 처리하고 있어요</div>
            <div className={styles.desc}>잠시만 기다려주세요.</div>
          </>
        ) : phase === 'done' ? (
          <>
            <div className={[styles.ico, styles.icoDone].join(' ')}><CheckCircle2 className='size-7' /></div>
            <div className={styles.title}>Jaroo Pro 시작!</div>
            <div className={styles.desc}>딥스캔을 무제한으로 이용할 수 있어요.</div>
          </>
        ) : (
          <>
            <div className={[styles.ico, styles.icoFail].join(' ')}><XCircle className='size-7' /></div>
            <div className={styles.title}>구독을 완료하지 못했어요</div>
            <div className={styles.desc}>{message ?? '잠시 후 다시 시도해주세요.'}</div>
          </>
        )}
      </div>

      <Link href='/mypage/pro' className={styles.ghostBtn}>구독 화면으로</Link>
      <Link href='/mypage' className={styles.primaryBtn}>마이페이지로</Link>
    </SpecFrame>
  )
}
