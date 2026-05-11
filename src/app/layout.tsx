import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { AuthGate } from '@/components/layout/AuthGate'
import { BottomNav } from '@/components/layout/BottomNav'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })

export const metadata: Metadata = {
  title: 'Health Centre',
  description: 'Personal health dashboard — Sleep, Recovery, Strain & Calories',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Health Centre',
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#0a0a0a',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <head>
        {/* Apple touch icons — must be PNG, sized largest-first */}
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon-180.png" />
        <link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon-180.png" />
        <link rel="apple-touch-icon" sizes="152x152" href="/icons/apple-touch-icon-152.png" />
        <link rel="apple-touch-icon" sizes="120x120" href="/icons/apple-touch-icon-120.png" />
        <link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Health Centre" />
      </head>
      <body className={`${inter.variable} font-sans bg-[#0a0a0a] text-white antialiased`}>
        <AuthGate>
          <main className="min-h-screen pb-[calc(54px+env(safe-area-inset-bottom))]">
            {children}
          </main>
          <BottomNav />
        </AuthGate>
      </body>
    </html>
  )
}
