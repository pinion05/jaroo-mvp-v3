'use client'

import Image from 'next/image'
import { useEffect, useState, type ChangeEvent } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Camera, Check, ImageUp, Sparkles } from 'lucide-react'
import { JarooShell } from '@/components/jaroo-shell'
import { Button } from '@/components/ui/button'
import { brokerOptions } from '@/lib/jaroo-data'
import { SCREENSHOT_OCR_STORAGE_KEY, type ScreenshotUploadSession } from '@/lib/screenshot-ocr'
import { cn } from '@/lib/utils'

export default function ScreenshotPage() {
  const router = useRouter()
  const [selectedBroker, setSelectedBroker] = useState(brokerOptions[0] ?? '')
  const [selectedFileName, setSelectedFileName] = useState('')
  const [previewUrl, setPreviewUrl] = useState('')
  const [imageDataUrl, setImageDataUrl] = useState('')
  const [isPreparing, setIsPreparing] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl)
      }
    }
  }, [previewUrl])

  const handleBack = () => {
    if (window.history.length > 1) {
      router.back()
      return
    }

    router.push('/home')
  }

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]

    if (!file) {
      return
    }

    if (!file.type.startsWith('image/')) {
      setErrorMessage('이미지 파일만 업로드할 수 있어요.')
      return
    }

    setErrorMessage('')
    setSelectedFileName(file.name)

    setPreviewUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current)
      }

      return URL.createObjectURL(file)
    })

    const dataUrl = await new Promise<string>((resolve, reject) => {
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
    }).catch(() => '')

    if (!dataUrl) {
      setErrorMessage('이미지를 읽는 중 문제가 생겼어요. 다시 시도해주세요.')
      setImageDataUrl('')
      return
    }

    setImageDataUrl(dataUrl)
  }

  const handleContinue = () => {
    if (!imageDataUrl || !selectedFileName) {
      setErrorMessage('먼저 스크린샷 이미지를 선택해주세요.')
      return
    }

    setIsPreparing(true)

    const payload: ScreenshotUploadSession = {
      broker: selectedBroker,
      fileName: selectedFileName,
      imageDataUrl,
    }

    sessionStorage.setItem(SCREENSHOT_OCR_STORAGE_KEY, JSON.stringify(payload))
    router.push('/ocr')
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
              imageDataUrl
                ? 'border-[color:var(--jaroo-success)]/55 bg-[color:var(--jaroo-success-ghost)]'
                : 'border-[color:var(--jaroo-primary)]/30 bg-[color:var(--jaroo-accent)]/40',
            )}
          >
            {previewUrl ? (
              <div className='space-y-3'>
                <div className='mx-auto flex size-12 items-center justify-center rounded-full bg-[color:var(--jaroo-success)]/12 text-[color:var(--jaroo-success)]'>
                  <Check className='size-5' strokeWidth={2.5} />
                </div>
                <div>
                  <p className='text-[14px] font-medium text-[color:var(--jaroo-success)]'>스크린샷 선택됨</p>
                  <p className='mt-1 text-[11px] text-[color:var(--jaroo-muted)]'>{selectedFileName}</p>
                </div>
                <div className='relative mx-auto h-44 w-full max-w-[220px] overflow-hidden rounded-[20px] border border-white/80 bg-white shadow-sm'>
                  <Image src={previewUrl} alt={selectedFileName || '업로드된 스크린샷 미리보기'} fill unoptimized className='object-cover' />
                </div>
              </div>
            ) : (
              <>
                <div className='mx-auto flex size-12 items-center justify-center rounded-full bg-[color:var(--jaroo-primary)] text-white'>
                  <Camera className='size-5' />
                </div>
                <p className='mt-3 text-[14px] font-medium text-[color:var(--jaroo-ink)]'>스크린샷 업로드</p>
                <p className='mt-1 text-[11px] text-[color:var(--jaroo-muted)]'>아래 파일 선택 버튼으로 실제 이미지를 고르세요</p>
              </>
            )}
          </div>

          <input
            id='screenshot-upload'
            type='file'
            accept='image/*'
            onChange={handleFileChange}
            className='block w-full cursor-pointer rounded-[18px] border border-[color:var(--jaroo-border)] bg-white px-3 py-2 text-[12px] text-[color:var(--jaroo-ink)] file:mr-3 file:rounded-[12px] file:border-0 file:bg-[color:var(--jaroo-primary)] file:px-3 file:py-2 file:text-[12px] file:font-medium file:text-white'
          />

          {errorMessage ? <p className='text-[11px] text-[#D54841]'>{errorMessage}</p> : null}
          <p className='text-[10px] text-[color:var(--jaroo-muted)]'>debug build: upload-v3</p>
        </section>

        <section className='space-y-2'>
          <p className='text-[11px] tracking-[0.04em] text-[color:var(--jaroo-muted)]'>어느 증권사 화면인가요?</p>
          <div className='flex flex-wrap gap-2'>
            {brokerOptions.map((broker) => {
              const isActive = broker === selectedBroker

              return (
                <button
                  key={broker}
                  type='button'
                  onClick={() => setSelectedBroker(broker)}
                  className={cn(
                    'rounded-xl border px-3 py-2 text-[12px] font-medium transition',
                    isActive
                      ? 'border-[color:var(--jaroo-primary)]/25 bg-[color:var(--jaroo-accent)] text-[color:var(--jaroo-primary)]'
                      : 'border-[color:var(--jaroo-border)] bg-white text-[color:var(--jaroo-muted)] hover:bg-[color:var(--jaroo-secondary)]',
                  )}
                >
                  {broker}
                </button>
              )
            })}
          </div>
        </section>

        <div className='space-y-2 pt-1'>
          <Button
            type='button'
            onClick={handleContinue}
            disabled={!imageDataUrl || isPreparing}
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
