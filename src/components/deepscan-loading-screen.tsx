'use client'

import Link from 'next/link'
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

const committeeMembers: ReadonlyArray<{ icon: string; label: string; state: CommitteeMemberState }> = [
  { icon: '가', label: '가치\n분석가', state: 'active' },
  { icon: '성', label: '성장\n전략가', state: 'active' },
  { icon: '재', label: '재무\n감사관', state: 'active' },
  { icon: '차', label: '차트\n마스터', state: 'active' },
  { icon: '수', label: '수급\n추적기', state: 'active' },
  { icon: '모', label: '모멘텀\n스카우터', state: 'active' },
  { icon: '심', label: '심리\n분석AI', state: 'active' },
  { icon: '산', label: '산업\n전문가', state: 'active' },
  { icon: '이', label: '이벤트\n스캐너', state: 'active' },
] as const

const activeCommitteeMemberCount = committeeMembers.filter((member) => member.state === 'active').length

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
  const targetLine = [name, identifier].filter(Boolean).join(' ')

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
              <div key={member.icon} className={styles.member}>
                <div className={cn(styles.memberIcon, memberStateClass(member.state))}>{member.icon}</div>
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
