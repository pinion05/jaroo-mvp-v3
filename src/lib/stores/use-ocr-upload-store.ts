import { create } from 'zustand'

import type { ScreenshotUploadInput } from '@/lib/workflow-types'

type OcrUploadStoreState = {
  input: ScreenshotUploadInput | null
}

type OcrUploadStoreActions = {
  setInput: (input: ScreenshotUploadInput) => void
  clear: () => void
}

const initialState: OcrUploadStoreState = {
  input: null,
}

export const useOcrUploadStore = create<OcrUploadStoreState & OcrUploadStoreActions>()((set) => ({
  ...initialState,
  setInput: (input) => set({ input }),
  clear: () => set(initialState),
}))
