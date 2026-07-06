'use client'

import { ChevronRight } from 'lucide-react'
import { SpecFrame } from '@/components/spec/spec-frame'
import { cn } from '@/lib/utils'
import { HISTORY_TEST_DATA } from '@/data/mypage-test-data'
import styles from '../detail.module.css'

export default function HistoryPage() {
  return (
    <SpecFrame backHref='/mypage' title='분석 기록'>
      <div className={styles.body}>
        <div className={styles.subLabel}>
          지난 딥스캔 결과를 다시 볼 수 있어요
          <span className={styles.testBadge}>테스트 데이터</span>
        </div>

        {HISTORY_TEST_DATA.map((r, i) => (
          <div className={styles.recItem} key={i}>
            <div className={styles.recTop}>
              <span className={styles.recDot} style={{ background: r.dot }} />
              <span className={styles.recName}>{r.name}</span>
              <span className={styles.recDate}>{r.date}</span>
            </div>
            <div className={styles.recBody}>
              <span className={cn(styles.recLabel, r.labelTone === 'amber' && styles.recLabelAmber)}>{r.label}</span>
              <span className={styles.recSummary}>{r.summary}</span>
              <span className={styles.recArrow}><ChevronRight className='size-4' /></span>
            </div>
          </div>
        ))}
      </div>
    </SpecFrame>
  )
}
