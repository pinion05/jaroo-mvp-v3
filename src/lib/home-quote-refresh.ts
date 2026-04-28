import type { WorkflowAsyncStatus } from '@/lib/workflow-types'

type HomeQuoteHydrationDecisionInput = {
  quoteSurfaceEnabled: boolean
  quoteQuery: string
  quoteQueryKey: string | null
  quoteStatus: WorkflowAsyncStatus
  refreshVersion: number
}

export function shouldHydrateHomeQuotes({
  quoteSurfaceEnabled,
  quoteQuery,
  quoteQueryKey,
  quoteStatus,
  refreshVersion,
}: HomeQuoteHydrationDecisionInput) {
  if (!quoteSurfaceEnabled) {
    return false
  }

  return !(refreshVersion === 0 && quoteQueryKey === quoteQuery && (quoteStatus === 'loading' || quoteStatus === 'success'))
}
