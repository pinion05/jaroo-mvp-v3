'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  buildOcrSourceRows,
  clearPersistedScreenshotUploadSession,
  computeAveragePrice,
  readPersistedScreenshotUploadSession,
  sanitizeOcrInstrumentCandidateLists,
  sanitizeOcrRows,
  type OcrConflict,
  type OcrRow,
  type OcrSourceRow,
  type ScreenshotUploadSession,
} from '@/lib/screenshot-ocr'
import { resolveIdentifierRowsWithRetry, type OcrIdentifierResolutionResult } from '@/lib/ocr-identifier-resolution'
import { buildHomeCurrentQuoteQuery } from '@/lib/home-current-quotes'
import { hydratePortfolioItemsWithCurrentQuotes } from '@/lib/home-quote-bootstrap'
import { aggregateResolvedOcrReviewRows, type AggregatedOcrReviewRow } from '@/lib/ocr-review-aggregation'
import { buildMergeRowsFromReviewRows, persistAppliedPortfolioFromMergeRows } from '@/lib/ocr-portfolio-apply'
import { syncPortfolioToServer } from '@/lib/portfolio-sync'
import { useMergeStore } from '@/lib/stores/use-merge-store'
import { useOcrReviewStore } from '@/lib/stores/use-ocr-review-store'
import { useOcrUploadStore } from '@/lib/stores/use-ocr-upload-store'
import { usePortfolioStore } from '@/lib/stores/use-portfolio-store'
import {
  applyInstrumentResolutionFailure,
  applyInstrumentResolutionResult,
  applyReviewCandidate,
  getRowsNeedingInstrumentResolution,
  mergeResolvedRowsWithExistingReviewRows,
  toReviewRow,
} from '@/lib/ocr-review-resolution'
import type { OcrReviewRow } from '@/lib/workflow-types'

type OcrRequestState = 'idle' | 'loading' | 'success' | 'error'
type UploadRequestState = 'idle' | 'loading' | 'success' | 'error'
type InstrumentResolveState = 'idle' | 'loading' | 'success' | 'error'

type ResolveInstrumentsResponse = {
  rows?: unknown
  candidates?: unknown
  error?: string
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

const MIN_IDENTIFIER_SEARCH_RING_MS = 900

function waitForMinimumIdentifierSearchRing(startedAt: number) {
  const remainingMs = MIN_IDENTIFIER_SEARCH_RING_MS - (Date.now() - startedAt)

  if (remainingMs <= 0) {
    return Promise.resolve()
  }

  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, remainingMs)
  })
}

function toUserFacingOcrErrorMessage(message: string) {
  if (/key limit exceeded|rate limit|quota|insufficient credits|credit limit|openrouter\\.ai/i.test(message)) {
    return 'OCR 사용량 한도를 초과했어요. 잠시 후 다시 시도하거나 관리자에게 문의해주세요.'
  }

  return message || '스크린샷 확인 중 문제가 발생했어요.'
}

function buildOcrSessionRunKey(session: ScreenshotUploadSession) {
  return [
    session.broker,
    ...session.uploads.map((upload) => `${upload.id}:${upload.fileName}:${upload.imageDataUrl.length}`),
  ].join('|')
}

