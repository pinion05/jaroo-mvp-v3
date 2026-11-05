import type { Metadata, Viewport } from 'next'
import 'pretendard/dist/web/static/pretendard-dynamic-subset.css'
import './globals.css'
import { DebugPageNav } from '@/components/debug-page-nav'
import { buildJarooRuntimeEnvScript } from '@/lib/jaroo-runtime-env'
import { isPaymentsPipelineConfigured } from '@/lib/payments/config'

// 런타임 env 주입(window.__JAROO_ENV__)이 빌드타임 프리렌더에 빈 값으로 구워지지
// 않도록 요청시 렌더로 강제한다(2026-10-27 실측: x-nextjs-prerender=1에서 {} 주입 확인).
// 프리렌더 HTML이 s-maxage=1년으로 캐시되던 것도 함께 해소 — 값은 항상 최신 런타임 env.
export const dynamic = 'force-dynamic'

// jaroo.kr 운영 도메인 기준 절대 URL 생성용(OG/Twitter 이미지·캐논ical).
// 상대 경로 메타 이미지는 카톡/디스코드 일부 크롤러에서 무시되므로 metadataBase가 필요하다.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://jaroo.kr'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'Jaroo — MTS 스크린샷 한 장으로 AI 주식 진단',
  description:
    'MTS 스크린샷 한 장만 올리면 AI 위원회가 내 포트폴리오를 진단합니다. 딥스캔 · 원금회수 예측 · 포트폴리오 시뮬레이션을 jaroo에서.',
  applicationName: 'Jaroo',
  openGraph: {
    type: 'website',
    locale: 'ko_KR',
    siteName: 'Jaroo',
    url: '/',
    title: 'Jaroo — MTS 스크린샷 한 장으로 AI 주식 진단',
    description:
      'MTS 스크린샷 한 장만 올리면 AI 위원회가 내 포트폴리오를 진단합니다. 딥스캔 · 원금회수 예측 · 포트폴리오 시뮬레이션.',
    images: [
      {
        url: '/opengraph-image.png',
        width: 1200,
        height: 630,
        alt: 'Jaroo — MTS 스크린샷 한 장으로 내 주식을 AI가 진단',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Jaroo — MTS 스크린샷 한 장으로 AI 주식 진단',
    description:
      'MTS 스크린샷 한 장만 올리면 AI 위원회가 내 포트폴리오를 진단합니다. 딥스캔 · 원금회수 예측 · 포트폴리오 시뮬레이션.',
    images: ['/opengraph-image.png'],
  },
}

// Next 16: themeColor는 viewport export로 분리되어 있다(metadata.viewport 불가).
export const viewport: Viewport = {
  themeColor: '#eef4f8',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // suppressHydrationWarning: Immersive Translate 등 브라우저 확장이 hydration 전에
  // <html>/<body>에 속성을 끼워넣어 발생하는 hydration mismatch를 방지
  return (
    <html
      lang='ko'
      className='h-full antialiased'
      suppressHydrationWarning
    >
      <body className='min-h-full bg-background font-sans text-foreground' suppressHydrationWarning>
        {/* 런타임 env 주입 — 빌드타임 NEXT_PUBLIC_* 스냅샷 stale 회피(2026-10-27). 첫 페인트 전에 심는다. */}
        <script dangerouslySetInnerHTML={{ __html: buildJarooRuntimeEnvScript({
          supabaseUrl: process.env.SUPABASE_URL?.trim(),
          supabaseAnonKey: process.env.SUPABASE_ANON_KEY?.trim(),
          devAutoLogin: process.env.NEXT_PUBLIC_DEV_AUTO_LOGIN?.trim() === '1' || process.env.DEV_AUTO_LOGIN?.trim() === '1',
          paymentsOpen: isPaymentsPipelineConfigured(),
        }) }} />
        <DebugPageNav />
        <div className='min-h-dvh w-full bg-[color:var(--jaroo-canvas)] sm:px-6 sm:py-4'>
        {/* h-dvh(확정 높이): 내부 스크롤 컨테이너(main/tabbar)가 높이 제한을 받아
            sticky bottom nav 가 동작하는 핵심. min-h 만으로는 박스가 콘텐츠만큼 커져
            body 가 스크롤되고 nav 가 콘텐츠 맨 아래로 내려가 버린다. */}
          {/* sm:max-w: 데스크톱에서만 390px 목업. 모바일(390~430px 폰)은 w-full 풀블리드여야
              하는데 무접두사 max-w 면 좌우에 캔버스색 거터가 생겨 앱이 잘려 보인다. */}
          <div className='relative mx-auto flex h-dvh w-full flex-col overflow-hidden bg-white [transform:translateZ(0)] sm:h-[calc(100dvh-2rem)] sm:max-w-[390px] sm:rounded-[32px] sm:shadow-[0_20px_60px_rgba(12,68,124,0.18)]'>
            {children}
          </div>
        </div>
      </body>
    </html>
  )
}
