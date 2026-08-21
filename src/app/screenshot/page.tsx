'use client'

import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  MAX_SCREENSHOT_UPLOADS,
  persistScreenshotUploadSession,
} from '@/lib/screenshot-ocr'
import { readAppliedHomePortfolio } from '@/lib/jaroo-home-data'
import { useDeepScanStore } from '@/lib/stores/use-deepscan-store'
import { useMergeStore } from '@/lib/stores/use-merge-store'
import { useOcrReviewStore } from '@/lib/stores/use-ocr-review-store'
import { useOcrUploadStore } from '@/lib/stores/use-ocr-upload-store'
import { usePortfolioStore } from '@/lib/stores/use-portfolio-store'

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

function UploadDesignStyles() {
  return (
    <style>{`
      .jaroo-upload-page *{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,'Pretendard',sans-serif;-webkit-font-smoothing:antialiased}
      /* 루트 PhoneFrame 안에 또 폰 박스를 그리지 않는다. 바깥 프레임을 그대로 채운다. */
      .jaroo-upload-page{background:#F5F6F8;display:flex;height:100%;width:100%;color:#0F1419}
      .jaroo-upload-frame{background:#F5F6F8;width:100%;height:100%;overflow-y:auto;overflow-x:hidden;position:relative}
      .jaroo-upload-frame::-webkit-scrollbar{display:none}
      .jaroo-upload-head{position:sticky;top:0;z-index:10;background:rgba(245,246,248,.94);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);padding:14px 16px;border-bottom:.5px solid #E8EAEE;display:flex;align-items:center;gap:11px}
      .jaroo-upload-head-back{width:28px;height:28px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;font-size:14px;color:#0F1419;box-shadow:0 1px 2px rgba(0,0,0,.04);border:0;cursor:pointer;line-height:1}
      .jaroo-upload-head-title{font-size:15px;font-weight:600;color:#0F1419;flex:1}
      .jaroo-upload-head-login{min-height:28px;border-radius:999px;background:#fff;display:inline-flex;align-items:center;justify-content:center;padding:0 11px;font-size:12px;font-weight:700;color:#2B6BE6;text-decoration:none;box-shadow:0 1px 2px rgba(0,0,0,.04)}
      .jaroo-upload-body{padding:18px 16px 24px}
      .jaroo-upload-body.first{padding-top:24px}
      .jaroo-upload-logo{font-size:22px;font-weight:700;color:#0F1419;letter-spacing:-.5px;margin-bottom:6px}
      .jaroo-upload-intro{font-size:14px;color:#5A6473;line-height:1.5;margin-bottom:20px}
      .jaroo-upload-intro b{color:#0F1419;font-weight:600}
      .jaroo-upload-lead{font-size:13px;color:#5A6473;line-height:1.5;margin-bottom:16px}
      .jaroo-upload-lead b{color:#0F1419;font-weight:600}
      .jaroo-upload-ex-card{background:#fff;border-radius:14px;border:.5px solid #E8EAEE;box-shadow:0 1px 3px rgba(0,0,0,.04);padding:14px 16px;margin-bottom:14px}
      .jaroo-upload-ex-head{display:flex;align-items:center;gap:8px;margin-bottom:12px}
      .jaroo-upload-ex-check{width:20px;height:20px;border-radius:50%;background:#E5F3EB;display:flex;align-items:center;justify-content:center;font-size:11px;color:#1A7340;flex-shrink:0}
      .jaroo-upload-ex-label{font-size:12px;font-weight:600;color:#0F1419}
      .jaroo-upload-ex-mock{background:#F5F6F8;border-radius:10px;padding:4px 12px;margin-bottom:11px}
      .jaroo-upload-ex-row{display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:.5px solid #E8EAEE}
      .jaroo-upload-ex-row:last-child{border-bottom:none}
      .jaroo-upload-exr-name{font-size:12px;font-weight:600;color:#0F1419}
      .jaroo-upload-exr-cnt{font-size:10px;color:#97A0AE;margin-top:1px}
      .jaroo-upload-exr-amt{font-size:12px;font-weight:600;color:#0F1419;font-variant-numeric:tabular-nums;text-align:right}
      .jaroo-upload-exr-rate{font-size:10px;margin-top:1px;font-variant-numeric:tabular-nums;text-align:right}
      .jaroo-upload-exr-rate.up{color:var(--jaroo-profit)}.jaroo-upload-exr-rate.down{color:var(--jaroo-loss)}
      .jaroo-upload-ex-hint{font-size:11.5px;color:#5A6473;line-height:1.55;text-align:center}
      .jaroo-upload-ex-hint b{color:#2B6BE6;font-weight:600}
      .jaroo-upload-upzone{display:block;width:100%;background:#fff;border-radius:14px;border:1.5px dashed #B8C4D4;padding:26px 16px;text-align:center;cursor:pointer;margin-bottom:12px;appearance:none}
      .jaroo-upload-upzone:disabled{cursor:default;opacity:1}
      .jaroo-upload-up-icon{width:50px;height:50px;border-radius:50%;background:#2B6BE6;display:flex;align-items:center;justify-content:center;margin:0 auto 11px;font-size:22px}
      .jaroo-upload-up-label{font-size:14.5px;font-weight:600;color:#0F1419;margin-bottom:4px}
      .jaroo-upload-up-hint{font-size:11.5px;color:#97A0AE}
      .jaroo-upload-up-note{font-size:10.5px;color:#97A0AE;text-align:center;margin-bottom:14px}
      .jaroo-upload-error{font-size:11px;color:#E5484D;text-align:center;margin:-5px 0 12px;line-height:1.45}
      .jaroo-upload-privacy{font-size:10px;color:#97A0AE;text-align:center;margin-top:8px;line-height:1.5}
      .jaroo-upload-load-wrap{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 16px}
      .jaroo-upload-load-thumb{width:120px;height:150px;border-radius:12px;background:#fff;border:.5px solid #E8EAEE;box-shadow:0 2px 12px rgba(0,0,0,.06);margin-bottom:24px;position:relative;overflow:hidden}
      .jaroo-upload-load-thumb-line{height:9px;background:#EEF0F3;border-radius:3px;margin:11px 12px}
      .jaroo-upload-scan-line{position:absolute;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,#2B6BE6,transparent);animation:jarooUploadScan 1.8s ease-in-out infinite;box-shadow:0 0 8px rgba(43,107,230,.6)}
      @keyframes jarooUploadScan{0%{top:8%}50%{top:88%}100%{top:8%}}
      .jaroo-upload-spinner{width:34px;height:34px;border:3px solid #E8EAEE;border-top-color:#2B6BE6;border-radius:50%;animation:jarooUploadSpin .8s linear infinite;margin-bottom:16px}
      @keyframes jarooUploadSpin{to{transform:rotate(360deg)}}
      .jaroo-upload-load-txt{font-size:14px;font-weight:600;color:#0F1419;margin-bottom:5px}
      .jaroo-upload-load-sub{font-size:11.5px;color:#97A0AE}
      .jaroo-upload-file-input{display:none}
    `}</style>
  )
}

