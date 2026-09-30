'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import { BackControl } from './deepscan-loading-briefing-card'
import {
  appendSubjectJosa,
  buildHaltHoldingFacts,
  buildHaltSeverityHelperText,
  formatHaltFilingDate,
  HALT_SEVERITY_DISPLAYS,
  resolveHaltMeterColors,
  resolveHaltSeverityDisplay,
  type DeepScanHaltSeverity,
} from '@/lib/deepscan-halt'
import type { DeepScanHaltDisclosuresData } from '@/lib/deepscan-halt'
import { cn } from '@/lib/utils'

import styles from './deepscan-halt-screen.module.css'

// 거래정지 화면(이슈 #276) — 채택 시안 jaroo_halt_min 포팅.
// AI 세 팀 위원회 파트는 거래정지 상황과 맞지 않아 제외하고 공시 기반 "대처" 중심 구성.

type HaltDisclosuresFetchState =
  | { status: 'loading' }
  | { status: 'ready'; data: DeepScanHaltDisclosuresData }
  | { status: 'error' }

export type DeepScanHaltScreenProps = {
  className?: string
  name: string
  code?: string
  identifier: string
  market: string
  lastTradedPrice: number | null
  currency?: string | null
  quantity?: number | null
  averagePrice?: number | null
  averagePriceCurrency?: string | null
  fallbackProfitRatePct?: number | null
  backHref?: string
  onBack?: () => void
}

function resolveSeverityDotClass(severity: DeepScanHaltSeverity) {
  if (severity === 'critical' || severity === 'high') {
    return styles.mrowDotRed
  }
  return severity === 'medium' ? styles.mrowDotAmber : styles.mrowDotGray
}

function resolveSeverityRightLabel(severity: DeepScanHaltSeverity) {
  return severity === 'critical' || severity === 'high' ? '심각' : severity === 'medium' ? '확인 필요' : '일반'
}

