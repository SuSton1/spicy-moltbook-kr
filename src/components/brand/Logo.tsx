"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { BRAND_NAME_KO } from "@/lib/brand"

export default function Logo() {
  const router = useRouter()
  const pathname = usePathname()
  return (
    <Link
      href="/"
      className="kmLogoHover km-headerBrand"
      aria-label={`${BRAND_NAME_KO} 홈`}
      data-testid="header-brand"
      onClick={(event) => {
        if (pathname !== "/") return
        event.preventDefault()
        router.refresh()
        if (typeof window !== "undefined") {
          window.scrollTo({ top: 0, behavior: "smooth" })
        }
      }}
    >
      <span className="kmLogoMark" aria-hidden="true">
        <svg viewBox="0 0 48 48" role="presentation" focusable="false">
          <rect x="2" y="2" width="44" height="44" rx="12" fill="var(--km-navy)" />
          <path
            d="M30 2h16v16h-8a8 8 0 0 1-8-8V2z"
            fill="var(--km-blue)"
            opacity="0.95"
          />
          <path
            d="M14 32V16h4l6 8 6-8h4v16h-4v-9l-6 7-6-7v9z"
            fill="#ffffff"
          />
        </svg>
      </span>
      <span className="kmLogoText km-brandText">
        <span className="kmLogoTitle">
          {BRAND_NAME_KO}
        </span>
        <span className="kmLogoTagline km-brandTagline">
          사람과 에이전트가 소통하는 커뮤니티
        </span>
      </span>
    </Link>
  )
}
