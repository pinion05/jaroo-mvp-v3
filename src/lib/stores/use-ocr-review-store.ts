import { create } from 'zustand'

import type { OcrReviewRow, ResolveCandidate, WorkflowAsyncStatus } from '@/lib/workflow-types'

type OcrReviewStoreState = {
  rows: OcrReviewRow[]
  candidatesByRowId: Record<string, ResolveCandidate[]>
  requestStatus: WorkflowAsyncStatus
  errorMessage: string | null
}

type OcrReviewStoreActions = {
  setRows: (rows: OcrReviewRow[]) => void
  upsertRow: (row: OcrReviewRow) => void
  setCandidates: (rowId: string, candidates: ResolveCandidate[]) => void
  selectCandidate: (rowId: string, candidateId: string | null) => void
  setRequestStatus: (status: WorkflowAsyncStatus, errorMessage?: string | null) => void
  resetForRestart: () => void
}

const initialState: OcrReviewStoreState = {
  rows: [],
  candidatesByRowId: {},
  requestStatus: 'idle',
  errorMessage: null,
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
  setCandidates: (rowId, candidates) =>
    set((state) => ({
      candidatesByRowId: {
        ...state.candidatesByRowId,
        [rowId]: candidates,
      },
    })),
  selectCandidate: (rowId, candidateId) =>
    set((state) => ({
      rows: state.rows.map((row) => (row.id === rowId ? { ...row, selectedCandidateId: candidateId } : row)),
    })),
  setRequestStatus: (requestStatus, errorMessage = null) => set({ requestStatus, errorMessage }),
  resetForRestart: () => set(initialState),
}))
