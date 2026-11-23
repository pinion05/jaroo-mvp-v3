'use client'

import { useMemo, useState } from 'react'
import {
  Coins,
  Landmark,
  ReceiptText,
  Sparkles,
  Target,
  TrendingUp,
  Wallet,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { JarooShell } from '@/components/jaroo-shell'

import { AI_TRADER_CHARACTERS, DEEPSCAN_REPORTS } from './mock-data'
import type { AiTraderCharacter, AiTraderJudgment } from './mock-data'

// ---------------------------------------------------------------------------
// 포맷 유틸
// ---------------------------------------------------------------------------

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`

/** 원장 원본(ISO KST)을 slice로 포맷 — tz 민감 라이브러리 없이 하이드레이션 안전하게 */
const dayText = (iso: string) => iso.slice(5, 10).replace('-', '.')
const timeText = (iso: string) => iso.slice(11, 16)

const signedPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`

/** Jaroo 관례: 수익=빨강(--jaroo-profit), 손실=파랑(--jaroo-loss) */
function pnlClass(n: number) {
  if (n > 0) return 'text-[color:var(--jaroo-profit)]'
  if (n < 0) return 'text-[color:var(--jaroo-loss)]'
  return 'text-[color:var(--jaroo-muted)]'
}

const RECOVERY_HORIZON_LABEL: Record<NonNullable<AiTraderJudgment['recoveryHorizon']>, string> = {
  '3m': '3개월',
  '6m': '6개월',
  '1y': '1년',
}

const DECISION_TONE: Record<AiTraderJudgment['decisionCode'], { badge: string; label: string }> = {
  BUY_FIRST: { badge: 'bg-[color:var(--jaroo-profit-soft)] text-[color:var(--jaroo-profit)]', label: '신규 매수' },
  BUY_ADD: { badge: 'bg-[color:var(--jaroo-profit-soft)] text-[color:var(--jaroo-profit)]', label: '추가 매수' },
  SELL_PROFIT: { badge: 'bg-[color:var(--jaroo-loss-soft)] text-[color:var(--jaroo-loss)]', label: '익절 매도' },
  SELL_STOP: { badge: 'bg-[color:var(--jaroo-loss-soft)] text-[color:var(--jaroo-loss)]', label: '손절 매도' },
  HOLD_WATCH: { badge: 'bg-[color:var(--jaroo-neutral-soft)] text-[color:var(--jaroo-ink)]', label: '관망' },
}

function profitRate(account: { principal: number; evaluation: number }) {
  return ((account.evaluation - account.principal) / account.principal) * 100
}

// ---------------------------------------------------------------------------
// ① 캐릭터 선택 캐러셀
// ---------------------------------------------------------------------------

function CharacterCarousel({
  characters,
  selectedId,
  onSelect,
}: {
  characters: AiTraderCharacter[]
  selectedId: string
  onSelect: (id: string) => void
}) {
  return (
    <section aria-label='AI 트레이더 선택'>
      <style>{`.jaroo-carousel::-webkit-scrollbar{display:none}`}</style>
      <div className='jaroo-carousel -mx-4 overflow-x-auto px-4 pb-1' style={{ scrollbarWidth: 'none' }}>
        <div className='flex w-max snap-x snap-mandatory gap-2.5'>
          {characters.map((character) => {
            const selected = character.id === selectedId
            const rate = profitRate(character.account)
            return (
              <button
                key={character.id}
                type='button'
                onClick={() => onSelect(character.id)}
                aria-pressed={selected}
                className={cn(
                  'flex w-[112px] shrink-0 snap-start flex-col items-center gap-1.5 rounded-2xl border px-2 py-3 text-center transition',
                  selected
                    ? 'border-[color:var(--jaroo-primary)] bg-[color:var(--jaroo-accent)] shadow-[0_4px_14px_rgba(24,95,165,0.14)]'
                    : 'border-[color:var(--jaroo-border)] bg-white hover:border-[color:var(--jaroo-primary)]/40',
                )}
              >
                <span
                  className={cn(
                    'grid size-11 place-items-center rounded-full text-xl',
                    character.avatarClass,
                    selected && 'ring-2 ring-[color:var(--jaroo-primary)] ring-offset-1',
                  )}
                  aria-hidden
                >
                  {character.emoji}
                </span>
                <span className='text-[13px] font-bold text-[color:var(--jaroo-ink)]'>{character.name}</span>
                <span
                  className={cn(
                    'rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                    rate >= 0
                      ? 'bg-[color:var(--jaroo-profit-ghost)] text-[color:var(--jaroo-profit)]'
                      : 'bg-[color:var(--jaroo-loss-soft)] text-[color:var(--jaroo-loss)]',
                  )}
                >
                  {signedPct(rate)}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// ② 페르소나 카드
// ---------------------------------------------------------------------------

function PersonaCard({ character }: { character: AiTraderCharacter }) {
  return (
    <Card className='rounded-[1rem]'>
      <CardContent className='space-y-3.5'>
        <div className='flex items-start gap-3.5'>
          <span
            className={cn('grid size-16 shrink-0 place-items-center rounded-2xl text-3xl', character.avatarClass)}
            aria-hidden
          >
            {character.emoji}
          </span>
          <div className='min-w-0 flex-1 space-y-1.5'>
            <div className='flex flex-wrap items-baseline gap-x-2 gap-y-1'>
              <span className='text-lg font-extrabold text-[color:var(--jaroo-ink)]'>{character.name}</span>
              <span className='text-xs text-[color:var(--jaroo-muted)]'>{character.profileLine}</span>
            </div>
            <div className='flex flex-wrap gap-1.5'>
              {character.traitTags.map((tag) => (
                <Badge
                  key={tag}
                  variant='outline'
                  className='rounded-full border-[color:var(--jaroo-border)] bg-[color:var(--jaroo-secondary)] px-2 py-0 text-[10px] font-semibold text-[color:var(--jaroo-primary)]'
                >
                  {tag}
                </Badge>
              ))}
            </div>
          </div>
        </div>

        <blockquote className='rounded-r-xl border-l-[3px] border-[color:var(--jaroo-primary)] bg-[color:var(--jaroo-secondary)] px-3 py-2 text-[12.5px] font-medium italic leading-relaxed text-[color:var(--jaroo-ink)]'>
          “{character.philosophy}”
        </blockquote>

        {/* 말투 샘플 말풍선 */}
        <div className='flex gap-2'>
          <span className={cn('mt-auto grid size-7 shrink-0 place-items-center rounded-full text-sm', character.avatarClass)} aria-hidden>
            {character.emoji}
          </span>
          <p className='rounded-2xl rounded-tl-sm bg-[color:var(--jaroo-accent)] px-3 py-2 text-[12.5px] leading-relaxed text-[color:var(--jaroo-primary-strong)]'>
            {character.toneSample}
          </p>
        </div>

        <Separator className='bg-[color:var(--jaroo-border)]' />

        {/* 목표 진척도 */}
        <div className='space-y-1.5'>
          <div className='flex items-center justify-between gap-2'>
            <span className='flex items-center gap-1 text-xs font-bold text-[color:var(--jaroo-ink)]'>
              <Target className='size-3.5 text-[color:var(--jaroo-primary)]' aria-hidden />
              {character.goal.label}
            </span>
            <span className='text-xs font-extrabold text-[color:var(--jaroo-primary)]'>
              {character.goal.targetText}까지 {character.goal.pct}%
            </span>
          </div>
          <Progress value={character.goal.pct} aria-label={`${character.goal.label} 진척도`} />
          <div className='flex justify-between text-[11px] text-[color:var(--jaroo-muted)]'>
            <span>현재 {character.goal.currentText}</span>
            <span>목표 {character.goal.targetText}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// ③ 계좌 요약
// ---------------------------------------------------------------------------

function AccountSummary({ character }: { character: AiTraderCharacter }) {
  const { account } = character
  const rate = profitRate(account)
  const profitAmount = account.evaluation - account.principal
  const cells = [
    { icon: Wallet, label: '현금', value: won(account.cash) },
    { icon: Coins, label: '매입원본', value: won(account.principal) },
    { icon: TrendingUp, label: '평가금액', value: won(account.evaluation) },
    { icon: Sparkles, label: '수익률', value: signedPct(rate), valueClass: pnlClass(rate), sub: `${profitAmount >= 0 ? '+' : ''}${profitAmount.toLocaleString('ko-KR')}원` },
  ]
  return (
    <Card className='rounded-[1rem]'>
      <CardContent className='space-y-2.5'>
        <div className='flex items-center justify-between'>
          <h2 className='flex items-center gap-1.5 text-[13px] font-extrabold text-[color:var(--jaroo-ink)]'>
            <Landmark className='size-4 text-[color:var(--jaroo-primary)]' aria-hidden />
            {character.name}의 계좌
          </h2>
          <span className='text-[11px] text-[color:var(--jaroo-muted)]'>
            총자산 {won(account.cash + account.evaluation)}
          </span>
        </div>
        <div className='grid grid-cols-2 gap-2'>
          {cells.map((cell) => (
            <div key={cell.label} className='rounded-xl bg-[color:var(--jaroo-secondary)] px-3 py-2'>
              <p className='flex items-center gap-1 text-[11px] text-[color:var(--jaroo-muted)]'>
                <cell.icon className='size-3' aria-hidden />
                {cell.label}
              </p>
              <p className={cn('mt-0.5 text-sm font-extrabold tabular-nums text-[color:var(--jaroo-ink)]', cell.valueClass)}>
                {cell.value}
              </p>
              {cell.sub ? <p className={cn('text-[11px] font-semibold tabular-nums', cell.valueClass ?? 'text-[color:var(--jaroo-muted)]')}>{cell.sub}</p> : null}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// ④ 판단 카드 목록
// ---------------------------------------------------------------------------

function JudgmentCard({ character, judgment }: { character: AiTraderCharacter; judgment: AiTraderJudgment }) {
  const report = DEEPSCAN_REPORTS[judgment.reportId]
  const tone = DECISION_TONE[judgment.decisionCode]
  return (
    <Card className='rounded-[1rem]'>
      <CardContent className='space-y-2.5'>
        <div className='flex items-center justify-between gap-2'>
          <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-extrabold', tone.badge)}>
            {judgment.decisionLabel}
          </span>
          <span className='text-[11px] tabular-nums text-[color:var(--jaroo-muted)]'>
            {dayText(judgment.generatedAt)} {timeText(judgment.generatedAt)}
          </span>
        </div>

        <div className='flex items-baseline justify-between gap-2'>
          <h3 className='text-[15px] font-extrabold text-[color:var(--jaroo-ink)]'>
            {judgment.instrumentName}
            <span className='ml-1.5 text-[11px] font-medium text-[color:var(--jaroo-muted)]'>
              {judgment.instrumentCode}
            </span>
          </h3>
          {judgment.side ? (
            <span
              className={cn(
                'text-xs font-extrabold',
                judgment.side === 'BUY' ? 'text-[color:var(--jaroo-profit)]' : 'text-[color:var(--jaroo-loss)]',
              )}
            >
              {judgment.side === 'BUY' ? '매수' : '매도'}
            </span>
          ) : null}
        </div>

        {/* 근거 리포트 요약 — 어떤 deepscan 리포트를 봤는지 */}
        <div className='rounded-xl bg-[color:var(--jaroo-secondary)] px-3 py-2'>
          <div className='flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]'>
            <span className='font-bold text-[color:var(--jaroo-ink)]'>
              hero {judgment.heroScore}점
            </span>
            {judgment.recoveryPct !== null && judgment.recoveryHorizon ? (
              <span className='text-[color:var(--jaroo-muted)]'>
                본전 회복 {RECOVERY_HORIZON_LABEL[judgment.recoveryHorizon]} 내 {judgment.recoveryPct}%
              </span>
            ) : null}
            {judgment.targetPrice !== null ? (
              <span className='text-[color:var(--jaroo-muted)]'>목표가 {won(judgment.targetPrice)}</span>
            ) : null}
          </div>
          <code className='mt-1 block truncate text-[10px] text-[color:var(--jaroo-muted)]' title={judgment.debugId}>
            debugId {judgment.debugId}
          </code>
        </div>

        {/* 캐릭터 말투 서사 */}
        <div className='flex gap-2'>
          <span className={cn('mt-auto grid size-7 shrink-0 place-items-center rounded-full text-sm', character.avatarClass)} aria-hidden>
            {character.emoji}
          </span>
          <p className='rounded-2xl rounded-tl-sm border border-[color:var(--jaroo-border)] bg-white px-3 py-2 text-[12.5px] leading-relaxed text-[color:var(--jaroo-ink)]'>
            {judgment.narrative}
          </p>
        </div>

        {report?.hero.evidenceFacts?.length ? (
          <ul className='space-y-1 pl-1'>
            {report.hero.evidenceFacts.slice(0, 2).map((fact) => (
              <li key={fact} className='flex gap-1.5 text-[11px] leading-relaxed text-[color:var(--jaroo-muted)]'>
                <span aria-hidden className='mt-[7px] size-1 shrink-0 rounded-full bg-[color:var(--jaroo-primary)]/50' />
                {fact}
              </li>
            ))}
          </ul>
        ) : null}

        <div className='text-right'>
          <code className='rounded-md bg-[color:var(--jaroo-secondary)] px-1.5 py-0.5 text-[10px] font-semibold text-[color:var(--jaroo-primary)]'>
            {judgment.reasonCode}
          </code>
        </div>
      </CardContent>
    </Card>
  )
}

function JudgmentList({ character }: { character: AiTraderCharacter }) {
  return (
    <section className='space-y-2.5'>
      <h2 className='flex items-center gap-1.5 text-[13px] font-extrabold text-[color:var(--jaroo-ink)]'>
        <ReceiptText className='size-4 text-[color:var(--jaroo-primary)]' aria-hidden />
        최근 판단
        <span className='text-[11px] font-medium text-[color:var(--jaroo-muted)]'>
          · 같은 deepscan 리포트, 다른 결정
        </span>
      </h2>
      {character.judgments.map((judgment) => (
        <JudgmentCard key={judgment.debugId} character={character} judgment={judgment} />
      ))}
    </section>
  )
}

// ---------------------------------------------------------------------------
// ⑤ 체결 내역 · 보유 종목 탭
// ---------------------------------------------------------------------------

function LedgerSection({ character }: { character: AiTraderCharacter }) {
  return (
    <section className='space-y-2'>
      <h2 className='text-[13px] font-extrabold text-[color:var(--jaroo-ink)]'>매매 원장</h2>
      <Tabs defaultValue='fills'>
        <TabsList className='w-full'>
          <TabsTrigger value='fills' className='flex-1'>
            체결 내역 {character.executions.length}건
          </TabsTrigger>
          <TabsTrigger value='holdings' className='flex-1'>
            보유 종목 {character.positions.length}종목
          </TabsTrigger>
        </TabsList>

        <TabsContent value='fills' className='space-y-2'>
          {character.executions.map((execution) => (
            <div
              key={execution.orderId}
              className='flex items-center gap-3 rounded-xl border border-[color:var(--jaroo-border)] bg-white px-3 py-2.5'
            >
              <span
                className={cn(
                  'grid size-8 shrink-0 place-items-center rounded-lg text-[11px] font-extrabold',
                  execution.side === 'BUY'
                    ? 'bg-[color:var(--jaroo-profit-soft)] text-[color:var(--jaroo-profit)]'
                    : 'bg-[color:var(--jaroo-loss-soft)] text-[color:var(--jaroo-loss)]',
                )}
              >
                {execution.side === 'BUY' ? '매수' : '매도'}
              </span>
              <div className='min-w-0 flex-1'>
                <p className='truncate text-[13px] font-bold text-[color:var(--jaroo-ink)]'>
                  {execution.instrumentName}
                  <span className='ml-1 font-medium text-[color:var(--jaroo-muted)]'>
                    {execution.qty}주 · {won(execution.price)}
                  </span>
                </p>
                <p className='truncate text-[10.5px] tabular-nums text-[color:var(--jaroo-muted)]'>
                  {dayText(execution.at)} {timeText(execution.at)} · 수수료 {execution.fee.toLocaleString('ko-KR')}원 ·{' '}
                  <code title={execution.orderId}>{execution.orderId}</code>
                </p>
              </div>
              <span
                className={cn(
                  'shrink-0 text-[13px] font-extrabold tabular-nums',
                  execution.side === 'BUY' ? 'text-[color:var(--jaroo-loss)]' : 'text-[color:var(--jaroo-profit)]',
                )}
              >
                {execution.side === 'BUY' ? '-' : '+'}
                {execution.amount.toLocaleString('ko-KR')}원
              </span>
            </div>
          ))}
        </TabsContent>

        <TabsContent value='holdings' className='space-y-2'>
          {character.positions.map((position) => {
            const pnl = position.currentPrice - position.avgPrice
            const pnlPct = (pnl / position.avgPrice) * 100
            return (
              <div
                key={position.instrumentCode}
                className='flex items-center gap-3 rounded-xl border border-[color:var(--jaroo-border)] bg-white px-3 py-2.5'
              >
                <div className='min-w-0 flex-1'>
                  <p className='truncate text-[13px] font-bold text-[color:var(--jaroo-ink)]'>{position.instrumentName}</p>
                  <p className='text-[10.5px] tabular-nums text-[color:var(--jaroo-muted)]'>
                    {position.qty}주 · 평단 {won(position.avgPrice)} → 현재 {won(position.currentPrice)}
                  </p>
                </div>
                <div className='shrink-0 text-right'>
                  <p className={cn('text-[13px] font-extrabold tabular-nums', pnlClass(pnlPct))}>
                    {signedPct(pnlPct)}
                  </p>
                  <p className={cn('text-[10.5px] font-semibold tabular-nums', pnlClass(pnlPct))}>
                    {pnl >= 0 ? '+' : ''}
                    {(pnl * position.qty).toLocaleString('ko-KR')}원
                  </p>
                </div>
              </div>
            )
          })}
        </TabsContent>
      </Tabs>
    </section>
  )
}

// ---------------------------------------------------------------------------
// 페이지
// ---------------------------------------------------------------------------

export default function AiTraderDraft1Page() {
  const [selectedId, setSelectedId] = useState(AI_TRADER_CHARACTERS[0]!.id)
  const character = useMemo(
    () => AI_TRADER_CHARACTERS.find((candidate) => candidate.id === selectedId) ?? AI_TRADER_CHARACTERS[0]!,
    [selectedId],
  )

  return (
    <JarooShell
      title='AI 트레이더 쇼케이스'
      subtitle='같은 deepscan 리포트, 다른 결정 · 초안①'
      backHref='/deepscan'
      showBottomNav={false}
    >
      {/* ① 캐릭터 선택 캐러셀 */}
      <CharacterCarousel characters={AI_TRADER_CHARACTERS} selectedId={selectedId} onSelect={setSelectedId} />

      {/* 캐릭터 전환 시 아래 전체가 교체된다 */}
      <div key={character.id} className='animate-in fade-in slide-in-from-bottom-2 space-y-4 duration-300'>
        {/* ② 페르소나 카드 */}
        <PersonaCard character={character} />

        {/* ③ 계좌 요약 */}
        <AccountSummary character={character} />

        {/* ④ 판단 카드 목록 */}
        <JudgmentList character={character} />

        {/* ⑤ 체결 내역 / 보유 종목 */}
        <LedgerSection character={character} />

        <p className='px-1 text-center text-[10.5px] leading-relaxed text-[color:var(--jaroo-muted)]'>
          이 화면의 리포트·원장은 쇼케이스용 목업입니다.
          <br />
          실제 매매 기록이 아닌, deepscan 리포트 기반 시연 데이터예요.
        </p>
      </div>
    </JarooShell>
  )
}
