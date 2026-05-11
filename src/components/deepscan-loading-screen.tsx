'use client'

import Link from 'next/link'
import { useEffect, useState, type ComponentType } from 'react'
import { Activity, BadgeDollarSign, Brain, ChartCandlestick, Factory, Landmark, Radar, Scale, TrendingUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import styles from './deepscan-loading-screen.module.css'

type DeepScanLoadingScreenProps = {
  name?: string
  identifier?: string
  className?: string
  onBack?: () => void
  backHref?: string
}

type CommitteeMemberState = 'done' | 'active' | 'wait'
type CommitteeMemberIcon = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>

const committeeMembers: ReadonlyArray<{ key: string; Icon: CommitteeMemberIcon; label: string; state: CommitteeMemberState }> = [
  { key: 'valuation', Icon: Scale, label: '가치\n분석가', state: 'active' },
  { key: 'growth', Icon: TrendingUp, label: '성장\n전략가', state: 'active' },
  { key: 'finance', Icon: Landmark, label: '재무\n감사관', state: 'active' },
  { key: 'chart', Icon: ChartCandlestick, label: '차트\n마스터', state: 'active' },
  { key: 'flow', Icon: Activity, label: '수급\n추적기', state: 'active' },
  { key: 'momentum', Icon: Radar, label: '모멘텀\n스카우터', state: 'active' },
  { key: 'sentiment', Icon: Brain, label: '심리\n분석AI', state: 'active' },
  { key: 'industry', Icon: Factory, label: '산업\n전문가', state: 'active' },
  { key: 'event', Icon: BadgeDollarSign, label: '이벤트\n스캐너', state: 'active' },
] as const

const activeCommitteeMemberCount = committeeMembers.filter((member) => member.state === 'active').length

function formatElapsedTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function memberStateClass(state: CommitteeMemberState) {
  if (state === 'done') {
    return styles.memberDone
  }

  if (state === 'active') {
    return styles.memberActive
  }

  return styles.memberWait
}

function BackControl({ onBack, backHref }: Pick<DeepScanLoadingScreenProps, 'onBack' | 'backHref'>) {
  if (onBack) {
    return (
      <button type='button' className={styles.backButton} onClick={onBack} aria-label='뒤로 가기'>
        ←
      </button>
    )
  }

  return (
    <Link href={backHref ?? '/home'} className={styles.backButton} aria-label='홈으로 가기'>
      ←
    </Link>
  )
}

export function DeepScanLoadingScreen({ name = '선택 종목', identifier, className, onBack, backHref = '/home' }: DeepScanLoadingScreenProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const targetLine = [name, identifier].filter(Boolean).join(' ')

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setElapsedSeconds((seconds) => seconds + 1)
    }, 1000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [])

  return (
    <div className={cn(styles.loadingCard, className)}>
      <div className={styles.topBar}>
        <BackControl onBack={onBack} backHref={backHref} />
        <div className={styles.topTitle}>딥스캔 분석 중</div>
      </div>

      <div className={styles.inner}>
        <div className={styles.iconWrap} aria-hidden='true'>
          <div className={styles.iconRing} />
          <div className={styles.iconRingFill} />
          <div className={styles.iconInner}>🔍</div>
        </div>

        <div className={styles.loadingTitle}>
          AI 9인 위원회가
          <br />
          분석 중이에요
        </div>
        <div className={styles.loadingSub}>
          {targetLine || '선택 종목'}
          <br />
          최신 데이터를 수집하고 있어요
        </div>
        <div className={styles.elapsedTimer} aria-live='polite' aria-label={`딥스캔 분석 경과 시간 ${formatElapsedTime(elapsedSeconds)}`}>
          <span className={styles.elapsedLabel}>분석 경과</span>
          <span className={styles.elapsedValue}>{formatElapsedTime(elapsedSeconds)}</span>
        </div>

        <div className={styles.stepsWrap}>
          <div className={styles.stepRow}>
            <div className={cn(styles.stepIcon, styles.stepDone)}>✓</div>
            <div className={cn(styles.stepLabel, styles.stepLabelDone)}>데이터 수집 완료</div>
            <div className={styles.stepCheck}>✓</div>
          </div>
          <div className={styles.stepRow}>
            <div className={cn(styles.stepIcon, styles.stepActive)}>⚡</div>
            <div className={cn(styles.stepLabel, styles.stepLabelActive)}>AI 9인 위원회 분석 중</div>
            <div className={styles.stepCount}>{activeCommitteeMemberCount} / {committeeMembers.length}</div>
          </div>
          <div className={styles.stepRow}>
            <div className={cn(styles.stepIcon, styles.stepWait)}>📊</div>
            <div className={cn(styles.stepLabel, styles.stepLabelWait)}>회복 시나리오 계산</div>
            <div />
          </div>
          <div className={styles.stepRow}>
            <div className={cn(styles.stepIcon, styles.stepWait)}>📝</div>
            <div className={cn(styles.stepLabel, styles.stepLabelWait)}>최종 리포트 생성</div>
            <div />
          </div>
        </div>

        <div className={styles.committeeWrap}>
          <div className={styles.committeeTitle}>AI 9인 위원회 의견 수렴 중</div>
          <div className={styles.membersGrid}>
            {committeeMembers.map((member) => (
              <div key={member.key} className={styles.member}>
                <div className={cn(styles.memberIcon, memberStateClass(member.state))}>
                  <member.Icon className={styles.memberSvgIcon} aria-hidden />
                </div>
                <div className={styles.memberName}>
                  {member.label.split('\n').map((line) => (
                    <span key={line}>
                      {line}
                      <br />
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
