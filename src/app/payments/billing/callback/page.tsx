import { BillingCallbackClient } from './callback-client'
import styles from '../../payments.module.css'

export default async function BillingCallbackPage({
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
      <BillingCallbackClient
        orderId={first('orderId') ?? ''}
        customerKey={first('customerKey') ?? ''}
        authKey={first('authKey') ?? ''}
      />
    </div>
  )
}
