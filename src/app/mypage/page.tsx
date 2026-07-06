'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CreditCard, Crown, ListChecks, Camera, History, Bell, TrendingDown, Megaphone, FileText, Shield, MessageCircle, LogOut, UserMinus, ChevronRight } from 'lucide-react'
import { SpecFrame } from '@/components/spec/spec-frame'
import { cn } from '@/lib/utils'
import { MYPAGE_TEST_DATA as T } from '@/data/mypage-test-data'
import styles from './mypage.module.css'

type Me = {
  provider: string | null
  user: { displayName: string | null; email: string | null } | null
}

export default function MyPage() {
  const router = useRouter()
  const [me, setMe] = useState<Me | null>(null)
  const [notif, setNotif] = useState(T.notifications)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then(setMe)
      .catch(() => {})
  }, [])

  async function handleLogout() {
    setBusy(true)
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch {
      /* ignore */
    }
    router.replace('/login')
  }

  const name = me?.user?.displayName ?? '게스트'
  const email = me?.user?.email ?? ''
  const isGoogle = me?.provider === 'google'
  const initial = (name || '?').trim().slice(0, 1)

  return (
    <SpecFrame showBottomNav>
      <div className={styles.top}>
        <div className={styles.topTitle}>마이</div>
      </div>
      <div className={styles.body}>
        {/* 프로필 (실데이터: /api/auth/me) */}
        <div className={styles.profile}>
          <div className={styles.avatar}>{initial}</div>
          <div className={styles.pfInfo}>
            <div className={styles.pfName}>{name}</div>
            <div className={styles.pfEmail}>{email || '이메일 없음'}</div>
            <div className={styles.pfProvider}>{isGoogle ? '구글 로그인' : '이메일 로그인'}</div>
          </div>
          <Link href='/mypage/profile' className={styles.pfEdit}>편집</Link>
        </div>

        {/* 크레딧 (테스트 데이터) */}
        <div className={styles.creditCard}>
          <span className={styles.testBadge} title='백엔드 연동 전 테스트 데이터'>테스트 데이터</span>
          <div className={styles.creditLabel}>지금 이용 가능</div>
          <div className={styles.creditAmt}>딥스캔 <span>{T.credit.deepScanLeft}</span>회</div>
          <div className={styles.creditSub}>스캔은 {T.credit.scanTotal}회 · 보유 크레딧 {T.credit.creditBalance.toLocaleString()}</div>
          <button className={styles.creditBtn} disabled><CreditCard className='size-4' /> 크레딧 충전</button>
        </div>

        {/* Pro (테스트 데이터) */}
        <div className={styles.proCard}>
          <span className={styles.testBadge} title='백엔드 연동 전 테스트 데이터'>테스트 데이터</span>
          <div className={styles.proMark}><Crown className='size-5' /></div>
          <div className={styles.proInfo}>
            <div className={styles.proTitle}>Jaroo Pro</div>
            <div className={styles.proDesc}>딥스캔 무제한 · 월 {T.pro.pricePerMonth.toLocaleString()}원</div>
          </div>
          <button className={styles.proBtn} disabled>시작하기</button>
        </div>

        {/* 포트폴리오 */}
        <div className={styles.menuLabel}>포트폴리오</div>
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
          <ToggleRow icon={<Bell className='size-[18px]' />} label='분석 완료 알림' on={notif.analysisDone} onClick={() => setNotif((n) => ({ ...n, analysisDone: !n.analysisDone }))} />
          <ToggleRow icon={<TrendingDown className='size-[18px]' />} label='급락 종목 알림' on={notif.plungeAlert} onClick={() => setNotif((n) => ({ ...n, plungeAlert: !n.plungeAlert }))} />
          <ToggleRow icon={<Megaphone className='size-[18px]' />} label='마케팅 정보 수신' on={notif.marketing} onClick={() => setNotif((n) => ({ ...n, marketing: !n.marketing }))} />
        </div>

        {/* 기타 */}
        <div className={styles.menuLabel}>기타</div>
        <div className={styles.menuGroup}>
          {/* TODO: 약관/개인정보/문의 페이지 생기면 링크 연결 */}
          <RowButton icon={<FileText className='size-[18px]' />} label='서비스 약관' />
          <RowButton icon={<Shield className='size-[18px]' />} label='개인정보처리방침' />
          <RowButton icon={<MessageCircle className='size-[18px]' />} label='문의하기' />
          <RowButton icon={<LogOut className='size-[18px]' />} label={busy ? '로그아웃 중...' : '로그아웃'} onClick={handleLogout} />
          <RowButton icon={<UserMinus className='size-[18px]' />} label='회원 탈퇴' danger />
        </div>

        <div className={styles.version}>Jaroo {T.appVersion}</div>
      </div>
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

function RowButton({ icon, label, danger, onClick }: { icon: ReactNode; label: string; danger?: boolean; onClick?: () => void }) {
  return (
    <button type='button' className={styles.menuItem} onClick={onClick}>
      <span className={cn(styles.miIco, danger && styles.danger)}>{icon}</span>
      <span className={cn(styles.miLabel, danger && styles.danger)}>{label}</span>
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
