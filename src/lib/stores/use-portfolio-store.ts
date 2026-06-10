import { create } from 'zustand'

import type { PortfolioNormalizedItem, WorkflowAsyncStatus } from '@/lib/workflow-types'
import { getPortfolioItemKey } from '@/lib/workflow-types'

type PortfolioStoreState = {
  items: PortfolioNormalizedItem[]
  quoteStatus: WorkflowAsyncStatus
  quoteErrorMessage: string | null
  quoteQueryKey: string | null
}

type PortfolioStoreActions = {
  replaceItems: (items: PortfolioNormalizedItem[]) => void
  upsertItem: (item: PortfolioNormalizedItem) => void
  patchQuote: (identity: Pick<PortfolioNormalizedItem, 'code' | 'ticker' | 'name' | 'market'>, patch: Partial<PortfolioNormalizedItem>) => void
  clearItemQuote: (identity: Pick<PortfolioNormalizedItem, 'code' | 'ticker' | 'name' | 'market'>) => void
  setQuoteStatus: (status: WorkflowAsyncStatus, errorMessage?: string | null, quoteQueryKey?: string | null) => void
  clear: () => void
}

const initialState: PortfolioStoreState = {
  items: [],
  quoteStatus: 'idle',
  quoteErrorMessage: null,
  quoteQueryKey: null,
}

export const usePortfolioStore = create<PortfolioStoreState & PortfolioStoreActions>()((set) => ({
  ...initialState,
  replaceItems: (items) => set({ items }),
  upsertItem: (item) =>
    set((state) => {
      const nextKey = getPortfolioItemKey(item)
      return {
        items: state.items.some((existing) => getPortfolioItemKey(existing) === nextKey)
          ? state.items.map((existing) => (getPortfolioItemKey(existing) === nextKey ? item : existing))
          : [...state.items, item],
      }
    }),
  patchQuote: (identity, patch) =>
    set((state) => {
      const targetKey = getPortfolioItemKey(identity)
      return {
        items: state.items.map((item) =>
          getPortfolioItemKey(item) === targetKey
            ? { ...item, ...patch }
            : item,
        ),
      }
    }),
  clearItemQuote: (identity) =>
    set((state) => {
      const targetKey = getPortfolioItemKey(identity)
      return {
        items: state.items.map((item) =>
          getPortfolioItemKey(item) === targetKey
            ? { ...item, currentPrice: undefined, currentProfitRate: undefined, currentPriceCurrency: undefined, usdKrwRate: undefined }
            : item,
        ),
      }
    }),
  setQuoteStatus: (quoteStatus, quoteErrorMessage = null, quoteQueryKey = null) => set({ quoteStatus, quoteErrorMessage, quoteQueryKey }),
  clear: () => set(initialState),
}))
