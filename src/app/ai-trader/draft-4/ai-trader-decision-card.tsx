// 초안④ 캐릭터 결정 카드 + "같은 리포트, 각자 다른 포트폴리오" 계좌 비교표.
import { CircleAlert, Receipt, ScrollText } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  AI_TRADER_CHARACTERS,
  EXPERIMENT_SEED_KRW,
  formatKst,
  signedPct,
  signedWon,
  won,
  type AiTraderCharacter,
  type CharacterDecision,
  type DecisionKind,
} from './mock-data'

/** 결정 배지 톤 — 매수=상승(빨강) · 매도=하락(파랑) · 홀딩=보합(녹색) · 관망=중립(회색). 데이터 색 토큰만 사용. */
const DECISION_STYLES: Record<DecisionKind, { label: string; cls: string }> = {
  buy: { label: '매수', cls: 'bg-[color:var(--jaroo-profit-soft)] text-[color:var(--jaroo-profit)]' },
  sell: { label: '매도', cls: 'bg-[color:var(--jaroo-loss-soft)] text-[color:var(--jaroo-loss)]' },
  hold: { label: '홀딩', cls: 'bg-[color:var(--jaroo-neutral-soft)] text-[color:var(--jaroo-flat)]' },
  wait: { label: '관망', cls: 'bg-[color:var(--jaroo-secondary)] text-[color:var(--jaroo-muted)]' },
}

export function CharacterAvatar({ character, size = 'md' }: { character: AiTraderCharacter; size?: 'sm' | 'md' }) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full',
        character.avatarClass,
        size === 'sm' ? 'size-7 text-[13px]' : 'size-9 text-[17px]',
      )}
      aria-hidden='true'
    >
      {character.emoji}
    </span>
  )
}

function ProfitText({ amount, ratePct, className }: { amount: number; ratePct: number; className?: string }) {
  const tone = amount > 0 ? 'text-[color:var(--jaroo-profit)]' : amount < 0 ? 'text-[color:var(--jaroo-loss)]' : 'text-[color:var(--jaroo-muted)]'
  return (
    <span className={cn('inline-flex items-baseline gap-1 tabular-nums', tone, className)}>
      <span className='font-bold'>{signedWon(amount)}</span>
      <span className='text-[11px] font-semibold'>({signedPct(ratePct)})</span>
    </span>
  )
}

