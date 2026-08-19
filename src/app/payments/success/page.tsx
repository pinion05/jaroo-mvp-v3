import { SuccessClient } from './success-client'
import styles from '../payments.module.css'

export default async function PaymentsSuccessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const first = (key: string) => {
    const value = params[key]
    return Array.isArray(value) ? value[0] : value
  }

  return (
    <div className={styles.wrap}>
      <SuccessClient orderId={first('orderId') ?? ''} paymentKey={first('paymentKey') ?? ''} />
    </div>
  )
}
