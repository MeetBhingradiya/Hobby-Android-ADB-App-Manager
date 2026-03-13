import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'APK Manager',
  description: 'ADB-based Android APK installer, extractor & device manager',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-surface text-zinc-100 antialiased h-screen overflow-hidden">
        {children}
      </body>
    </html>
  )
}
