import { create } from 'zustand'

import type { JarooDeepScanPayload } from '../../../packages/contracts/src/deepscan'
import type { DeepScanResultCacheEntry, DeepScanTargetInput, WorkflowAsyncStatus } from '@/lib/workflow-types'
import { getDeepScanTargetKey } from '@/lib/workflow-types'

type DeepScanStoreState = {
  target: DeepScanTargetInput | null
  requestStatus: WorkflowAsyncStatus
  errorMessage: string | null
  activePayload: JarooDeepScanPayload | null
  lastSuccessful: DeepScanResultCacheEntry | null
}

type DeepScanStoreActions = {
  setTarget: (target: DeepScanTargetInput | null) => void
  startRequest: () => void
  finishSuccess: (payload: JarooDeepScanPayload, completedAt?: string) => void
  finishError: (errorMessage: string) => void
  abandonInFlight: () => void
  clear: () => void
}

const initialState: DeepScanStoreState = {
  target: null,
  requestStatus: 'idle',
  errorMessage: null,
  activePayload: null,
  lastSuccessful: null,
}

export const useDeepScanStore = create<DeepScanStoreState & DeepScanStoreActions>()((set, get) => ({
  ...initialState,
  setTarget: (target) => set({ target }),
  startRequest: () => set({ requestStatus: 'loading', errorMessage: null, activePayload: null }),
  finishSuccess: (payload, completedAt = new Date().toISOString()) => {
    const { target } = get()
    set({
      requestStatus: 'success',
      errorMessage: null,
      activePayload: payload,
      lastSuccessful: target
        ? {
            targetKey: getDeepScanTargetKey(target),
            payload,
            completedAt,
          }
        : null,
    })
  },
  finishError: (errorMessage) => set({ requestStatus: 'error', errorMessage, activePayload: null }),
  abandonInFlight: () => set((state) => ({ requestStatus: 'idle', errorMessage: null, activePayload: null, lastSuccessful: state.lastSuccessful })),
  clear: () => set(initialState),
}))

export function shouldReuseDeepScanLastSuccess(target: DeepScanTargetInput | null) {
  const { lastSuccessful } = useDeepScanStore.getState()

  if (!target || !lastSuccessful) {
    return false
  }

  return lastSuccessful.targetKey === getDeepScanTargetKey(target)
}
