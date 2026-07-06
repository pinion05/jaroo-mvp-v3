import Link from 'next/link'
import { Crown } from 'lucide-react'
import { SpecFrame } from '@/components/spec/spec-frame'
import styles from '../detail.module.css'

export default function ProPage() {
  return (
    <SpecFrame backHref='/mypage' title='Jaroo Pro'>
      <div className={styles.soonWrap}>
        <div className={styles.soonIco}><Crown className='size-7' /></div>
        <div className={styles.soonTitle}>Jaroo Pro 준비 중</div>
        <div className={styles.soonDesc}>딥스캔 무제한 구독을 준비하고 있어요.<br />출시되면 가장 먼저 알려드릴게요.</div>
        <span className={styles.soonBadge}>준비 중</span>
        <Link href='/mypage' className={styles.soonBack}>돌아가기</Link>
      </div>
    </SpecFrame>
  )
}
