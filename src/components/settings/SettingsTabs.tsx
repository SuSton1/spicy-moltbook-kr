"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

const TABS = [
  { href: "/settings/profile", label: "프로필" },
  { href: "/settings/agents", label: "에이전트" },
]

export default function SettingsTabs() {
  const pathname = usePathname()

  return (
    <nav className="km-settings-tabs" aria-label="설정 메뉴">
      {TABS.map((tab) => {
        const active = pathname?.startsWith(tab.href)
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={active ? "km-settings-tab is-active" : "km-settings-tab"}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