function ExampleCard({ firstUser }: { firstUser: boolean }) {
  return (
    <div className='jaroo-upload-ex-card'>
      <div className='jaroo-upload-ex-head'>
        <div className='jaroo-upload-ex-check'>✓</div>
        <div className='jaroo-upload-ex-label'>{firstUser ? '이렇게 보이는 화면을 올려주세요' : '이렇게 보이는 화면이 좋아요'}</div>
      </div>
      <div className='jaroo-upload-ex-mock'>
        {[
          ['삼성전자', '1주', '321,000원', '+40.9%', 'up'],
          ['LG디스플레이', '16주', '227,040원', '−0.4%', 'down'],
          ['SFA반도체', '23주', '224,710원', '−14.3%', 'down'],
        ].map(([name, count, amount, rate, tone]) => (
          <div key={name} className='jaroo-upload-ex-row'>
            <div>
              <div className='jaroo-upload-exr-name'>{name}</div>
              <div className='jaroo-upload-exr-cnt'>{count}</div>
            </div>
            <div>
              <div className='jaroo-upload-exr-amt'>{amount}</div>
              <div className={`jaroo-upload-exr-rate ${tone}`}>{rate}</div>
            </div>
          </div>
        ))}
      </div>
      <div className='jaroo-upload-ex-hint'><b>종목명 · 수량 · 평가금액</b>이<br />또렷하게 보이면 잘 읽혀요.</div>
    </div>
  )
}

function LoadingPanel() {
  return (
    <div className='jaroo-upload-load-wrap'>
      <div className='jaroo-upload-load-thumb'>
        <div className='jaroo-upload-load-thumb-line' style={{ width: '60%' }} />
        <div className='jaroo-upload-load-thumb-line' style={{ width: '80%' }} />
        <div className='jaroo-upload-load-thumb-line' style={{ width: '50%' }} />
        <div className='jaroo-upload-load-thumb-line' style={{ width: '75%' }} />
        <div className='jaroo-upload-load-thumb-line' style={{ width: '55%' }} />
        <div className='jaroo-upload-load-thumb-line' style={{ width: '70%' }} />
        <div className='jaroo-upload-scan-line' />
      </div>
      <div className='jaroo-upload-spinner' />
      <div className='jaroo-upload-load-txt'>종목을 읽고 있어요…</div>
      <div className='jaroo-upload-load-sub'>보통 5초 정도 걸려요</div>
    </div>
  )
}

