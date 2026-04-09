'use client'

import Link from 'next/link'
import { useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import {
  homeForecast,
  homeHoldings,
  momentumSignals,
  momentumStages,
  portfolioScoreBreakdown,
  type HomeBadgeTone,
  type HomeHolding,
  type HomeMetricTone,
} from '@/lib/jaroo-home-data'
import styles from './jaroo-home-screen.module.css'

const CX = 105
const CY = 105
const R = 82
const GAP = 0.03

type ViewMode = 'donut' | 'heatmap'
type SheetMode = 'score' | 'momentum' | null

function polar(deg: number, radius: number) {
  const angle = ((deg - 90) * Math.PI) / 180

  return {
    x: CX + radius * Math.cos(angle),
    y: CY + radius * Math.sin(angle),
  }
}

function getArcPath(startPercent: number, percent: number) {
  const startAngle = startPercent * 360
  const endAngle = startAngle + (percent - GAP) * 360
  const startPoint = polar(startAngle, R)
  const endPoint = polar(endAngle, R)
  const largeArc = percent - GAP > 0.5 ? 1 : 0

  return `M${startPoint.x},${startPoint.y} A${R},${R} 0 ${largeArc},1 ${endPoint.x},${endPoint.y}`
}

function badgeToneClass(tone: HomeBadgeTone) {
  switch (tone) {
    case 'red':
      return styles.dcBadgeRed
    case 'green':
      return styles.dcBadgeGreen
    default:
      return styles.dcBadgeAmber
  }
}

function marketToneClass(tone: HomeHolding['marketTone']) {
  switch (tone) {
    case 'kospi':
      return styles.marketKospi
    case 'kosdaq':
      return styles.marketKosdaq
    case 'nasdaq':
      return styles.marketNasdaq
    default:
      return styles.marketEtf
  }
}

function signalToneClass(tone: HomeHolding['signalTone']) {
  switch (tone) {
    case 'danger':
      return styles.signalDanger
    case 'warning':
      return styles.signalWarning
    case 'positive':
      return styles.signalPositive
    case 'halt':
      return styles.signalHalt
    default:
      return styles.signalEtf
  }
}

function metricToneClass(tone: HomeMetricTone) {
  switch (tone) {
    case 'danger':
      return styles.metricDanger
    case 'warning':
      return styles.metricWarning
    case 'positive':
      return styles.metricPositive
    case 'locked':
      return styles.metricLocked
    default:
      return styles.metricNeutral
  }
}

function actionToneClass(item: HomeHolding) {
  if (item.cardTone === 'halt') {
    return styles.buttonRed
  }

  if (item.cardTone === 'profit') {
    return styles.buttonGreen
  }

  return styles.buttonBlue
}

export function JarooHomeScreen() {
  const frameRef = useRef<HTMLDivElement | null>(null)
  const cardRefs = useRef<Record<number, HTMLDivElement | null>>({})
  const [view, setView] = useState<ViewMode>('donut')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [openStockCardId, setOpenStockCardId] = useState<number | null>(null)
  const [isEtfCardOpen, setIsEtfCardOpen] = useState(false)
  const [openSheet, setOpenSheet] = useState<SheetMode>(null)

  const donutLayout = useMemo(() => {
    const result = homeHoldings.reduce<{
      start: number
      layout: Array<{
        id: number
        path: string
        x: number
        y: number
        textWidth: number
      }>
    }>(
      (accumulator, item) => {
        const start = accumulator.start
        const path = getArcPath(start, item.donutPercent)
        const end = start + item.donutPercent
        const startAngle = start * 360
        const endAngle = startAngle + (item.donutPercent - GAP) * 360
        const midpoint = startAngle + (endAngle - startAngle) / 2
        const labelPoint = polar(midpoint, R + 24)
        const textWidth = item.donutLabel.length * 6.2
        const x = Math.max(textWidth / 2 + 6, Math.min(210 - textWidth / 2 - 6, labelPoint.x))
        const y = Math.max(12, Math.min(200, labelPoint.y))

        return {
          start: end,
          layout: [
            ...accumulator.layout,
            {
              id: item.id,
              path,
              x,
              y,
              textWidth,
            },
          ],
        }
      },
      {
        start: -0.5,
        layout: [],
      },
    )

    return result.layout
  }, [])

  const selectedHolding = selectedId === null ? null : homeHoldings.find((item) => item.id === selectedId) ?? null

  function scrollToCard(id: number) {
    const frame = frameRef.current
    const card = cardRefs.current[id]

    if (!frame || !card) {
      return
    }

    window.setTimeout(() => {
      frame.scrollTo({
        top: card.offsetTop - 56,
        behavior: 'smooth',
      })
    }, 80)
  }

  function resetSelection() {
    setSelectedId(null)
    setOpenStockCardId(null)
    setIsEtfCardOpen(false)
  }

  function selectHolding(id: number, shouldScroll = true) {
    if (selectedId === id) {
      resetSelection()
      return
    }

    setSelectedId(id)

    if (id === 4) {
      setOpenStockCardId(null)
      setIsEtfCardOpen(true)
    } else {
      setOpenStockCardId(id)
      setIsEtfCardOpen(false)
    }

    if (shouldScroll) {
      scrollToCard(id)
    }
  }

  function toggleCard(id: number) {
    if (openStockCardId === id && selectedId === id) {
      resetSelection()
      return
    }

    setSelectedId(id)
    setOpenStockCardId(id)
    setIsEtfCardOpen(false)
  }

  function handleHeatmapClick(id: number) {
    if (id === 4) {
      setOpenStockCardId(null)
      setIsEtfCardOpen(true)
    } else {
      setOpenStockCardId(id)
      setIsEtfCardOpen(false)
    }

    scrollToCard(id)
  }

  function toggleEtfCard() {
    setIsEtfCardOpen((current) => !current)
  }

  return (
    <div className={styles.viewport}>
      <div ref={frameRef} className={styles.frame}>
        <div className={styles.topBar}>
          <div className={styles.appName}>Jaroo</div>
          <div className={styles.topIcons}>
            <button type='button' className={styles.iconButton} onClick={() => setOpenSheet('momentum')} aria-label='이번 주 회복 모멘텀 열기'>
              <svg width='14' height='14' viewBox='0 0 14 14' fill='none'>
                <line x1='7' y1='2' x2='7' y2='12' stroke='white' strokeWidth='1.8' strokeLinecap='round' />
                <line x1='2' y1='7' x2='12' y2='7' stroke='white' strokeWidth='1.8' strokeLinecap='round' />
              </svg>
            </button>
            <button type='button' className={styles.iconButton} aria-label='알림'>
              <svg width='14' height='14' viewBox='0 0 14 14' fill='none'>
                <path
                  d='M7 1.5C4.5 1.5 2.5 3.3 2.5 5.5V9L1.5 10.5h11L11.5 9V5.5C11.5 3.3 9.5 1.5 7 1.5Z'
                  stroke='white'
                  strokeWidth='1.4'
                  fill='none'
                />
                <path d='M5.5 10.5C5.5 11.3 6.2 12 7 12s1.5-.7 1.5-1.5' stroke='white' strokeWidth='1.4' fill='none' strokeLinecap='round' />
              </svg>
              <span className={styles.bellDot} />
            </button>
          </div>
        </div>

        <div className={styles.hero}>
          <div className={styles.viewToggle}>
            <button
              type='button'
              className={cn(styles.viewToggleButton, view === 'donut' && styles.viewToggleButtonOn)}
              onClick={() => setView('donut')}
            >
              <svg width='14' height='14' viewBox='0 0 14 14' fill='none' style={{ opacity: 0.9 }}>
                <circle cx='7' cy='7' r='5.5' stroke='white' strokeWidth='1.5' fill='none' />
                <circle cx='7' cy='7' r='2.5' fill='white' />
              </svg>
              비중
            </button>
            <button
              type='button'
              className={cn(styles.viewToggleButton, view === 'heatmap' && styles.viewToggleButtonOn)}
              onClick={() => setView('heatmap')}
            >
              <svg width='14' height='14' viewBox='0 0 14 14' fill='none' style={{ opacity: 0.7 }}>
                <rect x='1' y='1' width='5.5' height='5.5' rx='1.5' fill='white' />
                <rect x='7.5' y='1' width='5.5' height='2.5' rx='1' fill='white' />
                <rect x='7.5' y='4.5' width='5.5' height='2' rx='1' fill='white' />
                <rect x='1' y='7.5' width='12' height='5.5' rx='1.5' fill='white' />
              </svg>
              손익
            </button>
          </div>

          <div className={cn(styles.view, view !== 'donut' && styles.hidden)}>
            <div className={styles.donutOuter}>
              <svg viewBox='0 0 210 210' className={styles.donutSvg}>
                <circle cx='105' cy='105' r='82' fill='none' stroke='rgba(255,255,255,.07)' strokeWidth='24' />
                {homeHoldings.map((item, index) => {
                  const layout = donutLayout[index]
                  return (
                    <g key={item.id}>
                      <path
                        className={cn(
                          styles.arcSeg,
                          selectedId !== null && selectedId !== item.id && styles.dimmed,
                          selectedId === item.id && styles.selected,
                        )}
                        fill='none'
                        stroke={item.donutColor}
                        strokeWidth='24'
                        strokeLinecap='round'
                        d={layout.path}
                        onClick={() => selectHolding(item.id)}
                      />
                      <rect
                        x={layout.x - layout.textWidth / 2 - 5}
                        y={layout.y - 8}
                        width={layout.textWidth + 10}
                        height='15'
                        rx='6'
                        fill='rgba(10,25,55,.8)'
                      />
                      <text
                        x={layout.x}
                        y={layout.y}
                        fontSize='10'
                        fill='white'
                        textAnchor='middle'
                        fontWeight='500'
                        dominantBaseline='middle'
                      >
                        {item.donutLabel}
                      </text>
                    </g>
                  )
                })}
              </svg>
              <button type='button' className={styles.donutCenter} onClick={() => setOpenSheet('score')}>
                <div
                  className={styles.dcScore}
                  style={{
                    fontSize: selectedHolding ? 22 : 32,
                    color: selectedHolding ? selectedHolding.centerScoreColor : 'white',
                  }}
                >
                  {selectedHolding ? selectedHolding.centerScore : '54'}
                </div>
                <div className={cn(styles.dcBadge, badgeToneClass(selectedHolding?.centerBadgeTone ?? 'amber'))}>
                  {selectedHolding ? selectedHolding.centerBadge : '주의'}
                </div>
                <div className={styles.dcTxt}>
                  {selectedHolding ? (
                    selectedHolding.centerName
                  ) : (
                    <>
                      탭하면 해당
                      <br />
                      종목으로 이동해요
                    </>
                  )}
                </div>
              </button>
            </div>
            <div className={styles.scrollHint} style={{ opacity: selectedHolding ? 0 : 1 }}>
              <span>탭하면 종목 카드로 이동해요</span>
              <span className={styles.scrollArrow}>↓</span>
            </div>
            <button type='button' className={styles.momentumBanner} onClick={() => setOpenSheet('momentum')}>
              <span className={styles.momentumDot} />
              <span className={styles.momentumText}>이번 주 포트폴리오 순풍</span>
              <span className={styles.momentumValue}>나아지는 중 ↑</span>
              <span className={styles.momentumArrow}>›</span>
            </button>
          </div>

          <div className={cn(styles.view, view !== 'heatmap' && styles.hidden)}>
            <div className={styles.heatmapHeader}>
              <div>
                <div className={styles.heatmapScore}>54</div>
                <div className={styles.heatmapScoreLabel}>포트폴리오 점수</div>
              </div>
              <div className={styles.heatmapSummary}>
                <div className={styles.heatmapSummaryBadge}>주의</div>
                <div className={styles.heatmapSummaryText}>
                  1개 종목이
                  <br />
                  위험해요
                </div>
              </div>
            </div>
            <div className={styles.heatmapGrid}>
              <div className={styles.heatmapRow}>
                <button
                  type='button'
                  className={cn(styles.heatmapTile, styles.heatmapSamsung)}
                  style={{ background: homeHoldings[0].heatmapBackground }}
                  onClick={() => handleHeatmapClick(0)}
                >
                  <div className={styles.heatmapWeight}>{homeHoldings[0].heatmapWeight}</div>
                  <div className={styles.heatmapName}>{homeHoldings[0].name}</div>
                  <div className={styles.heatmapChange}>{homeHoldings[0].heatmapChange}</div>
                  <div className={styles.heatmapChip} style={{ background: 'rgba(226,75,74,.35)', color: '#F7C1C1' }}>
                    {homeHoldings[0].heatmapBadge}
                  </div>
                </button>
                <div className={styles.heatmapColumn}>
                  <button
                    type='button'
                    className={cn(styles.heatmapTile, styles.heatmapSmall)}
                    style={{ background: homeHoldings[3].heatmapBackground }}
                    onClick={() => handleHeatmapClick(3)}
                  >
                    <div className={cn(styles.heatmapWeight, styles.heatmapWeightSmall)}>{homeHoldings[3].heatmapWeight}</div>
                    <div className={cn(styles.heatmapName, styles.heatmapNameSmall)}>{homeHoldings[3].name}</div>
                    <div className={cn(styles.heatmapChange, styles.heatmapChangeSmall)}>{homeHoldings[3].heatmapChange}</div>
                  </button>
                  <button
                    type='button'
                    className={cn(
                      styles.heatmapTile,
                      styles.heatmapSmall,
                      homeHoldings[2].blink && styles.blink,
                    )}
                    style={{ background: homeHoldings[2].heatmapBackground }}
                    onClick={() => handleHeatmapClick(2)}
                  >
                    <div className={cn(styles.heatmapWeight, styles.heatmapWeightSmall)}>{homeHoldings[2].heatmapWeight}</div>
                    <div className={cn(styles.heatmapName, styles.heatmapNameTiny)}>{homeHoldings[2].shortName}</div>
                    <div className={cn(styles.heatmapChip, styles.heatmapChipTiny)} style={{ background: 'rgba(55,138,221,.3)', color: '#B5D4F4' }}>
                      거래정지
                    </div>
                  </button>
                </div>
              </div>
              <button
                type='button'
                className={cn(styles.heatmapTile, styles.heatmapWide)}
                style={{ background: homeHoldings[1].heatmapBackground }}
                onClick={() => handleHeatmapClick(1)}
              >
                <div className={styles.heatmapWeight}>{homeHoldings[1].heatmapWeight}</div>
                <div className={styles.heatmapName}>{homeHoldings[1].name}</div>
                <div className={styles.heatmapChange}>{homeHoldings[1].heatmapChange}</div>
                <div className={styles.heatmapChip} style={{ background: 'rgba(239,159,39,.3)', color: '#FAC775' }}>
                  {homeHoldings[1].heatmapBadge}
                </div>
              </button>
              <button
                type='button'
                className={cn(styles.heatmapTile, styles.heatmapFooter)}
                style={{ background: homeHoldings[4].heatmapBackground }}
                onClick={() => handleHeatmapClick(4)}
              >
                <div className={styles.heatmapWeight}>{homeHoldings[4].heatmapWeight}</div>
                <div className={cn(styles.heatmapName, styles.heatmapNameSmall)}>{homeHoldings[4].name}</div>
                <div className={cn(styles.heatmapChange, styles.heatmapChangeSmall)}>
                  {homeHoldings[4].heatmapChange} · {homeHoldings[4].heatmapMeta}
                </div>
              </button>
            </div>
            <button type='button' className={styles.momentumBanner} onClick={() => setOpenSheet('momentum')}>
              <span className={styles.momentumDot} />
              <span className={styles.momentumText}>이번 주 포트폴리오 순풍</span>
              <span className={styles.momentumValue}>나아지는 중 ↑</span>
              <span className={styles.momentumArrow}>›</span>
            </button>
          </div>
        </div>

        <div className={styles.body}>
          <div className={styles.sectionLabel}>종목별 현황</div>

          {homeHoldings.map((item) => {
            const isEtf = item.kind === 'etf'
            const open = isEtf ? isEtfCardOpen : openStockCardId === item.id
            const valueToneClass = item.cardTone === 'profit' ? styles.valuePositive : styles.valueDanger

            return (
              <div
                key={item.id}
                ref={(node) => {
                  cardRefs.current[item.id] = node
                }}
                className={cn(
                  styles.stockCard,
                  item.cardTone === 'halt' && styles.cardHalt,
                  item.cardTone === 'profit' && styles.cardProfit,
                  isEtf && styles.cardEtf,
                  open && styles.cardActive,
                )}
                onClick={() => {
                  if (isEtf) {
                    toggleEtfCard()
                    return
                  }

                  toggleCard(item.id)
                }}
              >
                <div className={styles.stockCardMain}>
                  <div className={cn(styles.signal, signalToneClass(item.signalTone))} />
                  <div className={styles.stockInfo}>
                    <div className={styles.stockNameRow}>
                      <div className={styles.stockName}>{item.name}</div>
                      <div
                        className={cn(
                          styles.stockBadge,
                          item.badgeTone === 'red' && styles.badgeRed,
                          item.badgeTone === 'amber' && styles.badgeAmber,
                          item.badgeTone === 'green' && styles.badgeGreen,
                        )}
                      >
                        {item.badge}
                      </div>
                    </div>
                    <div className={styles.stockSub}>
                      <span className={cn(styles.marketTag, marketToneClass(item.marketTone))}>{item.market}</span>{' '}
                      {item.shares}
                    </div>
                  </div>
                  <div className={styles.stockValue}>
                    <div className={cn(styles.stockValueStrong, valueToneClass)}>{item.change}</div>
                    <div className={cn(styles.stockSub, item.cardTone === 'profit' ? styles.valuePositive : styles.valueDanger)} style={{ marginTop: 2 }}>
                      {item.pnl}
                    </div>
                  </div>
                </div>
                <div className={cn(styles.detail, open && styles.detailOpen)}>
                  <div
                    className={styles.aiBox}
                    style={{
                      background: item.opinionBackground,
                      borderColor: item.opinionBorder,
                    }}
                  >
                    <div
                      className={styles.aiLabel}
                      style={{
                        color:
                          item.cardTone === 'halt'
                            ? '#A32D2D'
                            : item.cardTone === 'profit'
                              ? '#3B6D11'
                              : item.kind === 'etf'
                                ? '#185FA5'
                                : '#999',
                      }}
                    >
                      {item.opinionLabel}
                    </div>
                    <div className={styles.aiText} style={{ color: item.opinionTextColor }}>
                      {item.opinionText}
                    </div>
                  </div>
                  <div className={styles.metaLine}>{item.metaLine}</div>
                  <div className={styles.metricGrid}>
                    {item.metrics.map((metric) => (
                      <div key={metric.label} className={styles.metricCard}>
                        <div className={styles.metricLabel}>{metric.label}</div>
                        <div className={cn(styles.metricValue, metricToneClass(metric.tone))}>{metric.value}</div>
                      </div>
                    ))}
                  </div>
                  {item.actionHref ? (
                    <Link
                      href={item.actionHref}
                      className={cn(styles.detailButton, actionToneClass(item))}
                      onClick={(event) => event.stopPropagation()}
                    >
                      {item.actionLabel}
                      {item.actionSubLabel ? <span className={styles.actionSubLabel}>{item.actionSubLabel}</span> : null}
                      {item.actionCredits ? <span className={styles.credit}>{item.actionCredits}</span> : null}
                    </Link>
                  ) : (
                    <button
                      type='button'
                      className={cn(styles.detailButton, actionToneClass(item))}
                      onClick={(event) => event.stopPropagation()}
                    >
                      {item.actionLabel}
                      {item.actionSubLabel ? <span className={styles.actionSubLabel}>{item.actionSubLabel}</span> : null}
                      {item.actionCredits ? <span className={styles.credit}>{item.actionCredits}</span> : null}
                    </button>
                  )}
                </div>
              </div>
            )
          })}

          <div className={styles.forecastCard}>
            <div className={styles.forecastLabel}>{homeForecast.label}</div>
            <div className={styles.forecastText}>{homeForecast.body}</div>
            <Link href={homeForecast.href} className={styles.forecastMore}>
              {homeForecast.cta}
            </Link>
          </div>
        </div>

        <div className={styles.bottomNav}>
          <button type='button' className={cn(styles.navItem, styles.navItemOn)}>
            <span className={cn(styles.navIcon, styles.navIconOn)} />
            <span>홈</span>
          </button>
          <button type='button' className={styles.navItem}>
            <span className={styles.navIcon} />
            <span>포트폴리오</span>
          </button>
          <button type='button' className={styles.navItem}>
            <span className={styles.navIcon} />
            <span>분석</span>
          </button>
          <Link href='/mypage' className={styles.navItem}>
            <span className={styles.navIcon} />
            <span>마이</span>
          </Link>
        </div>
      </div>

      <div className={styles.modalMount}>
        <div className={styles.modalInner}>
          <button
            type='button'
            className={cn(styles.sheetOverlay, openSheet === 'score' && styles.sheetOverlayOpen)}
            onClick={() => setOpenSheet(null)}
            aria-label='포트폴리오 점수 닫기'
          />
          <div className={cn(styles.sheet, openSheet === 'score' && styles.sheetOpen)}>
            <div className={styles.sheetHandle} />
            <div className={styles.sheetTitle}>포트폴리오 점수</div>
            <div className={styles.sheetSubtitle}>각 항목이 내 포트폴리오에 미치는 영향이에요</div>
            <div className={styles.sheetScoreRow}>
              <div className={styles.sheetScoreNum}>54</div>
              <div className={styles.sheetScoreBadge}>주의</div>
              <div className={styles.sheetScoreText}>
                100점 만점
                <br />
                상위 47%
              </div>
            </div>
            {portfolioScoreBreakdown.map((item) => (
              <div key={item.label} className={styles.breakdownItem}>
                <div className={styles.breakdownHeader}>
                  <div className={styles.breakdownLabel}>{item.label}</div>
                  <div className={styles.breakdownScore} style={{ color: item.scoreColor }}>
                    {item.score}
                  </div>
                </div>
                <div className={styles.breakdownBarTrack}>
                  <div className={styles.breakdownBarFill} style={{ width: item.barWidth, background: item.barColor }} />
                </div>
                <div className={styles.breakdownDesc}>{item.description}</div>
                <div className={styles.breakdownStocks}>
                  {item.stocks.map((stock) => (
                    <div
                      key={stock.label}
                      className={styles.breakdownStockTag}
                      style={
                        'background' in stock
                          ? {
                              background: stock.background,
                              color: stock.color,
                            }
                          : undefined
                      }
                    >
                      <span className={styles.breakdownStockDot} style={{ background: stock.dot }} />
                      {stock.label}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className={styles.modalMount}>
        <div className={styles.modalInner}>
          <button
            type='button'
            className={cn(styles.sheetOverlay, openSheet === 'momentum' && styles.sheetOverlayOpen)}
            onClick={() => setOpenSheet(null)}
            aria-label='이번 주 회복 모멘텀 닫기'
          />
          <div className={cn(styles.sheet, openSheet === 'momentum' && styles.sheetOpen)}>
            <div className={styles.sheetHandle} />
            <div className={styles.sheetTitle}>이번 주 회복 모멘텀</div>
            <div className={styles.sheetSubtitle}>9인 위원회가 매주 종목별 회복 신호를 분석해요</div>
            <div className={styles.momentumStageRow}>
              <div className={styles.momentumStages}>
                {momentumStages.map((stage) => (
                  <div
                    key={stage.label}
                    className={cn(
                      styles.momentumStage,
                      stage.tone === 'danger' && styles.stageDanger,
                      stage.tone === 'muted' && styles.stageMuted,
                      stage.tone === 'positive' && styles.stagePositive,
                    )}
                  >
                    <div className={styles.momentumStageLabel}>{stage.label}</div>
                    <div className={styles.momentumStageSub}>{stage.subtitle}</div>
                  </div>
                ))}
              </div>
              <div className={styles.momentumStageHint}>지난주 미풍 → 이번 주 순풍으로 한 단계 올라왔어요</div>
            </div>
            <div className={styles.sheetSectionTitle}>종목별 회복 신호</div>
            {momentumSignals.map((signal) => (
              <div key={signal.name} className={styles.breakdownItem}>
                <div className={styles.signalRow}>
                  <span className={cn(styles.signal, signal.blink && styles.blink)} style={{ background: signal.dot, marginTop: 0 }} />
                  <div className={styles.signalName}>{signal.name}</div>
                  <div className={styles.signalBadge} style={{ background: signal.badgeBackground, color: signal.badgeColor }}>
                    {signal.badge}
                  </div>
                </div>
                <div className={styles.signalDesc}>{signal.description}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
