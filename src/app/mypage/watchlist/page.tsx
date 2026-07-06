'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { SpecFrame } from '@/components/spec/spec-frame'
import { cn } from '@/lib/utils'
import { WATCHLIST_TEST_DATA as INITIAL } from '@/data/mypage-test-data'
import styles from '../detail.module.css'

export default function WatchlistPage() {
  const [items, setItems] = useState(INITIAL)

  return (
    <SpecFrame backHref='/mypage' title='내 종목 관리'>
      <div className={styles.body}>
        <div className={styles.subLabel}>
          {items.length}종목 보유 중 · 빼려면 오른쪽 버튼을 누르세요
          <span className={styles.testBadge}>테스트 데이터</span>
        </div>

        {items.map((s) => (
          <div className={styles.mngItem} key={s.code}>
            <span className={styles.mngDot} style={{ background: s.dot }} />
            <div className={styles.mngInfo}>
              <div className={styles.mngName}>{s.name}</div>
              <div className={styles.mngMeta}>{s.market} · {s.code} · {s.qty}</div>
            </div>
            <div className={styles.mngRight}>
              <div className={cn(styles.mngRate, s.dir === 'up' ? styles.up : styles.down)}>{s.rate}</div>
            </div>
            <button
              type='button'
              className={styles.mngDel}
              onClick={() => setItems((xs) => xs.filter((x) => x.code !== s.code))}
              aria-label={`${s.name} 삭제`}
            >
              <Trash2 className='size-4' />
            </button>
          </div>
        ))}

        <Link href='/screenshot' className={styles.mngAdd}>
          <Plus className='size-4' /> 스크린샷으로 종목 추가
        </Link>
      </div>
    </SpecFrame>
  )
}
