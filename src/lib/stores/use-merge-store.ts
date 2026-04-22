import { create } from 'zustand'

import type { MergeRow, WorkflowAsyncStatus } from '@/lib/workflow-types'
import { getApplicableConfirmedHoldings } from '@/lib/workflow-types'

type MergeStoreState = {
  rows: MergeRow[]
  applyStatus: WorkflowAsyncStatus
  errorMessage: string | null
  lastAppliedAt: string | null
}

type MergeStoreActions = {
  setRows: (rows: MergeRow[]) => void
  upsertRow: (row: MergeRow) => void
  markRowError: (rowId: string, error: { code?: string; message: string }) => void
  setApplyStatus: (status: WorkflowAsyncStatus, errorMessage?: string | null) => void
  markApplied: (appliedAt?: string) => void
  resetForBackNav: () => void
}

const initialState: MergeStoreState = {
  rows: [],
  applyStatus: 'idle',
  errorMessage: null,
  lastAppliedAt: null,
}

export const useMergeStore = create<MergeStoreState & MergeStoreActions>()((set) => ({
  ...initialState,
  setRows: (rows) => set({ rows }),
  upsertRow: (row) =>
    set((state) => ({
      rows: state.rows.some((item) => item.id === row.id)
        ? state.rows.map((item) => (item.id === row.id ? row : item))
        : [...state.rows, row],
    })),
  markRowError: (rowId, error) =>
    set((state) => ({
      rows: state.rows.map((row) =>
        row.id === rowId
          ? { ...row, status: 'error', errorCode: error.code, errorMessage: error.message }
          : row,
      ),
    })),
  setApplyStatus: (applyStatus, errorMessage = null) => set({ applyStatus, errorMessage }),
  markApplied: (appliedAt = new Date().toISOString()) => set({ applyStatus: 'success', errorMessage: null, lastAppliedAt: appliedAt }),
  resetForBackNav: () => set(initialState),
}))

export function selectMergeApplicableRows() {
  return getApplicableConfirmedHoldings(useMergeStore.getState().rows)
}
