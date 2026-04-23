import { create } from 'zustand'

import type { OcrReviewRow, ResolveCandidate, WorkflowAsyncStatus } from '@/lib/workflow-types'

type OcrReviewStoreState = {
  rows: OcrReviewRow[]
  candidatesByRowId: Record<string, ResolveCandidate[]>
  requestStatus: WorkflowAsyncStatus
  resolveStatus: WorkflowAsyncStatus
  errorMessage: string | null
  resolveErrorMessage: string | null
}

type OcrReviewStoreActions = {
  setRows: (rows: OcrReviewRow[]) => void
  upsertRow: (row: OcrReviewRow) => void
  patchRow: (rowId: string, patch: Partial<OcrReviewRow>) => void
  removeRow: (rowId: string) => void
  setCandidates: (rowId: string, candidates: ResolveCandidate[]) => void
  replaceCandidates: (candidatesByRowId: Record<string, ResolveCandidate[]>) => void
  selectCandidate: (rowId: string, candidateId: string | null) => void
  setRequestStatus: (status: WorkflowAsyncStatus, errorMessage?: string | null) => void
  setResolveStatus: (status: WorkflowAsyncStatus, errorMessage?: string | null) => void
  resetForRestart: () => void
}

const initialState: OcrReviewStoreState = {
  rows: [],
  candidatesByRowId: {},
  requestStatus: 'idle',
  resolveStatus: 'idle',
  errorMessage: null,
  resolveErrorMessage: null,
}

export const useOcrReviewStore = create<OcrReviewStoreState & OcrReviewStoreActions>()((set) => ({
  ...initialState,
  setRows: (rows) => set({ rows }),
  upsertRow: (row) =>
    set((state) => ({
      rows: state.rows.some((item) => item.id === row.id)
        ? state.rows.map((item) => (item.id === row.id ? row : item))
        : [...state.rows, row],
    })),
  patchRow: (rowId, patch) =>
    set((state) => ({
      rows: state.rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
    })),
  removeRow: (rowId) =>
    set((state) => ({
      rows: state.rows.filter((row) => row.id !== rowId),
      candidatesByRowId: Object.fromEntries(
        Object.entries(state.candidatesByRowId).filter(([candidateRowId]) => candidateRowId !== rowId),
      ),
    })),
  setCandidates: (rowId, candidates) =>
    set((state) => ({
      candidatesByRowId: {
        ...state.candidatesByRowId,
        [rowId]: candidates,
      },
    })),
  replaceCandidates: (candidatesByRowId) => set({ candidatesByRowId }),
  selectCandidate: (rowId, candidateId) =>
    set((state) => ({
      rows: state.rows.map((row) =>
        row.id === rowId
          ? {
              ...row,
              selectedCandidateId: candidateId,
              resolutionState: candidateId ? 'resolved' : row.resolutionState === 'error' ? 'error' : row.resolutionState,
            }
          : row,
      ),
    })),
  setRequestStatus: (requestStatus, errorMessage = null) => set({ requestStatus, errorMessage }),
  setResolveStatus: (resolveStatus, resolveErrorMessage = null) => set({ resolveStatus, resolveErrorMessage }),
  resetForRestart: () => set(initialState),
}))
