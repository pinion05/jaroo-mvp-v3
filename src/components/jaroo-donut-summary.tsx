import { holdings, toneClass } from '@/lib/jaroo-data'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'

export function JarooDonutSummary() {
  const slices = holdings.map((item, index) => {
    const palette = ['#E24B4A', '#EF9F27', '#5B7CFA', '#7E97BD', '#185FA5']
    const start = index * 72
    const end = start + 60
    return `${palette[index]} ${start}deg ${end}deg`
  })

  return (
    <Card className='overflow-hidden rounded-[28px] border-0 bg-[linear-gradient(180deg,var(--jaroo-primary-strong),var(--jaroo-primary))] p-5 text-white shadow-none'>
      <div className='flex items-start justify-between gap-3'>
        <div>
          <p className='text-xs text-white/60'>포트폴리오 변화</p>
          <div className='mt-2 flex items-end gap-2'>
            <p className='text-4xl font-semibold leading-none'>54</p>
            <Badge className='rounded-full bg-[color:var(--jaroo-warning-soft)] px-2.5 py-1 text-[11px] text-[color:var(--jaroo-warning)]'>주의</Badge>
          </div>
        </div>
        <div className='rounded-full bg-white/12 px-3 py-1 text-xs text-white/80'>이번 주 순풍 ↑</div>
      </div>

      <div className='mt-5 flex items-center justify-center'>
        <div
          className='relative grid size-48 place-items-center rounded-full border border-white/10'
          style={{ background: `conic-gradient(${slices.join(', ')})` }}
        >
          <div className='grid size-28 place-items-center rounded-full bg-[color:var(--jaroo-primary-strong)] text-center shadow-inner'>
            <div>
              <p className='text-[11px] text-white/55'>탭하면 이동</p>
              <p className='mt-1 text-xl font-semibold'>5개 종목</p>
              <p className='mt-1 text-[11px] text-white/65'>같은 앱처럼 보이는 구조로 재정리</p>
            </div>
          </div>
        </div>
      </div>

      <div className='mt-5 grid gap-2'>
        {holdings.map((item) => {
          const tone = toneClass(item.tone)
          return (
            <div key={item.code} className='flex items-center gap-3 rounded-2xl bg-white/10 px-3 py-2'>
              <div className={`size-2 rounded-full ${tone.dot}`} />
              <div className='min-w-0 flex-1'>
                <p className='truncate text-sm font-medium'>{item.name}</p>
                <p className='text-[11px] text-white/60'>{item.market} · {item.shares}</p>
              </div>
              <p className={`text-sm font-semibold ${tone.text}`}>{item.change}</p>
            </div>
          )
        })}
      </div>
    </Card>
  )
}
