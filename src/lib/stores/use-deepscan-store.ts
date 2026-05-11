import { create } from 'zustand'

import type { JarooDeepScanPayload } from '../../../packages/contracts/src/deepscan'
import type { DeepScanResultCacheEntry, DeepScanTargetInput, WorkflowAsyncStatus } from '@/lib/workflow-types'
import { getDeepScanTargetKey } from '@/lib/workflow-types'

type DeepScanStoreState = {
  target: DeepScanTargetInput | null
  requestStatus: WorkflowAsyncStatus
  errorMessage: string | null
  activePayload: JarooDeepScanPayload | null
  activeTargetKey: string | null
  lastSuccessful: DeepScanResultCacheEntry | null
}

type DeepScanStoreActions = {
  setTarget: (target: DeepScanTargetInput | null) => void
  startRequest: () => void
  finishSuccess: (payload: JarooDeepScanPayload, completedAt?: string) => void
  updateActivePayload: (updater: (payload: JarooDeepScanPayload) => JarooDeepScanPayload) => void
  finishError: (errorMessage: string) => void
  abandonInFlight: () => void
  clear: () => void
}

const initialState: DeepScanStoreState = {
  target: null,
  requestStatus: 'idle',
  errorMessage: null,
  activePayload: null,
  activeTargetKey: null,
  lastSuccessful: null,
}

export const useDeepScanStore = create<DeepScanStoreState & DeepScanStoreActions>()((set, get) => ({
  ...initialState,
  setTarget: (target) =>
    set((state) => {
      const previousTargetKey = state.target ? getDeepScanTargetKey(state.target) : null
      const nextTargetKey = target ? getDeepScanTargetKey(target) : null

      if (previousTargetKey === nextTargetKey) {
        return { target }
      }

      return {
        target,
        requestStatus: 'idle',
        errorMessage: null,
        activePayload: null,
        activeTargetKey: null,
      }
    }),
  startRequest: () => {
    const { target } = get()
    set({
      requestStatus: 'loading',
      errorMessage: null,
      activePayload: null,
      activeTargetKey: target ? getDeepScanTargetKey(target) : null,
    })
  },
  finishSuccess: (payload, completedAt = new Date().toISOString()) => {
    const { target } = get()
    const targetKey = target ? getDeepScanTargetKey(target) : null
    set({
      requestStatus: 'success',
      errorMessage: null,
      activePayload: payload,
      activeTargetKey: targetKey,
      lastSuccessful: target && targetKey
        ? {
            targetKey,
            payload,
            completedAt,
          }
        : null,
    })
  },
  updateActivePayload: (updater) =>
    set((state) => {
      if (!state.activePayload) {
        return state
      }

      const nextPayload = updater(state.activePayload)
      return {
        activePayload: nextPayload,
        lastSuccessful: state.lastSuccessful
          ? {
              ...state.lastSuccessful,
              payload: nextPayload,
            }
          : state.lastSuccessful,
      }
    }),
  finishError: (errorMessage) => {
    const { target } = get()
    set({
      requestStatus: 'error',
      errorMessage,
      activePayload: null,
      activeTargetKey: target ? getDeepScanTargetKey(target) : null,
    })
  },
  abandonInFlight: () =>
    set((state) => ({
      requestStatus: 'idle',
      errorMessage: null,
      activePayload: null,
      activeTargetKey: null,
      lastSuccessful: state.lastSuccessful,
    })),
  clear: () => set(initialState),
}))

export function shouldReuseDeepScanLastSuccess(target: DeepScanTargetInput | null) {
  const { lastSuccessful } = useDeepScanStore.getState()

  if (!target || !lastSuccessful) {
    return false
  }

  return lastSuccessful.targetKey === getDeepScanTargetKey(target)
}
