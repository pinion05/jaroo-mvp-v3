'use client'

import Link from 'next/link'
import { useMemo, useRef, useState } from 'react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { JarooShell } from '@/components/jaroo-shell'
import { cn } from '@/lib/utils'

type CreditPackage = {
  amount: string
  price: string
  badge?: string
}

type StockTone = 'danger' | 'warning' | 'positive' | 'halt'

type StockItem = {
  id: number
  name: string
  code: string
  quantity: string
  price: string
  rate: string
  tone: StockTone
  deleted: boolean
}

type ConflictChoice = 'update' | 'keep'
type ModalState = 'upload' | 'conflict' | 'edit' | null

const creditPackages: CreditPackage[] = [
  { amount: '300cr', price: '990원' },
  { amount: '1,000cr', price: '2,900원', badge: '인기' },
  { amount: '3,000cr', price: '6,900원' },
]

const uploadHistory = [
  {
    title: '키움증권 스크린샷',
    subtitle: '2025.04.01 · 삼성전자, 코칩, 드래곤플라이',
    badge: '적용 중',
  },
  {
    title: '삼성증권 스크린샷',
    subtitle: '2025.04.01 · SK하이닉스',
    badge: '적용 중',
  },
]

const otherMenuItems = [
  {
    icon: '🔔',
    iconBg: 'bg-[#FFF0E6]',
    title: '알림 설정',
    subtitle: '회복 신호, 거래정지 감지',
    badge: '켜짐',
    badgeClassName: 'bg-[color:var(--jaroo-success-soft)] text-[color:var(--jaroo-success)]',
  },
  {
    icon: '📊',
    iconBg: 'bg-[color:var(--jaroo-accent)]',
    title: 'AI 적중률 통계',
    subtitle: '딥스캔 예측 정확도 확인',
    badge: '61.9%',
    badgeClassName: 'bg-[color:var(--jaroo-accent)] text-[color:var(--jaroo-primary)]',
  },
  {
    icon: '💬',
    iconBg: 'bg-[color:var(--jaroo-success-soft)]',
    title: '고객센터',
    subtitle: '카카오톡 채널 문의',
  },
  {
    icon: 'ℹ',
    iconBg: 'bg-[color:var(--jaroo-secondary)]',
    title: '앱 정보',
    subtitle: '버전 0.9.1 (MVP)',
  },
]

const initialStocks: StockItem[] = [
  {
    id: 0,
    name: '삼성전자',
    code: '005930',
    quantity: '128',
    price: '74600',
    rate: '-23.4%',
    tone: 'danger',
    deleted: false,
  },
  {
    id: 1,
    name: '코칩',
    code: '094360',
    quantity: '350',
    price: '18200',
    rate: '-14.3%',
    tone: 'warning',
    deleted: false,
  },
  {
    id: 2,
    name: '드래곤플라이',
    code: '030350',
    quantity: '500',
    price: '1840',
    rate: '거래 정지',
    tone: 'halt',
    deleted: false,
  },
  {
    id: 3,
    name: 'SK하이닉스',
    code: '000660',
    quantity: '40',
    price: '146500',
    rate: '+31.4%',
    tone: 'positive',
    deleted: false,
  },
]

const conflictRows = [
  { key: 'samsung', name: '삼성전자', code: '005930' },
  { key: 'cochip', name: '코칩', code: '094360' },
] as const

function SectionLabel({ children }: { children: string }) {
  return <p className='px-1 text-[11px] tracking-[0.04em] text-[color:var(--jaroo-muted)]/80'>{children}</p>
}

function formatNumber(value: string) {
  const parsed = Number(value.replaceAll(',', ''))

  if (!Number.isFinite(parsed)) {
    return value
  }

  return parsed.toLocaleString('ko-KR')
}

