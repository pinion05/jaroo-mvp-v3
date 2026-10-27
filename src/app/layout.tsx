import type { Metadata } from 'next'
import { Noto_Sans_KR } from 'next/font/google'
import './globals.css'
import { DebugPageNav } from '@/components/debug-page-nav'
import { buildJarooRuntimeEnvScript } from '@/lib/jaroo-runtime-env'

const notoSansKr = Noto_Sans_KR({
  variable: '--font-noto-sans-kr',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
})

export const metadata: Metadata = {
  title: 'jaroo-mvp-v3',
  description: 'Jaroo mobile mock built with Next.js and shadcn/ui',
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
      className={`${notoSansKr.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className='min-h-full bg-background font-sans text-foreground' suppressHydrationWarning>
        {/* 런타임 env 주입 — 빌드타임 NEXT_PUBLIC_* 스냅샷 stale 회피(2026-10-27). 첫 페인트 전에 심는다. */}
        <script dangerouslySetInnerHTML={{ __html: buildJarooRuntimeEnvScript({
          supabaseUrl: process.env.SUPABASE_URL?.trim(),
          supabaseAnonKey: process.env.SUPABASE_ANON_KEY?.trim(),
          devAutoLogin: process.env.NEXT_PUBLIC_DEV_AUTO_LOGIN?.trim() === '1' || process.env.DEV_AUTO_LOGIN?.trim() === '1',
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
