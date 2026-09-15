import type { EtfNoticeReason } from '@/lib/etf/etf-view-model'

// 미지원 데이터 블록 안내 카드(스펙 2026-09-15 D7) — "준비 중"이 아니라
// 왜 채울 수 없는지 사유를 눈에 보이게 렌더한다.
//   source-absent : ETF엔 존재하지 않는 데이터(예: 애널리스트 목표가)
//   source-pending: 소스는 있으나 연결 과제가 남은 데이터
//   planned       : 출시 후 제공 예정

import { cn } from '@/lib/utils'

export const ETF_NOTICE_REASON_LABELS: Record<EtfNoticeReason, string> = {
  'source-absent': '제공되지 않는 데이터',
  'source-pending': '소스 준비 중',
  planned: '출시 후 예정',
}

const REASON_BADGE_CLASS: Record<EtfNoticeReason, string> = {
  'source-absent': 'bg-[color:var(--jaroo-danger-soft)] text-[color:var(--jaroo-danger)]',
  'source-pending': 'bg-[color:var(--jaroo-warning-soft)] text-[color:var(--jaroo-warning)]',
  planned: 'bg-[color:var(--jaroo-secondary)] text-[color:var(--jaroo-muted)]',
}

export function EtfDataNoticeCard({
  reason,
  message,
  eyebrow,
  className,
}: {
  reason: EtfNoticeReason
  message: string
  eyebrow?: string
  className?: string
}) {
  return (
    <div
      className={cn(
        'rounded-[24px] border border-[color:var(--jaroo-border)] bg-white p-4 shadow-none',
        className,
      )}
      data-etf-notice={reason}
    >
      {eyebrow ? (
        <p className='text-[10px] tracking-[0.04em] text-[color:var(--jaroo-muted)]'>{eyebrow}</p>
      ) : null}
      <div className='mt-2 flex items-center gap-2'>
        <span
          className={cn(
            'rounded-[8px] px-2 py-1 text-[11px] font-semibold',
            REASON_BADGE_CLASS[reason],
          )}
        >
          {ETF_NOTICE_REASON_LABELS[reason]}
        </span>
      </div>
      <p className='mt-2 text-[13px] font-medium text-[color:var(--jaroo-ink)]'>{message}</p>
    </div>
  )
}