export default function ScreenshotPage() {
  const router = useRouter()
  const setUploadInput = useOcrUploadStore((state) => state.setInput)
  const portfolioItemCount = usePortfolioStore((state) => state.items.length)
  const clearReviewState = useOcrReviewStore((state) => state.resetForRestart)
  const clearMergeState = useMergeStore((state) => state.resetForBackNav)
  const clearDeepScanState = useDeepScanStore((state) => state.clear)
  const [isPreparing, setIsPreparing] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const photoInputRef = useRef<HTMLInputElement>(null)
  const [hasAppliedPortfolio, setHasAppliedPortfolio] = useState(false)
  const [showLoginAction, setShowLoginAction] = useState(true)
  const isFirstPortfolio = portfolioItemCount === 0 && !hasAppliedPortfolio

  useEffect(() => {
    const syncAppliedPortfolio = window.setTimeout(() => {
      setHasAppliedPortfolio(Boolean(readAppliedHomePortfolio()?.rows.length))
    }, 0)

    return () => window.clearTimeout(syncAppliedPortfolio)
  }, [])

  useEffect(() => {
    let active = true

    void (async () => {
      try {
        const response = await fetch('/api/auth/me', { cache: 'no-store' })
        if (!response.ok) {
          return
        }

        const payload = (await response.json()) as { authScope?: string }
        if (active) {
          setShowLoginAction(payload.authScope !== 'authenticated')
        }
      } catch {
        if (active) {
          setShowLoginAction(true)
        }
      }
    })()

    return () => {
      active = false
    }
  }, [])

  const handleBack = () => {
    const canUseBrowserBack = (() => {
      try {
        return window.history.length > 1
          && Boolean(document.referrer)
          && new URL(document.referrer).origin === window.location.origin
      } catch {
        return false
      }
    })()

    if (canUseBrowserBack) {
      router.back()
      return
    }

    router.push('/home')
  }

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    setIsPreparing(true)

    if (files.length === 0) {
      setIsPreparing(false)
      return
    }

    if (files.length > MAX_SCREENSHOT_UPLOADS) {
      setErrorMessage(`한 번에 최대 ${MAX_SCREENSHOT_UPLOADS}장까지 업로드할 수 있어요.`)
      setIsPreparing(false)
      return
    }

    if (files.some((file) => !file.type.startsWith('image/'))) {
      setErrorMessage('이미지 파일만 업로드할 수 있어요.')
      setIsPreparing(false)
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
      setIsPreparing(false)
      return
    }

    const totalImagePayloadLength = nextUploads.reduce((sum, upload) => sum + upload.imageDataUrl.length, 0)

    if (totalImagePayloadLength > MAX_TOTAL_IMAGE_DATA_URL_LENGTH) {
      setErrorMessage('선택한 이미지 용량이 너무 커요. 장수를 줄이거나 더 작은 스크린샷으로 다시 시도해주세요.')
      setIsPreparing(false)
      return
    }

    try {
      const nextSession = {
        broker: PERSISTED_SCREENSHOT_BROKER,
        uploads: nextUploads,
      }

      clearReviewState()
      clearMergeState()
      clearDeepScanState()
      persistScreenshotUploadSession(nextSession)
      setUploadInput(nextSession)
      router.push('/ocr')

      window.setTimeout(() => {
        if (window.location.pathname !== '/ocr') {
          window.location.assign('/ocr')
        }
      }, 800)
    } catch {
      setIsPreparing(false)
      setErrorMessage('이미지 임시 저장에 실패했어요. 장수를 줄이거나 더 작은 스크린샷으로 다시 시도해주세요.')
    }
  }

  return (
    <div className='jaroo-upload-page'>
      <UploadDesignStyles />
      <div className='jaroo-upload-frame'>
        <div className='jaroo-upload-head'>
          <button type='button' className='jaroo-upload-head-back' onClick={handleBack} aria-label='뒤로 가기'>←</button>
          <div className='jaroo-upload-head-title'>스크린샷 추가</div>
          {showLoginAction ? <Link href='/login' className='jaroo-upload-head-login'>로그인</Link> : null}
        </div>

        {isPreparing ? (
          <LoadingPanel />
        ) : (
          <div className={`jaroo-upload-body ${isFirstPortfolio ? 'first' : ''}`}>
            {isFirstPortfolio ? (
              <>
                <div className='jaroo-upload-logo'>Jaroo</div>
                <div className='jaroo-upload-intro'>MTS 스크린샷 한 장으로<br /><b>내 주식을 AI가 진단</b>해드려요.</div>
              </>
            ) : (
              <div className='jaroo-upload-lead'><b>MTS 보유 종목 화면</b>을 올려주세요.<br />종목을 자동으로 읽어드려요.</div>
            )}

            <ExampleCard firstUser={isFirstPortfolio} />

            <button type='button' className='jaroo-upload-upzone' onClick={() => photoInputRef.current?.click()}>
              <div className='jaroo-upload-up-icon'>📷</div>
              <div className='jaroo-upload-up-label'>스크린샷 올리기</div>
              <div className='jaroo-upload-up-hint'>탭해서 카메라·갤러리에서 선택</div>
            </button>
            <div className='jaroo-upload-up-note'>최대 5장까지 · 여러 계좌면 나눠 올려도 돼요</div>
            {errorMessage ? <div className='jaroo-upload-error'>{errorMessage}</div> : null}
            <div className='jaroo-upload-privacy'>개인정보는 분석 후 즉시 안전하게 파기됩니다</div>
          </div>
        )}

        <input ref={photoInputRef} type='file' accept='image/*' multiple className='jaroo-upload-file-input' onChange={handleFileChange} />
      </div>
    </div>
  )
}
