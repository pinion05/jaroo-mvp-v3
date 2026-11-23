'use client'

// 초안④ — "같은 리포트·다른 결정 비교형" AI 트레이더 쇼케이스 목업 페이지.
// 하나의 deepscan 리포트를 정점에 두고, 성향 다른 4명의 AI 트레이더가 내린 결정을
// 나란히 비교한다. 리포트 탭을 바꾸면 결정 세트·체결·계좌 스냅샷이 함께 바뀐다.
// 모든 데이터는 mock-data.ts의 가상 목업이며 외부 API 호출은 없다.

import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { JarooShell } from '@/components/jaroo-shell'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import {
  AI_TRADER_CHARACTERS,
  AI_TRADER_REPORTS,
  EXPERIMENT_ASOF_TEXT,
  EXPERIMENT_SEED_KRW,
  won,
} from './mock-data'
import { ReportSummaryCard } from './ai-trader-report-summary'
import { AccountCompareTable, CharacterAvatar, DecisionCard } from './ai-trader-decision-card'

export default function AiTraderDraft4Page() {
  const [activeCode, setActiveCode] = useState(AI_TRADER_REPORTS[0].code)
  const activeReport = AI_TRADER_REPORTS.find((report) => report.code === activeCode) ?? AI_TRADER_REPORTS[0]

  return (
    <JarooShell
      title='AI 트레이더 쇼케이스'
      subtitle='같은 리포트, 다른 결정 · 초안④'
      backHref='/home'
      showBottomNav={false}
    >
      {/* 컨셉 배너 — AI 리포트는 하나, 해석은 성격 타고 난다 */}
      <section className='overflow-hidden rounded-2xl bg-[linear-gradient(135deg,var(--jaroo-primary),var(--jaroo-primary-strong))] p-4 text-white shadow-sm'>
        <div className='flex items-center gap-1.5 text-[10px] font-bold text-white/75'>
          <Sparkles className='size-3.5' aria-hidden='true' />
          DEEPSCAN 실험 · 동일 시드 {won(EXPERIMENT_SEED_KRW)}
        </div>
        <h1 className='mt-1.5 text-[16px] font-black leading-snug'>
          AI 리포트는 하나,<br />해석은 성격 타고 난다
        </h1>
        <p className='mt-1.5 text-[11.5px] leading-[1.5] text-white/85'>
          똑같은 deepscan 리포트를 성향 다른 AI 트레이더 4명에게 줬습니다.
          누구에게나 같은 근거 — 결정은 저마다 다릅니다.
        </p>
        <div className='mt-3 flex items-center gap-2'>
          <div className='flex -space-x-1.5'>
            {AI_TRADER_CHARACTERS.map((character) => (
              <span key={character.id} className='flex size-7 items-center justify-center rounded-full border-2 border-white/30 bg-white/20 text-[13px]'>
                {character.emoji}
              </span>
            ))}
          </div>
          <span className='text-[10.5px] font-semibold text-white/75'>{EXPERIMENT_ASOF_TEXT}</span>
        </div>
      </section>

      {/* 1. 리포트 선택 탭 */}
      <Tabs value={activeCode} onValueChange={(value) => setActiveCode(String(value))} className='gap-3'>
        <TabsList className='grid h-11 w-full grid-cols-3 rounded-2xl bg-[color:var(--jaroo-secondary)] p-1'>
          {AI_TRADER_REPORTS.map((report) => {
            const score = report.payload.hero.score
            return (
              <TabsTrigger
                key={report.code}
                value={report.code}
                className='flex h-full flex-col gap-0 rounded-xl py-0.5 data-active:bg-white data-active:text-[color:var(--jaroo-primary)]'
              >
                <span className='text-[12px] font-bold leading-tight'>{report.payload.input.instrument.name}</span>
                <span className={cn('text-[10px] leading-tight tabular-nums', 'text-[color:var(--jaroo-muted)]')}>{score}점</span>
              </TabsTrigger>
            )
          })}
        </TabsList>

        {/* 탭이 바뀌면 리포트 요약 → 캐릭터 결정 → 계좌 비교가 모두 교체된다 */}
        <TabsContent value={activeCode} className='space-y-3'>
          {/* 2. 선택 리포트 요약 헤더 */}
          <ReportSummaryCard payload={activeReport.payload} />

          {/* 3. 4캐릭터 비교 카드 */}
          <div className='flex items-center justify-between px-0.5 pt-1'>
            <span className='text-[12.5px] font-bold text-[color:var(--jaroo-ink)]'>
              이 리포트를 본 4명의 결정
            </span>
            <span className='text-[10px] text-[color:var(--jaroo-muted)]'>
              같은 근거 · {activeReport.decisions.length}가지 해석
            </span>
          </div>
          <div className='space-y-3'>
            {activeReport.decisions.map((decision) => (
              <DecisionCard key={`${activeReport.code}-${decision.characterId}`} decision={decision} />
            ))}
          </div>

          {/* 4. 계좌 미니 비교표 */}
          <AccountCompareTable decisions={activeReport.decisions} instrumentName={activeReport.payload.input.instrument.name} />
        </TabsContent>
      </Tabs>

      {/* 유의 문구 */}
      <p className='px-1 pb-1 text-[10px] leading-[1.5] text-[color:var(--jaroo-muted)]'>
        본 화면은 쇼케이스용 목업입니다. 리포트·체결·수익률은 모두 가상 데이터이며
        투자 권유가 아닙니다. 실제 계좌와 무관합니다.
      </p>
    </JarooShell>
  )
}
