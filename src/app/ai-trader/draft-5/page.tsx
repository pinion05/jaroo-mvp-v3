'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  BookOpen,
  ChevronDown,
  ExternalLink,
  EyeOff,
  FileText,
  Newspaper,
  Pause,
  Receipt,
  RotateCw,
  Share2,
  Sparkles,
  Target,
  TrendingUp,
} from 'lucide-react'

import { JarooShell } from '@/components/jaroo-shell'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import {
  DRAFT5_CHARACTERS,
  DRAFT5_NEWS,
  DRAFT5_REPORTS,
  DRAFT5_WEEK_RANGE_LABEL,
  fmtKrw,
  fmtManwon,
  fmtSigned,
  gatePassed,
  newsUrl,
  scoreToneClass,
  sideLabelClass,
  type Draft5Character,
  type Draft5DiaryEntry,
  type Draft5Execution,
  type Draft5NewsItem,
} from './draft5-data'

import {
  buildLiveDiary,
  DRAFT5_LIVE_CHARACTER_NAMES,
  fetchDraft5Live,
  fetchDraft5LiveStatus,
  findLiveCharacter,
  findReportForGate,
  formatLiveStamp,
  liveDateParts,
  liveGateCounts,
  liveStanceOf,
  type Draft5LiveCharacterData,
  type Draft5LiveDeepscan,
  type Draft5LiveDiscovery,
  type Draft5LiveMatrixRow,
  type Draft5LivePayload,
  type Draft5LivePipelineStatus,
} from './draft5-live'

/**
 * 초안⑤ — 캐릭터 투자 일기·셰어러블형 (v1 파이프라인 확정판, #369 + 실시간 발굴 데모)
 *
 * 두 모드가 있다:
 * - 실시간 발굴 모드: ②실증(jaroo_characters.js)이 실뉴스에서 뽑은 4캐릭터 긍정/부정
 *   종목(/ai-trader/draft5-live.json)을 배선한다. 발굴 칩 → 템플릿 일기 → 게이트 칩은
 *   "deepscan 연동 대기 (Phase 2)"로 honestly 표시. 매트릭스 미니에서 만장일치 하이라이트.
 * - 목업 모드: 파일이 없거나 사용자가 고르면 기존 한 주 일기 피드(폴백·데모 대비).
 *
 * mock 데이터는 실제 컨트랙트 타입(JarooDeepScanPayload)을 그대로 채운다 — 외부 호출 없음.
 */

