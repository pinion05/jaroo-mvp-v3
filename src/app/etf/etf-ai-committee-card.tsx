'use client'

import { Sparkles } from 'lucide-react'

import { cn } from '@/lib/utils'

import type { EtfCommitteeState } from './etf-page-model'
import { EtfResultCardShell } from './etf-result-card-shell'

// AI 위원회 카드 — 국내 ETF 전용. ETF엔 PER 등 주식형 근거가 없어 시장·차트 팀
// 3명(지수/가격 흐름·시장 신호·가격 위치)만 LLM 분석한다. 로딩 스켈레톤 →
// partial 폴링('고민중…') → 완성 사유까지 카드 문법 안에서 흐른다.
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
      <EtfResultCardShell
        eyebrow='AI 위원회'
        title='시장·차트 팀'
        badge={committee.phase === 'disabled' ? '준비 중' : '일시 오류'}
      >
        <div className='flex items-start gap-3 px-4 py-5'>
          <Sparkles className='mt-0.5 size-4 shrink-0 text-[#97A0AE]' />
          <div className='min-w-0 flex-1'>
            <p className='text-[13px] font-bold leading-6 text-[#0F1419]'>{committee.message}</p>
            {committee.phase === 'error' ? (
              <button
                type='button'
                onClick={onRetry}
                className='mt-2 rounded-[6px] bg-[#0F1419] px-3 py-1.5 text-[11px] font-bold text-white'
              >
                다시 시도
              </button>
            ) : null}
          </div>
        </div>
      </EtfResultCardShell>
    )
  }

  const loading = committee.phase === 'loading'
  const members = committee.phase === 'ready' ? committee.members : []

  return (
    <EtfResultCardShell
      eyebrow='AI 위원회'
      title='시장·차트 팀'
      badge={loading ? '분석 중' : `${members.length}명 분석`}
    >
      {committee.phase === 'ready' && committee.axisStatusText ? (
        <div className='border-b border-[#EFF1F4] px-4 pt-3 pb-2 text-[10px] text-[#97A0AE]'>
          {committee.axisStatusText}
        </div>
      ) : null}
      <div className='space-y-3 px-4 py-4'>
        {loading
          ? [0, 1, 2].map((index) => (
              <div key={index} className='animate-pulse space-y-1.5'>
                <div className='h-3.5 w-1/3 rounded bg-[#EFF1F4]' />
                <div className='h-3 w-4/5 rounded bg-[#F4F6F8]' />
              </div>
            ))
          : members.map((member) => (
              <div key={member.memberKey || member.title}>
                <div className='flex items-center gap-2 text-[13px]'>
                  <span
                    className={cn(
                      'size-2 shrink-0 rounded-full',
                      member.status === 'success' ? 'bg-[#2B6BE6]' : member.status === 'pending' ? 'animate-pulse bg-[#97A0AE]' : 'bg-[#E5484D]',
                    )}
                  />
                  <span className='min-w-0 truncate font-bold text-[#0F1419]'>{member.title}</span>
                  <span
                    className={cn(
                      'ml-auto shrink-0 text-[12px] font-bold',
                      member.status === 'success' ? 'text-[#0F1419]' : 'text-[#97A0AE]',
                    )}
                  >
                    {member.status === 'error' ? '응답 실패' : member.scoreLabel}
                  </span>
                </div>
                {member.reason ? (
                  <p className='mt-1 pl-4 text-[11px] leading-5 text-[#5A6473]'>{member.reason}</p>
                ) : null}
              </div>
            ))}
      </div>
    </EtfResultCardShell>
  )
}