export function DecisionCard({ decision }: { decision: CharacterDecision }) {
  const character = AI_TRADER_CHARACTERS.find((c) => c.id === decision.characterId)
  if (!character) return null
  const decisionStyle = DECISION_STYLES[decision.decision]
  const profitLabel = decision.decision === 'sell'
    ? '확정손익'
    : decision.decision === 'wait'
      ? '보유 없음'
      : decision.account.purchaseTotal > 0
        ? '평가손익'
        : '보유 없음'
  const log = decision.judgmentLog

  return (
    <article className='overflow-hidden rounded-2xl border border-[color:var(--jaroo-border)] bg-white shadow-sm'>
      {/* 헤더: 아바타 · 이름 · 페르소나 | 결정 배지 */}
      <div className='flex items-center gap-2.5 px-4 pt-4'>
        <CharacterAvatar character={character} />
        <div className='min-w-0 flex-1'>
          <div className='flex items-center gap-1.5'>
            <span className='text-[13.5px] font-bold text-[color:var(--jaroo-ink)]'>{character.name}</span>
            <span className='truncate text-[10px] text-[color:var(--jaroo-muted)]'>{character.personaLabel.split(' · ')[0]}</span>
          </div>
          <div className='mt-0.5 truncate text-[10.5px] text-[color:var(--jaroo-muted)]'>{character.philosophy}</div>
        </div>
        <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold', decisionStyle.cls)}>
          {decisionStyle.label}
          <span className='font-semibold opacity-80'>· {decision.decisionLabel}</span>
        </span>
      </div>

      <div className='space-y-3 px-4 pb-4 pt-3'>
        {/* 캐릭터 말투 서사 */}
        <blockquote className='rounded-xl bg-[color:var(--jaroo-canvas)] p-2.5 text-[12.5px] leading-[1.55] text-[color:var(--jaroo-ink)]'>
          “{decision.quote}”
        </blockquote>

        {/* 같은 근거, 다른 해석 */}
        <div className='rounded-xl border border-[color:var(--jaroo-border)] p-2.5'>
          <div className='flex flex-wrap items-center gap-1'>
            <span className='text-[10px] font-bold text-[color:var(--jaroo-primary)]'>같은 근거</span>
            <span className='rounded-full bg-[color:var(--jaroo-secondary)] px-1.5 py-0.5 text-[10px] tabular-nums text-[color:var(--jaroo-muted)]'>hero {log.heroScore}점</span>
            <span className='rounded-full bg-[color:var(--jaroo-secondary)] px-1.5 py-0.5 text-[10px] tabular-nums text-[color:var(--jaroo-muted)]'>6m 회복 {log.recoveryPct}%</span>
            <span className='rounded-full bg-[color:var(--jaroo-secondary)] px-1.5 py-0.5 text-[10px] tabular-nums text-[color:var(--jaroo-muted)]'>목표가 {won(log.targetPrice)}</span>
          </div>
          <p className='mt-1.5 text-[11.5px] leading-[1.5] text-[color:var(--jaroo-muted)]'>{decision.sharedFactSpin}</p>
        </div>

        {/* 체결 내역 */}
        {decision.fills.length > 0 ? (
          <div>
            <div className='flex items-center gap-1.5 text-[12px] font-bold text-[color:var(--jaroo-ink)]'>
              <Receipt className='size-3.5 text-[color:var(--jaroo-muted)]' aria-hidden='true' />
              체결 내역
            </div>
            <div className='mt-1.5 space-y-1.5'>
              {decision.fills.map((fill) => (
                <div key={fill.orderId} className='rounded-xl border border-[color:var(--jaroo-border)] px-2.5 py-2'>
                  <div className='flex items-center gap-1.5'>
                    <span
                      className={cn(
                        'rounded px-1.5 py-0.5 text-[9.5px] font-black',
                        fill.side === 'BUY' ? 'bg-[color:var(--jaroo-profit-soft)] text-[color:var(--jaroo-profit)]' : 'bg-[color:var(--jaroo-loss-soft)] text-[color:var(--jaroo-loss)]',
                      )}
                    >
                      {fill.side}
                    </span>
                    <span className='text-[12px] font-bold text-[color:var(--jaroo-ink)]'>{fill.name}</span>
                    <span className='text-[11px] tabular-nums text-[color:var(--jaroo-muted)]'>{fill.qty}주 × {fill.price.toLocaleString('ko-KR')}원</span>
                    <span className='ml-auto text-[12px] font-bold tabular-nums text-[color:var(--jaroo-ink)]'>{won(fill.amount)}</span>
                  </div>
                  <div className='mt-1 flex items-center justify-between gap-2 text-[9.5px] text-[color:var(--jaroo-muted)]'>
                    <span className='truncate'>수수료 {won(fill.fee)}</span>
                    <span className='truncate'>{fill.kstAt}</span>
                  </div>
                  <div className='mt-0.5 text-[9.5px] text-[color:var(--jaroo-muted)]'>
                    <span className='tracking-tight'>{fill.orderId}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className='flex items-center gap-1.5 rounded-xl bg-[color:var(--jaroo-secondary)] px-2.5 py-2 text-[11px] text-[color:var(--jaroo-muted)]'>
            <CircleAlert className='size-3.5 shrink-0' aria-hidden='true' />
            이번 리포트로는 체결 없음 — {decisionStyle.label} 결정
          </div>
        )}

        {/* 현재 손익 */}
        <div className='flex items-center justify-between gap-2 rounded-xl bg-[color:var(--jaroo-secondary)] px-2.5 py-2'>
          <span className='text-[11px] text-[color:var(--jaroo-muted)]'>현재 손익 · {profitLabel}</span>
          <ProfitText amount={decision.account.profitAmount} ratePct={decision.account.profitRatePct} />
        </div>

        {/* 판단 로그 — debugId가 리포트와 동일 = 같은 리포트를 봤다는 증거 */}
        <div className='flex items-start gap-1.5 rounded-xl bg-[color:var(--jaroo-secondary)] px-2.5 py-2 text-[10px] leading-4 text-[color:var(--jaroo-muted)]'>
          <ScrollText className='mt-0.5 size-3 shrink-0' aria-hidden='true' />
          <span className='min-w-0 flex-1'>
            <span className='font-bold text-[color:var(--jaroo-ink)]'>판단 로그</span>
            <span className='mx-1'>·</span>
            리포트 동일 확인 {log.debugId}
            <br />
            판단 {formatKst(log.generatedAt)} · hero {log.heroScore}점 · 6m {log.recoveryPct}% · TP {won(log.targetPrice)}
            <br />
            <span className='tracking-tight'>{decision.reasonCode}</span>
          </span>
        </div>
      </div>
    </article>
  )
}

/** 하단 미니 비교표 — 동일 시드 300만 원에서 출발한 4개 계좌 스냅샷 */
export function AccountCompareTable({ decisions, instrumentName }: { decisions: CharacterDecision[]; instrumentName: string }) {
  return (
    <section className='rounded-2xl border border-[color:var(--jaroo-border)] bg-white p-4 shadow-sm' aria-label='캐릭터별 계좌 비교'>
      <div className='text-[13px] font-bold text-[color:var(--jaroo-ink)]'>
        같은 리포트, 각자 다른 포트폴리오
        <span className='ml-1 text-[10px] font-medium text-[color:var(--jaroo-muted)]'>
          · {instrumentName} 결정 실행 후
        </span>
      </div>
      <div className='mt-0.5 text-[10px] text-[color:var(--jaroo-muted)]'>
        동일 시드 {won(EXPERIMENT_SEED_KRW)}로 시작 · 좌: 현금 비중 · 우: 수익률
      </div>
      <div className='mt-3 space-y-2.5'>
        {decisions.map((decision) => {
          const character = AI_TRADER_CHARACTERS.find((c) => c.id === decision.characterId)
          if (!character) return null
          const cashRatio = Math.round((decision.account.cash / EXPERIMENT_SEED_KRW) * 1000) / 10
          return (
            <div key={decision.characterId} className='grid grid-cols-[auto_1fr_auto] items-center gap-2.5'>
              <div className='flex w-[76px] items-center gap-1.5'>
                <CharacterAvatar character={character} size='sm' />
                <span className='min-w-0 truncate text-[11px] font-bold text-[color:var(--jaroo-ink)]'>{character.name}</span>
              </div>
              <div className='min-w-0'>
                <div className='h-2 overflow-hidden rounded-full bg-[color:var(--jaroo-neutral-soft)]'>
                  <div
                    className='h-full rounded-full bg-[color:var(--jaroo-primary)] transition-[width] duration-500'
                    style={{ width: `${Math.min(100, Math.max(0, cashRatio))}%` }}
                  />
                </div>
                <div className='mt-1 flex items-center justify-between text-[9.5px] text-[color:var(--jaroo-muted)]'>
                  <span>현금 {cashRatio.toFixed(1)}%</span>
                  <span className='tabular-nums'>평가 {won(decision.account.evaluation)}</span>
                </div>
              </div>
              <ProfitText
                amount={decision.account.profitAmount}
                ratePct={decision.account.profitRatePct}
                className='w-[108px] shrink-0 flex-col !items-end leading-tight'
              />
            </div>
          )
        })}
      </div>
    </section>
  )
}
