import { AlertTriangle, Check } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { getFinancialValueTextClass } from '@/lib/financial-value-tone'
import { type OcrConflict } from '@/lib/screenshot-ocr'
import { cn } from '@/lib/utils'

type OcrConflictMergeCardProps = {
  conflict: OcrConflict
  selectedCandidateId?: string
  onSelect: (candidateId: string) => void
}

export function OcrConflictMergeCard({ conflict, selectedCandidateId, onSelect }: OcrConflictMergeCardProps) {
  const isResolved = Boolean(selectedCandidateId)

  return (
    <Card className='overflow-hidden rounded-[24px] border border-[#FAC775] bg-white shadow-none'>
      <div className='border-b border-[#F5E2B8] bg-[color:var(--jaroo-warning-soft)] px-4 py-3'>
        <div className='flex items-start gap-2'>
          <div className='mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-white text-[#854F0B]'>
            {isResolved ? <Check className='size-3.5' strokeWidth={2.6} /> : <AlertTriangle className='size-3.5' strokeWidth={2.6} />}
          </div>
          <div>
            <p className='text-[13px] font-semibold text-[#854F0B]'>{conflict.displayName} 충돌</p>
            <p className='mt-1 text-[11px] leading-5 text-[#8A6520]'>같은 종목이 여러 장에서 다르게 인식됐어요. 유지할 결과를 하나 선택해주세요.</p>
          </div>
        </div>
      </div>

      <div className='space-y-2 px-4 py-4'>
        {conflict.candidates.map((candidate, index) => {
          const active = selectedCandidateId === candidate.id

          return (
            <button
              key={candidate.id}
              type='button'
              aria-pressed={active}
              onClick={() => onSelect(candidate.id)}
              className={cn(
                'w-full rounded-[20px] border px-4 py-3 text-left transition',
                active
                  ? 'border-[color:var(--jaroo-primary)] bg-[color:var(--jaroo-accent)] shadow-[0_6px_20px_rgba(75,157,245,0.12)]'
                  : 'border-[color:var(--jaroo-border)] bg-white hover:bg-[color:var(--jaroo-secondary)]',
              )}
            >
              <div className='flex items-start justify-between gap-3'>
                <div>
                  <p className={cn('text-[12px] font-semibold', active ? 'text-[color:var(--jaroo-primary)]' : 'text-[color:var(--jaroo-ink)]')}>
                    후보 {index + 1}
                  </p>
                  <p className='mt-1 text-[11px] text-[color:var(--jaroo-muted)]'>{candidate.fileName}</p>
                </div>
                <span
                  className={cn(
                    'inline-flex rounded-full px-2 py-1 text-[10px] font-semibold',
                    active ? 'bg-[color:var(--jaroo-primary)] text-white' : 'bg-[color:var(--jaroo-secondary)] text-[color:var(--jaroo-muted)]',
                  )}
                >
                  {active ? '선택됨' : '선택'}
                </span>
              </div>

              <div className='mt-3 grid grid-cols-2 gap-2'>
                <div className='rounded-[16px] bg-[color:var(--jaroo-secondary)] px-3 py-2'>
                  <p className='text-[10px] text-[color:var(--jaroo-muted)]'>보유 수량</p>
                  <p className='mt-1 text-[12px] font-semibold text-[color:var(--jaroo-ink)]'>{candidate.quantity || '-'}</p>
                </div>
                <div className='rounded-[16px] bg-[color:var(--jaroo-secondary)] px-3 py-2'>
                  <p className='text-[10px] text-[color:var(--jaroo-muted)]'>평가 금액</p>
                  <p className='mt-1 text-[12px] font-semibold text-[color:var(--jaroo-ink)]'>{candidate.evaluationAmount || '-'}</p>
                </div>
                <div className='rounded-[16px] bg-[color:var(--jaroo-secondary)] px-3 py-2'>
                  <p className='text-[10px] text-[color:var(--jaroo-muted)]'>평균 단가</p>
                  <p className='mt-1 text-[12px] font-semibold text-[color:var(--jaroo-ink)]'>{candidate.averagePrice || '-'}</p>
                </div>
                <div className='rounded-[16px] bg-[color:var(--jaroo-secondary)] px-3 py-2'>
                  <p className='text-[10px] text-[color:var(--jaroo-muted)]'>수익률</p>
                  <p className={cn('mt-1 text-[12px] font-semibold', getFinancialValueTextClass(candidate.profitRate))}>{candidate.profitRate || '-'}</p>
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </Card>
  )
}
