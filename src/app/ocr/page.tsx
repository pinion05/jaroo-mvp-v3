'use client'

import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowRight, Check, ChevronDown, LoaderCircle, RefreshCcw, ScanSearch, Trash2 } from 'lucide-react'
import { OcrConflictMergeCard } from '@/components/ocr-conflict-merge-card'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { JarooShell } from '@/components/jaroo-shell'
import {
  buildMergedOcrResult,
  buildOcrSourceRows,
  computeAveragePrice,
  resolveMergedOcrRows,
  sanitizeOcrInstrumentCandidateLists,
  sanitizeOcrRows,
  type OcrInstrumentCandidate,
  type OcrRow,
  type OcrSourceRow,
  type ScreenshotUploadSession,
} from '@/lib/screenshot-ocr'
import { useMergeStore } from '@/lib/stores/use-merge-store'
import { useOcrReviewStore } from '@/lib/stores/use-ocr-review-store'
import { useOcrUploadStore } from '@/lib/stores/use-ocr-upload-store'
import type { OcrReviewRow, ResolveCandidate } from '@/lib/workflow-types'
import { cn } from '@/lib/utils'

type OcrRequestState = 'idle' | 'loading' | 'success' | 'error'
type UploadRequestState = 'idle' | 'loading' | 'success' | 'error'
type InstrumentResolveState = 'idle' | 'loading' | 'success' | 'error'

type ResolveInstrumentsResponse = {
  rows?: unknown
  candidates?: unknown
  error?: string
}

type ResolvedInstrumentRowsResult = {
  rows: OcrSourceRow[]
  candidatesByRowId: Record<string, OcrInstrumentCandidate[]>
}

type ManualEditableField =
  | 'name'
  | 'resolvedTicker'
  | 'resolvedCode'
  | 'resolvedMarket'
  | 'resolvedKind'
  | 'quantity'
  | 'profitRate'
  | 'evaluationAmount'

type UploadStatus = {
  state: UploadRequestState
  rowCount: number
  errorMessage: string
}

const statusLabel: Record<OcrRequestState, string> = {
  idle: '대기 중',
  loading: '분석 중',
  success: '인식 완료',
  error: '재시도 필요',
}

const uploadStateLabel: Record<UploadRequestState, string> = {
  idle: '대기',
  loading: '분석 중',
  success: '완료',
  error: '실패',
}

function OcrMetricChip({ label, value, valueClassName }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div className='rounded-[14px] bg-[color:var(--jaroo-secondary)] px-3 py-2'>
      <p className='text-[10px] text-[color:var(--jaroo-muted)]'>{label}</p>
      <p className={cn('mt-1 truncate text-[12px] font-semibold text-[color:var(--jaroo-ink)]', valueClassName)}>{value || '-'}</p>
    </div>
  )
}

async function resolveInstrumentRows(rows: OcrSourceRow[]): Promise<ResolvedInstrumentRowsResult> {
  const response = await fetch('/api/instruments/resolve', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ rows }),
  })

  const payload = (await response.json().catch(() => null)) as ResolveInstrumentsResponse | null
  const sanitizedRows = sanitizeOcrRows(payload?.rows)
  const sanitizedCandidates = sanitizeOcrInstrumentCandidateLists(payload?.candidates)

  if (!response.ok || !Array.isArray(payload?.rows) || sanitizedRows.length !== rows.length || sanitizedCandidates.length !== rows.length) {
    throw new Error(payload?.error || '종목 식별자 확인에 실패했어요.')
  }

  const mergedRows = rows.map((row, index) => ({
    ...row,
    ...sanitizedRows[index],
  }))

  return {
    rows: mergedRows,
    candidatesByRowId: Object.fromEntries(mergedRows.map((row, index) => [row.id, sanitizedCandidates[index]])),
  }
}

function inferMarketTone(market?: string) {
  const normalized = market?.trim().toUpperCase()

  if (!normalized) {
    return undefined
  }

  if (normalized === 'KR') {
    return 'kospi'
  }

  if (normalized === 'US') {
    return 'nasdaq'
  }

  if (normalized.includes('KOSDAQ')) {
    return 'kosdaq'
  }

  if (normalized.includes('KOSPI') || normalized.includes('KRX')) {
    return 'kospi'
  }

  if (normalized.includes('NASDAQ') || normalized.includes('NYSE') || normalized.includes('AMEX')) {
    return 'nasdaq'
  }

  if (normalized.includes('ETF')) {
    return 'etf'
  }

  return undefined
}

function hasResolvedIdentifier(row: Pick<OcrReviewRow, 'resolvedName' | 'resolvedTicker' | 'resolvedCode'>) {
  return Boolean(row.resolvedName?.trim() || row.resolvedTicker?.trim() || row.resolvedCode?.trim())
}

function isManualRowComplete(row: OcrReviewRow) {
  return Boolean(
    row.name.trim()
    && (row.resolvedTicker?.trim() || row.resolvedCode?.trim())
    && row.resolvedMarket?.trim()
    && row.resolvedKind
    && row.quantity.trim()
    && row.profitRate.trim()
    && row.evaluationAmount.trim(),
  )
}

function toReviewRow(row: OcrSourceRow): OcrReviewRow {
  return {
    ...row,
    raw: {
      name: row.name,
      quantity: row.quantity,
      profitRate: row.profitRate,
      evaluationAmount: row.evaluationAmount,
      averagePrice: row.averagePrice,
      code: row.code,
      ticker: row.ticker,
    },
    sourceFileName: row.fileName,
    sourceUploadId: row.uploadId,
    resolutionState: hasResolvedIdentifier(row) ? 'resolved' : 'unresolved',
    selectedCandidateId: null,
  }
}

