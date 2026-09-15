'use client'

import type { LucideIcon } from 'lucide-react'

import type { EtfNoticeReason } from '@/lib/etf/etf-view-model'

// 미지원 데이터 블록 안내 카드(스펙 2026-09-15 D7) — "준비 중"이 아니라
// 왜 채울 수 없는지 사유를 눈에 보이게 렌더한다.
//   source-absent : ETF엔 존재하지 않는 데이터(예: 애널리스트 목표가)
//   source-pending: 소스는 있으나 연결 과제가 남은 데이터
//   planned       : 출시 후 제공 예정
// 딥스캔 결과 카드(deepscan-inline-results)와 같은 문법: 16px 카드 + #E8EAEE 1px 보더 +
// 다크 아이콘 칩 헤더 + 사유 배지 + 요약 본문.

import { cn } from '@/lib/utils'

export const ETF_NOTICE_REASON_LABELS: Record<EtfNoticeReason, string> = {
  'source-absent': '제공되지 않는 데이터',
  'source-pending': '소스 준비 중',
  planned: '출시 후 예정',
}

const REASON_BADGE_CLASS: Record<EtfNoticeReason, string> = {
  'source-absent': 'bg-[#FAEEDA] text-[#854F0B]',
  'source-pending': 'bg-[#EEF0F3] text-[#0F1419]',
  planned: 'bg-[#F1F3F6] text-[#97A0AE]',
}

export function EtfDataNoticeCard({
  reason,
  message,
  eyebrow,
  icon: Icon,
  body,
  className,
}: {
  reason: EtfNoticeReason
  message: string
  eyebrow?: string
  icon?: LucideIcon
  body?: string
  className?: string
}) {
  return (
    <article
      className={cn(
        'overflow-hidden rounded-[16px] border border-[#E8EAEE] bg-white shadow-[0_1px_3px_rgba(0,0,0,.04)]',
        className,
      )}
      data-etf-notice={reason}
      aria-label={eyebrow ? `${eyebrow} 안내` : '데이터 안내'}
    >
      {eyebrow ? (
        <div className='flex items-center gap-3 border-b border-[#EFF1F4] px-4 py-4'>
          {Icon ? (
            <div className='flex size-9 items-center justify-center rounded-[10px] bg-[#0F1419] text-white'>
              <Icon className='size-4' aria-hidden />
            </div>
          ) : null}
          <div className='min-w-0 flex-1'>
            <div className='text-[10px] text-[#97A0AE]'>데이터 안내</div>
            <h2 className='text-[14px] font-bold text-[#0F1419]'>{eyebrow}</h2>
          </div>
          <span className={cn('shrink-0 rounded-[6px] px-2 py-1 text-[10px] font-bold', REASON_BADGE_CLASS[reason])}>
            {ETF_NOTICE_REASON_LABELS[reason]}
          </span>
        </div>
      ) : (
        <div className='flex items-center gap-2 px-4 pt-4'>
          <span className={cn('rounded-[6px] px-2 py-1 text-[10px] font-bold', REASON_BADGE_CLASS[reason])}>
            {ETF_NOTICE_REASON_LABELS[reason]}
          </span>
        </div>
      )}
      <div className='px-4 py-4'>
        <p className='text-[13px] font-bold leading-6 text-[#0F1419]'>{message}</p>
        {body ? <p className='mt-1 text-[11.5px] leading-5 text-[#5A6473]'>{body}</p> : null}
      </div>
    </article>
  )
}
