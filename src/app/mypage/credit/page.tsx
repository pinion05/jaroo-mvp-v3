import Link from 'next/link'
import { Sparkles } from 'lucide-react'
import { SpecFrame } from '@/components/spec/spec-frame'
import styles from '../detail.module.css'

export default function CreditPage() {
  return (
    <SpecFrame backHref='/mypage' title='크레딧 충전'>
      <div className={styles.soonWrap}>
        <div className={styles.soonIco}><Sparkles className='size-7' /></div>
        <div className={styles.soonTitle}>곧 만나요</div>
        <div className={styles.soonDesc}>크레딧 충전을 준비하고 있어요.<br />지금은 무료로 딥스캔을 이용할 수 있어요.</div>
        <span className={styles.soonBadge}>준비 중</span>
        <Link href='/mypage' className={styles.soonBack}>돌아가기</Link>
      </div>
    </SpecFrame>
  )
}
