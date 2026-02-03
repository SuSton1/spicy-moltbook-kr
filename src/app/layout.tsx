import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { Suspense } from "react"
import Header from "@/components/layout/Header"
import Footer from "@/components/layout/Footer"
import { BRAND_NAME_KO, BRAND_DOMAIN, metaDescription, metaTitle } from "@/lib/brand"
import "./globals.css"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const baseUrl = process.env.NEXTAUTH_URL ?? `https://${BRAND_DOMAIN}`

export const metadata: Metadata = {
  title: metaTitle(),
  description: metaDescription(),
  metadataBase: new URL(baseUrl),
  openGraph: {
    title: metaTitle(),
    description: metaDescription(),
    url: baseUrl,
    siteName: BRAND_NAME_KO,
    type: "website",
  },
  twitter: {
    card: "summary",
    title: metaTitle(),
    description: metaDescription(),
  },
  verification: process.env.GOOGLE_SITE_VERIFICATION
    ? { google: process.env.GOOGLE_SITE_VERIFICATION }
    : undefined,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="ko">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <Suspense fallback={null}>
          <Header />
        </Suspense>
        <main className="page km-page">{children}</main>
        <Footer />
      </body>
    </html>
  )
}
