'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'

import { ListChecks, Camera, History, Bell, TrendingDown, Megaphone, FileText, Shield, MessageCircle, UserMinus, ChevronRight, Send } from 'lucide-react'
import { PaymentsStatusCards } from '@/components/mypage/payments-status-cards'
import { SpecFrame } from '@/components/spec/spec-frame'
import { AuthAccountCard } from '@/components/auth/auth-account-card'
import { cn } from '@/lib/utils'
import { MYPAGE_TEST_DATA as T } from '@/data/mypage-test-data'
import styles from './mypage.module.css'



export default function MyPage() {
  const router = useRouter()
  const [notif, setNotif] = useState(T.notifications)
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  const [withdrawPending, setWithdrawPending] = useState(false)
  const [withdrawError, setWithdrawError] = useState<string | null>(null)


  // 텔레그램 알림 연결 (실데이터 /api/telegram/link) — 워치 알림 수신 채널
  const [tgLinked, setTgLinked] = useState(false)
  const [tgUsername, setTgUsername] = useState<string | null>(null)
  const [tgWaiting, setTgWaiting] = useState(false) // 딥링크로 봇 시작 후 웹훅 확정 대기
  const [tgConfigured, setTgConfigured] = useState(true) // 미설정 배포(503)면 행을 숨긴다
  const [tgBusy, setTgBusy] = useState(false)

  const loadTelegramStatus = async () => {
    try {
      const res = await fetch('/api/telegram/link')
      if (res.status === 503) {
        setTgConfigured(false)
        return
      }
      const data = (await res.json().catch(() => ({}))) as { linked?: boolean; telegram_username?: string | null }
      if (data.linked) {
        setTgLinked(true)
        setTgUsername(data.telegram_username ?? null)
        setTgWaiting(false)
      } else {
        setTgLinked(false)
      }
    } catch {
      // 조회 실패 시 현재 표시 유지
    }
  }

  useEffect(() => {
    void loadTelegramStatus()
  }, [])

  // 연결 대기 중 폴링 — 유저가 텔레그램에서 시작을 누르면 webhook 이 연결을 확정한다
  useEffect(() => {
    if (!tgWaiting) return
    const timer = window.setInterval(() => { void loadTelegramStatus() }, 3000)
    const stop = window.setTimeout(() => {
      window.clearInterval(timer)
      setTgWaiting(false) // 90초 경과 — "연결 대기 중" 무기한 잔존 방지 (리뷰 nit)
    }, 90_000)
    return () => {
      window.clearInterval(timer)
      window.clearTimeout(stop)
    }
  }, [tgWaiting])

  const connectTelegram = async () => {
    if (tgBusy) return
    setTgBusy(true)
    try {
      const res = await fetch('/api/telegram/link', { method: 'POST' })
      // 실패 사유를 반드시 알린다 — 무반응은 유저가 원인을 알 수 없다 (리뷰 nit → 유저 실측 반영)
      if (res.status === 503) {
        window.alert('텔레그램 연동이 아직 활성화되지 않았어요. 서버 설정을 확인해주세요.')
      } else if (res.status === 401) {
        window.alert('로그인이 만료되었어요. 다시 로그인한 뒤 시도해주세요.')
      } else if (res.status === 403) {
        window.alert('보안 검증에 실패했어요. 페이지를 새로고침한 뒤 다시 시도해주세요.')
      } else if (!res.ok) {
        window.alert('일시적인 문제가 생겼어요. 잠시 후 다시 시도해주세요.')
        return
      }
      const data = (await res.json().catch(() => ({}))) as { link_url?: string }
      if (data.link_url) {
        setTgWaiting(true)
        window.location.href = data.link_url // 모바일: 텔레그램 앱으로 전환
      }
    } finally {
      setTgBusy(false)
    }
  }

  const unlinkTelegram = async () => {
    if (tgBusy) return
    if (!window.confirm('텔레그램 알림 연결을 해제할까요?')) return
    setTgBusy(true)
    try {
      const res = await fetch('/api/telegram/link', { method: 'DELETE' })
      if (res.ok) {
        setTgLinked(false)
        setTgUsername(null)
        setTgWaiting(false)
      }
    } finally {
      setTgBusy(false)
    }
  }

  const openWithdraw = () => {
    setWithdrawError(null)
    setWithdrawOpen(true)
  }

  const closeWithdraw = () => {
    if (!withdrawPending) setWithdrawOpen(false)
  }

  // 회원 탈퇴: 계정·포트폴리오·크레딧·분석 기록이 모두 삭제되고 복구할 수 없다.
  const confirmWithdraw = async () => {
    setWithdrawPending(true)
    setWithdrawError(null)
    try {
      const response = await fetch('/api/account/delete', { method: 'POST' })
      const payload = (await response.json().catch(() => ({}))) as { error?: { message?: string } }
      if (!response.ok) {
        setWithdrawError(payload.error?.message || '회원 탈퇴 처리 중 문제가 생겼어요. 잠시 후 다시 시도해주세요.')
        return
      }
      await fetch('/api/auth/logout', { method: 'POST' })
      setWithdrawOpen(false)
      router.replace('/home')
      router.refresh()
    } catch {
      setWithdrawError('네트워크 연결을 확인한 뒤 다시 시도해주세요.')
    } finally {
      setWithdrawPending(false)
    }
  }

  return (
    <SpecFrame showBottomNav>
      <div className={styles.top}>
        <div className={styles.topTitle}>마이</div>
      </div>
      <div className={styles.body}>
        {/* 계정 카드 — 아래 카드들과 동일한 리듬(14px)으로 띄운다 */}
        <div className='mb-3.5'>
          <AuthAccountCard />
        </div>

        {/* 크레딧 / Pro — /api/payments/me 실데이터 */}
        <PaymentsStatusCards />

        {/* 포트폴리오 */}
        <div className={styles.menuLabel}>포트폴리오<span className={styles.testBadgeInline}>테스트 데이터</span></div>
        <div className={styles.menuGroup}>
          <RowLink href='/mypage/watchlist' icon={<ListChecks className='size-[18px]' />} label='내 종목 관리' value={`${T.watchlistCount}종목`} />
          <RowLink href='/screenshot' icon={<Camera className='size-[18px]' />} label='스크린샷으로 종목 추가' />
          <RowLink href='/mypage/history' icon={<History className='size-[18px]' />} label='분석 기록' />
        </div>

        {/* 알림 (테스트 데이터 / 로컬 상태) */}
        <div className={styles.menuLabel}>
          알림<span className={styles.testBadgeInline}>테스트 데이터</span>
        </div>
        <div className={styles.menuGroup}>
          {tgConfigured ? (
            <RowButton
              icon={<Send className='size-[18px]' />}
              label={tgLinked ? '텔레그램 알림' : '텔레그램 알림 연결'}
              value={tgLinked ? (tgUsername ? `@${tgUsername}` : '연결됨') : tgWaiting ? '연결 대기 중...' : undefined}
              onClick={() => (tgLinked ? void unlinkTelegram() : void connectTelegram())}
            />
          ) : null}
          <ToggleRow icon={<Bell className='size-[18px]' />} label='분석 완료 알림' on={notif.analysisDone} onClick={() => setNotif((n) => ({ ...n, analysisDone: !n.analysisDone }))} />
          <ToggleRow icon={<TrendingDown className='size-[18px]' />} label='급락 종목 알림' on={notif.plungeAlert} onClick={() => setNotif((n) => ({ ...n, plungeAlert: !n.plungeAlert }))} />
          <ToggleRow icon={<Megaphone className='size-[18px]' />} label='마케팅 정보 수신' on={notif.marketing} onClick={() => setNotif((n) => ({ ...n, marketing: !n.marketing }))} />
        </div>

        {/* 기타 */}
        <div className={styles.menuLabel}>기타</div>
        <div className={styles.menuGroup}>
          <RowLink href='/terms' icon={<FileText className='size-[18px]' />} label='서비스 약관' />
          <RowLink href='/privacy' icon={<Shield className='size-[18px]' />} label='개인정보처리방침' />
          <RowLink href='mailto:support@jaroo.kr' icon={<MessageCircle className='size-[18px]' />} label='문의하기' />
          <RowButton icon={<UserMinus className='size-[18px]' />} label='회원 탈퇴' danger onClick={openWithdraw} />
        </div>

        <div className={styles.version}>Jaroo {T.appVersion}</div>
      </div>

      {withdrawOpen ? (
        <div className={styles.confirmLayer} role='dialog' aria-modal='true' aria-labelledby='withdraw-title' aria-describedby='withdraw-desc'>
          <button type='button' className={styles.confirmBackdrop} onClick={closeWithdraw} aria-label='회원 탈퇴 취소' />
          <div className={styles.confirmDialog}>
            <div className={styles.confirmTitle} id='withdraw-title'>회원 탈퇴</div>
            <p className={styles.confirmText} id='withdraw-desc'>
              탈퇴하면 계정, 포트폴리오, 분석 기록, 잔여 크레딧이 모두 삭제되고 복구할 수 없어요.
              유료 구독 중이라면 남은 혜택도 함께 소멸해요.
            </p>
            {withdrawError ? (
              <p className={styles.confirmError} aria-live='polite'>{withdrawError}</p>
            ) : null}
            <div className={styles.confirmActions}>
              <button type='button' className={styles.confirmCancel} onClick={closeWithdraw} disabled={withdrawPending}>
                취소
              </button>
              <button type='button' className={styles.confirmDanger} onClick={() => void confirmWithdraw()} disabled={withdrawPending}>
                {withdrawPending ? '처리 중...' : '탈퇴하기'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </SpecFrame>
  )
}

function RowLink({ href, icon, label, value, danger }: { href: string; icon: ReactNode; label: string; value?: string; danger?: boolean }) {
  return (
    <Link href={href} className={styles.menuItem}>
      <span className={cn(styles.miIco, danger && styles.danger)}>{icon}</span>
      <span className={cn(styles.miLabel, danger && styles.danger)}>{label}</span>
      {value ? <span className={styles.miValue}>{value}</span> : null}
      <span className={styles.miArrow}><ChevronRight className='size-4' /></span>
    </Link>
  )
}

function RowButton({ icon, label, value, danger, onClick }: { icon: ReactNode; label: string; value?: string; danger?: boolean; onClick?: () => void }) {
  return (
    <button type='button' className={styles.menuItem} onClick={onClick}>
      <span className={cn(styles.miIco, danger && styles.danger)}>{icon}</span>
      <span className={cn(styles.miLabel, danger && styles.danger)}>{label}</span>
      {value ? <span className={styles.miValue}>{value}</span> : null}
      <span className={styles.miArrow}><ChevronRight className='size-4' /></span>
    </button>
  )
}

function ToggleRow({ icon, label, on, onClick }: { icon: ReactNode; label: string; on: boolean; onClick: () => void }) {
  return (
    <button type='button' className={styles.menuItem} onClick={onClick} aria-pressed={on}>
      <span className={styles.miIco}>{icon}</span>
      <span className={styles.miLabel}>{label}</span>
      <span className={cn(styles.miToggle, !on && styles.off)} aria-hidden='true' />
    </button>
  )
}