function stockToneClass(tone: StockTone) {
  switch (tone) {
    case 'danger':
      return {
        dot: 'bg-[color:var(--jaroo-danger)]',
        rate: 'text-[color:var(--jaroo-danger)]',
      }
    case 'warning':
      return {
        dot: 'bg-[color:var(--jaroo-warning)]',
        rate: 'text-[color:var(--jaroo-danger)]',
      }
    case 'positive':
      return {
        dot: 'bg-[color:var(--jaroo-success)]',
        rate: 'text-[color:var(--jaroo-success)]',
      }
    default:
      return {
        dot: 'animate-pulse bg-[color:var(--jaroo-danger)]',
        rate: 'text-[11px] text-[color:var(--jaroo-danger)]',
      }
  }
}

function BottomNavItem({
  label,
  active = false,
  href,
}: {
  label: string
  active?: boolean
  href?: string
}) {
  const className = cn(
    'flex flex-col items-center gap-1 rounded-2xl px-2 py-2 text-[10px] font-medium transition',
    active ? 'text-[color:var(--jaroo-primary)]' : 'text-[color:var(--jaroo-muted)] hover:bg-[color:var(--jaroo-secondary)]',
  )

  const content = (
    <>
      <span className={cn('size-4 rounded-[4px] bg-[color:var(--jaroo-secondary)]', active && 'bg-[color:var(--jaroo-accent)]')} />
      <span>{label}</span>
    </>
  )

  if (href) {
    return (
      <Link href={href} className={className}>
        {content}
      </Link>
    )
  }

  return (
    <button type='button' className={className}>
      {content}
    </button>
  )
}

