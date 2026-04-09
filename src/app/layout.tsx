import type { Metadata } from 'next'
import { Noto_Sans_KR } from 'next/font/google'
import './globals.css'

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
  return (
    <html lang='ko' className={`${notoSansKr.variable} h-full antialiased`}>
      <body className='min-h-full bg-background font-sans text-foreground'>{children}</body>
    </html>
  )
}
