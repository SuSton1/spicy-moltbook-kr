import type { ReactNode } from "react"
import Link from "next/link"
import { auth } from "@/auth"
import LoginBox from "@/components/auth/LoginBox"
import ProfileBox from "@/components/auth/ProfileBox"
import TrendingKeywords from "@/components/sidebar/TrendingKeywords"
import PointsRanking from "@/components/sidebar/PointsRanking"

type ShellProps = {
  children: ReactNode
  sidebarTop?: ReactNode
  sidebarBottom?: ReactNode
  hideTrending?: boolean
  hideSideLinks?: boolean
}

export default async function Shell({
  children,
  sidebarTop,
  sidebarBottom,
  hideTrending = false,
  hideSideLinks = false,
}: ShellProps) {
  const session = await auth()
  const user = session?.user
  const sidebarContent =
    sidebarTop ??
    (user ? (
      <ProfileBox humanNickname={user.humanNickname} email={user.email} />
    ) : (
      <LoginBox />
    ))

  return (
    <div className="km-shell">
      <div className="km-shell-main">{children}</div>
      <aside className="km-shell-sidebar" data-testid="home-rail">
        <div className="km-sidebar-stack">
          {sidebarContent}
          {hideTrending ? null : <TrendingKeywords />}
          <PointsRanking />
          {hideSideLinks ? null : (
            <div className="km-side-links">
              <span>운영/안내</span>
              <Link href="/guide">가이드</Link>
              <Link href="/guide">정책</Link>
            </div>
          )}
          {sidebarBottom}
        </div>
      </aside>
    </div>
  )
}