export default function MyPage() {
  const creditPackagesRef = useRef<HTMLDivElement>(null)

  const [selectedPackage, setSelectedPackage] = useState(1)
  const [editMode, setEditMode] = useState(false)
  const [stocks, setStocks] = useState(initialStocks)
  const [modal, setModal] = useState<ModalState>(null)
  const [selectedBroker, setSelectedBroker] = useState('')
  const [uploadSelected, setUploadSelected] = useState(false)
  const [editingStockId, setEditingStockId] = useState<number | null>(null)
  const [draftQuantity, setDraftQuantity] = useState('128')
  const [draftPrice, setDraftPrice] = useState('74600')
  const [conflictChoices, setConflictChoices] = useState<Record<string, ConflictChoice>>({
    samsung: 'update',
    cochip: 'update',
  })

  const editingStock = useMemo(
    () => stocks.find((stock) => stock.id === editingStockId) ?? null,
    [editingStockId, stocks],
  )

  const closeModal = () => {
    setModal(null)
    setEditingStockId(null)
  }

  const openEditModal = (stock: StockItem) => {
    setEditingStockId(stock.id)
    setDraftQuantity(stock.quantity)
    setDraftPrice(stock.price)
    setModal('edit')
  }

  const saveEditedStock = () => {
    if (editingStockId === null) {
      return
    }

    closeModal()
  }

  const deleteStock = (stockId: number) => {
    setStocks((currentStocks) =>
      currentStocks.map((stock) =>
        stock.id === stockId
          ? {
              ...stock,
              deleted: true,
            }
          : stock,
      ),
    )
  }

  const mypageBottomNav = (
    <nav className='sticky bottom-0 z-20 grid grid-cols-4 border-t border-[color:var(--jaroo-border)] bg-white/95 px-2 py-2 backdrop-blur'>
      <BottomNavItem label='홈' href='/home' />
      <BottomNavItem label='포트폴리오' />
      <BottomNavItem label='분석' />
      <BottomNavItem label='마이' href='/mypage' active />
    </nav>
  )

  return (
    <JarooShell title='마이' leading={null} bottomNav={mypageBottomNav}>
      <Card className='rounded-[26px] border-0 bg-[linear-gradient(180deg,var(--jaroo-primary-strong),var(--jaroo-primary))] p-5 text-white shadow-none ring-0'>
        <div className='flex items-center gap-4'>
          <Avatar className='size-[52px] border border-white/20'>
            <AvatarFallback className='bg-white/15 text-lg font-semibold text-white'>호</AvatarFallback>
          </Avatar>
          <div className='min-w-0 flex-1'>
            <p className='text-base font-semibold'>호식님</p>
            <p className='mt-1 text-xs text-white/65'>무료 플랜 · 딥스캔 2회 사용</p>
          </div>
          <button
            type='button'
            className='rounded-xl border border-white/30 bg-white/12 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-white/20'
          >
            Pro 업그레이드
          </button>
        </div>
      </Card>

      <section className='space-y-2'>
        <SectionLabel>크레딧</SectionLabel>
        <Card className='gap-0 rounded-[24px] py-0 shadow-none ring-[color:var(--jaroo-border)]'>
          <div className='p-4'>
            <div className='flex items-end justify-between gap-4'>
              <div className='flex items-end gap-2'>
                <p className='text-[32px] leading-none font-semibold text-[color:var(--jaroo-ink)]'>700</p>
                <span className='pb-1 text-sm text-[color:var(--jaroo-muted)]'>cr</span>
              </div>
              <button
                type='button'
                className='pb-1 text-xs font-semibold text-[color:var(--jaroo-primary)]'
                onClick={() => creditPackagesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
              >
                충전하기 ›
              </button>
            </div>
            <div className='mt-4 h-1 rounded-full bg-[#f0efe8]'>
              <div className='h-full w-[70%] rounded-full bg-[color:var(--jaroo-primary)]' />
            </div>
            <p className='mt-3 text-[11px] leading-5 text-[color:var(--jaroo-muted)]'>
              딥스캔 1회 = 300cr · 추가 스캔 = 100cr
              <br />
              Pro 구독 시 무제한
            </p>
            <div ref={creditPackagesRef} className='mt-4 grid grid-cols-3 gap-2'>
              {creditPackages.map((item, index) => {
                const active = selectedPackage === index

                return (
                  <button
                    key={item.amount}
                    type='button'
                    className={cn(
                      'rounded-[18px] border px-2 py-3 text-center transition',
                      active
                        ? 'border-[color:var(--jaroo-primary)] bg-[color:var(--jaroo-accent)]'
                        : 'border-[color:var(--jaroo-border)] bg-[#f8f8f6]',
                    )}
                    onClick={() => setSelectedPackage(index)}
                  >
                    {item.badge ? (
                      <span className='mb-1 inline-flex rounded-md bg-[color:var(--jaroo-primary)] px-1.5 py-0.5 text-[9px] font-semibold text-white'>
                        {item.badge}
                      </span>
                    ) : (
                      <span className='mb-1 block h-[17px]' />
                    )}
                    <p className='text-[13px] font-semibold text-[color:var(--jaroo-ink)]'>{item.amount}</p>
                    <p className='mt-1 text-[11px] text-[color:var(--jaroo-muted)]'>{item.price}</p>
                  </button>
                )
              })}
            </div>
          </div>
        </Card>
      </section>

      <section className='space-y-2'>
        <SectionLabel>내 종목 관리</SectionLabel>
        <Card className='gap-0 rounded-[24px] py-0 shadow-none ring-[color:var(--jaroo-border)]'>
          <div className='flex items-center justify-between gap-3 border-b border-[color:var(--jaroo-border)] px-4 py-4'>
            <p className='text-[13px] font-semibold text-[color:var(--jaroo-ink)]'>보유 종목 4개</p>
            <div className='flex items-center gap-3'>
              <p className='text-xs text-[color:var(--jaroo-muted)]'>마지막 업데이트 오늘</p>
              <button
                type='button'
                className='text-xs font-semibold text-[color:var(--jaroo-primary)]'
                onClick={() => setEditMode((currentValue) => !currentValue)}
              >
                {editMode ? '완료' : '편집'}
              </button>
            </div>
          </div>

          {stocks.map((stock, index) => {
            const tone = stockToneClass(stock.tone)

            return (
              <div
                key={stock.id}
                className={cn(
                  'flex items-center gap-3 px-4 py-3',
                  index < stocks.length - 1 && 'border-b border-[color:var(--jaroo-border)]',
                  stock.deleted && 'pointer-events-none opacity-30',
                )}
              >
                <span className={cn('size-[7px] shrink-0 rounded-full', tone.dot)} />
                <div className='min-w-0 flex-1'>
                  <div className='flex items-center gap-1.5'>
                    <p className='text-[13px] font-semibold text-[color:var(--jaroo-ink)]'>{stock.name}</p>
                    <span className='text-[11px] text-[#b8c2cf]'>{stock.code}</span>
                  </div>
                  <p className='mt-1 text-[11px] text-[color:var(--jaroo-muted)]'>
                    {formatNumber(stock.quantity)}주 · 평단 {formatNumber(stock.price)}원
                  </p>
                </div>
                {editMode ? (
                  <div className='flex shrink-0 gap-1.5'>
                    <button
                      type='button'
                      className='rounded-lg border border-[#b5d4f4] bg-[color:var(--jaroo-accent)] px-2.5 py-1 text-[11px] font-medium text-[color:var(--jaroo-primary)]'
                      onClick={() => openEditModal(stock)}
                    >
                      수정
                    </button>
                    <button
                      type='button'
                      className='rounded-lg border border-[#f7c1c1] bg-[color:var(--jaroo-danger-ghost)] px-2.5 py-1 text-[11px] font-medium text-[color:var(--jaroo-danger)]'
                      onClick={() => deleteStock(stock.id)}
                    >
                      삭제
                    </button>
                  </div>
                ) : (
                  <p className={cn('shrink-0 text-xs font-semibold', tone.rate)}>{stock.rate}</p>
                )}
              </div>
            )
          })}

          <button
            type='button'
            className='flex w-full items-center gap-3 border-t border-[color:var(--jaroo-border)] px-4 py-4 text-left transition hover:bg-[color:var(--jaroo-secondary)]/60'
            onClick={() => setModal('upload')}
          >
            <span className='flex size-8 shrink-0 items-center justify-center rounded-full bg-[color:var(--jaroo-accent)] text-lg text-[color:var(--jaroo-primary)]'>
              +
            </span>
            <span className='min-w-0 flex-1'>
              <span className='block text-[13px] font-semibold text-[color:var(--jaroo-primary)]'>스크린샷 추가</span>
              <span className='mt-0.5 block text-[11px] text-[color:var(--jaroo-muted)]'>새 종목 추가 또는 기존 종목 업데이트</span>
            </span>
            <span className='text-sm text-[#bcc5d1]'>›</span>
          </button>
        </Card>
      </section>

      <section className='space-y-2'>
        <SectionLabel>업로드 히스토리</SectionLabel>
        <Card className='gap-0 rounded-[24px] py-0 shadow-none ring-[color:var(--jaroo-border)]'>
          {uploadHistory.map((item, index) => (
            <div
              key={item.title}
              className={cn(
                'flex items-center gap-3 px-4 py-3',
                index < uploadHistory.length - 1 && 'border-b border-[color:var(--jaroo-border)]',
              )}
            >
              <div className='flex size-8 shrink-0 items-center justify-center rounded-xl bg-[color:var(--jaroo-secondary)] text-sm'>📷</div>
              <div className='min-w-0 flex-1'>
                <p className='text-[13px] text-[color:var(--jaroo-ink)]'>{item.title}</p>
                <p className='mt-1 text-[11px] text-[color:var(--jaroo-muted)]'>{item.subtitle}</p>
              </div>
              <span className='shrink-0 rounded-md bg-[color:var(--jaroo-success-soft)] px-2 py-1 text-[10px] font-medium text-[color:var(--jaroo-success)]'>
                {item.badge}
              </span>
            </div>
          ))}
        </Card>
      </section>

      <section className='space-y-2'>
        <SectionLabel>구독</SectionLabel>
        <Card className='rounded-[24px] border-0 bg-[linear-gradient(180deg,var(--jaroo-primary-strong),var(--jaroo-primary))] p-5 text-white shadow-none ring-0'>
          <div className='flex items-center justify-between gap-4'>
            <p className='text-[15px] font-semibold'>Jaroo Pro</p>
            <p className='text-[13px] text-white/70'>월 4,900원</p>
          </div>
          <div className='mt-4 space-y-2.5'>
            {['딥스캔 무제한', '매일 자동 스캔', '회복 알림 푸시', '포트폴리오 변화 주간 리포트'].map((feature) => (
              <div key={feature} className='flex items-center gap-2 text-[12px] text-white/85'>
                <span className='text-[#9FE1CB]'>✓</span>
                <span>{feature}</span>
              </div>
            ))}
          </div>
          <button
            type='button'
            className='mt-4 w-full rounded-xl bg-white px-4 py-3 text-sm font-semibold text-[color:var(--jaroo-primary-strong)] transition hover:bg-white/90'
          >
            Pro 시작하기
          </button>
        </Card>
      </section>

      <section className='space-y-2'>
        <SectionLabel>기타</SectionLabel>
        <Card className='gap-0 rounded-[24px] py-0 shadow-none ring-[color:var(--jaroo-border)]'>
          {otherMenuItems.map((item, index) => (
            <button
              key={item.title}
              type='button'
              className={cn(
                'flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-[color:var(--jaroo-secondary)]/60',
                index < otherMenuItems.length - 1 && 'border-b border-[color:var(--jaroo-border)]',
              )}
            >
              <span className={cn('flex size-[34px] shrink-0 items-center justify-center rounded-[10px] text-[15px]', item.iconBg)}>
                {item.icon}
              </span>
              <span className='min-w-0 flex-1'>
                <span className='block text-[13px] font-semibold text-[color:var(--jaroo-ink)]'>{item.title}</span>
                <span className='mt-0.5 block text-[11px] text-[color:var(--jaroo-muted)]'>{item.subtitle}</span>
              </span>
              <span className='flex shrink-0 items-center gap-1.5'>
                {item.badge ? (
                  <span className={cn('rounded-md px-2 py-1 text-[11px] font-medium', item.badgeClassName)}>{item.badge}</span>
                ) : null}
                <span className='text-sm text-[#c6cfdb]'>›</span>
              </span>
            </button>
          ))}
        </Card>
      </section>

      {modal ? (
        <div className='absolute inset-0 z-30 flex items-end'>
          <button
            type='button'
            className='absolute inset-0 bg-black/50'
            onClick={closeModal}
            aria-label='모달 닫기'
          />

          {modal === 'upload' ? (
            <div className='relative z-10 w-full rounded-t-[24px] bg-white pb-6 shadow-[0_-12px_32px_rgba(15,23,40,0.22)]'>
              <div className='mx-auto my-3 h-1 w-9 rounded-full bg-[#d7dde6]' />
              <div className='px-5'>
                <p className='text-[15px] font-semibold text-[color:var(--jaroo-ink)]'>스크린샷 추가</p>
                <p className='mt-1 text-[12px] leading-5 text-[color:var(--jaroo-muted)]'>
                  MTS 보유 종목 화면을 캡처해서 올려주세요. 종목명, 수량, 평단가를 자동으로 읽어요.
                </p>
              </div>
              <div className='px-4 pt-4'>
                <button
                  type='button'
                  className={cn(
                    'w-full rounded-[16px] border border-dashed px-4 py-7 text-center transition',
                    uploadSelected
                      ? 'border-[color:var(--jaroo-success)] bg-[color:var(--jaroo-success-ghost)]'
                      : 'border-[#b5d4f4] bg-[#f8fbff]',
                  )}
                  onClick={() => setUploadSelected(true)}
                >
                  {uploadSelected ? (
                    <>
                      <div className='text-2xl'>✅</div>
                      <div className='mt-2 text-[13px] font-semibold text-[color:var(--jaroo-success)]'>스크린샷 선택됨</div>
                      <div className='mt-1 text-[11px] text-[color:var(--jaroo-muted)]'>MTS_보유종목_0403.png</div>
                    </>
                  ) : (
                    <>
                      <div className='text-[26px]'>📷</div>
                      <div className='mt-2 text-[13px] font-semibold text-[color:var(--jaroo-primary)]'>스크린샷 업로드</div>
                      <div className='mt-1 text-[11px] text-[color:var(--jaroo-muted)]'>탭해서 갤러리에서 선택</div>
                    </>
                  )}
                </button>
              </div>
              <p className='px-5 pt-4 text-[11px] text-[color:var(--jaroo-muted)]'>어느 증권사 화면인가요?</p>
              <div className='flex flex-wrap gap-2 px-4 pt-2'>
                {['키움증권', '삼성증권', '미래에셋', 'NH투자', '토스증권', '기타'].map((broker) => {
                  const active = broker === selectedBroker

                  return (
                    <button
                      key={broker}
                      type='button'
                      className={cn(
                        'rounded-lg border px-3 py-1.5 text-[12px] transition',
                        active
                          ? 'border-[#b5d4f4] bg-[color:var(--jaroo-accent)] text-[color:var(--jaroo-primary)]'
                          : 'border-[color:var(--jaroo-border)] bg-white text-[#4d5b6a]',
                      )}
                      onClick={() => setSelectedBroker(broker)}
                    >
                      {broker}
                    </button>
                  )
                })}
              </div>
              <div className='flex gap-2 px-4 pt-5'>
                <button
                  type='button'
                  className='flex-1 rounded-xl border border-[#d8e0ea] bg-white px-4 py-3 text-[13px] text-[#4d5b6a] transition hover:bg-[color:var(--jaroo-secondary)]'
                  onClick={closeModal}
                >
                  취소
                </button>
                <button
                  type='button'
                  className='flex-[2] rounded-xl bg-[color:var(--jaroo-primary)] px-4 py-3 text-[13px] font-semibold text-white transition hover:bg-[color:var(--jaroo-primary-strong)]'
                  onClick={() => setModal('conflict')}
                >
                  다음 →
                </button>
              </div>
            </div>
          ) : null}

          {modal === 'conflict' ? (
            <div className='relative z-10 w-full rounded-t-[24px] bg-white pb-6 shadow-[0_-12px_32px_rgba(15,23,40,0.22)]'>
              <div className='mx-auto my-3 h-1 w-9 rounded-full bg-[#d7dde6]' />
              <div className='px-5'>
                <p className='text-[15px] font-semibold text-[color:var(--jaroo-ink)]'>기존 종목과 겹쳐요</p>
                <p className='mt-1 text-[12px] leading-5 text-[color:var(--jaroo-muted)]'>
                  새 스크린샷에 있는 종목이 이미 등록되어 있어요. 각 종목을 어떻게 할까요?
                </p>
              </div>
              <div className='pt-4'>
                {conflictRows.map((row, index) => {
                  const selectedChoice = conflictChoices[row.key]

                  return (
                    <div
                      key={row.key}
                      className={cn('px-4 py-3', index < conflictRows.length - 1 && 'border-b border-[color:var(--jaroo-border)]')}
                    >
                      <p className='mb-2 text-[13px] font-semibold text-[color:var(--jaroo-ink)]'>
                        {row.name} {row.code}
                      </p>
                      <div className='flex gap-2'>
                        {[
                          {
                            value: 'update' as const,
                            label: '업데이트',
                            detail: '새 스크린샷으로\n교체',
                          },
                          {
                            value: 'keep' as const,
                            label: '유지',
                            detail: '기존 정보\n그대로',
                          },
                        ].map((option) => {
                          const active = selectedChoice === option.value

                          return (
                            <button
                              key={option.value}
                              type='button'
                              className={cn(
                                'flex-1 rounded-xl border px-3 py-2 text-center text-[11px] leading-4 transition',
                                active
                                  ? 'border-[color:var(--jaroo-primary)] bg-[color:var(--jaroo-accent)] text-[color:var(--jaroo-primary)]'
                                  : 'border-[color:var(--jaroo-border)] bg-white text-[#4d5b6a]',
                              )}
                              onClick={() =>
                                setConflictChoices((currentChoices) => ({
                                  ...currentChoices,
                                  [row.key]: option.value,
                                }))
                              }
                            >
                              <span className='block font-semibold'>{option.label}</span>
                              <span className={cn('mt-1 block whitespace-pre-line text-[10px]', active ? 'text-[color:var(--jaroo-primary)]' : 'text-[color:var(--jaroo-muted)]')}>
                                {option.detail}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className='flex gap-2 px-4 pt-5'>
                <button
                  type='button'
                  className='flex-1 rounded-xl border border-[#d8e0ea] bg-white px-4 py-3 text-[13px] text-[#4d5b6a] transition hover:bg-[color:var(--jaroo-secondary)]'
                  onClick={closeModal}
                >
                  취소
                </button>
                <button
                  type='button'
                  className='flex-[2] rounded-xl bg-[color:var(--jaroo-primary)] px-4 py-3 text-[13px] font-semibold text-white transition hover:bg-[color:var(--jaroo-primary-strong)]'
                  onClick={closeModal}
                >
                  적용하기
                </button>
              </div>
            </div>
          ) : null}

          {modal === 'edit' && editingStock ? (
            <div className='relative z-10 w-full rounded-t-[24px] bg-white pb-6 shadow-[0_-12px_32px_rgba(15,23,40,0.22)]'>
              <div className='mx-auto my-3 h-1 w-9 rounded-full bg-[#d7dde6]' />
              <div className='px-5'>
                <p className='text-[15px] font-semibold text-[color:var(--jaroo-ink)]'>{editingStock.name} 수정</p>
                <p className='mt-1 text-[12px] leading-5 text-[color:var(--jaroo-muted)]'>
                  OCR이 잘못 읽었거나 변경이 필요한 경우 직접 수정할 수 있어요.
                </p>
              </div>
              <div className='space-y-4 px-4 pt-4'>
                <div>
                  <label className='mb-1 block text-[12px] text-[color:var(--jaroo-muted)]'>보유 수량</label>
                  <Input
                    type='number'
                    inputMode='numeric'
                    value={draftQuantity}
                    onChange={(event) => setDraftQuantity(event.target.value)}
                    className='h-11 rounded-xl border-[#d8e0ea] bg-[#f8f8f6] px-3 text-sm text-[color:var(--jaroo-ink)] focus-visible:bg-white'
                  />
                </div>
                <div>
                  <label className='mb-1 block text-[12px] text-[color:var(--jaroo-muted)]'>평균 단가 (원)</label>
                  <Input
                    type='number'
                    inputMode='numeric'
                    value={draftPrice}
                    onChange={(event) => setDraftPrice(event.target.value)}
                    className='h-11 rounded-xl border-[#d8e0ea] bg-[#f8f8f6] px-3 text-sm text-[color:var(--jaroo-ink)] focus-visible:bg-white'
                  />
                </div>
              </div>
              <div className='flex gap-2 px-4 pt-5'>
                <button
                  type='button'
                  className='flex-1 rounded-xl border border-[#d8e0ea] bg-white px-4 py-3 text-[13px] text-[#4d5b6a] transition hover:bg-[color:var(--jaroo-secondary)]'
                  onClick={closeModal}
                >
                  취소
                </button>
                <button
                  type='button'
                  className='flex-[2] rounded-xl bg-[color:var(--jaroo-primary)] px-4 py-3 text-[13px] font-semibold text-white transition hover:bg-[color:var(--jaroo-primary-strong)]'
                  onClick={saveEditedStock}
                >
                  저장
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </JarooShell>
  )
}
