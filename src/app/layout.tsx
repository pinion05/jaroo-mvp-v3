import type { Metadata } from 'next'
import { Noto_Sans_KR } from 'next/font/google'
import './globals.css'
import { DebugPageNav } from '@/components/debug-page-nav'

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
        <DebugPageNav />
        <div className='min-h-dvh w-full bg-[color:var(--jaroo-canvas)] sm:px-6 sm:py-4'>
          <div className='relative mx-auto flex min-h-dvh w-full max-w-[390px] flex-col overflow-hidden bg-white sm:min-h-[calc(100dvh-2rem)] sm:rounded-[32px] sm:shadow-[0_20px_60px_rgba(12,68,124,0.18)]'>
            {children}
          </div>
        </div>
      </body>
    </html>
  )
}
