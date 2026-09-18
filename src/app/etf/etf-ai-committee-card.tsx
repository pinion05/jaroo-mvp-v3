'use client'

import { ChartCandlestick, Loader2, Radar, TrendingUp } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { narrativeToneClass } from '@/components/deepscan-loading-utils'
import styles from '@/components/deepscan-loading-screen.module.css'
import { cn } from '@/lib/utils'

import { presentEtfCommitteeMember, type EtfCommitteeState } from './etf-page-model'

// AI 위원회 — 국내 ETF 전용. 시장·차트 팀 3명(지수/가격 흐름·시장 신호·가격 위치)의
// LLM 분석을 /deepscan 로딩 화면의 채팅(narrativeCard) 디자인 그대로 보여준다:
// 아바타 + 위원명 + 상태 라벨 + 말풍선 사유 + 점수 태그. 로딩/고민중은 스켈레톤 버블.

const MEMBER_AVATARS: Record<string, LucideIcon> = {
  trend: TrendingUp,
  consensusMomentum: Radar,
  priceLocation: ChartCandlestick,
}

export function EtfAiCommitteeCard({
  committee,
  onRetry,
}: {
  committee: EtfCommitteeState
  onRetry: () => void
}) {
  if (committee.phase === 'idle') {
    return null
  }

  if (committee.phase === 'error' || committee.phase === 'disabled') {
    return (
      <section className={styles.narrativeStream} style={{ marginBottom: 0 }} aria-label='AI 위원회 시장·차트 팀 상태'>
        <article className={cn(styles.narrativeCard, styles.narrativeCardPending)}>
          <div className={styles.narrativeHead}>
            <span className={styles.narrativeAvatar} aria-hidden='true'>
              <TrendingUp className='size-[18px]' aria-hidden />
            </span>
            <div className={styles.narrativeNameWrap}>
              <strong>시장·차트 팀</strong>
              <span>지수/가격 흐름 · 시장 신호/정보 밀도 · 가격 위치</span>
            </div>
            <span className={cn(styles.narrativeStatus, narrativeToneClass(committee.phase === 'error' ? 'warning' : 'info'))}>
              {committee.phase === 'error' ? '일시 오류' : '준비 중'}
            </span>
          </div>
          <div className={styles.narrativeBubble}>
            <p className={styles.narrativeText}>{committee.message}</p>
            {committee.phase === 'error' ? (
              <button type='button' className={styles.narrativeSummaryAppendixToggle} onClick={onRetry}>
                <span>다시 시도</span>
              </button>
            ) : null}
          </div>
        </article>
      </section>
    )
  }

  const loading = committee.phase === 'loading'
  const members = committee.phase === 'ready' ? committee.members : []

  return (
    <section className={styles.narrativeStream} style={{ marginBottom: 0 }} aria-label='AI 위원회 시장·차트 팀 의견'>
      {loading
        ? [0, 1, 2].map((index) => (
            <article key={index} className={cn(styles.narrativeCard, styles.narrativeCardPending)}>
              <div className={styles.narrativeHead}>
                <span className={cn(styles.narrativeAvatar, styles.narrativeAvatarPending)} aria-hidden='true'>
                  <Loader2 className={styles.narrativeSpinner} aria-hidden />
                </span>
                <div className={styles.narrativeNameWrap}>
                  <strong><span className={styles.narrativeTitleSkeleton} aria-hidden='true' /></strong>
                  <span><span className={styles.narrativeDescriptionSkeleton} aria-hidden='true' /></span>
                </div>
                <span className={cn(styles.narrativeStatus, narrativeToneClass('info'))}>분석 중</span>
              </div>
              <div className={styles.narrativeBubble}>
                <div className={styles.narrativeTextSkeleton} aria-hidden='true'>
                  <span />
                </div>
              </div>
            </article>
          ))
        : members.map((member) => {
            const presentation = presentEtfCommitteeMember(member)
            const Avatar = MEMBER_AVATARS[member.memberKey] ?? TrendingUp
            const pending = member.status === 'pending'
            return (
              <article key={member.memberKey || member.title} className={cn(styles.narrativeCard, pending ? styles.narrativeCardPending : undefined)}>
                <div className={styles.narrativeHead}>
                  <span className={cn(styles.narrativeAvatar, pending ? styles.narrativeAvatarPending : undefined)} aria-hidden='true'>
                    {pending ? <Loader2 className={styles.narrativeSpinner} aria-hidden /> : <Avatar className='size-[18px]' aria-hidden />}
                  </span>
                  <div className={styles.narrativeNameWrap}>
                    <strong>{member.title}</strong>
                    <span>시장·차트 팀 AI 위원</span>
                  </div>
                  <span className={cn(styles.narrativeStatus, narrativeToneClass(presentation.statusTone))}>
                    {presentation.statusLabel}
                  </span>
                </div>
                <div className={styles.narrativeBubble}>
                  {presentation.skeleton ? (
                    <div className={styles.narrativeTextSkeleton} aria-hidden='true'>
                      <span />
                    </div>
                  ) : (
                    <p className={styles.narrativeText}>{presentation.bubbleText}</p>
                  )}
                  {presentation.scoreTagText ? (
                    <div className={styles.narrativeTags}>
                      <span className={cn(styles.narrativeTag, narrativeToneClass(presentation.scoreTone ?? 'neutral'))}>
                        {presentation.scoreTagText}
                      </span>
                    </div>
                  ) : null}
                </div>
              </article>
            )
          })}
    </section>
  )
}