export default function AiTraderDraft5Page() {
  const [selectedKey, setSelectedKey] = useState(DRAFT5_CHARACTERS[0].key)
  const character =
    DRAFT5_CHARACTERS.find((candidate) => candidate.key === selectedKey) ?? DRAFT5_CHARACTERS[0]

  // 실시간 발굴 데이터 로드 — 파일이 없으면 목업 모드로 폴백(오케스트레이터 배치 대기 재시도 포함)
  const [live, setLive] = useState<Draft5LivePayload | null>(null)
  const [liveStatus, setLiveStatus] = useState<'loading' | 'ready' | 'fallback'>('loading')
  const [modePref, setModePref] = useState<'live' | 'mock'>('live')
  const [loadAttempt, setLoadAttempt] = useState(0)
  // 갱신하기 — 전체 파이프라인(발굴→딥스캔→일기)을 서버에서 재실행하고 진행률을 폴링
  const [refreshing, setRefreshing] = useState(false)
  const [refreshNote, setRefreshNote] = useState<string | null>(null)
  const [pipeline, setPipeline] = useState<Draft5LivePipelineStatus | null>(null)
  const refreshNoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollInterval = useRef<ReturnType<typeof setInterval> | null>(null)

  const showNote = (note: string) => {
    setRefreshNote(note)
    if (refreshNoteTimer.current) clearTimeout(refreshNoteTimer.current)
    refreshNoteTimer.current = setTimeout(() => setRefreshNote(null), 4000)
  }

  const stopPolling = () => {
    if (pollInterval.current) {
      clearInterval(pollInterval.current)
      pollInterval.current = null
    }
  }

  const startPolling = () => {
    if (pollInterval.current) return
    pollInterval.current = setInterval(() => void pollTick(), 3000)
  }

  const pollTick = async () => {
    const status = await fetchDraft5LiveStatus()
    if (!status) return
    setPipeline(status)
    if (!status.running) {
      stopPolling()
      if (status.lastError) {
        showNote('갱신 실패')
        return
      }
      const fresh = await fetchDraft5Live()
      if (fresh) {
        setLive(fresh)
        setLiveStatus('ready')
        showNote('갱신됨')
      } else {
        showNote('불러오기 실패')
      }
    }
  }

  useEffect(() => {
    // 마운트 시 이미 실행 중인 파이프라인이 있으면 진행 폴링에 합류
    void fetchDraft5LiveStatus().then((status) => {
      if (status?.running) {
        setPipeline(status)
        startPolling()
      }
    })
    return () => {
      stopPolling()
      if (refreshNoteTimer.current) clearTimeout(refreshNoteTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleRefresh = async () => {
    if (pipeline?.running || refreshing) return
    setRefreshing(true)
    setRefreshNote(null)
    try {
      const res = await fetch('/api/ai-trader/refresh', {
        method: 'POST',
        signal: AbortSignal.timeout(10000),
      })
      if (res.ok || res.status === 409) {
        // 시작됨(또는 이미 실행 중) — 상태 파일 폴링으로 전환
        setPipeline({ running: true, stepLabel: '파이프라인 시작 중…' })
        startPolling()
        void pollTick()
      } else {
        showNote('시작 실패')
      }
    } catch {
      showNote('시작 실패')
    }
    setRefreshing(false)
  }
  const effectiveMode = liveStatus === 'ready' && modePref === 'live' ? 'live' : 'mock'
  const liveCharacterData = live ? findLiveCharacter(live, selectedKey) : null
  // 캐릭터 이름 → 실시간 긍정 발굴 수 (선택자 푸터용 — 라이브 모드에서 목업 수익률 대신 노출)
  const livePositiveByName = new Map(
    (live?.characters ?? []).map((data) => [data.name, data.positive.length]),
  )

  useEffect(() => {
    let cancelled = false
    fetchDraft5Live().then((data) => {
      if (cancelled) return
      setLive(data)
      setLiveStatus(data ? 'ready' : 'fallback')
    })
    return () => {
      cancelled = true
    }
  }, [loadAttempt])

  // 폴백 상태면 10초 뒤 재시도(최대 2회) — 데모 중 파일이 늦게 놓여도 자동 승격
  useEffect(() => {
    if (liveStatus !== 'fallback' || loadAttempt >= 2) return
    const timer = setTimeout(() => setLoadAttempt((attempt) => attempt + 1), 10000)
    return () => clearTimeout(timer)
  }, [liveStatus, loadAttempt])

  // 캐릭터 전환·모드 전환 시 피드 최상단부터 다시 보게 스크롤 리셋
  useEffect(() => {
    document
      .querySelector('[data-slot="jaroo-shell-main"]')
      ?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [selectedKey, effectiveMode])

  return (
    <JarooShell
      title='AI 트레이더 투자일기'
      subtitle={effectiveMode === 'live' ? '실시간 발굴 데모 · 오늘의 뉴스' : `뉴스 발굴 → 리포트 문턱 판정 · ${DRAFT5_WEEK_RANGE_LABEL}`}
      backHref='/home'
      action={<Badge variant='secondary'>초안 ⑤</Badge>}
      bottomNav={<Draft5CtaBar />}
    >
      {/* 모드 배너 — 실시간/목업 상태 칩 + 수동 갱신 + 전환 토글 */}
      <ModeBanner
        liveStatus={liveStatus}
        modePref={modePref}
        live={live}
        onModePrefChange={setModePref}
        onRefresh={handleRefresh}
        refreshing={refreshing}
        refreshNote={refreshNote}
        pipeline={pipeline}
      />

      {/* 컨셉 한 줄 — v1 파이프라인(#369) */}
      <div className='flex items-start gap-2 rounded-xl border border-[color:var(--jaroo-border)] bg-white px-3 py-2.5'>
        <Sparkles className='mt-0.5 size-3.5 shrink-0 text-[color:var(--jaroo-primary)]' aria-hidden='true' />
        <p className='text-xs leading-relaxed text-[color:var(--jaroo-muted)]'>
          AI 트레이더 4인은 네이버 메인뉴스를 <span className='font-semibold text-[color:var(--jaroo-ink)]'>성향대로 읽어 종목을 발굴</span>하고,
          deepscan 리포트가 <span className='font-semibold text-[color:var(--jaroo-ink)]'>성향 문턱을 통과해야 매수</span>합니다.
          통과 못 하면 관망 — 같은 뉴스, 다른 결정.
        </p>
      </div>

      {/* 1. 캐릭터 선택 가로 스크롤 */}
      <CharacterSelector
        characters={DRAFT5_CHARACTERS}
        selectedKey={selectedKey}
        onSelect={setSelectedKey}
        footer={(candidate) =>
          effectiveMode === 'live'
            ? livePositiveByName.has(candidate.name)
              ? `긍정 ${livePositiveByName.get(candidate.name)}`
              : '—'
            : fmtSigned(candidate.weekly.returnPct, 1)
        }
      />

      {effectiveMode === 'live' && live ? (
        <>
          {/* 실시간: 오늘의 발굴 (positive + gate 판정 + negative 접이식) */}
          <LiveDiscoverySection live={live} characterKey={selectedKey} characterName={character.name} />
          {/* 실시간: 발굴 기반 템플릿 일기 1편 — 실제 deepscan 점수 반영 */}
          <LiveDiaryCard character={character} data={liveCharacterData} live={live} />
          {/* 실시간: 캐릭터×종목 스탠스 매트릭스 미니 + 판정 집계 */}
          <MatrixMini live={live} />
        </>
      ) : (
        <>
          {/* 목업: 2. 일기 스레드 */}
          <section aria-label={`${character.name}의 투자 일기`}>
            <div className='flex items-center gap-2 pb-1'>
              <BookOpen className='size-3.5 text-[color:var(--jaroo-primary)]' aria-hidden='true' />
              <h2 className='text-xs font-semibold text-[color:var(--jaroo-ink)]'>
                {character.name}의 한 주 · 일기 {character.entries.length}편
              </h2>
            </div>
            <div className='space-y-5 pt-2'>
              {character.entries.map((entry) => (
                <DiaryEntryBlock key={entry.id} entry={entry} />
              ))}
            </div>
          </section>

          {/* 목업: 3. 주간 성과 카드 (OG 느낌) */}
          <WeeklyPerformanceCard character={character} />
        </>
      )}

      <p className='pb-2 text-center text-[10px] leading-relaxed text-[color:var(--jaroo-muted)]'>
        {effectiveMode === 'live'
          ? '발굴(네이버 메인뉴스)·딥스캔 판정·AI 서사 일기까지 실데이터예요. 실제 체결(영수증·계좌 장부)은 paper-trade 연동 후 공개됩니다.'
          : '본 화면은 홍보용 데모입니다. 일기·영수증·계좌 수치는 모두 목업 데이터예요.'}
      </p>
    </JarooShell>
  )
}

// ---------------------------------------------------------------- 모드 배너

function ModeBanner({
  liveStatus,
  modePref,
  live,
  onModePrefChange,
  onRefresh,
  refreshing,
  refreshNote,
  pipeline,
}: {
  liveStatus: 'loading' | 'ready' | 'fallback'
  modePref: 'live' | 'mock'
  live: Draft5LivePayload | null
  onModePrefChange: (mode: 'live' | 'mock') => void
  onRefresh: () => void
  refreshing: boolean
  refreshNote: string | null
  pipeline: Draft5LivePipelineStatus | null
}) {
  const liveReady = liveStatus === 'ready'
  return (
    <div className='flex items-center gap-2 rounded-xl border border-[color:var(--jaroo-border)] bg-white px-3 py-2'>
      <span className='flex min-w-0 flex-1 flex-col gap-0.5'>
        <span className='flex items-center gap-1.5'>
          <span
            className={cn(
              'size-1.5 shrink-0 rounded-full',
              liveReady ? 'bg-[color:var(--jaroo-profit)]' : 'bg-[color:var(--jaroo-muted)]',
            )}
            aria-hidden='true'
          />
          <span className='truncate text-[10px] font-semibold tabular-nums text-[color:var(--jaroo-ink)]'>
            {liveStatus === 'ready' && live
              ? `실시간 발굴 · ${formatLiveStamp(live.generatedAt)} · 네이버 메인뉴스 ${live.articleCount}건`
              : liveStatus === 'loading'
                ? '실시간 발굴 확인 중…'
                : '목업 모드 · 실시간 파일 대기 중'}
          </span>
        </span>
        {(live?.deepscans?.length ?? 0) > 0 ? (
          <span className='pl-3 text-[9px] font-semibold tabular-nums text-[color:var(--jaroo-muted)]'>
            딥스캔 {live?.deepscans?.length}종목 판정 완료
            {live?.deepscanFetchedAt ? ` · ${formatLiveStamp(live.deepscanFetchedAt)}` : ''}
          </span>
        ) : null}
      </span>
      {/* 갱신하기 — 전체 파이프라인(발굴→딥스캔→일기) 재실행. 실행 중엔 단계 라벨이 뜬다 */}
      {pipeline?.running ? (
        <span className='flex shrink-0 items-center gap-1 text-[9px] font-semibold text-[color:var(--jaroo-primary)]'>
          <RotateCw className='size-2.5 animate-spin' aria-hidden='true' />
          {pipeline.stepLabel ?? '갱신 중…'}
        </span>
      ) : refreshNote ? (
        <span
          className={cn(
            'shrink-0 text-[9px] font-semibold',
            refreshNote === '불러오기 실패' || refreshNote === '갱신 실패' || refreshNote === '시작 실패'
              ? 'text-[color:var(--jaroo-loss)]'
              : 'text-[color:var(--jaroo-primary)]',
          )}
        >
          {refreshNote}
        </span>
      ) : null}
      <button
        type='button'
        onClick={onRefresh}
        disabled={refreshing || pipeline?.running || liveStatus === 'loading'}
        aria-label='실시간 발굴 데이터 갱신'
        title='전체 파이프라인 재실행 — 발굴 → 딥스캔 판정 → AI 일기 (수 분 소요)'
        className='flex size-7 shrink-0 items-center justify-center rounded-full border border-[color:var(--jaroo-border)] bg-white text-[color:var(--jaroo-muted)] transition hover:border-[color:var(--jaroo-primary)]/40 hover:text-[color:var(--jaroo-primary)] disabled:cursor-not-allowed disabled:opacity-50'
      >
        <RotateCw
          className={cn('size-3.5', (refreshing || pipeline?.running) && 'animate-spin')}
          aria-hidden='true'
        />
      </button>
      <div className='flex shrink-0 rounded-full bg-[color:var(--jaroo-secondary)] p-0.5' role='group' aria-label='모드 전환'>
        <button
          type='button'
          onClick={() => onModePrefChange('live')}
          disabled={!liveReady}
          title={liveReady ? undefined : 'draft5-live.json 대기 중'}
          className={cn(
            'rounded-full px-2 py-1 text-[10px] font-semibold transition',
            modePref === 'live' && liveReady
              ? 'bg-white text-[color:var(--jaroo-ink)] shadow-sm'
              : 'text-[color:var(--jaroo-muted)]',
            !liveReady && 'cursor-not-allowed opacity-50',
          )}
        >
          실시간
        </button>
        <button
          type='button'
          onClick={() => onModePrefChange('mock')}
          className={cn(
            'rounded-full px-2 py-1 text-[10px] font-semibold transition',
            !liveReady || modePref === 'mock'
              ? 'bg-white text-[color:var(--jaroo-ink)] shadow-sm'
              : 'text-[color:var(--jaroo-muted)]',
          )}
        >
          목업
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- 1. 캐릭터 선택

function CharacterSelector({
  characters,
  selectedKey,
  onSelect,
  footer,
}: {
  characters: Draft5Character[]
  selectedKey: string
  onSelect: (key: string) => void
  /** 카드 하단 지표 — 목업 모드: 주간 수익률 / 실시간 모드: 긍정 발굴 수 */
  footer?: (character: Draft5Character) => string
}) {
  return (
    <div
      className='-mx-4 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
      role='tablist'
      aria-label='AI 트레이더 캐릭터 선택'
    >
      <div className='flex min-w-max gap-2 pb-1'>
        {characters.map((character) => {
          const selected = character.key === selectedKey
          return (
            <button
              key={character.key}
              type='button'
              role='tab'
              aria-selected={selected}
              onClick={() => onSelect(character.key)}
              className={cn(
                'flex w-[84px] shrink-0 flex-col items-center gap-1.5 rounded-2xl border px-2 py-3 transition',
                selected
                  ? 'border-[color:var(--jaroo-primary)] bg-[color:var(--jaroo-accent)]'
                  : 'border-[color:var(--jaroo-border)] bg-white',
              )}
            >
              <span
                className={cn(
                  'flex size-11 items-center justify-center rounded-full text-xl',
                  character.avatarBg,
                  selected && 'ring-2 ring-[color:var(--jaroo-primary)] ring-offset-2 ring-offset-white',
                )}
                aria-hidden='true'
              >
                {character.emoji}
              </span>
              <span className='text-xs font-semibold text-[color:var(--jaroo-ink)]'>{character.name}</span>
              <span className='text-[11px] font-semibold tabular-nums text-[color:var(--jaroo-profit)]'>
                {footer ? footer(character) : fmtSigned(character.weekly.returnPct, 1)}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- 실시간: 오늘의 발굴 섹션

function LiveDiscoverySection({
  live,
  characterKey,
  characterName,
}: {
  live: Draft5LivePayload
  characterKey: string
  characterName: string
}) {
  const data = findLiveCharacter(live, characterKey)
  return (
    <section aria-label='오늘의 발굴' className='rounded-2xl border border-[color:var(--jaroo-border)] bg-white p-4 shadow-sm'>
      <div className='flex items-center gap-2 pb-1'>
        <Newspaper className='size-3.5 text-[color:var(--jaroo-primary)]' aria-hidden='true' />
        <h2 className='text-xs font-semibold text-[color:var(--jaroo-ink)]'>오늘의 발굴 · {characterName}</h2>
        {data ? (
          <span className='ml-auto rounded-full bg-[color:var(--jaroo-profit-soft)] px-2 py-0.5 text-[10px] font-semibold tabular-nums text-[color:var(--jaroo-profit)]'>
            긍정 {data.positive.length} · 부정 {data.negative.length}
          </span>
        ) : null}
      </div>

      {!data ? (
        <p className='pt-2 text-[11px] text-[color:var(--jaroo-muted)]'>
          이 캐릭터의 실시간 발굴 데이터가 아직 없어요.
        </p>
      ) : (
        <>
          <ul className='divide-y divide-[color:var(--jaroo-border)] pt-1'>
            {data.positive.map((discovery) => (
              <LiveDiscoveryRow
                key={discovery.stock}
                discovery={discovery}
                tone='positive'
                report={findReportForGate(live, discovery.stock, discovery.gate?.debugId ?? null)}
              />
            ))}
            {data.positive.length === 0 ? (
              <li className='py-2 text-[11px] text-[color:var(--jaroo-muted)]'>
                오늘은 긍정 발굴이 없었어요.
              </li>
            ) : null}
          </ul>

          {data.negative.length > 0 ? (
            <details className='group mt-2 border-t border-dashed border-[color:var(--jaroo-border)] pt-2'>
              <summary className='flex cursor-pointer list-none items-center gap-1 text-[10px] font-semibold text-[color:var(--jaroo-muted)] [&::-webkit-details-marker]:hidden'>
                <EyeOff className='size-3' aria-hidden='true' />
                오늘 피한 종목 {data.negative.length}
                <ChevronDown className='ml-auto size-3 transition-transform group-open:rotate-180' aria-hidden='true' />
              </summary>
              <ul className='mt-1.5 space-y-2.5'>
                {data.negative.map((discovery) => (
                  <LiveDiscoveryRow key={discovery.stock} discovery={discovery} tone='negative' compact />
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
    </section>
  )
}

function LiveDiscoveryRow({
  discovery,
  tone,
  report,
  compact,
}: {
  discovery: Draft5LiveDiscovery
  tone: 'positive' | 'negative'
  report?: Draft5LiveDeepscan | null
  compact?: boolean
}) {
  const gate = discovery.gate
  return (
    <li className={compact ? '' : 'py-2.5 first:pt-2 last:pb-0'}>
      <div className='flex items-center gap-1.5'>
        <span className={cn('shrink-0 text-[13px] font-bold', compact ? 'text-[color:var(--jaroo-muted)]' : 'text-[color:var(--jaroo-ink)]')}>
          {discovery.stock}
        </span>
        <span
          className={cn(
            'shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold',
            tone === 'positive'
              ? 'bg-[color:var(--jaroo-profit-soft)] text-[color:var(--jaroo-profit)]'
              : 'bg-[color:var(--jaroo-loss-soft)] text-[color:var(--jaroo-loss)]',
          )}
        >
          {tone === 'positive' ? '긍정' : '부정'}
        </span>
        <span className='ml-auto flex shrink-0 gap-1'>
          {discovery.urls.slice(0, 2).map((url, index) => (
            <a
              key={url}
              href={url}
              target='_blank'
              rel='noopener noreferrer'
              className='flex items-center gap-0.5 rounded-full border border-[color:var(--jaroo-border)] bg-white px-1.5 py-0.5 text-[9px] text-[color:var(--jaroo-muted)] transition hover:text-[color:var(--jaroo-primary)]'
              aria-label={`${discovery.stock} 근거기사 열기`}
            >
              {discovery.articles[index] !== undefined ? `기사 #${discovery.articles[index]}` : '근거기사'}
              <ExternalLink className='size-2.5' aria-hidden='true' />
            </a>
          ))}
        </span>
      </div>
      <p className='mt-1 line-clamp-2 text-[11px] leading-relaxed text-[color:var(--jaroo-muted)]'>
        {discovery.reason}
      </p>

      {/* 게이트 판정 칩 — 실제 /api/deepscan 판정(축소판 실데모) */}
      {tone === 'positive' && gate && gate.status !== 'pending' && gate.score !== null ? (
        <div className='mt-1.5 flex flex-wrap items-center gap-1'>
          {gate.status === 'pass' ? (
            <>
              <span className='rounded-full bg-[color:var(--jaroo-profit-soft)] px-2 py-0.5 text-[10px] font-bold tabular-nums text-[color:var(--jaroo-profit)]'>
                딥스캔 {gate.score} · 문턱 {gate.threshold} 통과
              </span>
              {gate.sizing ? (
                <span className='rounded-md border border-dashed border-[color:var(--jaroo-primary)]/50 bg-white px-1.5 py-0.5 text-[9px] font-bold text-[color:var(--jaroo-primary)]'>
                  sizing · {gate.sizing}
                </span>
              ) : null}
            </>
          ) : (
            <span className='rounded-full bg-[color:var(--jaroo-loss-soft)] px-2 py-0.5 text-[10px] font-bold tabular-nums text-[color:var(--jaroo-loss)]'>
              딥스캔 {gate.score} &lt; 문턱 {gate.threshold} 미달
            </span>
          )}
        </div>
      ) : null}

      {/* 리포트 상세 — 사용자와 동일한 deepscan 리포트임이 드러나게 */}
      {tone === 'positive' && report ? (
        <details className='group mt-1.5'>
          <summary className='flex cursor-pointer list-none items-center gap-1 text-[9px] font-semibold text-[color:var(--jaroo-muted)] [&::-webkit-details-marker]:hidden'>
            <FileText className='size-2.5' aria-hidden='true' />
            deepscan 리포트 보기
            <ChevronDown className='size-2.5 transition-transform group-open:rotate-180' aria-hidden='true' />
          </summary>
          <div className='mt-1.5 space-y-1.5 rounded-lg border border-[color:var(--jaroo-border)] bg-[color:var(--jaroo-secondary)] px-2.5 py-2'>
            <div className='flex items-center gap-1.5 text-[10px]'>
              <span className='rounded border border-[color:var(--jaroo-border)] bg-white px-1.5 py-0.5 font-bold text-[color:var(--jaroo-ink)]'>
                {report.weekSignal}
              </span>
              <span className='tabular-nums text-[color:var(--jaroo-muted)]'>목표가 {report.targetPriceText}</span>
              {report.fetchedAtSec != null ? (
                <span className='ml-auto shrink-0 tabular-nums text-[9px] text-[color:var(--jaroo-muted)]'>
                  생성 {report.fetchedAtSec}초
                </span>
              ) : null}
            </div>
            {report.recoveryHorizonProbabilities ? (
              <div className='grid grid-cols-3 gap-2'>
                {(['3m', '6m', '1y'] as const).map((key) => {
                  const pct = report.recoveryHorizonProbabilities?.[key]
                  if (pct == null) return null
                  return (
                    <div key={key}>
                      <div className='flex items-center justify-between text-[9px] text-[color:var(--jaroo-muted)]'>
                        <span>{key === '3m' ? '3개월' : key === '6m' ? '6개월' : '1년'}</span>
                        <span className='font-semibold tabular-nums text-[color:var(--jaroo-ink)]'>{pct}%</span>
                      </div>
                      <div className='mt-0.5 h-1 overflow-hidden rounded-full bg-white'>
                        <div className='h-full rounded-full bg-[color:var(--jaroo-primary)]' style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : null}
            {report.recoveryProbabilityHeadlineText ? (
              <p className='text-[10px] leading-relaxed text-[color:var(--jaroo-muted)]'>
                {report.recoveryProbabilityHeadlineText}
              </p>
            ) : null}
            <div className='flex items-center gap-1.5'>
              <span className='truncate rounded border border-[color:var(--jaroo-border)] bg-white px-1.5 py-0.5 font-mono text-[9px] tracking-tight text-[color:var(--jaroo-muted)]'>
                {report.debugId}
              </span>
              {report.confidenceLevel ? (
                <span className='shrink-0 text-[9px] text-[color:var(--jaroo-muted)]'>신뢰도 {report.confidenceLevel}</span>
              ) : null}
            </div>
          </div>
        </details>
      ) : null}
    </li>
  )
}

// ---------------------------------------------------------------- 실시간: 발굴 기반 템플릿 일기 (게이트는 Phase 2 대기)

function LiveDiaryCard({
  character,
  data,
  live,
}: {
  character: Draft5Character
  data: Draft5LiveCharacterData | null
  live: Draft5LivePayload
}) {
  const diary = buildLiveDiary(character.key, data?.positive ?? [], data?.negative ?? [])
  // 페르소나 LLM 손글씨 일기 우선 — 없으면 템플릿 폴백 (칩/스탬프는 게이트 데이터 기반이라 그대로)
  const llmDiary = data?.diary
  const mood = llmDiary?.mood ?? diary.mood
  const paragraphs = llmDiary && llmDiary.paragraphs.length > 0 ? llmDiary.paragraphs : diary.paragraphs
  const dateParts = liveDateParts(live.generatedAt)
  return (
    <div className='space-y-2'>
      <div className='flex items-center gap-2'>
        <span className='text-[11px] font-semibold text-[color:var(--jaroo-ink)]'>
          {dateParts ? dateParts.dateLabel : '오늘'}{' '}
          <span className='text-[color:var(--jaroo-muted)]'>({dateParts?.weekday || ''})</span>
          <span className='ml-1.5 rounded-full bg-[color:var(--jaroo-accent)] px-1.5 py-0.5 text-[9px] font-bold text-[color:var(--jaroo-primary)]'>
            {llmDiary ? '실시간 발굴 · AI 서사 일기' : '실시간 발굴 데모'}
          </span>
        </span>
        <span className='text-sm' aria-hidden='true'>{mood}</span>
        <div className='h-px flex-1 bg-[color:var(--jaroo-border)]' aria-hidden='true' />
      </div>

      <article className='rounded-2xl border border-[color:var(--jaroo-border)] bg-white p-4 shadow-sm'>
        <div className='flex flex-col gap-2.5'>
          {paragraphs.map((paragraph, index) => (
            <p key={index} className='text-[14px] leading-relaxed text-[color:var(--jaroo-ink)]'>
              {paragraph}
            </p>
          ))}
        </div>

        {/* 게이트 미달 관망 — 목업 PASS 스탬프 서사와 같은 톤으로 연결 */}
        {diary.failViews.length > 0 ? (
          <div className='mt-3 flex flex-col items-center gap-1.5 rounded-xl border border-dashed border-[color:var(--jaroo-border)] bg-[color:var(--jaroo-secondary)] px-3 py-3'>
            <span className='inline-flex -rotate-6 items-center gap-1 rounded-md border-2 border-dashed border-[color:var(--jaroo-muted)] px-2 py-0.5 text-[10px] font-bold tracking-[0.25em] text-[color:var(--jaroo-muted)]'>
              <Pause className='size-2.5' aria-hidden='true' />
              PASS
            </span>
            <p className='text-[10px] font-bold text-[color:var(--jaroo-loss)]'>deepscan 문턱 미달 관망</p>
            {diary.failViews.slice(0, 2).map((view) => (
              <p key={view.stock} className='text-center text-[11px] font-medium text-[color:var(--jaroo-ink)]'>
                뉴스에서 좋았는데 딥스캔 {view.score}점 &lt; 내 문턱 {view.threshold} — 역시 못 사겠어 😰 ({view.stock})
              </p>
            ))}
          </div>
        ) : null}

        <div className='mt-3'>
          <div className='mb-1.5 text-[10px] font-semibold text-[color:var(--jaroo-muted)]'>판단 상태</div>
          <div className='flex flex-wrap gap-1'>
            {diary.passViews.slice(0, 2).map((view) => (
              <span key={view.stock} className='rounded-full bg-[color:var(--jaroo-profit-soft)] px-2 py-0.5 text-[10px] font-bold tabular-nums text-[color:var(--jaroo-profit)]'>
                딥스캔 {view.score} · 문턱 {view.threshold} 통과
              </span>
            ))}
            {diary.passViews.slice(0, 2).map((view) =>
              view.sizing ? (
                <span key={`${view.stock}-sizing`} className='rounded-md border border-dashed border-[color:var(--jaroo-primary)]/50 bg-white px-1.5 py-0.5 text-[9px] font-bold text-[color:var(--jaroo-primary)]'>
                  sizing · {view.sizing}
                </span>
              ) : null,
            )}
            {diary.failViews.slice(0, 2).map((view) => (
              <span key={view.stock} className='rounded-full bg-[color:var(--jaroo-loss-soft)] px-2 py-0.5 text-[10px] font-bold tabular-nums text-[color:var(--jaroo-loss)]'>
                딥스캔 {view.score} &lt; 문턱 {view.threshold} 미달
              </span>
            ))}
            {diary.pendingCount > 0 ? (
              <>
                <span className='rounded-full bg-[color:var(--jaroo-warning-soft)] px-2 py-0.5 text-[10px] font-bold text-[color:var(--jaroo-warning)]'>
                  deepscan 연동 대기 (Phase 2) · {diary.pendingCount}종목
                </span>
                <span className='rounded-full border border-[color:var(--jaroo-border)] bg-white px-2 py-0.5 font-mono text-[9px] tracking-tight text-[color:var(--jaroo-muted)]'>
                  RC-PENDING-PHASE2
                </span>
              </>
            ) : null}
            {diary.mentionedStocks.map((stock) => (
              <span key={stock} className='rounded-full border border-[color:var(--jaroo-border)] bg-white px-2 py-0.5 text-[10px] font-semibold text-[color:var(--jaroo-ink)]'>
                발굴 {stock}
              </span>
            ))}
          </div>
        </div>
      </article>
    </div>
  )
}

// ---------------------------------------------------------------- 실시간: 발굴 매트릭스 미니

function MatrixMini({ live }: { live: Draft5LivePayload }) {
  const matrix = live.matrix
  const counts = liveGateCounts(live)
  // 만장일치 기준은 라인업 크기에서 도출 (현재 3인 — 하드코딩 금지)
  const rosterSize = live.characters.length || DRAFT5_LIVE_CHARACTER_NAMES.length
  const unanimousPositive = matrix.filter((row) => Number(row.sum) === rosterSize)
  const unanimousNegative = matrix.filter((row) => Number(row.sum) === -rosterSize)
  const ranked = [...matrix]
    .sort((a, b) => Math.abs(Number(b.sum)) - Math.abs(Number(a.sum)))
    .slice(0, 8)
  return (
    <section aria-label='오늘의 발굴 매트릭스' className='rounded-2xl border border-[color:var(--jaroo-border)] bg-white p-4 shadow-sm'>
      <div className='flex items-center gap-2'>
        <Target className='size-3.5 text-[color:var(--jaroo-primary)]' aria-hidden='true' />
        <h2 className='text-xs font-semibold text-[color:var(--jaroo-ink)]'>오늘의 발굴 매트릭스</h2>
        <span className='ml-auto text-[10px] tabular-nums text-[color:var(--jaroo-muted)]'>
          {matrix.length}종목 스캔
        </span>
      </div>

      {/* 실제 deepscan 판정 집계 — 파이프라인 요약(실점수) */}
      {counts.total > 0 ? (
        <p className='mt-2 rounded-lg bg-[color:var(--jaroo-secondary)] px-2.5 py-2 text-[11px] font-semibold tabular-nums text-[color:var(--jaroo-ink)]'>
          딥스캔 판정 {counts.decided}/{counts.total} ·{' '}
          <span className='text-[color:var(--jaroo-profit)]'>통과 {counts.pass}</span> ·{' '}
          <span className='text-[color:var(--jaroo-loss)]'>미달 {counts.fail}</span> · 대기 {counts.pending}
        </p>
      ) : null}

      {unanimousPositive.length > 0 ? (
        <p className='mt-2 rounded-lg bg-[color:var(--jaroo-profit-soft)] px-2.5 py-2 text-[11px] font-semibold text-[color:var(--jaroo-profit)]'>
          오늘 {rosterSize}인 전원 긍정: {unanimousPositive.map((row) => row.stock).join(' · ')}
        </p>
      ) : (
        <p className='mt-2 text-[11px] text-[color:var(--jaroo-muted)]'>만장일치(+{rosterSize}) 긍정 종목은 아직 없어요.</p>
      )}
      {unanimousNegative.length > 0 ? (
        <p className='mt-1.5 rounded-lg bg-[color:var(--jaroo-loss-soft)] px-2.5 py-2 text-[11px] font-semibold text-[color:var(--jaroo-loss)]'>
          오늘 {rosterSize}인 전원 부정: {unanimousNegative.map((row) => row.stock).join(' · ')}
        </p>
      ) : null}

      <div className='mt-2.5 space-y-1'>
        {ranked.map((row) => (
          <div key={row.stock} className='flex items-center gap-2 text-[11px]'>
            <span className='w-28 shrink-0 truncate font-semibold text-[color:var(--jaroo-ink)]'>{row.stock}</span>
            <span className='flex gap-1.5 text-[9px] leading-none tracking-[0.15em]' aria-label='캐릭터별 스탠스'>
              {DRAFT5_LIVE_CHARACTER_NAMES.map((name) => {
                const stance = liveStanceOf(row, name)
                return (
                  <span
                    key={name}
                    title={name}
                    className={
                      stance === 1
                        ? 'text-[color:var(--jaroo-profit)]'
                        : stance === -1
                          ? 'text-[color:var(--jaroo-loss)]'
                          : 'text-[color:var(--jaroo-border)]'
                    }
                  >
                    {stance === 0 ? '○' : '●'}
                  </span>
                )
              })}
            </span>
            <span
              className={cn(
                'ml-auto shrink-0 font-semibold tabular-nums',
                Number(row.sum) > 0
                  ? 'text-[color:var(--jaroo-profit)]'
                  : Number(row.sum) < 0
                    ? 'text-[color:var(--jaroo-loss)]'
                    : 'text-[color:var(--jaroo-muted)]',
              )}
            >
              {Number(row.sum) > 0 ? '+' : ''}
              {row.sum}
            </span>
          </div>
        ))}
      </div>
      <p className='mt-1.5 text-[9px] text-[color:var(--jaroo-muted)]'>
        ● 스탠스 확정(긍정 빨강 · 부정 파랑) · ○ 무판정 — |sum| 상위 8종목
      </p>
    </section>
  )
}

// ---------------------------------------------------------------- 목업: 일기 블록

function DiaryEntryBlock({ entry }: { entry: Draft5DiaryEntry }) {
  return (
    <div className='space-y-2'>
      {/* 날짜 헤더 */}
      <div className='flex items-center gap-2'>
        <span className='text-[11px] font-semibold text-[color:var(--jaroo-ink)]'>
          {entry.dateLabel} <span className='text-[color:var(--jaroo-muted)]'>({entry.weekday})</span>
        </span>
        <span className='text-sm' aria-hidden='true'>{entry.mood}</span>
        <div className='h-px flex-1 bg-[color:var(--jaroo-border)]' aria-hidden='true' />
      </div>

      {/* 일기 카드 */}
      <article className='rounded-2xl border border-[color:var(--jaroo-border)] bg-white p-4 shadow-sm'>
        <NewsDiscoveryChip entry={entry} />
        <div className='mt-3 flex flex-col gap-2.5'>
          {entry.paragraphs.map((paragraph, index) => (
            <p key={index} className='text-[14px] leading-relaxed text-[color:var(--jaroo-ink)]'>
              {paragraph}
            </p>
          ))}
        </div>

        <ReceiptBlock entry={entry} />
        <EvidenceChips entry={entry} />
      </article>
    </div>
  )
}

// ---------------------------------------------------------------- 뉴스 발굴 칩 (#369 4단계 입증 체인의 시작점)

function NewsDiscoveryChip({ entry }: { entry: Draft5DiaryEntry }) {
  const news: Draft5NewsItem | undefined = DRAFT5_NEWS[entry.judgment.candidateSource.newsKey]
  if (!news) return null
  return (
    <a
      href={newsUrl(news)}
      target='_blank'
      rel='noopener noreferrer'
      className='block rounded-xl border border-[color:var(--jaroo-border)] bg-[color:var(--jaroo-accent)] px-3 py-2.5 transition hover:bg-[color:var(--jaroo-secondary)]'
      aria-label={`${news.headline} — 네이버 뉴스 원문 열기`}
    >
      <div className='flex items-center gap-1.5'>
        <Newspaper className='size-3 shrink-0 text-[color:var(--jaroo-primary)]' aria-hidden='true' />
        <span className='text-[10px] font-bold text-[color:var(--jaroo-primary)]'>오늘 뉴스에서 봤다</span>
        <span className='rounded-full bg-[color:var(--jaroo-profit-soft)] px-1.5 py-0.5 text-[9px] font-bold text-[color:var(--jaroo-profit)]'>
          긍정 발굴
        </span>
        <ExternalLink className='ml-auto size-3 shrink-0 text-[color:var(--jaroo-muted)]' aria-hidden='true' />
      </div>
      <p className='mt-1.5 text-[12px] font-semibold leading-snug text-[color:var(--jaroo-ink)]'>
        {news.headline}
      </p>
      <p className='mt-1 text-[9px] text-[color:var(--jaroo-muted)]'>
        {news.source} · {news.publishedAt} · {news.stockName}
      </p>
    </a>
  )
}

// 진짜 영수증 — 일기의 감성과 대비되는 딱딱한 체결 원장
function ReceiptBlock({ entry }: { entry: Draft5DiaryEntry }) {
  return (
    <div className='mt-3 overflow-hidden rounded-xl border border-[color:var(--jaroo-border)] bg-[color:var(--jaroo-secondary)]'>
      <div className='flex items-center justify-between border-b border-[color:var(--jaroo-border)] px-3 py-2'>
        <span className='flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-[color:var(--jaroo-ink)]'>
          <Receipt className='size-3' aria-hidden='true' />
          진짜 영수증
        </span>
        <span className='text-[10px] tracking-wide text-[color:var(--jaroo-muted)]'>AI 집행 원장 · KST</span>
      </div>

      {entry.executions.length > 0 ? (
        <div className='px-3 py-2'>
          <table className='w-full table-fixed border-collapse text-[10px] tabular-nums'>
            <thead>
              <tr className='text-[9px] uppercase tracking-wider text-[color:var(--jaroo-muted)]'>
                <th scope='col' className='py-1 text-left font-semibold'>시각</th>
                <th scope='col' className='py-1 text-center font-semibold'>구분</th>
                <th scope='col' className='py-1 text-left font-semibold'>종목</th>
                <th scope='col' className='py-1 text-right font-semibold'>수량</th>
                <th scope='col' className='py-1 text-right font-semibold'>단가</th>
                <th scope='col' className='py-1 text-right font-semibold'>금액</th>
              </tr>
            </thead>
            <tbody>
              {entry.executions.map((execution) => (
                <ExecutionRow key={execution.orderId} execution={execution} />
              ))}
            </tbody>
          </table>
          <div className='mt-2 space-y-0.5 border-t border-dashed border-[color:var(--jaroo-border)] pt-2'>
            {entry.executions.map((execution) => (
              <p key={execution.orderId} className='truncate font-mono text-[9px] tracking-tight text-[color:var(--jaroo-muted)]'>
                {execution.orderId} · {execution.name} {execution.qty}주 · 수수료 {execution.fee.toLocaleString('ko-KR')}원
              </p>
            ))}
          </div>
          {/* 점수 기반 sizing 힌트 — 점수 높을수록 큰 비중, 애매하면 반 티켓 */}
          {entry.sizing ? (
            <div className='mt-1.5 flex items-center gap-1.5'>
              <span className='shrink-0 rounded-md border border-dashed border-[color:var(--jaroo-primary)]/50 bg-white px-1.5 py-0.5 text-[9px] font-bold text-[color:var(--jaroo-primary)]'>
                sizing · {entry.sizing.label}
              </span>
              <span className='truncate text-[9px] text-[color:var(--jaroo-muted)]'>{entry.sizing.note}</span>
            </div>
          ) : null}
        </div>
      ) : (
        <div className='flex flex-col items-center gap-1.5 px-3 py-3.5'>
          <span className='inline-flex -rotate-6 items-center gap-1 rounded-md border-2 border-dashed border-[color:var(--jaroo-muted)] px-2 py-0.5 text-[10px] font-bold tracking-[0.25em] text-[color:var(--jaroo-muted)]'>
            <Pause className='size-2.5' aria-hidden='true' />
            PASS
          </span>
          <p className='text-[10px] font-bold text-[color:var(--jaroo-loss)]'>deepscan 문턱 미달</p>
          <p className='text-[11px] font-medium text-[color:var(--jaroo-ink)]'>{entry.skipReason}</p>
          <p className='text-[10px] tabular-nums text-[color:var(--jaroo-muted)]'>체결 0건 · 수수료 0원</p>
        </div>
      )}

      {/* 계좌 요약 */}
      <div className='grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-[color:var(--jaroo-border)] px-3 py-2.5'>
        <AccountCell label='현금' value={fmtKrw(entry.account.cash)} />
        <AccountCell label='매입원본' value={fmtKrw(entry.account.principal)} />
        <AccountCell label='평가금액' value={fmtKrw(entry.account.evaluation)} />
        <AccountCell
          label='수익률'
          value={fmtSigned(entry.account.returnRatePct)}
          valueClass={entry.account.returnRatePct >= 0 ? 'text-[color:var(--jaroo-profit)]' : 'text-[color:var(--jaroo-loss)]'}
        />
      </div>
    </div>
  )
}

function ExecutionRow({ execution }: { execution: Draft5Execution }) {
  return (
    <tr className='border-t border-[color:var(--jaroo-border)]'>
      <td className='whitespace-nowrap py-1.5 pr-1 text-[color:var(--jaroo-muted)]'>{execution.at.slice(5)}</td>
      <td className={cn('py-1.5 text-center font-bold', sideLabelClass(execution.side))}>
        {execution.side === 'BUY' ? '매수' : '매도'}
      </td>
      <td className='truncate py-1.5 pr-1 font-medium text-[color:var(--jaroo-ink)]'>{execution.name}</td>
      <td className='py-1.5 text-right text-[color:var(--jaroo-ink)]'>{execution.qty}</td>
      <td className='whitespace-nowrap py-1.5 text-right text-[color:var(--jaroo-ink)]'>{execution.price.toLocaleString('ko-KR')}</td>
      <td className='whitespace-nowrap py-1.5 pl-1 text-right font-semibold text-[color:var(--jaroo-ink)]'>
        {execution.amount.toLocaleString('ko-KR')}
      </td>
    </tr>
  )
}

function AccountCell({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className='flex items-baseline justify-between gap-2'>
      <span className='shrink-0 text-[10px] text-[color:var(--jaroo-muted)]'>{label}</span>
      <span className={cn('text-[11px] font-semibold tabular-nums text-[color:var(--jaroo-ink)]', valueClass)}>{value}</span>
    </div>
  )
}

// 그날 본 deepscan 리포트 근거 칩
function EvidenceChips({ entry }: { entry: Draft5DiaryEntry }) {
  const report = DRAFT5_REPORTS[entry.judgment.reportKey]
  const passed = gatePassed(entry)
  return (
    <div className='mt-3'>
      <div className='mb-1.5 flex items-center gap-1 text-[10px] font-semibold text-[color:var(--jaroo-muted)]'>
        <FileText className='size-3' aria-hidden='true' />
        그날 본 deepscan 리포트 · {report.input.instrument.name}
      </div>
      <div className='flex flex-wrap gap-1'>
        {/* A안 게이트 — 성향 문턱 판정 */}
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums',
            passed
              ? 'bg-[color:var(--jaroo-profit-soft)] text-[color:var(--jaroo-profit)]'
              : 'bg-[color:var(--jaroo-loss-soft)] text-[color:var(--jaroo-loss)]',
          )}
        >
          문턱 {entry.gate.minHeroScore} · {entry.judgment.heroScore} {passed ? '통과' : '미달'}
        </span>
        <span className={cn('rounded-full border border-[color:var(--jaroo-border)] bg-white px-2 py-0.5 text-[10px] font-semibold tabular-nums', scoreToneClass(entry.judgment.heroScore))}>
          종합 {entry.judgment.heroScore}점 · {report.hero.statusText}
        </span>
        {entry.judgment.recoveryPct !== null ? (
          <span className='rounded-full border border-[color:var(--jaroo-border)] bg-white px-2 py-0.5 text-[10px] tabular-nums text-[color:var(--jaroo-ink)]'>
            6개월 복구 {entry.judgment.recoveryPct}%
          </span>
        ) : null}
        {entry.judgment.targetPrice !== null ? (
          <span className='rounded-full border border-[color:var(--jaroo-border)] bg-white px-2 py-0.5 text-[10px] tabular-nums text-[color:var(--jaroo-ink)]'>
            목표가 {entry.judgment.targetPrice.toLocaleString('ko-KR')}원
          </span>
        ) : null}
        <span className='rounded-full border border-[color:var(--jaroo-border)] bg-white px-2 py-0.5 font-mono text-[9px] tracking-tight text-[color:var(--jaroo-muted)]'>
          {entry.judgment.reasonCode}
        </span>
        <span className='rounded-full border border-[color:var(--jaroo-border)] bg-white px-2 py-0.5 font-mono text-[9px] tracking-tight text-[color:var(--jaroo-muted)]'>
          {entry.judgment.debugId}
        </span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- 3. 주간 성과 카드

function WeeklyPerformanceCard({ character }: { character: Draft5Character }) {
  const { weekly } = character
  const goalPct = Math.max(0, Math.min(100, Math.round((weekly.goal.current / weekly.goal.target) * 100)))
  const goalValueText =
    weekly.goal.unit === 'krw'
      ? `${fmtManwon(weekly.goal.current)} / ${fmtManwon(weekly.goal.target)}`
      : `+${weekly.goal.current}% / +${weekly.goal.target}%`

  return (
    <section
      aria-label={`${character.name}의 주간 성적표`}
      className='overflow-hidden rounded-2xl text-white shadow-md'
      style={{ background: 'linear-gradient(135deg, var(--jaroo-primary), var(--jaroo-primary-strong))' }}
    >
      <div className='space-y-4 p-5'>
        <div className='flex items-center gap-2.5'>
          <span className={cn('flex size-9 items-center justify-center rounded-full text-lg', character.avatarBg)} aria-hidden='true'>
            {character.emoji}
          </span>
          <div className='min-w-0 flex-1'>
            <p className='text-sm font-bold'>{character.name}</p>
            <p className='truncate text-[10px] text-white/70'>{character.roleLabel}</p>
          </div>
          <span className='rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-medium tabular-nums'>
            {DRAFT5_WEEK_RANGE_LABEL}
          </span>
        </div>

        <div>
          <div className='flex items-end gap-1.5'>
            <span className='text-[44px] font-extrabold leading-none tracking-tight tabular-nums'>
              {fmtSigned(weekly.returnPct, 1)}
            </span>
            <TrendingUp className='mb-1.5 size-6 text-white/80' aria-hidden='true' />
          </div>
          <p className='mt-1 text-[11px] text-white/70'>이번 주 수익률 · {fmtManwon(weekly.startAsset)} → {fmtManwon(weekly.endAsset)}</p>
        </div>

        <div className='grid grid-cols-3 divide-x divide-white/15 rounded-xl bg-white/10 py-2.5 text-center'>
          <div>
            <p className='text-[10px] text-white/70'>체결</p>
            <p className='text-sm font-bold tabular-nums'>{weekly.tradeCount}건</p>
          </div>
          <div>
            <p className='text-[10px] text-white/70'>노트레이드</p>
            <p className='text-sm font-bold tabular-nums'>{character.entries.filter((entry) => entry.skipped).length}회</p>
          </div>
          <div>
            <p className='text-[10px] text-white/70'>수수료</p>
            <p className='text-sm font-bold tabular-nums'>{weekly.totalFee.toLocaleString('ko-KR')}원</p>
          </div>
        </div>

        {/* v1 파이프라인 요약 — 발굴 → 문턱 판정(#369) */}
        <p className='text-center text-[11px] tabular-nums text-white/75'>
          뉴스 발굴 {new Set(character.entries.map((entry) => entry.judgment.candidateSource.newsKey)).size}건 · 문턱
          통과 {character.entries.filter((entry) => gatePassed(entry)).length} · 미달 관망{' '}
          {character.entries.filter((entry) => !gatePassed(entry)).length}
        </p>

        <div>
          <div className='mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold'>
            <Target className='size-3.5' aria-hidden='true' />
            {weekly.goal.label}
            <span className='text-[10px] font-normal text-white/70'>{weekly.goal.caption}</span>
          </div>
          <div className='h-2 overflow-hidden rounded-full bg-white/20'>
            <div className='h-full rounded-full bg-white' style={{ width: `${goalPct}%` }} />
          </div>
          <p className='mt-1.5 text-[11px] tabular-nums text-white/85'>
            {goalValueText} · <span className='font-semibold text-white'>{goalPct}%</span>
          </p>
        </div>

        <blockquote className='border-l-2 border-white/40 pl-3 text-[13px] leading-relaxed text-white/90'>
          “{weekly.quote}”
          <footer className='mt-1 text-[10px] text-white/60'>— {character.name}, 한 줄 철학: {character.philosophy}</footer>
        </blockquote>

        <div className='flex items-center justify-between border-t border-white/15 pt-3'>
          <span className='text-[10px] text-white/70'>AI 트레이더 투자일기 · jaroo deepscan</span>
          <span className='flex items-center gap-1 text-[10px] text-white/70'>
            <Share2 className='size-3' aria-hidden='true' />
            스크린샷으로 공유해보세요
          </span>
        </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------- 4. 하단 고정 CTA

function Draft5CtaBar() {
  return (
    <div className='border-t border-[color:var(--jaroo-border)] bg-white/95 px-4 pb-5 pt-3 backdrop-blur'>
      <p className='mb-2 text-center text-[11px] text-[color:var(--jaroo-muted)]'>
        MTS 스크린샷 한 장이면 끝 · 진단 1회 무료
      </p>
      <Link
        href='/deepscan'
        className={cn(buttonVariants({ size: 'lg' }), 'h-11 w-full rounded-xl text-[15px] font-semibold')}
      >
        <Sparkles className='size-4' aria-hidden='true' />
        내 포트폴리오도 무료 deepscan 받기
      </Link>
    </div>
  )
}