async function resolveInstrumentRows(rows: OcrSourceRow[]): Promise<OcrIdentifierResolutionResult> {
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
    throw new Error(payload?.error || '종목 확인에 실패했어요.')
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

function OcrResultDesignStyles() {
  return (
    <style>{`
      .jaroo-ocr-page *{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,'Pretendard',sans-serif;-webkit-font-smoothing:antialiased}
      .jaroo-ocr-page{background:#e8e8e8;display:flex;justify-content:center;gap:16px;flex-wrap:wrap;padding:20px;min-height:100vh;min-height:100dvh;align-items:flex-start;color:#0F1419}
      @media (min-width:1024px){.jaroo-ocr-page{margin-left:-7rem}}
      .jaroo-ocr-frame{background:#F5F6F8;border-radius:16px;width:340px;height:720px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.12);position:relative;display:flex;flex-direction:column}
      .jaroo-ocr-frame::-webkit-scrollbar{display:none}
      .jaroo-ocr-head{position:relative;z-index:10;flex:0 0 auto;background:rgba(245,246,248,.94);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);padding:14px 16px;border-bottom:.5px solid #E8EAEE;display:flex;align-items:center;gap:11px}
      .jaroo-ocr-head-back{width:28px;height:28px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;font-size:14px;color:#0F1419;box-shadow:0 1px 2px rgba(0,0,0,.04);border:0;cursor:pointer}
      .jaroo-ocr-head-title{font-size:15px;font-weight:600;color:#0F1419}
      .jaroo-ocr-body{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;padding:18px 16px 24px}
      .jaroo-ocr-body::-webkit-scrollbar{display:none}
      .jaroo-ocr-lead{font-size:13px;color:#5A6473;line-height:1.5;margin-bottom:16px}
      .jaroo-ocr-lead b{color:#0F1419;font-weight:600}
      .jaroo-ocr-ok-card{background:#fff;border-radius:14px;border:.5px solid #E8EAEE;box-shadow:0 1px 3px rgba(0,0,0,.04);overflow:hidden;margin-bottom:12px}
      .jaroo-ocr-ok-head{display:flex;align-items:center;gap:10px;padding:14px 16px;border:0;background:transparent;width:100%;text-align:left;cursor:pointer}
      .jaroo-ocr-ok-check{width:22px;height:22px;border-radius:50%;background:#E5F3EB;display:flex;align-items:center;justify-content:center;font-size:12px;color:#1A7340;flex-shrink:0}
      .jaroo-ocr-ok-title{flex:1;font-size:13.5px;font-weight:600;color:#0F1419}
      .jaroo-ocr-ok-names{font-size:11px;color:#97A0AE;margin-top:2px;font-weight:400;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:225px}
      .jaroo-ocr-ok-arrow{font-size:11px;color:#97A0AE;transition:transform .25s}
      .jaroo-ocr-ok-card.open .jaroo-ocr-ok-arrow{transform:rotate(180deg)}
      .jaroo-ocr-ok-list{max-height:0;overflow:hidden;transition:max-height .35s ease}
      .jaroo-ocr-ok-card.open .jaroo-ocr-ok-list{max-height:9999px;border-top:.5px solid #EFF1F4}
      .jaroo-ocr-ok-row{display:flex;align-items:flex-start;padding:12px 16px;border-bottom:.5px solid #EFF1F4;gap:10px}
      .jaroo-ocr-ok-row:last-child{border-bottom:none}
      .jaroo-ocr-okr-info{flex:1;min-width:0}
      .jaroo-ocr-okr-name{font-size:13px;font-weight:600;color:#0F1419;line-height:1.25}
      .jaroo-ocr-merge-badge{font-size:9px;font-weight:600;color:#2B6BE6;background:#E6F0FE;padding:2px 6px;border-radius:5px;margin-left:5px;vertical-align:middle}
      .jaroo-ocr-acct-detail{margin-top:6px;padding-top:6px;border-top:.5px dashed #E8EAEE}
      .jaroo-ocr-acct-row{display:flex;justify-content:space-between;gap:8px;font-size:10px;color:#97A0AE;padding:2px 0}
      .jaroo-ocr-acct-row span:last-child{color:#5A6473;font-variant-numeric:tabular-nums;white-space:nowrap}
      .jaroo-ocr-okr-meta{font-size:10.5px;color:#97A0AE;margin-top:2px;line-height:1.35}
      .jaroo-ocr-okr-right{text-align:right;flex-shrink:0}
      .jaroo-ocr-okr-amt{font-size:12.5px;font-weight:600;color:#0F1419;font-variant-numeric:tabular-nums;white-space:nowrap}
      .jaroo-ocr-okr-rate{font-size:11px;margin-top:1px;font-variant-numeric:tabular-nums}
      .jaroo-ocr-okr-rate.up{color:#1A9D55}.jaroo-ocr-okr-rate.down{color:#E5484D}
      .jaroo-ocr-okr-edit{font-size:10.5px;color:#2B6BE6;margin-top:3px;cursor:pointer;border:0;background:transparent}
      .jaroo-ocr-edit-panel{border-top:.5px solid #EFF1F4;background:#F8FAFD;padding:12px 14px}
      .jaroo-ocr-edit-title{font-size:11.5px;font-weight:700;color:#0F1419;margin-bottom:9px}
      .jaroo-ocr-edit-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
      .jaroo-ocr-edit-field{display:flex;flex-direction:column;gap:4px;min-width:0}
      .jaroo-ocr-edit-field.full{grid-column:1 / -1}
      .jaroo-ocr-edit-field span{font-size:9.5px;font-weight:600;color:#97A0AE}
      .jaroo-ocr-edit-field input,.jaroo-ocr-edit-field select{width:100%;border:.5px solid #DDE3EA;border-radius:9px;background:#fff;padding:8px 9px;font-size:11.5px;color:#0F1419;outline:none}
      .jaroo-ocr-edit-field input:focus,.jaroo-ocr-edit-field select:focus{border-color:#2B6BE6;box-shadow:0 0 0 2px rgba(43,107,230,.10)}
      .jaroo-ocr-edit-actions{display:flex;gap:8px;margin-top:10px}
      .jaroo-ocr-edit-done{flex:1;border:0;border-radius:10px;background:#2B6BE6;color:#fff;font-size:11.5px;font-weight:700;padding:9px;cursor:pointer}
      .jaroo-ocr-edit-remove{border:0;background:transparent;color:#E5484D;font-size:11px;font-weight:600;padding:9px;cursor:pointer}
      .jaroo-ocr-warn-card{background:#fff;border-radius:14px;border:.5px solid #F3D9A0;box-shadow:0 1px 3px rgba(0,0,0,.04);overflow:hidden;margin-bottom:12px}
      .jaroo-ocr-warn-head{display:flex;align-items:center;gap:10px;padding:13px 16px 11px}
      .jaroo-ocr-warn-ico{width:22px;height:22px;border-radius:50%;background:#FCEFD2;display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0}
      .jaroo-ocr-warn-title{flex:1;font-size:13px;font-weight:600;color:#0F1419}
      .jaroo-ocr-warn-body{padding:0 16px 14px}
      .jaroo-ocr-attention-row + .jaroo-ocr-attention-row{margin-top:14px;padding-top:14px;border-top:.5px solid #F2E4C8}
      .jaroo-ocr-warn-read{font-size:11.5px;color:#5A6473;margin-bottom:11px;line-height:1.5}
      .jaroo-ocr-warn-read b{color:#0F1419;font-weight:600}
      .jaroo-ocr-cand-label{font-size:10.5px;color:#97A0AE;margin-bottom:7px}
      .jaroo-ocr-cand{display:flex;align-items:center;gap:10px;padding:11px 12px;border:.5px solid #E8EAEE;border-radius:10px;margin-bottom:7px;cursor:pointer;transition:all .15s;background:#fff;width:100%;text-align:left}
      .jaroo-ocr-cand.sel{border-color:#2B6BE6;background:#F0F6FF}
      .jaroo-ocr-cand-radio{width:16px;height:16px;border-radius:50%;border:1.5px solid #C2C8D0;flex-shrink:0;position:relative}
      .jaroo-ocr-cand.sel .jaroo-ocr-cand-radio{border-color:#2B6BE6}
      .jaroo-ocr-cand.sel .jaroo-ocr-cand-radio::after{content:'';position:absolute;inset:3px;border-radius:50%;background:#2B6BE6}
      .jaroo-ocr-cand-info{flex:1;min-width:0}
      .jaroo-ocr-cand-name{font-size:12.5px;font-weight:600;color:#0F1419}
      .jaroo-ocr-cand-code{font-size:10.5px;color:#97A0AE;margin-top:1px}
      .jaroo-ocr-cand-meta{font-size:10.5px;color:#5A6473;text-align:right;font-variant-numeric:tabular-nums}
      .jaroo-ocr-warn-actions{display:flex;gap:8px;margin-top:4px}
      .jaroo-ocr-warn-search,.jaroo-ocr-warn-skip{flex:1;text-align:center;padding:10px;border-radius:10px;font-size:11.5px;cursor:pointer;background:#fff}
      .jaroo-ocr-warn-search{border:.5px solid #E8EAEE;color:#2B6BE6;font-weight:600}
      .jaroo-ocr-warn-skip{border:0;color:#97A0AE}
      .jaroo-ocr-add-more{display:flex;align-items:center;justify-content:center;gap:7px;padding:12px;border-radius:12px;border:1px dashed #B8C4D4;background:#fff;margin-bottom:12px;cursor:pointer;width:100%}
      .jaroo-ocr-add-more-lbl{font-size:12px;color:#5A6473;font-weight:500}
      .jaroo-ocr-privacy{font-size:10px;color:#97A0AE;text-align:center;margin-top:14px;line-height:1.5}
      .jaroo-ocr-footer{position:relative;z-index:20;flex:0 0 auto;padding:12px 16px 16px;background:#F5F6F8;border-top:.5px solid #E8EAEE;box-shadow:0 -8px 18px rgba(15,20,25,.04)}
      .jaroo-ocr-apply-btn{width:100%;padding:15px;border-radius:13px;border:none;background:#2B6BE6;color:#fff;font-size:14.5px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:7px;box-shadow:0 4px 14px rgba(43,107,230,.3)}
      .jaroo-ocr-apply-btn:disabled{opacity:.45;cursor:default;box-shadow:none}
      .jaroo-ocr-apply-sub{text-align:center;font-size:10.5px;color:#97A0AE;margin-top:8px}
      .jaroo-ocr-load-wrap{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 16px}
      .jaroo-ocr-load-thumb{width:120px;height:150px;border-radius:12px;background:#fff;border:.5px solid #E8EAEE;box-shadow:0 2px 12px rgba(0,0,0,.06);margin-bottom:24px;position:relative;overflow:hidden}
      .jaroo-ocr-load-thumb-line{height:9px;background:#EEF0F3;border-radius:3px;margin:11px 12px}
      .jaroo-ocr-scan-line{position:absolute;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,#2B6BE6,transparent);animation:jarooOcrScan 1.8s ease-in-out infinite;box-shadow:0 0 8px rgba(43,107,230,.6)}
      @keyframes jarooOcrScan{0%{top:8%}50%{top:88%}100%{top:8%}}
      .jaroo-ocr-spinner{width:34px;height:34px;border:3px solid #E8EAEE;border-top-color:#2B6BE6;border-radius:50%;animation:jarooOcrSpin .8s linear infinite;margin-bottom:16px}
      @keyframes jarooOcrSpin{to{transform:rotate(360deg)}}
      .jaroo-ocr-load-txt{font-size:14px;font-weight:600;color:#0F1419;margin-bottom:5px}
      .jaroo-ocr-load-sub{font-size:11.5px;color:#97A0AE}
      .jaroo-ocr-progress{width:180px;height:4px;background:#E8EAEE;border-radius:99px;overflow:hidden;margin-top:14px}
      .jaroo-ocr-progress-fill{height:100%;background:#2B6BE6;border-radius:99px;transition:width .3s ease}
    `}</style>
  )
}

function OcrLoadingPanel({ progressPercent }: { progressPercent: number }) {
  return (
    <div className='jaroo-ocr-load-wrap'>
      <div className='jaroo-ocr-load-thumb'>
        <div className='jaroo-ocr-load-thumb-line' style={{ width: '60%' }} />
        <div className='jaroo-ocr-load-thumb-line' style={{ width: '80%' }} />
        <div className='jaroo-ocr-load-thumb-line' style={{ width: '50%' }} />
        <div className='jaroo-ocr-load-thumb-line' style={{ width: '75%' }} />
        <div className='jaroo-ocr-load-thumb-line' style={{ width: '55%' }} />
        <div className='jaroo-ocr-load-thumb-line' style={{ width: '70%' }} />
        <div className='jaroo-ocr-scan-line' />
      </div>
      <div className='jaroo-ocr-spinner' />
      <div className='jaroo-ocr-load-txt'>종목을 읽고 있어요…</div>
      <div className='jaroo-ocr-load-sub'>보통 5초 정도 걸려요</div>
      <div className='jaroo-ocr-progress'>
        <div className='jaroo-ocr-progress-fill' style={{ width: `${progressPercent}%` }} />
      </div>
    </div>
  )
}

function getRowIdentifierMeta(row: OcrReviewRow | AggregatedOcrReviewRow) {
  const identifier = row.resolvedCode?.trim() || row.resolvedTicker?.trim()
  return [row.resolvedMarket?.trim(), identifier, row.quantity ? `${row.quantity}` : '', row.averagePrice ? `평단 ${row.averagePrice}` : '']
    .filter(Boolean)
    .join(' · ')
}

function getProfitRateClass(value: string) {
  const trimmed = value.trim()

  if (!trimmed || trimmed === '-') {
    return ''
  }

  return !trimmed.startsWith('-') && !trimmed.startsWith('−') ? 'up' : 'down'
}

export default function OcrPage() {
  const router = useRouter()
  const uploadStoreSession = useOcrUploadStore((state) => state.input)
  const setUploadInput = useOcrUploadStore((state) => state.setInput)
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
  const setMergeRows = useMergeStore((state) => state.setRows)
  const applyStatus = useMergeStore((state) => state.applyStatus)
  const applyError = useMergeStore((state) => state.errorMessage ?? '')
  const setApplyStatus = useMergeStore((state) => state.setApplyStatus)
  const markApplied = useMergeStore((state) => state.markApplied)
  const replacePortfolioItems = usePortfolioStore((state) => state.replaceItems)
  const setQuoteStatus = usePortfolioStore((state) => state.setQuoteStatus)
  const [uploadStatuses, setUploadStatuses] = useState<Record<string, UploadStatus>>({})
  const [baseMergedRows, setBaseMergedRows] = useState<OcrSourceRow[]>([])
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null)
  const [isOkCardOpen, setIsOkCardOpen] = useState(false)
  const [conflicts, setConflicts] = useState<OcrConflict[]>([])
  const [conflictSelections, setConflictSelections] = useState<Record<string, string>>({})
  const [removedRowIds, setRemovedRowIds] = useState<Record<string, true>>({})
  const [persistedUploadSession, setPersistedUploadSession] = useState<ScreenshotUploadSession | null>(null)
  const [hasCheckedPersistedUploadSession, setHasCheckedPersistedUploadSession] = useState(false)
  const ocrRunIdRef = useRef(0)
  const autoOcrSessionKeyRef = useRef<string | null>(null)
  const isLeavingAfterApplyRef = useRef(false)
  const session = uploadStoreSession ?? persistedUploadSession

  useEffect(() => {
    if (!hasCheckedPersistedUploadSession) {
      return
    }

    if (!session) {
      autoOcrSessionKeyRef.current = null
      setRequestStatus('idle')
      setResolveStatus('idle')
      setUploadStatuses({})
      if (!isLeavingAfterApplyRef.current) {
        router.replace('/screenshot')
      }
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
  }, [hasCheckedPersistedUploadSession, router, session, setRequestStatus, setResolveStatus])

  useEffect(() => {
    if (uploadStoreSession) {
      setPersistedUploadSession(uploadStoreSession)
      setHasCheckedPersistedUploadSession(true)
      return
    }

    const restoredSession = readPersistedScreenshotUploadSession()

    if (!restoredSession) {
      setPersistedUploadSession(null)
      setHasCheckedPersistedUploadSession(true)
      return
    }

    setPersistedUploadSession(restoredSession)
    setUploadInput(restoredSession)
    setHasCheckedPersistedUploadSession(true)
  }, [setUploadInput, uploadStoreSession])

  const runOcrBatch = useCallback(async (currentSession: ScreenshotUploadSession) => {
    const runId = ocrRunIdRef.current + 1
    ocrRunIdRef.current = runId
    const isCurrentRun = () => ocrRunIdRef.current === runId

    resetReviewState()
    resetMergeState()
    setRequestStatus('loading')
    setResolveStatus('idle')
    setBaseMergedRows([])
    setExpandedRowId(null)
    setIsOkCardOpen(false)
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
          throw new Error(payload?.error || '스크린샷 확인에 실패했어요.')
        }

        if (!isCurrentRun()) {
          return
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
        if (!isCurrentRun()) {
          return
        }

        hasErrors = true
        nextRowsByUpload[upload.id] = []

        setUploadStatuses((current) => ({
          ...current,
          [upload.id]: {
            state: 'error',
            rowCount: 0,
            errorMessage: toUserFacingOcrErrorMessage(error instanceof Error ? error.message : ''),
          },
        }))
      }
    }

    if (!isCurrentRun()) {
      return
    }

    const sourceRows = buildOcrSourceRows(currentSession.uploads, nextRowsByUpload)
    const rowsPreservingAccountVariants = sourceRows.sort((left, right) => left.uploadIndex - right.uploadIndex || left.rowIndex - right.rowIndex)
    setBaseMergedRows(rowsPreservingAccountVariants)
    setConflicts([])
    setReviewRows(rowsPreservingAccountVariants.map(toReviewRow))
    setConflictSelections({})

    if (hasErrors) {
      setRequestStatus('error', '일부 스크린샷 분석에 실패했어요. 실패한 항목을 확인하고 다시 시도해주세요.')
      return
    }

    setRequestStatus('success')
  }, [resetMergeState, resetReviewState, setRequestStatus, setResolveStatus, setReviewRows])

  useEffect(() => {
    if (!session) {
      return
    }

    const sessionRunKey = buildOcrSessionRunKey(session)
    if (autoOcrSessionKeyRef.current === sessionRunKey) {
      return
    }

    autoOcrSessionKeyRef.current = sessionRunKey
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
    return baseMergedRows.filter((row) => !removedRowIds[row.id]).sort(
      (left, right) => left.uploadIndex - right.uploadIndex || left.rowIndex - right.rowIndex,
    )
  }, [baseMergedRows, removedRowIds])

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
      setIsOkCardOpen(false)
      setResolveStatus('idle')
      return
    }

    let isCancelled = false
    const mergedState = mergeResolvedRowsWithExistingReviewRows(resolvedRows, reviewRows, instrumentCandidatesByRowId)
    const unresolvedRows = getRowsNeedingInstrumentResolution(resolvedRows, mergedState.rows, mergedState.candidatesByRowId)

    setReviewRows(mergedState.rows)
    replaceCandidates(mergedState.candidatesByRowId)
    setExpandedRowId((current) => (current && mergedState.candidatesByRowId[current]?.length > 1 ? current : null))

    if (unresolvedRows.length === 0) {
      const hasFailedRowsAwaitingManualReview = mergedState.rows.some(
        (row) => !mergedState.candidatesByRowId[row.id] && row.resolutionState === 'manual-required',
      )

      if (!hasFailedRowsAwaitingManualReview || useOcrReviewStore.getState().resolveStatus !== 'error') {
        setResolveStatus('success')
      }
      return
    }

    setResolveStatus('loading')
    const resolveStartedAt = Date.now()

    void resolveIdentifierRowsWithRetry(unresolvedRows, resolveInstrumentRows)
      .then(async (result) => {
        await waitForMinimumIdentifierSearchRing(resolveStartedAt)

        if (isCancelled) {
          return
        }

        const nextRows = applyInstrumentResolutionResult(mergedState.rows, result, mergedState.candidatesByRowId)

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
      .catch(async (error) => {
        await waitForMinimumIdentifierSearchRing(resolveStartedAt)

        if (isCancelled) {
          return
        }

        setReviewRows(applyInstrumentResolutionFailure(mergedState.rows))
        replaceCandidates(mergedState.candidatesByRowId)
        setExpandedRowId((current) => (current && mergedState.candidatesByRowId[current]?.length > 1 ? current : null))
        setResolveStatus('error', error instanceof Error ? error.message : '종목 확인에 실패했어요.')
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

  const rowsReadyForApply = useMemo(
    () => previewRows.filter((row) => row.resolutionState === 'resolved'),
    [previewRows],
  )
  const aggregatedRows = useMemo(
    () => aggregateResolvedOcrReviewRows(rowsReadyForApply),
    [rowsReadyForApply],
  )
  const rowsNeedingAttention = useMemo(
    () => previewRows.filter((row) => row.resolutionState !== 'resolved'),
    [previewRows],
  )
  const mergeRowsForApply = useMemo(
    () => buildMergeRowsFromReviewRows(aggregatedRows),
    [aggregatedRows],
  )
  const applicableApplyCount = useMemo(
    () => mergeRowsForApply.filter((row) => row.status !== 'error').length,
    [mergeRowsForApply],
  )

  const processedUploadCount = useMemo(
    () => session?.uploads.filter((upload) => {
      const uploadState = uploadStatuses[upload.id]?.state
      return uploadState === 'success' || uploadState === 'error'
    }).length ?? 0,
    [session?.uploads, uploadStatuses],
  )
  const uploadProgressPercent = session?.uploads.length
    ? Math.round((processedUploadCount / session.uploads.length) * 100)
    : 0
  const visibleUploadProgressPercent = requestState === 'loading'
    ? Math.max(12, uploadProgressPercent)
    : uploadProgressPercent

  const unresolvedConflictCount = useMemo(
    () => visibleConflicts.filter((conflict) => !conflictSelections[conflict.key]).length,
    [conflictSelections, visibleConflicts],
  )
  const invalidManualRowIds = useMemo(
    () => previewRows.filter((row) => row.resolutionState === 'manual-required' && !isManualRowComplete(row)).map((row) => row.id),
    [previewRows],
  )

  const canContinue =
    requestState === 'success'
    && (instrumentResolveState === 'success' || instrumentResolveState === 'error')
    && unresolvedConflictCount === 0
    && applicableApplyCount > 0
    && invalidManualRowIds.length === 0
    && applyStatus !== 'loading'

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
    nextRow.averagePrice = computeAveragePrice(nextRow.quantity, nextRow.profitRate, nextRow.evaluationAmount) || nextRow.averagePrice
    nextRow.resolutionState = isManualRowComplete(nextRow) ? 'resolved' : 'manual-required'
    patchReviewRow(rowId, nextRow)
  }, [patchReviewRow, reviewRows])

  const handleRemoveReviewRow = useCallback((rowId: string) => {
    setRemovedRowIds((current) => ({ ...current, [rowId]: true }))
    removeReviewRow(rowId)
    setExpandedRowId((current) => (current === rowId ? null : current))
  }, [removeReviewRow])

  const handleContinue = () => {
    if (!canContinue || !session) {
      return
    }

    setReviewRows(aggregatedRows)
    setMergeRows(mergeRowsForApply)
    setApplyStatus('loading')

    try {
      const appliedAt = new Date().toISOString()
      const applyResult = persistAppliedPortfolioFromMergeRows(mergeRowsForApply, appliedAt)

      if (!applyResult.persisted || applyResult.normalizedItems.length === 0) {
        throw new Error('포트폴리오에 적용할 종목을 찾지 못했어요.')
      }

      void syncPortfolioToServer(applyResult.persistedRows).then((result) => {
        if (!result.ok) {
          console.warn('portfolio save failed (logged-out or server error)')
        }
      })

      const nextQuoteQuery = buildHomeCurrentQuoteQuery(applyResult.nextQuoteHoldings)
      replacePortfolioItems(applyResult.normalizedItems)
      setQuoteStatus('loading', null, nextQuoteQuery)
      void hydratePortfolioItemsWithCurrentQuotes(applyResult.normalizedItems)
        .then((result) => {
          replacePortfolioItems(result.items)
          setQuoteStatus(result.quoteStatus, result.quoteErrorMessage, result.quoteQuery)
        })
        .catch(() => {
          setQuoteStatus('error', '현재 시세를 불러오지 못했어요. 다시 시도해주세요.', null)
        })
      markApplied(appliedAt)
      isLeavingAfterApplyRef.current = true
      clearPersistedScreenshotUploadSession()
      clearUploadInput()
      router.push('/home')
    } catch (error) {
      setApplyStatus('error', error instanceof Error ? error.message : '포트폴리오 저장에 실패했어요.')
    }
  }

  const isIdentifierResolving = requestState === 'success' && instrumentResolveState === 'loading'
  const hasOcrError = requestState === 'error'
  const uploadErrorMessage = session?.uploads
    .map((upload) => uploadStatuses[upload.id]?.errorMessage)
    .find((message): message is string => Boolean(message))
  const displayErrorMessage = toUserFacingOcrErrorMessage(uploadErrorMessage || errorMessage)
  const recognizedNames = aggregatedRows.map((row) => row.resolvedName || row.name).filter(Boolean).join(' · ')
  const attentionCount = rowsNeedingAttention.length + unresolvedConflictCount
  const canRetry = requestState !== 'loading' && Boolean(session)
  const shouldShowOkList = isOkCardOpen || aggregatedRows.length === 0

  return (
    <div className='jaroo-ocr-page'>
      <OcrResultDesignStyles />
      <div className='jaroo-ocr-frame'>
        <div className='jaroo-ocr-head'>
          <button type='button' className='jaroo-ocr-head-back' onClick={() => router.push('/screenshot')} aria-label='뒤로 가기'>←</button>
          <div className='jaroo-ocr-head-title'>종목 확인</div>
        </div>

        {requestState === 'loading' || isIdentifierResolving ? (
          <OcrLoadingPanel progressPercent={visibleUploadProgressPercent} />
        ) : (
          <div className='jaroo-ocr-body'>
            {hasOcrError ? (
              <div className='jaroo-ocr-lead'><b>스크린샷 분석에 실패했어요.</b><br />다시 시도하거나 다른 이미지를 올려주세요.</div>
            ) : (
              <div className='jaroo-ocr-lead'>
                <b>{session?.uploads.length ?? 0}장</b>에서 종목을 읽어 합쳤어요.<br />대부분 맞으면 바로 적용하면 돼요.
              </div>
            )}

            {!hasOcrError ? (
              <div className={`jaroo-ocr-ok-card ${shouldShowOkList ? 'open' : ''}`}>
                <button
                  type='button'
                  className='jaroo-ocr-ok-head'
                  aria-expanded={shouldShowOkList}
                  onClick={() => {
                    setIsOkCardOpen((current) => !current)
                    setExpandedRowId(null)
                  }}
                >
                  <div className='jaroo-ocr-ok-check'>✓</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className='jaroo-ocr-ok-title'>{aggregatedRows.length}개 종목 인식됐어요</div>
                    <div className='jaroo-ocr-ok-names'>{recognizedNames || '인식된 종목이 없어요'}</div>
                  </div>
                  <div className='jaroo-ocr-ok-arrow'>▼</div>
                </button>
                <div className='jaroo-ocr-ok-list'>
                  {shouldShowOkList && aggregatedRows.length > 0 ? aggregatedRows.map((row, index) => {
                    const accountDetails = row.accountDetails ?? []
                    const isMerged = row.isAccountMerged
                    const editableRowId = row.sourceRowIds[0] ?? row.id
                    const editableRow = previewRows.find((item) => item.id === editableRowId) ?? row
                    const candidates = instrumentCandidatesByRowId[editableRowId] ?? []
                    const selectedId = editableRow.selectedCandidateId ?? candidates[0]?.id
                    const isEditing = expandedRowId === editableRowId

                    return (
                      <div key={`${row.id}-${index}`}>
                        <div className='jaroo-ocr-ok-row'>
                          <div className='jaroo-ocr-okr-info'>
                            <div className='jaroo-ocr-okr-name'>
                              {row.resolvedName || row.name || '-'}
                              {isMerged ? <span className='jaroo-ocr-merge-badge'>{accountDetails.length}개 계좌 합산</span> : null}
                            </div>
                            <div className='jaroo-ocr-okr-meta'>{getRowIdentifierMeta(row)}</div>
                            {isMerged ? (
                              <div className='jaroo-ocr-acct-detail'>
                                {accountDetails.map((detail, detailIndex) => (
                                  <div key={detail.rowId} className='jaroo-ocr-acct-row'>
                                    <span>{detail.sourceFileName || `계좌 ${detailIndex + 1}`}</span>
                                    <span>{detail.quantity} · {detail.evaluationAmount}</span>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                          <div className='jaroo-ocr-okr-right'>
                            <div className='jaroo-ocr-okr-amt'>{row.evaluationAmount || '-'}</div>
                            <div className={`jaroo-ocr-okr-rate ${getProfitRateClass(row.profitRate)}`}>{row.profitRate || '-'}</div>
                            <button
                              type='button'
                              className='jaroo-ocr-okr-edit'
                              aria-expanded={isEditing}
                              onClick={(event) => {
                                event.stopPropagation()
                                setIsOkCardOpen(true)
                                setExpandedRowId((current) => (current === editableRowId ? null : editableRowId))
                              }}
                            >
                              {isEditing ? '닫기' : '수정'}
                            </button>
                          </div>
                        </div>
                        {isEditing ? (
                          <div className='jaroo-ocr-edit-panel'>
                            <div className='jaroo-ocr-edit-title'>{editableRow.resolvedName || editableRow.name || '종목'} 수정</div>
                            {candidates.length > 0 ? (
                              <>
                                <div className='jaroo-ocr-cand-label'>추천 종목</div>
                                {candidates.slice(0, 2).map((candidate) => {
                                  const active = selectedId === candidate.id
                                  const candidateMeta = [candidate.resolvedMarket, candidate.resolvedCode || candidate.resolvedTicker].filter(Boolean).join(' · ')
                                  return (
                                    <button key={candidate.id} type='button' className={`jaroo-ocr-cand ${active ? 'sel' : ''}`} onClick={() => selectCandidate(editableRowId, candidate.id)}>
                                      <div className='jaroo-ocr-cand-radio' />
                                      <div className='jaroo-ocr-cand-info'>
                                        <div className='jaroo-ocr-cand-name'>{candidate.resolvedName}</div>
                                        <div className='jaroo-ocr-cand-code'>{candidateMeta || '정보 확인 중'}</div>
                                      </div>
                                      <div className='jaroo-ocr-cand-meta'>{formatCandidateScore(candidate.score) || '후보'}</div>
                                    </button>
                                  )
                                })}
                              </>
                            ) : null}
                            <div className='jaroo-ocr-edit-grid'>
                              <label className='jaroo-ocr-edit-field full'>
                                <span>종목명</span>
                                <input value={editableRow.name} onChange={(event) => handleManualFieldChange(editableRowId, 'name', event.target.value)} />
                              </label>
                              <label className='jaroo-ocr-edit-field'>
                                <span>Code</span>
                                <input value={editableRow.resolvedCode ?? ''} onChange={(event) => handleManualFieldChange(editableRowId, 'resolvedCode', event.target.value)} />
                              </label>
                              <label className='jaroo-ocr-edit-field'>
                                <span>Ticker</span>
                                <input value={editableRow.resolvedTicker ?? ''} onChange={(event) => handleManualFieldChange(editableRowId, 'resolvedTicker', event.target.value)} />
                              </label>
                              <label className='jaroo-ocr-edit-field'>
                                <span>시장</span>
                                <select value={editableRow.resolvedMarket ?? ''} onChange={(event) => handleManualFieldChange(editableRowId, 'resolvedMarket', event.target.value)}>
                                  <option value=''>선택</option>
                                  <option value='KR'>KR</option>
                                  <option value='KOSPI'>KOSPI</option>
                                  <option value='KOSDAQ'>KOSDAQ</option>
                                  <option value='US'>US</option>
                                </select>
                              </label>
                              <label className='jaroo-ocr-edit-field'>
                                <span>유형</span>
                                <select value={editableRow.resolvedKind ?? ''} onChange={(event) => handleManualFieldChange(editableRowId, 'resolvedKind', event.target.value)}>
                                  <option value=''>선택</option>
                                  <option value='stock'>주식</option>
                                  <option value='etf'>ETF/ETN</option>
                                </select>
                              </label>
                              <label className='jaroo-ocr-edit-field'>
                                <span>수량</span>
                                <input value={editableRow.quantity} onChange={(event) => handleManualFieldChange(editableRowId, 'quantity', event.target.value)} />
                              </label>
                              <label className='jaroo-ocr-edit-field'>
                                <span>수익률</span>
                                <input value={editableRow.profitRate} onChange={(event) => handleManualFieldChange(editableRowId, 'profitRate', event.target.value)} />
                              </label>
                              <label className='jaroo-ocr-edit-field full'>
                                <span>평가 금액</span>
                                <input value={editableRow.evaluationAmount} onChange={(event) => handleManualFieldChange(editableRowId, 'evaluationAmount', event.target.value)} />
                              </label>
                            </div>
                            <div className='jaroo-ocr-edit-actions'>
                              <button type='button' className='jaroo-ocr-edit-done' onClick={() => setExpandedRowId(null)}>수정 완료</button>
                              <button
                                type='button'
                                className='jaroo-ocr-edit-remove'
                                onClick={() => handleRemoveReviewRow(editableRowId)}
                              >
                                제외
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    )
                  }) : null}
                  {shouldShowOkList && aggregatedRows.length === 0 ? (
                    <div className='jaroo-ocr-ok-row'>
                      <div className='jaroo-ocr-okr-info'>
                        <div className='jaroo-ocr-okr-name'>인식된 종목이 없어요</div>
                        <div className='jaroo-ocr-okr-meta'>종목 목록이 보이도록 스크린샷을 다시 선택해보세요.</div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {hasOcrError ? (
              <div className='jaroo-ocr-warn-card'>
                <div className='jaroo-ocr-warn-head'>
                  <div className='jaroo-ocr-warn-ico'>⚠️</div>
                  <div className='jaroo-ocr-warn-title'>분석을 완료하지 못했어요</div>
                </div>
                <div className='jaroo-ocr-warn-body'>
                  <div className='jaroo-ocr-warn-read'>{displayErrorMessage}</div>
                  <div className='jaroo-ocr-warn-actions'>
                    {canRetry ? <button type='button' className='jaroo-ocr-warn-search' onClick={() => session && void runOcrBatch(session)}>다시 확인하기</button> : null}
                    <button
                      type='button'
                      className='jaroo-ocr-warn-skip'
                      onClick={() => {
                        clearPersistedScreenshotUploadSession()
                        clearUploadInput()
                        resetReviewState()
                        router.push('/screenshot')
                      }}
                    >
                      다시 선택
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {!hasOcrError && attentionCount > 0 ? (
              <div className='jaroo-ocr-warn-card'>
                <div className='jaroo-ocr-warn-head'>
                  <div className='jaroo-ocr-warn-ico'>⚠️</div>
                  <div className='jaroo-ocr-warn-title'>{attentionCount}개는 확인이 필요해요</div>
                </div>
                <div className='jaroo-ocr-warn-body'>
                  {rowsNeedingAttention.slice(0, 3).map((row) => {
                    const candidates = instrumentCandidatesByRowId[row.id] ?? []
                    const selectedId = row.selectedCandidateId ?? candidates[0]?.id
                    const isEditing = expandedRowId === row.id
                    return (
                      <div key={row.id} className='jaroo-ocr-attention-row'>
                        <div className='jaroo-ocr-warn-read'>읽은 종목: <b>{row.name || '-'}</b> · {row.quantity || '-'} · {row.averagePrice ? `평단 ${row.averagePrice}` : row.evaluationAmount}</div>
                        {candidates.length > 0 ? <div className='jaroo-ocr-cand-label'>이 종목인가요?</div> : null}
                        {candidates.slice(0, 2).map((candidate) => {
                          const active = selectedId === candidate.id
                          const candidateMeta = [candidate.resolvedMarket, candidate.resolvedCode || candidate.resolvedTicker].filter(Boolean).join(' · ')
                          return (
                            <button key={candidate.id} type='button' className={`jaroo-ocr-cand ${active ? 'sel' : ''}`} onClick={() => selectCandidate(row.id, candidate.id)}>
                              <div className='jaroo-ocr-cand-radio' />
                              <div className='jaroo-ocr-cand-info'>
                                <div className='jaroo-ocr-cand-name'>{candidate.resolvedName}</div>
                                <div className='jaroo-ocr-cand-code'>{candidateMeta || '정보 확인 중'}</div>
                              </div>
                              <div className='jaroo-ocr-cand-meta'>{formatCandidateScore(candidate.score) || '후보'}</div>
                            </button>
                          )
                        })}
                        <div className='jaroo-ocr-warn-actions'>
                          <button
                            type='button'
                            className='jaroo-ocr-warn-search'
                            onClick={() => setExpandedRowId((current) => (current === row.id ? null : row.id))}
                          >
                            {isEditing ? '직접 확인 닫기' : '직접 확인'}
                          </button>
                          <button type='button' className='jaroo-ocr-warn-skip' onClick={() => handleRemoveReviewRow(row.id)}>나중에 추가</button>
                        </div>
                        {isEditing ? (
                          <div className='jaroo-ocr-edit-panel'>
                            <div className='jaroo-ocr-edit-title'>{row.name || '종목'} 직접 확인</div>
                            <div className='jaroo-ocr-edit-grid'>
                              <label className='jaroo-ocr-edit-field full'>
                                <span>종목명</span>
                                <input value={row.name} onChange={(event) => handleManualFieldChange(row.id, 'name', event.target.value)} />
                              </label>
                              <label className='jaroo-ocr-edit-field'>
                                <span>Code</span>
                                <input value={row.resolvedCode ?? ''} onChange={(event) => handleManualFieldChange(row.id, 'resolvedCode', event.target.value)} />
                              </label>
                              <label className='jaroo-ocr-edit-field'>
                                <span>Ticker</span>
                                <input value={row.resolvedTicker ?? ''} onChange={(event) => handleManualFieldChange(row.id, 'resolvedTicker', event.target.value)} />
                              </label>
                              <label className='jaroo-ocr-edit-field'>
                                <span>시장</span>
                                <select value={row.resolvedMarket ?? ''} onChange={(event) => handleManualFieldChange(row.id, 'resolvedMarket', event.target.value)}>
                                  <option value=''>선택</option>
                                  <option value='KR'>KR</option>
                                  <option value='KOSPI'>KOSPI</option>
                                  <option value='KOSDAQ'>KOSDAQ</option>
                                  <option value='US'>US</option>
                                </select>
                              </label>
                              <label className='jaroo-ocr-edit-field'>
                                <span>유형</span>
                                <select value={row.resolvedKind ?? ''} onChange={(event) => handleManualFieldChange(row.id, 'resolvedKind', event.target.value)}>
                                  <option value=''>선택</option>
                                  <option value='stock'>주식</option>
                                  <option value='etf'>ETF/ETN</option>
                                </select>
                              </label>
                              <label className='jaroo-ocr-edit-field'>
                                <span>수량</span>
                                <input value={row.quantity} onChange={(event) => handleManualFieldChange(row.id, 'quantity', event.target.value)} />
                              </label>
                              <label className='jaroo-ocr-edit-field'>
                                <span>수익률</span>
                                <input value={row.profitRate} onChange={(event) => handleManualFieldChange(row.id, 'profitRate', event.target.value)} />
                              </label>
                              <label className='jaroo-ocr-edit-field full'>
                                <span>평가 금액</span>
                                <input value={row.evaluationAmount} onChange={(event) => handleManualFieldChange(row.id, 'evaluationAmount', event.target.value)} />
                              </label>
                            </div>
                            <div className='jaroo-ocr-edit-actions'>
                              <button type='button' className='jaroo-ocr-edit-done' onClick={() => setExpandedRowId(null)}>수정 완료</button>
                              <button type='button' className='jaroo-ocr-edit-remove' onClick={() => handleRemoveReviewRow(row.id)}>제외</button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : null}

            {requestState === 'success' && instrumentResolveState === 'error' ? (
              <div className='jaroo-ocr-warn-card'>
                <div className='jaroo-ocr-warn-head'>
                  <div className='jaroo-ocr-warn-ico'>⚠️</div>
                  <div className='jaroo-ocr-warn-title'>종목 확인에 실패했어요</div>
                </div>
                <div className='jaroo-ocr-warn-body'>
                  <div className='jaroo-ocr-warn-read'>{instrumentResolveError || '일부 종목은 직접 확인해주세요.'}</div>
                </div>
              </div>
            ) : null}

            <button type='button' className='jaroo-ocr-add-more' onClick={() => router.push('/screenshot')}>
              <span style={{ fontSize: 14, color: '#5A6473' }}>＋</span>
              <div className='jaroo-ocr-add-more-lbl'>다른 계좌 있으면 스크린샷 추가</div>
            </button>

            <div className='jaroo-ocr-privacy'>개인정보는 분석 후 즉시 안전하게 파기됩니다</div>
          </div>
        )}

        <div className='jaroo-ocr-footer'>
          <button type='button' className='jaroo-ocr-apply-btn' onClick={handleContinue} disabled={!canContinue}>
            → {applyStatus === 'loading' ? '적용 중...' : `${applicableApplyCount}개 종목 적용하기`}
          </button>
          <div className='jaroo-ocr-apply-sub'>{applyError || '적용하면 홈에서 분석을 시작할 수 있어요'}</div>
        </div>
      </div>
    </div>
  )
}
