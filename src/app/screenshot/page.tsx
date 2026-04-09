'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Camera, Check, Sparkles } from 'lucide-react'
import { JarooShell } from '@/components/jaroo-shell'
import { Button, buttonVariants } from '@/components/ui/button'
import { brokerOptions } from '@/lib/jaroo-data'
import { cn } from '@/lib/utils'

const selectedScreenshotName = 'Screenshot_20260406.jpg'

export default function ScreenshotPage() {
  const router = useRouter()
  const [selectedBroker, setSelectedBroker] = useState(brokerOptions[0] ?? '')
  const [isUploaded, setIsUploaded] = useState(false)

  const handleBack = () => {
    if (window.history.length > 1) {
      router.back()
      return
    }

    router.push('/home')
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

          <button
            type='button'
            onClick={() => setIsUploaded(true)}
            className={cn(
              'w-full rounded-[24px] border border-dashed px-4 py-7 text-center transition',
              isUploaded
                ? 'border-[color:var(--jaroo-success)]/55 bg-[color:var(--jaroo-success-ghost)]'
                : 'border-[color:var(--jaroo-primary)]/30 bg-[color:var(--jaroo-accent)]/40 hover:bg-[color:var(--jaroo-accent)]/60',
            )}
          >
            {isUploaded ? (
              <>
                <div className='mx-auto flex size-12 items-center justify-center rounded-full bg-[color:var(--jaroo-success)]/12 text-[color:var(--jaroo-success)]'>
                  <Check className='size-5' strokeWidth={2.5} />
                </div>
                <p className='mt-3 text-[14px] font-medium text-[color:var(--jaroo-success)]'>스크린샷 선택됨</p>
                <p className='mt-1 text-[11px] text-[color:var(--jaroo-muted)]'>{selectedScreenshotName}</p>
              </>
            ) : (
              <>
                <div className='mx-auto flex size-12 items-center justify-center rounded-full bg-[color:var(--jaroo-primary)] text-white'>
                  <Camera className='size-5' />
                </div>
                <p className='mt-3 text-[14px] font-medium text-[color:var(--jaroo-ink)]'>스크린샷 업로드</p>
                <p className='mt-1 text-[11px] text-[color:var(--jaroo-muted)]'>탭해서 갤러리에서 선택</p>
              </>
            )}
          </button>
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
          <Link
            href='/ocr'
            className={buttonVariants({
              className:
                'h-12 w-full rounded-[20px] bg-[color:var(--jaroo-primary)] text-[14px] font-medium text-white hover:bg-[color:var(--jaroo-primary-strong)]',
            })}
          >
            <span className='flex items-center gap-2'>
              <Sparkles className='size-4' />
              종목 자동 추출하기
            </span>
          </Link>

          <Button
            type='button'
            variant='outline'
            className='h-12 w-full rounded-[20px] border-[color:var(--jaroo-border)] bg-white text-[13px] text-[color:var(--jaroo-muted)] shadow-none hover:bg-[color:var(--jaroo-secondary)]'
          >
            취소
          </Button>
        </div>

        <p className='pt-0.5 text-center text-[10px] text-[#b8c0cb]'>개인정보는 분석 후 즉시 안전하게 파기됩니다</p>
      </div>
    </JarooShell>
  )
}
