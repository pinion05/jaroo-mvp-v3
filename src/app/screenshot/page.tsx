'use client'

import Image from 'next/image'
import { useMemo, useState, type ChangeEvent } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Camera, ImagePlus, ImageUp, Sparkles } from 'lucide-react'
import { JarooShell } from '@/components/jaroo-shell'
import { Button } from '@/components/ui/button'
import {
  MAX_SCREENSHOT_UPLOADS,
  type ScreenshotUploadImage,
} from '@/lib/screenshot-ocr'
import { useDeepScanStore } from '@/lib/stores/use-deepscan-store'
import { useMergeStore } from '@/lib/stores/use-merge-store'
import { useOcrReviewStore } from '@/lib/stores/use-ocr-review-store'
import { useOcrUploadStore } from '@/lib/stores/use-ocr-upload-store'
import { cn } from '@/lib/utils'

const MAX_TOTAL_IMAGE_DATA_URL_LENGTH = 4_000_000
const PERSISTED_SCREENSHOT_BROKER = '기타'

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
        return
      }

      reject(new Error('이미지를 읽을 수 없습니다.'))
    }

    reader.onerror = () => reject(new Error('이미지를 읽을 수 없습니다.'))
    reader.readAsDataURL(file)
  })
}

export default function ScreenshotPage() {
  const router = useRouter()
  const setUploadInput = useOcrUploadStore((state) => state.setInput)
  const clearReviewState = useOcrReviewStore((state) => state.resetForRestart)
  const clearMergeState = useMergeStore((state) => state.resetForBackNav)
  const clearDeepScanState = useDeepScanStore((state) => state.clear)
  const [uploads, setUploads] = useState<ScreenshotUploadImage[]>([])
  const [isPreparing, setIsPreparing] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const uploadSummaryText = useMemo(() => {
    if (uploads.length === 0) {
      return '아래 파일 선택 버튼으로 실제 이미지를 고르세요'
    }

    return `${uploads.length}장 선택됨 · /ocr에서 순서대로 분석돼요`
  }, [uploads.length])

  const handleBack = () => {
    if (window.history.length > 1) {
      router.back()
      return
    }

    router.push('/home')
  }

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''

    if (files.length === 0) {
      return
    }

    if (files.length > MAX_SCREENSHOT_UPLOADS) {
      setErrorMessage(`한 번에 최대 ${MAX_SCREENSHOT_UPLOADS}장까지 업로드할 수 있어요.`)
      return
    }

    if (files.some((file) => !file.type.startsWith('image/'))) {
      setErrorMessage('이미지 파일만 업로드할 수 있어요.')
      return
    }

    setErrorMessage('')

    const nextUploads = await Promise.all(
      files.map(async (file, index) => ({
        id: `${Date.now()}-${index}-${file.name}`,
        fileName: file.name,
        imageDataUrl: await readFileAsDataUrl(file),
      })),
    ).catch(() => null)

    if (!nextUploads) {
      setErrorMessage('이미지를 읽는 중 문제가 생겼어요. 다시 시도해주세요.')
      setUploads([])
      return
    }

    const totalImagePayloadLength = nextUploads.reduce((sum, upload) => sum + upload.imageDataUrl.length, 0)

    if (totalImagePayloadLength > MAX_TOTAL_IMAGE_DATA_URL_LENGTH) {
      setErrorMessage('선택한 이미지 용량이 너무 커요. 장수를 줄이거나 더 작은 스크린샷으로 다시 시도해주세요.')
      setUploads([])
      return
    }

    setUploads(nextUploads)
  }

  const handleContinue = () => {
    if (uploads.length === 0) {
      setErrorMessage('먼저 스크린샷 이미지를 선택해주세요.')
      return
    }

    setIsPreparing(true)

    const payload = {
      broker: PERSISTED_SCREENSHOT_BROKER,
      uploads,
    }

    try {
      clearReviewState()
      clearMergeState()
      clearDeepScanState()
      setUploadInput(payload)
      router.push('/ocr')
    } catch {
      setIsPreparing(false)
      setErrorMessage('이미지 임시 저장에 실패했어요. 장수를 줄이거나 더 작은 스크린샷으로 다시 시도해주세요.')
    }
  }

  return (
    <JarooShell
      title='스크린샷 추가'
      leading={
        <Button
          type='button'
          variant='ghost'
          size='icon-lg'
          onClick={handleBack}
          className='size-9 rounded-full bg-[color:var(--jaroo-secondary)] text-[color:var(--jaroo-ink)] hover:bg-[color:var(--jaroo-accent)]'
        >
          <ArrowLeft className='size-4' />
          <span className='sr-only'>뒤로 가기</span>
        </Button>
      }
      showBottomNav={false}
      mainClassName='px-4 py-4'
    >
      <div className='space-y-4'>
        <section className='space-y-2'>
          <p className='text-[11px] tracking-[0.04em] text-[color:var(--jaroo-muted)]'>추가할 MTS 보유 종목 화면을 올려주세요</p>

          <div
            className={cn(
              'w-full rounded-[24px] border border-dashed px-4 py-5 text-center transition',
              uploads.length > 0
                ? 'border-[color:var(--jaroo-success)]/55 bg-[color:var(--jaroo-success-ghost)]'
                : 'border-[color:var(--jaroo-primary)]/30 bg-[color:var(--jaroo-accent)]/40',
            )}
          >
            <div className='mx-auto flex size-12 items-center justify-center rounded-full bg-[color:var(--jaroo-primary)] text-white'>
              {uploads.length > 0 ? <ImagePlus className='size-5' /> : <Camera className='size-5' />}
            </div>
            <p className='mt-3 text-[14px] font-medium text-[color:var(--jaroo-ink)]'>스크린샷 업로드</p>
            <p className='mt-1 text-[11px] text-[color:var(--jaroo-muted)]'>{uploadSummaryText}</p>

            {uploads.length > 0 ? (
              <div className='mt-4 grid grid-cols-3 gap-2'>
                {uploads.map((upload, index) => (
                  <div key={upload.id} className='overflow-hidden rounded-[18px] border border-white/90 bg-white shadow-sm'>
                    <div className='relative aspect-[3/4]'>
                      <Image src={upload.imageDataUrl} alt={upload.fileName} fill unoptimized className='object-cover' />
                    </div>
                    <div className='border-t border-[color:var(--jaroo-border)] px-2 py-2 text-left'>
                      <p className='truncate text-[10px] font-medium text-[color:var(--jaroo-ink)]'>{index + 1}. {upload.fileName}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <input
            id='screenshot-upload'
            type='file'
            accept='image/*'
            multiple
            onChange={handleFileChange}
            className='block w-full cursor-pointer rounded-[18px] border border-[color:var(--jaroo-border)] bg-white px-3 py-2 text-[12px] text-[color:var(--jaroo-ink)] file:mr-3 file:rounded-[12px] file:border-0 file:bg-[color:var(--jaroo-primary)] file:px-3 file:py-2 file:text-[12px] file:font-medium file:text-white'
          />

          {errorMessage ? <p className='text-[11px] text-[#D54841]'>{errorMessage}</p> : null}
          <p className='text-[10px] text-[color:var(--jaroo-muted)]'>최대 {MAX_SCREENSHOT_UPLOADS}장까지 선택 가능 · 다시 선택하면 새 목록으로 바뀌어요</p>
        </section>

        <div className='space-y-2 pt-1'>
          <Button
            type='button'
            onClick={handleContinue}
            disabled={uploads.length === 0 || isPreparing}
            className='h-12 w-full rounded-[20px] bg-[color:var(--jaroo-primary)] text-[14px] font-medium text-white hover:bg-[color:var(--jaroo-primary-strong)] disabled:bg-[color:var(--jaroo-primary)] disabled:opacity-45'
          >
            <span className='flex items-center gap-2'>
              <Sparkles className='size-4' />
              {isPreparing ? '분석 화면으로 이동 중...' : '종목 자동 추출하기'}
            </span>
          </Button>

          <Button
            type='button'
            variant='outline'
            onClick={() => router.push('/home')}
            className='h-12 w-full rounded-[20px] border-[color:var(--jaroo-border)] bg-white text-[13px] text-[color:var(--jaroo-muted)] shadow-none hover:bg-[color:var(--jaroo-secondary)]'
          >
            <span className='flex items-center gap-2'>
              <ImageUp className='size-4' />
              취소
            </span>
          </Button>
        </div>

        <p className='pt-0.5 text-center text-[10px] text-[#b8c0cb]'>개인정보는 분석 후 즉시 안전하게 파기됩니다</p>
      </div>
    </JarooShell>
  )
}
