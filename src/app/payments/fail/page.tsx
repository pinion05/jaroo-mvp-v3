import Link from 'next/link'
import { XCircle } from 'lucide-react'
import { SpecFrame } from '@/components/spec/spec-frame'
import styles from '../payments.module.css'

export default async function PaymentsFailPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const first = (key: string) => {
    const value = params[key]
    return Array.isArray(value) ? value[0] : value
  }
  const code = first('code') ?? ''
  const message = first('message') ?? '결제가 중단되었어요.'
  const canceled = code === 'PAY_PROCESS_CANCELED'

  return (
    <SpecFrame backHref='/mypage' title='결제 실패'>
      <div className={styles.wrap}>
        <div className={styles.state}>
          <div className={[styles.ico, styles.icoFail].join(' ')}><XCircle className='size-7' /></div>
          <div className={styles.title}>{canceled ? '결제가 취소되었어요' : '결제에 실패했어요'}</div>
          <div className={styles.desc}>
            {canceled ? '결제를 완료하지 않았어요. 다시 시도할 수 있어요.' : message}
            {code && !canceled ? ` (${code})` : ''}
          </div>
        </div>
        <Link href='/mypage' className={styles.primaryBtn}>마이페이지로</Link>
      </div>
    </SpecFrame>
  )
}