function applyReviewCandidate(row: OcrReviewRow, candidate?: ResolveCandidate) {
  if (!candidate) {
    return row
  }

  return {
    ...row,
    resolvedName: candidate.resolvedName,
    resolvedCode: candidate.resolvedCode ?? row.resolvedCode,
    resolvedTicker: candidate.resolvedTicker ?? row.resolvedTicker,
    resolvedMarket: candidate.resolvedMarket ?? row.resolvedMarket,
    resolvedMarketTone: candidate.resolvedMarketTone ?? row.resolvedMarketTone,
    resolvedKind: candidate.resolvedKind ?? row.resolvedKind,
  }
}

function mergeResolvedRowsWithExistingReviewRows(
  resolvedRows: OcrSourceRow[],
  existingRows: OcrReviewRow[],
  existingCandidatesByRowId: Record<string, ResolveCandidate[]>,
) {
  const existingRowsById = new Map(existingRows.map((row) => [row.id, row]))
  const nextRows = resolvedRows.map((row) => existingRowsById.get(row.id) ?? toReviewRow(row))
  const nextCandidatesByRowId = Object.fromEntries(
    Object.entries(existingCandidatesByRowId).filter(([rowId]) => nextRows.some((row) => row.id === rowId)),
  )

  return {
    rows: nextRows,
    candidatesByRowId: nextCandidatesByRowId,
  }
}

function filterConflictSelections(
  conflicts: Array<{ key: string; candidates: Array<{ id: string }> }>,
  selections: Record<string, string>,
) {
  return Object.fromEntries(
    conflicts
      .map((conflict) => {
        const selectedCandidateId = selections[conflict.key]
        if (!selectedCandidateId) {
          return null
        }

        return conflict.candidates.some((candidate) => candidate.id === selectedCandidateId)
          ? [conflict.key, selectedCandidateId]
          : null
      })
      .filter((entry): entry is [string, string] => entry !== null),
  )
}

function areSameSelectionMap(left: Record<string, string>, right: Record<string, string>) {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)

  return (
    leftKeys.length === rightKeys.length
    && leftKeys.every((key) => right[key] === left[key])
  )
}

function formatCandidateScore(score?: number) {
  if (typeof score !== 'number' || !Number.isFinite(score)) {
    return ''
  }

  return `${Math.round(score * 100)}%`
}

type OcrResolvedRowCardProps = {
  row: OcrReviewRow
  isLast: boolean
  identifierStatus: InstrumentResolveState
  candidates: ResolveCandidate[]
  isExpanded: boolean
  selectedCandidateId?: string
  onToggleExpand: () => void
  onSelectCandidate: (candidateId: string) => void
  onClearCandidateSelection: () => void
  onManualFieldChange: (field: ManualEditableField, value: string) => void
  onRemoveRow: () => void
}

