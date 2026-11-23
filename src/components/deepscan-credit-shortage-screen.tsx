'use client'

import Link from 'next/link'

import { BackControl } from './deepscan-loading-briefing-card'
import { buildCreditShortageFacts } from '@/lib/deepscan-credit-shortage'
import { FREE_GRANT_CREDITS } from '@/lib/payments/products'
import { cn } from '@/lib/utils'

import styles from './deepscan-credit-shortage-screen.module.css'

// 크레딧 부족(402) 예외 화면 — 딥스캔 로딩 스크린의 빨간 오류 카드 대신 끼워 넣는다.
// "버그가 났다"가 아니라 "이용권이 모자라다"로 읽히는 게 설계 목표.
// 안내 문구·수치는 lib/deepscan-credit-shortage(단일 진실 소스)에서 만든다.

export type DeepScanCreditShortageScreenProps = {
  className?: string
  name: string
  identifier?: string
  market?: string
  cost: number | null
  balance: number | null
  backHref?: string
  onBack?: () => void
}

export function DeepScanCreditShortageScreen({
  className,
  name,
  identifier,
  market,
  cost,
  balance,
  backHref = '/home',
  onBack,
}: DeepScanCreditShortageScreenProps) {
  const facts = buildCreditShortageFacts(cost, balance)

  return (
    <div className={cn(styles.screen, className)}>
      <header className={styles.topBar}>
        <BackControl onBack={onBack} backHref={backHref} />
        <div className={styles.topBarIdentity}>
          <h1 className={styles.topBarName}>{name}</h1>
          <p className={styles.topBarMeta}>{[market, identifier].filter(Boolean).join(' · ')}</p>
        </div>
        <span className={styles.topBarBadge}><i aria-hidden='true' />크레딧 필요</span>
      </header>

      <div className={styles.main}>
        <section className={styles.hero} aria-label='크레딧 부족 안내'>
          <div className={styles.heroTop}>
            <div>
              <span className={styles.pill}><i aria-hidden='true' />오류가 아니에요</span>
              <h2 className={styles.heroTitle}>{facts.headline}<br />분석은 그대로 있어요</h2>
            </div>
            <div className={styles.heroIcon} aria-hidden='true'>
              <svg width='28' height='28' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><circle cx='12' cy='12' r='10' /><path d='M8 12h8' /><path d='M12 8v8' /></svg>
            </div>
          </div>
          <p className={styles.heroCopy}>{facts.body}</p>
          <div className={styles.heroStats}>
            <div className={cn(styles.hstat, styles.hstatNeed)}>
              <b>{facts.needText}</b>
              <span>딥스캔 1회 필요</span>
            </div>
            <div className={styles.hstat}>
              <b>{facts.haveText}</b>
              <span>지금 보유</span>
            </div>
            <div className={styles.hstat}>
              <b>{facts.shortfallText}</b>
              <span>모자란 크레딧</span>
            </div>
          </div>
        </section>

        <article className={styles.card} aria-label='크레딧 채우는 방법'>
          <div className={styles.cardHead}>
            <div className={styles.emoSq} aria-hidden='true'>🪙</div>
            <div style={{ flex: 1 }}>
              <p className={styles.cardKicker}>결제 연동 열기 전</p>
              <h3 className={styles.cardTitle}>크레딧은 이렇게 채워요</h3>
            </div>
            <span className={styles.pill}>무료</span>
          </div>
          <div className={styles.steps}>
            <div className={styles.step}>
              <span className={styles.stepNo} aria-hidden='true'>1</span>
              <div>
                <p className={styles.stepTitle}>무료 크레딧 받기</p>
                <p className={styles.stepDesc}>
                  지금은 결제 연동을 준비 중이라 {FREE_GRANT_CREDITS.toLocaleString()}크레딧을 무료로 드리고 있어요.
                  크래딧 충전 페이지에 들어가기만 하면 자동으로 채워져요.
                </p>
              </div>
            </div>
            <div className={styles.step}>
              <span className={styles.stepNo} aria-hidden='true'>2</span>
              <div>
                <p className={styles.stepTitle}>다시 딥스캔 시작</p>
                <p className={styles.stepDesc}>
                  크레딧을 채운 뒤 이 종목으로 돌아와 다시 시도하면 세 분석가가 바로 분석을 시작해요.
                  입력했던 정보는 그대로 남아 있어요.
                </p>
              </div>
            </div>
          </div>
          <div className={styles.cta}>
            <Link href='/mypage/credit' className={cn(styles.btn, styles.btnPrimary)}>
              무료 크레딧 받으러 가기<span className={styles.freeTag}>{FREE_GRANT_CREDITS.toLocaleString()}cr</span>
            </Link>
            <Link href={backHref} className={cn(styles.btn, styles.btnOutline)}>다른 종목 선택</Link>
          </div>
        </article>

        <p className={styles.footnote}>
          크레딧은 딥스캔 1회 분석에 사용돼요. 사용 내역은 마이페이지에서 확인할 수 있어요.
        </p>
      </div>
    </div>
  )
}