export function DeepScanHaltScreen({
  className,
  name,
  code,
  identifier,
  market,
  lastTradedPrice,
  currency,
  quantity,
  averagePrice,
  averagePriceCurrency,
  fallbackProfitRatePct,
  backHref = '/home',
  onBack,
}: DeepScanHaltScreenProps) {
  const [disclosures, setDisclosures] = useState<HaltDisclosuresFetchState>({ status: 'loading' })
  const [watchState, setWatchState] = useState<'idle' | 'saving' | 'done' | 'error'>('idle')

  const loadDisclosures = useCallback((requestCode: string, signal?: AbortSignal) => {
    return fetch(`/api/deepscan/halt?code=${encodeURIComponent(requestCode)}`, { cache: 'no-store', signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`halt disclosures returned HTTP ${response.status}`)
        }
        return (await response.json()) as { ok: true; data: DeepScanHaltDisclosuresData }
      })
      .then((body) => {
        setDisclosures({ status: 'ready', data: body.data })
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === 'AbortError') {
          return
        }
        setDisclosures({ status: 'error' })
      })
  }, [])

  useEffect(() => {
    if (!code) {
      setDisclosures({ status: 'error' })
      return
    }

    setDisclosures({ status: 'loading' })
    const controller = new AbortController()
    void loadDisclosures(code, controller.signal)

    return () => {
      controller.abort()
    }
  }, [code, loadDisclosures])

  const summary = disclosures.status === 'ready' ? disclosures.data.summary : null
  const severityDisplay = summary ? resolveHaltSeverityDisplay(summary.severityLevel) : null
  const severityHelper = summary ? buildHaltSeverityHelperText(summary.severityLevel) : null
  const meterColors = summary ? resolveHaltMeterColors(summary.severityLevel) : []

  const facts = useMemo(() => buildHaltHoldingFacts({
    name,
    lastTradedPrice,
    currency,
    quantity,
    averagePrice,
    averagePriceCurrency,
    fallbackProfitRatePct,
  }), [name, lastTradedPrice, currency, quantity, averagePrice, averagePriceCurrency, fallbackProfitRatePct])

  // 정지 사유 공시 — 심각도 high 이상 공시 중 가장 최근 원문 링크.
  const haltReasonFiling = disclosures.status === 'ready'
    ? disclosures.data.filings.find((filing) => (filing.severity === 'high' || filing.severity === 'critical') && filing.documentUrl) ?? null
    : null
  const hasDelistingSignal = summary ? summary.severityLevel >= 4 : false

  const handleWatchClick = useCallback(async () => {
    if (watchState === 'saving' || watchState === 'done' || !code) {
      return
    }

    setWatchState('saving')
    try {
      const response = await fetch('/api/watch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, name, market }),
      })
      if (!response.ok) {
        throw new Error(`watch returned HTTP ${response.status}`)
      }
      setWatchState('done')
    } catch {
      setWatchState('error')
    }
  }, [code, market, name, watchState])

  const watchButtonText = watchState === 'done' ? '워치 완료' : watchState === 'saving' ? '등록 중…' : '이 종목 워치하기'
  const profitBadgeClass = facts.profitRatePct !== null && facts.profitRatePct < 0
    ? styles.headBadgeDataLoss
    : styles.headBadgeDataProfit

  return (
    <div className={cn(styles.haltScreen, className)}>
      <header className={styles.topBar}>
        <BackControl onBack={onBack} backHref={backHref} />
        <div className={styles.topBarIdentity}>
          <h1 className={styles.topBarName}>{name}</h1>
          <p className={styles.topBarMeta}>{[market, identifier].filter(Boolean).join(' · ')}</p>
        </div>
        <span className={styles.topBarBadge}><i aria-hidden='true' />거래 정지</span>
      </header>

      <div className={styles.main}>
        <section className={styles.hero} aria-label='거래정지 안내'>
          <div className={styles.heroTop}>
            <div>
              <span className={styles.pill}><i aria-hidden='true' />거래정지</span>
              <h2 className={styles.heroTitle}>{appendSubjectJosa(name)}<br />지금 거래가 정지됐어요</h2>
            </div>
            <div className={styles.heroIcon} aria-hidden='true'>
              <svg width='28' height='28' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><path d='m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3' /><path d='M12 9v4' /><path d='M12 17h.01' /></svg>
            </div>
          </div>
          <p className={styles.heroCopy}>세 팀 분석은 거래가 재개된 뒤에 의미가 있어요. 지금은 정지 사유를 확인하고 대처하는 게 우선이에요.</p>
          <div className={styles.heroStats}>
            <div className={cn(styles.hstat, styles.hstatDanger)}><b>정지</b><span>현재 상태</span></div>
            <div className={styles.hstat}>
              <b>{summary ? `${summary.totalCount}건` : '…'}</b>
              <span>최근 90일 공시</span>
            </div>
            <div className={cn(styles.hstat, summary && summary.riskCount > 0 ? styles.hstatDanger : undefined)}>
              <b>{summary ? `${summary.riskCount}건` : '…'}</b>
              <span>중요 리스크</span>
            </div>
          </div>
        </section>

        <article className={styles.card} aria-label='보유 현황'>
          <div className={styles.cardHead}>
            <div className={styles.emoSq} aria-hidden='true'>💼</div>
            <div style={{ flex: 1 }}>
              <p className={styles.cardKicker}>{[name, market, identifier].filter(Boolean).join(' · ')}</p>
              <h3 className={styles.cardTitle}>보유 현황</h3>
            </div>
            {facts.profitRateText ? (
              <span className={cn(styles.headBadge, profitBadgeClass)}>{facts.profitRateText}</span>
            ) : null}
          </div>
          <div className={styles.facts}>
            <div className={styles.fact}>
              <p className={styles.factLabel}>마지막 체결가</p>
              <p className={styles.factValue}>{facts.lastTradedPriceText ?? '확인 중'}</p>
            </div>
            <div className={styles.fact}>
              <p className={styles.factLabel}>평단가</p>
              <p className={styles.factValue}>{facts.averagePriceText ?? '확인 중'}</p>
            </div>
            <div className={styles.fact}>
              <p className={styles.factLabel}>보유 수량</p>
              <p className={styles.factValue}>{facts.quantityText ?? '확인 중'}</p>
            </div>
            <div className={styles.fact}>
              <p className={styles.factLabel}>평가금액</p>
              <p className={cn(styles.factValue, facts.profitRatePct !== null && facts.profitRatePct < 0 ? styles.factValueLoss : styles.factValueProfit)}>
                {facts.evaluationText ?? '확인 중'}
              </p>
            </div>
          </div>
        </article>

        <article className={styles.card} aria-label='심각도'>
          <div className={styles.cardHead}>
            <div className={styles.emoSq} aria-hidden='true'>⚠️</div>
            <div style={{ flex: 1 }}>
              <p className={styles.cardKicker}>공시 기준 판정</p>
              <h3 className={styles.cardTitle}>얼마나 심각한가요</h3>
            </div>
            {severityDisplay ? (
              <span
                className={cn(
                  styles.headBadge,
                  severityDisplay.tone === 'danger' ? styles.headBadge
                    : severityDisplay.tone === 'caution' || severityDisplay.tone === 'attention' ? styles.headBadgeCaution
                      : styles.headBadgeNeutral,
                )}
              >
                {severityDisplay.badge}
              </span>
            ) : null}
          </div>
          {summary && severityDisplay && severityHelper ? (
            <>
              <div className={styles.sev}>
                <p className={cn(
                  styles.sevLabel,
                  severityDisplay.tone === 'danger' ? styles.sevLabelDanger
                    : severityDisplay.tone === 'caution' || severityDisplay.tone === 'attention' ? styles.sevLabelCaution
                      : styles.sevLabelNeutral,
                )}>{severityDisplay.label}</p>
                <div className={styles.sevMeters} aria-hidden='true'>
                  {[0, 1, 2, 3].map((index) => {
                    const isOn = index === severityDisplay.level - 1
                    const color = meterColors[index]
                    return (
                      <i
                        key={index}
                        className={cn(styles.sevMeter, isOn ? styles.sevMeterOn : undefined)}
                        style={color ? { backgroundColor: color, color } : undefined}
                      />
                    )
                  })}
                </div>
                <p className={styles.sevHelper}>{severityHelper}</p>
              </div>
              <p className={styles.summary}>
                {hasDelistingSignal
                  ? '상장폐지·정리매매 신호가 감지됐어요. 상폐 절차로 이어질 수 있는 조합이에요.'
                  : summary.riskCount > 0
                    ? '매매거래정지 등 중요 리스크 공시가 감지됐어요. 추가 공시를 계속 지켜봐야 해요.'
                    : '최근 90일 공시에서 중요 리스크 신호는 아직 없어요.'}
              </p>
              {summary.signals.length > 0 ? (
                <>
                  <p className={styles.rowsTitle}>감지된 신호</p>
                  {summary.signals.map((signal) => (
                    <div key={signal.label} className={styles.mrow}>
                      <span className={cn(styles.mrowDot, resolveSeverityDotClass(signal.severity))} aria-hidden='true' />
                      <span className={styles.mrowLabel}>{signal.label}</span>
                      <span className={styles.mrowRight}>{resolveSeverityRightLabel(signal.severity)}</span>
                    </div>
                  ))}
                </>
              ) : null}
              <p className={styles.disclaimer}>공시 제목 키워드 기반 분류예요. 상폐 여부는 DART 공시 원문으로 최종 확인하세요.</p>
            </>
          ) : (
            <p className={styles.stateRow}>공시 기준 심각도를 분석하고 있어요…</p>
          )}
        </article>

        <article className={styles.card} aria-label='지금 대처'>
          <div className={styles.cardHead}>
            <div className={styles.emoSq} aria-hidden='true'>🚨</div>
            <div style={{ flex: 1 }}>
              <p className={styles.cardKicker}>거래정지 상태</p>
              <h3 className={styles.cardTitle}>지금 대처</h3>
            </div>
            <span className={cn(styles.headBadge, styles.headBadgeBlue)}>3가지</span>
          </div>
          <p className={styles.summary}>정리매매에 들어가면 매도할 수 있는 기간이 정해져요. 그 전에 상황부터 정확히 파악하세요.</p>
          <p className={styles.rowsTitle}>확인 순서</p>
          <div className={styles.act}>
            <div className={cn(styles.actNum, styles.actNumRed)}>1</div>
            <div>
              <p className={styles.actTitle}>정지 사유 공시 확인</p>
              <p className={styles.actDesc}>
                주권매매거래정지 공시에서 사유·기간 확인 —{' '}
                {haltReasonFiling?.documentUrl
                  ? <a className={styles.actDescLink} href={haltReasonFiling.documentUrl} target='_blank' rel='noreferrer'>DART 원문 보기</a>
                  : <a className={styles.actDescLink} href='https://dart.fss.or.kr' target='_blank' rel='noreferrer'>DART 열기</a>}
              </p>
            </div>
          </div>
          <div className={styles.act}>
            <div className={styles.actNum}>2</div>
            <div>
              <p className={styles.actTitle}>상장폐지·정리매매 여부</p>
              <p className={styles.actDesc}>
                {hasDelistingSignal
                  ? '최근 공시에 상폐·정리매매 신호가 감지됐어요 — 원문 확인이 시급해요'
                  : '최근 공시에 상폐·정리매매 신호 없음 — 추가 공시 감시 필요'}
              </p>
            </div>
          </div>
          <div className={styles.act}>
            <div className={styles.actNum}>3</div>
            <div>
              <p className={styles.actTitle}>정리매매 개시 시 매도 검토</p>
              <p className={styles.actDesc}>개시 공시가 뜨면 기간 내 매도 여부를 결정해야 해요</p>
            </div>
          </div>
          <div className={cn(styles.cta, styles.ctaFirst)}>
            <a className={cn(styles.btn, styles.btnOutline)} href='https://dart.fss.or.kr' target='_blank' rel='noreferrer'>전체 공시 보기</a>
            <button
              type='button'
              className={cn(styles.btn, styles.btnPrimary)}
              onClick={() => void handleWatchClick()}
              disabled={watchState === 'saving' || watchState === 'done'}
            >
              {watchState === 'error' ? '다시 시도' : watchButtonText}
            </button>
          </div>
        </article>

        <article className={styles.card} aria-label='공시 확인'>
          <div className={styles.cardHead}>
            <div className={styles.emoSq} aria-hidden='true'>📄</div>
            <div style={{ flex: 1 }}>
              <p className={styles.cardKicker}>최근 90일 공시</p>
              <h3 className={styles.cardTitle}>공시 확인</h3>
            </div>
            {summary && summary.riskCount > 0 ? (
              <span className={styles.headBadge}>중요 {summary.riskCount}건</span>
            ) : summary ? (
              <span className={cn(styles.headBadge, styles.headBadgeNeutral)}>일반</span>
            ) : null}
          </div>
          {disclosures.status === 'loading' ? (
            <p className={styles.stateRow}>공시 목록을 불러오고 있어요…</p>
          ) : disclosures.status === 'error' ? (
            <div className={styles.stateRow}>
              공시 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.
              <br />
              <button type='button' className={styles.retryButton} onClick={() => code && void loadDisclosures(code)}>다시 시도</button>
            </div>
          ) : disclosures.data.filings.length === 0 ? (
            <p className={styles.stateRow}>최근 90일 공시가 없어요.</p>
          ) : (
            <>
              <p className={styles.rowsTitle}>공시 목록</p>
              {disclosures.data.filings.slice(0, 10).map((filing) => (
                <div key={`${filing.receiptDate}-${filing.reportName}`} className={styles.mrow}>
                  <span className={cn(styles.mrowDot, resolveSeverityDotClass(filing.severity))} aria-hidden='true' />
                  <span className={styles.mrowLabel}>{filing.reportName}</span>
                  <span className={styles.mrowSub}>{formatHaltFilingDate(filing.receiptDate) ?? ''}</span>
                  <span className={styles.mrowRight}>
                    {filing.documentUrl
                      ? <a className={styles.mrowLink} href={filing.documentUrl} target='_blank' rel='noreferrer'>원문</a>
                      : '—'}
                  </span>
                </div>
              ))}
              {disclosures.data.filings.length > 10 ? (
                <p className={styles.rowsTitle}>외 {disclosures.data.filings.length - 10}건</p>
              ) : null}
            </>
          )}
          <p className={styles.disclaimer}>AI 분석은 데이터 기반 참고 자료예요. 투자 권유나 수익 보장이 아닙니다.</p>
        </article>
      </div>
    </div>
  )
}