function OcrResolvedRowCard({
  row,
  isLast,
  identifierStatus,
  candidates,
  isExpanded,
  selectedCandidateId,
  onToggleExpand,
  onSelectCandidate,
  onClearCandidateSelection,
  onManualFieldChange,
  onRemoveRow,
}: OcrResolvedRowCardProps) {
  const identifierName = row.resolvedName?.trim()
  const identifierMeta = [row.resolvedMarket?.trim(), row.resolvedTicker?.trim(), row.resolvedCode?.trim()].filter(Boolean).join(' · ')
  const identifierStatusText =
    identifierStatus === 'loading'
      ? '식별자 확인 중'
      : identifierStatus === 'error'
        ? '식별자 확인 실패'
        : '식별자 미확인'
  const hasCandidatePicker = candidates.length > 1
  const selectedCandidate = candidates.find((candidate) => candidate.id === selectedCandidateId)
  const needsManualConfirmation = row.resolutionState === 'manual-required'

  return (
    <div className={cn(!isLast && 'border-b border-[color:var(--jaroo-border)]')}>
      <div className='flex items-start gap-2 px-4 py-3'>
        <button
          type='button'
          onClick={hasCandidatePicker ? onToggleExpand : undefined}
          className={cn(
            'flex-1 text-left',
            hasCandidatePicker ? 'transition hover:bg-[color:var(--jaroo-secondary)]' : 'cursor-default'
          )}
        >
          <div className='flex items-start justify-between gap-3'>
            <div className='min-w-0'>
              <p className='truncate text-[13px] font-medium text-[color:var(--jaroo-ink)]'>{row.name || '-'}</p>
              <p className='mt-0.5 truncate text-[10px] text-[color:var(--jaroo-muted)]'>{row.sourceFileName}</p>
            </div>
            <p className='shrink-0 text-[11px] font-medium text-[color:var(--jaroo-primary)]'>{row.profitRate || '-'}</p>
          </div>

          <div className='mt-3 rounded-[14px] border border-[#DCE8F5] bg-[#F7FBFF] px-3 py-2'>
            <div className='flex items-start justify-between gap-3'>
              <div className='min-w-0'>
                <p className='text-[10px] text-[color:var(--jaroo-muted)]'>식별된 종목</p>
                {identifierName || identifierMeta ? (
                  <>
                    <p className='mt-1 truncate text-[12px] font-semibold text-[color:var(--jaroo-ink)]'>{identifierName || row.name || '-'}</p>
                    <p className='mt-1 truncate text-[10px] text-[color:var(--jaroo-primary)]'>{identifierMeta || '이름만 확인됨'}</p>
                  </>
                ) : (
                  <p className='mt-1 text-[11px] text-[color:var(--jaroo-muted)]'>{identifierStatusText}</p>
                )}
              </div>
              {hasCandidatePicker ? (
                <div className='flex shrink-0 items-center gap-2 pl-2'>
                  <span className='rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-[color:var(--jaroo-primary)]'>
                    {selectedCandidate ? '후보 적용됨' : `후보 ${candidates.length}개`}
                  </span>
                  <ChevronDown className={cn('size-4 text-[color:var(--jaroo-primary)] transition', isExpanded && 'rotate-180')} />
                </div>
              ) : null}
            </div>
          </div>

          <div className='mt-3 grid grid-cols-2 gap-2'>
            <OcrMetricChip label='보유 수량' value={row.quantity} />
            <OcrMetricChip label='평가 금액' value={row.evaluationAmount} />
            <OcrMetricChip label='평균 단가' value={row.averagePrice} />
            <OcrMetricChip label='수익률' value={row.profitRate} valueClassName='text-[color:var(--jaroo-primary)]' />
          </div>
        </button>

        <button
          type='button'
          onClick={onRemoveRow}
          className='mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full border border-[color:var(--jaroo-border)] bg-white px-2.5 py-1.5 text-[10px] font-semibold text-[color:var(--jaroo-muted)] transition hover:border-[#F5B8B8] hover:bg-[#FFF3F3] hover:text-[#C13030]'
        >
          <Trash2 className='size-3.5' />
          제거
        </button>
      </div>

      {hasCandidatePicker && isExpanded ? (
        <div className='border-t border-[color:var(--jaroo-border)] bg-[color:var(--jaroo-secondary)] px-4 py-3'>
          <div className='flex items-center justify-between gap-3'>
            <div>
              <p className='text-[11px] font-semibold text-[color:var(--jaroo-ink)]'>추천 식별 후보</p>
              <p className='mt-1 text-[10px] text-[color:var(--jaroo-muted)]'>ticker-map 후보를 우선 노출하고, 부족한 경우 로컬 유니버스 후보를 함께 보여줘요.</p>
            </div>
            {selectedCandidate ? (
              <button
                type='button'
                onClick={onClearCandidateSelection}
                className='shrink-0 rounded-full border border-[color:var(--jaroo-primary)] bg-white px-2.5 py-1 text-[10px] font-semibold text-[color:var(--jaroo-primary)]'
              >
                기본 식별 유지
              </button>
            ) : null}
          </div>

          <div className='mt-3 space-y-2'>
            {candidates.map((candidate, index) => {
              const active = selectedCandidateId === candidate.id
              const candidateMeta = [candidate.resolvedMarket?.trim(), candidate.resolvedTicker?.trim(), candidate.resolvedCode?.trim()].filter(Boolean).join(' · ')
              const scoreLabel = formatCandidateScore(candidate.score)
              const evidenceText = [candidate.source === 'ticker-map' ? 'ticker-map' : '로컬', scoreLabel, candidate.via].filter(Boolean).join(' · ')

              return (
                <button
                  key={candidate.id}
                  type='button'
                  onClick={() => onSelectCandidate(candidate.id)}
                  className={cn(
                    'w-full rounded-[18px] border px-3 py-3 text-left transition',
                    active
                      ? 'border-[color:var(--jaroo-primary)] bg-white shadow-[0_6px_20px_rgba(75,157,245,0.12)]'
                      : 'border-[color:var(--jaroo-border)] bg-white hover:bg-[#F9FCFF]',
                  )}
                >
                  <div className='flex items-start justify-between gap-3'>
                    <div className='min-w-0'>
                      <div className='flex flex-wrap items-center gap-1.5'>
                        <span className={cn('text-[10px] font-semibold', active ? 'text-[color:var(--jaroo-primary)]' : 'text-[color:var(--jaroo-muted)]')}>
                          후보 {index + 1}
                        </span>
                        <span className='rounded-full bg-[color:var(--jaroo-secondary)] px-2 py-0.5 text-[10px] font-medium text-[color:var(--jaroo-muted)]'>
                          {candidate.source === 'ticker-map' ? 'ticker-map' : '로컬'}
                        </span>
                      </div>
                      <p className='mt-1 truncate text-[12px] font-semibold text-[color:var(--jaroo-ink)]'>{candidate.resolvedName}</p>
                      <p className='mt-1 truncate text-[10px] text-[color:var(--jaroo-primary)]'>{candidateMeta || '식별자 일부만 확인됨'}</p>
                      {evidenceText ? <p className='mt-1 truncate text-[10px] text-[color:var(--jaroo-muted)]'>{evidenceText}</p> : null}
                    </div>
                    <span
                      className={cn(
                        'shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold',
                        active ? 'bg-[color:var(--jaroo-primary)] text-white' : 'bg-[color:var(--jaroo-secondary)] text-[color:var(--jaroo-muted)]',
                      )}
                    >
                      {active ? '적용됨' : '선택'}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      ) : null}

      {needsManualConfirmation ? (
        <div className='border-t border-[color:var(--jaroo-border)] bg-[#FFF8E8] px-4 py-3'>
          <div className='mb-3 rounded-[16px] border border-[#F5D185] bg-white px-3 py-2'>
            <p className='text-[11px] font-semibold text-[#854F0B]'>자동 후보가 없어요</p>
            <p className='mt-1 text-[10px] leading-5 text-[#8A6520]'>종목명, ticker/code, market/kind, 보유 수량, 수익률, 평가 금액을 직접 확인해 주세요.</p>
          </div>

          <div className='grid grid-cols-1 gap-2 sm:grid-cols-2'>
            <label className='space-y-1'>
              <span className='text-[10px] font-medium text-[color:var(--jaroo-muted)]'>종목명</span>
              <input value={row.name} onChange={(event) => onManualFieldChange('name', event.target.value)} className='w-full rounded-[14px] border border-[color:var(--jaroo-border)] bg-white px-3 py-2 text-[12px] text-[color:var(--jaroo-ink)]' />
            </label>
            <label className='space-y-1'>
              <span className='text-[10px] font-medium text-[color:var(--jaroo-muted)]'>Ticker</span>
              <input value={row.resolvedTicker ?? ''} onChange={(event) => onManualFieldChange('resolvedTicker', event.target.value)} className='w-full rounded-[14px] border border-[color:var(--jaroo-border)] bg-white px-3 py-2 text-[12px] text-[color:var(--jaroo-ink)]' />
            </label>
            <label className='space-y-1'>
              <span className='text-[10px] font-medium text-[color:var(--jaroo-muted)]'>Code</span>
              <input value={row.resolvedCode ?? ''} onChange={(event) => onManualFieldChange('resolvedCode', event.target.value)} className='w-full rounded-[14px] border border-[color:var(--jaroo-border)] bg-white px-3 py-2 text-[12px] text-[color:var(--jaroo-ink)]' />
            </label>
            <label className='space-y-1'>
              <span className='text-[10px] font-medium text-[color:var(--jaroo-muted)]'>시장</span>
              <select value={row.resolvedMarket ?? ''} onChange={(event) => onManualFieldChange('resolvedMarket', event.target.value)} className='w-full rounded-[14px] border border-[color:var(--jaroo-border)] bg-white px-3 py-2 text-[12px] text-[color:var(--jaroo-ink)]'>
                <option value=''>선택</option>
                <option value='KR'>KR</option>
                <option value='US'>US</option>
              </select>
            </label>
            <label className='space-y-1'>
              <span className='text-[10px] font-medium text-[color:var(--jaroo-muted)]'>종목 유형</span>
              <select value={row.resolvedKind ?? ''} onChange={(event) => onManualFieldChange('resolvedKind', event.target.value)} className='w-full rounded-[14px] border border-[color:var(--jaroo-border)] bg-white px-3 py-2 text-[12px] text-[color:var(--jaroo-ink)]'>
                <option value=''>선택</option>
                <option value='stock'>stock</option>
                <option value='etf'>etf</option>
              </select>
            </label>
            <label className='space-y-1'>
              <span className='text-[10px] font-medium text-[color:var(--jaroo-muted)]'>보유 수량</span>
              <input value={row.quantity} onChange={(event) => onManualFieldChange('quantity', event.target.value)} className='w-full rounded-[14px] border border-[color:var(--jaroo-border)] bg-white px-3 py-2 text-[12px] text-[color:var(--jaroo-ink)]' />
            </label>
            <label className='space-y-1'>
              <span className='text-[10px] font-medium text-[color:var(--jaroo-muted)]'>수익률</span>
              <input value={row.profitRate} onChange={(event) => onManualFieldChange('profitRate', event.target.value)} className='w-full rounded-[14px] border border-[color:var(--jaroo-border)] bg-white px-3 py-2 text-[12px] text-[color:var(--jaroo-ink)]' />
            </label>
            <label className='space-y-1'>
              <span className='text-[10px] font-medium text-[color:var(--jaroo-muted)]'>평가 금액</span>
              <input value={row.evaluationAmount} onChange={(event) => onManualFieldChange('evaluationAmount', event.target.value)} className='w-full rounded-[14px] border border-[color:var(--jaroo-border)] bg-white px-3 py-2 text-[12px] text-[color:var(--jaroo-ink)]' />
            </label>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default function OcrPage() {
  const router = useRouter()
  const session = useOcrUploadStore((state) => state.input)
  const clearUploadInput = useOcrUploadStore((state) => state.clear)
  const reviewRows = useOcrReviewStore((state) => state.rows)
  const instrumentCandidatesByRowId = useOcrReviewStore((state) => state.candidatesByRowId)
  const requestState = useOcrReviewStore((state) => state.requestStatus) as OcrRequestState
  const instrumentResolveState = useOcrReviewStore((state) => state.resolveStatus) as InstrumentResolveState
  const errorMessage = useOcrReviewStore((state) => state.errorMessage ?? '')
  const instrumentResolveError = useOcrReviewStore((state) => state.resolveErrorMessage ?? '')
  const setReviewRows = useOcrReviewStore((state) => state.setRows)
  const patchReviewRow = useOcrReviewStore((state) => state.patchRow)
  const removeReviewRow = useOcrReviewStore((state) => state.removeRow)
  const replaceCandidates = useOcrReviewStore((state) => state.replaceCandidates)
  const selectCandidate = useOcrReviewStore((state) => state.selectCandidate)
  const setRequestStatus = useOcrReviewStore((state) => state.setRequestStatus)
  const setResolveStatus = useOcrReviewStore((state) => state.setResolveStatus)
  const resetReviewState = useOcrReviewStore((state) => state.resetForRestart)
  const resetMergeState = useMergeStore((state) => state.resetForBackNav)
  const [uploadStatuses, setUploadStatuses] = useState<Record<string, UploadStatus>>({})
  const [baseMergedRows, setBaseMergedRows] = useState<OcrSourceRow[]>([])
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null)
  const [conflicts, setConflicts] = useState<ReturnType<typeof buildMergedOcrResult>['conflicts']>([])
  const [conflictSelections, setConflictSelections] = useState<Record<string, string>>({})
  const [removedRowIds, setRemovedRowIds] = useState<Record<string, true>>({})

  useEffect(() => {
    if (!session) {
      setRequestStatus('error', '먼저 /screenshot 에서 분석할 스크린샷을 선택해주세요.')
      setResolveStatus('idle')
      setUploadStatuses({})
      return
    }

    setUploadStatuses(
      Object.fromEntries(
        session.uploads.map((upload) => [
          upload.id,
          {
            state: 'idle',
            rowCount: 0,
            errorMessage: '',
          } satisfies UploadStatus,
        ]),
      ),
    )
  }, [session, setRequestStatus, setResolveStatus])

  const runOcrBatch = useCallback(async (currentSession: ScreenshotUploadSession) => {
    setRequestStatus('loading')
    setResolveStatus('idle')
    resetReviewState()
    setBaseMergedRows([])
    setExpandedRowId(null)
    setConflicts([])
    setConflictSelections({})
    setRemovedRowIds({})

    const nextRowsByUpload: Record<string, OcrRow[]> = {}
    let hasErrors = false

    setUploadStatuses(
      Object.fromEntries(
        currentSession.uploads.map((upload) => [
          upload.id,
          {
            state: 'idle',
            rowCount: 0,
            errorMessage: '',
          } satisfies UploadStatus,
        ]),
      ),
    )

    for (const upload of currentSession.uploads) {
      setUploadStatuses((current) => ({
        ...current,
        [upload.id]: {
          state: 'loading',
          rowCount: 0,
          errorMessage: '',
        },
      }))

      try {
        const response = await fetch('/api/ocr', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            broker: currentSession.broker,
            fileName: upload.fileName,
            imageDataUrl: upload.imageDataUrl,
          }),
        })

        const payload = (await response.json().catch(() => null)) as
          | {
              rows?: unknown
              error?: string
            }
          | null

        if (!response.ok) {
          throw new Error(payload?.error || 'OCR 요청에 실패했어요.')
        }

        const sanitizedRows = sanitizeOcrRows(payload?.rows)
        nextRowsByUpload[upload.id] = sanitizedRows

        setUploadStatuses((current) => ({
          ...current,
          [upload.id]: {
            state: 'success',
            rowCount: sanitizedRows.length,
            errorMessage: '',
          },
        }))
      } catch (error) {
        hasErrors = true
        nextRowsByUpload[upload.id] = []

        setUploadStatuses((current) => ({
          ...current,
          [upload.id]: {
            state: 'error',
            rowCount: 0,
            errorMessage: error instanceof Error ? error.message : 'OCR 분석 중 문제가 발생했어요.',
          },
        }))
      }
    }

    const sourceRows = buildOcrSourceRows(currentSession.uploads, nextRowsByUpload)
    const mergedResult = buildMergedOcrResult(sourceRows)
    setBaseMergedRows(mergedResult.mergedRows)
    setConflicts(mergedResult.conflicts)
    setReviewRows(resolveMergedOcrRows(mergedResult.mergedRows, mergedResult.conflicts, {}).map(toReviewRow))

    setConflictSelections((currentSelections) => {
      const nextSelections = Object.fromEntries(
        mergedResult.conflicts
          .map((conflict) => {
            const currentSelectedId = currentSelections[conflict.key]
            const stillValid = conflict.candidates.some((candidate) => candidate.id === currentSelectedId)
            return stillValid ? [conflict.key, currentSelectedId] : null
          })
          .filter((entry): entry is [string, string] => entry !== null),
      )

      return nextSelections
    })

    if (hasErrors) {
      setRequestStatus('error', '일부 스크린샷 분석에 실패했어요. 실패한 항목을 확인하고 다시 시도해주세요.')
      return
    }

    setRequestStatus('success')
  }, [resetReviewState, setRequestStatus, setResolveStatus, setReviewRows])

  useEffect(() => {
    if (!session) {
      return
    }

    void runOcrBatch(session)
  }, [runOcrBatch, session])

  const conflictsWithRemainingCandidates = useMemo(
    () =>
      conflicts.map((conflict) => ({
        ...conflict,
        candidates: conflict.candidates.filter((candidate) => !removedRowIds[candidate.id]),
      })),
    [conflicts, removedRowIds],
  )

  const resolvedRows = useMemo(() => {
    const filteredBaseRows = baseMergedRows.filter((row) => !removedRowIds[row.id])
    const autoResolvedRows = conflictsWithRemainingCandidates.flatMap((conflict) => {
      if (conflict.candidates.length === 1) {
        return conflict.candidates
      }

      return []
    })

    const filteredConflicts = conflictsWithRemainingCandidates.filter((conflict) => conflict.candidates.length > 1)
    const chosenRows = resolveMergedOcrRows([], filteredConflicts, conflictSelections)

    return [...filteredBaseRows, ...autoResolvedRows, ...chosenRows].sort(
      (left, right) => left.uploadIndex - right.uploadIndex || left.rowIndex - right.rowIndex,
    )
  }, [baseMergedRows, conflictSelections, conflictsWithRemainingCandidates, removedRowIds])

  const visibleConflicts = useMemo(
    () => conflictsWithRemainingCandidates.filter((conflict) => conflict.candidates.length > 1),
    [conflictsWithRemainingCandidates],
  )

  useEffect(() => {
    setConflictSelections((currentSelections) => {
      const nextSelections = filterConflictSelections(visibleConflicts, currentSelections)
      return areSameSelectionMap(currentSelections, nextSelections) ? currentSelections : nextSelections
    })
  }, [visibleConflicts])

  useEffect(() => {
    if (requestState !== 'success' || resolvedRows.length === 0) {
      setReviewRows([])
      replaceCandidates({})
      setExpandedRowId(null)
      setResolveStatus('idle')
      return
    }

    let isCancelled = false
    const mergedState = mergeResolvedRowsWithExistingReviewRows(resolvedRows, reviewRows, instrumentCandidatesByRowId)
    const unresolvedRows = resolvedRows.filter((row) => !mergedState.candidatesByRowId[row.id])

    setReviewRows(mergedState.rows)
    replaceCandidates(mergedState.candidatesByRowId)
    setExpandedRowId((current) => (current && mergedState.candidatesByRowId[current]?.length > 1 ? current : null))

    if (unresolvedRows.length === 0) {
      setResolveStatus('success')
      return
    }

    setResolveStatus('loading')

    void resolveInstrumentRows(unresolvedRows)
      .then((result) => {
        if (isCancelled) {
          return
        }

        const resolvedRowsById = new Map(result.rows.map((row) => [row.id, row]))
        const nextRows = mergedState.rows.map((row) => {
          const resolvedRow = resolvedRowsById.get(row.id)
          const candidates = result.candidatesByRowId[row.id] ?? mergedState.candidatesByRowId[row.id] ?? []
          const firstCandidate = candidates[0]
          const manuallyRequired = !hasResolvedIdentifier(resolvedRow ?? row) && candidates.length === 0

          return {
            ...(resolvedRow ? toReviewRow(resolvedRow) : row),
            selectedCandidateId: !hasResolvedIdentifier(resolvedRow ?? row) && firstCandidate ? firstCandidate.id : row.selectedCandidateId ?? null,
            resolutionState: manuallyRequired ? 'manual-required' : 'resolved',
          } satisfies OcrReviewRow
        })

        setReviewRows(nextRows)
        replaceCandidates({
          ...mergedState.candidatesByRowId,
          ...result.candidatesByRowId,
        })
        setExpandedRowId((current) => {
          const nextCandidatesByRowId = {
            ...mergedState.candidatesByRowId,
            ...result.candidatesByRowId,
          }
          return current && nextCandidatesByRowId[current]?.length > 1 ? current : null
        })
        setResolveStatus('success')
      })
      .catch((error) => {
        if (isCancelled) {
          return
        }

        setReviewRows(mergedState.rows)
        replaceCandidates(mergedState.candidatesByRowId)
        setExpandedRowId((current) => (current && mergedState.candidatesByRowId[current]?.length > 1 ? current : null))
        setResolveStatus('error', error instanceof Error ? error.message : '종목 식별자 확인에 실패했어요.')
      })

    return () => {
      isCancelled = true
    }
  }, [instrumentCandidatesByRowId, replaceCandidates, requestState, resolvedRows, reviewRows, setResolveStatus, setReviewRows])

  const previewRows = useMemo(() => {
    const baseRows = requestState === 'success' ? reviewRows : reviewRows.length > 0 ? reviewRows : resolvedRows.map(toReviewRow)

    return baseRows.map((row) =>
      applyReviewCandidate(
        row,
        instrumentCandidatesByRowId[row.id]?.find((candidate) => candidate.id === row.selectedCandidateId),
      ),
    )
  }, [instrumentCandidatesByRowId, requestState, resolvedRows, reviewRows])

  const completedUploadCount = useMemo(
    () => session?.uploads.filter((upload) => uploadStatuses[upload.id]?.state === 'success').length ?? 0,
    [session?.uploads, uploadStatuses],
  )

  const unresolvedConflictCount = useMemo(
    () => visibleConflicts.filter((conflict) => !conflictSelections[conflict.key]).length,
    [conflictSelections, visibleConflicts],
  )
  const invalidManualRowIds = useMemo(
    () => previewRows.filter((row) => row.resolutionState === 'manual-required' && !isManualRowComplete(row)).map((row) => row.id),
    [previewRows],
  )

  const summaryText = useMemo(() => {
    if (requestState === 'loading') {
      return `${completedUploadCount}/${session?.uploads.length ?? 0}장 분석 완료`
    }

    if (requestState === 'success') {
      if (visibleConflicts.length > 0 && unresolvedConflictCount > 0) {
        return `${previewRows.length}행 정리됨 · 충돌 ${unresolvedConflictCount}건 선택 필요`
      }

      if (instrumentResolveState === 'loading') {
        return `${previewRows.length}개 종목 정리 완료 · 식별자 확인 중`
      }

      if (instrumentResolveState === 'error') {
        return `${previewRows.length}개 종목 정리 완료 · 식별자 확인 재시도 필요`
      }

      return `${previewRows.length}개 종목 정리 완료`
    }

    if (requestState === 'error') {
      return '일부 결과를 다시 확인해야 해요'
    }

    return '업로드된 스크린샷을 준비 중이에요'
  }, [completedUploadCount, instrumentResolveState, previewRows.length, requestState, session?.uploads.length, unresolvedConflictCount, visibleConflicts.length])

  const canContinue =
    requestState === 'success'
    && instrumentResolveState === 'success'
    && unresolvedConflictCount === 0
    && previewRows.length > 0
    && invalidManualRowIds.length === 0

  const handleManualFieldChange = useCallback((rowId: string, field: ManualEditableField, value: string) => {
    const currentRow = reviewRows.find((row) => row.id === rowId)

    if (!currentRow) {
      return
    }

    const normalizedValue = value.trim()
    const nextRow: OcrReviewRow = {
      ...currentRow,
      name: field === 'name' ? value : currentRow.name,
      resolvedName: field === 'name' ? value.trim() || currentRow.resolvedName : currentRow.resolvedName,
      resolvedTicker: field === 'resolvedTicker' ? normalizedValue || undefined : currentRow.resolvedTicker,
      resolvedCode: field === 'resolvedCode' ? normalizedValue || undefined : currentRow.resolvedCode,
      resolvedMarket: field === 'resolvedMarket' ? normalizedValue || undefined : currentRow.resolvedMarket,
      resolvedKind:
        field === 'resolvedKind'
          ? normalizedValue === 'stock' || normalizedValue === 'etf'
            ? normalizedValue
            : undefined
          : currentRow.resolvedKind,
      quantity: field === 'quantity' ? value : currentRow.quantity,
      profitRate: field === 'profitRate' ? value : currentRow.profitRate,
      evaluationAmount: field === 'evaluationAmount' ? value : currentRow.evaluationAmount,
    }

    nextRow.resolvedMarketTone = inferMarketTone(nextRow.resolvedMarket)
    nextRow.averagePrice = computeAveragePrice(nextRow.quantity, nextRow.profitRate, nextRow.evaluationAmount)
    nextRow.resolutionState = isManualRowComplete(nextRow) ? 'resolved' : 'manual-required'
    patchReviewRow(rowId, nextRow)
  }, [patchReviewRow, reviewRows])

  const handleContinue = () => {
    if (!canContinue || !session) {
      return
    }

    resetMergeState()
    router.push('/merge')
  }

  return (
    <JarooShell title='종목 확인' backHref='/screenshot' showBottomNav={false} mainClassName='space-y-3'>
      <p className='text-[11px] tracking-[0.04em] text-[color:var(--jaroo-muted)]'>인식된 종목을 확인한 뒤 다음 단계로 진행하세요</p>

      {session ? (
        <Card className='overflow-hidden rounded-[24px] border border-[color:var(--jaroo-border)] bg-white shadow-none'>
          <div className='flex items-center gap-3 border-b border-[color:var(--jaroo-border)] px-4 py-3'>
            <div className='relative size-14 overflow-hidden rounded-2xl border border-[color:var(--jaroo-border)] bg-[color:var(--jaroo-secondary)]'>
              <Image src={session.uploads[0]?.imageDataUrl || ''} alt={session.uploads[0]?.fileName || '스크린샷'} fill unoptimized className='object-cover' />
              {session.uploads.length > 1 ? (
                <div className='absolute inset-x-0 bottom-0 bg-black/65 px-1.5 py-1 text-center text-[9px] font-semibold text-white'>
                  +{session.uploads.length - 1}장
                </div>
              ) : null}
            </div>
            <div className='min-w-0 flex-1'>
              <p className='truncate text-[13px] font-medium text-[color:var(--jaroo-ink)]'>{session.uploads.length}장 스크린샷</p>
              <p className='mt-0.5 text-[11px] text-[color:var(--jaroo-muted)]'>{session.broker} 화면 분석</p>
            </div>
            <ScanSearch className='size-4 text-[color:var(--jaroo-primary)]' />
          </div>

          <div className='flex items-center justify-between gap-3 bg-[color:var(--jaroo-secondary)] px-4 py-3'>
            <div className='flex min-w-0 items-center gap-2'>
              <div
                className={cn(
                  'flex size-[18px] items-center justify-center rounded-full',
                  requestState === 'success' && 'bg-[color:var(--jaroo-success-soft)] text-[color:var(--jaroo-success)]',
                  requestState === 'loading' && 'bg-[color:var(--jaroo-accent)] text-[color:var(--jaroo-primary)]',
                  requestState === 'error' && 'bg-[color:var(--jaroo-warning-soft)] text-[#854F0B]',
                  requestState === 'idle' && 'bg-[color:var(--jaroo-secondary)] text-[color:var(--jaroo-muted)]',
                )}
              >
                {requestState === 'loading' ? (
                  <LoaderCircle className='size-3 animate-spin' strokeWidth={2.5} />
                ) : requestState === 'error' ? (
                  <AlertTriangle className='size-3' strokeWidth={2.5} />
                ) : (
                  <Check className='size-3' strokeWidth={2.5} />
                )}
              </div>
              <p className='truncate text-[12px] font-medium text-[color:var(--jaroo-ink)]'>{summaryText}</p>
            </div>
            <p
              className={cn(
                'shrink-0 text-[11px] font-medium',
                requestState === 'success' && 'text-[color:var(--jaroo-success)]',
                requestState === 'loading' && 'text-[color:var(--jaroo-primary)]',
                requestState === 'error' && 'text-[#854F0B]',
                requestState === 'idle' && 'text-[color:var(--jaroo-muted)]',
              )}
            >
              {statusLabel[requestState]}
            </p>
          </div>
        </Card>
      ) : null}

      {session ? (
        <Card className='overflow-hidden rounded-[24px] border border-[color:var(--jaroo-border)] bg-white shadow-none'>
          <div className='border-b border-[color:var(--jaroo-border)] bg-[color:var(--jaroo-secondary)] px-4 py-3'>
            <p className='text-[12px] font-medium text-[color:var(--jaroo-muted)]'>이미지별 분석 상태</p>
          </div>
          <div>
            {session.uploads.map((upload, index) => {
              const status = uploadStatuses[upload.id] ?? { state: 'idle', rowCount: 0, errorMessage: '' }

              return (
                <div
                  key={upload.id}
                  className={cn(
                    'grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3',
                    index < session.uploads.length - 1 && 'border-b border-[color:var(--jaroo-border)]',
                  )}
                >
                  <div className='relative size-11 overflow-hidden rounded-[14px] border border-[color:var(--jaroo-border)] bg-[color:var(--jaroo-secondary)]'>
                    <Image src={upload.imageDataUrl} alt={upload.fileName} fill unoptimized className='object-cover' />
                  </div>
                  <div className='min-w-0'>
                    <p className='truncate text-[12px] font-medium text-[color:var(--jaroo-ink)]'>{index + 1}. {upload.fileName}</p>
                    <p className='mt-0.5 truncate text-[10px] text-[color:var(--jaroo-muted)]'>
                      {status.state === 'success'
                        ? `${status.rowCount}개 종목 인식`
                        : status.state === 'error'
                          ? status.errorMessage
                          : '대기 중'}
                    </p>
                  </div>
                  <span
                    className={cn(
                      'rounded-full px-2 py-1 text-[10px] font-semibold',
                      status.state === 'success' && 'bg-[color:var(--jaroo-success-soft)] text-[color:var(--jaroo-success)]',
                      status.state === 'loading' && 'bg-[color:var(--jaroo-accent)] text-[color:var(--jaroo-primary)]',
                      status.state === 'error' && 'bg-[color:var(--jaroo-warning-soft)] text-[#854F0B]',
                      status.state === 'idle' && 'bg-[color:var(--jaroo-secondary)] text-[color:var(--jaroo-muted)]',
                    )}
                  >
                    {status.state === 'loading' ? '진행중' : uploadStateLabel[status.state]}
                  </span>
                </div>
              )
            })}
          </div>
        </Card>
      ) : null}

      {visibleConflicts.length > 0 ? (
        <section className='space-y-3'>
          <div className='rounded-[20px] border border-[#FAC775] bg-[color:var(--jaroo-warning-soft)] px-4 py-3'>
            <p className='text-[12px] font-semibold text-[#854F0B]'>충돌 머지 확인</p>
            <p className='mt-1 text-[11px] leading-5 text-[#8A6520]'>중복 종목 {visibleConflicts.length}건 중 {unresolvedConflictCount}건이 아직 선택되지 않았어요.</p>
          </div>

          {visibleConflicts.map((conflict) => (
            <OcrConflictMergeCard
              key={conflict.key}
              conflict={conflict}
              selectedCandidateId={conflictSelections[conflict.key]}
              onSelect={(candidateId) =>
                setConflictSelections((current) => ({
                  ...current,
                  [conflict.key]: candidateId,
                }))
              }
            />
          ))}
        </section>
      ) : null}

      <Card className='overflow-hidden rounded-[24px] border border-[color:var(--jaroo-border)] bg-white shadow-none'>
        <div className='border-b border-[color:var(--jaroo-border)] bg-[color:var(--jaroo-secondary)] px-4 py-3'>
          <p className='text-[11px] font-medium text-[color:var(--jaroo-muted)]'>종목명과 식별자(name/ticker/code/market), 보유 수량, 수익률, 평가 금액, 평균 단가를 함께 확인하세요. 후보가 여러 개인 카드만 추천 후보를 펼칠 수 있어요.</p>
        </div>

        {requestState === 'loading' ? (
          <div className='flex flex-col items-center justify-center gap-3 px-4 py-10 text-center'>
            <LoaderCircle className='size-5 animate-spin text-[color:var(--jaroo-primary)]' />
            <div>
              <p className='text-[13px] font-medium text-[color:var(--jaroo-ink)]'>OCR 분석 중</p>
              <p className='mt-1 text-[11px] text-[color:var(--jaroo-muted)]'>여러 스크린샷에서 종목명, 보유 수량, 수익률, 평가 금액을 순서대로 추출하고 있어요.</p>
            </div>
          </div>
        ) : null}

        {requestState !== 'loading' && previewRows.length > 0 ? (
          <div>
            {previewRows.map((item, index) => {
              const isLast = index === previewRows.length - 1

              return (
                <OcrResolvedRowCard
                  key={`${item.id}-${index}`}
                  row={item}
                  isLast={isLast}
                  identifierStatus={instrumentResolveState}
                  candidates={instrumentCandidatesByRowId[item.id] ?? []}
                  isExpanded={expandedRowId === item.id}
                  selectedCandidateId={item.selectedCandidateId ?? undefined}
                  onToggleExpand={() => setExpandedRowId((current) => (current === item.id ? null : item.id))}
                  onSelectCandidate={(candidateId) => selectCandidate(item.id, candidateId)}
                  onClearCandidateSelection={() =>
                    selectCandidate(item.id, null)
                  }
                  onManualFieldChange={(field, value) => handleManualFieldChange(item.id, field, value)}
                  onRemoveRow={() => {
                    setRemovedRowIds((current) => ({ ...current, [item.id]: true }))
                    removeReviewRow(item.id)
                    if (expandedRowId === item.id) {
                      setExpandedRowId(null)
                    }
                  }}
                />
              )
            })}
          </div>
        ) : null}

        {requestState !== 'loading' && previewRows.length === 0 ? (
          <div className='px-4 py-8 text-center'>
            <p className='text-[13px] font-medium text-[color:var(--jaroo-ink)]'>인식된 종목이 없어요</p>
            <p className='mt-1 text-[11px] text-[color:var(--jaroo-muted)]'>종목 목록이 보이도록 스크린샷을 다시 선택해보세요.</p>
          </div>
        ) : null}
      </Card>

      {requestState === 'success' && instrumentResolveState === 'error' ? (
        <div className='flex items-start gap-2 rounded-[20px] border border-[#FAC775] bg-[color:var(--jaroo-warning-soft)] px-4 py-3 text-[#854F0B]'>
          <AlertTriangle className='mt-0.5 size-4 shrink-0' />
          <p className='text-[12px] leading-6'>{instrumentResolveError || '종목 식별자 확인에 실패했어요. OCR 다시 시도하기로 새로 분석해주세요.'}</p>
        </div>
      ) : null}

      {requestState === 'error' ? (
        <div className='flex items-start gap-2 rounded-[20px] border border-[#FAC775] bg-[color:var(--jaroo-warning-soft)] px-4 py-3 text-[#854F0B]'>
          <AlertTriangle className='mt-0.5 size-4 shrink-0' />
          <p className='text-[12px] leading-6'>{errorMessage || '세션 정보가 없거나 OCR 응답이 유효하지 않았어요. 다시 업로드한 뒤 재시도해주세요.'}</p>
        </div>
      ) : null}

      {requestState !== 'loading' && session ? (
        <Button
          type='button'
          variant='outline'
          onClick={() => void runOcrBatch(session)}
          className='h-12 w-full rounded-[20px] border-[color:#B5D4F4] bg-[color:var(--jaroo-accent)] text-[13px] font-medium text-[color:var(--jaroo-primary)] shadow-none hover:bg-[#d9eafb]'
        >
          <span className='flex items-center gap-2'>
            <RefreshCcw className='size-4' />
            OCR 다시 시도하기
          </span>
        </Button>
      ) : null}

      <button
        type='button'
        onClick={() => {
          clearUploadInput()
          resetReviewState()
          router.push('/screenshot')
        }}
        className='flex items-center justify-center gap-2 rounded-[20px] border border-[#B5D4F4] bg-[color:var(--jaroo-accent)] px-4 py-3 text-center text-[12px] font-medium text-[color:var(--jaroo-primary)] transition hover:bg-[#d9eafb]'
      >
        <ScanSearch className='size-4' />
        <span>스크린샷 다시 선택하기</span>
      </button>

      <Button
        type='button'
        onClick={handleContinue}
        disabled={!canContinue}
        className='h-12 w-full rounded-[20px] bg-[color:var(--jaroo-primary)] text-[14px] font-medium text-white hover:bg-[color:var(--jaroo-primary-strong)] disabled:opacity-45'
      >
        <span className='flex items-center gap-2'>
          <ArrowRight className='size-4' />
          분석 시작하기
        </span>
      </Button>

      <p className='text-center text-[10px] text-[#b8c0cb]'>개인정보는 분석 후 즉시 안전하게 파기됩니다</p>
    </JarooShell>
  )
}
