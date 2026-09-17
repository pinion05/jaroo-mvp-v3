// /etf 결과 카드 공통 셸 — page.tsx의 카드들이 같은 문법(머리+배지+본문)을 공유한다.
import type { ReactNode } from 'react'

export function EtfResultCardShell({
  eyebrow,
  title,
  badge,
  children,
}: {
  eyebrow: string
  title: string
  badge?: string
  children: ReactNode
}) {
  return (
    <article className='overflow-hidden rounded-[16px] border border-[#E8EAEE] bg-white shadow-[0_1px_3px_rgba(0,0,0,.04)]'>
      <div className='flex items-center gap-3 border-b border-[#EFF1F4] px-4 py-4'>
        <div className='flex size-9 items-center justify-center rounded-[10px] bg-[#0F1419] text-[12px] font-black text-white'>
          ETF
        </div>
        <div className='min-w-0 flex-1'>
          <div className='mb-[3px] text-[10px] leading-[13px] text-[#97A0AE]'>{eyebrow}</div>
          <h2 className='text-[15px] font-bold leading-[19px] text-[#0F1419]'>{title}</h2>
        </div>
        {badge ? <span className='shrink-0 rounded-[6px] bg-[#EEF0F3] px-2 py-1 text-[10px] font-bold text-[#0F1419]'>{badge}</span> : null}
      </div>
      {children}
    </article>
  )
}
