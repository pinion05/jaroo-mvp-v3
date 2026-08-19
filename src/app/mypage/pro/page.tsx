'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Crown, Loader2, LogIn, Sparkles } from 'lucide-react'
import { SpecFrame } from '@/components/spec/spec-frame'
import { cancelSubscription, fetchPaymentsMe, isTossClientConfigured, PRO_PLAN, startProSubscriptionCheckout } from '@/lib/payments/client'
import styles from '../../payments/payments.module.css'

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })
  } catch {
    return iso
  }
}

export default function ProPage() {
  const [me, setMe] = useState<Awaited<ReturnType<typeof fetchPaymentsMe>>>(null)
  const [pending, setPending] = useState<'subscribe' | 'cancel' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const configured = isTossClientConfigured()

  useEffect(() => {
    fetchPaymentsMe().then(setMe)
  }, [])

  const sub = me?.subscription ?? null
  const activeSub = sub != null && sub.status === 'active' && new Date(sub.current_period_end) > new Date()
  const guest = me?.authScope === 'guest'
  const cardLabel = sub?.card_company ? [sub.card_company, sub.card_number].filter(Boolean).join(' ') : '등록된 카드'

  async function handleSubscribe() {
    setError(null)
    setPending('subscribe')
    try {
      await startProSubscriptionCheckout()
    } catch (err) {
      setError(err instanceof Error ? err.message : '구독을 시작하지 못했어요.')
      setPending(null)
    }
  }

  async function handleCancel() {
    setError(null)
    setPending('cancel')
    const result = await cancelSubscription(false)
    setPending(null)
    if (result.ok) {
      setMe(await fetchPaymentsMe())
    } else {
      setError(result.error ?? null)
    }
  }

  return (
    <SpecFrame backHref='/mypage' title='Jaroo Pro'>
      <div className={styles.wrap}>
        {guest ? (
          <>
            <div className={styles.state}>
              <div className={styles.ico}><LogIn className='size-7' /></div>
              <div className={styles.title}>로그인이 필요해요</div>
              <div className={styles.desc}>로그인 후 Jaroo Pro를 구독할 수 있어요.</div>
            </div>
            <Link href='/login' className={styles.primaryBtn}>로그인하러 가기</Link>
          </>
        ) : activeSub ? (
          <>
            <div className={styles.benefitCard}>
              <div className={styles.benefitTitle}>
                <Crown className='size-4' /> Jaroo Pro 구독 중
              </div>
              <ul className={styles.benefitList}>
                <li><span className={styles.dot} /> 딥스캔 무제한</li>
                <li><span className={styles.dot} /> 우선 분석 대기열</li>
              </ul>
            </div>

            <div className={styles.subCard}>
              <div className={styles.subRow}>
                <span>상태</span>
                <span className={styles.subRowValue}>{sub.cancel_at_period_end ? '해지 예약' : '구독 중'}</span>
              </div>
              <div className={styles.subRow}>
                <span>다음 결제일</span>
                <span className={styles.subRowValue}>{formatDate(sub.current_period_end)}</span>
              </div>
              <div className={styles.subRow}>
                <span>결제 수단</span>
                <span className={styles.subRowValue}>{cardLabel}</span>
              </div>
            </div>

            {error ? <div className={styles.desc} style={{ color: '#e5484d' }}>{error}</div> : null}

            {sub.cancel_at_period_end ? (
              <p className={styles.notice}>
                이용 기간이 끝나면 자동으로 해지돼요. 기간 종료 후 언제든 재구독할 수 있어요.
              </p>
            ) : (
              <button type='button' className={styles.ghostBtn} onClick={handleCancel} disabled={pending != null}>
                {pending === 'cancel' ? '해지 처리 중...' : '구독 해지 (기간 종료 후)'}
              </button>
            )}
          </>
        ) : !configured ? (
          <div className={styles.state}>
            <div className={styles.ico}><Sparkles className='size-7' /></div>
            <div className={styles.title}>Jaroo Pro 준비 중</div>
            <div className={styles.desc}>결제사 연동이 완료되면 구독이 열려요. 지금은 딥스캔을 무료로 이용할 수 있어요.</div>
          </div>
        ) : (
          <>
            <div className={styles.benefitCard}>
              <div className={styles.benefitTitle}>
                <Crown className='size-4' /> Jaroo Pro
              </div>
              <div className={styles.benefitPrice}>
                {PRO_PLAN.amountKrw.toLocaleString()}
                <span>원 / 월</span>
              </div>
              <ul className={styles.benefitList}>
                <li><span className={styles.dot} /> 딥스캔 무제한</li>
                <li><span className={styles.dot} /> 우선 분석 대기열</li>
                <li><span className={styles.dot} /> 언제든 해지 가능</li>
              </ul>
            </div>

            {error ? <div className={styles.desc} style={{ color: '#e5484d' }}>{error}</div> : null}

            <button type='button' className={styles.primaryBtn} onClick={handleSubscribe} disabled={pending != null}>
              {pending === 'subscribe' ? <Loader2 className='size-4 animate-spin' style={{ display: 'inline-block', verticalAlign: '-2px' }} /> : null}
              {pending === 'subscribe' ? '카드 등록 결제창을 여는 중...' : '카드 등록하고 구독 시작'}
            </button>

            <p className={styles.notice}>카드를 한 번 등록하면 매월 자동 결제돼요. 언제든 해지할 수 있어요.</p>
          </>
        )}
      </div>
    </SpecFrame>
  )
}
